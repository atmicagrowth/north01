/**
 * The Phase 16 shipping and tax boundaries, checked against the running code rather than the comments
 * that describe them.
 *
 * ```
 * pnpm verify:shipping
 * ```
 *
 * §16.1a's six normalised fields, §16.1b's validation and §16.1d's six edge cases are all named
 * checks below, in the plan's own words.
 *
 * **No database and no `payload run` needed for most of it.** Both providers are `server-only`, which
 * cannot resolve outside Next — the lesson Phase 15 learned the hard way — so every *rule* lives in
 * `lib/shipping/rules.ts` and `lib/tax/rules.ts`, which carry no guard. Section E asserts the shape of
 * the boundary itself without importing either provider, because the contract is the deliverable and
 * a contract is a type.
 */

import { cartTotals } from '../src/lib/cart/rules'
import {
  DOMESTIC_COUNTRY,
  isSupportedDestination,
  quoteShipping,
  SHIPPING_COPY,
  SHIPPING_METHODS,
  SUPPORTED_COUNTRIES,
  validateSelectedRate,
  type ShippingDestination,
  type ShippingQuoteInput,
} from '../src/lib/shipping/rules'
import {
  decideDeferredTax,
  isCalculableAddress,
  PENDING_TAX,
  taxableBaseMinor,
  TAX_COPY,
  UNAVAILABLE_TAX,
  type TaxRequest,
} from '../src/lib/tax/rules'

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

const quote = (overrides: Partial<ShippingQuoteInput> = {}) =>
  quoteShipping({
    currency: 'USD',
    destination: null,
    discountMinor: 0,
    freeShippingPromotion: false,
    freeShippingThresholdMinor: 15_000,
    subtotalMinor: 10_000,
    ...overrides,
  })

const to = (country: string): ShippingDestination => ({
  country,
  postalCode: null,
  region: null,
})

const rate = (input: ReturnType<typeof quote>, id: string) =>
  input.rates.find((candidate) => candidate.id === id)

/* =================================================================================================
 * A — §16.1a's normalised shape
 * ============================================================================================== */

check(
  'A: the demo provider offers exactly the three methods the plan names',
  SHIPPING_METHODS.map((method) => method.id).join(',') === 'standard,express,overnight',
  SHIPPING_METHODS.map((method) => method.id).join(','),
)

for (const field of [
  'amountMinor',
  'currency',
  'eligible',
  'estimate',
  'id',
  'maxDays',
  'minDays',
  'name',
] as const) {
  check(
    `A: every rate carries "${field}" — §16.1a's minimum normalised fields`,
    quote().rates.every((candidate) => candidate[field] !== undefined),
  )
}

check(
  'A: the estimate is human-readable as well as numeric, so a caller need not ask twice',
  quote().rates.every(
    (candidate) =>
      typeof candidate.estimate === 'string' &&
      candidate.estimate.length > 0 &&
      candidate.minDays <= candidate.maxDays,
  ),
)

check(
  'A: the rate carries the cart’s currency, not the provider’s idea of one',
  quote({ currency: 'GBP' }).rates.every((candidate) => candidate.currency === 'GBP'),
)

check(
  'A: an ineligible rate explains itself — "eligibility" as a bare boolean says nothing useful',
  quote({ destination: to('JP') }).rates.every(
    (candidate) => candidate.eligible || (candidate.ineligibleReason ?? '').length > 0,
  ),
)

/* =================================================================================================
 * B — Pricing, the threshold, and the coupon interaction
 * ============================================================================================== */

check(
  'B: Standard is a threshold-based price — under the threshold it costs money',
  rate(quote({ subtotalMinor: 10_000 }), 'standard')?.amountMinor === 995,
)

check(
  'B: …and over the threshold it is free',
  rate(quote({ subtotalMinor: 20_000 }), 'standard')?.amountMinor === 0,
)

