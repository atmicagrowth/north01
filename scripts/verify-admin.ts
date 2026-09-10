/**
 * **The admin guardrails — plan §28.1d.**
 *
 * ```
 * pnpm verify:admin
 * ```
 *
 * §28.1d is written as five things the admin UI must not permit:
 *
 * > arbitrary order status transitions · invalid refunds · negative inventory unless explicitly
 * > supported · duplicate SKUs · publishing malformed products
 *
 * Each of those is a sentence about a *screen*, and a screen is the one place none of them can be
 * enforced. The Payload admin panel is a React client talking to the same REST endpoints as
 * everybody else; a select box that only offers the legal next status is a suggestion a `PATCH` can
 * ignore, and a field rendered `readOnly` is a CSS class. So nothing below inspects the panel. Every
 * check drives the **operations the panel drives** — `payload.create` and `payload.update` — and
 * asserts that the refusal comes from the access layer, a validator, a hook or Postgres itself.
 *
 * **Which door each check knocks on, and why it matters that they differ:**
 *
 * - `overrideAccess: false` with a real staff `user` is the panel's own path, and it is the right
 *   door wherever the rule is **access**. Field access does not throw — Payload deletes the key and
 *   applies the rest of the write — so those checks assert the stored *value*, not an error.
 * - `overrideAccess: true` is server code, and it is the right door wherever the rule is
 *   **validation**: a validator that only runs for the browser is a validator a seed script, a
 *   migration or a future server action walks straight past.
 * - Raw SQL through the Drizzle handle is neither, and it is the only way to ask the question two of
 *   these guardrails are really about: *is there anything under the application?* Plan §17.1f
 *   decrements stock with an expression update that never sees a Payload validator, so "negative
 *   inventory is refused" is a claim about a `CHECK` constraint or it is not a claim at all.
 *
 * The two layers fail differently on purpose — Payload answers with a `ValidationError` naming the
 * field, Postgres with SQLSTATE `23514` or `23505` — and both are asserted by their own shape, so a
 * harness that passed because *something* threw is not possible.
 *
 * The **D-10** guard applies: this creates and deletes staff accounts, products, variants and
 * orders.
 */

import type { Payload, TypedUser } from 'payload'

import { sql } from '@payloadcms/db-postgres/drizzle'

import config from '../src/payload.config'

import { type PaymentStatus } from '../src/lib/checkout/rules'
import { developmentDatabase } from '../src/lib/env.core'
import {
  FULFILLMENT_COPY,
  type FulfillmentRefusal,
  type FulfillmentStatus,
} from '../src/lib/orders/rules'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-admin refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes staff accounts, products, variants and orders, so it may only touch ' +
      'the development database that DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const { getPayload } = await import('payload')

/* -------------------------------------------------------------------------------------------------
 * The harness
 * ---------------------------------------------------------------------------------------------- */

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

type Refusal = {
  /** The per-field messages, when the refusal was a `ValidationError`. */
  fields: { message: string; path: string }[]
  /** The error class — `ValidationError`, `Forbidden`, `NotFound`, … */
  kind: string
  /** The top-level message, which for a validation error is only ever a list of field names. */
  message: string
}

/**
 * A refusal, pulled apart so a check can insist on the *right kind* of no.
 *
 * `ValidationError` puts the useful sentence in `data.errors` — the top-level message is only ever
 * "The following field is invalid: x" — and §28.1d is about a person being told something they can
 * act on, so most checks below compare that sentence rather than merely counting a throw.
 *
 * Naming what is acceptable is also what stops this file lying. A harness that accepts any error at
 * all reports a passing guardrail when the real cause was a typo in a fixture; `verify-access.ts`
 * records that exact defect.
 */
function describeRefusal(error: unknown): Refusal {
  const raw = (error as { data?: { errors?: { message?: unknown; path?: unknown }[] } })?.data
    ?.errors

  return {
    fields: Array.isArray(raw)
      ? raw.map((entry) => ({
          message: typeof entry?.message === 'string' ? entry.message : '',
          path: typeof entry?.path === 'string' ? entry.path : '',
        }))
      : [],
    kind: error instanceof Error ? error.constructor.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  }
}

const summarise = (refusal: Refusal) =>
  refusal.fields.length > 0
    ? refusal.fields.map((field) => `${field.path}: ${field.message}`).join('; ')
    : `${refusal.kind}: ${refusal.message}`

/** A write that must be rejected. Any refusal counts — for the rules whose wording is not ours. */
async function refused(name: string, operation: () => Promise<unknown>) {
  try {
    await operation()
    check(name, false, 'the write was ACCEPTED')
  } catch (error) {
    check(name, true, summarise(describeRefusal(error)))
  }
}

/** A write that must be rejected by a named error class — `Forbidden` for an access rule. */
async function refusedAs(name: string, kind: string, operation: () => Promise<unknown>) {
  try {
    await operation()
    check(name, false, `the write was ACCEPTED — expected ${kind}`)
  } catch (error) {
    const refusal = describeRefusal(error)

    check(name, refusal.kind === kind, refusal.kind === kind ? '' : summarise(refusal))
  }
}

