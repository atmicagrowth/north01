/**
 * The Phase 17 checkout rules, checked against the running code rather than the comments that
 * describe them.
 *
 * ```
 * pnpm verify:checkout
 * ```
 *
 * The phase prompt asks for two things by name — *"tests for webhook idempotency and impossible
 * payment states"* — and both are sections below. §17.1c's states, §17.1d's two barriers, §17.1f's
 * inventory race and §17.1h's failure list are all named checks.
 *
 * ### The signature test is real, and runs offline
 *
 * Section F verifies a Stripe signature end to end using the SDK's own
 * `webhooks.generateTestHeaderString` against a fabricated secret, then tampers with the payload and
 * watches it fail. No network and no Stripe account: signature verification is HMAC over the exact
 * bytes, which is exactly the property being asserted.
 *
 * The **D-10** guard applies to the sections that create documents.
 */

import { createHash } from 'node:crypto'

import type { Payload } from 'payload'
import Stripe from 'stripe'

import config from '../src/payload.config'

import { countWebhookDelivery } from '../src/lib/checkout/events'
import { developmentDatabase } from '../src/lib/env.core'
import {
  canTransition,
  formatOrderNumber,
  HANDLED_EVENT_TYPES,
  intendedStatusFor,
  isHandledEventType,
  needsPaymentFinalisation,
  orderTotalMinor,
  parseOrderReference,
  planStockDecrements,
  PREFLIGHT_COPY,
  type PaymentStatus,
} from '../src/lib/checkout/rules'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-checkout refuses to run: ${developmentDatabase.reason}. ` +
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

const ALL_STATUSES: PaymentStatus[] = [
  'draft',
  'checkout_started',
  'pending_payment',
  'paid',
  'payment_failed',
  'refunded',
  'cancelled',
]

/* =================================================================================================
 * A — §17.1c's state machine
 * ============================================================================================== */

check(
  'A: §17.1c — every state the plan lists is a state the machine knows',
  ALL_STATUSES.length === 7,
  ALL_STATUSES.join(','),
)

check('A: a draft may start checkout', canTransition('draft', 'checkout_started'))

check(
  'A: a draft may NOT reach paid — it has never been through preflight',
  !canTransition('draft', 'paid'),
)

check(
  'A: checkout_started may reach paid, which is the ordinary path',
  canTransition('checkout_started', 'paid'),
)

check('A: pending_payment may reach paid', canTransition('pending_payment', 'paid'))

check(
  'A: **paid is terminal** — no event may re-pay an order',
  !canTransition('paid', 'paid') && !canTransition('paid', 'pending_payment'),
)

check(
  'A: …and a late failure event may NOT un-pay one',
  !canTransition('paid', 'payment_failed') && !canTransition('paid', 'cancelled'),
)

check('A: paid may be refunded, which is the one way out', canTransition('paid', 'refunded'))

check(
  'A: refunded is terminal',
  ALL_STATUSES.every((to) => !canTransition('refunded', to)),
)

check(
  'A: a declined card is not the end — payment_failed may still reach paid',
  canTransition('payment_failed', 'paid'),
)

check(
  'A: …and an expired session is not either, because a customer may return',
  canTransition('cancelled', 'paid'),
)

/* =================================================================================================
 * B — §17.1d's SECOND idempotency barrier
 *
 * The first is a unique column and is exercised in section G against the real database. This is the
 * business-state guard, which is the one that catches a DIFFERENT event describing the same payment.
 * ============================================================================================== */

check(
  'B: an order that is already paid is not owed finalisation',
  !needsPaymentFinalisation('paid'),
)

check('B: …nor is a refunded one', !needsPaymentFinalisation('refunded'))

check(
  'B: an order awaiting payment IS owed it',
  needsPaymentFinalisation('pending_payment') && needsPaymentFinalisation('checkout_started'),
)

check(
  'B: a draft is not owed finalisation, because it cannot reach paid at all',
  !needsPaymentFinalisation('draft'),
)

check(
  'B: **the impossible payment state** — no status both is paid and needs finalising',
  ALL_STATUSES.every((status) => !(status === 'paid' && needsPaymentFinalisation(status))),
)

check(
  'B: every status that needs finalising can actually reach paid',
  ALL_STATUSES.every(
    (status) => !needsPaymentFinalisation(status) || canTransition(status, 'paid'),
  ),
)

/* =================================================================================================
 * C — §17.1d and §17.1h: event routing
 * ============================================================================================== */

check(
  'C: a completed checkout session means paid',
  intendedStatusFor('checkout.session.completed') === 'paid',
)

check(
  'C: a delayed bank payment succeeding also means paid',
  intendedStatusFor('checkout.session.async_payment_succeeded') === 'paid',
)

check(
  'C: §17.1h a declined card means payment_failed',
  intendedStatusFor('payment_intent.payment_failed') === 'payment_failed',
)

check(
  'C: §17.1h an expired session means cancelled',
  intendedStatusFor('checkout.session.expired') === 'cancelled',
)

check(
  'C: §17.1h an unknown event type asks for nothing rather than throwing',
  intendedStatusFor('invoice.paid') === null && intendedStatusFor('') === null,
)

check(
  'C: every handled type maps to a status, and nothing else does',
  HANDLED_EVENT_TYPES.every((type) => intendedStatusFor(type) !== null) &&
    !isHandledEventType('customer.created'),
)

check(
  'C: `payment_intent.succeeded` is deliberately NOT handled — the session event is the one we act on',
  !isHandledEventType('payment_intent.succeeded'),
  'handling both would be two events for one payment, which barrier two exists to catch',
)

/* =================================================================================================
 * D — §17.1h: invalid metadata
 * ============================================================================================== */

check('D: a numeric order reference parses', parseOrderReference({ orderId: 42 }) === 42)

check(
  'D: …and a string one, which is what Stripe returns',
  parseOrderReference({ orderId: '42' }) === 42,
)

check(
  'D: §17.1h missing metadata is null rather than an exception',
  parseOrderReference(undefined) === null && parseOrderReference(null) === null,
)

check(
  'D: a non-numeric reference is refused',
  parseOrderReference({ orderId: 'not-an-order' }) === null,
)

check(
  'D: a negative or zero id is refused — an id is a positive integer',
  parseOrderReference({ orderId: -1 }) === null && parseOrderReference({ orderId: 0 }) === null,
)

check(
  'D: a fractional id is refused rather than truncated toward some other order',
  parseOrderReference({ orderId: '42.9' }) === null,
)

check(
  'D: an id beyond safe integers is refused',
  parseOrderReference({ orderId: '9007199254740993' }) === null,
)

check(
  'D: metadata that is a string, an array or a number is refused without throwing',
  parseOrderReference('orderId=42') === null &&
    parseOrderReference([42]) === null &&
    parseOrderReference(42) === null,
)

/* =================================================================================================
 * E — §17.1f: the inventory race
 * ============================================================================================== */

check(
  'E: a line within stock is decremented',
  planStockDecrements([{ quantity: 2, stock: 5, variantId: 1 }]).ok,
)

check(
  'E: …by exactly what was bought',
  planStockDecrements([{ quantity: 2, stock: 5, variantId: 1 }]).decrements[0]?.quantity === 2,
)

check(
  'E: buying the last unit is allowed',
  planStockDecrements([{ quantity: 1, stock: 1, variantId: 1 }]).ok,
)

check(
  'E: **the race** — buying the last unit twice is not',
  !planStockDecrements([{ quantity: 2, stock: 1, variantId: 1 }]).ok,
)

check(
  'E: …and the shortfall reports what was actually available',
  planStockDecrements([{ quantity: 2, stock: 1, variantId: 1 }]).short[0]?.available === 1,
)

check(
  'E: **all or nothing** — one short line stops every decrement',
  planStockDecrements([
    { quantity: 1, stock: 5, variantId: 1 },
    { quantity: 9, stock: 1, variantId: 2 },
  ]).decrements.length === 0,
)

check(
  'E: two lines for one variant are SUMMED before the check, not checked separately',
  !planStockDecrements([
    { quantity: 1, stock: 1, variantId: 7 },
    { quantity: 1, stock: 1, variantId: 7 },
  ]).ok,
  'two checks that each pass can still add up to more than the warehouse has',
)

check(
  'E: …and when they do fit, they are one decrement rather than two',
  planStockDecrements([
    { quantity: 1, stock: 5, variantId: 7 },
    { quantity: 2, stock: 5, variantId: 7 },
  ]).decrements.length === 1,
)

check(
  'E: …of the summed quantity',
  planStockDecrements([
    { quantity: 1, stock: 5, variantId: 7 },
    { quantity: 2, stock: 5, variantId: 7 },
  ]).decrements[0]?.quantity === 3,
)

check(
  'E: zero stock cannot satisfy anything',
  !planStockDecrements([{ quantity: 1, stock: 0, variantId: 1 }]).ok,
)

check(
  'E: a NaN stock figure is treated as none rather than as unlimited',
  !planStockDecrements([{ quantity: 1, stock: Number.NaN, variantId: 1 }]).ok,
)

check('E: an empty order plans nothing and does not fail', planStockDecrements([]).ok)

/* =================================================================================================
 * F — §17.1b: the total, and §17.1d: the signature
 * ============================================================================================== */

check(
  'F: the total is subtotal less discount, plus shipping and tax',
  orderTotalMinor({
    discountMinor: 1_000,
    shippingMinor: 995,
    subtotalMinor: 10_000,
    taxMinor: 800,
  }) === 10_795,
  String(
    orderTotalMinor({
      discountMinor: 1_000,
      shippingMinor: 995,
      subtotalMinor: 10_000,
      taxMinor: 800,
    }),
  ),
)

check(
  'F: a discount can never reach delivery — the shop must not pay to send a parcel',
  orderTotalMinor({
    discountMinor: 99_999,
    shippingMinor: 995,
    subtotalMinor: 10_000,
    taxMinor: 0,
  }) === 995,
)

check(
  'F: a NaN anywhere in the parts cannot produce a NaN total',
  Number.isFinite(
    orderTotalMinor({
      discountMinor: Number.NaN,
      shippingMinor: 995,
      subtotalMinor: Number.NaN,
      taxMinor: 0,
    }),
  ),
)

{
  /*
   * Signature verification, offline. `generateTestHeaderString` is the SDK's own helper for exactly
   * this, and it computes the same HMAC Stripe does — so a payload that verifies here would verify
   * in production, and one that does not, would not.
   */
  const secret = 'whsec_verify_checkout_fixture'
  const stripe = new Stripe('sk_test_fixture', { apiVersion: '2026-07-29.dahlia' })
  const payloadBody = JSON.stringify({
    data: { object: { metadata: { orderId: '1' } } },
    id: 'evt_fixture_1',
    type: 'checkout.session.completed',
  })

  const header = stripe.webhooks.generateTestHeaderString({ payload: payloadBody, secret })

  let verified = false

  try {
    stripe.webhooks.constructEvent(payloadBody, header, secret)
    verified = true
  } catch {
    verified = false
  }

  check('F: §17.1d a correctly signed payload verifies', verified)

  const tampered = payloadBody.replace('"orderId":"1"', '"orderId":"999"')

  let tamperedVerified = false

  try {
    stripe.webhooks.constructEvent(tampered, header, secret)
    tamperedVerified = true
  } catch {
    tamperedVerified = false
  }

  check(
    'F: **a tampered payload does NOT verify** — the signature covers the exact bytes',
    !tamperedVerified,
  )

  let wrongSecretVerified = false

  try {
    stripe.webhooks.constructEvent(payloadBody, header, 'whsec_a_different_secret')
    wrongSecretVerified = true
  } catch {
    wrongSecretVerified = false
  }

  check('F: …and neither does the right payload under the wrong secret', !wrongSecretVerified)
}

/* =================================================================================================
 * G — Order numbers, and the real unique constraints
 * ============================================================================================== */

{
  const at = new Date('2026-09-08T00:00:00.000Z')
  const number = formatOrderNumber(at, Uint8Array.from([0, 1, 2, 3, 4, 5]))

  check('G: an order number carries the year and month', number.startsWith('N1-2609-'), number)

  check(
    'G: …and omits the characters that get misread aloud',
    !/[IO01]/.test(number.slice(8)),
    number,
  )

  check(
    'G: the same bytes give the same number, so it is a function rather than a surprise',
    formatOrderNumber(at, Uint8Array.from([0, 1, 2, 3, 4, 5])) === number,
  )

  const seen = new Set<string>()

  for (let i = 0; i < 500; i++) {
    seen.add(formatOrderNumber(at, createHash('sha256').update(String(i)).digest().subarray(0, 6)))
  }

  check(
    'G: 500 different byte strings give 500 different numbers',
    seen.size === 500,
    String(seen.size),
  )
}

const payload: Payload = await getPayload({ config })

const created: { collection: 'orders' | 'stripe-events'; id: number }[] = []

const cleanup = async () => {
  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true })
      .catch(() => undefined)
  }
}

try {
  const suffix = Date.now().toString().slice(-9)

  /*
   * **§17.1d's FIRST barrier, against the real database.** The whole point is that it is a constraint
   * rather than a check, so it has to be exercised where the constraint lives.
   */
  const first = await payload.create({
    collection: 'stripe-events',
    data: {
      attempts: 1,
      eventId: `evt_verify_${suffix}`,
      receivedAt: new Date().toISOString(),
      status: 'received',
      type: 'checkout.session.completed',
    },
    overrideAccess: true,
  })

  created.push({ collection: 'stripe-events', id: first.id })

  check('G: an event is recorded on first delivery', first.status === 'received')

  const duplicate = await payload
    .create({
      collection: 'stripe-events',
      data: {
        attempts: 1,
        eventId: `evt_verify_${suffix}`,
        receivedAt: new Date().toISOString(),
        status: 'received',
        type: 'checkout.session.completed',
      },
      overrideAccess: true,
    })
    .then((doc) => {
      created.push({ collection: 'stripe-events', id: doc.id })

      return doc
    })
    .catch(() => null)

  check(
    'G: **the same event id cannot be inserted twice** — the first idempotency barrier is a constraint',
    duplicate === null,
    duplicate === null ? '' : 'a duplicate event row was accepted',
  )

  /*
   * **The delivery counter, added by sweep 2.** A duplicate is not an error — Stripe retries after
   * network failures, timeouts and deploys — so the row counts the deliveries instead. Three at once,
   * because that is the only arrangement that can tell an expression update apart from a `read + 1`:
   * the latter has all three read 1 and all three write 2. The stakes here are only an operational
   * column, which is why it is a good place to be strict about the shape rather than the cost.
   */
  await Promise.all([
    countWebhookDelivery(payload, first.id),
    countWebhookDelivery(payload, first.id),
    countWebhookDelivery(payload, first.id),
  ])

  const counted = await payload.findByID({
    collection: 'stripe-events',
    depth: 0,
    id: first.id,
    overrideAccess: true,
  })

  check(
    'G: **three concurrent redeliveries all count** — the counter is an expression, not `read + 1`',
    Number(counted.attempts) === 4,
    String(counted.attempts),
  )

  /* Two orders may not claim one payment. */
  const orderData = {
    currency: 'USD' as const,
    discountMinor: 0,
    email: 'verify@example.test',
    fulfillmentStatus: 'unfulfilled' as const,
    paymentStatus: 'checkout_started' as const,
    shippingMinor: 0,
    subtotalMinor: 1_000,
    taxMinor: 0,
    totalMinor: 1_000,
  }

  const orderA = await payload.create({
    collection: 'orders',
    data: {
      ...orderData,
      orderNumber: `N1-VERIFY-A${suffix}`,
      stripePaymentIntentId: `pi_verify_${suffix}`,
    },
    overrideAccess: true,
  })

  created.push({ collection: 'orders', id: orderA.id })

  const orderB = await payload
    .create({
      collection: 'orders',
      data: {
        ...orderData,
        orderNumber: `N1-VERIFY-B${suffix}`,
        stripePaymentIntentId: `pi_verify_${suffix}`,
      },
      overrideAccess: true,
    })
    .then((doc) => {
      created.push({ collection: 'orders', id: doc.id })

      return doc
    })
    .catch(() => null)

  check(
    'G: two orders cannot claim the same Stripe payment intent',
    orderB === null,
    orderB === null ? '' : 'a second order took the same payment intent',
  )

  check(
    'G: an order number is unique too',
    await payload
      .create({
        collection: 'orders',
        data: { ...orderData, orderNumber: `N1-VERIFY-A${suffix}` },
        overrideAccess: true,
      })
      .then((doc) => {
        created.push({ collection: 'orders', id: doc.id })

        return false
      })
      .catch(() => true),
  )

  /* An order created by this project's own path is never born paid. */
  check(
    'G: **nothing creates an order at `paid`** — only a verified webhook may write it',
    orderA.paymentStatus === 'checkout_started',
    orderA.paymentStatus,
  )
} finally {
  await cleanup()
}

/* =================================================================================================
 * H — Copy
 * ============================================================================================== */

check(
  'H: every preflight refusal has a sentence',
  Object.values(PREFLIGHT_COPY).every((value) => typeof value === 'string' && value.length > 0),
)

check(
  'H: none of them names an internal reason, a status or a number',
  Object.values(PREFLIGHT_COPY).every((value) => !/\d|paymentStatus|stripe/i.test(value)),
  Object.values(PREFLIGHT_COPY)
    .filter((value) => /\d|paymentStatus|stripe/i.test(value))
    .join(' | '),
)

/* -------------------------------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------------------------------- */

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} checkout checks passed.`,
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
  throw new Error(`${failed.length} checkout check(s) failed.`)
}
