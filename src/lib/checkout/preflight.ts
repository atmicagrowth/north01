import 'server-only'

import type { Payload } from 'payload'

import { getCart, hasSignedOutBag, type CartView } from '@/lib/cart/cart'
import { getCatalogSettings } from '@/lib/catalog/catalog'
import { getPayloadClient } from '@/lib/payload'
import { shippingProvider } from '@/lib/shipping/provider'
import {
  isSupportedDestination,
  validateSelectedRate,
  type ShippingDestination,
  type ShippingRate,
} from '@/lib/shipping/rules'
import { taxProvider } from '@/lib/tax/provider'
import type { TaxAddress, TaxResult } from '@/lib/tax/rules'

import { reportFailure } from '@/lib/observability/report'

import { upsertPendingOrder } from './pending-order'
import {
  decidePriorSession,
  orderTotalMinor,
  type PaymentStatus,
  type PreflightFailure,
} from './rules'
import { isStripeConfigured, stripeClient } from './stripe'
import { addressFits } from '@/lib/address-limits'

/**
 * **Plan §17.1a, all eleven steps, in the plan's order.**
 *
 * > 1. Load cart from server. 2. Verify cart not empty. 3. Verify products still exist. 4. Verify
 * > variants active. 5. Revalidate inventory. 6. Recalculate prices. 7. Recalculate promotion.
 * > 8. Calculate/obtain shipping method. 9. Calculate/obtain tax as configured. 10. Create or update
 * > pending order context. 11. Create Stripe Checkout Session.
 *
 * Steps 1–10 are here. Step 11 is `session.ts`, because creating the session is the one step that
 * talks to Stripe and the ten before it must all have succeeded first.
 *
 * ### Steps 3 to 7 are not re-implemented — they are `getCart`
 *
 * That is deliberate and it is the strongest thing about this function. `lib/cart/cart.ts` already
 * re-reads every variant live, drops what no longer exists, clamps every quantity to current stock,
 * prices every line from the database and re-decides the promotion against the result — on **every
 * read**, because §14.1e and §15.1c both required it. A preflight that re-implemented those five
 * steps would be a second opinion about the same facts, and the two would disagree the first time one
 * of them was changed.
 *
 * So preflight *asks*, and then checks that the answer is fit to charge for. The five steps are
 * satisfied by the read; what this adds is the refusal.
 *
 * ### Nothing here takes a number from the browser
 *
 * The customer supplies an email, an address and a **shipping method id**. Everything with a currency
 * attached is computed from the database and the providers: `orderTotalMinor` takes four
 * server-derived numbers and there is no parameter through which a total could arrive. §17.1b's
 * *"never accept a client-provided total"* is satisfied by there being nothing to accept.
 */

export type CheckoutContact = {
  email: string
  shippingAddress: {
    city: string
    country: string
    firstName: string
    lastName: string
    line1: string
    line2: null | string
    phone: null | string
    postalCode: string
    region: null | string
  }
  shippingMethodId: string
}

export type PreflightResult =
  | {
      cart: CartView
      contact: CheckoutContact
      customerId: null | number
      ok: true
      orderId: number
      /** The order's `updated_at` after this attempt wrote it — `claimOrderForSession` needs it. */
      preparedAt: string
      rate: ShippingRate
      tax: TaxResult
      totals: {
        discountMinor: number
        shippingMinor: number
        subtotalMinor: number
        taxMinor: number
        totalMinor: number
      }
    }
  | { ok: false; reason: PreflightFailure }

const trimmed = (value: null | string | undefined): string => (value ?? '').trim()

/**
 * Whether the address has the parts an order needs — **DEV-11**, which added shipping-address
 * validation to preflight precisely because shipping and tax cannot be computed without one.
 *
 * `region` is optional because a great many countries have no state or county, and `line2` because
 * most addresses do not have one. Everything else is required, and the country must be the two-letter
 * code `fields/address.ts` enforces the format of. And every line must fit the schema's bound
 * (`lib/address-limits.ts`, plan §34) — otherwise the order write would refuse it with no useful answer.
 */
