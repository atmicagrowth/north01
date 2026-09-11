import { describe, expect, it } from 'vitest'

import {
  stripeTaxCalculationParams,
  taxResultFromStripeCalculation,
  UNAVAILABLE_TAX,
  type TaxRequest,
} from '@/lib/tax/rules'

/**
 * **Stripe Tax, both directions, against fixtures** — Phase 36, audit R1-02.
 *
 * `lib/tax/provider.ts` makes one call. Everything that decides anything — what is sent, and what the
 * answer means — is pure and asserted here, including the one mapping that matters most: an error is
 * `unavailable`, never a zero.
 */

const request = (overrides: Partial<TaxRequest> = {}): TaxRequest => ({
  address: {
    city: 'Portland',
    country: 'US',
    line1: '1 Main St',
    postalCode: '97201',
    region: 'OR',
  },
  currency: 'USD',
  discountMinor: 2_000,
  shippingMinor: 995,
  subtotalMinor: 12_000,
  ...overrides,
})

/** The shape `stripe.tax.calculations.create` returns, reduced to the fields read. */
const calculation = (taxAmountExclusive: number) => ({
  amount_total: 10_995 + taxAmountExclusive,
  currency: 'usd',
  id: 'taxcalc_1Abc',
  object: 'tax.calculation',
  tax_amount_exclusive: taxAmountExclusive,
  tax_amount_inclusive: 0,
})

describe('the request sent to Stripe Tax', () => {
  it('sends one exclusive line for the discounted goods, and the delivery as shipping_cost', () => {
    const params = stripeTaxCalculationParams(request())

    expect(params).toEqual({
      currency: 'usd',
      customer_details: {
        address: {
          city: 'Portland',
          country: 'US',
          line1: '1 Main St',
          postal_code: '97201',
          state: 'OR',
        },
        address_source: 'shipping',
      },
      line_items: [{ amount: 10_000, reference: 'bag', tax_behavior: 'exclusive' }],
      shipping_cost: { amount: 995, tax_behavior: 'exclusive' },
    })
  })

  it('never sends a negative line, however large the discount', () => {
    const params = stripeTaxCalculationParams(request({ discountMinor: 50_000 }))

    expect(params?.line_items[0]?.amount).toBe(0)
  })

  it('omits the parts of an address that are empty, rather than sending blanks', () => {
    const params = stripeTaxCalculationParams(
      request({ address: { city: ' ', country: 'gb', postalCode: 'SW1A 1AA', region: null } }),
    )

    expect(params?.customer_details.address).toEqual({
      city: undefined,
      country: 'GB',
      line1: undefined,
      postal_code: 'SW1A 1AA',
      state: undefined,
    })
  })

  it('asks nothing when there is no address to ask about', () => {
    expect(stripeTaxCalculationParams(request({ address: null }))).toBeNull()
    expect(
      stripeTaxCalculationParams(
        request({ address: { city: null, country: 'USA', postalCode: null, region: null } }),
      ),
    ).toBeNull()
  })
})

describe('what Stripe’s answer means', () => {
  it('maps tax on top to a calculated amount, with the calculation as the reference', () => {
    expect(taxResultFromStripeCalculation({ calculation: calculation(880) })).toEqual({
      amountMinor: 880,
      providerRef: 'taxcalc_1Abc',
      status: 'calculated',
    })
  })

  it('maps an answer of zero to not_required — Stripe said no tax applies', () => {
    expect(taxResultFromStripeCalculation({ calculation: calculation(0) })).toEqual({
      amountMinor: 0,
      providerRef: 'taxcalc_1Abc',
      status: 'not_required',
    })
  })

  it('maps an error to unavailable, never to zero', () => {
    expect(taxResultFromStripeCalculation({ error: new Error('timeout') })).toEqual(UNAVAILABLE_TAX)
  })

  it('maps an answer it cannot read to unavailable', () => {
    for (const bad of [
      null,
      {},
      { tax_amount_exclusive: -1 },
      { tax_amount_exclusive: 1.5 },
      { tax_amount_exclusive: '880' },
    ]) {
      expect(taxResultFromStripeCalculation({ calculation: bad })).toEqual(UNAVAILABLE_TAX)
    }
  })

  it('keeps an amount even without an id, reporting no reference', () => {
    expect(
      taxResultFromStripeCalculation({ calculation: { tax_amount_exclusive: 100 } }).providerRef,
    ).toBeNull()
  })
})
