import { describe, expect, it } from 'vitest'

import {
  DOMESTIC_COUNTRY,
  isSupportedDestination,
  quoteShipping,
  SHIPPING_COPY,
  SHIPPING_METHODS,
  SUPPORTED_COUNTRIES,
  validateSelectedRate,
  type ShippingDestination,
  type ShippingMethodId,
  type ShippingQuote,
  type ShippingQuoteInput,
} from '@/lib/shipping/rules'

/**
 * **Plan §27.1a — "Shipping calculations", over the pure rules of §16.1a and §16.1b.**
 *
 * `lib/shipping/rules.ts` is the half of the shipping phase with no provider, no request and no
 * database behind it: the normalised rate shape, the pricing of one cart against the static card,
 * and the server-side validation of whatever id the browser claims it picked. `provider.ts` is
 * guarded with `import 'server-only'` and is deliberately not exercised here.
 *
 * ### The failure modes this file is written to catch
 *
 * - **`null` threshold and `0` threshold are different facts.** `null` means *no threshold is
 *   configured* — nothing is ever waived by spend. `0` means *the threshold is zero* — every cart
 *   clears it, including an empty one. A single truthiness check (`if (threshold)`) collapses the
 *   two and silently stops giving delivery away the moment an editor sets the threshold to zero.
 * - **Threshold boundaries.** One minor unit under, exactly on, one minor unit over. `>` where
 *   `>=` was meant loses free delivery for the customer who spent exactly the advertised amount.
 * - **Which subtotal the threshold reads.** §16.1d names *"free-shipping threshold crossed because
 *   of a coupon"*; the module compares the **discounted** spend, so a coupon can take free delivery
 *   away. That is the documented, deliberate direction, and the bag's progress copy reads the same
 *   number — a test that pinned the pre-discount subtotal would be pinning a bug.
 * - **A waiver is not an upgrade.** A `free_shipping` promotion waives Standard and nothing else.
 *   A promotion that quietly paid for Overnight is real money per order that nobody authorised.
 * - **`destinationKnown: false`.** Every rate comes back `eligible: true` because nothing has been
 *   *ruled out*, not because anything has been *confirmed*. Price is knowable without an address;
 *   eligibility is not, and a caller that reads the former as the latter is reading it wrong.
 * - **The browser is never authoritative.** `validateSelectedRate` answers with the rate object out
 *   of a quote produced now — never with anything derived from what was submitted.
 * - **Money stays in integer minor units.** No division happens anywhere in this module; a
 *   fractional or non-finite input must coerce, not propagate. `NaN >= threshold` is `false`, so a
 *   poisoned amount can *look* safe by luck — these tests assert the coercion, not the luck.
 */

/* ------------------------------------------------------------------------------------------------
 * Fixtures
 * --------------------------------------------------------------------------------------------- */

/** $150.00, in the minor units everything in this project speaks. */
const THRESHOLD = 15_000

const quote = (overrides: Partial<ShippingQuoteInput> = {}): ShippingQuote =>
  quoteShipping({
    currency: 'USD',
    destination: null,
    discountMinor: 0,
    freeShippingPromotion: false,
    freeShippingThresholdMinor: null,
    subtotalMinor: 0,
    ...overrides,
  })

const to = (country: string): ShippingDestination => ({
  country,
  postalCode: null,
  region: null,
})

const rateOf = (result: ShippingQuote, id: null | string) => {
  const rate = result.rates.find((candidate) => candidate.id === id)

  if (rate === undefined) {
    throw new Error(`The quote is missing the "${id}" rate entirely.`)
  }

  return rate
}

/** The card's own list price, so no test hard-codes a number the card owns. */
const listPrice = (id: ShippingMethodId): number => {
  const method = SHIPPING_METHODS.find((candidate) => candidate.id === id)

  if (method === undefined) {
    throw new Error(`No such shipping method: ${id}`)
  }

  return method.amountMinor
}

/* ------------------------------------------------------------------------------------------------
 * The static rate card
 * --------------------------------------------------------------------------------------------- */

