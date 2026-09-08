/**
 * **The webhook, end to end, against the real database.**
 *
 * ```
 * pnpm verify:webhook
 * ```
 *
 * `verify-checkout.ts` exercises the *decisions*. This exercises the **effects**: a real order, real
 * order lines, real variants with real stock, and `applyStripeEvent` driven exactly as the route
 * drives it. It is the only place the two idempotency barriers, the transaction and the inventory
 * race can be observed doing what they claim.
 *
 * It does not go through the HTTP route, because that needs Stripe keys to verify a signature and
 * this repository has none. Signature verification is asserted separately and offline in
 * `verify-checkout.ts` section F; what is asserted here is everything the route does *after* it.
 *
 * The **D-10** guard applies: it creates and deletes orders, variants and events.
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
  collection: 'order-items' | 'orders' | 'product-variants' | 'products'
  id: number
}[] = []

const cleanup = async () => {
  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true, trash: false })
      .catch(() => undefined)
  }
}

const suffix = Date.now().toString().slice(-9)

/** A product and a variant with a known, small stock, so the race can be provoked exactly. */
async function makeStock(quantity: number, index: string) {
  const product = await payload.create({
    collection: 'products',
    /*
     * `as never` matches `verify-product.ts`: Payload's generated create type demands a `draft`
     * discriminant that this collection does not use, and the cast is the project's existing answer
     * rather than a new one invented here.
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

async function makeOrder(
  lines: { quantity: number; variantId: number; productId: number }[],
  label: string,
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
      subtotalMinor: 5_000,
      taxMinor: 0,
      totalMinor: 5_000,
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

const statusOf = async (orderId: number) => {
  const order = await payload.findByID({
    collection: 'orders',
    depth: 0,
    id: orderId,
    overrideAccess: true,
  })

  return {
    fulfillment: order.fulfillmentStatus,
    paidAt: order.paidAt ?? null,
    payment: order.paymentStatus,
    paymentIntent: order.stripePaymentIntentId ?? null,
  }
}

try {
  const { applyStripeEvent } = await import('../src/lib/checkout/fulfil')

  /* ============================================================ A — the ordinary path */
  {
    const { product, variant } = await makeStock(10, 'a')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 3, variantId: variant.id }],
      'A',
    )

    const before = await stockOf(variant.id)

    const outcome = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: `pi_wh_a_${suffix}`,
    })

    const after = await statusOf(order.id)

    check(
      'A: a completed session finalises the order',
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
      'A: …and fulfilment is left for a human rather than assumed',
      after.fulfillment === 'unfulfilled',
      String(after.fulfillment),
    )
  }

  /* ============================================================ B — §17.1d, the second barrier */
  {
    const { product, variant } = await makeStock(10, 'b')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 2, variantId: variant.id }],
      'B',
    )

    await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: `pi_wh_b_${suffix}`,
    })

    const afterFirst = await stockOf(variant.id)

    /*
     * A DIFFERENT event, describing the same payment. The unique event id would let this through —
     * it is a different id. Only the business-state guard stops it.
     */
    const second = await applyStripeEvent(payload, {
      eventType: 'checkout.session.async_payment_succeeded',
      orderId: order.id,
      paymentIntentId: `pi_wh_b_${suffix}`,
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

    /* And a third, and a fourth — an idempotent operation is idempotent every time, not once. */
    await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: `pi_wh_b_${suffix}`,
    })
    await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: `pi_wh_b_${suffix}`,
    })

    check(
      'B: …however many times it arrives',
      (await stockOf(variant.id)) === afterFirst,
      String(await stockOf(variant.id)),
    )
  }

  /* ============================================================ C — §17.1f, the race */
  {
    const { product, variant } = await makeStock(1, 'c')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 2, variantId: variant.id }],
      'C',
    )

    const outcome = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: `pi_wh_c_${suffix}`,
    })

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
      'C: …and left UNFULFILLED, which is the half §17.1f withholds',
      after.fulfillment === 'unfulfilled',
      String(after.fulfillment),
    )

    check(
      'C: …with stock untouched rather than driven negative',
      (await stockOf(variant.id)) === 1,
      String(await stockOf(variant.id)),
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

    await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: `pi_wh_d_${suffix}`,
    })

    check(
      'D: one short line leaves the OTHER line’s stock untouched — a partial order is not shipped',
      (await stockOf(a.variant.id)) === 10,
      String(await stockOf(a.variant.id)),
    )

    check('D: …and the short line too', (await stockOf(b.variant.id)) === 1)
  }

  /* ============================================================ E — §17.1h, failure states */
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
      'E: §17.1h a declined card moves the order to payment_failed',
      failed.outcome === 'transitioned',
    )
    check('E: …and takes no stock', (await stockOf(variant.id)) === 10)

    /* §17.1h: "card declined, then the customer tries again and succeeds." */
    const retried = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: `pi_wh_e_${suffix}`,
    })

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

    await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: `pi_wh_f_${suffix}`,
    })

    /* A late failure event for a superseded attempt must not un-pay a paid order. */
    const late = await applyStripeEvent(payload, {
      eventType: 'payment_intent.payment_failed',
      orderId: order.id,
      paymentIntentId: null,
    })

    check(
      'F: **a late failure event cannot un-pay a paid order**',
      late.outcome === 'alreadyFinal',
      late.outcome,
    )

    check('F: …and it is still paid', (await statusOf(order.id)).payment === 'paid')

    const expired = await applyStripeEvent(payload, {
      eventType: 'checkout.session.expired',
      orderId: order.id,
      paymentIntentId: null,
    })

    check(
      'F: …and a late expiry cannot cancel it either',
      expired.outcome === 'alreadyFinal' && (await statusOf(order.id)).payment === 'paid',
    )
  }

  /* ============================================================ G — §17.1h, invalid metadata */
  {
    const missing = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: 2_147_483_600,
      paymentIntentId: null,
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

    /*
     * **Two deliveries of one payment, in flight at the same instant.**
     *
     * This is the case Phase 17's first sweep found and the two barriers in §17.1d do not cover: a
     * status *check* is a read, and two transactions read the same row before either writes it. Both
     * passed, and the stock moved twice. The fix is a third barrier — the order is CLAIMED by a
     * conditional UPDATE rather than checked — and this is the check that holds it.
     */
    const [first, second] = await Promise.all([
      applyStripeEvent(payload, {
        eventType: 'checkout.session.completed',
        orderId: order.id,
        paymentIntentId: `pi_wh_h_${suffix}`,
      }),
      applyStripeEvent(payload, {
        eventType: 'checkout.session.async_payment_succeeded',
        orderId: order.id,
        paymentIntentId: `pi_wh_h_${suffix}`,
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
    )

    await payload.update({
      collection: 'orders',
      data: { paymentStatus: 'draft' },
      id: order.id,
      overrideAccess: true,
    })

    const outcome = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: null,
    })

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
    )

    await payload.update({
      collection: 'orders',
      data: { paymentStatus: 'refunded' },
      id: order.id,
      overrideAccess: true,
    })

    const outcome = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: null,
    })

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

    const outcome = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: null,
    })

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

    const outcome = await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: null,
    })

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

    await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: null,
    })

    check(
      'J: buying exactly the last unit takes stock to zero, never below',
      (await stockOf(variant.id)) === 0,
      String(await stockOf(variant.id)),
    )
  }

  /* ============================================================ K — §15's owed promotion counter */
  {
    const promotion = await payload.create({
      collection: 'promotions',
      data: {
        active: true,
        code: `WH${suffix}`,
        percentage: 10,
        timesUsed: 0,
        type: 'percentage',
      } as never,
      overrideAccess: true,
    })

    const { product, variant } = await makeStock(5, 'n')
    const order = await makeOrder(
      [{ productId: product.id, quantity: 1, variantId: variant.id }],
      'N',
    )

    await payload.update({
      collection: 'orders',
      data: { promotion: promotion.id },
      id: order.id,
      overrideAccess: true,
    })

    await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: null,
    })

    const after = await payload.findByID({
      collection: 'promotions',
      depth: 0,
      id: promotion.id,
      overrideAccess: true,
    })

    check(
      'K: §15 owed — `timesUsed` is incremented inside the payment transaction',
      after.timesUsed === 1,
      String(after.timesUsed),
    )

    await applyStripeEvent(payload, {
      eventType: 'checkout.session.completed',
      orderId: order.id,
      paymentIntentId: null,
    })

    const again = await payload.findByID({
      collection: 'promotions',
      depth: 0,
      id: promotion.id,
      overrideAccess: true,
    })

    check('K: …and not again on a duplicate event', again.timesUsed === 1, String(again.timesUsed))

    await payload
      .delete({ collection: 'promotions', id: promotion.id, overrideAccess: true })
      .catch(() => undefined)
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
