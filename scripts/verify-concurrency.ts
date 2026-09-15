/**
 * **Stale whole-row writes — the concurrency review of 2026-09-15.**
 *
 * ```
 * pnpm verify:concurrency
 * ```
 *
 * A Payload update reads its row without a lock, refills every field the request did not send from
 * that read, and writes the whole row back; the admin form, besides, sends every field as it was when
 * the page was opened. `lib/concurrency/stale-writes.ts` has the full account. Every raw-SQL write in
 * checkout could be undone that way — a sale's stock decrement, a webhook's `paid`, a refund, a hold,
 * a code's redemption count, a bag's `converted` — and a derived-stock refresh could re-publish or
 * un-trash a product. This harness holds each race open and proves it closed.
 *
 * **Every race is the dangerous interleaving, on every run.** The competing write runs in a
 * transaction this script owns and has not committed (`holdTransaction`); the Payload write under test
 * is started; `blockedBehind` waits until Postgres itself reports that write queued behind the held
 * transaction (`pg_blocking_pids`); and only then is the held one committed. The same technique as
 * `verify-access.ts` sweep 1. A write that did not queue is a failed check, not a skipped one.
 *
 * **And every form case sends what the admin form sends**: the values the page was opened with,
 * through the REST operation (`payloadAPI: 'REST'`, no `overrideAccess`, a staff user), after the
 * competing write has committed.
 *
 * | Section | What |
 * |---|---|
 * | A | Variant stock: a save cannot undo a sale's decrement (operation and form windows); a changed count over a moved figure is refused; callers with no opened-with value are taken at their word; the virtual field has no column |
 * | B | Orders: a save cannot undo a payment, a refund or a hold; the panel does not cancel a paid order; a REST caller that may not write locks nothing |
 * | C | Promotions: a save cannot lose a redemption |
 * | D | Derived stock: a refresh cannot re-publish or un-trash a product, and a product save cannot put back an older figure |
 * | E | Bags: a Local API write cannot reopen a converted bag, and a form cannot set it active |
 *
 * The **D-10** guard applies: it creates and permanently deletes a staff account, products, variants,
 * orders, a promotion and bags, all named `verify-concurrency-…` / `VCC…` / `N1-VCC-…`, and clears an
 * aborted run's leftovers by those names first.
 */

import { sql } from '@payloadcms/db-postgres'
import type { Payload, TypedUser } from 'payload'

import config from '../src/payload.config'

import {
  CONVERTED_BAG_COPY,
  PAID_CANCELLATION_COPY,
  STOCK_WHEN_OPENED,
} from '../src/lib/concurrency/stale-writes'
import { developmentDatabase } from '../src/lib/env.core'
import { recalculateProductDerived } from '../src/payload/hooks/syncProductDerived'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-concurrency refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes orders, products, variants, promotions, bags and a staff account, so ' +
      'it may only touch the development database that DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const { createLocalReq, getPayload, updateByIDOperation, updateOperation } = await import('payload')

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ detail, name, ok })
}

const payload: Payload = await getPayload({ config })

const suffix = Date.now().toString().slice(-9)
const PREFIX = `verify-concurrency-${suffix}`
const PASSWORD = 'correct-horse-battery-staple'

type Created = {
  collection: 'carts' | 'orders' | 'product-variants' | 'products' | 'promotions' | 'users'
  id: number
}

const created: Created[] = []

/* -------------------------------------------------------------------------------------------------
 * Holding a race open
 * ---------------------------------------------------------------------------------------------- */

type TxHandle = { execute: (query: unknown) => Promise<{ rowCount?: number; rows?: unknown[] }> }

/** A transaction this script owns, with its raw handle, its Local API `req` and its backend pid. */
async function holdTransaction() {
  const transactionID = await payload.db.beginTransaction()

  if (transactionID === null) {
    throw new Error('Could not begin a transaction to hold.')
  }

  const tx = (payload.db as unknown as { sessions: Record<string, { db: TxHandle }> }).sessions[
    String(transactionID)
  ].db

  const { rows } = await tx.execute(sql`SELECT pg_backend_pid() AS "pid"`)

  return {
    commit: () => payload.db.commitTransaction(transactionID),
    pid: Number((rows?.[0] as { pid: number }).pid),
    req: { transactionID } as never,
    rollback: () => payload.db.rollbackTransaction(transactionID),
    tx,
  }
}