check(
  'B: …and free-because-waived is marked as such, not confused with a free method',
  rate(quote({ subtotalMinor: 20_000 }), 'standard')?.waived === true,
)

check(
  'B: exactly at the threshold qualifies',
  rate(quote({ subtotalMinor: 15_000 }), 'standard')?.amountMinor === 0,
)

check(
  'B: Express is a fixed price and the threshold does not touch it',
  rate(quote({ subtotalMinor: 20_000 }), 'express')?.amountMinor === 1_995,
)

check(
  'B: Overnight is a fixed price and the threshold does not touch it either',
  rate(quote({ subtotalMinor: 20_000 }), 'overnight')?.amountMinor === 3_495,
)

check(
  'B: no configured threshold means nothing is ever waived by spend',
  rate(quote({ freeShippingThresholdMinor: null, subtotalMinor: 999_999 }), 'standard')
    ?.amountMinor === 995,
)

/* §16.1d: "Free-shipping threshold crossed because of a coupon." */
check(
  'B: §16.1d the threshold reads the DISCOUNTED subtotal — a coupon can take free delivery away',
  rate(quote({ discountMinor: 6_000, subtotalMinor: 20_000 }), 'standard')?.amountMinor === 995,
  String(rate(quote({ discountMinor: 6_000, subtotalMinor: 20_000 }), 'standard')?.amountMinor),
)

check(
  'B: …and a discount that leaves the bag above the threshold keeps it free',
  rate(quote({ discountMinor: 2_000, subtotalMinor: 20_000 }), 'standard')?.amountMinor === 0,
)

check(
  'B: a free-shipping promotion waives Standard',
  rate(quote({ freeShippingPromotion: true, subtotalMinor: 100 }), 'standard')?.amountMinor === 0,
)

check(
  'B: …and waives NOTHING else — a code must not silently upgrade the customer',
  rate(quote({ freeShippingPromotion: true, subtotalMinor: 100 }), 'express')?.amountMinor ===
    1_995 &&
    rate(quote({ freeShippingPromotion: true, subtotalMinor: 100 }), 'overnight')?.amountMinor ===
      3_495,
)

check(
  'B: the default rate is the cheapest eligible one',
  quote({ subtotalMinor: 10_000 }).defaultRateId === 'standard',
  String(quote({ subtotalMinor: 10_000 }).defaultRateId),
)

check(
  'B: …and stays the cheapest when a waiver makes it free',
  quote({ subtotalMinor: 20_000 }).defaultRateId === 'standard',
)

/* =================================================================================================
 * C — Destination, and what a missing one does and does not mean
 * ============================================================================================== */

check(
  'C: with no destination the quote says so rather than claiming eligibility',
  quote().destinationKnown === false,
)

check(
  'C: …and every rate is offered, because nothing has been ruled out',
  quote().rates.every((candidate) => candidate.eligible),
)

check(
  'C: with a supported destination the quote says the destination is known',
  quote({ destination: to('US') }).destinationKnown === true,
)

check(
  'C: §16.1d an unsupported country makes every method ineligible',
  quote({ destination: to('JP') }).rates.every((candidate) => !candidate.eligible),
)

check(
  'C: …with the country reason, not a per-method one',
  rate(quote({ destination: to('JP') }), 'standard')?.ineligibleReason ===
    SHIPPING_COPY.countryUnsupported,
)

check(
  'C: …and no default rate at all, so nothing can be preselected',
  quote({ destination: to('JP') }).defaultRateId === null,
)

check(
  'C: §16.1d Overnight is domestic-only, so a supported foreign country loses that method',
  rate(quote({ destination: to('GB') }), 'overnight')?.eligible === false,
)

check(
  'C: …while the other two survive',
  rate(quote({ destination: to('GB') }), 'standard')?.eligible === true &&
    rate(quote({ destination: to('GB') }), 'express')?.eligible === true,
)