describe('the static rate card', () => {
  it('prices every method in whole minor units, because division happens only at a formatting boundary', () => {
    for (const method of SHIPPING_METHODS) {
      expect(Number.isSafeInteger(method.amountMinor)).toBe(true)
      expect(method.amountMinor).toBeGreaterThan(0)
    }
  })

  it('lists methods cheapest first, which is what makes the preselected rate stable', () => {
    expect(SHIPPING_METHODS.map((method) => method.id)).toEqual([
      'standard',
      'express',
      'overnight',
    ])

    // Strictly ascending and with no duplicates: a tie would make "cheapest eligible" depend on
    // array order alone, and the default rate would move for no reason a customer could see.
    const amounts = SHIPPING_METHODS.map((method) => method.amountMinor)
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b))
    expect(new Set(amounts).size).toBe(amounts.length)
  })

  it('marks exactly one method waivable, because "free shipping" means the standard delivery', () => {
    expect(SHIPPING_METHODS.filter((method) => method.waivable).map((method) => method.id)).toEqual(
      ['standard'],
    )
  })

  it('offers Overnight only domestically, because a next-day promise across a border is unkeepable', () => {
    expect(
      SHIPPING_METHODS.filter((method) => method.domesticOnly).map((method) => method.id),
    ).toEqual(['overnight'])
    expect(SUPPORTED_COUNTRIES).toContain(DOMESTIC_COUNTRY)
  })
})

/* ------------------------------------------------------------------------------------------------
 * Quoting with no destination
 * --------------------------------------------------------------------------------------------- */

describe('a quote with no destination', () => {
  it('reports destinationKnown: false, so a caller cannot mistake "not ruled out" for "confirmed"', () => {
    expect(quote({ destination: null, subtotalMinor: 5_000 }).destinationKnown).toBe(false)
  })

  it('marks every rate eligible with no reason attached, because nothing has been checked yet', () => {
    const result = quote({ destination: null, subtotalMinor: 5_000 })

    expect(result.rates).toHaveLength(SHIPPING_METHODS.length)

    for (const rate of result.rates) {
      expect(rate.eligible).toBe(true)
      // `ineligibleReason` is the "why not", and must stay null while there is no "not".
      expect(rate.ineligibleReason).toBeNull()
    }
  })

  it('still quotes a price, because price depends on the cart and only eligibility depends on the address', () => {
    const result = quote({ destination: null, subtotalMinor: 5_000 })

    expect(rateOf(result, 'standard').amountMinor).toBe(listPrice('standard'))
    expect(rateOf(result, 'overnight').amountMinor).toBe(listPrice('overnight'))
  })

  it('still preselects the cheapest rate, so the bag has something honest to show', () => {
    expect(quote({ destination: null, subtotalMinor: 5_000 }).defaultRateId).toBe('standard')
  })
})

/* ------------------------------------------------------------------------------------------------
 * The free-shipping threshold
 * --------------------------------------------------------------------------------------------- */

describe('the free-shipping threshold', () => {
  it('charges the list price one minor unit under the threshold', () => {
    const standard = rateOf(
      quote({ freeShippingThresholdMinor: THRESHOLD, subtotalMinor: THRESHOLD - 1 }),
      'standard',
    )

    expect(standard.amountMinor).toBe(listPrice('standard'))
    expect(standard.waived).toBe(false)
  })

  it('waives the fee exactly at the threshold, because the advertised number is the number', () => {
    const standard = rateOf(
      quote({ freeShippingThresholdMinor: THRESHOLD, subtotalMinor: THRESHOLD }),
      'standard',
    )

    expect(standard.amountMinor).toBe(0)
    // `waived` is what tells the UI this zero is a concession, not a zero-priced method.
    expect(standard.waived).toBe(true)
  })

  it('waives the fee one minor unit over the threshold', () => {
    const standard = rateOf(
      quote({ freeShippingThresholdMinor: THRESHOLD, subtotalMinor: THRESHOLD + 1 }),
      'standard',
    )

    expect(standard.amountMinor).toBe(0)
    expect(standard.waived).toBe(true)
  })

  it('leaves Express and Overnight at full price however far past the threshold the cart is', () => {
    const result = quote({ freeShippingThresholdMinor: THRESHOLD, subtotalMinor: 10_000_000 })

    expect(rateOf(result, 'express').amountMinor).toBe(listPrice('express'))
    expect(rateOf(result, 'express').waived).toBe(false)
    expect(rateOf(result, 'overnight').amountMinor).toBe(listPrice('overnight'))
    expect(rateOf(result, 'overnight').waived).toBe(false)
  })

  it('preselects the waived Standard rate, since zero is the cheapest thing on offer', () => {
    expect(
      quote({ freeShippingThresholdMinor: THRESHOLD, subtotalMinor: THRESHOLD }).defaultRateId,
    ).toBe('standard')
  })
})