function addressIsComplete(address: CheckoutContact['shippingAddress']): boolean {
  return (
    trimmed(address.firstName) !== '' &&
    trimmed(address.lastName) !== '' &&
    trimmed(address.line1) !== '' &&
    trimmed(address.city) !== '' &&
    trimmed(address.postalCode) !== '' &&
    /^[A-Za-z]{2}$/.test(trimmed(address.country)) &&
    addressFits(address)
  )
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function runPreflight(
  customerId: null | number,
  contact: CheckoutContact,
): Promise<PreflightResult> {
  /* Step 11's precondition, checked first: there is no point revalidating a bag we cannot charge. */
  if (!isStripeConfigured()) {
    return { ok: false, reason: 'stripeUnconfigured' }
  }

  /* Steps 1–7: one read, which revalidates products, variants, inventory, prices and the promotion. */
  const cart = await getCart(customerId)

  if (!cart || cart.lines.length === 0) {
    /* A signed-out owner's bag is not an empty bag — see `hasSignedOutBag`. */
    if (!cart && customerId === null && (await hasSignedOutBag())) {
      return { ok: false, reason: 'sessionExpired' }
    }

    return { ok: false, reason: 'emptyCart' }
  }

  /*
   * Step 3, 4 and 5's refusal. `getCart` reports what it found; this decides that a bag containing
   * anything unbuyable may not be charged for. Refusing the whole bag rather than silently dropping
   * the line is the point — the customer chose it, and removing it on their behalf at the moment they
   * pay is how somebody receives an order missing the thing they wanted.
   */
  if (cart.lines.some((line) => line.maxQuantity <= 0 || line.unitPriceMinor === null)) {
    return { ok: false, reason: 'lineUnavailable' }
  }

  /* A line clamped down since the bag was last seen is the same problem, stated by `drifted`. */
  if (cart.drifted) {
    return { ok: false, reason: 'totalMismatch' }
  }

  /* Step 7's refusal: a code that has expired between the bag and here must not be silently dropped. */
  if (cart.discount !== null && cart.discount.result.reason !== null) {
    return { ok: false, reason: 'promotionInvalid' }
  }

  if (!EMAIL.test(trimmed(contact.email)) || !addressIsComplete(contact.shippingAddress)) {
    return { ok: false, reason: 'invalidAddress' }
  }

  const destination: ShippingDestination = {
    country: trimmed(contact.shippingAddress.country).toUpperCase(),
    postalCode: trimmed(contact.shippingAddress.postalCode) || null,
    region: trimmed(contact.shippingAddress.region) || null,
  }

  if (!isSupportedDestination(destination)) {
    return { ok: false, reason: 'addressUnsupported' }
  }

  const subtotalMinor = cart.totals.subtotalMinor
  const discountMinor = cart.totals.discountMinor ?? 0

  /*
   * **Step 8, re-quoted with the real destination.** The bag quoted without one — §16.1a's
   * `destinationKnown` is what said so — and this is the re-quote that turns an estimate into a
   * price. §16.1b: the browser sends a method *id*, and the rate comes from this quote.
   */
  const quote = await shippingProvider.quote({
    currency: cart.currency,
    destination,
    discountMinor,
    freeShippingPromotion:
      cart.discount?.result.reason === null && cart.discount.result.freeShipping,
    freeShippingThresholdMinor: (await getCatalogSettings()).freeShippingThresholdMinor,
    subtotalMinor,
  })

  if (quote.defaultRateId === null) {
    return { ok: false, reason: 'noShippingMethod' }
  }

  const validated = validateSelectedRate(contact.shippingMethodId, quote)

  if (!validated.ok) {
    return { ok: false, reason: 'noShippingMethod' }
  }

  /* Step 9. A tax provider that cannot answer stops checkout — §16.1d, and never a guess of zero. */
  const taxAddress: TaxAddress = {
    city: trimmed(contact.shippingAddress.city) || null,
    country: destination.country,
    line1: trimmed(contact.shippingAddress.line1) || null,
    postalCode: destination.postalCode,
    region: destination.region,
  }

  const tax = await taxProvider.calculate({
    address: taxAddress,
    currency: cart.currency,
    discountMinor,
    shippingMinor: validated.rate.amountMinor,
    subtotalMinor,
  })

  if (tax.amountMinor === null) {
    return { ok: false, reason: 'taxUnavailable' }
  }

  const totals = {
    discountMinor,
    shippingMinor: validated.rate.amountMinor,
    subtotalMinor,
    taxMinor: tax.amountMinor,
    totalMinor: orderTotalMinor({
      discountMinor,
      shippingMinor: validated.rate.amountMinor,
      subtotalMinor,
      taxMinor: tax.amountMinor,
    }),
  }

  /* Step 10 — `pending-order.ts`, which is where the concurrency is handled. */
  const payload = await getPayloadClient()
  const upserted = await upsertPendingOrder(
    payload,
    {
      cart,
      contact,
      customerId,
      rate: validated.rate,
      taxCalculationId:
        tax.status === 'calculated' || tax.status === 'not_required' ? tax.providerRef : null,
      totals,
    },
    (orderId, sessionId, orderStatus) =>
      retirePriorSession(payload, orderId, sessionId, orderStatus),
  )

  if (!upserted.ok) {
    return upserted
  }

  return {
    cart,
    contact,
    customerId,
    ok: true,
    orderId: upserted.orderId,
    preparedAt: upserted.preparedAt,
    rate: validated.rate,
    tax,
    totals,
  }
}

/**
 * **Make the reused order's previous Stripe session unpayable, or refuse** — Phase 36, R1-01.
 *
 * Returns `null` when the order may be rewritten, or the refusal. `decidePriorSession` makes the
 * decision; this only asks Stripe and acts. Any Stripe error — including an expiry that fails because
 * the session was paid a moment ago — refuses with the same reason a failed session creation gives,
 * because proceeding without knowing is exactly the rewrite this exists to prevent.
 */
async function retirePriorSession(
  payload: Payload,
  orderId: number,
  sessionId: string,
  orderStatus: PaymentStatus,
): Promise<null | PreflightFailure> {
  try {
    const stripe = stripeClient()
    const prior = await stripe.checkout.sessions.retrieve(sessionId)

    const decision = decidePriorSession({
      orderStatus,
      sessionPaymentStatus: prior.payment_status ?? null,
      sessionStatus: prior.status ?? null,
    })

    if (decision === 'refuse') {
      return 'alreadyPaid'
    }

    if (decision === 'expire') {
      await stripe.checkout.sessions.expire(sessionId)
    }

    return null
  } catch (error) {
    payload.logger.error({
      err: error,
      msg: 'Could not retire the previous Stripe session before reusing an order.',
      orderId,
    })
    reportFailure(error, 'checkout.retirePriorSession', { orderId })

    return 'stripeUnconfigured'
  }
}