check(
  'C: …with the domestic-only reason rather than the country one',
  rate(quote({ destination: to('GB') }), 'overnight')?.ineligibleReason ===
    SHIPPING_COPY.domesticOnly,
)

check(
  'C: Overnight is available at home',
  rate(quote({ destination: to(DOMESTIC_COUNTRY) }), 'overnight')?.eligible === true,
)

check(
  'C: a lower-case country code still resolves — an address is not a shouting match',
  rate(quote({ destination: to('gb') }), 'standard')?.eligible === true,
)

check(
  'C: a padded country code resolves too',
  rate(quote({ destination: to('  US  ') }), 'overnight')?.eligible === true,
)

check(
  'C: §16.1d an invalid address is not a supported destination',
  !isSupportedDestination(to('USA')) &&
    !isSupportedDestination(to('')) &&
    !isSupportedDestination(null),
)

check('C: …and a real one is', isSupportedDestination(to('US')) && isSupportedDestination(to('gb')))

check(
  'C: the domestic country is one we actually ship to',
  SUPPORTED_COUNTRIES.includes(DOMESTIC_COUNTRY),
)

/* =================================================================================================
 * D — §16.1b: the browser may not invent a shipping price
 * ============================================================================================== */

check(
  'D: a valid selection returns the rate from the QUOTE, not from the request',
  validateSelectedRate('express', quote()).ok === true,
)

{
  const validated = validateSelectedRate('express', quote({ subtotalMinor: 20_000 }))

  check(
    'D: …and its price is the provider’s, whatever the browser thought',
    validated.ok && validated.rate.amountMinor === 1_995,
    validated.ok ? String(validated.rate.amountMinor) : 'refused',
  )
}

check(
  'D: a method that does not exist is refused',
  validateSelectedRate('helicopter', quote()).ok === false,
)

check(
  'D: …with the "no longer available" reason — the customer should pick another',
  (validateSelectedRate('helicopter', quote()) as { reason: string }).reason ===
    SHIPPING_COPY.methodGone,
)

check(
  'D: §16.1d a method that exists but cannot serve the destination is refused',
  validateSelectedRate('overnight', quote({ destination: to('GB') })).ok === false,
)

check(
  'D: …with the ELIGIBILITY reason, which is a different fix from "pick another"',
  (validateSelectedRate('overnight', quote({ destination: to('GB') })) as { reason: string })
    .reason === SHIPPING_COPY.domesticOnly,
)

check('D: no selection at all is refused', validateSelectedRate(null, quote()).ok === false)

check(
  'D: §16.1d "address changes after shipping method selection" — the same id revalidates against the NEW quote',
  validateSelectedRate('overnight', quote({ destination: to('US') })).ok === true &&
    validateSelectedRate('overnight', quote({ destination: to('FR') })).ok === false,
)

/* =================================================================================================
 * E — §16.1c: the tax boundary
 * ============================================================================================== */

const taxRequest = (overrides: Partial<TaxRequest> = {}): TaxRequest => ({
  address: null,
  currency: 'USD',
  discountMinor: 0,
  shippingMinor: 995,
  subtotalMinor: 10_000,
  ...overrides,
})

check(
  'E: the taxable base is subtotal less discount plus shipping — §16.1c’s first three inputs',
  taxableBaseMinor(taxRequest({ discountMinor: 1_000 })) === 9_995,
  String(taxableBaseMinor(taxRequest({ discountMinor: 1_000 }))),
)

check(
  'E: a discount larger than the bag cannot make the base negative',
  taxableBaseMinor(taxRequest({ discountMinor: 99_999, shippingMinor: 0 })) === 0,
)

check(
  'E: shipping is taxable — it is part of what is being charged for',
  taxableBaseMinor(taxRequest({ shippingMinor: 500 })) >
    taxableBaseMinor(taxRequest({ shippingMinor: 0 })),
)