describe('a threshold of zero and a threshold of null', () => {
  it('ships everything free at a threshold of 0, because every cart clears zero — even an empty one', () => {
    const empty = rateOf(quote({ freeShippingThresholdMinor: 0, subtotalMinor: 0 }), 'standard')

    expect(empty.amountMinor).toBe(0)
    expect(empty.waived).toBe(true)
  })

  it('never waives anything at a threshold of null, because null means no threshold exists', () => {
    const rich = rateOf(
      quote({ freeShippingThresholdMinor: null, subtotalMinor: 10_000_000 }),
      'standard',
    )

    expect(rich.amountMinor).toBe(listPrice('standard'))
    expect(rich.waived).toBe(false)
  })

  it('answers oppositely for 0 and null on one identical cart — they are not interchangeable', () => {
    const zero = rateOf(quote({ freeShippingThresholdMinor: 0, subtotalMinor: 500 }), 'standard')
    const none = rateOf(quote({ freeShippingThresholdMinor: null, subtotalMinor: 500 }), 'standard')

    // The assertion this whole block exists for: a truthiness check collapses these two.
    expect(zero.waived).not.toBe(none.waived)
    expect(zero.amountMinor).toBe(0)
    expect(none.amountMinor).toBe(listPrice('standard'))
  })
})

describe('a threshold that is not a usable number', () => {
  it('floors a fractional threshold rather than comparing against a fraction', () => {
    // floor(15000.99) is 15000, so a cart of exactly 15000 clears it and one of 14999 does not.
    const onFloor = rateOf(
      quote({ freeShippingThresholdMinor: THRESHOLD + 0.99, subtotalMinor: THRESHOLD }),
      'standard',
    )
    const underFloor = rateOf(
      quote({ freeShippingThresholdMinor: THRESHOLD + 0.99, subtotalMinor: THRESHOLD - 1 }),
      'standard',
    )

    expect(onFloor.waived).toBe(true)
    expect(underFloor.waived).toBe(false)
  })

  it('refuses to waive on a NaN threshold instead of letting the poison decide', () => {
    expect(
      rateOf(quote({ freeShippingThresholdMinor: NaN, subtotalMinor: 10_000_000 }), 'standard')
        .waived,
    ).toBe(false)
  })

  it('refuses to waive on an infinite threshold, which is the safe reading of "unreachable"', () => {
    expect(
      rateOf(
        quote({ freeShippingThresholdMinor: Number.POSITIVE_INFINITY, subtotalMinor: 10_000_000 }),
        'standard',
      ).waived,
    ).toBe(false)
  })

  it('fails closed on a negative threshold rather than reading it as "everything free"', () => {
    // -1 is nonsense config. The module declines to give delivery away on it; a threshold of 0 is
    // the supported way to say "free for everyone", and it is asserted above.
    const negative = rateOf(
      quote({ freeShippingThresholdMinor: -1, subtotalMinor: 10_000_000 }),
      'standard',
    )

    expect(negative.waived).toBe(false)
    expect(negative.amountMinor).toBe(listPrice('standard'))
  })
})

/* ------------------------------------------------------------------------------------------------
 * Which spend the threshold is measured against
 * --------------------------------------------------------------------------------------------- */

