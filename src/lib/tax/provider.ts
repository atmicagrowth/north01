import 'server-only'

import { isStripeConfigured, stripeClient } from '@/lib/checkout/stripe'
import { reportFailure } from '@/lib/observability/report'

import {
  decideDeferredTax,
  PENDING_TAX,
  stripeTaxCalculationParams,
  taxResultFromStripeCalculation,
  taxWithoutProvider,
  type TaxRequest,
  type TaxResult,
} from './rules'

/**
 * **Plan §16.1c's `TaxProvider` interface**, and the two implementations behind it.
 *
 * The interface is the deliverable, and its whole purpose is that nothing above it knows which engine
 * answered: *"the checkout calculation layer should not depend directly on Stripe-specific data
 * structures."*
 *
 * ### Stripe Tax, since Phase 36 — audit R1-02, closing DEV-61
 *
 * Phase 16 shipped a deferral here and said Phase 17 would swap in a real provider "in a single
 * line". Phase 17 never did, and the deferral answers `unavailable` for every real address — so every
 * checkout was refused at the tax step whether or not Stripe keys existed. `stripeTaxProvider` is the
 * swap: `stripe.tax.calculations.create` with the discounted goods, the delivery charge and the
 * shipping address. The request and the mapping back are pure functions in `rules.ts`, unit-tested
 * against fixtures; this module only makes the call.
 *
 * **Not Checkout's `automatic_tax`.** That would have Stripe add tax on its own page, after our total
 * was computed — so the order would record one total and the customer would be charged another,
 * which is exactly what DEV-63's single line item exists to prevent. The tax is calculated here,
 * added into our total, and charged as part of it.
 *
 * **Five seconds, no retries.** The customer is waiting on the last click; the client's default of
 * two network retries could hold them three times as long. A slow or failed answer is `unavailable`,
 * and preflight says *"try again in a moment"* rather than guessing zero.
 *
 * ### The deferral, still
 *
 * Without Stripe keys there is no engine to ask, and the deferral's honest answer — never `0` — stays
 * what the application says. It is also the answer for a bag with no address yet, whichever provider
 * is selected.
 */
export type TaxProvider = {
  /** Identifies the implementation in logs and on an order. */
  readonly id: string
  calculate(request: TaxRequest): Promise<TaxResult>
}

/** The Phase 16 provider: it answers honestly and calculates nothing. */
export const deferredTaxProvider: TaxProvider = {
  calculate: (request) => Promise.resolve(decideDeferredTax(request)),
  id: 'deferred',
}

const STRIPE_TAX_TIMEOUT_MS = 5_000

/** Stripe Tax. Requires Stripe Tax to be enabled on the account — see `TODO.md` §4. */
export const stripeTaxProvider: TaxProvider = {
  async calculate(request) {
    const params = stripeTaxCalculationParams(request)

    if (params === null) {
      return PENDING_TAX
    }

    const nothingToTax = taxWithoutProvider(request)

    if (nothingToTax !== null) {
      return nothingToTax
    }

    try {
      const calculation = await stripeClient().tax.calculations.create(params, {
        maxNetworkRetries: 0,
        timeout: STRIPE_TAX_TIMEOUT_MS,
      })

      return taxResultFromStripeCalculation({ calculation })
    } catch (error) {
      console.error('Stripe Tax could not calculate tax for a checkout.', error)
      reportFailure(error, 'tax.stripe', { country: params.customer_details.address.country })

      return taxResultFromStripeCalculation({ error })
    }
  },
  id: 'stripe',
}

/** The provider this application uses: Stripe Tax when Stripe is configured, the deferral otherwise. */
export const taxProvider: TaxProvider = isStripeConfigured()
  ? stripeTaxProvider
  : deferredTaxProvider
