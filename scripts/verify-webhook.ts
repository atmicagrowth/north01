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
 * The **D-10** guard applies: it creates and deletes orders, variants, carts, promotions and events.
 */

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
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true, trash: false })
      .catch(() => undefined)
  }
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
      'G: §17.1h an event for an order this application does not hold is acknowledged, not crashed on',
      missing.outcome === 'noOrder',
      missing.outcome,
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