describe('the spend the threshold is measured against', () => {
  it('subtracts the discount first, so applying a coupon can take free delivery away', () => {
    const beforeCoupon = rateOf(
      quote({ discountMinor: 0, freeShippingThresholdMinor: THRESHOLD, subtotalMinor: THRESHOLD }),
      'standard',
    )
    const afterCoupon = rateOf(
      quote({ discountMinor: 1, freeShippingThresholdMinor: THRESHOLD, subtotalMinor: THRESHOLD }),
      'standard',
    )

    expect(beforeCoupon.waived).toBe(true)
    // Documented and deliberate: a threshold is a statement about what the customer actually spends.
    expect(afterCoupon.waived).toBe(false)
    expect(afterCoupon.amountMinor).toBe(listPrice('standard'))
  })

  it('clamps spend at zero when the discount exceeds the subtotal, never going negative', () => {
    const result = quote({
      discountMinor: 999_999,
      freeShippingThresholdMinor: 1,
      subtotalMinor: 100,
    })

    expect(rateOf(result, 'standard').waived).toBe(false)
    expect(rateOf(result, 'standard').amountMinor).toBe(listPrice('standard'))
  })

  it('coerces a NaN subtotal to zero instead of letting NaN comparisons decide by luck', () => {
    // A threshold of 0 is cleared by any real spend, so this proves NaN actually became 0 rather
    // than merely proving that `NaN >= threshold` happened to fall the safe way.
    expect(
      rateOf(quote({ freeShippingThresholdMinor: 0, subtotalMinor: NaN }), 'standard').waived,
    ).toBe(true)
    expect(
      rateOf(quote({ freeShippingThresholdMinor: 1, subtotalMinor: NaN }), 'standard').waived,
    ).toBe(false)
  })

  it('coerces an infinite subtotal to zero, so an unbounded number cannot buy free delivery', () => {
    expect(
      rateOf(
        quote({
          freeShippingThresholdMinor: THRESHOLD,
          subtotalMinor: Number.POSITIVE_INFINITY,
        }),
        'standard',
      ).waived,
    ).toBe(false)
  })

  it('treats a negative subtotal as zero spend', () => {
    expect(
      rateOf(quote({ freeShippingThresholdMinor: 1, subtotalMinor: -50_000 }), 'standard').waived,
    ).toBe(false)
  })

  it('floors a fractional subtotal, so a fraction cannot creep across the threshold', () => {
    // 14999.99 floors to 14999 and stays one unit short; nothing rounds its way in.
    expect(
      rateOf(
        quote({ freeShippingThresholdMinor: THRESHOLD, subtotalMinor: THRESHOLD - 0.01 }),
        'standard',
      ).waived,
    ).toBe(false)
  })

  it('ignores a NaN discount rather than poisoning the spend it is subtracted from', () => {
    expect(
      rateOf(
        quote({
          discountMinor: NaN,
          freeShippingThresholdMinor: THRESHOLD,
          subtotalMinor: THRESHOLD,
        }),
        'standard',
      ).waived,
    ).toBe(true)
  })
})

/* ------------------------------------------------------------------------------------------------
 * The free-shipping promotion
 * --------------------------------------------------------------------------------------------- */

describe('a free-shipping promotion', () => {
  it('waives Standard on a small cart with no threshold configured at all', () => {
    const standard = rateOf(
      quote({ freeShippingPromotion: true, freeShippingThresholdMinor: null, subtotalMinor: 100 }),
      'standard',
    )

    expect(standard.amountMinor).toBe(0)
    expect(standard.waived).toBe(true)
  })

  it('overrides a paid rate that the threshold alone would have left standing', () => {
    const withoutPromotion = rateOf(
      quote({ freeShippingThresholdMinor: THRESHOLD, subtotalMinor: 1_000 }),
      'standard',
    )
    const withPromotion = rateOf(
      quote({
        freeShippingPromotion: true,
        freeShippingThresholdMinor: THRESHOLD,
        subtotalMinor: 1_000,
      }),
      'standard',
    )

    expect(withoutPromotion.amountMinor).toBe(listPrice('standard'))
    expect(withPromotion.amountMinor).toBe(0)
    expect(withPromotion.waived).toBe(true)
  })

  it('does not upgrade the customer to Express or Overnight, because that is a promotion nobody wrote', () => {
    const result = quote({ freeShippingPromotion: true, subtotalMinor: 1_000 })

    expect(rateOf(result, 'express').amountMinor).toBe(listPrice('express'))
    expect(rateOf(result, 'express').waived).toBe(false)
    expect(rateOf(result, 'overnight').amountMinor).toBe(listPrice('overnight'))
    expect(rateOf(result, 'overnight').waived).toBe(false)
  })

  it('is idempotent with the threshold — two reasons to waive still waive exactly once', () => {
    const standard = rateOf(
      quote({
        freeShippingPromotion: true,
        freeShippingThresholdMinor: THRESHOLD,
        subtotalMinor: THRESHOLD,
      }),
      'standard',
    )

    expect(standard.amountMinor).toBe(0)
    expect(standard.waived).toBe(true)
  })
})