type Held = Awaited<ReturnType<typeof holdTransaction>>

/** Wait until some other backend is blocked on a lock held by `pid`. */
async function blockedBehind(pid: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const { rows } = await payload.db.drizzle.execute(
      sql`SELECT count(*)::int AS "waiting" FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`,
    )

    if ((rows[0] as { waiting: number }).waiting > 0) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  return false
}

type Settled = { error: unknown; outcome: string }

function settle(operation: Promise<unknown>): Promise<Settled> {
  return operation.then(
    () => ({ error: null, outcome: 'done' }),
    (error: unknown) => ({
      error,
      outcome: error instanceof Error ? error.constructor.name : String(error),
    }),
  )
}

/**
 * **The race, in the only order that matters.** `hold` makes the competing write inside a held
 * transaction; `write` is started; it must queue behind that transaction; the transaction commits;
 * the write finishes. Returns whether it queued and how it ended.
 */
async function underHeldWrite(
  hold: (held: Held) => Promise<unknown>,
  write: () => Promise<unknown>,
): Promise<Settled & { queued: boolean }> {
  const held = await holdTransaction()

  try {
    await hold(held)
  } catch (error) {
    await held.rollback().catch(() => undefined)
    throw error
  }

  const running = settle(write())
  const queued = await blockedBehind(held.pid)

  await held.commit()

  return { ...(await running), queued }
}

/** Whether `operation` settles within `ms` — false when it is still queued on a lock. */
function settlesWithin(operation: Promise<unknown>, ms = 3_000): Promise<boolean> {
  return Promise.race([
    operation.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ])
}

/** A request shaped as Payload's REST handlers make it — the admin panel's door. */
async function restReq(user?: TypedUser) {
  const req = await createLocalReq(user ? { user } : {}, payload)

  req.payloadAPI = 'REST'

  return req
}

/** The first field message of a `ValidationError`, or `null`. */
function fieldMessage(error: unknown): null | string {
  const errors = (error as { data?: { errors?: { message?: string; path?: string }[] } } | null)
    ?.data?.errors

  return errors?.[0]?.message ?? null
}

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

const cleanup = async () => {
  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true, trash: true })
      .catch(() => undefined)
  }
}

/** An aborted run's fixtures, by the names only this script writes. */
async function clearAbortedRuns(): Promise<void> {
  const idsOf = async (query: ReturnType<typeof sql>) =>
    ((await payload.db.drizzle.execute(query)).rows as { id: number | string }[]).map((row) =>
      Number(row.id),
    )

  const purge = async (collection: Created['collection'], ids: number[]) => {
    if (ids.length === 0) return

    const { errors } = await payload.delete({
      collection,
      overrideAccess: true,
      trash: true,
      where: { id: { in: ids } },
    })

    if (errors.length > 0) {
      throw new Error(
        `verify-concurrency could not clear an aborted run's ${collection}: ${JSON.stringify(errors)}`,
      )
    }
  }

  await purge(
    'orders',
    await idsOf(sql`SELECT "id" FROM "orders" WHERE "order_number" LIKE 'N1-VCC-%'`),
  )
  await purge(
    'carts',
    await idsOf(sql`SELECT "id" FROM "carts" WHERE "token" LIKE 'verify-concurrency-%'`),
  )
  await purge(
    'promotions',
    await idsOf(sql`SELECT "id" FROM "promotions" WHERE "code" ~ '^VCC[0-9]+$'`),
  )
  await purge(
    'product-variants',
    await idsOf(sql`SELECT "id" FROM "product_variants" WHERE "sku" LIKE 'VCC-%'`),
  )
  await purge(
    'products',
    await idsOf(sql`SELECT "id" FROM "products" WHERE "slug" LIKE 'verify-concurrency-%'`),
  )
  await purge(
    'users',
    await idsOf(sql`SELECT "id" FROM "users" WHERE "email" LIKE 'verify-concurrency-%'`),
  )
}