check('E: no address means the tax question cannot be answered', !isCalculableAddress(null))

check(
  'E: …nor can a malformed country',
  !isCalculableAddress({ city: null, country: 'USA', postalCode: null, region: null }),
)

check(
  'E: …and a real one can be asked',
  isCalculableAddress({ city: null, country: 'us', postalCode: null, region: null }),
)

check(
  'E: the pending result carries NULL rather than zero — zero would claim no tax is owed',
  PENDING_TAX.amountMinor === null && PENDING_TAX.status === 'pending_address',
)

check(
  'E: §16.1d the unavailable result also carries null, and a different status',
  UNAVAILABLE_TAX.amountMinor === null && UNAVAILABLE_TAX.status === 'unavailable',
)

check(
  'E: the two are distinguishable — one may proceed to checkout and the other may not',
  PENDING_TAX.status !== UNAVAILABLE_TAX.status,
)

check(
  'E: every tax result carries a provider reference slot, per §16.1c',
  'providerRef' in PENDING_TAX && 'providerRef' in UNAVAILABLE_TAX,
)

check(
  'E: the deferred provider answers pending while there is no address',
  decideDeferredTax(taxRequest()).status === 'pending_address',
)

check(
  'E: …and REFUSES TO GUESS when handed one — a deferral must not start inventing numbers',
  decideDeferredTax(
    taxRequest({ address: { city: null, country: 'US', postalCode: null, region: null } }),
  ).status === 'unavailable',
)

check(
  'E: …answering "unavailable" rather than "not_required", which would be a claim about tax law',
  decideDeferredTax(
    taxRequest({ address: { city: null, country: 'US', postalCode: null, region: null } }),
  ).status !== 'not_required',
)

check(
  'E: neither answer ever carries an amount',
  decideDeferredTax(taxRequest()).amountMinor === null &&
    decideDeferredTax(
      taxRequest({ address: { city: null, country: 'GB', postalCode: null, region: null } }),
    ).amountMinor === null,
)

check(
  'E: the copy tells the customer what happens, not what broke',
  TAX_COPY.pending.length > 0 && TAX_COPY.unavailable.length > 0 && !/\d/.test(TAX_COPY.pending),
)

/* =================================================================================================
 * F — The bag's totals carry both
 * ============================================================================================== */

const line = [{ quantity: 1, unitPriceMinor: 10_000 }]

check(
  'F: shipping and tax both null leaves the totals not final',
  cartTotals(line).isFinal === false,
)

check(
  'F: a quoted shipping amount appears in the total',
  cartTotals(line, null, 995).totalMinor === 10_995,
)

check(
  'F: …and is still not final while tax is unknown',
  cartTotals(line, null, 995).isFinal === false,
)

check(
  'F: all four known makes the totals FINAL — the property Phase 14 built this shape for',
  cartTotals(line, 1_000, 995, 800).isFinal === true,
)

check(
  'F: …and the total is subtotal − discount + shipping + tax',
  cartTotals(line, 1_000, 995, 800).totalMinor === 10_795,
  String(cartTotals(line, 1_000, 995, 800).totalMinor),
)

check(
  'F: free shipping is a shipping amount of zero, which is NOT the same as unknown',
  cartTotals(line, null, 0).shippingMinor === 0 &&
    cartTotals(line, null, null).shippingMinor === null,
)

check(
  'F: a zero tax is a fact and the totals are final; a null tax is unknown and they are not',
  cartTotals(line, null, 0, 0).isFinal === true &&
    cartTotals(line, null, 0, null).isFinal === false,
)

check(
  'F: a bag with NO discount code can still reach a final total — an absent discount is not unknown',
  cartTotals(line, null, 995, 800).isFinal === true,
)

check(
  'F: …and its total is simply subtotal + shipping + tax',
  cartTotals(line, null, 995, 800).totalMinor === 11_795,
  String(cartTotals(line, null, 995, 800).totalMinor),
)

