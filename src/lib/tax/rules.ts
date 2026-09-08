import { toMinorAmount } from '@/lib/money'
import type { CurrencyCode } from '@/payload/fields/money'

/**
 * **Plan §16.1c's tax boundary, as types and pure rules.**
 *
 * > *"Create a server-only tax boundary. Stripe Tax may be the initial provider, but the checkout
 * > calculation layer should not depend directly on Stripe-specific data structures."*
 *
 * The shape below is the whole of that sentence. `TaxRequest` is §16.1c's five named inputs and
 * `TaxResult` is its three named outputs — *"tax amount, tax calculation status, provider reference
 * where available"* — and neither mentions Stripe, a tax code, a jurisdiction or a line-item
 * breakdown, because those are one provider's vocabulary and this is the boundary that exists so the
 * rest of the application never learns it.
 *
 * `lib/tax/provider.ts` holds the interface and the implementation. This holds the contract they
 * agree on, so `pnpm verify:shipping` can assert it without a provider or a network.
 *
 * ---
 *
 * ### Status is not a boolean, and `null` is not zero
 *
 * A tax amount has four honest states and only one of them is a number:
 *
 * - **`calculated`** — a provider answered. The amount is authoritative for this request.
 * - **`pending_address`** — nobody can answer, because tax is a function of a destination and there
 *   is not one yet. This is the state of every bag in the shop today.
 * - **`not_required`** — a provider answered and the answer is *no tax applies here*. The amount is
 *   `0`, and that zero is a fact rather than a placeholder.
 * - **`unavailable`** — §16.1d's *"tax service unavailable"*. The amount is `null`, and a caller
 *   that renders `£0.00` here has quietly told the customer they owe no tax because a network call
 *   failed.
 *
 * The last distinction is the one that matters and it is why `amountMinor` is nullable while
 * `status` is not. Phase 14 made the same argument about the bag's deferred rows and Phase 15 made it
 * again about discounts; this is the third place the project has needed *"`null` means unknown, `0`
 * means none"*, which is a strong sign it is a real rule rather than a preference.
 */

export type TaxStatus = 'calculated' | 'not_required' | 'pending_address' | 'unavailable'

/** §16.1c's *"customer/shipping address"*, reduced to what a tax engine actually reads. */
export type TaxAddress = {
  city: null | string
  /** ISO 3166-1 alpha-2, upper-case. */
  country: string
  postalCode: null | string
  region: null | string
}

/** §16.1c's five inputs, exactly. */
export type TaxRequest = {
  /** `null` until the customer has given one — the ordinary state of a bag. */
  address: null | TaxAddress
  currency: CurrencyCode
  discountMinor: number
  shippingMinor: number
  subtotalMinor: number
}

/** §16.1c's three outputs, exactly. */
export type TaxResult = {
  /** `null` unless `status` is `calculated` or `not_required`. Never a stand-in for "unknown". */
  amountMinor: null | number
  /** The provider's own identifier for this calculation, for reconciliation. `null` when there is none. */
  providerRef: null | string
  status: TaxStatus
}

/** The taxable base: what is being charged for, before tax. §16.1c's first three inputs, combined. */
export function taxableBaseMinor(request: TaxRequest): number {
  const subtotal = toMinorAmount(request.subtotalMinor)
  const discount = toMinorAmount(request.discountMinor)
  const shipping = toMinorAmount(request.shippingMinor)

  return Math.max(0, subtotal - discount) + shipping
}

/**
 * Whether this request can be answered at all.
 *
 * A country is the minimum a tax engine needs; everything else narrows the answer. An address whose
 * country is not two letters is not an address — `fields/address.ts` enforces that format and
 * deliberately leaves the *set* to whoever is being asked, which for tax is the provider.
 */
export function isCalculableAddress(address: null | TaxAddress): boolean {
  return address !== null && /^[A-Z]{2}$/.test(address.country.trim().toUpperCase())
}

/** The result for a request nobody can answer yet. Not an error — the ordinary state of a bag. */
export const PENDING_TAX: TaxResult = {
  amountMinor: null,
  providerRef: null,
  status: 'pending_address',
}

/**
 * The result when a provider was asked and could not answer — §16.1d's *"tax service unavailable"*.
 *
 * Kept as a constant so that every failure path produces the identical shape, and so that a caller
 * cannot accidentally construct one with an `amountMinor` of `0`.
 */
export const UNAVAILABLE_TAX: TaxResult = {
  amountMinor: null,
  providerRef: null,
  status: 'unavailable',
}

export const TAX_COPY = {
  /** What the bag says while there is no address. */
  pending: 'Taxes are calculated at checkout.',
  /** §16.1d: the provider is down. Checkout must not proceed on a guess. */
  unavailable: 'We could not calculate tax just now. Please try again in a moment.',
} as const