/* ------------------------------------------------------------------------------------------------
 * Destinations
 * --------------------------------------------------------------------------------------------- */

describe('an unavailable destination', () => {
  it('rules out every rate for an unsupported country and names the country as the reason', () => {
    const result = quote({ destination: to('JP'), subtotalMinor: 20_000 })

    for (const rate of result.rates) {
      expect(rate.eligible).toBe(false)
      expect(rate.ineligibleReason).toBe(SHIPPING_COPY.countryUnsupported)
    }
  })

  it('preselects nothing when nothing is eligible, rather than a rate that cannot be bought', () => {
    // A default pointing at an unbuyable rate is exactly "a control that looks functional but does
    // nothing", which this project forbids.
    expect(quote({ destination: to('JP'), subtotalMinor: 20_000 }).defaultRateId).toBeNull()
  })

  it('still reports destinationKnown: true when the known destination is one it refuses', () => {
    // destinationKnown answers "was an address supplied", not "is the address serviceable".
    expect(quote({ destination: to('JP') }).destinationKnown).toBe(true)
  })

  it('rules out only Overnight abroad, and says so with the domestic reason rather than the country one', () => {
    const result = quote({ destination: to('GB'), subtotalMinor: 20_000 })

    expect(rateOf(result, 'standard').eligible).toBe(true)
    expect(rateOf(result, 'standard').ineligibleReason).toBeNull()
    expect(rateOf(result, 'express').eligible).toBe(true)
    expect(rateOf(result, 'overnight').eligible).toBe(false)
    // Two different refusals on purpose: a customer told the wrong one tries the wrong fix.
    expect(rateOf(result, 'overnight').ineligibleReason).toBe(SHIPPING_COPY.domesticOnly)
    expect(SHIPPING_COPY.domesticOnly).not.toBe(SHIPPING_COPY.countryUnsupported)
  })

  it('offers all three methods domestically', () => {
    const result = quote({ destination: to(DOMESTIC_COUNTRY), subtotalMinor: 20_000 })

    expect(result.rates.every((rate) => rate.eligible)).toBe(true)
    expect(result.defaultRateId).toBe('standard')
  })

  it('normalises case and surrounding whitespace before deciding, so " us " is the United States', () => {
    const result = quote({ destination: to('  us  '), subtotalMinor: 20_000 })

    expect(result.rates.every((rate) => rate.eligible)).toBe(true)
    expect(result.defaultRateId).toBe('standard')
  })

  it('prices an ineligible rate anyway, so nothing downstream has to invent a number', () => {
    expect(rateOf(quote({ destination: to('GB') }), 'overnight').amountMinor).toBe(
      listPrice('overnight'),
    )
  })
})

describe('isSupportedDestination', () => {
  it('answers false for a null destination, because unknown is not the same as supported', () => {
    expect(isSupportedDestination(null)).toBe(false)
  })

  it('accepts a served country however it is cased or padded', () => {
    expect(isSupportedDestination(to('US'))).toBe(true)
    expect(isSupportedDestination(to('gb'))).toBe(true)
    expect(isSupportedDestination(to(' ie '))).toBe(true)
  })

  it('rejects a well-formed country the provider does not serve', () => {
    expect(isSupportedDestination(to('JP'))).toBe(false)
    expect(isSupportedDestination(to('ZZ'))).toBe(false)
  })

  it('rejects anything that is not two letters, because a valid format is not a country', () => {
    // 'USA' is the alpha-3 code for a country we do serve, and is still not an alpha-2 code.
    expect(isSupportedDestination(to('USA'))).toBe(false)
    expect(isSupportedDestination(to('U'))).toBe(false)
    expect(isSupportedDestination(to(''))).toBe(false)
    expect(isSupportedDestination(to('U1'))).toBe(false)
  })

  it('agrees with the quote: a destination it rejects leaves no eligible rate', () => {
    for (const country of ['JP', 'ZZ', 'USA', '']) {
      expect(isSupportedDestination(to(country))).toBe(false)
      expect(quote({ destination: to(country) }).defaultRateId).toBeNull()
    }
  })
})