/* =================================================================================================
 * G — Hostile and impossible inputs
 *
 * A boundary's failure modes are arithmetic, not pixels: an amount that goes negative, a currency
 * that changes under a quote, a default that points at something ineligible. These were written as a
 * post-implementation sweep and moved here, because a check that found a defect belongs where it
 * will be run again.
 * ============================================================================================== */

/* ---------------------------------------------------------------- hostile numbers */

check(
  'a negative subtotal cannot make a rate negative',
  quote({ subtotalMinor: -99_999 }).rates.every((candidate) => candidate.amountMinor >= 0),
)

check(
  'a negative discount is treated as none rather than as extra spend',
  quote({ discountMinor: -99_999, subtotalMinor: 10_000 }).rates.find(
    (candidate) => candidate.id === 'standard',
  )?.amountMinor === 995,
)

check(
  'a discount larger than the bag cannot loop the threshold back around',
  quote({ discountMinor: 999_999, subtotalMinor: 20_000 }).rates.find(
    (candidate) => candidate.id === 'standard',
  )?.amountMinor === 995,
)

check(
  'a fractional subtotal is floored, so a bag one cent short does not qualify',
  quote({ freeShippingThresholdMinor: 15_000, subtotalMinor: 14_999.9 }).rates.find(
    (candidate) => candidate.id === 'standard',
  )?.amountMinor === 995,
)

check(
  'a negative threshold is not treated as "everything qualifies"',
  quote({ freeShippingThresholdMinor: -1, subtotalMinor: 1 }).rates.find(
    (candidate) => candidate.id === 'standard',
  )?.amountMinor === 995,
  String(
    quote({ freeShippingThresholdMinor: -1, subtotalMinor: 1 }).rates.find(
      (candidate) => candidate.id === 'standard',
    )?.amountMinor,
  ),
)

check(
  'a zero threshold means everything ships free, which is a shop’s decision to make',
  quote({ freeShippingThresholdMinor: 0, subtotalMinor: 1 }).rates.find(
    (candidate) => candidate.id === 'standard',
  )?.amountMinor === 0,
)

check(
  'NaN in the subtotal cannot produce NaN in a rate',
  quote({ subtotalMinor: NaN }).rates.every((candidate) => Number.isFinite(candidate.amountMinor)),
)

/* ---------------------------------------------------------------- the default rate */

check(
  'the default is never an ineligible rate',
  ['US', 'GB', 'JP', 'FR'].every((country) => {
    const answer = quote({ destination: { country, postalCode: null, region: null } })
    if (answer.defaultRateId === null) return true
    return (
      answer.rates.find((candidate) => candidate.id === answer.defaultRateId)?.eligible === true
    )
  }),
)

check(
  'the default is always the cheapest eligible rate, at every threshold state',
  [0, 10_000, 20_000].every((subtotalMinor) => {
    const answer = quote({ subtotalMinor })
    const eligible = answer.rates.filter((candidate) => candidate.eligible)
    const cheapest = Math.min(...eligible.map((candidate) => candidate.amountMinor))
    return (
      answer.rates.find((candidate) => candidate.id === answer.defaultRateId)?.amountMinor ===
      cheapest
    )
  }),
)

check(
  'a country where only one method survives defaults to that method',
  quote({ destination: { country: 'GB', postalCode: null, region: null }, subtotalMinor: 20_000 })
    .defaultRateId === 'standard',
)

/* ---------------------------------------------------------------- validation cannot be tricked */

check(
  'validation refuses an id from a DIFFERENT quote — the rate must come from this one',
  validateSelectedRate(
    'overnight',
    quote({ destination: { country: 'FR', postalCode: null, region: null } }),
  ).ok === false,
)

