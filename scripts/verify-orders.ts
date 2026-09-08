/**
 * **The order system — plan §18.**
 *
 * ```
 * pnpm verify:orders
 * ```
 *
 * The phase prompt names its own tests: *"Add tests for valid/invalid status transitions and
 * order-history immutability after product edits."* Both are here, and both are asserted twice — once
 * against the pure rules, where every edge can be enumerated, and once against the **real database**,
 * where the question is whether anything actually stops a write.
 *
 * The second half is the one that matters. Phase 17's second sweep found `paymentStatus` guarded by a
 * docblock and an admin description while the field itself accepted anything typed into it, so a rule
 * this phase only *stated* would be the same defect with a different column. Every refusal below is
 * therefore measured as a rejected write, not as a returned value.
 *
 * The **D-10** guard applies: it creates and deletes products, variants, orders and order lines.
 */

import type { Payload, TypedUser } from 'payload'

import config from '../src/payload.config'

import { applyStripeEvent } from '../src/lib/checkout/fulfil'
import { type PaymentStatus } from '../src/lib/checkout/rules'
import { developmentDatabase } from '../src/lib/env.core'
import {
  canFulfillmentTransition,
  DISPLAY_STATUS_COPY,
  displayStatus,
  FROZEN_ORDER_LINE_FIELDS,
  type FulfillmentStatus,
  frozenFieldsTouched,
  planFulfillmentChange,
  TERMINAL_FULFILLMENT_STATUSES,
} from '../src/lib/orders/rules'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-orders refuses to run: ${developmentDatabase.reason}. ` +
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

/** A write that is required to be rejected. Anything that resolves is a failure, not an error. */
async function refused(name: string, operation: () => Promise<unknown>, detail = '') {
  try {
    await operation()
    check(name, false, detail ? `${detail} — the write was accepted` : 'the write was accepted')
  } catch {
    check(name, true, detail)
  }
}

const payload: Payload = await getPayload({ config })

const created: {
  collection: 'customers' | 'order-items' | 'orders' | 'product-variants' | 'products' | 'users'
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
const PASSWORD = 'correct-horse-battery-staple'

const FULFILMENTS: FulfillmentStatus[] = [
  'cancelled',
  'delivered',
  'processing',
  'shipped',
  'unfulfilled',
]

const PAYMENTS: PaymentStatus[] = [
  'cancelled',
  'checkout_started',
  'draft',
  'paid',
  'payment_failed',
  'pending_payment',
  'refunded',
]

/* -------------------------------------------------------------------------------------------------
 * A — §18.1b's machine, every edge
 * ---------------------------------------------------------------------------------------------- */

{
  check(
    'A: delivered and cancelled are the only terminal states',
    TERMINAL_FULFILLMENT_STATUSES.length === 2 &&
      TERMINAL_FULFILLMENT_STATUSES.includes('cancelled') &&
      TERMINAL_FULFILLMENT_STATUSES.includes('delivered'),
    TERMINAL_FULFILLMENT_STATUSES.join(','),
  )

  /* The happy path §18.1b draws, one edge at a time. */
  check('A: unfulfilled → processing', canFulfillmentTransition('unfulfilled', 'processing'))
  check('A: processing → shipped', canFulfillmentTransition('processing', 'shipped'))
  check('A: shipped → delivered', canFulfillmentTransition('shipped', 'delivered'))

  /* And the four refusals the rules module argues for by name. */
  check(
    'A: **unfulfilled → shipped is refused** — nobody confirmed it could be picked',
    !canFulfillmentTransition('unfulfilled', 'shipped'),
  )
  check(
    'A: **shipped → processing is refused** — the dispatch notice cannot be unsent',
    !canFulfillmentTransition('shipped', 'processing'),
  )
  check(
    'A: **shipped → cancelled is refused** — after dispatch it is a return, not a cancellation',
    !canFulfillmentTransition('shipped', 'cancelled'),
  )
  check(
    'A: nothing leaves delivered or cancelled',
    FULFILMENTS.every(
      (to) =>
        !canFulfillmentTransition('delivered', to) && !canFulfillmentTransition('cancelled', to),
    ),
  )

  /*
   * Exhaustive: 25 ordered pairs, of which exactly the five edges above are legal. Written as a count
   * rather than as 25 assertions because the useful failure is "the machine grew an edge nobody
   * meant", and a count says that in one line.
   */
  const legal = FULFILMENTS.flatMap((from) =>
    FULFILMENTS.filter((to) => canFulfillmentTransition(from, to)).map((to) => `${from}→${to}`),
  )

  check(
    'A: exactly five edges exist across all 25 ordered pairs',
    legal.length === 5,
    legal.join(' '),
  )
}

/* -------------------------------------------------------------------------------------------------
 * B — where the two axes meet, §18.1b's PAID → PROCESSING and §18.1c's tracking
 * ---------------------------------------------------------------------------------------------- */

{
  const plan = (
    from: FulfillmentStatus,
    to: FulfillmentStatus,
    payment: PaymentStatus,
    carrier: null | string = null,
    trackingNumber: null | string = null,
  ) => planFulfillmentChange({ carrier, from, now: new Date(), payment, to, trackingNumber })

  const refusal = (...args: Parameters<typeof plan>) => {
    const answer = plan(...args)

    return answer.ok ? 'ok' : answer.reason
  }

  check(
    'B: **an unpaid order cannot be picked** — §18.1b starts the chain at PAID',
    refusal('unfulfilled', 'processing', 'pending_payment') === 'notPaid',
    refusal('unfulfilled', 'processing', 'pending_payment'),
  )

  check(
    'B: …and a paid one can',
    refusal('unfulfilled', 'processing', 'paid') === 'ok',
    refusal('unfulfilled', 'processing', 'paid'),
  )

  check(
    'B: **cancelling an unpaid order is ordinary, not an exception**',
    refusal('unfulfilled', 'cancelled', 'draft') === 'ok',
    refusal('unfulfilled', 'cancelled', 'draft'),
  )

  check(
    'B: §18.1c marking shipped with no carrier is refused',
    refusal('processing', 'shipped', 'paid', null, 'TRACK123') === 'trackingRequired',
  )

  check(
    'B: …no tracking number, likewise',
    refusal('processing', 'shipped', 'paid', 'Royal Mail', null) === 'trackingRequired',
  )

  check(
    'B: …and a tracking number of spaces is not a tracking number',
    refusal('processing', 'shipped', 'paid', 'Royal Mail', '   ') === 'trackingRequired',
  )

  const shipped = plan('processing', 'shipped', 'paid', 'Royal Mail', 'TRACK123')

  check(
    'B: with both, it ships **and stamps shippedAt**',
    shipped.ok && shipped.stamps.shippedAt !== null && shipped.stamps.deliveredAt === null,
  )

  const delivered = plan('shipped', 'delivered', 'refunded')

  check(
    'B: **DEV-03 case — a parcel refunded in transit can still be recorded as delivered**',
    delivered.ok && delivered.stamps.deliveredAt !== null,
    delivered.ok ? 'ok' : delivered.reason,
  )

  check(
    'B: a finished order refuses further steps before it complains about tracking',
    refusal('delivered', 'shipped', 'paid') === 'terminal',
    refusal('delivered', 'shipped', 'paid'),
  )

  check(
    'B: setting the status it already has is reported as unchanged, not as an error',
    refusal('processing', 'processing', 'paid') === 'unchanged',
  )

  check(
    'B: an illegal but non-terminal step is unreachable',
    refusal('unfulfilled', 'delivered', 'paid') === 'unreachable',
  )
}

/* -------------------------------------------------------------------------------------------------
 * C — DEV-03's derived single axis
 * ---------------------------------------------------------------------------------------------- */

{
  check(
    'C: DEV-03 every one of the 35 combinations derives a status with copy',
    PAYMENTS.every((payment) =>
      FULFILMENTS.every(
        (fulfilment) => DISPLAY_STATUS_COPY[displayStatus(payment, fulfilment)] !== undefined,
      ),
    ),
  )

  check(
    'C: **refunded after shipping reads as refunded** — the case one axis cannot hold',
    displayStatus('refunded', 'shipped') === 'refunded',
    displayStatus('refunded', 'shipped'),
  )

  check(
    'C: a cancelled fulfilment reads as cancelled whatever the payment says',
    PAYMENTS.filter((payment) => payment !== 'refunded').every(
      (payment) => displayStatus(payment, 'cancelled') === 'cancelled',
    ),
  )

  check(
    'C: fulfilment outranks payment once it has started',
    displayStatus('paid', 'processing') === 'processing' &&
      displayStatus('paid', 'shipped') === 'shipped' &&
      displayStatus('paid', 'delivered') === 'delivered',
  )

  check(
    'C: and payment answers while fulfilment has not started',
    displayStatus('pending_payment', 'unfulfilled') === 'pending_payment' &&
      displayStatus('payment_failed', 'unfulfilled') === 'payment_failed' &&
      displayStatus('paid', 'unfulfilled') === 'paid',
  )
}

/* -------------------------------------------------------------------------------------------------
 * D — §18.1d's frozen columns, as a decision
 * ---------------------------------------------------------------------------------------------- */

{
  check(
    'D: §18.1d names four columns and the frozen set is exactly those four',
    FROZEN_ORDER_LINE_FIELDS.length === 4 &&
      ['productName', 'sku', 'unitPriceMinor', 'variantLabel'].every((field) =>
        (FROZEN_ORDER_LINE_FIELDS as readonly string[]).includes(field),
      ),
    FROZEN_ORDER_LINE_FIELDS.join(','),
  )

  const before = { productName: 'Alpine Shell', sku: 'A-1', unitPriceMinor: 1000 }

  check(
    'D: re-submitting the same values is not a change — the panel posts every field on every save',
    frozenFieldsTouched(before, { ...before }).length === 0,
  )

  check(
    'D: a changed value is caught, and named',
    frozenFieldsTouched(before, { ...before, unitPriceMinor: 900 }).join(',') === 'unitPriceMinor',
  )

  check(
    'D: a field absent from the write is not a change',
    frozenFieldsTouched(before, { quantity: 2 } as Record<string, unknown>).length === 0,
  )
}

/* -------------------------------------------------------------------------------------------------
 * Fixtures for everything that touches the database
 * ---------------------------------------------------------------------------------------------- */

async function makeProduct(index: string) {
  const product = await payload.create({
    collection: 'products',
    /* `as never` matches the other harnesses — see `verify-webhook.ts`. */
    data: {
      name: `Orders fixture ${suffix}-${index}`,
      slug: `orders-fixture-${suffix}-${index}`,
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
      inventoryQuantity: 10,
      priceMinor: 5_000,
      product: product.id,
      size: 'M',
      sizeSortOrder: 30,
      sku: `ORD-${suffix}-${index}`,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'product-variants', id: variant.id })

  return { product, variant }
}

async function makeOrder(label: string, paymentStatus: PaymentStatus = 'pending_payment') {
  const order = await payload.create({
    collection: 'orders',
    data: {
      currency: 'USD',
      discountMinor: 0,
      email: 'orders@example.test',
      fulfillmentStatus: 'unfulfilled',
      orderNumber: `N1-ORD-${label}-${suffix}`,
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

const orderNow = async (id: number) =>
  payload.findByID({ collection: 'orders', depth: 0, id, overrideAccess: true })

/* -------------------------------------------------------------------------------------------------
 * The database half
 * ---------------------------------------------------------------------------------------------- */

try {
  /* ============================================ E — the hook refuses, on every path */
  {
    const order = await makeOrder('E')

    await refused('E: **a write cannot skip to delivered**, even with overrideAccess', () =>
      payload.update({
        collection: 'orders',
        data: { fulfillmentStatus: 'delivered' },
        id: order.id,
        overrideAccess: true,
      }),
    )

    await refused('E: an unpaid order cannot start processing', () =>
      payload.update({
        collection: 'orders',
        data: { fulfillmentStatus: 'processing' },
        id: order.id,
        overrideAccess: true,
      }),
    )

    check(
      'E: …and the status is untouched by a refused write',
      (await orderNow(order.id)).fulfillmentStatus === 'unfulfilled',
    )

    await payload.update({
      collection: 'orders',
      data: { paymentStatus: 'paid' },
      id: order.id,
      overrideAccess: true,
    })

    await payload.update({
      collection: 'orders',
      data: { fulfillmentStatus: 'processing' },
      id: order.id,
      overrideAccess: true,
    })

    check(
      'E: once paid, processing is allowed',
      (await orderNow(order.id)).fulfillmentStatus === 'processing',
    )

    await refused('E: §18.1c shipping without a carrier or tracking is refused', () =>
      payload.update({
        collection: 'orders',
        data: { fulfillmentStatus: 'shipped' },
        id: order.id,
        overrideAccess: true,
      }),
    )

    await payload.update({
      collection: 'orders',
      data: {
        carrier: 'Royal Mail',
        fulfillmentStatus: 'shipped',
        trackingNumber: `TRK${suffix}`,
      },
      id: order.id,
      overrideAccess: true,
    })

    const afterShipping = await orderNow(order.id)

    check(
      'E: carrier and tracking supplied in the same write are seen by the rule',
      afterShipping.fulfillmentStatus === 'shipped',
    )

    check(
      'E: **shippedAt is stamped by the transition**, not typed beside it',
      typeof afterShipping.shippedAt === 'string' && afterShipping.shippedAt.length > 0,
      String(afterShipping.shippedAt),
    )

    await refused('E: a shipped order cannot be cancelled — it is a return by then', () =>
      payload.update({
        collection: 'orders',
        data: { fulfillmentStatus: 'cancelled' },
        id: order.id,
        overrideAccess: true,
      }),
    )

    await payload.update({
      collection: 'orders',
      data: { fulfillmentStatus: 'delivered' },
      id: order.id,
      overrideAccess: true,
    })

    const afterDelivery = await orderNow(order.id)

    check('E: delivered, and stamped', typeof afterDelivery.deliveredAt === 'string')

    await refused('E: **delivered is terminal** — nothing follows it', () =>
      payload.update({
        collection: 'orders',
        data: { fulfillmentStatus: 'processing' },
        id: order.id,
        overrideAccess: true,
      }),
    )

    /*
     * The case that would make every finished order unsaveable if the hook treated an unchanged
     * status as a transition. The admin panel posts the whole document on every save.
     */
    await payload.update({
      collection: 'orders',
      data: { fulfillmentStatus: 'delivered', trackingNumber: `TRK${suffix}-corrected` },
      id: order.id,
      overrideAccess: true,
    })

    check(
      'E: a terminal order can still be corrected as long as the status does not move',
      (await orderNow(order.id)).trackingNumber === `TRK${suffix}-corrected`,
    )
  }

  /* ============================================ F — §18.1d against a real product edit */
  {
    const { product, variant } = await makeProduct('f')
    const order = await makeOrder('F', 'paid')

    const line = await payload.create({
      collection: 'order-items',
      data: {
        lineTotalMinor: 5_000,
        order: order.id,
        product: product.id,
        productName: 'Alpine Shell',
        quantity: 1,
        sku: `ORD-${suffix}-f`,
        unitPriceMinor: 5_000,
        variant: variant.id,
        variantLabel: 'Bone / M',
      } as never,
      overrideAccess: true,
    })

    created.push({ collection: 'order-items', id: line.id })

    /* The edit §18.1d is actually about: the product changes, months later. */
    await payload.update({
      collection: 'products',
      data: { name: `Renamed after purchase ${suffix}` },
      id: product.id,
      overrideAccess: true,
    })

    await payload.update({
      collection: 'product-variants',
      data: { priceMinor: 9_900, sku: `ORD-${suffix}-f-RESKU` },
      id: variant.id,
      overrideAccess: true,
    })

    const after = await payload.findByID({
      collection: 'order-items',
      depth: 0,
      id: line.id,
      overrideAccess: true,
    })

    check(
      'F: **§18.1d the product name on the receipt survives a rename**',
      after.productName === 'Alpine Shell',
      String(after.productName),
    )

    check(
      'F: …the price survives a repricing',
      after.unitPriceMinor === 5_000,
      String(after.unitPriceMinor),
    )

    check('F: …and the SKU survives a re-SKU', after.sku === `ORD-${suffix}-f`, String(after.sku))

    await refused('F: **the snapshot cannot be retyped either**, on any path', () =>
      payload.update({
        collection: 'order-items',
        data: { productName: 'Something else entirely' },
        id: line.id,
        overrideAccess: true,
      }),
    )

    await refused('F: …nor the unit price', () =>
      payload.update({
        collection: 'order-items',
        data: { unitPriceMinor: 1 },
        id: line.id,
        overrideAccess: true,
      }),
    )

    /* The pointers beside the snapshot are navigation and stay correctable — see OrderItems. */
    await payload.update({
      collection: 'order-items',
      data: { product: product.id, variant: variant.id },
      id: line.id,
      overrideAccess: true,
    })

    check(
      'F: the product and variant pointers are still editable — they are navigation, not data',
      true,
    )

    /* And the exception the schema was designed for: a per-line adjustment. */
    await payload.update({
      collection: 'order-items',
      data: { lineTotalMinor: 4_000 },
      id: line.id,
      overrideAccess: true,
    })

    check(
      'F: lineTotalMinor stays adjustable for a partial refund — the case OrderItems reserved it for',
      (
        await payload.findByID({
          collection: 'order-items',
          depth: 0,
          id: line.id,
          overrideAccess: true,
        })
      ).lineTotalMinor === 4_000,
    )
  }

  /* ============================================ G — §18.1b's PAID → REFUNDED, from Stripe */
  {
    const order = await makeOrder('G', 'paid')
    const intent = `pi_orders_${suffix}`

    await payload.update({
      collection: 'orders',
      data: { stripePaymentIntentId: intent },
      id: order.id,
      overrideAccess: true,
    })

    /*
     * **No order reference.** A `charge.refunded` event carries the charge's own metadata, which is
     * empty — so this is the shape the route now passes, and the payment intent is the only way back.
     */
    const refund = await applyStripeEvent(payload, {
      amountRefundedMinor: 5_000,
      eventType: 'charge.refunded',
      orderId: null,
      paymentIntentId: intent,
    })

    check(
      'G: **a refund with no order reference finds its order by payment intent**',
      refund.outcome === 'transitioned',
      refund.outcome,
    )

    const refunded = await orderNow(order.id)

    check('G: …the order is refunded', refunded.paymentStatus === 'refunded')
    check('G: …with the amount recorded', refunded.refundedMinor === 5_000)
    check('G: …and when', typeof refunded.refundedAt === 'string')

    const again = await applyStripeEvent(payload, {
      amountRefundedMinor: 5_000,
      eventType: 'charge.refunded',
      orderId: null,
      paymentIntentId: intent,
    })

    check(
      'G: a redelivered refund event changes nothing',
      again.outcome === 'alreadyFinal',
      again.outcome,
    )

    const unknown = await applyStripeEvent(payload, {
      amountRefundedMinor: 100,
      eventType: 'charge.refunded',
      orderId: null,
      paymentIntentId: `pi_orders_absent_${suffix}`,
    })

    check(
      'G: a refund for a payment intent this shop does not hold is acknowledged, not crashed on',
      unknown.outcome === 'noOrder',
      unknown.outcome,
    )
  }

  /* ============================================ H — the race Phase 17's sweeps did not reach */
  {
    const order = await makeOrder('H')

    /*
     * **A late failure racing the payment that succeeded.**
     *
     * Both events are legitimate and both are about this order: Stripe sends
     * `payment_intent.payment_failed` for a superseded attempt, and `checkout.session.completed` for
     * the one that worked. The old code read `pending_payment`, agreed `payment_failed` was a legal
     * step, and could write it **over** a payment that had just landed — the machine forbids
     * `paid → payment_failed` and the read never asked it about the row's real state.
     *
     * Both orderings now end at `paid`: whichever claims first, the other's conditional `UPDATE`
     * matches nothing. Asserted rather than argued, because sequential tests of this passed for two
     * whole phases.
     */
    const [first, second] = await Promise.all([
      applyStripeEvent(payload, {
        eventType: 'checkout.session.completed',
        orderId: order.id,
        paymentIntentId: `pi_orders_h_${suffix}`,
      }),
      applyStripeEvent(payload, {
        eventType: 'payment_intent.payment_failed',
        orderId: order.id,
        paymentIntentId: null,
      }),
    ])

    check(
      'H: **a concurrent late failure cannot un-pay an order**',
      (await orderNow(order.id)).paymentStatus === 'paid',
      `${first.outcome},${second.outcome} → ${(await orderNow(order.id)).paymentStatus}`,
    )

    /* And the sequential case still holds, in the other order. */
    const late = await applyStripeEvent(payload, {
      eventType: 'payment_intent.payment_failed',
      orderId: order.id,
      paymentIntentId: null,
    })

    check(
      'H: …and a later one is refused outright',
      late.outcome === 'alreadyFinal' && (await orderNow(order.id)).paymentStatus === 'paid',
      late.outcome,
    )
  }
  /* ============================================ I — §18.1c, server-side authorization */
  {
    /*
     * **§18.1c: *"Server-side authorization is required."***
     *
     * The admin panel talks to the same REST endpoints anybody else can, so a transition rule the
     * panel obeys and the API does not is a rule about one form. These run through `overrideAccess:
     * false`, which is the path a request takes, and prove the two halves separately: **who** may
     * attempt a transition (`Orders.access.update`, which is `isStaff`) and **which** transition is
     * legal (the hook). Both have to hold — a correctly authorised editor can still click Delivered
     * on an order nobody dispatched.
     */
    const staff = await payload.create({
      collection: 'users',
      data: { email: `verify-orders-${suffix}@example.test`, password: PASSWORD, role: 'editor' },
      overrideAccess: true,
    })

    created.push({ collection: 'users', id: staff.id })

    const shopper = await payload.create({
      collection: 'customers',
      data: {
        accountStatus: 'active',
        email: `verify-orders-shopper-${suffix}@example.test`,
        firstName: 'Verify',
        lastName: 'Orders',
        password: PASSWORD,
      },
      overrideAccess: true,
    })

    created.push({ collection: 'customers', id: shopper.id })

    const staffUser = { ...staff, collection: 'users' } as TypedUser
    const shopperUser = { ...shopper, collection: 'customers' } as TypedUser

    const order = await makeOrder('I', 'paid')

    await payload.update({
      collection: 'orders',
      data: { customer: shopper.id },
      id: order.id,
      overrideAccess: true,
    })

    await refused('I: an anonymous request cannot move an order', () =>
      payload.update({
        collection: 'orders',
        data: { fulfillmentStatus: 'processing' },
        id: order.id,
        overrideAccess: false,
      }),
    )

    await refused('I: **a customer cannot advance their own order**', () =>
      payload.update({
        collection: 'orders',
        data: { fulfillmentStatus: 'processing' },
        id: order.id,
        overrideAccess: false,
        user: shopperUser,
      }),
    )

    check(
      'I: …and neither attempt moved it',
      (await orderNow(order.id)).fulfillmentStatus === 'unfulfilled',
    )

    await payload.update({
      collection: 'orders',
      data: { fulfillmentStatus: 'processing' },
      id: order.id,
      overrideAccess: false,
      user: staffUser,
    })

    check(
      'I: staff can, which is what §18.1c authorises',
      (await orderNow(order.id)).fulfillmentStatus === 'processing',
    )

    await refused(
      'I: **but an authorised staff member still cannot skip to delivered** — both checks hold',
      () =>
        payload.update({
          collection: 'orders',
          data: { fulfillmentStatus: 'delivered' },
          id: order.id,
          overrideAccess: false,
          user: staffUser,
        }),
    )

    /*
     * Phase 17's second sweep closed this door on the payment axis. Re-asserted here as a staff
     * request rather than a server one, because that is the door it was actually open to.
     */
    await payload.update({
      collection: 'orders',
      data: { paymentStatus: 'refunded' },
      id: order.id,
      overrideAccess: false,
      user: staffUser,
    })

    check(
      'I: staff still cannot edit the payment status — only the Stripe webhook may',
      (await orderNow(order.id)).paymentStatus === 'paid',
      String((await orderNow(order.id)).paymentStatus),
    )

    const line = await payload.create({
      collection: 'order-items',
      data: {
        lineTotalMinor: 5_000,
        order: order.id,
        productName: 'Alpine Shell',
        quantity: 1,
        sku: `ORD-${suffix}-i`,
        unitPriceMinor: 5_000,
        variantLabel: 'Bone / M',
      } as never,
      overrideAccess: true,
    })

    created.push({ collection: 'order-items', id: line.id })

    await payload.update({
      collection: 'order-items',
      data: { productName: 'Not what was bought' },
      id: line.id,
      overrideAccess: false,
      user: staffUser,
    })

    check(
      'I: …and §18.1d a staff request cannot retype a purchase line either',
      (
        await payload.findByID({
          collection: 'order-items',
          depth: 0,
          id: line.id,
          overrideAccess: true,
        })
      ).productName === 'Alpine Shell',
    )
  }
} finally {
  await cleanup()
}

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} order checks passed.`,
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
  throw new Error(`${failed.length} order check(s) failed.`)
}
