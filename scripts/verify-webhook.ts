/**
 * **The webhook, end to end, against the real database.**
 *
 * ```
 * pnpm verify:webhook
 * ```
 *
 * `verify-checkout.ts` exercises the *decisions*. This exercises the **effects**: a real order, real
 * order lines, real variants with real stock, and `applyStripeEvent` driven exactly as the route
 * drives it. It is the only place the idempotency barriers, the transaction and the inventory race
 * can be observed doing what they claim.
 *
 * It does not go through the HTTP route, because that needs Stripe keys to verify a signature and
 * this repository has none. Signature verification is asserted separately and offline in
 * `verify-checkout.ts` section F; what is asserted here is everything the route does *after* it,
 * including (Phase 36) the `stripe-events` bookkeeping the route uses to decide a redelivery.
 *
 * **Phase 36** gave every session event its session (`SessionFacts`): the id, amount, currency and
 * payment status the route reads from the Checkout Session. Every fixture order has a session id, and
 * `sessionOf` builds the matching facts — sections M to S then vary one fact at a time.
 *
 * **Sweep 1, S01** added section U: after a sale, the products' cached stock figure is recomputed by
 * `refreshDerivedStock`, which the route runs after its response — driven here with the same outcome.
 * Its recheck moved the route's whole after-response sequence into `afterStripeEvent`, which the route
 * calls and section U runs with stub couriers and tax clients: the refresh must happen through it, and
 * the tax record and the refresh must each finish while the other is still stuck.
 *
 * The **D-10** guard applies: it creates and deletes orders, variants, carts, promotions and events.
 */

import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import config from '../src/payload.config'

import { developmentDatabase } from '../src/lib/env.core'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-webhook refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes collection documents, so it may only touch the development database ' +
      'that DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const { getPayload } = await import('payload')

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

const payload: Payload = await getPayload({ config })

const created: {
  collection:
    | 'carts'
    | 'order-items'
    | 'orders'
    | 'product-variants'
    | 'products'
    | 'promotions'
    | 'stripe-events'
  id: number
}[] = []

const cleanup = async () => {
  /* The confirmations `fulfil.ts` queues inside the payment transaction (Phase 36 sweep 1). */
  const orderIds = created.filter((doc) => doc.collection === 'orders').map((doc) => doc.id)

  if (orderIds.length > 0) {
    await payload
      .delete({
        collection: 'email-messages',
        overrideAccess: true,
        where: { order: { in: orderIds } },
      })
      .catch(() => undefined)
  }

  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true, trash: true })
      .catch(() => undefined)
  }
}

/**
 * **What an aborted run left behind**, removed before this run starts.
 *
 * `cleanup` runs in `finally`, which a process that was killed — or hung on a lock and was stopped —
 * never reaches, so its orders, products, variants, carts, promotions and queued emails stayed in the
 * database; published fixture products then show up in anything that reads the catalogue. Every
 * fixture here is named with a prefix nothing else in the repository uses (`N1-WH-`, `webhook-fixture-`,
 * `WH-`, `wh-cart-`, `evt_wh_`, and `WH`/`WHC`/`WHRACE`/`WHLIMIT` followed by the run's digits), so
 * those names are what is cleared, in the same order `cleanup` deletes.
 */
async function clearAbortedRuns(): Promise<void> {
  const idsOf = async (query: ReturnType<typeof sql>) =>
    ((await payload.db.drizzle.execute(query)).rows as { id: number | string }[]).map((row) =>
      Number(row.id),
    )

  const orders = await idsOf(sql`SELECT "id" FROM "orders" WHERE "order_number" LIKE 'N1-WH-%'`)

  if (orders.length > 0) {
    await payload.delete({
      collection: 'email-messages',
      overrideAccess: true,
      where: { order: { in: orders } },
    })
  }

  const byIds = async (
    collection:
      'carts' | 'orders' | 'product-variants' | 'products' | 'promotions' | 'stripe-events',
    ids: number[],
  ) => {
    if (ids.length > 0) {
      await payload.delete({
        collection,
        overrideAccess: true,
        trash: true,
        where: { id: { in: ids } },
      })
    }
  }

  await byIds(
    'stripe-events',
    await idsOf(sql`SELECT "id" FROM "stripe_events" WHERE "event_id" LIKE 'evt_wh_%'`),
  )
  await byIds('orders', orders)
  await byIds('carts', await idsOf(sql`SELECT "id" FROM "carts" WHERE "token" LIKE 'wh-cart-%'`))
  await byIds(
    'promotions',
    await idsOf(sql`SELECT "id" FROM "promotions" WHERE "code" ~ '^WH(C|RACE|LIMIT)?[0-9]{6,}$'`),
  )
  await byIds(
    'product-variants',
    await idsOf(sql`SELECT "id" FROM "product_variants" WHERE "sku" LIKE 'WH-%'`),
  )
  await byIds(
    'products',
    await idsOf(sql`SELECT "id" FROM "products" WHERE "slug" LIKE 'webhook-fixture-%'`),
  )
}

const suffix = Date.now().toString().slice(-9)

type SessionFacts = {
  amountTotal: null | number
  currency: null | string
  id: string
  paymentStatus: null | string
}

/** The facts of the session an order is waiting on — the event a real payment produces. */
const sessionOf = (
  order: { stripeCheckoutSessionId?: null | string; totalMinor: number },
  paymentStatus: null | string = 'paid',
  overrides: Partial<SessionFacts> = {},
): SessionFacts => ({
  amountTotal: order.totalMinor,
  currency: 'usd',
  id: order.stripeCheckoutSessionId ?? 'cs_missing',
  paymentStatus,
  ...overrides,
})