check(
  'validation refuses an empty string, an object-ish string and a number-ish string alike',
  ['', '0', '[object Object]', 'STANDARD', 'standard '].every(
    (id) => validateSelectedRate(id, quote()).ok === false,
  ),
  ['', '0', '[object Object]', 'STANDARD', 'standard ']
    .filter((id) => validateSelectedRate(id, quote()).ok)
    .join(','),
)

{
  const validated = validateSelectedRate('standard', quote({ subtotalMinor: 20_000 }))
  check(
    'G: a waived rate validates at zero, and says it was waived rather than being free',
    validated.ok && validated.rate.amountMinor === 0 && validated.rate.waived,
  )
}

/* ---------------------------------------------------------------- currency */

check(
  'the quote never mixes currencies within one answer',
  (['USD', 'GBP', 'EUR'] as const).every((currency) =>
    quote({ currency }).rates.every((candidate) => candidate.currency === currency),
  ),
)

check(
  'every method in the card is offered in every quote, eligible or not — a hidden method cannot be chosen or explained',
  quote({ destination: { country: 'JP', postalCode: null, region: null } }).rates.length ===
    SHIPPING_METHODS.length,
)

/* ---------------------------------------------------------------- destinations */

check(
  'every supported country is a two-letter upper-case code',
  SUPPORTED_COUNTRIES.every((country) => /^[A-Z]{2}$/.test(country)),
  SUPPORTED_COUNTRIES.filter((country) => !/^[A-Z]{2}$/.test(country)).join(','),
)

check(
  'the supported list has no duplicates',
  new Set(SUPPORTED_COUNTRIES).size === SUPPORTED_COUNTRIES.length,
)

check(
  'a country code with a null byte or whitespace injection is not supported',
  ['US ', 'U S', 'US;DROP', ' '].every(
    (country) => !isSupportedDestination({ country, postalCode: null, region: null }),
  ),
)

check(
  'a lower-case supported country is supported',
  isSupportedDestination({ country: 'gb', postalCode: null, region: null }),
)

/* ---------------------------------------------------------------- tax */

check(
  'the taxable base never goes negative, whatever the inputs',
  [
    { discountMinor: 99_999, shippingMinor: 0, subtotalMinor: 100 },
    { discountMinor: -5, shippingMinor: -5, subtotalMinor: -5 },
    { discountMinor: NaN, shippingMinor: 0, subtotalMinor: 100 },
  ].every(
    (partial) =>
      Number.isFinite(
        taxableBaseMinor({ address: null, currency: 'USD', ...partial } as TaxRequest),
      ) && taxableBaseMinor({ address: null, currency: 'USD', ...partial } as TaxRequest) >= 0,
  ),
)

check(
  'an address with a three-letter country cannot be calculated against',
  !isCalculableAddress({ city: null, country: 'USA', postalCode: null, region: null }),
)

/* ---------------------------------------------------------------- totals */

check(
  'a shipping amount cannot be negative in the totals',
  cartTotals([{ quantity: 1, unitPriceMinor: 1_000 }], null, -500).shippingMinor === 0,
)

check(
  'a tax amount cannot be negative in the totals',
  cartTotals([{ quantity: 1, unitPriceMinor: 1_000 }], null, 0, -500).taxMinor === 0,
)

check(
  'the total is never negative even when the discount exceeds everything',
  cartTotals([{ quantity: 1, unitPriceMinor: 1_000 }], 99_999, 0, 0).totalMinor === 0,
)

check(
  'shipping is added AFTER the discount, so a coupon never discounts delivery',
  cartTotals([{ quantity: 1, unitPriceMinor: 1_000 }], 1_000, 995, 0).totalMinor === 995,
  String(cartTotals([{ quantity: 1, unitPriceMinor: 1_000 }], 1_000, 995, 0).totalMinor),
)

/* -------------------------------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------------------------------- */

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} shipping and tax checks passed.`,
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

if (failed.length > 0) {
  throw new Error(`${failed.length} shipping/tax check(s) failed.`)
}