/* ------------------------------------------------------------------------------------------------
 * Validating what the browser sent
 * --------------------------------------------------------------------------------------------- */

describe('validateSelectedRate', () => {
  it('answers with the object out of the live quote, never with anything the browser submitted', () => {
    const result = quote({ destination: to('US'), subtotalMinor: 20_000 })
    const validated = validateSelectedRate('overnight', result)

    expect(validated.ok).toBe(true)

    if (validated.ok) {
      // Identity, not equality: the caller gets the provider's own object back, so a request
      // carrying "overnight at 0" cannot smuggle a price through.
      expect(validated.rate).toBe(rateOf(result, 'overnight'))
      expect(validated.rate.amountMinor).toBe(listPrice('overnight'))
    }
  })

  it('refuses an id the quote no longer offers, with the "no longer available" sentence', () => {
    expect(validateSelectedRate('drone', quote({ destination: to('US') }))).toEqual({
      ok: false,
      reason: SHIPPING_COPY.methodGone,
    })
  })

  it('refuses a null selection the same way, because nothing chosen is nothing to validate', () => {
    expect(validateSelectedRate(null, quote({ destination: to('US') }))).toEqual({
      ok: false,
      reason: SHIPPING_COPY.methodGone,
    })
  })

  it('matches ids exactly, so a re-cased id is a missing method rather than a lucky hit', () => {
    expect(validateSelectedRate('Overnight', quote({ destination: to('US') }))).toEqual({
      ok: false,
      reason: SHIPPING_COPY.methodGone,
    })
  })

  it("refuses a method that exists but cannot serve this address, with that method's own reason", () => {
    const outcome = validateSelectedRate('overnight', quote({ destination: to('GB') }))

    expect(outcome.ok).toBe(false)

    if (!outcome.ok) {
      // Distinct from methodGone on purpose: this refusal is fixable by changing the address.
      expect(outcome.reason).toBe(SHIPPING_COPY.domesticOnly)
      expect(outcome.reason).not.toBe(SHIPPING_COPY.methodGone)
    }
  })

  it('falls back to the general refusal when an ineligible rate carries no reason of its own', () => {
    const base = quote({ destination: to('US') })
    const reasonless: ShippingQuote = {
      defaultRateId: null,
      destinationKnown: true,
      rates: [{ ...rateOf(base, 'standard'), eligible: false, ineligibleReason: null }],
    }

    expect(validateSelectedRate('standard', reasonless)).toEqual({
      ok: false,
      reason: SHIPPING_COPY.noneAvailable,
    })
  })

  it('accepts a waived rate at zero, because zero is a real price and not a missing one', () => {
    const validated = validateSelectedRate(
      'standard',
      quote({ destination: to('US'), freeShippingThresholdMinor: 0 }),
    )

    expect(validated.ok).toBe(true)

    if (validated.ok) {
      expect(validated.rate.amountMinor).toBe(0)
      expect(validated.rate.waived).toBe(true)
    }
  })

  it('accepts exactly the rates the quote calls eligible, and refuses exactly the rest', () => {
    const result = quote({ destination: to('GB'), subtotalMinor: 20_000 })

    for (const rate of result.rates) {
      expect(validateSelectedRate(rate.id, result).ok).toBe(rate.eligible)
    }
  })

  it('accepts a quote made with no destination, which is why checkout must re-quote with the real address', () => {
    // Nothing here is wrong — but "ok" from a destinationKnown: false quote is not a promise that
    // the parcel can be delivered, and §17.1a's preflight exists for that reason.
    const unknown = quote({ destination: null })

    expect(unknown.destinationKnown).toBe(false)
    expect(validateSelectedRate('overnight', unknown).ok).toBe(true)
  })
})