/** A write that must be rejected, and must say a specific sentence while doing it. */
async function refusedSaying(name: string, expected: string, operation: () => Promise<unknown>) {
  try {
    await operation()
    check(name, false, 'the write was ACCEPTED')
  } catch (error) {
    const refusal = describeRefusal(error)
    const ok = refusal.fields.some((field) => field.message === expected)

    check(name, ok, ok ? '' : summarise(refusal))
  }
}

/** …and must name the field it is about, which is what makes the panel's message actionable. */
async function refusedForField(
  name: string,
  path: string,
  expected: string,
  operation: () => Promise<unknown>,
) {
  try {
    await operation()
    check(name, false, 'the write was ACCEPTED')
  } catch (error) {
    const refusal = describeRefusal(error)
    const ok = refusal.fields.some((field) => field.path === path && field.message === expected)

    check(name, ok, ok ? '' : summarise(refusal))
  }
}

/**
 * The SQLSTATE a Postgres refusal carries.
 *
 * Drizzle wraps the driver's error, and the adapter sometimes wraps that again, so the code is one
 * or two `cause` hops down rather than on the object that was thrown — `handleUpsertError` in
 * `@payloadcms/drizzle` reads exactly one hop for the same reason. Walking the chain is what makes
 * this assert **23514** rather than "it threw", which is the whole point of testing the layer under
 * the application.
 */
function sqlState(error: unknown): null | string {
  let current: unknown = error

  for (let depth = 0; depth < 6 && current !== null && current !== undefined; depth += 1) {
    const code = (current as { code?: unknown }).code

    if (typeof code === 'string') {
      return code
    }

    current = (current as { cause?: unknown }).cause
  }

  return null
}

/** A write that must be rejected, asserted by the SQLSTATE Postgres answered with. */
async function refusedBySql(name: string, expected: string, operation: () => Promise<unknown>) {
  try {
    await operation()
    check(name, false, `the statement SUCCEEDED — expected SQLSTATE ${expected}`)
  } catch (error) {
    const state = sqlState(error)

    check(name, state === expected, state === expected ? state : `SQLSTATE ${String(state)}`)
  }
}

async function allowed(name: string, operation: () => Promise<unknown>) {
  try {
    await operation()
    check(name, true)
  } catch (error) {
    check(name, false, summarise(describeRefusal(error)))
  }
}

const payload: Payload = await getPayload({ config })

/**
 * The raw connection, for the two guardrails that are only true if something below Payload enforces
 * them. Cast for the same reason `hooks/orderTransitions.ts` casts: the adapter's `drizzle` handle is
 * a real property of `PostgresAdapter` and is not on the `BaseDatabaseAdapter` type `payload.db` is
 * declared as.
 */
const drizzle = (
  payload.db as unknown as {
    drizzle: { execute: (query: unknown) => Promise<{ rows?: unknown[] }> }
  }
).drizzle

const suffix = Date.now().toString().slice(-9)
const PREFIX = `verify-admin-${suffix}`
const PASSWORD = 'correct-horse-battery-staple'

const created: {
  collection: 'orders' | 'product-variants' | 'products' | 'promotions' | 'users'
  id: number
}[] = []

const cleanup = async () => {
  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true, trash: false })
      .catch(() => undefined)
  }
}

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

const orderNow = async (id: number) =>
  payload.findByID({ collection: 'orders', depth: 0, id, overrideAccess: true })

const variantNow = async (id: number) =>
  payload.findByID({ collection: 'product-variants', depth: 0, id, overrideAccess: true })

const productNow = async (id: number) =>
  payload.findByID({ collection: 'products', depth: 0, id, overrideAccess: true })

