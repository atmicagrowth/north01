import 'server-only'

import { randomBytes } from 'node:crypto'

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

import { formatOrderNumber, orderTotalMinor, type PreflightFailure } from './rules'
import { isStripeConfigured } from './stripe'

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
 * code `fields/address.ts` enforces the format of.
 */
function addressIsComplete(address: CheckoutContact['shippingAddress']): boolean {
  return (
    trimmed(address.firstName) !== '' &&
    trimmed(address.lastName) !== '' &&
    trimmed(address.line1) !== '' &&
    trimmed(address.city) !== '' &&
    trimmed(address.postalCode) !== '' &&
    /^[A-Za-z]{2}$/.test(trimmed(address.country))
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

  /* Step 10. */
  const payload = await getPayloadClient()
  const orderId = await upsertPendingOrder(payload, {
    cart,
    contact,
    customerId,
    rate: validated.rate,
    totals,
  })

  return {
    cart,
    contact,
    customerId,
    ok: true,
    orderId,
    rate: validated.rate,
    tax,
    totals,
  }
}

/**
 * **Step 10: *"create or update pending order context."***
 *
 * One order per cart, reused across attempts. A customer who reaches Stripe, changes their mind, comes
 * back and edits their bag must not leave a trail of abandoned orders — and more importantly, the
 * webhook needs a stable id to find its way back to, which is what §17.1b's metadata carries.
 *
 * The order is written at `checkout_started` and **never at `paid`**. `AGENTS.md`: *"Only a
 * signature-verified Stripe webhook marks an order paid."* Nothing in this file can write that status;
 * the state machine in `rules.ts` will not even allow `draft → paid`.
 *
 * The **line items are snapshotted here**, not at payment. `order-items` is where a price is frozen —
 * `CartItems.ts` says so — and freezing it at preflight rather than in the webhook means the order
 * records what the customer was shown at the moment they were sent to pay, which is the number the
 * Checkout Session will charge.
 */
async function upsertPendingOrder(
  payload: Payload,
  input: {
    cart: CartView
    contact: CheckoutContact
    customerId: null | number
    rate: ShippingRate
    totals: {
      discountMinor: number
      shippingMinor: number
      subtotalMinor: number
      taxMinor: number
      totalMinor: number
    }
  },
): Promise<number> {
  const { cart, contact, customerId, rate, totals } = input

  const { docs: existing } = await payload.find({
    collection: 'orders',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    sort: '-createdAt',
    where: {
      and: [
        { cart: { equals: cart.id } },
        { paymentStatus: { in: ['draft', 'checkout_started', 'payment_failed', 'cancelled'] } },
      ],
    },
  })

  const address = {
    city: trimmed(contact.shippingAddress.city),
    company: null,
    country: trimmed(contact.shippingAddress.country).toUpperCase(),
    firstName: trimmed(contact.shippingAddress.firstName),
    lastName: trimmed(contact.shippingAddress.lastName),
    line1: trimmed(contact.shippingAddress.line1),
    line2: trimmed(contact.shippingAddress.line2) || null,
    phone: trimmed(contact.shippingAddress.phone) || null,
    postalCode: trimmed(contact.shippingAddress.postalCode),
    region: trimmed(contact.shippingAddress.region) || null,
  }

  const data = {
    billingAddress: address,
    cart: cart.id,
    currency: cart.currency,
    ...(customerId === null ? {} : { customer: customerId }),
    discountCode: cart.discount?.code ?? null,
    discountMinor: totals.discountMinor,
    email: trimmed(contact.email).toLowerCase(),
    /*
     * `fulfillmentStatus` is required and starts unfulfilled. Nothing here may write `paid`:
     * `AGENTS.md` says only a signature-verified webhook does that, and the state machine in
     * `rules.ts` will not allow `draft → paid` at all.
     */
    fulfillmentStatus: 'unfulfilled' as const,
    paymentStatus: 'checkout_started' as const,
    ...(cart.discount ? { promotion: cart.discount.id } : {}),
    shippingAddress: address,
    shippingMethodCode: rate.id,
    shippingMethodLabel: rate.name,
    shippingMinor: totals.shippingMinor,
    subtotalMinor: totals.subtotalMinor,
    taxMinor: totals.taxMinor,
    totalMinor: totals.totalMinor,
  }

  const order = existing[0]
    ? await payload.update({
        collection: 'orders',
        data,
        id: existing[0].id,
        overrideAccess: true,
      })
    : await payload.create({
        collection: 'orders',
        data: { ...data, orderNumber: formatOrderNumber(new Date(), randomBytes(6)) },
        overrideAccess: true,
      })

  /*
   * The snapshot is rewritten from scratch on every attempt rather than diffed. A bag can change
   * between attempts, and reconciling two sets of lines is a merge with an edge case for every way
   * they can differ; deleting and rewriting has none, and these rows exist only for this order.
   */
  const { docs: staleLines } = await payload.find({
    collection: 'order-items',
    depth: 0,
    limit: 500,
    overrideAccess: true,
    pagination: false,
    where: { order: { equals: order.id } },
  })

  for (const line of staleLines) {
    await payload.delete({ collection: 'order-items', id: line.id, overrideAccess: true })
  }

  for (const line of cart.lines) {
    const unitPriceMinor = line.unitPriceMinor ?? 0

    await payload.create({
      collection: 'order-items',
      data: {
        /*
         * `lineTotalMinor` is **stored, not recomputed** — `OrderItems.ts` says so. An order is a
         * historical record, and a line total derived at render time would silently change if the
         * arithmetic ever did.
         */
        lineTotalMinor: unitPriceMinor * line.effectiveQuantity,
        order: order.id,
        product: line.productId,
        productName: line.productName,
        quantity: line.effectiveQuantity,
        /* A withdrawn variant has no SKU to read; the snapshot records that rather than inventing one. */
        sku: line.sku ?? 'UNKNOWN',
        unitPriceMinor,
        variant: line.variantId,
        variantLabel: [line.color, line.size].filter(Boolean).join(' / ') || '—',
      },
      overrideAccess: true,
    })
  }

  return order.id
}