async function makeStock(label: string, quantity = 10) {
  const product = await payload.create({
    collection: 'products',
    data: {
      name: `Concurrency fixture ${suffix} ${label}`,
      slug: `${PREFIX}-${label}`.toLowerCase(),
      sortOrder: 9999,
      status: 'published',
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'products', id: product.id })

  const variant = await payload.create({
    collection: 'product-variants',
    data: {
      active: true,
      color: 'Bone',
      colorFamily: 'bone',
      colorHex: '#e8e4dc',
      inventoryQuantity: quantity,
      priceMinor: 5_000,
      product: product.id,
      size: 'M',
      sizeSortOrder: 30,
      sku: `VCC-${suffix}-${label}`,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'product-variants', id: variant.id })

  return { product, variant }
}

async function makeOrder(label: string, extra: Record<string, unknown> = {}) {
  const order = await payload.create({
    collection: 'orders',
    data: {
      currency: 'USD',
      discountMinor: 0,
      email: `${PREFIX}@example.test`,
      fulfillmentStatus: 'unfulfilled',
      orderNumber: `N1-VCC-${label}-${suffix}`,
      paymentStatus: 'pending_payment',
      shippingMinor: 0,
      stripeCheckoutSessionId: `cs_vcc_${label}_${suffix}`,
      subtotalMinor: 5_000,
      taxMinor: 0,
      totalMinor: 5_000,
      ...extra,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'orders', id: order.id })

  return order
}

async function makeCart(label: string) {
  const cart = await payload.create({
    collection: 'carts',
    data: {
      currency: 'USD',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'active',
      token: `${PREFIX}-${label}`,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'carts', id: cart.id })

  return cart
}

const variantRow = async (id: number) =>
  (
    await payload.db.drizzle.execute(
      sql`SELECT "inventory_quantity"::int AS "stock", "price_minor"::int AS "price", "size_sort_order"::int AS "sizeSortOrder", "color_hex" AS "colorHex"
          FROM "product_variants" WHERE "id" = ${id}`,
    )
  ).rows[0] as { colorHex: string; price: number; sizeSortOrder: number; stock: number }

const orderNow = (id: number) =>
  payload.findByID({ collection: 'orders', depth: 0, id, overrideAccess: true })

const productRow = async (id: number) =>
  (
    await payload.db.drizzle.execute(
      sql`SELECT "name", "status", "deleted_at" AS "deletedAt", "derived_inventory_total"::int AS "inventoryTotal"
          FROM "products" WHERE "id" = ${id}`,
    )
  ).rows[0] as { deletedAt: null | string; inventoryTotal: number; name: string; status: string }

const sellOne = (handle: TxHandle, variantId: number) =>
  handle.execute(
    sql`UPDATE "product_variants" SET "inventory_quantity" = "inventory_quantity" - 1
        WHERE "id" = ${variantId} AND "inventory_quantity" >= 1`,
  )

try {
  await clearAbortedRuns()

  const admin = await payload.create({
    collection: 'users',
    data: { email: `${PREFIX}-admin@example.test`, password: PASSWORD, role: 'admin' } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'users', id: admin.id })

  const adminUser = { ...admin, collection: 'users' } as TypedUser

  /* ======================================================== A — variant stock */

  {
    const { variant } = await makeStock('a')
    const variants = payload.collections['product-variants']

    /* A1 — the operation window, as a price edit from server code sends it: no stock at all. */
    const a1 = await underHeldWrite(
      (held) => sellOne(held.tx, variant.id),
      () =>
        payload.update({
          collection: 'product-variants',
          data: { priceMinor: 5_100 },
          id: variant.id,
          overrideAccess: true,
        }),
    )

    const afterA1 = await variantRow(variant.id)

    check('A1: a price edit is queued behind an uncommitted sale of the same variant', a1.queued)
    check(
      '**A1: a sale that commits under an in-flight variant save keeps its decrement** — before the lock the save wrote back 10',
      a1.outcome === 'done' && afterA1.stock === 9 && afterA1.price === 5_100,
      `${a1.outcome}, stock ${afterA1.stock}, price ${afterA1.price}`,
    )

    /* A2 — the operation window as the admin form sends it: Stock and its opened-with value, both 9. */
    const a2 = await underHeldWrite(
      (held) => sellOne(held.tx, variant.id),
      async () =>
        updateByIDOperation({
          collection: variants,
          data: { colorHex: '#e8e4dd', inventoryQuantity: 9, [STOCK_WHEN_OPENED]: 9 },
          id: variant.id,
          req: await restReq(adminUser),
        }),
    )

    const afterA2 = await variantRow(variant.id)

    check('A2: an admin form save is queued behind an uncommitted sale', a2.queued)
    check(
      '**A2: …and keeps the sale when it did not change Stock** — before the lock it wrote back the 9 it had read',
      a2.outcome === 'done' && afterA2.stock === 8 && afterA2.colorHex === '#e8e4dd',
      `${a2.outcome}, stock ${afterA2.stock}, swatch ${afterA2.colorHex}`,
    )

    /* A3 — the form window: the page was opened at 8, a sale has committed since, Stock untouched. */
    await sellOne(payload.db.drizzle as unknown as TxHandle, variant.id)

    const a3 = await settle(
      updateByIDOperation({
        collection: variants,
        data: { inventoryQuantity: 8, sizeSortOrder: 31, [STOCK_WHEN_OPENED]: 8 },
        id: variant.id,
        req: await restReq(adminUser),
      }),
    )

    const afterA3 = await variantRow(variant.id)

    check(
      '**A3: a form opened before a sale, saved without touching Stock, keeps the sale** — before the opened-with value it wrote back the 8 the page loaded',
      a3.outcome === 'done' && afterA3.stock === 7 && afterA3.sizeSortOrder === 31,
      `${a3.outcome}, stock ${afterA3.stock}, sizeSortOrder ${afterA3.sizeSortOrder}`,
    )

    /* A4 — the form window with a recount typed over a figure that has moved. */
    await sellOne(payload.db.drizzle as unknown as TxHandle, variant.id)

    const a4 = await settle(
      updateByIDOperation({
        collection: variants,
        data: { inventoryQuantity: 20, [STOCK_WHEN_OPENED]: 7 },
        id: variant.id,
        req: await restReq(adminUser),
      }),
    )

    const afterA4 = await variantRow(variant.id)

    check(
      '**A4: a changed Stock over a figure a sale has moved is refused, on the Stock field**',
      a4.outcome === 'ValidationError' &&
        (fieldMessage(a4.error) ?? '').includes('changed while you were editing') &&
        (a4.error as { data?: { errors?: { path?: string }[] } }).data?.errors?.[0]?.path ===
          'inventoryQuantity' &&
        afterA4.stock === 6,
      `${a4.outcome}: ${fieldMessage(a4.error)} — stock ${afterA4.stock}`,
    )

    /* A5 — a recount against the figure the editor saw is written. */
    const a5 = await settle(
      updateByIDOperation({
        collection: variants,
        data: { inventoryQuantity: 20, [STOCK_WHEN_OPENED]: 6 },
        id: variant.id,
        req: await restReq(adminUser),
      }),
    )

    check(
      'A5: a changed Stock over an unchanged figure is written — a stock take still works',
      a5.outcome === 'done' && (await variantRow(variant.id)).stock === 20,
      `${a5.outcome}, stock ${(await variantRow(variant.id)).stock}`,
    )

    /* A6 — callers with no opened-with value. */
    await payload.update({
      collection: 'product-variants',
      data: { inventoryQuantity: 15 },
      id: variant.id,
      overrideAccess: true,
    })

    check(
      'A6: an explicit count from the Local API with no opened-with value is written as sent',
      (await variantRow(variant.id)).stock === 15,
      String((await variantRow(variant.id)).stock),
    )

    const a6 = await settle(
      updateByIDOperation({
        collection: variants,
        data: { inventoryQuantity: 14 },
        id: variant.id,
        req: await restReq(adminUser),
      }),
    )

    check(
      'A6: …and so is one from a REST client that sends none',
      a6.outcome === 'done' && (await variantRow(variant.id)).stock === 14,
      `${a6.outcome}, stock ${(await variantRow(variant.id)).stock}`,
    )

    /* A7 — the virtual field. */
    const { rows: columns } = await payload.db.drizzle.execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'product_variants' AND column_name ILIKE '%when%opened%'`,
    )
    const read = await payload.findByID({
      collection: 'product-variants',
      depth: 0,
      id: variant.id,
      overrideAccess: true,
    })

    check(
      'A7: the opened-with value has no column, and every read fills it from Stock',
      columns.length === 0 &&
        (read as unknown as Record<string, unknown>)[STOCK_WHEN_OPENED] === read.inventoryQuantity,
      `${columns.length} column(s); read ${String((read as unknown as Record<string, unknown>)[STOCK_WHEN_OPENED])} / ${read.inventoryQuantity}`,
    )

    /* A8 — a REST caller that may not write locks nothing. */
    const holding = await holdTransaction()

    await sellOne(holding.tx, variant.id)

    const anonymous = settle(
      restReq().then((req) =>
        updateByIDOperation({
          collection: variants,
          data: { priceMinor: 1 },
          id: variant.id,
          req,
        }),
      ),
    )
    const anonymousSettled = await settlesWithin(anonymous)

    await holding.commit()

    check(
      'A8: an anonymous REST edit of a variant another transaction holds is refused without queueing on it',
      anonymousSettled && (await anonymous).outcome === 'Forbidden',
      anonymousSettled ? (await anonymous).outcome : 'still queued on the held row',
    )
  }

  /* ======================================================== B — orders */

  {
    const orders = payload.collections.orders

    /* B1 — a payment claim, with a stock-shortfall hold, against an editor adding a tracking number. */
    const paid = await makeOrder('B1')

    const b1 = await underHeldWrite(
      (held) =>
        held.tx.execute(
          sql`UPDATE "orders"
              SET "payment_status" = 'paid', "paid_at" = now(),
                  "stripe_payment_intent_id" = ${`pi_vcc_b1_${suffix}`},
                  "fulfilment_hold" = 'stockShortfall',
                  "shortfall" = '[{"available":0,"quantity":1,"variantId":1}]'::jsonb,
                  "updated_at" = now()
              WHERE "id" = ${paid.id}`,
        ),
      async () =>
        updateByIDOperation({
          collection: orders,
          data: { trackingNumber: `VCC-TRK-${suffix}` },
          id: paid.id,
          req: await restReq(adminUser),
        }),
    )

    const afterB1 = await orderNow(paid.id)

    check('B1: an admin order save is queued behind an uncommitted payment claim', b1.queued)
    check(
      '**B1: a payment that commits under an in-flight order save stays paid** — before the lock the save wrote back pending_payment',
      b1.outcome === 'done' &&
        afterB1.paymentStatus === 'paid' &&
        typeof afterB1.paidAt === 'string' &&
        afterB1.stripePaymentIntentId === `pi_vcc_b1_${suffix}` &&
        afterB1.trackingNumber === `VCC-TRK-${suffix}`,
      `${b1.outcome}, ${afterB1.paymentStatus}, paidAt ${String(afterB1.paidAt)}, pi ${String(afterB1.stripePaymentIntentId)}`,
    )
    check(
      'B1: …and so does the hold it recorded, with its shortfall',
      afterB1.fulfilmentHold === 'stockShortfall' && Array.isArray(afterB1.shortfall),
      `${String(afterB1.fulfilmentHold)}, ${JSON.stringify(afterB1.shortfall)}`,
    )

    /* B2 — a refund claim against server code (the Local API) editing the same order. */
    const b2 = await underHeldWrite(
      (held) =>
        held.tx.execute(
          sql`UPDATE "orders"
              SET "refunded_minor" = 5000, "refunded_at" = now(), "payment_status" = 'refunded',
                  "updated_at" = now()
              WHERE "id" = ${paid.id}`,
        ),
      () =>
        payload.update({
          collection: 'orders',
          data: { carrier: 'Royal Mail' },
          id: paid.id,
          overrideAccess: true,
        }),
    )

    const afterB2 = await orderNow(paid.id)

    check('B2: a Local API order write is queued behind an uncommitted refund claim', b2.queued)
    check(
      '**B2: a refund that commits under an in-flight order write is kept**',
      b2.outcome === 'done' &&
        afterB2.paymentStatus === 'refunded' &&
        afterB2.refundedMinor === 5_000 &&
        typeof afterB2.refundedAt === 'string' &&
        afterB2.carrier === 'Royal Mail',
      `${b2.outcome}, ${afterB2.paymentStatus}, refunded ${String(afterB2.refundedMinor)}`,
    )

    /* B3 — the form window: opened on an unpaid checkout, the payment lands, the editor cancels. */
    const abandoned = await makeOrder('B3')
    const opened = await orderNow(abandoned.id)

    await payload.db.drizzle.execute(
      sql`UPDATE "orders"
          SET "payment_status" = 'paid', "paid_at" = now(), "updated_at" = now()
          WHERE "id" = ${abandoned.id}`,
    )

    const b3 = await settle(
      updateByIDOperation({
        collection: orders,
        data: {
          email: opened.email,
          fulfillmentStatus: 'cancelled',
          paidAt: opened.paidAt ?? null,
          paymentStatus: opened.paymentStatus,
          totalMinor: opened.totalMinor,
        },
        id: abandoned.id,
        req: await restReq(adminUser),
      }),
    )

    const afterB3 = await orderNow(abandoned.id)

    check(
      '**B3: a cancel from a page opened before the payment is refused, on the status field**',
      b3.outcome === 'ValidationError' &&
        fieldMessage(b3.error) === PAID_CANCELLATION_COPY &&
        afterB3.paymentStatus === 'paid' &&
        afterB3.fulfillmentStatus === 'unfulfilled',
      `${b3.outcome}: ${fieldMessage(b3.error)} — ${afterB3.paymentStatus}/${afterB3.fulfillmentStatus}`,
    )

    const b3b = await settle(
      updateByIDOperation({
        collection: orders,
        data: {
          fulfillmentStatus: opened.fulfillmentStatus,
          paidAt: null,
          paymentStatus: 'pending_payment',
          trackingNumber: `VCC-B3-${suffix}`,
        },
        id: abandoned.id,
        req: await restReq(adminUser),
      }),
    )

    const afterB3b = await orderNow(abandoned.id)

    check(
      'B3: …while the same stale page saving a tracking number succeeds and leaves the payment as the webhook wrote it',
      b3b.outcome === 'done' &&
        afterB3b.paymentStatus === 'paid' &&
        typeof afterB3b.paidAt === 'string' &&
        afterB3b.trackingNumber === `VCC-B3-${suffix}`,
      `${b3b.outcome}, ${afterB3b.paymentStatus}, paidAt ${String(afterB3b.paidAt)}`,
    )

    /* B4 — the exemptions and the unpaid case stay as they were. */
    const unpaid = await makeOrder('B4')

    const b4 = await settle(
      updateByIDOperation({
        collection: orders,
        data: { fulfillmentStatus: 'cancelled' },
        id: unpaid.id,
        req: await restReq(adminUser),
      }),
    )

    check(
      'B4: the panel still cancels an unpaid order',
      b4.outcome === 'done' && (await orderNow(unpaid.id)).fulfillmentStatus === 'cancelled',
      b4.outcome,
    )

    const local = await makeOrder('B4L', { paymentStatus: 'paid' })

    const b4l = await settle(
      payload.update({
        collection: 'orders',
        data: { fulfillmentStatus: 'cancelled' },
        id: local.id,
        overrideAccess: false,
        user: adminUser,
      }),
    )

    check(
      'B4: a paid cancellation through the Local API is not refused by the panel rule (verify:admin A3)',
      b4l.outcome === 'done',
      b4l.outcome,
    )

    /* B5 — the lock is decided by the access rule: an anonymous REST write locks nothing. */
    const bystander = await makeOrder('B5')
    const holding = await holdTransaction()

    await holding.tx.execute(
      sql`UPDATE "orders" SET "updated_at" = now() WHERE "id" = ${bystander.id}`,
    )

    const pending = [
      settle(
        restReq().then((req) =>
          updateOperation({
            collection: orders,
            data: { trackingNumber: 'nope' },
            req,
            where: { id: { exists: true } },
          }),
        ),
      ),
      settle(
        restReq().then((req) =>
          updateByIDOperation({
            collection: orders,
            data: { trackingNumber: 'nope' },
            id: bystander.id,
            req,
          }),
        ),
      ),
    ]

    const bothSettled = (await Promise.all(pending.map((p) => settlesWithin(p)))).every(Boolean)

    await holding.commit()

    const outcomes = (await Promise.all(pending)).map((p) => p.outcome)

    check(
      'B5: anonymous REST `PATCH /api/orders?where[id][exists]=true` and `/api/orders/<id>` lock nothing and are refused',
      bothSettled && outcomes.every((outcome) => outcome === 'Forbidden'),
      bothSettled ? outcomes.join(', ') : 'still queued on the held order',
    )
  }

  /* ======================================================== C — promotions */

  {
    const promotion = await payload.create({
      collection: 'promotions',
      data: {
        active: true,
        code: `VCC${suffix}`,
        percentage: 10,
        type: 'percentage',
        usageLimit: 5,
      } as never,
      overrideAccess: true,
    })

    created.push({ collection: 'promotions', id: promotion.id })

    const redeem = (handle: TxHandle) =>
      handle.execute(
        sql`UPDATE "promotions" SET "times_used" = "times_used" + 1
            WHERE "id" = ${promotion.id} AND ("usage_limit" IS NULL OR "times_used" < "usage_limit")`,
      )

    const timesUsed = async () =>
      Number(
        (
          (
            await payload.db.drizzle.execute(
              sql`SELECT "times_used" FROM "promotions" WHERE "id" = ${promotion.id}`,
            )
          ).rows[0] as { times_used: number | string }
        ).times_used,
      )

    const c1 = await underHeldWrite(
      (held) => redeem(held.tx),
      async () =>
        updateByIDOperation({
          collection: payload.collections.promotions,
          data: { description: 'edited during a redemption' },
          id: promotion.id,
          req: await restReq(adminUser),
        }),
    )

    check('C1: a promotion save is queued behind an uncommitted redemption', c1.queued)
    check(
      '**C1: a redemption that commits under an in-flight promotion save is still counted**',
      c1.outcome === 'done' && (await timesUsed()) === 1,
      `${c1.outcome}, timesUsed ${await timesUsed()}`,
    )

    await redeem(payload.db.drizzle as unknown as TxHandle)

    const c2 = await settle(
      updateByIDOperation({
        collection: payload.collections.promotions,
        data: { description: 'saved from a stale page', timesUsed: 1 },
        id: promotion.id,
        req: await restReq(adminUser),
      }),
    )

    check(
      'C2: a form opened before a redemption cannot write its count back — field access refills it from the locked row',
      c2.outcome === 'done' && (await timesUsed()) === 2,
      `${c2.outcome}, timesUsed ${await timesUsed()}`,
    )
  }

  /* ======================================================== D — derived stock */

  {
    /* D1 — the post-sale refresh against an editor's unpublish. */
    const unpublishing = await makeStock('d1')

    await sellOne(payload.db.drizzle as unknown as TxHandle, unpublishing.variant.id)

    const d1 = await underHeldWrite(
      (held) =>
        payload.update({
          collection: 'products',
          data: { status: 'draft' },
          id: unpublishing.product.id,
          overrideAccess: true,
          req: held.req,
        }),
      () => recalculateProductDerived({ payload, productId: unpublishing.product.id }),
    )

    const afterD1 = await productRow(unpublishing.product.id)

    check('D1: a post-sale stock refresh is queued behind an uncommitted unpublish', d1.queued)
    check(
      '**D1: the refresh does not re-publish the product**, and still records the sale — before the fix it wrote back published',
      d1.outcome === 'done' && afterD1.status === 'draft' && afterD1.inventoryTotal === 9,
      `${d1.outcome}, ${afterD1.status}, inventoryTotal ${afterD1.inventoryTotal}`,
    )

    /* D2 — the same refresh against a move to the trash. */
    const trashing = await makeStock('d2')

    await sellOne(payload.db.drizzle as unknown as TxHandle, trashing.variant.id)

    const d2 = await underHeldWrite(
      (held) =>
        payload.update({
          collection: 'products',
          data: { deletedAt: new Date().toISOString() },
          id: trashing.product.id,
          overrideAccess: true,
          req: held.req,
        }),
      () => recalculateProductDerived({ payload, productId: trashing.product.id }),
    )

    const afterD2 = await productRow(trashing.product.id)

    check(
      'D2: a post-sale stock refresh is queued behind an uncommitted move to the trash',
      d2.queued,
    )
    check(
      '**D2: the refresh does not un-trash the product, and still refreshes its figure** — before the fix it put back deletedAt, or under the product lock failed on the trashed row',
      d2.outcome === 'done' && afterD2.deletedAt !== null && afterD2.inventoryTotal === 9,
      `${d2.outcome}, deletedAt ${String(afterD2.deletedAt)}, inventoryTotal ${afterD2.inventoryTotal}`,
    )

    /* D3 — the other direction: a refresh inside a variant's transaction against a product save. */
    const renaming = await makeStock('d3')

    await payload.db.drizzle.execute(
      sql`UPDATE "product_variants" SET "inventory_quantity" = 4 WHERE "id" = ${renaming.variant.id}`,
    )

    const d3 = await underHeldWrite(
      (held) =>
        recalculateProductDerived({ payload, productId: renaming.product.id, req: held.req }),
      async () =>
        updateByIDOperation({
          collection: payload.collections.products,
          data: { name: `Renamed ${suffix}` },
          id: renaming.product.id,
          req: await restReq(adminUser),
        }),
    )

    const afterD3 = await productRow(renaming.product.id)

    check('D3: a product save is queued behind an uncommitted derived refresh', d3.queued)
    check(
      '**D3: a refresh that commits under an in-flight product save keeps its figure**',
      d3.outcome === 'done' && afterD3.inventoryTotal === 4 && afterD3.name === `Renamed ${suffix}`,
      `${d3.outcome}, inventoryTotal ${afterD3.inventoryTotal}, name ${afterD3.name}`,
    )

    /* D4 — the ordinary path: a variant save still refreshes its product, in its own transaction. */
    await payload.update({
      collection: 'product-variants',
      data: { inventoryQuantity: 3, priceMinor: 4_200 },
      id: renaming.variant.id,
      overrideAccess: true,
    })

    const product = await payload.findByID({
      collection: 'products',
      depth: 0,
      id: renaming.product.id,
      overrideAccess: true,
    })

    check(
      'D4: a variant save still rebuilds its product’s derived price and stock',
      product.derived?.inventoryTotal === 3 && product.derived?.priceFromMinor === 4_200,
      JSON.stringify(product.derived),
    )
  }

  /* ======================================================== E — bags */

  {
    const promotionForBag = created.find((doc) => doc.collection === 'promotions')?.id ?? null

    /* E1 — applying a code (the shape of `applyPromotion`) against the payment converting the bag. */
    const bag = await makeCart('e1')

    const e1 = await underHeldWrite(
      (held) =>
        held.tx.execute(sql`UPDATE "carts" SET "status" = 'converted' WHERE "id" = ${bag.id}`),
      () =>
        payload.update({
          collection: 'carts',
          data: { promotion: promotionForBag },
          id: bag.id,
          overrideAccess: true,
        }),
    )

    const statusOf = async (id: number) =>
      (
        (await payload.db.drizzle.execute(sql`SELECT "status" FROM "carts" WHERE "id" = ${id}`))
          .rows[0] as { status: string }
      ).status

    check('E1: a Local API bag write is queued behind an uncommitted conversion', e1.queued)
    check(
      '**E1: a conversion that commits under an in-flight bag write stays converted** — before the lock the write reopened the paid bag',
      e1.outcome === 'done' && (await statusOf(bag.id)) === 'converted',
      `${e1.outcome}, ${await statusOf(bag.id)}`,
    )

    /* E2 — the form window: a page opened while the bag was active, saved after the payment. */
    const e2 = await settle(
      updateByIDOperation({
        collection: payload.collections.carts,
        data: { promotion: null, status: 'active' },
        id: bag.id,
        req: await restReq(adminUser),
      }),
    )

    check(
      '**E2: a save that sends `active` over a converted bag is refused, on the status field**',
      e2.outcome === 'ValidationError' &&
        fieldMessage(e2.error) === CONVERTED_BAG_COPY &&
        (await statusOf(bag.id)) === 'converted',
      `${e2.outcome}: ${fieldMessage(e2.error)} — ${await statusOf(bag.id)}`,
    )

    const e3 = await settle(
      payload.update({
        collection: 'carts',
        data: { promotion: null },
        id: bag.id,
        overrideAccess: true,
      }),
    )

    check(
      'E3: a write that does not mention the status still works on a converted bag, and leaves it converted',
      e3.outcome === 'done' && (await statusOf(bag.id)) === 'converted',
      `${e3.outcome}, ${await statusOf(bag.id)}`,
    )
  }
} finally {
  await cleanup()
}

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} concurrency checks passed.`,
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
  throw new Error(`${failed.length} concurrency check(s) failed.`)
}