/* ------------------------------------------------------------------------------------------------
 * Invariants that must hold across every shape of quote
 * --------------------------------------------------------------------------------------------- */

describe('invariants across every quote', () => {
  const inputs: Partial<ShippingQuoteInput>[] = [
    {},
    { freeShippingThresholdMinor: THRESHOLD, subtotalMinor: THRESHOLD },
    { discountMinor: NaN, freeShippingThresholdMinor: NaN, subtotalMinor: NaN },
    { destination: to('GB'), freeShippingPromotion: true, subtotalMinor: 99_999 },
    { destination: to('JP'), freeShippingThresholdMinor: 0, subtotalMinor: -1 },
    { destination: to('CA'), subtotalMinor: Number.MAX_SAFE_INTEGER },
  ]

  it('always returns the whole rate card, so a caller can render every option and its reason', () => {
    for (const input of inputs) {
      expect(quote(input).rates.map((rate) => rate.id)).toEqual(
        SHIPPING_METHODS.map((method) => method.id),
      )
    }
  })

  it('never produces a fractional or negative amount, because money is integer minor units', () => {
    for (const input of inputs) {
      for (const rate of quote(input).rates) {
        expect(Number.isSafeInteger(rate.amountMinor)).toBe(true)
        expect(rate.amountMinor).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('pairs eligibility with its reason: a refusal always says why, an offer never does', () => {
    for (const input of inputs) {
      for (const rate of quote(input).rates) {
        if (rate.eligible) {
          expect(rate.ineligibleReason).toBeNull()
        } else {
          expect(typeof rate.ineligibleReason).toBe('string')
          expect(rate.ineligibleReason).not.toBe('')
        }
      }
    }
  })

  it('names an eligible, genuinely cheapest rate as the default, or names none at all', () => {
    for (const input of inputs) {
      const result = quote(input)
      const eligible = result.rates.filter((rate) => rate.eligible)

      if (eligible.length === 0) {
        expect(result.defaultRateId).toBeNull()
      } else {
        const cheapest = Math.min(...eligible.map((rate) => rate.amountMinor))

        expect(rateOf(result, result.defaultRateId).eligible).toBe(true)
        expect(rateOf(result, result.defaultRateId).amountMinor).toBe(cheapest)
      }
    }
  })

  it('only ever waives a method the card marks waivable', () => {
    const waivable = new Set(
      SHIPPING_METHODS.filter((method) => method.waivable).map((method) => method.id),
    )

    for (const input of inputs) {
      for (const rate of quote(input).rates) {
        if (rate.waived) {
          expect(waivable.has(rate.id)).toBe(true)
          // A waiver means free, not discounted — there is no partial waiver in this design.
          expect(rate.amountMinor).toBe(0)
        }
      }
    }
  })

  it('is deterministic — the same input twice gives the same quote', () => {
    for (const input of inputs) {
      expect(quote(input)).toEqual(quote(input))
    }
  })

  it('stamps the cart currency onto every rate without converting the card amounts', () => {
    // The static card is denominated in the store's single catalogue currency; the code is carried
    // so a formatter never has to guess. No conversion happens here, and none should be inferred.
    for (const currency of ['USD', 'GBP', 'EUR'] as const) {
      const result = quote({ currency, subtotalMinor: 1_000 })

      expect(result.rates.map((rate) => rate.currency)).toEqual([currency, currency, currency])
      expect(rateOf(result, 'standard').amountMinor).toBe(listPrice('standard'))
    }
  })

  it('carries both a day range and a human sentence, so a caller never asks the provider twice', () => {
    for (const rate of quote().rates) {
      expect(rate.minDays).toBeGreaterThan(0)
      expect(rate.maxDays).toBeGreaterThanOrEqual(rate.minDays)
      expect(rate.estimate.length).toBeGreaterThan(0)
      expect(rate.name.length).toBeGreaterThan(0)
    }
  })
})
