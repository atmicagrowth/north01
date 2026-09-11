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
  /** The street line. Optional: a US calculation is more precise with it, and none requires it. */
  line1?: null | string
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

/**
 * **What the deferred provider answers**, as a pure function so it can be executed by a harness.
 *
 * The provider itself is `server-only` — correctly, because a real one holds an API key — and
 * `server-only` cannot resolve outside Next. That makes its *decision* untestable unless the decision
 * lives somewhere else, which is the same split every rule in this project has, and the same lesson
 * Phase 15 learned when its guard sat on the module the harness needed.
 *
 * The claim being made testable is the one that matters: **this provider never invents a number.**
 * Handed an address it still cannot answer — it is a deferral, not a tax engine — and it says
 * `unavailable` rather than `not_required`, because *"we could not calculate"* is true and *"no tax
 * applies"* would be a guess. Phase 17 must be able to tell those apart: one may proceed to payment
 * and the other may not.
 *
 * A deferral that quietly began guessing once its inputs improved would be more dangerous than one
 * that never worked, because nobody would be watching it.
 */
export function decideDeferredTax(request: TaxRequest): TaxResult {
  return isCalculableAddress(request.address) ? UNAVAILABLE_TAX : PENDING_TAX
}

/* -------------------------------------------------------------------------------------------------
 * Stripe Tax — Phase 36, audit R1-02
 * ---------------------------------------------------------------------------------------------- */

/**
 * **The request Stripe Tax is sent**, built from §16.1c's five inputs and nothing else.
 *
 * Pure, so the shape is asserted by a unit test rather than by a live call. It lives here, beside
 * the provider-neutral contract, because it is the one translation *into* Stripe's vocabulary and the
 * mapper below is the one translation back — `provider.ts` then only makes the call.
 *
 * - **One line, the discounted goods** — `max(0, subtotal − discount)`, the same base
 *   `taxableBaseMinor` uses. A line per product would be a second itemisation that could round
 *   differently from ours (the argument DEV-63 makes about the Checkout Session).
 * - **Shipping as `shipping_cost`**, so each jurisdiction decides whether delivery is taxable.
 * - **Tax exclusive**: our prices are before tax and the tax is added on top — that is what
 *   `orderTotalMinor` does with the answer.
 * - **The shipping address, declared as such** (`address_source: 'shipping'`). Tax on goods is owed
 *   where they are delivered.
 *
 * Returns `null` when the address cannot be asked about — the caller answers `pending_address`.
 */
export type StripeTaxCalculationParams = {
  currency: string
  customer_details: {
    address: {
      city?: string
      country: string
      line1?: string
      postal_code?: string
      state?: string
    }
    address_source: 'shipping'
  }
  line_items: { amount: number; reference: string; tax_behavior: 'exclusive' }[]
  shipping_cost: { amount: number; tax_behavior: 'exclusive' }
}

export function stripeTaxCalculationParams(request: TaxRequest): null | StripeTaxCalculationParams {
  const { address } = request

  if (address === null || !isCalculableAddress(address)) {
    return null
  }

  const present = (value: null | string | undefined): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

  return {
    currency: request.currency.toLowerCase(),
    customer_details: {
      address: {
        city: present(address.city),
        country: address.country.trim().toUpperCase(),
        line1: present(address.line1),
        postal_code: present(address.postalCode),
        state: present(address.region),
      },
      address_source: 'shipping',
    },
    line_items: [
      {
        amount: Math.max(
          0,
          toMinorAmount(request.subtotalMinor) - toMinorAmount(request.discountMinor),
        ),
        reference: 'bag',
        tax_behavior: 'exclusive',
      },
    ],
    shipping_cost: { amount: toMinorAmount(request.shippingMinor), tax_behavior: 'exclusive' },
  }
}

/**
 * **Stripe's answer, as §16.1c's three outputs.**
 *
 * - `tax_amount_exclusive` is the tax added on top — the amount. `0` is **`not_required`**: Stripe
 *   answered and no tax applies, which is a fact rather than a placeholder (see the module docblock).
 *   Note what produces that zero in practice: **a Stripe account with no tax registrations** returns
 *   zero for every address, so `TODO.md` §4 makes enabling Stripe Tax an operator step.
 * - The calculation `id` (`taxcalc_…`) is the provider reference.
 * - An error, or an answer that is not a whole non-negative number, is **`unavailable`** — never a
 *   guessed zero. Preflight refuses to take payment on it.
 */
export function taxResultFromStripeCalculation(
  outcome: { calculation: unknown } | { error: unknown },
): TaxResult {
  if (!('calculation' in outcome)) {
    return UNAVAILABLE_TAX
  }

  const calculation = outcome.calculation as { id?: unknown; tax_amount_exclusive?: unknown } | null

  const amount = calculation?.tax_amount_exclusive

  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
    return UNAVAILABLE_TAX
  }

  return {
    amountMinor: amount,
    providerRef: typeof calculation?.id === 'string' ? calculation.id : null,
    status: amount === 0 ? 'not_required' : 'calculated',
  }
}

/**
 * **Nothing to tax, so nothing to ask** — Phase 36 sweep 1.
 *
 * A bag whose goods are fully discounted and whose delivery is free has a taxable base of zero, and
 * exclusive tax on zero is zero in every jurisdiction — so the answer is `not_required` without a
 * call. (Stripe would otherwise be sent a line with `amount: 0`.)
 *
 * **Not covered: goods at zero with a delivery charge.** Stripe still needs one line item, so it is
 * sent the zero goods line plus the `shipping_cost`, because delivery itself can be taxable. Should
 * Stripe refuse a zero-amount line, that request comes back `unavailable` and preflight refuses the
 * checkout — the safe direction, never a guessed zero. It is untested without keys.
 */
export function taxWithoutProvider(request: TaxRequest): null | TaxResult {
  return taxableBaseMinor(request) === 0
    ? { amountMinor: 0, providerRef: null, status: 'not_required' }
    : null
}

export const TAX_COPY = {
  /** What the bag says while there is no address (Phase 36, R2-13: says what tax depends on). */
  pending: 'Tax is calculated from your delivery address.',
  /** §16.1d: the provider is down. Checkout must not proceed on a guess. */
  unavailable: 'We could not calculate tax just now. Please try again in a moment.',
} as const