async function makeOrder(label: string, paymentStatus: PaymentStatus) {
  const order = await payload.create({
    collection: 'orders',
    data: {
      currency: 'USD',
      discountMinor: 0,
      email: `${PREFIX}@example.test`,
      fulfillmentStatus: 'unfulfilled',
      orderNumber: `N1-ADM-${label}-${suffix}`,
      /*
       * Written here rather than through a transition on purpose: `paymentStatus` is closed to every
       * request (`nobodyField`), and Section B is where that is asserted. A fixture cannot use the
       * door it is about to prove is shut.
       */
      paymentStatus,
      shippingMinor: 0,
      subtotalMinor: 5_000,
      taxMinor: 0,
      totalMinor: 5_000,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'orders', id: order.id })

  return order
}

async function makeProduct(label: string, status: 'draft' | 'published' = 'draft') {
  const product = await payload.create({
    collection: 'products',
    data: {
      name: `Admin fixture ${suffix} ${label}`,
      slug: `${PREFIX}-${label}`,
      sortOrder: 9999,
      status,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'products', id: product.id })

  return product
}

async function makeVariant(
  productId: number,
  label: string,
  overrides: Record<string, unknown> = {},
) {
  const variant = await payload.create({
    collection: 'product-variants',
    data: {
      active: true,
      color: 'Bone',
      colorFamily: 'bone',
      colorHex: '#e8e4dc',
      inventoryQuantity: 10,
      priceMinor: 5_000,
      product: productId,
      size: 'M',
      sizeSortOrder: 30,
      sku: `ADM-${suffix}-${label}`,
      ...overrides,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'product-variants', id: variant.id })

  return variant
}

/* -------------------------------------------------------------------------------------------------
 * §28.1d(1) — arbitrary order status transitions
 *
 * Twenty-five ordered pairs. Five are the machine §18.1b draws, five are a status set to itself —
 * which is not a transition and must stay saveable, because the panel posts the whole document on
 * every save — and the remaining fifteen are enumerated below with the reason each is refused for.
 * Written out rather than derived from `canFulfillmentTransition`, because a table generated from
 * the code under test agrees with it by construction and proves nothing.
 * ---------------------------------------------------------------------------------------------- */

const ILLEGAL_STEPS: Record<
  FulfillmentStatus,
  Partial<Record<FulfillmentStatus, FulfillmentRefusal>>
> = {
  /* Terminal: the refusal is about the state the order is *in*, so it outranks everything else. */
  cancelled: {
    delivered: 'terminal',
    processing: 'terminal',
    shipped: 'terminal',
    unfulfilled: 'terminal',
  },
  delivered: {
    cancelled: 'terminal',
    processing: 'terminal',
    shipped: 'terminal',
    unfulfilled: 'terminal',
  },
  /* Live states: the refusal is about the edge, so it reads `unreachable`. */
  processing: { delivered: 'unreachable', unfulfilled: 'unreachable' },
  shipped: { cancelled: 'unreachable', processing: 'unreachable', unfulfilled: 'unreachable' },
  unfulfilled: { delivered: 'unreachable', shipped: 'unreachable' },
}

try {
  await cleanup()

  /* ---------------------------------------------------------------- staff, and only staff ---- */

  /*
   * **The admin fixture is created first, and the order is load-bearing** — the lesson
   * `verify-access.ts` records in full. `Users.ts` forces the first account on an empty database to
   * `admin` whatever role was asked for, so on a freshly migrated database the *second* fixture would
   * silently be an editor. Creating the admin first means the bootstrap promotes the account that was
   * going to be an admin anyway, and the check below is what stops that being a silent dependency.
   */
  const admin = await payload.create({
    collection: 'users',
    data: { email: `${PREFIX}-admin@example.test`, password: PASSWORD, role: 'admin' },
    overrideAccess: true,
  })

  created.push({ collection: 'users', id: admin.id })

  check('the admin fixture is actually an admin', admin.role === 'admin', String(admin.role))

  const adminUser = { ...admin, collection: 'users' } as TypedUser

  /* ============================================ A — §28.1d(1) order status transitions */

  /**
   * One attempt through the door the panel uses. Returns `null` when the write was accepted, so an
   * accepted illegal step is a distinguishable failure rather than a missing error.
   */
  async function attempt(
    orderId: number,
    to: FulfillmentStatus,
    extra: Record<string, unknown> = {},
  ): Promise<null | string> {
    try {
      await payload.update({
        collection: 'orders',
        data: { fulfillmentStatus: to, ...extra } as never,
        id: orderId,
        overrideAccess: false,
        user: adminUser,
      })

      return null
    } catch (error) {
      const refusal = describeRefusal(error)

      return refusal.fields[0]?.message ?? summarise(refusal)
    }
  }

  /*
   * A **set** of pairs, not a tally. `unfulfilled` is asserted twice on purpose — once on an unpaid
   * order and once on a paid one, because the payment axis changes which refusal a live state gives
   * — so counting attempts would report 17 for 15 distinct pairs and the total would stop meaning
   * "the machine has no edge nobody meant".
   */
  const illegalPairsTried = new Set<string>()

  async function assertNoWayOut(orderId: number, from: FulfillmentStatus) {
    const steps = Object.entries(ILLEGAL_STEPS[from]) as [FulfillmentStatus, FulfillmentRefusal][]

    for (const [to, reason] of steps) {
      const message = await attempt(orderId, to)

      illegalPairsTried.add(`${from}→${to}`)

      check(
        `A: ${from} → ${to} is refused, and says why (${reason})`,
        message === FULFILLMENT_COPY[reason],
        message === null ? 'the write was ACCEPTED' : message,
      )
    }

    const live = await orderNow(orderId)

    check(
      `A: …and after ${steps.length} refused attempts the order is still ${from}`,
      live.fulfillmentStatus === from,
      String(live.fulfillmentStatus),
    )
  }

  {
    /* ---- unpaid: the payment gate, then the ordinary cancellation ---- */

    const unpaid = await makeOrder('A1', 'pending_payment')

    await assertNoWayOut(unpaid.id, 'unfulfilled')

    const notPaid = await attempt(unpaid.id, 'processing')

    check(
      'A: **an unpaid order cannot be picked** — §18.1b starts the chain at PAID',
      notPaid === FULFILLMENT_COPY.notPaid,
      notPaid === null ? 'the write was ACCEPTED' : notPaid,
    )

    await allowed('A: …but cancelling an unpaid order is ordinary, not an exception', () =>
      payload.update({
        collection: 'orders',
        data: { fulfillmentStatus: 'cancelled' },
        id: unpaid.id,
        overrideAccess: false,
        user: adminUser,
      }),
    )

    await assertNoWayOut(unpaid.id, 'cancelled')

    /*
     * The case that would make every finished order unsaveable if the hook read an unchanged status
     * as a transition. The panel posts every field on every save, so this is the *ordinary* write.
     */
    await allowed(
      'A: a terminal order still saves when the status does not move — the panel posts every field',
      () =>
        payload.update({
          collection: 'orders',
          data: { fulfillmentStatus: 'cancelled', trackingNumber: `${PREFIX}-note` },
          id: unpaid.id,
          overrideAccess: false,
          user: adminUser,
        }),
    )
  }

  {
    /* ---- paid: the whole legal walk, with §18.1c's dispatch conditions ---- */

    const paid = await makeOrder('A2', 'paid')

    await assertNoWayOut(paid.id, 'unfulfilled')

    await allowed('A: **unfulfilled → processing** is the first legal edge', () =>
      payload.update({
        collection: 'orders',
        data: { fulfillmentStatus: 'processing' },
        id: paid.id,
        overrideAccess: false,
        user: adminUser,
      }),
    )

    await assertNoWayOut(paid.id, 'processing')

    check(
      'A: §18.1c dispatch with neither carrier nor tracking is refused',
      (await attempt(paid.id, 'shipped')) === FULFILLMENT_COPY.trackingRequired,
    )

    check(
      'A: …with a carrier but no tracking, likewise',
      (await attempt(paid.id, 'shipped', { carrier: 'Royal Mail' })) ===
        FULFILLMENT_COPY.trackingRequired,
    )

    check(
      'A: …and a tracking number of spaces is not a tracking number',
      (await attempt(paid.id, 'shipped', { carrier: 'Royal Mail', trackingNumber: '   ' })) ===
        FULFILLMENT_COPY.trackingRequired,
    )

    await allowed('A: **processing → shipped** once both are supplied', () =>
      payload.update({
        collection: 'orders',
        data: {
          carrier: 'Royal Mail',
          fulfillmentStatus: 'shipped',
          trackingNumber: `TRK-${suffix}`,
        },
        id: paid.id,
        overrideAccess: false,
        user: adminUser,
      }),
    )

    check(
      'A: …and shippedAt is stamped by the transition, not typed beside it',
      typeof (await orderNow(paid.id)).shippedAt === 'string',
      String((await orderNow(paid.id)).shippedAt),
    )

    await assertNoWayOut(paid.id, 'shipped')

    await allowed('A: **shipped → delivered** is the last legal edge', () =>
      payload.update({
        collection: 'orders',
        data: { fulfillmentStatus: 'delivered' },
        id: paid.id,
        overrideAccess: false,
        user: adminUser,
      }),
    )

    await assertNoWayOut(paid.id, 'delivered')
  }

  {
    /* ---- the fifth legal edge, which the walk above cannot reach ---- */

    const cancelling = await makeOrder('A3', 'paid')

    await payload.update({
      collection: 'orders',
      data: { fulfillmentStatus: 'processing' },
      id: cancelling.id,
      overrideAccess: false,
      user: adminUser,
    })

    await allowed('A: **processing → cancelled** — cancellation is available until dispatch', () =>
      payload.update({
        collection: 'orders',
        data: { fulfillmentStatus: 'cancelled' },
        id: cancelling.id,
        overrideAccess: false,
        user: adminUser,
      }),
    )
  }

  check(
    'A: all fifteen illegal ordered pairs were attempted against a real order',
    illegalPairsTried.size === 15,
    `${illegalPairsTried.size} distinct pairs: ${[...illegalPairsTried].join(' ')}`,
  )

  /* ============================================ B — §28.1d(2) invalid refunds */

  {
    /**
     * **A refund is not a status somebody types.**
     *
     * `AGENTS.md`: *"Only a signature-verified Stripe webhook marks an order paid."* The same
     * sentence governs the money coming back — the refund happens in Stripe, the event arrives
     * signed, and this application records what it is told. So the guardrail is not a validated
     * refund form; it is that **no request can write the payment axis at all**, and that the three
     * columns which make a refund a financial record rather than a word cannot be invented.
     *
     * Field access denies by *removing the key*, so none of these throw. The assertion is the stored
     * value, and the tracking number riding along in the same write is what tells a working denial
     * apart from an update that failed for some other reason.
     */
    const order = await makeOrder('B', 'paid')

    const PAYMENT_STATUSES: PaymentStatus[] = [
      'cancelled',
      'checkout_started',
      'draft',
      'payment_failed',
      'pending_payment',
      'refunded',
    ]

    for (const target of PAYMENT_STATUSES) {
      await payload.update({
        collection: 'orders',
        data: { paymentStatus: target },
        id: order.id,
        overrideAccess: false,
        user: adminUser,
      })

      check(
        `B: an admin cannot set paymentStatus to ${target}`,
        (await orderNow(order.id)).paymentStatus === 'paid',
        String((await orderNow(order.id)).paymentStatus),
      )
    }

    await payload.update({
      collection: 'orders',
      data: {
        paidAt: new Date('2001-01-01').toISOString(),
        refundedAt: new Date('2001-01-01').toISOString(),
        refundedMinor: 5_000,
        trackingNumber: `${PREFIX}-refund-probe`,
      },
      id: order.id,
      overrideAccess: false,
      user: adminUser,
    })

    const probed = await orderNow(order.id)

    check(
      'B: **a refund amount cannot be invented** — refundedMinor is closed to every request',
      probed.refundedMinor === null || probed.refundedMinor === undefined,
      String(probed.refundedMinor),
    )

    check(
      'B: …nor the date it happened on',
      probed.refundedAt === null || probed.refundedAt === undefined,
      String(probed.refundedAt),
    )

    check(
      'B: …nor paidAt, which is the same claim about the money going the other way',
      probed.paidAt === null || probed.paidAt === undefined,
      String(probed.paidAt),
    )

    check(
      'B: …and the rest of that same write landed, so the denial is the field and not the write',
      probed.trackingNumber === `${PREFIX}-refund-probe`,
      String(probed.trackingNumber),
    )

    /*
     * The positive control. Without it, every check above would still pass on a column nothing can
     * ever write — which is a broken feature wearing a guardrail's clothes. `overrideAccess: true` is
     * the path Phase 17's verified webhook takes, and it is untouched.
     */
    const byServer = await payload.update({
      collection: 'orders',
      data: { refundedAt: new Date().toISOString(), refundedMinor: 5_000 },
      id: order.id,
      overrideAccess: true,
    })

    check(
      'B: …while the server path still records a refund — the guard is the browser door, not the column',
      byServer.refundedMinor === 5_000 && typeof byServer.refundedAt === 'string',
      `${String(byServer.refundedMinor)} / ${String(byServer.refundedAt)}`,
    )

    /*
     * And the other way an invalid refund could be manufactured: not by editing an order, but by
     * inventing one that was already refunded. `Orders.access.create` is `nobody`, admins included.
     */
    await refusedAs(
      'B: **an order cannot be created through the panel at all** — a refund needs a real payment',
      'Forbidden',
      () =>
        payload.create({
          collection: 'orders',
          data: {
            currency: 'USD',
            discountMinor: 0,
            email: `${PREFIX}-forged@example.test`,
            fulfillmentStatus: 'unfulfilled',
            orderNumber: `N1-ADM-FORGED-${suffix}`,
            paymentStatus: 'refunded',
            refundedMinor: 9_999,
            shippingMinor: 0,
            subtotalMinor: 0,
            taxMinor: 0,
            totalMinor: 0,
          } as never,
          overrideAccess: false,
          user: adminUser,
        }),
    )

    /**
     * **The money on an order, locked in Phase 28's own sweep.**
     *
     * Section B above proves the payment *axis* cannot be typed. It did not cover the amounts, and
     * those were freely editable by staff — in the panel and over REST, on a record with no version
     * history. The nearest thing to a fake refund this admin ever permitted was not a status: it
     * was typing a smaller total.
     *
     * Every one of these is a **snapshot of what was actually charged**, recalculated server-side at
     * checkout and frozen (§18.1d). An order whose stored total disagrees with what Stripe took is
     * a reconciliation nobody can win.
     *
     * Field access removes the key rather than throwing, so — as in B — the assertion is the stored
     * value, and a legitimate field riding along in the same write is what tells a working denial
     * apart from an update that failed for another reason.
     */
    {
      const order = await makeOrder('B-money', 'paid')
      const before = await orderNow(order.id)

      await payload.update({
        collection: 'orders',
        data: {
          currency: 'EUR',
          discountCode: 'FORGED',
          discountMinor: 99_999,
          shippingMinor: 99_999,
          subtotalMinor: 1,
          taxMinor: 99_999,
          totalMinor: 1,
          /* The control: a field staff genuinely own, in the same write. */
          trackingNumber: `${PREFIX}-money-probe`,
        },
        id: order.id,
        overrideAccess: false,
        user: adminUser,
      })

      const after = await orderNow(order.id)

      for (const field of [
        'currency',
        'discountCode',
        'discountMinor',
        'shippingMinor',
        'subtotalMinor',
        'taxMinor',
        'totalMinor',
      ] as const) {
        check(
          `B: **an admin cannot rewrite \`${field}\`** — the charge is a snapshot, not an opinion`,
          after[field] === before[field],
          `${String(before[field])} -> ${String(after[field])}`,
        )
      }

      check(
        'B: …and the write itself landed, so the denial is the field and not a failed update',
        after.trackingNumber === `${PREFIX}-money-probe`,
      )
    }
  }

  /* ============================================ C — §28.1d(3) negative inventory, both layers */

  {
    const product = await makeProduct('c')
    const variant = await makeVariant(product.id, 'c')

    /* ---- Layer one: Payload's validator, on the server path as well as the panel's ---- */

    await refusedSaying(
      'C: **negative stock is refused by validation**, even with overrideAccess',
      'A whole number of units, zero or more.',
      () =>
        payload.update({
          collection: 'product-variants',
          data: { inventoryQuantity: -1 },
          id: variant.id,
          overrideAccess: true,
        }),
    )

    await refusedSaying(
      'C: …and so is a fractional count — half a garment cannot be picked',
      'A whole number of units, zero or more.',
      () =>
        payload.update({
          collection: 'product-variants',
          data: { inventoryQuantity: 2.5 },
          id: variant.id,
          overrideAccess: true,
        }),
    )

    await refusedSaying(
      'C: …and through the panel’s own door, with a real staff user',
      'A whole number of units, zero or more.',
      () =>
        payload.update({
          collection: 'product-variants',
          data: { inventoryQuantity: -5 },
          id: variant.id,
          overrideAccess: false,
          user: adminUser,
        }),
    )

    await allowed('C: zero is allowed — sold out is a state, not an error', () =>
      payload.update({
        collection: 'product-variants',
        data: { inventoryQuantity: 0 },
        id: variant.id,
        overrideAccess: true,
      }),
    )

    /* ---- Layer two: the CHECK, which is the only rule an expression update cannot step around ---- */

    /*
     * Named separately from the write below so that a database which never received the constraint
     * fails *here*, saying so, rather than one line further down where it looks like a missing
     * refusal. `afterSchemaInit` in `payload.config.ts` declares it; push or a migration installs it.
     */
    const constraint = await drizzle.execute(sql`
      SELECT conname
      FROM pg_constraint
      WHERE conname = 'product_variants_inventory_non_negative'
    `)

    check(
      'C: the CHECK constraint exists in this database',
      (constraint.rows ?? []).length === 1,
      `${(constraint.rows ?? []).length} row(s)`,
    )

    await payload.update({
      collection: 'product-variants',
      data: { inventoryQuantity: 3 },
      id: variant.id,
      overrideAccess: true,
    })

    /*
     * **The shape plan §17.1f actually issues.** Not `SET inventory_quantity = -1`, which nothing in
     * this application would ever write, but the atomic decrement the payment transaction uses —
     * past every validator declared above, straight at the column. `23514` is `check_violation`.
     */
    await refusedBySql(
      'C: **an atomic decrement below zero is refused by Postgres**, past validation entirely',
      '23514',
      () =>
        drizzle.execute(sql`
          UPDATE "product_variants"
          SET "inventory_quantity" = "inventory_quantity" - 999
          WHERE "id" = ${variant.id}
        `),
    )

    check(
      'C: …and the lost write really was lost — the row still holds the last honest count',
      (await variantNow(variant.id)).inventoryQuantity === 3,
      String((await variantNow(variant.id)).inventoryQuantity),
    )

    /*
     * The control for the control: the same statement, one unit short of the bound, succeeds. Without
     * it, a constraint that refused every update would look identical to one that refused the right
     * ones.
     */
    await allowed('C: …while a decrement that lands on zero is fine — the bound is the rule', () =>
      drizzle.execute(sql`
        UPDATE "product_variants"
        SET "inventory_quantity" = "inventory_quantity" - 3
        WHERE "id" = ${variant.id}
      `),
    )
  }

  /* ============================================ D — §28.1d(4) duplicate SKUs */

  {
    const product = await makeProduct('d')
    const first = await makeVariant(product.id, 'd1')

    /*
     * Through Payload the refusal arrives as a `ValidationError` naming the field — but that is not a
     * pre-flight query, it is the adapter *translating* the database's answer
     * (`handleUpsertError` catches 23505 and rethrows). Worth knowing, because it means the panel's
     * tidy message and the raw constraint below are the same guarantee seen from two sides.
     */
    await refusedSaying(
      'D: **a second variant cannot take a SKU that already exists**',
      'Value must be unique',
      () =>
        payload.create({
          collection: 'product-variants',
          data: {
            active: true,
            color: 'Graphite',
            colorFamily: 'charcoal',
            inventoryQuantity: 1,
            priceMinor: 5_000,
            product: product.id,
            size: 'L',
            sizeSortOrder: 40,
            sku: `ADM-${suffix}-d1`,
          } as never,
          overrideAccess: true,
        }),
    )

    await refusedSaying(
      'D: …and case and padding are not a way round it — the SKU is normalised before the index sees it',
      'Value must be unique',
      () =>
        payload.create({
          collection: 'product-variants',
          data: {
            active: true,
            color: 'Graphite',
            colorFamily: 'charcoal',
            inventoryQuantity: 1,
            priceMinor: 5_000,
            product: product.id,
            size: 'L',
            sizeSortOrder: 40,
            sku: `  adm-${suffix}-d1  `,
          } as never,
          overrideAccess: true,
        }),
    )

    /*
     * `ProductVariants.ts` argues at length that the constraint is deliberately *stricter* than plan
     * §6.1c's "two active variants of the same product", because a reused SKU breaks order history.
     * This is that claim measured: a different product, and still refused.
     */
    const otherProduct = await makeProduct('d-other')

    await refusedSaying(
      'D: …nor on a different product — a SKU that names two garments cannot be picked or reconciled',
      'Value must be unique',
      () =>
        payload.create({
          collection: 'product-variants',
          data: {
            active: true,
            color: 'Bone',
            colorFamily: 'bone',
            inventoryQuantity: 1,
            priceMinor: 5_000,
            product: otherProduct.id,
            size: 'S',
            sizeSortOrder: 20,
            sku: `ADM-${suffix}-d1`,
          } as never,
          overrideAccess: true,
        }),
    )

    /*
     * And the layer underneath, for the same reason as the CHECK above: Payload's message is only
     * ever as good as the index behind it. `23505` is `unique_violation`, raised by the real index on
     * a statement that never met a validator.
     *
     * **The value written is the *stored* form — upper-case — and the first version of this check was
     * not.** Writing `…-d1` past Payload succeeded, because the index compares raw text and `d1` is
     * not `D1`. That is not a bug in the index; it is the boundary of what the index promises. Case
     * insensitivity here is the `beforeValidate` hook on `sku`, so it holds for every path *through
     * Payload* and for none that goes round it — a hand-written migration or a bulk SQL import could
     * seat `adm-1-d1` beside `ADM-1-D1` and Postgres would take both. Closing that would mean a
     * `UNIQUE (upper(sku))` expression index, which is a migration; recorded rather than smuggled in.
     * The check below asks the question it can actually answer: given the value Payload would store,
     * is the index real?
     */
    const second = await makeVariant(product.id, 'd2', {
      color: 'Graphite',
      colorFamily: 'charcoal',
      size: 'L',
      sizeSortOrder: 40,
    })

    await refusedBySql(
      'D: **the unique index refuses it in Postgres**, not merely in Payload',
      '23505',
      () =>
        drizzle.execute(sql`
          UPDATE "product_variants"
          SET "sku" = ${`ADM-${suffix}-D1`}
          WHERE "id" = ${second.id}
        `),
    )

    check(
      'D: …and the second variant kept its own SKU',
      (await variantNow(second.id)).sku === `ADM-${suffix}-D2`,
      String((await variantNow(second.id)).sku),
    )

    check(
      'D: the first variant is untouched throughout',
      (await variantNow(first.id)).sku === `ADM-${suffix}-D1`,
      String((await variantNow(first.id)).sku),
    )
  }

  /* ============================================ E — §28.1d(5) publishing malformed products */

  {
    /**
     * **The one guardrail in §28.1d that is a judgement rather than a constraint.**
     *
     * A duplicate SKU and negative stock are impossible states. A product with no variants is a
     * perfectly ordinary *draft* — it is where every product starts — and only becomes a defect at
     * the moment somebody publishes it, because a published product with nothing to sell renders a
     * card with no price, a size selector with no sizes, and an Add to bag button that cannot work.
     * That is plan §0.1.17's fake functionality reached through the CMS rather than through code.
     *
     * So the assertions come in pairs: the draft must stay saveable, and the publish must not. A
     * validation that refused the draft would make the admin unusable for its most common task.
     */

    await refusedForField(
      'E: a product cannot be created without a slug — there is no URL to publish it at',
      'slug',
      'This field is required.',
      () =>
        payload.create({
          collection: 'products',
          data: {
            name: `Admin fixture ${suffix} no-slug`,
            sortOrder: 9999,
            status: 'published',
          } as never,
          overrideAccess: true,
        }),
    )

    const empty = await makeProduct('e-empty')

    check(
      'E: …a product with no variants saves happily as a draft — that is where every product starts',
      (await productNow(empty.id)).status === 'draft',
    )

    check(
      'E: …and it has no price to show, which is the fact the publish gate turns on',
      (await productNow(empty.id)).derived?.priceFromMinor === null ||
        (await productNow(empty.id)).derived?.priceFromMinor === undefined,
      String((await productNow(empty.id)).derived?.priceFromMinor),
    )

    /*
     * These two are the assertions for validation another agent is adding to `Products.ts` in this
     * same phase. They are written against the *outcome* — the write is refused — rather than against
     * a message, so they do not presume how it is spelled. If they fail, the guardrail is not there
     * yet; deleting them to make the harness green would be the exact defect §28.1d exists to stop.
     */
    await refused(
      'E: **a product with no variants cannot be published** — nothing to price, size or sell',
      () =>
        payload.update({
          collection: 'products',
          data: { status: 'published' },
          id: empty.id,
          overrideAccess: false,
          user: adminUser,
        }),
    )

    const inactive = await makeProduct('e-inactive')

    await makeVariant(inactive.id, 'e-inactive', { active: false })

    check(
      'E: …a product whose only variant is inactive also has no price',
      (await productNow(inactive.id)).derived?.priceFromMinor === null ||
        (await productNow(inactive.id)).derived?.priceFromMinor === undefined,
      String((await productNow(inactive.id)).derived?.priceFromMinor),
    )

    await refused(
      'E: **…so it cannot be published either** — a withdrawn variant is not a purchasable one',
      () =>
        payload.update({
          collection: 'products',
          data: { status: 'published' },
          id: inactive.id,
          overrideAccess: false,
          user: adminUser,
        }),
    )

    /*
     * The control. A guardrail that refuses every publish is not a guardrail, it is an outage, and
     * this is the check that would catch it.
     */
    const sellable = await makeProduct('e-ok')

    await makeVariant(sellable.id, 'e-ok')

    await allowed('E: a product with one active, priced variant publishes normally', () =>
      payload.update({
        collection: 'products',
        data: { status: 'published' },
        id: sellable.id,
        overrideAccess: false,
        user: adminUser,
      }),
    )

    check(
      'E: …and it is genuinely published',
      (await productNow(sellable.id)).status === 'published',
      String((await productNow(sellable.id)).status),
    )
  }

  /* ============================================ F — promotions, §28.1d's "invalid commerce states" */

  {
    /**
     * **The discount code, which is the one place in the admin where a typo is worth money.**
     *
     * §28.1d's list is five named cases and one governing sentence — *invalid commerce states must
     * not be creatable accidentally*. Three of this collection's states qualify, and all three used
     * to be reachable:
     *
     * 1. A usage count typed by hand. `timesUsed` is what `usageLimit` is measured against, so a
     *    figure somebody chose is a limit that lies in whichever direction they chose it.
     * 2. A date window that runs backwards. Nothing throws — §15.1a checks *started* and *ended*
     *    independently, so an inverted window fails both, silently, for ever.
     * 3. A code that reads as ON in the list and is OFF at the till, because "live" is four columns
     *    combined in somebody's head.
     */
    const makePromotion = async (label: string, data: Record<string, unknown>) => {
      const promotion = await payload.create({
        collection: 'promotions',
        data: {
          active: true,
          code: `ADM${suffix}${label}`,
          percentage: 10,
          type: 'percentage',
          ...data,
        } as never,
        overrideAccess: true,
      })

      created.push({ collection: 'promotions', id: promotion.id })

      return promotion
    }

    /*
     * `liveNow` is virtual, so it exists on the read and not in `payload-types.ts` until the caller
     * regenerates them at the end of this phase. Read through a cast rather than waiting for that —
     * a check that cannot run until after the phase is a check nobody runs.
     */
    const liveNowOf = async (id: number) =>
      (
        (await payload.findByID({
          collection: 'promotions',
          depth: 0,
          id,
          overrideAccess: true,
        })) as { liveNow?: unknown }
      ).liveNow

    /* ---- the counter, at the door the update guard left open ---- */

    const counted = await payload.create({
      collection: 'promotions',
      data: {
        active: true,
        code: `ADM${suffix}COUNT`,
        percentage: 10,
        timesUsed: 99,
        type: 'percentage',
        usageLimit: 100,
      } as never,
      overrideAccess: false,
      user: adminUser,
    })

    created.push({ collection: 'promotions', id: counted.id })

    check(
      'F: **a promotion cannot be born claiming redemptions it never had**',
      counted.timesUsed === 0,
      String(counted.timesUsed),
    )

    check(
      'F: …and the rest of that create landed, so the denial is the field and not the write',
      counted.usageLimit === 100 && counted.percentage === 10,
      `${String(counted.usageLimit)} / ${String(counted.percentage)}`,
    )

    /* ---- the window that runs backwards ---- */

    await refusedForField(
      'F: **a promotion whose end precedes its start is refused** — it could never be live',
      'endsAt',
      'The end must come after the start, or this code can never be live. Leave it empty for no expiry.',
      () =>
        payload.create({
          collection: 'promotions',
          data: {
            active: true,
            code: `ADM${suffix}BACKWARDS`,
            endsAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            percentage: 10,
            startsAt: new Date('2026-06-01T00:00:00.000Z').toISOString(),
            type: 'percentage',
          } as never,
          overrideAccess: false,
          user: adminUser,
        }),
    )

    await allowed('F: …while a window the right way round is ordinary', () =>
      makePromotion('WINDOW', {
        endsAt: new Date('2026-06-01T00:00:00.000Z').toISOString(),
        startsAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      }),
    )

    /* ---- "is this live right now?", the question the columns could not answer ---- */

    const now = Date.now()
    const live = await makePromotion('LIVE', {})
    const off = await makePromotion('OFF', { active: false })
    const scheduled = await makePromotion('SOON', {
      startsAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    const ended = await makePromotion('ENDED', {
      endsAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    })
    const spent = await makePromotion('SPENT', { timesUsed: 3, usageLimit: 3 })

    check('F: an active, in-window code reads Live now', (await liveNowOf(live.id)) === 'Live now')

    check(
      'F: **a code with Active ticked and a past end date does not read as live**',
      (await liveNowOf(ended.id)) === 'Ended — the end date has passed.',
      String(await liveNowOf(ended.id)),
    )

    check(
      'F: **nor one that has reached its usage limit** — the case the two count columns hide',
      (await liveNowOf(spent.id)) === 'Used up — it has reached its total usage limit.',
      String(await liveNowOf(spent.id)),
    )

    check(
      'F: a future start reads as scheduled rather than as off',
      (await liveNowOf(scheduled.id)) === 'Scheduled — it goes live on the start date.',
      String(await liveNowOf(scheduled.id)),
    )

    check(
      'F: and the switch itself still answers first',
      (await liveNowOf(off.id)) === 'Off — the Active switch is unticked.',
      String(await liveNowOf(off.id)),
    )
  }
} finally {
  await cleanup()
}

/* -------------------------------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------------------------------- */

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} admin guardrail checks passed.`,
  ...failed.map((result) => `FAIL  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`),
  '',
  ...results.map(
    (result) =>
      `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  ),
].join('\n')

await new Promise<void>((resolve, reject) => {
  process.stdout.write(`${report}\n`, (error) => (error ? reject(error) : resolve()))
})

await payload.destroy()

if (failed.length > 0) {
  throw new Error(`${failed.length} admin guardrail check(s) failed.`)
}
