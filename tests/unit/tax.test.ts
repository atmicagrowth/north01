import { describe, expect, it } from 'vitest'

import {
  decideDeferredTax,
  isCalculableAddress,
  PENDING_TAX,
  TAX_COPY,
  taxableBaseMinor,
  UNAVAILABLE_TAX,
  type TaxAddress,
  type TaxRequest,
  type TaxStatus,
} from '@/lib/tax/rules'

/**
 * **Plan §27.1a — "Tax abstraction behavior".**
 *
 * `lib/tax/rules.ts` is the pure half of §16.1c's tax boundary: the provider that consumes it is
 * `server-only` because a real one holds an API key, so the *decision* was deliberately moved here
 * where it can be executed without Next, a network or a key. These tests exercise that decision and
 * the arithmetic it sits on — nothing here touches a provider.
 *
 * The module's own docblock states the contract this file exists to pin, and it is worth quoting
 * because it is the thing that breaks silently:
 *
 * > *"this provider never invents a number."*
 *
 * The interesting failure modes, in the order they would actually bite:
 *
 * 1. **`null` degrading to `0`.** A tax of `null` means *we do not know*; a tax of `0` means *none is
 *    owed*. They render identically once someone writes `tax ?? 0`, and the second one undercharges
 *    every order in a taxable jurisdiction. `amountMinor` is nullable precisely so the two cannot be
 *    confused, and every assertion below that reaches for `toBeNull()` rather than `toBe(0)` is
 *    guarding that.
 * 2. **A deferral that starts guessing when its inputs improve.** Handed a real address, the deferred
 *    decision must get *more* honest, not less: `unavailable` ("we could not calculate") rather than
 *    `not_required` ("no tax applies here"), which would be a claim about tax law made by a module
 *    that contains no tax law. Phase 17 has to be able to tell those apart — one may proceed to
 *    payment and the other may not.
 * 3. **Poison arithmetic.** `Math.max(0, Math.floor(NaN))` is `NaN`, not `0`; `lib/money.ts` records
 *    that Phase 16's first sweep found exactly this returning a `NaN` taxable base. The base is money,
 *    so it must always come back a whole, non-negative count of minor units whatever it is handed.
 * 4. **Division sneaking in early.** Minor units stay integers here; `/ 100` happens once, at the
 *    formatting boundary, and never in a rule.
 */

/** A complete, ordinary request, so each test can vary the one input it is about. */
const taxRequest = (overrides: Partial<TaxRequest> = {}): TaxRequest => ({
  address: null,
  currency: 'USD',
  discountMinor: 0,
  shippingMinor: 0,
  subtotalMinor: 10_995,
  ...overrides,
})

/** A complete address, so each test can vary the one field it is about. */
const address = (overrides: Partial<TaxAddress> = {}): TaxAddress => ({
  city: 'Portland',
  country: 'US',
  postalCode: '97205',
  region: 'OR',
  ...overrides,
})