/** A product and a variant with a known, small stock, so the race can be provoked exactly. */
async function makeStock(quantity: number, index: string) {
  const product = await payload.create({
    collection: 'products',
    /*
     * `as never` matches `verify-product.ts`: Payload's generated create type demands a `draft`
     * discriminant that this collection does not use, and the cast is the project's existing answer.
     */
    data: {
      name: `Webhook fixture ${suffix}-${index}`,
      slug: `webhook-fixture-${suffix}-${index}`,
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
      sku: `WH-${suffix}-${index}`,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'product-variants', id: variant.id })

  return { product, variant }
}

async function makeCart(label: string) {
  const cart = await payload.create({
    collection: 'carts',
    data: {
      currency: 'USD',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'active',
      token: `wh-cart-${label}-${suffix}`,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'carts', id: cart.id })

  return cart
}

async function makeOrder(
  lines: { quantity: number; variantId: number; productId: number }[],
  label: string,
  extra: Record<string, unknown> = {},
) {
  const order = await payload.create({
    collection: 'orders',
    data: {
      currency: 'USD',
      discountMinor: 0,
      email: 'webhook@example.test',
      fulfillmentStatus: 'unfulfilled',
      orderNumber: `N1-WH-${label}-${suffix}`,
      paymentStatus: 'pending_payment',
      shippingMinor: 0,
      stripeCheckoutSessionId: `cs_wh_${label}_${suffix}`,
      subtotalMinor: 5_000,
      taxMinor: 0,
      totalMinor: 5_000,
      ...extra,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'orders', id: order.id })

  for (const line of lines) {
    const item = await payload.create({
      collection: 'order-items',
      data: {
        lineTotalMinor: 5_000 * line.quantity,
        order: order.id,
        product: line.productId,
        productName: 'Webhook fixture',
        quantity: line.quantity,
        sku: `WH-${suffix}`,
        unitPriceMinor: 5_000,
        variant: line.variantId,
        variantLabel: 'Bone / M',
      } as never,
      overrideAccess: true,
    })

    created.push({ collection: 'order-items', id: item.id })
  }

  return order
}

const stockOf = async (variantId: number): Promise<number> => {
  const variant = await payload.findByID({
    collection: 'product-variants',
    depth: 0,
    id: variantId,
    overrideAccess: true,
  })

  return typeof variant.inventoryQuantity === 'number' ? variant.inventoryQuantity : -1
}

const orderNow = (orderId: number) =>
  payload.findByID({ collection: 'orders', depth: 0, id: orderId, overrideAccess: true })

const statusOf = async (orderId: number) => {
  const order = await orderNow(orderId)

  return {
    fulfillment: order.fulfillmentStatus,
    hold: order.fulfilmentHold ?? null,
    paidAt: order.paidAt ?? null,
    payment: order.paymentStatus,
    paymentIntent: order.stripePaymentIntentId ?? null,
    shortfall: order.shortfall ?? null,
  }
}

/** jsonb does not keep key order, so compare the lines field by field. */
const sameShortfall = (
  actual: unknown,
  expected: { available: number; quantity: number; variantId: number }[],
) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  expected.every((line, index) => {
    const got = actual[index] as Record<string, unknown>

    return (
      got.available === line.available &&
      got.quantity === line.quantity &&
      got.variantId === line.variantId
    )
  })

/** The `data` of the order confirmation the payment transaction queued, or `null` when there is none. */
const confirmationDataOf = async (orderId: number): Promise<null | Record<string, unknown>> => {
  const { docs } = await payload.find({
    collection: 'email-messages',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { and: [{ order: { equals: orderId } }, { kind: { equals: 'orderConfirmation' } }] },
  })

  const data = docs[0]?.data

  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null
}

const timesUsedOf = async (promotionId: number) =>
  (
    await payload.findByID({
      collection: 'promotions',
      depth: 0,
      id: promotionId,
      overrideAccess: true,
    })
  ).timesUsed

async function makePromotion(code: string, usageLimit: null | number = null) {
  const promotion = await payload.create({
    collection: 'promotions',
    data: {
      active: true,
      code,
      percentage: 10,
      timesUsed: 0,
      type: 'percentage',
      ...(usageLimit === null ? {} : { usageLimit }),
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'promotions', id: promotion.id })

  return promotion
}

await clearAbortedRuns()

try {
  const { applyStripeEvent } = await import('../src/lib/checkout/fulfil')
  const { isUniqueViolation, reclaimWebhookDelivery } = await import('../src/lib/checkout/events')
  const { decideDuplicateDelivery } = await import('../src/lib/checkout/rules')

  const pay = (order: Parameters<typeof sessionOf>[0] & { id: number }, pi: null | string = null) =>
    applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: pi,
      session: sessionOf(order),
    })

  /* ============================================================ A — the ordinary path */
  {
    const { product, variant } = await makeStock(10, 'a')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 3, variantId: variant.id }],
      'A',
    )

    const before = await stockOf(variant.id)
    const outcome = await pay(order, `pi_wh_a_${suffix}`)
    const after = await statusOf(order.id)

    check(
      'A: a completed, paid session finalises the order',
      outcome.outcome === 'finalised',
      outcome.outcome,
    )
    check('A: …marking it paid', after.payment === 'paid', String(after.payment))
    check('A: …stamping when', after.paidAt !== null)
    check('A: …and recording the payment intent', after.paymentIntent === `pi_wh_a_${suffix}`)

    check(
      'A: §17.1e inventory is adjusted — 10 less 3 is 7',
      (await stockOf(variant.id)) === before - 3,
      `${before} -> ${await stockOf(variant.id)}`,
    )

    check(
      'A: …fulfilment is left for a human, and no hold is set',
      after.fulfillment === 'unfulfilled' && (after.hold === 'none' || after.hold === null),
      `${after.fulfillment}/${after.hold}`,
    )

    const { totalDocs: confirmations } = await payload.find({
      collection: 'email-messages',
      depth: 0,
      limit: 0,
      overrideAccess: true,
      where: { and: [{ order: { equals: order.id } }, { kind: { equals: 'orderConfirmation' } }] },
    })

    check(
      'A: **sweep 1 the confirmation is queued inside the payment transaction** — one row, handed to the route',
      outcome.outcome === 'finalised' &&
        outcome.confirmationEmailId !== null &&
        confirmations === 1,
      `${outcome.outcome === 'finalised' ? outcome.confirmationEmailId : '-'} / ${confirmations} row(s)`,
    )

    const replay = await pay(order, `pi_wh_a_${suffix}`)
    const { totalDocs: afterReplay } = await payload.find({
      collection: 'email-messages',
      depth: 0,
      limit: 0,
      overrideAccess: true,
      where: { and: [{ order: { equals: order.id } }, { kind: { equals: 'orderConfirmation' } }] },
    })

    check(
      'A: …and its data says the order is not held — the receipt promises the order is being got ready',
      (await confirmationDataOf(order.id))?.onHold === false,
      JSON.stringify((await confirmationDataOf(order.id))?.onHold),
    )

    check(
      'A: …and a redelivery queues no second one',
      replay.outcome === 'alreadyFinal' && afterReplay === 1,
      `${replay.outcome} / ${afterReplay}`,
    )
  }

  /* ============================================================ B — §17.1d, the second barrier */
  {
    const { product, variant } = await makeStock(10, 'b')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 2, variantId: variant.id }],
      'B',
    )

    await pay(order, `pi_wh_b_${suffix}`)

    const afterFirst = await stockOf(variant.id)

    /* A DIFFERENT event, describing the same payment. Only the business-state guard stops it. */
    const second = await applyStripeEvent(payload, {
      eventType: 'checkout.session.async_payment_succeeded',
      orderId: order.id,
      paymentIntentId: `pi_wh_b_${suffix}`,
      session: sessionOf(order),
    })

    check(
      'B: **a second event for the same payment is refused** — the business-state barrier',
      second.outcome === 'alreadyFinal',
      second.outcome,
    )

    check(
      'B: …and inventory is NOT decremented twice',
      (await stockOf(variant.id)) === afterFirst,
      `${afterFirst} -> ${await stockOf(variant.id)}`,
    )

    await pay(order, `pi_wh_b_${suffix}`)
    await pay(order, `pi_wh_b_${suffix}`)

    check(
      'B: …however many times it arrives',
      (await stockOf(variant.id)) === afterFirst,
      String(await stockOf(variant.id)),
    )
  }

  /* ============================================================ C — §17.1f, the shortfall, held */
  {
    const { product, variant } = await makeStock(1, 'c')
    const cart = await makeCart('C')
    const promotion = await makePromotion(`WHC${suffix}`)
    const order = await makeOrder(
      [{ productId: product.id, quantity: 2, variantId: variant.id }],
      'C',
      { cart: cart.id, promotion: promotion.id },
    )

    const outcome = await pay(order, `pi_wh_c_${suffix}`)
    const after = await statusOf(order.id)

    check(
      'C: §17.1f an order that cannot be met from stock reports the shortfall',
      outcome.outcome === 'outOfStock',
      outcome.outcome,
    )

    check(
      'C: **it is still marked paid** — the money moved and the record must say so',
      after.payment === 'paid',
      String(after.payment),
    )

    check(
      'C: …left UNFULFILLED, which is the half §17.1f withholds',
      after.fulfillment === 'unfulfilled',
      String(after.fulfillment),
    )

    check(
      'C: **R3-19 it is held for a human** — fulfilmentHold is stockShortfall, with the detail',
      after.hold === 'stockShortfall' &&
        sameShortfall(after.shortfall, [{ available: 1, quantity: 2, variantId: variant.id }]),
      `${after.hold} ${JSON.stringify(after.shortfall)}`,
    )

    check(
      'C: …and the customer still gets the receipt for what they paid — queued in the transaction',
      outcome.outcome === 'outOfStock' && outcome.confirmationEmailId !== null,
    )

    /*
     * Sweep 1, S06: `queueOrderConfirmation` reads the order through the payment transaction's `req`,
     * so it must see the hold `finalisePaidOrder` wrote by raw SQL earlier in that same transaction —
     * before anything is committed. Queued before the hold, or through another connection, this is
     * `false`, and the held customer's receipt says their order is being got ready to send.
     */
    check(
      'C: **S06 the queued confirmation says the order is held** — `data.onHold` read inside the payment transaction',
      (await confirmationDataOf(order.id))?.onHold === true,
      JSON.stringify(await confirmationDataOf(order.id)),
    )

    check(
      'C: …with stock untouched rather than driven negative',
      (await stockOf(variant.id)) === 1,
      String(await stockOf(variant.id)),
    )

    const cartAfter = await payload.findByID({
      collection: 'carts',
      depth: 0,
      id: cart.id,
      overrideAccess: true,
    })

    check(
      'C: **R1-10 the bag is still converted** — the customer paid for it',
      cartAfter.status === 'converted',
      String(cartAfter.status),
    )

    check(
      'C: **R1-10 …and the code is still counted**, once',
      (await timesUsedOf(promotion.id)) === 1,
      String(await timesUsedOf(promotion.id)),
    )
  }

  /* ============================================================ D — §17.1f, all or nothing */
  {
    const a = await makeStock(10, 'd1')
    const b = await makeStock(1, 'd2')

    const order = await makeOrder(
      [
        { productId: a.product.id, quantity: 1, variantId: a.variant.id },
        { productId: b.product.id, quantity: 5, variantId: b.variant.id },
      ],
      'D',
    )

    await pay(order, `pi_wh_d_${suffix}`)

    check(
      'D: one short line leaves the OTHER line’s stock untouched — a partial order is not shipped',
      (await stockOf(a.variant.id)) === 10,
      String(await stockOf(a.variant.id)),
    )

    check('D: …and the short line too', (await stockOf(b.variant.id)) === 1)
  }

  /* ====================================== D2 — R1-10, the savepoint, provoked deterministically */
  {
    /*
     * The plan says the stock is there; the write then finds it gone. A second transaction takes
     * the last Y and **holds its row lock**, so the finalisation reads Y = 1 (the committed value),
     * plans both lines, decrements X, and blocks on Y. The lock is then released with Y at 0, the
     * blocked decrement re-checks its guard and matches nothing — and X must come back.
     *
     * Before Phase 36, X stayed decremented: the loop committed whatever it had done so far.
     */
    const x = await makeStock(5, 'd2x')
    const y = await makeStock(1, 'd2y')

    const order = await makeOrder(
      [
        { productId: x.product.id, quantity: 1, variantId: x.variant.id },
        { productId: y.product.id, quantity: 1, variantId: y.variant.id },
      ],
      'D2',
    )

    const { sql } = await import('@payloadcms/db-postgres')
    const rival = await payload.db.beginTransaction()

    if (rival === null) throw new Error('could not open the rival transaction')

    const rivalDb = (
      payload.db as unknown as {
        sessions: Record<string, { db: { execute: (query: unknown) => Promise<unknown> } }>
      }
    ).sessions[rival]!.db

    await rivalDb.execute(
      sql`UPDATE "product_variants" SET "inventory_quantity" = 0 WHERE "id" = ${y.variant.id}`,
    )

    const pending = pay(order, `pi_wh_d2_${suffix}`)

    await new Promise((resolve) => setTimeout(resolve, 2_500))
    await payload.db.commitTransaction(rival)

    const outcome = await pending

    check(
      'C: **R1-10 the ROLLBACK TO SAVEPOINT branch ran** — X was decremented, then Y failed mid-loop',
      outcome.outcome === 'outOfStock' && outcome.rolledBack,
      outcome.outcome === 'outOfStock' ? `rolledBack=${outcome.rolledBack}` : outcome.outcome,
    )

    check(
      'C: …and X’s decrement was undone — no partial pick',
      (await stockOf(x.variant.id)) === 5,
      `X ${await stockOf(x.variant.id)}`,
    )

    check(
      'C: …the shortfall records Y as requested 1, available 0 — and only Y',
      sameShortfall((await statusOf(order.id)).shortfall, [
        { available: 0, quantity: 1, variantId: y.variant.id },
      ]),
      JSON.stringify((await statusOf(order.id)).shortfall),
    )

    check(
      'C: …the order is paid and held',
      (await statusOf(order.id)).payment === 'paid' &&
        (await statusOf(order.id)).hold === 'stockShortfall',
    )

    check(
      'C: **S06 …and its confirmation, queued after the rollback to the savepoint, says it is held**',
      (await confirmationDataOf(order.id))?.onHold === true,
      JSON.stringify((await confirmationDataOf(order.id))?.onHold),
    )
  }

  /* ====================================== C3 — sweep 1, a bag gone before the payment lands */
  {
    const { product, variant } = await makeStock(5, 'c3')
    const cart = await makeCart('C3')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 1, variantId: variant.id }],
      'C3',
      { cart: cart.id },
    )

    /* The expired-bag sweep, or anything else, removes the cart first. */
    await payload.delete({ collection: 'carts', id: cart.id, overrideAccess: true, trash: false })

    const outcome = await pay(order, `pi_wh_c3_${suffix}`)

    check(
      'C: **sweep 1 a deleted bag does not roll the payment back** — paid, stock taken',
      outcome.outcome === 'finalised' &&
        (await statusOf(order.id)).payment === 'paid' &&
        (await stockOf(variant.id)) === 4,
      `${outcome.outcome} ${(await statusOf(order.id)).payment} stock ${await stockOf(variant.id)}`,
    )
  }

  /* ============================================================ E — §17.1h, a declined card */
  {
    const { product, variant } = await makeStock(10, 'e')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 1, variantId: variant.id }],
      'E',
    )

    const failed = await applyStripeEvent(payload, {
      eventType: 'payment_intent.payment_failed',
      orderId: order.id,
      paymentIntentId: null,
    })

    check(
      'E: **a declined card inside Checkout is recorded, and changes nothing** — the session is still payable',
      failed.outcome === 'recorded' && (await statusOf(order.id)).payment === 'pending_payment',
      `${failed.outcome} / ${(await statusOf(order.id)).payment}`,
    )
    check('E: …and takes no stock', (await stockOf(variant.id)) === 10)

    /* §17.1h: "card declined, then the customer tries again and succeeds." */
    const retried = await pay(order, `pi_wh_e_${suffix}`)

    check(
      'E: **a customer who retries after a decline can still pay**',
      retried.outcome === 'finalised',
      retried.outcome,
    )

    check('E: …and the stock moves then', (await stockOf(variant.id)) === 9)
  }

  /* ============================================================ F — §17.1h, a paid order is final */
  {
    const { product, variant } = await makeStock(10, 'f')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 1, variantId: variant.id }],
      'F',
    )

    await pay(order, `pi_wh_f_${suffix}`)

    const late = await applyStripeEvent(payload, {
      eventType: 'checkout.session.async_payment_failed',
      orderId: order.id,
      paymentIntentId: null,
      session: sessionOf(order, 'unpaid'),
    })

    check(
      'F: **a late failure event cannot un-pay a paid order**',
      late.outcome === 'alreadyFinal' && (await statusOf(order.id)).payment === 'paid',
      late.outcome,
    )

    const expired = await applyStripeEvent(payload, {
      eventType: 'checkout.session.expired',
      orderId: order.id,
      paymentIntentId: null,
      session: sessionOf(order, 'unpaid'),
    })

    check(
      'F: …and a late expiry cannot cancel it either',
      expired.outcome === 'alreadyFinal' && (await statusOf(order.id)).payment === 'paid',
      expired.outcome,
    )
  }

  /* ============================================================ G — §17.1h, invalid metadata */
  {
    const missing = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: 2_147_483_600,
      paymentIntentId: null,
      session: { amountTotal: 1, currency: 'usd', id: 'cs_nowhere', paymentStatus: 'paid' },
    })

    check(
      'G: §17.1h an event naming an order that does not exist is acknowledged, not crashed on — as `orderMissing`, with its reference',
      missing.outcome === 'orderMissing' && missing.reference === 2_147_483_600,
      missing.outcome,
    )

    const unreferenced = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: null,
      paymentIntentId: null,
      session: { amountTotal: 1, currency: 'usd', id: 'cs_nowhere', paymentStatus: 'paid' },
    })

    check(
      'G: …while one with no reference and no payment intent at all stays `noOrder`',
      unreferenced.outcome === 'noOrder',
      unreferenced.outcome,
    )

    const unknown = await applyStripeEvent(payload, {
      eventType: 'customer.subscription.updated',
      orderId: 1,
      paymentIntentId: null,
    })

    check(
      'G: §17.1h an unknown event type is ignored without touching anything',
      unknown.outcome === 'ignored',
      unknown.outcome,
    )
  }

  /* ============================================================ H — concurrency, found by sweep 1 */
  {
    const { product, variant } = await makeStock(5, 'h')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 2, variantId: variant.id }],
      'H',
    )

    /* Two deliveries of one payment, in flight at the same instant. Exactly one may claim. */
    const [first, second] = await Promise.all([
      pay(order, `pi_wh_h_${suffix}`),
      applyStripeEvent(payload, {
        eventType: 'checkout.session.async_payment_succeeded',
        orderId: order.id,
        paymentIntentId: `pi_wh_h_${suffix}`,
        session: sessionOf(order),
      }),
    ])

    const outcomes = [first.outcome, second.outcome].sort().join(',')

    check(
      'H: **two simultaneous events do not both finalise** — exactly one claims the order',
      outcomes === 'alreadyFinal,finalised',
      outcomes,
    )

    check(
      'H: …and stock moves exactly once, not twice',
      (await stockOf(variant.id)) === 3,
      String(await stockOf(variant.id)),
    )
  }

  /* ============================================================ I — states that cannot be paid */
  {
    const { product, variant } = await makeStock(5, 'i')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 1, variantId: variant.id }],
      'I',
      { paymentStatus: 'draft' },
    )

    const outcome = await pay(order)

    check(
      'I: **a draft order cannot be paid** — it never went through preflight',
      outcome.outcome === 'alreadyFinal',
      outcome.outcome,
    )

    check('I: …its status is untouched', (await statusOf(order.id)).payment === 'draft')
    check('I: …and no stock moved', (await stockOf(variant.id)) === 5)
  }

  {
    const { product, variant } = await makeStock(5, 'j')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 1, variantId: variant.id }],
      'J',
      { paymentStatus: 'refunded' },
    )

    const outcome = await pay(order)

    check(
      'I: a refunded order cannot be re-paid',
      outcome.outcome === 'alreadyFinal',
      outcome.outcome,
    )
    check('I: …and no stock moved', (await stockOf(variant.id)) === 5)
  }

  /* ============================================================ J — degenerate orders */
  {
    const order = await makeOrder([], 'K')
    const outcome = await pay(order)

    check(
      'J: an order with no lines finalises rather than throwing',
      outcome.outcome === 'finalised',
      outcome.outcome,
    )
  }

  {
    const { product, variant } = await makeStock(5, 'l')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 1, variantId: variant.id }],
      'L',
    )

    await payload.delete({
      collection: 'product-variants',
      id: variant.id,
      overrideAccess: true,
      trash: false,
    })

    const outcome = await pay(order)

    check(
      'J: a paid order whose variant was deleted does not crash the webhook',
      ['finalised', 'outOfStock'].includes(outcome.outcome),
      outcome.outcome,
    )

    check('J: …and is still marked paid', (await statusOf(order.id)).payment === 'paid')
  }

  {
    const { product, variant } = await makeStock(1, 'm')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 1, variantId: variant.id }],
      'M',
    )

    await pay(order)

    check(
      'J: buying exactly the last unit takes stock to zero, never below',
      (await stockOf(variant.id)) === 0,
      String(await stockOf(variant.id)),
    )
  }

  /* ============================================================ K — §15's owed promotion counter */
  {
    const promotion = await makePromotion(`WH${suffix}`)
    const { product, variant } = await makeStock(5, 'n')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 1, variantId: variant.id }],
      'N',
      { promotion: promotion.id },
    )

    await pay(order)

    check(
      'K: §15 owed — `timesUsed` is incremented inside the payment transaction',
      (await timesUsedOf(promotion.id)) === 1,
      String(await timesUsedOf(promotion.id)),
    )

    await pay(order)

    check(
      'K: …and not again on a duplicate event',
      (await timesUsedOf(promotion.id)) === 1,
      String(await timesUsedOf(promotion.id)),
    )
  }

  /* ====================================== L — the promotion counter's race, found by sweep 2 */
  {
    const promotion = await makePromotion(`WHRACE${suffix}`)
    const first = await makeStock(5, 'o')
    const second = await makeStock(5, 'p')

    const orders = await Promise.all([
      makeOrder([{ productId: first.product.id, quantity: 1, variantId: first.variant.id }], 'O', {
        promotion: promotion.id,
      }),
      makeOrder(
        [{ productId: second.product.id, quantity: 1, variantId: second.variant.id }],
        'P',
        { promotion: promotion.id },
      ),
    ])

    await Promise.all(orders.map((order) => pay(order)))

    check(
      'L: **two concurrent payments on one code both count** — an expression update, not `read + 1`',
      (await timesUsedOf(promotion.id)) === 2,
      String(await timesUsedOf(promotion.id)),
    )
  }

  /* ====================================== L2 — R1-07, the usage limit binds at payment */
  {
    const promotion = await makePromotion(`WHLIMIT${suffix}`, 1)
    const first = await makeStock(5, 'q')
    const second = await makeStock(5, 'r')

    const orders = await Promise.all([
      makeOrder([{ productId: first.product.id, quantity: 1, variantId: first.variant.id }], 'Q', {
        promotion: promotion.id,
      }),
      makeOrder(
        [{ productId: second.product.id, quantity: 1, variantId: second.variant.id }],
        'R',
        { promotion: promotion.id },
      ),
    ])

    const outcomes = await Promise.all(orders.map((order) => pay(order)))

    check(
      'L2: **R1-07 a code limited to one is counted once**, however many payments land on it',
      (await timesUsedOf(promotion.id)) === 1,
      String(await timesUsedOf(promotion.id)),
    )

    check(
      'L2: …and both payments still stand — the money moved at the discounted price',
      outcomes.every((outcome) => outcome.outcome === 'finalised'),
      outcomes.map((outcome) => outcome.outcome).join(','),
    )
  }

  /* ====================================== M — R1-01, a session that does not match its order */
  {
    const { product, variant } = await makeStock(5, 'mm')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 1, variantId: variant.id }],
      'MM',
    )

    const variants: [string, SessionFacts | null][] = [
      ['an older session id', sessionOf(order, 'paid', { id: `cs_wh_older_${suffix}` })],
      ['a different amount', sessionOf(order, 'paid', { amountTotal: 4_999 })],
      ['a different currency', sessionOf(order, 'paid', { currency: 'eur' })],
      ['no amount at all', sessionOf(order, 'paid', { amountTotal: null })],
      ['no session at all', null],
    ]

    for (const [label, session] of variants) {
      const outcome = await applyStripeEvent(payload, {
        eventType: 'checkout.session.completed',
        orderId: order.id,
        paymentIntentId: `pi_wh_mm_${label.length}_${suffix}`,
        session,
      })

      check(
        `M: **R1-01 a paid session with ${label} is a mismatch** — nothing applied`,
        outcome.outcome === 'mismatch' &&
          (await statusOf(order.id)).payment === 'pending_payment' &&
          (await stockOf(variant.id)) === 5,
        `${outcome.outcome}${outcome.outcome === 'mismatch' ? `: ${outcome.reason}` : ''}`,
      )
    }

    check(
      'M: …and no payment intent was recorded from any of them',
      (await statusOf(order.id)).paymentIntent === null,
    )

    check(
      'M: **sweep 1 the order is flagged paymentMismatch** — visible in Orders, status left alone',
      (await statusOf(order.id)).hold === 'paymentMismatch' &&
        (await statusOf(order.id)).payment === 'pending_payment',
      `${(await statusOf(order.id)).hold} / ${(await statusOf(order.id)).payment}`,
    )

    const real = await pay(order, `pi_wh_mm_real_${suffix}`)

    check(
      'M: …while the order’s own session still pays it',
      real.outcome === 'finalised' && (await stockOf(variant.id)) === 4,
      real.outcome,
    )

    const other = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: `pi_wh_mm_second_${suffix}`,
      session: sessionOf(order, 'paid', { id: `cs_wh_second_${suffix}` }),
    })

    check(
      'M: **a second session paying an already-paid order is a mismatch, not a duplicate** — a double charge',
      other.outcome === 'mismatch' && (await stockOf(variant.id)) === 4,
      other.outcome,
    )
  }

  /* ====================================== N — R1-01, an expiry for a superseded session */
  {
    const order = await makeOrder([], 'NN')

    const stale = await applyStripeEvent(payload, {
      eventType: 'checkout.session.expired',
      orderId: order.id,
      paymentIntentId: null,
      session: sessionOf(order, 'unpaid', { id: `cs_wh_superseded_${suffix}` }),
    })

    const after = await statusOf(order.id)

    check(
      'N: **R1-01 an expiry for a replaced session leaves the order untouched**',
      stale.outcome === 'superseded' &&
        after.payment === 'pending_payment' &&
        after.fulfillment === 'unfulfilled',
      `${stale.outcome} ${after.payment}/${after.fulfillment}`,
    )

    const failed = await applyStripeEvent(payload, {
      eventType: 'checkout.session.async_payment_failed',
      orderId: order.id,
      paymentIntentId: null,
      session: sessionOf(order, 'unpaid', { id: `cs_wh_superseded_${suffix}` }),
    })

    check(
      'N: …and so does a failure for one',
      failed.outcome === 'superseded' && (await statusOf(order.id)).payment === 'pending_payment',
      failed.outcome,
    )

    const current = await applyStripeEvent(payload, {
      eventType: 'checkout.session.expired',
      orderId: order.id,
      paymentIntentId: null,
      session: sessionOf(order, 'unpaid'),
    })

    check(
      'N: …while the current session’s expiry still cancels it',
      current.outcome === 'transitioned' && (await statusOf(order.id)).payment === 'cancelled',
      current.outcome,
    )
  }

  /* ====================================== O — R1-05, a delayed payment */
  {
    const { product, variant } = await makeStock(5, 'oo')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 1, variantId: variant.id }],
      'OO',
    )

    const completed = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: null,
      session: sessionOf(order, 'unpaid'),
    })

    check(
      'O: **R1-05 a completed but unpaid session waits** — pending, no stock, no confirmation',
      completed.outcome === 'awaitingPayment' &&
        (await statusOf(order.id)).payment === 'pending_payment' &&
        (await stockOf(variant.id)) === 5,
      completed.outcome,
    )

    const settled = await applyStripeEvent(payload, {
      eventType: 'checkout.session.async_payment_succeeded',
      orderId: order.id,
      paymentIntentId: `pi_wh_oo_${suffix}`,
      session: sessionOf(order, 'paid'),
    })

    check(
      'O: …and the async success then finalises it, taking the stock',
      settled.outcome === 'finalised' &&
        (await statusOf(order.id)).payment === 'paid' &&
        (await stockOf(variant.id)) === 4,
      settled.outcome,
    )

    const { product: p2, variant: v2 } = await makeStock(5, 'oo2')
    const bounced = await makeOrder([{ productId: p2.id, quantity: 1, variantId: v2.id }], 'OO2')

    await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: bounced.id,
      paymentIntentId: null,
      session: sessionOf(bounced, 'unpaid'),
    })

    const failed = await applyStripeEvent(payload, {
      eventType: 'checkout.session.async_payment_failed',
      orderId: bounced.id,
      paymentIntentId: null,
      session: sessionOf(bounced, 'unpaid'),
    })

    check(
      'O: …while an async failure moves it to payment_failed, with no stock taken',
      failed.outcome === 'transitioned' &&
        (await statusOf(bounced.id)).payment === 'payment_failed' &&
        (await stockOf(v2.id)) === 5,
      failed.outcome,
    )

    const free = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: bounced.id,
      paymentIntentId: null,
      session: sessionOf(bounced, 'no_payment_required'),
    })

    check(
      'O: a session that needed no payment is a mismatch — there are no free orders',
      free.outcome === 'mismatch',
      free.outcome,
    )
  }

  /* ====================================== T — the retention review, every claim restarts the clock */
  {
    /*
     * `updated_at` is the unpaid-order retention sweep's clock (`lib/cart/sweep.ts`). Payload stamps
     * it on Local API writes; `fulfil.ts`'s claims are raw SQL and used to leave it alone, so the
     * sweep measured thirty days from the preflight write even while a delayed payment was clearing.
     * Each fixture is put 400 days in the past with raw SQL (the Local API cannot backdate it) and
     * then driven through exactly one statement.
     */
    const longAgo = new Date(Date.now() - 400 * 86_400_000).toISOString()

    const backdate = (orderId: number) =>
      payload.db.drizzle.execute(
        sql`UPDATE "orders" SET "updated_at" = ${longAgo} WHERE "id" = ${orderId}`,
      )

    const updatedAtOf = async (orderId: number) =>
      new Date((await orderNow(orderId)).updatedAt).getTime()

    const touchedNow = async (orderId: number) =>
      (await updatedAtOf(orderId)) > Date.now() - 10 * 60_000

    const { product, variant } = await makeStock(5, 'tt')
    const lines = [{ productId: product.id, quantity: 1, variantId: variant.id }]

    /* The delayed-payment claim: `completed`, unpaid → `pending_payment`. */
    const waiting = await makeOrder(lines, 'TT1')

    await backdate(waiting.id)

    const awaited = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: waiting.id,
      paymentIntentId: null,
      session: sessionOf(waiting, 'unpaid'),
    })

    check(
      'T: **the delayed-payment claim bumps `updated_at`** — a clearing payment restarts the retention clock',
      awaited.outcome === 'awaitingPayment' && (await touchedNow(waiting.id)),
      `${awaited.outcome} ${new Date(await updatedAtOf(waiting.id)).toISOString()}`,
    )

    /* A transition claim: async failure → `payment_failed`, one raw statement and nothing else. */
    await backdate(waiting.id)

    const bounced = await applyStripeEvent(payload, {
      eventType: 'checkout.session.async_payment_failed',
      orderId: waiting.id,
      paymentIntentId: null,
      session: sessionOf(waiting, 'unpaid'),
    })

    check(
      'T: **a status transition claim bumps it**',
      bounced.outcome === 'transitioned' && (await touchedNow(waiting.id)),
      `${bounced.outcome} ${new Date(await updatedAtOf(waiting.id)).toISOString()}`,
    )

    /* A claim that matches nothing changes nothing, `updated_at` included. */
    const idle = await makeOrder(lines, 'TT2')

    await backdate(idle.id)

    const superseded = await applyStripeEvent(payload, {
      eventType: 'checkout.session.expired',
      orderId: idle.id,
      paymentIntentId: null,
      session: sessionOf(idle, 'unpaid', { id: `cs_wh_tt2_replaced_${suffix}` }),
    })

    check(
      'T: …while a claim that matches no row leaves it alone — only a real change restarts the clock',
      superseded.outcome === 'superseded' &&
        (await updatedAtOf(idle.id)) === new Date(longAgo).getTime(),
      `${superseded.outcome} ${new Date(await updatedAtOf(idle.id)).toISOString()}`,
    )

    /* The payment-mismatch hold. */
    const mismatched = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: idle.id,
      paymentIntentId: null,
      session: sessionOf(idle, 'paid', { id: `cs_wh_tt2_other_${suffix}` }),
    })

    check(
      'T: **the paymentMismatch hold write bumps it**',
      mismatched.outcome === 'mismatch' &&
        (await statusOf(idle.id)).hold === 'paymentMismatch' &&
        (await touchedNow(idle.id)),
      `${mismatched.outcome} ${new Date(await updatedAtOf(idle.id)).toISOString()}`,
    )

    /* The payment claim. */
    const paying = await makeOrder(lines, 'TT3')

    await backdate(paying.id)

    const finalised = await pay(paying, `pi_wh_tt3_${suffix}`)

    check(
      'T: **the payment claim bumps it**',
      finalised.outcome === 'finalised' && (await touchedNow(paying.id)),
      `${finalised.outcome} ${new Date(await updatedAtOf(paying.id)).toISOString()}`,
    )

    /* The refund claim. */
    await backdate(paying.id)

    const refunded = await applyStripeEvent(payload, {
      amountRefundedMinor: 1_000,
      eventType: 'charge.refunded',
      orderId: null,
      paymentIntentId: `pi_wh_tt3_${suffix}`,
    })

    check(
      'T: **the refund claim bumps it**',
      refunded.outcome === 'refunded' && (await touchedNow(paying.id)),
      `${refunded.outcome} ${new Date(await updatedAtOf(paying.id)).toISOString()}`,
    )

    /* The stock-shortfall hold, written in the payment transaction. */
    const { product: shortProduct, variant: shortVariant } = await makeStock(0, 'tt4')
    const short = await makeOrder(
      [{ productId: shortProduct.id, quantity: 1, variantId: shortVariant.id }],
      'TT4',
    )

    await backdate(short.id)

    /*
     * **The hold write is isolated, or this check cannot fail.** It runs in the payment's transaction
     * after the claim, and `now()` is the transaction's start time — so the claim's own bump used to
     * leave `updated_at` at "now" whether or not the hold statement set it. A `BEFORE UPDATE` trigger
     * scoped to this one order keeps the old `updated_at` on every statement that does not change
     * `fulfilment_hold`, so the claim cannot move the clock and the hold write is the only statement
     * that can. Created after the backdate (which it would otherwise undo), dropped in `finally`.
     */
    if (!Number.isSafeInteger(short.id)) {
      throw new Error(`T: unexpected order id ${String(short.id)}`)
    }

    const isolation = `verify_webhook_tt4_hold_${short.id}`

    try {
      await payload.db.drizzle.execute(
        sql.raw(`CREATE OR REPLACE FUNCTION "${isolation}"() RETURNS trigger LANGUAGE plpgsql AS $fn$
          BEGIN
            IF NEW."fulfilment_hold" IS NOT DISTINCT FROM OLD."fulfilment_hold" THEN
              NEW."updated_at" := OLD."updated_at";
            END IF;
            RETURN NEW;
          END
          $fn$`),
      )
      await payload.db.drizzle.execute(
        sql.raw(`CREATE TRIGGER "${isolation}" BEFORE UPDATE ON "orders"
          FOR EACH ROW WHEN (OLD."id" = ${short.id}) EXECUTE FUNCTION "${isolation}"()`),
      )

      /* The control: with the isolation live, a write that sets no hold cannot move the clock. */
      await payload.db.drizzle.execute(
        sql`UPDATE "orders" SET "updated_at" = now() WHERE "id" = ${short.id}`,
      )

      check(
        'T: (harness) the isolation holds — a write to the order that sets no hold leaves `updated_at` alone',
        (await updatedAtOf(short.id)) === new Date(longAgo).getTime(),
        new Date(await updatedAtOf(short.id)).toISOString(),
      )

      const oversold = await pay(short, `pi_wh_tt4_${suffix}`)

      check(
        'T: **the stockShortfall hold write bumps it**, measured apart from the payment claim in its transaction',
        oversold.outcome === 'outOfStock' &&
          (await statusOf(short.id)).hold === 'stockShortfall' &&
          (await touchedNow(short.id)),
        `${oversold.outcome} ${new Date(await updatedAtOf(short.id)).toISOString()}`,
      )
    } finally {
      await payload.db.drizzle.execute(sql.raw(`DROP TRIGGER IF EXISTS "${isolation}" ON "orders"`))
      await payload.db.drizzle.execute(sql.raw(`DROP FUNCTION IF EXISTS "${isolation}"()`))
    }

    /* A payment for an order that has been deleted, as the retention sweep deletes one. */
    const gone = await makeOrder([], 'TT5')

    await payload.delete({ collection: 'orders', id: gone.id, overrideAccess: true, trash: true })

    const late = await applyStripeEvent(payload, {
      eventType: 'checkout.session.async_payment_succeeded',
      orderId: gone.id,
      paymentIntentId: `pi_wh_tt5_${suffix}`,
      session: sessionOf(gone, 'paid'),
    })

    check(
      'T: **a payment for an order the sweep deleted is `orderMissing`**, named by its reference',
      late.outcome === 'orderMissing' && late.reference === gone.id,
      late.outcome,
    )
  }

  /* ====================================== S — R1-04, the stripe-events bookkeeping */
  {
    const makeEvent = async (label: string, status: string, receivedAt: Date) => {
      const row = await payload.create({
        collection: 'stripe-events',
        data: {
          attempts: 1,
          eventId: `evt_wh_${label}_${suffix}`,
          receivedAt: receivedAt.toISOString(),
          status,
          type: 'checkout.session.completed',
        } as never,
        overrideAccess: true,
      })

      created.push({ collection: 'stripe-events', id: row.id })

      return row
    }

    const failedRow = await makeEvent('failed', 'failed', new Date())

    const duplicate = await payload
      .create({
        collection: 'stripe-events',
        data: {
          attempts: 1,
          eventId: `evt_wh_failed_${suffix}`,
          receivedAt: new Date().toISOString(),
          status: 'received',
          type: 'checkout.session.completed',
        },
        overrideAccess: true,
      })
      .then(() => null)
      .catch((error: unknown) => error)

    check(
      'S: **R1-04 a second insert of one event id is recognised as a duplicate**',
      duplicate !== null && isUniqueViolation(duplicate),
      duplicate instanceof Error ? duplicate.message : String(duplicate),
    )

    const invalid = await payload
      .create({
        collection: 'stripe-events',
        data: { attempts: 1, eventId: `evt_wh_invalid_${suffix}`, status: 'received' } as never,
        overrideAccess: true,
      })
      .then((row) => {
        created.push({ collection: 'stripe-events', id: row.id })

        return null
      })
      .catch((error: unknown) => error)

    check(
      'S: …and any other insert failure is NOT — it becomes a 500 and Stripe retries',
      invalid !== null && !isUniqueViolation(invalid),
      invalid instanceof Error ? invalid.message : 'the invalid row was accepted',
    )

    check(
      'S: a failed delivery is reprocessed on redelivery',
      decideDuplicateDelivery({
        now: new Date(),
        receivedAt: failedRow.receivedAt,
        status: failedRow.status,
      }) === 'reprocess',
    )

    const claims = await Promise.all([
      reclaimWebhookDelivery(payload, failedRow.id),
      reclaimWebhookDelivery(payload, failedRow.id),
    ])

    const reclaimed = await payload.findByID({
      collection: 'stripe-events',
      depth: 0,
      id: failedRow.id,
      overrideAccess: true,
    })

    check(
      'S: **two simultaneous redeliveries reclaim a failed row exactly once**',
      claims.filter(Boolean).length === 1 &&
        reclaimed.status === 'received' &&
        reclaimed.attempts === 2,
      `${claims.join(',')} → ${reclaimed.status}, attempts ${reclaimed.attempts}`,
    )

    const fresh = await makeEvent('fresh', 'received', new Date())

    check(
      'S: a delivery another worker is still on is left alone — 409, retry later',
      decideDuplicateDelivery({
        now: new Date(),
        receivedAt: fresh.receivedAt,
        status: fresh.status,
      }) === 'retryLater' && !(await reclaimWebhookDelivery(payload, fresh.id)),
    )

    const stale = await makeEvent('stale', 'received', new Date(Date.now() - 5 * 60_000))

    check(
      'S: …but one that died mid-flight is reclaimed',
      await reclaimWebhookDelivery(payload, stale.id),
    )

    const done = await makeEvent('done', 'processed', new Date(Date.now() - 5 * 60_000))

    check(
      'S: a processed row is never reclaimed',
      !(await reclaimWebhookDelivery(payload, done.id)),
    )

    /*
     * **Reprocessing pays exactly once.** The first delivery finalised the order and then "failed"
     * (the row above). The reclaimed redelivery runs the same event again: the claim matches
     * nothing, the outcome says the order is already paid — which is what the route uses to
     * re-queue a possibly lost confirmation, deduplicated by its key — and the stock does not move.
     */
    const { product, variant } = await makeStock(5, 'ss')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 1, variantId: variant.id }],
      'SS',
    )

    await pay(order, `pi_wh_ss_${suffix}`)

    const replay = await pay(order, `pi_wh_ss_${suffix}`)

    check(
      'S: **a reprocessed payment event takes the stock exactly once**',
      replay.outcome === 'alreadyFinal' &&
        replay.status === 'paid' &&
        (await stockOf(variant.id)) === 4,
      `${replay.outcome}/${replay.outcome === 'alreadyFinal' ? replay.status : ''} stock ${await stockOf(variant.id)}`,
    )
  }

  /* ====================================== U — sweep 1 S01, the catalogue's stock figure follows a sale */
  {
    /*
     * The decrement is raw SQL, so no variant hook runs and `products.derived.inventoryTotal` — what
     * the shop cards, the in-stock filter, the homepage tiles and the search record read — kept the
     * pre-sale count forever. The route now runs `refreshDerivedStock` after its response; this
     * drives it exactly as the route does, with the outcome `applyStripeEvent` returned.
     *
     * Asserted against the column, not Algolia: the index sync is skipped outside Next by design.
     */
    const { refreshDerivedStock } = await import('../src/lib/checkout/fulfil')

    const derivedOf = async (productId: number) => {
      const product = await payload.findByID({
        collection: 'products',
        depth: 0,
        id: productId,
        overrideAccess: true,
      })

      return Number(product.derived?.inventoryTotal ?? Number.NaN)
    }

    /* The truth the figure is meant to mirror — every active variant's stock, summed. */
    const activeStockOf = async (productId: number) => {
      const { docs } = await payload.find({
        collection: 'product-variants',
        depth: 0,
        limit: 0,
        overrideAccess: true,
        pagination: false,
        where: { and: [{ product: { equals: productId } }, { active: { equals: true } }] },
      })

      return docs.reduce((total, variant) => total + (variant.inventoryQuantity ?? 0), 0)
    }

    const holdall = await makeStock(3, 'u1')
    const shell = await makeStock(4, 'u2')

    const shellLarge = await payload.create({
      collection: 'product-variants',
      data: {
        active: true,
        color: 'Bone',
        colorFamily: 'bone',
        colorHex: '#e8e4dc',
        inventoryQuantity: 6,
        priceMinor: 5_000,
        product: shell.product.id,
        size: 'L',
        sizeSortOrder: 40,
        sku: `WH-${suffix}-u2l`,
      } as never,
      overrideAccess: true,
    })

    created.push({ collection: 'product-variants', id: shellLarge.id })

    const order = await makeOrder(
      [
        { productId: holdall.product.id, quantity: 3, variantId: holdall.variant.id },
        { productId: shell.product.id, quantity: 1, variantId: shell.variant.id },
      ],
      'U',
    )

    check(
      'U: the fixture starts in step — 3 and 10',
      (await derivedOf(holdall.product.id)) === 3 && (await derivedOf(shell.product.id)) === 10,
      `${await derivedOf(holdall.product.id)} / ${await derivedOf(shell.product.id)}`,
    )

    const outcome = await pay(order, `pi_wh_u_${suffix}`)

    await refreshDerivedStock(payload, outcome)

    check(
      'U: **S01 buying the last three makes the product’s cached stock 0** — the card says sold out',
      outcome.outcome === 'finalised' &&
        (await derivedOf(holdall.product.id)) === 0 &&
        (await activeStockOf(holdall.product.id)) === 0,
      `${outcome.outcome}: derived ${await derivedOf(holdall.product.id)}, variants ${await activeStockOf(holdall.product.id)}`,
    )

    check(
      'U: **…and every product in the order is refreshed to the sum of its active variants** — 3 + 6',
      (await derivedOf(shell.product.id)) === 9 &&
        (await derivedOf(shell.product.id)) === (await activeStockOf(shell.product.id)),
      `derived ${await derivedOf(shell.product.id)}, variants ${await activeStockOf(shell.product.id)}`,
    )

    /* Stale on purpose, by raw SQL — the state every paid order left behind before S01. */
    const staleHoldall = sql`UPDATE "products" SET "derived_inventory_total" = 99 WHERE "id" = ${holdall.product.id}`

    await payload.db.drizzle.execute(staleHoldall)

    await refreshDerivedStock(payload, {
      orderId: order.id,
      outcome: 'alreadyFinal',
      status: 'paid',
    })
    await refreshDerivedStock(payload, {
      confirmationEmailId: null,
      orderId: order.id,
      outcome: 'outOfStock',
      rolledBack: false,
      short: [],
    })

    check(
      'U: only a `finalised` outcome refreshes — no other outcome moved stock, so none reads anything',
      (await derivedOf(holdall.product.id)) === 99,
      String(await derivedOf(holdall.product.id)),
    )

    await refreshDerivedStock(payload, outcome)
    await refreshDerivedStock(payload, outcome)

    check(
      'U: …and it recomputes rather than subtracts — a stale figure is corrected, and running it twice changes nothing',
      (await derivedOf(holdall.product.id)) === 0 && (await derivedOf(shell.product.id)) === 9,
      `${await derivedOf(holdall.product.id)} / ${await derivedOf(shell.product.id)}`,
    )

    /*
     * **A refresh that fails cannot touch the payment, and does not stop the others.** One product's
     * update is made to throw; the order is already paid, the call returns normally, and the other
     * product in the same order is still refreshed.
     */
    const broken = await makeStock(5, 'u3')
    const healthy = await makeStock(5, 'u4')
    const brokenOrder = await makeOrder(
      [
        { productId: broken.product.id, quantity: 2, variantId: broken.variant.id },
        { productId: healthy.product.id, quantity: 2, variantId: healthy.variant.id },
      ],
      'U3',
    )

    const brokenOutcome = await pay(brokenOrder, `pi_wh_u3_${suffix}`)

    const flaky = Object.create(payload) as Payload

    flaky.update = ((args: { collection: string; id?: unknown }) =>
      args.collection === 'products' && args.id === broken.product.id
        ? Promise.reject(new Error('Injected: the product could not be written.'))
        : payload.update(args as never)) as never

    const threw = await refreshDerivedStock(flaky, brokenOutcome).then(
      () => false,
      () => true,
    )

    check(
      'U: **a failed refresh never throws** — the route’s after-response work carries on',
      !threw,
    )

    check(
      'U: …the order stays paid, and the stock the sale took stays taken',
      brokenOutcome.outcome === 'finalised' &&
        (await statusOf(brokenOrder.id)).payment === 'paid' &&
        (await stockOf(broken.variant.id)) === 3,
      `${brokenOutcome.outcome} ${(await statusOf(brokenOrder.id)).payment} stock ${await stockOf(broken.variant.id)}`,
    )

    check(
      'U: …the product that failed keeps its old figure, and the other product is still refreshed',
      (await derivedOf(broken.product.id)) === 5 && (await derivedOf(healthy.product.id)) === 3,
      `${await derivedOf(broken.product.id)} / ${await derivedOf(healthy.product.id)}`,
    )

    /*
     * **The route's own after-response work — the recheck of S01.** Everything above calls
     * `refreshDerivedStock` directly, so deleting the route's call to it passed every check. The route
     * now hands its whole sequence to `afterStripeEvent`, run here with the dependencies the route
     * would pass replaced: no courier (so nothing is sent and the shared email queue is not drained),
     * and a tax client that records what it was asked.
     */
    const { afterStripeEvent } = await import('../src/lib/checkout/after-stripe-event')

    type TaxCall = { calculation: string; reference: string }

    const taxClientFor = (onCall: (params: TaxCall) => Promise<{ id: string }>) => () => ({
      tax: { transactions: { createFromCalculation: onCall } },
    })

    const noCourier = () => Promise.resolve(null)

    /** The pool's state for a failure's detail — total / idle / waiting clients. */
    const poolNow = () => {
      const pool = (
        payload.db as unknown as {
          pool?: { idleCount: number; totalCount: number; waitingCount: number }
        }
      ).pool

      return pool ? `pool ${pool.totalCount}/${pool.idleCount}/${pool.waitingCount}` : 'pool ?'
    }

    /**
     * Poll until `condition` holds, or give up — the steps run concurrently, so nothing to await.
     *
     * U5 and U6 hold one step back until the other has happened, so the ceiling only decides how long
     * a broken (sequential) implementation takes to fail: a concurrent one gets there in milliseconds,
     * and a sequential one never does, however long it is given. It is a minute rather than seconds
     * because one run stalled for 15 s — the pool's connection timeout — and a check about ordering
     * must not mistake a stall for one step waiting on the other.
     */
    const ORDERING_CEILING_MS = 60_000

    const eventually = async (
      condition: () => Promise<boolean> | boolean,
      timeoutMs = ORDERING_CEILING_MS,
    ) => {
      const deadline = Date.now() + timeoutMs

      while (Date.now() < deadline) {
        if (await condition()) return true

        await new Promise((resolve) => setTimeout(resolve, 25))
      }

      return false
    }

    /* ---- U4: the route's sequence refreshes the figure, and records the tax */
    {
      const sold = await makeStock(2, 'u5')
      const routed = await makeOrder(
        [{ productId: sold.product.id, quantity: 2, variantId: sold.variant.id }],
        'U4',
        { taxCalculationId: `taxcalc_wh_u4_${suffix}` },
      )

      const routedOutcome = await pay(routed, `pi_wh_u4_${suffix}`)
      const taxCalls: TaxCall[] = []

      const finished = await afterStripeEvent(payload, `evt_wh_u4_${suffix}`, routedOutcome, {
        courier: noCourier,
        taxClient: taxClientFor((params) => {
          taxCalls.push(params)

          return Promise.resolve({ id: `tax_wh_u4_${suffix}` })
        }),
      }).then(
        () => true,
        () => false,
      )

      check(
        'U: **the route’s after-response work refreshes the cached stock** — `afterStripeEvent` sold out the product',
        finished &&
          routedOutcome.outcome === 'finalised' &&
          (await derivedOf(sold.product.id)) === 0,
        `${routedOutcome.outcome}: derived ${await derivedOf(sold.product.id)}`,
      )

      check(
        'U: …and records the paid order’s tax transaction, referenced by its order number',
        taxCalls.length === 1 &&
          taxCalls[0]?.calculation === `taxcalc_wh_u4_${suffix}` &&
          taxCalls[0]?.reference === routed.orderNumber,
        JSON.stringify(taxCalls),
      )
    }

    /* ---- U5: a tax record that never answers does not hold the refresh back */
    {
      const sold = await makeStock(3, 'u6')
      const routed = await makeOrder(
        [{ productId: sold.product.id, quantity: 3, variantId: sold.variant.id }],
        'U5',
        { taxCalculationId: `taxcalc_wh_u5_${suffix}` },
      )

      const routedOutcome = await pay(routed, `pi_wh_u5_${suffix}`)

      const tax: { answered: boolean; release: (() => void) | null } = {
        answered: false,
        release: null,
      }

      const running = afterStripeEvent(payload, `evt_wh_u5_${suffix}`, routedOutcome, {
        courier: noCourier,
        taxClient: taxClientFor(
          () =>
            new Promise((resolve) => {
              tax.release = () => {
                tax.answered = true
                resolve({ id: `tax_wh_u5_${suffix}` })
              }
            }),
        ),
      })

      const refreshedWhileTaxStuck = await eventually(
        async () => tax.release !== null && (await derivedOf(sold.product.id)) === 0,
      )

      check(
        'U: **the refresh does not wait for the tax record** — the product sold out while Stripe Tax had not answered',
        refreshedWhileTaxStuck && !tax.answered,
        `derived ${await derivedOf(sold.product.id)}, tax ${tax.release === null ? 'not called' : tax.answered ? 'answered' : 'pending'}, ${poolNow()}`,
      )

      await eventually(() => tax.release !== null, 5_000)
      tax.release?.()
      await running
    }

    /* ---- U6: a refresh stuck on a slow index write does not hold the tax record back */
    {
      const sold = await makeStock(4, 'u7')
      const routed = await makeOrder(
        [{ productId: sold.product.id, quantity: 1, variantId: sold.variant.id }],
        'U6',
        { taxCalculationId: `taxcalc_wh_u6_${suffix}` },
      )

      const routedOutcome = await pay(routed, `pi_wh_u6_${suffix}`)

      /* The product write — where the Algolia upsert happens under Next — hangs until released. */
      let releaseProduct: () => void = () => undefined
      const productGate = new Promise<void>((resolve) => {
        releaseProduct = resolve
      })

      const slowIndex = Object.create(payload) as Payload

      slowIndex.update = (async (args: { collection: string; id?: unknown }) => {
        if (args.collection === 'products' && args.id === sold.product.id) {
          await productGate
        }

        return payload.update(args as never)
      }) as never

      const tax = { called: false }

      const running = afterStripeEvent(slowIndex, `evt_wh_u6_${suffix}`, routedOutcome, {
        courier: noCourier,
        taxClient: taxClientFor(() => {
          tax.called = true

          return Promise.resolve({ id: `tax_wh_u6_${suffix}` })
        }),
      })

      const taxWhileRefreshStuck = await eventually(() => tax.called)
      const stillStale = (await derivedOf(sold.product.id)) === 4
      const poolAtDecision = poolNow()

      releaseProduct()
      await running

      check(
        'U: **the tax record does not wait for the refresh** — recorded while the product write was still stuck',
        taxWhileRefreshStuck && stillStale,
        `tax ${taxWhileRefreshStuck ? 'recorded while the write was stuck' : 'not recorded until the write was released'}, derived then ${stillStale ? 'still 4' : 'already moved'}, ${poolAtDecision}`,
      )

      check(
        'U: …and the stuck refresh still lands once the write is released',
        (await derivedOf(sold.product.id)) === 3,
        String(await derivedOf(sold.product.id)),
      )
    }
  }
} finally {
  await cleanup()
}

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} webhook checks passed.`,
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
  throw new Error(`${failed.length} webhook check(s) failed.`)
}