describe('the taxable base', () => {
  it('is subtotal less discount plus shipping — §16.1c’s first three inputs, combined', () => {
    expect(taxableBaseMinor(taxRequest({ discountMinor: 1_000, shippingMinor: 500 }))).toBe(10_495)
  })

  it('taxes shipping, because shipping is part of what is being charged for', () => {
    const withoutShipping = taxableBaseMinor(taxRequest({ shippingMinor: 0 }))
    const withShipping = taxableBaseMinor(taxRequest({ shippingMinor: 995 }))

    expect(withShipping - withoutShipping).toBe(995)
  })

  it('clamps a discount larger than the subtotal to zero rather than going negative', () => {
    // A negative base would reach a provider as a negative sale and come back as a credit.
    expect(taxableBaseMinor(taxRequest({ discountMinor: 99_999, shippingMinor: 0 }))).toBe(0)
  })

  it('does not let an oversized discount eat into the shipping charge', () => {
    /*
     * The clamp applies to `subtotal - discount` *before* shipping is added, not to the whole
     * expression. A 100%-off promotion on the goods still leaves the carrier's fee taxable.
     */
    expect(taxableBaseMinor(taxRequest({ discountMinor: 99_999, shippingMinor: 795 }))).toBe(795)
  })

  it('is zero, not null, for an empty bag — "nothing is being charged for" is a known fact', () => {
    const base = taxableBaseMinor(
      taxRequest({ discountMinor: 0, shippingMinor: 0, subtotalMinor: 0 }),
    )

    expect(base).toBe(0)
    // `-0` would serialise as `-0` and compare unequal under `Object.is`; the clamp normalises it.
    expect(Object.is(base, -0)).toBe(false)
  })

  it('stays in integer minor units — no division happens inside a rule', () => {
    // $109.95 is 10_995 here, and becomes "109.95" once, at the formatting boundary. Never 109.95.
    expect(taxableBaseMinor(taxRequest())).toBe(10_995)
    expect(Number.isInteger(taxableBaseMinor(taxRequest()))).toBe(true)
  })

  it('floors each fractional input independently, because a half-penny is not money', () => {
    /*
     * Flooring per input rather than on the result: 1_000.9 → 1_000 and 100.9 → 100, so the answer is
     * 900 and not the 900.0 (or 901) a single rounding of the difference could produce.
     */
    expect(taxableBaseMinor(taxRequest({ discountMinor: 100.9, subtotalMinor: 1_000.9 }))).toBe(900)
    expect(taxableBaseMinor(taxRequest({ shippingMinor: 499.99, subtotalMinor: 0 }))).toBe(499)
  })

  it('treats a negative amount on any input as zero rather than as a reversal', () => {
    expect(taxableBaseMinor(taxRequest({ subtotalMinor: -5_000 }))).toBe(0)
    // A negative discount would otherwise *increase* the base — a refund that charges tax.
    expect(taxableBaseMinor(taxRequest({ discountMinor: -5_000 }))).toBe(10_995)
    expect(taxableBaseMinor(taxRequest({ shippingMinor: -5_000, subtotalMinor: 0 }))).toBe(0)
  })

  it('absorbs NaN on every input instead of propagating it', () => {
    /*
     * The failure this exists to prevent: `Math.max(0, Math.floor(NaN))` is `NaN`, so a guard that
     * *looks* like a clamp passes the poison straight through and the base silently stops being a
     * number. `lib/money.ts` records this as a real Phase 16 finding, not a hypothetical.
     */
    expect(taxableBaseMinor(taxRequest({ subtotalMinor: Number.NaN }))).toBe(0)
    expect(taxableBaseMinor(taxRequest({ discountMinor: Number.NaN }))).toBe(10_995)
    expect(taxableBaseMinor(taxRequest({ shippingMinor: Number.NaN }))).toBe(10_995)
    expect(
      Number.isNaN(
        taxableBaseMinor(taxRequest({ discountMinor: Number.NaN, subtotalMinor: Number.NaN })),
      ),
    ).toBe(false)
  })

  it('absorbs Infinity, which is not a finite amount of money', () => {
    expect(taxableBaseMinor(taxRequest({ shippingMinor: Number.POSITIVE_INFINITY }))).toBe(10_995)
    expect(taxableBaseMinor(taxRequest({ subtotalMinor: Number.POSITIVE_INFINITY }))).toBe(0)
    expect(taxableBaseMinor(taxRequest({ discountMinor: Number.NEGATIVE_INFINITY }))).toBe(10_995)
  })

  it('absorbs a missing input, so a half-built request cannot produce NaN', () => {
    // Requests are assembled from stored rows and provider replies; a column can be null in practice.
    const malformed = { ...taxRequest(), shippingMinor: undefined } as unknown as TaxRequest

    expect(taxableBaseMinor(malformed)).toBe(10_995)
  })

  it('carries a large but safe amount through unchanged', () => {
    expect(
      taxableBaseMinor(taxRequest({ shippingMinor: 0, subtotalMinor: Number.MAX_SAFE_INTEGER })),
    ).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('ignores the currency, because the base counts that currency’s own minor units', () => {
    // The code travels with the amount for reconciliation; it is not a conversion instruction.
    expect(taxableBaseMinor(taxRequest({ currency: 'GBP' }))).toBe(
      taxableBaseMinor(taxRequest({ currency: 'EUR' })),
    )
  })

  it('ignores the address, because what is charged for does not change with where it ships', () => {
    expect(taxableBaseMinor(taxRequest({ address: address() }))).toBe(
      taxableBaseMinor(taxRequest({ address: null })),
    )
  })
})

describe('whether a destination can be asked about at all', () => {
  it('refuses a null address — the ordinary state of a bag, not an error', () => {
    expect(isCalculableAddress(null)).toBe(false)
  })

  it('accepts a two-letter country code, the minimum a tax engine needs', () => {
    expect(isCalculableAddress(address({ country: 'US' }))).toBe(true)
    expect(isCalculableAddress(address({ country: 'GB' }))).toBe(true)
  })

  it('normalises case and surrounding whitespace before judging the code', () => {
    expect(isCalculableAddress(address({ country: 'gb' }))).toBe(true)
    expect(isCalculableAddress(address({ country: '  us  ' }))).toBe(true)
  })

  it('accepts a code that is not an assigned country, because the set belongs to the provider', () => {
    /*
     * Deliberate: `fields/address.ts` enforces the *format* and leaves the *set* to whoever is being
     * asked. Hard-coding an ISO list here would be this module claiming knowledge it does not have.
     */
    expect(isCalculableAddress(address({ country: 'ZZ' }))).toBe(true)
  })

  it('refuses anything that is not exactly two letters', () => {
    expect(isCalculableAddress(address({ country: '' }))).toBe(false)
    expect(isCalculableAddress(address({ country: '   ' }))).toBe(false)
    expect(isCalculableAddress(address({ country: 'U' }))).toBe(false)
    expect(isCalculableAddress(address({ country: 'USA' }))).toBe(false)
    expect(isCalculableAddress(address({ country: '12' }))).toBe(false)
    expect(isCalculableAddress(address({ country: 'U1' }))).toBe(false)
    // Only the ends are trimmed — "U S" is not a country code.
    expect(isCalculableAddress(address({ country: 'U S' }))).toBe(false)
  })

  it('needs only the country — city, region and postcode narrow an answer, they do not enable one', () => {
    expect(isCalculableAddress({ city: null, country: 'FR', postalCode: null, region: null })).toBe(
      true,
    )
  })
})

describe('the deferred provider’s decision', () => {
  it('answers "pending_address" while there is no destination, which is not a failure', () => {
    expect(decideDeferredTax(taxRequest({ address: null })).status).toBe('pending_address')
  })

  it('answers "unavailable" once a destination exists — it is a deferral, not a tax engine', () => {
    expect(decideDeferredTax(taxRequest({ address: address() })).status).toBe('unavailable')
  })

  it('never answers "not_required", because that would be a claim about tax law', () => {
    /*
     * The dangerous mutation: a deferral that quietly begins guessing once its inputs improve. Phase
     * 17 branches on these two — `unavailable` must block payment, `not_required` must not.
     */
    for (const country of ['US', 'GB', 'FR', 'ZZ']) {
      expect(decideDeferredTax(taxRequest({ address: address({ country }) })).status).not.toBe(
        'not_required',
      )
    }
  })

  it('never answers "calculated", because it calculated nothing', () => {
    expect(decideDeferredTax(taxRequest({ address: address() })).status).not.toBe('calculated')
    expect(decideDeferredTax(taxRequest()).status).not.toBe('calculated')
  })

  it('never invents a number — the amount is null on both paths', () => {
    expect(decideDeferredTax(taxRequest()).amountMinor).toBeNull()
    expect(decideDeferredTax(taxRequest({ address: address() })).amountMinor).toBeNull()
  })

  it('reports no provider reference, because no provider was reached', () => {
    expect(decideDeferredTax(taxRequest()).providerRef).toBeNull()
    expect(decideDeferredTax(taxRequest({ address: address() })).providerRef).toBeNull()
  })

  it('does not consult the money — no amount can turn a deferral into an answer', () => {
    for (const subtotalMinor of [0, 1, 999_999, Number.NaN]) {
      expect(decideDeferredTax(taxRequest({ shippingMinor: 500, subtotalMinor }))).toEqual(
        PENDING_TAX,
      )
    }
  })

  it('returns the shared constants themselves, so every path yields one identical shape', () => {
    // Identity, not merely equality: there is no second construction site that could drift.
    expect(decideDeferredTax(taxRequest())).toBe(PENDING_TAX)
    expect(decideDeferredTax(taxRequest({ address: address() }))).toBe(UNAVAILABLE_TAX)
  })

  it('is pure — the same request answered twice gives the same answer', () => {
    const request = taxRequest({ address: address() })

    expect(decideDeferredTax(request)).toEqual(decideDeferredTax(request))
  })
})

describe('the four honest states of a tax amount', () => {
  it('has exactly four, and a fifth must be a deliberate edit', () => {
    /*
     * A `Record<TaxStatus, …>` is exhaustive: `pnpm typecheck` fails if a member is added or renamed
     * without this list changing too, so the union cannot grow silently and leave a caller's switch
     * with an unhandled case.
     */
    const coverage: Record<TaxStatus, true> = {
      calculated: true,
      not_required: true,
      pending_address: true,
      unavailable: true,
    }

    expect(Object.keys(coverage).sort()).toEqual([
      'calculated',
      'not_required',
      'pending_address',
      'unavailable',
    ])
  })

  it('carries null — never zero — for "pending_address": unknown is not none', () => {
    expect(PENDING_TAX.status).toBe('pending_address')
    expect(PENDING_TAX.amountMinor).toBeNull()
    // The distinction that matters: `toBeNull`, not `toBe(0)`. The two are not interchangeable.
    expect(PENDING_TAX.amountMinor).not.toBe(0)
    expect(PENDING_TAX.providerRef).toBeNull()
  })

  it('carries null — never zero — for "unavailable": a failed network call owes nobody a discount', () => {
    expect(UNAVAILABLE_TAX.status).toBe('unavailable')
    expect(UNAVAILABLE_TAX.amountMinor).toBeNull()
    expect(UNAVAILABLE_TAX.amountMinor).not.toBe(0)
    expect(UNAVAILABLE_TAX.providerRef).toBeNull()
  })

  it('keeps the two unknown states distinct, because they mean different things to checkout', () => {
    // Same amount, different status: "we have not asked yet" versus "we asked and it broke".
    expect(PENDING_TAX.amountMinor).toBe(UNAVAILABLE_TAX.amountMinor)
    expect(PENDING_TAX.status).not.toBe(UNAVAILABLE_TAX.status)
  })

  it('shows why the null must survive: coercing it produces a confident, wrong zero', () => {
    /*
     * Less a test of the module than of the rule it encodes. `Number(null)` is `0` and `null ?? 0` is
     * `0`, and either one turns "we do not know your tax" into "you owe no tax" with no error
     * anywhere. Callers must branch on `status` and never fall back on the amount.
     */
    expect(Number(PENDING_TAX.amountMinor)).toBe(0)
    expect(PENDING_TAX.amountMinor ?? 0).toBe(0)
    expect(PENDING_TAX.status).not.toBe('not_required')
  })

  it('exposes every one of §16.1c’s three named outputs, and nothing of a provider’s vocabulary', () => {
    // No tax code, jurisdiction or line-item breakdown: that is one provider's dialect, not this contract.
    for (const result of [PENDING_TAX, UNAVAILABLE_TAX]) {
      expect(Object.keys(result).sort()).toEqual(['amountMinor', 'providerRef', 'status'])
    }
  })
})

describe('what the shop says while tax is unknown', () => {
  it('defers rather than stating an amount, so no zero is ever promised', () => {
    expect(TAX_COPY.pending).toBe('Tax is calculated from your delivery address.')
    // A total that looks final while tax is unknown is the copy equivalent of a dead control.
    expect(TAX_COPY.pending).not.toMatch(/0\.00|no tax|free/i)
  })

  it('admits the failure and asks for a retry rather than proceeding on a guess', () => {
    expect(TAX_COPY.unavailable).toBe(
      'We could not calculate tax just now. Please try again in a moment.',
    )
    expect(TAX_COPY.unavailable).not.toMatch(/0\.00|no tax/i)
  })

  it('says something different in the two states, because they are different states', () => {
    expect(TAX_COPY.pending).not.toBe(TAX_COPY.unavailable)
  })
})
