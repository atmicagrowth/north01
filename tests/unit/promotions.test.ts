/**
 * **Plan §27.1a — "Discount rules", exercising `src/lib/promotions/rules.ts`.**
 *
 * §15.1a's eight checks and §15.1b's calculation live in one module precisely so they can be walked
 * without a database, a request or a browser; §15.1b asks for a pure function that "must be unit
 * tested extensively". This file is that test, from the Vitest side.
 *
 * ### The failure modes this file is actually hunting
 *
 * - **A negative total.** §15.1c names both overflow directions — "percentage discount exceeds
 *   subtotal" and "fixed discount larger than eligible subtotal". A discount bigger than the bag is
 *   a refund the shop never agreed to, so `finalSubtotalMinor` is asserted at zero-floor from every
 *   direction, including the pathological ones.
 * - **The clamp drifting to the wrong base.** The ceiling is the *eligible* subtotal, not the bag's.
 *   A code that only covers one line must not be able to eat the other line's money.
 * - **`null` mistaken for `0`.** `usageLimit: null` is UNLIMITED; `usageLimit: 0` is EXHAUSTED. The
 *   same pair for `perCustomerLimit`, `minimumSubtotalMinor` and `percentage`. Confusing them either
 *   bricks every code in the shop or gives away the whole catalogue.
 * - **Boundary instants.** `startsAt` is inclusive and `endsAt` is exclusive. A code alive for one
 *   millisecond past its stated end is a code the CMS said was over.
 * - **Order of failures.** Only the first reason is shown, so the order is user-facing copy: a
 *   customer can fix a small basket and cannot fix a date.
 * - **Staleness.** §15.1c's "expired code during checkout" and "code reaches usage limit between
 *   cart and checkout" are the same test run twice with a different clock or counter — the amount is
 *   re-decided every time, never remembered.
 * - **Money staying integral.** Minor units in, minor units out; the one division lives at a
 *   formatting boundary in `lib/money.ts`, never here.
 */

import { describe, expect, it } from 'vitest'

import {
  calculateDiscount,
  discountLabel,
  eligibleLines,
  normalisePromotionCode,
  PROMOTION_CODE_MAX_LENGTH,
  PROMOTION_COPY,
  validatePromotion,
  type DiscountLine,
  type PromotionContext,
  type PromotionFailure,
  type PromotionInput,
} from '@/lib/promotions/rules'

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

const NOW = new Date('2026-03-01T12:00:00.000Z')
const MINUTE = 60_000

/** A plain 10%-off code with no restriction of any kind. Every test narrows from here. */
const promotion = (overrides: Partial<PromotionInput> = {}): PromotionInput => ({
  active: true,
  code: 'NORTH10',
  currency: null,
  eligibleCollectionIds: [],
  eligibleProductIds: [],
  endsAt: null,
  id: 1,
  minimumSubtotalMinor: null,
  percentage: 10,
  perCustomerLimit: null,
  startsAt: null,
  timesUsed: 0,
  type: 'percentage',
  usageLimit: null,
  valueMinor: null,
  ...overrides,
})

const line = (overrides: Partial<DiscountLine> = {}): DiscountLine => ({
  collectionIds: [10],
  productId: 1,
  quantity: 1,
  unitPriceMinor: 10_000,
  ...overrides,
})

const context = (overrides: Partial<PromotionContext> = {}): PromotionContext => ({
  cartCurrency: 'USD',
  customerUses: 0,
  now: NOW,
  ...overrides,
})

/** Product 1 in collection 10 at 100.00, plus two of product 2 in collection 20 at 25.00. */
const BAG: DiscountLine[] = [
  line(),
  line({ collectionIds: [20], productId: 2, quantity: 2, unitPriceMinor: 2_500 }),
]
const BAG_SUBTOTAL = 15_000
const LINE_ONE_SUBTOTAL = 10_000
const LINE_TWO_SUBTOTAL = 5_000

/* -------------------------------------------------------------------------------------------------
 * §15.1c — case sensitivity and whitespace
 * ---------------------------------------------------------------------------------------------- */

describe('normalisePromotionCode', () => {
  it('upper-cases, so a code typed in lower case is the same code', () => {
    expect(normalisePromotionCode('north10')).toBe('NORTH10')
    expect(normalisePromotionCode('NoRtH10')).toBe('NORTH10')
  })

  it('strips the padding a paste or an autocomplete leaves behind, on both sides', () => {
    expect(normalisePromotionCode('  north10  ')).toBe('NORTH10')
    // Tabs and newlines come free with a copy out of an email; they are padding too.
    expect(normalisePromotionCode('\t\r\nnorth10\n ')).toBe('NORTH10')
  })

  it('keeps whitespace that is inside the code, because that is a character and not padding', () => {
    expect(normalisePromotionCode('  north 10  ')).toBe('NORTH 10')
  })

  it('turns an all-whitespace entry into the empty string rather than a code made of spaces', () => {
    expect(normalisePromotionCode('   ')).toBe('')
    expect(normalisePromotionCode('')).toBe('')
  })

  it('is idempotent, so a value read back out of the database normalises to itself', () => {
    const once = normalisePromotionCode('  north10 ')

    expect(normalisePromotionCode(once)).toBe(once)
  })

  it('publishes the schema length as a whole positive number a form can spend', () => {
    expect(PROMOTION_CODE_MAX_LENGTH).toBe(32)
    expect(Number.isSafeInteger(PROMOTION_CODE_MAX_LENGTH)).toBe(true)
  })
})

/* -------------------------------------------------------------------------------------------------
 * §15.1a — product/collection eligibility
 * ---------------------------------------------------------------------------------------------- */

describe('eligibleLines', () => {
  it('treats a promotion that names nothing as covering the whole bag', () => {
    expect(eligibleLines(BAG, promotion())).toEqual(BAG)
  })

  it('narrows to the named products, which is §15.1c’s "applies to one item but not another"', () => {
    expect(eligibleLines(BAG, promotion({ eligibleProductIds: [2] }))).toEqual([BAG[1]])
  })

  it('narrows by collection membership as well as by product', () => {
    expect(eligibleLines(BAG, promotion({ eligibleCollectionIds: [10] }))).toEqual([BAG[0]])
  })

  it('treats the two lists as alternatives, never as a conjunction', () => {
    // Naming product 2 AND collection 10 means "these things", so both lines qualify. An
    // intersection here would silently make most editorial promotions apply to nothing.
    const both = promotion({ eligibleCollectionIds: [10], eligibleProductIds: [2] })

    expect(eligibleLines(BAG, both)).toEqual(BAG)
  })

  it('matches a line that belongs to several collections when any one of them is named', () => {
    const multi = [line({ collectionIds: [30, 40, 50] })]

    expect(eligibleLines(multi, promotion({ eligibleCollectionIds: [50] }))).toHaveLength(1)
    expect(eligibleLines(multi, promotion({ eligibleCollectionIds: [99] }))).toHaveLength(0)
  })

  it('returns nothing when the named ids are in the catalogue but not in this bag', () => {
    expect(eligibleLines(BAG, promotion({ eligibleProductIds: [999] }))).toEqual([])
  })

  it('does not duplicate a line because an id was listed twice', () => {
    const duplicated = promotion({ eligibleCollectionIds: [10, 10], eligibleProductIds: [1, 1] })

    expect(eligibleLines(BAG, duplicated)).toHaveLength(1)
  })

  it('returns nothing for an empty bag, however unrestricted the code', () => {
    expect(eligibleLines([], promotion())).toEqual([])
  })
})

/* -------------------------------------------------------------------------------------------------
 * §15.1a — the eight checks
 * ---------------------------------------------------------------------------------------------- */

describe('validatePromotion', () => {
  it('accepts a live, unrestricted code against a bag that holds something', () => {
    expect(validatePromotion(promotion(), BAG, context())).toBeNull()
  })

  it('refuses a switched-off code before it looks at anything else', () => {
    // `inactive` outranks every other failure: an unreleased campaign must not leak its date window,
    // its minimum, or its existence through a more specific message.
    const off = promotion({
      active: false,
      endsAt: new Date(NOW.getTime() - MINUTE).toISOString(),
      minimumSubtotalMinor: 999_999,
    })

    expect(validatePromotion(off, [], context())).toBe('inactive')
  })

  describe('the date window', () => {
    it('refuses a code whose start is still in the future', () => {
      const future = promotion({ startsAt: new Date(NOW.getTime() + MINUTE).toISOString() })

      expect(validatePromotion(future, BAG, context())).toBe('notStarted')
    })

    it('accepts a code at the exact instant it starts, because the start is inclusive', () => {
      const starting = promotion({ startsAt: NOW.toISOString() })

      expect(validatePromotion(starting, BAG, context())).toBeNull()
    })

    it('refuses a code at the exact instant it ends, because the end is exclusive', () => {
      // `endsAt <= now` is the whole difference between a code that dies on its stated end and one
      // that lives a millisecond past a date the CMS says is over.
      const ending = promotion({ endsAt: NOW.toISOString() })

      expect(validatePromotion(ending, BAG, context())).toBe('expired')
    })

    it('accepts a code one millisecond before it ends', () => {
      const ending = promotion({ endsAt: new Date(NOW.getTime() + 1).toISOString() })

      expect(validatePromotion(ending, BAG, context())).toBeNull()
    })

    it('treats a null date as no boundary at all rather than as the epoch', () => {
      const unbounded = promotion({ endsAt: null, startsAt: null })

      expect(validatePromotion(unbounded, BAG, context())).toBeNull()
    })
  })

  describe('usage limits', () => {
    it('accepts the last available redemption', () => {
      const nearly = promotion({ timesUsed: 4, usageLimit: 5 })

      expect(validatePromotion(nearly, BAG, context())).toBeNull()
    })

    it('refuses the redemption after that, when used has reached the limit', () => {
      expect(validatePromotion(promotion({ timesUsed: 5, usageLimit: 5 }), BAG, context())).toBe(
        'usageLimit',
      )
    })

    it('refuses a limit of zero immediately, because 0 means NONE', () => {
      expect(validatePromotion(promotion({ timesUsed: 0, usageLimit: 0 }), BAG, context())).toBe(
        'usageLimit',
      )
    })

    it('treats a null limit as unlimited, because null means UNKNOWN and not zero', () => {
      const heavilyUsed = promotion({ timesUsed: 10_000, usageLimit: null })

      expect(validatePromotion(heavilyUsed, BAG, context())).toBeNull()
    })

    it('applies the same two readings of null and zero to the per-customer limit', () => {
      const perCustomer = promotion({ perCustomerLimit: 1 })

      expect(validatePromotion(perCustomer, BAG, context({ customerUses: 0 }))).toBeNull()
      expect(validatePromotion(perCustomer, BAG, context({ customerUses: 1 }))).toBe(
        'perCustomerLimit',
      )
      expect(
        validatePromotion(promotion({ perCustomerLimit: 0 }), BAG, context({ customerUses: 0 })),
      ).toBe('perCustomerLimit')
      expect(
        validatePromotion(
          promotion({ perCustomerLimit: null }),
          BAG,
          context({ customerUses: 99 }),
        ),
      ).toBeNull()
    })

    it('reports the shop-wide limit before the personal one, since it is the less actionable', () => {
      const both = promotion({ perCustomerLimit: 1, timesUsed: 1, usageLimit: 1 })

      expect(validatePromotion(both, BAG, context({ customerUses: 1 }))).toBe('usageLimit')
    })
  })

  describe('currency', () => {
    it('refuses a fixed amount denominated in a currency this bag is not priced in', () => {
      const eur = promotion({ currency: 'EUR', type: 'fixed', valueMinor: 1_000 })

      expect(validatePromotion(eur, BAG, context({ cartCurrency: 'USD' }))).toBe('currency')
    })

    it('accepts a fixed amount whose currency matches, or which names none', () => {
      const usd = promotion({ currency: 'USD', type: 'fixed', valueMinor: 1_000 })
      const any = promotion({ currency: null, type: 'fixed', valueMinor: 1_000 })

      expect(validatePromotion(usd, BAG, context({ cartCurrency: 'USD' }))).toBeNull()
      expect(validatePromotion(any, BAG, context({ cartCurrency: 'JPY' }))).toBeNull()
    })

    it('lets a percentage cross currencies, because a ratio has no denomination', () => {
      // 10% off is 10% off in any currency; failing this would break a global code for no reason.
      const percentage = promotion({ currency: 'EUR', type: 'percentage' })

      expect(validatePromotion(percentage, BAG, context({ cartCurrency: 'USD' }))).toBeNull()
    })

    it('lets free shipping cross currencies, because it carries no amount at all', () => {
      const shipping = promotion({ currency: 'EUR', type: 'free_shipping' })

      expect(validatePromotion(shipping, BAG, context({ cartCurrency: 'USD' }))).toBeNull()
    })
  })

  describe('minimum spend', () => {
    it('accepts a bag exactly on the minimum, because the threshold is inclusive', () => {
      const min = promotion({ minimumSubtotalMinor: BAG_SUBTOTAL })

      expect(validatePromotion(min, BAG, context())).toBeNull()
    })

    it('refuses a bag one minor unit under the minimum', () => {
      const min = promotion({ minimumSubtotalMinor: BAG_SUBTOTAL + 1 })

      expect(validatePromotion(min, BAG, context())).toBe('minimumSubtotal')
    })

    it('measures the minimum against the whole bag, not against the eligible part of it', () => {
      // "Spend $100" means spend $100 — not "hold $100 of qualifying goods". The eligible subset here
      // is 5000, well under the 12000 minimum, and the code must still apply.
      const scoped = promotion({ eligibleProductIds: [2], minimumSubtotalMinor: 12_000 })

      expect(validatePromotion(scoped, BAG, context())).toBeNull()
    })

    it('treats a null minimum as no minimum and a zero minimum as satisfied by anything', () => {
      expect(
        validatePromotion(promotion({ minimumSubtotalMinor: null }), BAG, context()),
      ).toBeNull()
      expect(validatePromotion(promotion({ minimumSubtotalMinor: 0 }), BAG, context())).toBeNull()
    })
  })

  it('refuses a code applied to an empty bag, since nothing in it can be discounted', () => {
    expect(validatePromotion(promotion(), [], context())).toBe('noEligibleItems')
  })

  it('refuses a code whose products are all absent from this bag', () => {
    expect(validatePromotion(promotion({ eligibleProductIds: [999] }), BAG, context())).toBe(
      'noEligibleItems',
    )
  })

  it('reports the date the customer cannot change before the basket they can', () => {
    // Expiry outranks the minimum deliberately: telling somebody to add $40 to a bag for a code that
    // died last week is sending them shopping for nothing.
    const both = promotion({
      endsAt: new Date(NOW.getTime() - MINUTE).toISOString(),
      minimumSubtotalMinor: 999_999,
    })

    expect(validatePromotion(both, BAG, context())).toBe('expired')
  })

  it('reports a bag-level failure last, after everything about the code itself has passed', () => {
    const scoped = promotion({ eligibleProductIds: [999], minimumSubtotalMinor: 999_999 })

    expect(validatePromotion(scoped, BAG, context())).toBe('minimumSubtotal')
  })
})

/* -------------------------------------------------------------------------------------------------
 * §15.1b — the calculation
 * ---------------------------------------------------------------------------------------------- */

describe('calculateDiscount', () => {
  it('returns all four of §15.1b’s outputs plus the free-shipping flag', () => {
    const result = calculateDiscount(BAG, promotion(), context())

    expect(result).toEqual({
      discountMinor: 1_500,
      eligibleSubtotalMinor: BAG_SUBTOTAL,
      finalSubtotalMinor: 13_500,
      freeShipping: false,
      reason: null,
    })
  })

  it('does not mutate the bag it was handed', () => {
    const before = JSON.stringify(BAG)

    calculateDiscount(BAG, promotion({ eligibleProductIds: [2] }), context())

    expect(JSON.stringify(BAG)).toBe(before)
  })

  describe('percentage', () => {
    it('rounds a half-unit to the customer, never away from them', () => {
      // 10% of 1005 is 100.5. Flooring every percentage discount is a systematic fraction of a penny
      // in the shop's favour on every order that has one; Math.round is unbiased.
      const odd = [line({ quantity: 1, unitPriceMinor: 1_005 })]

      expect(calculateDiscount(odd, promotion(), context()).discountMinor).toBe(101)
    })

    it('still rounds down when the fraction is below a half', () => {
      const odd = [line({ quantity: 1, unitPriceMinor: 1_004 })]

      expect(calculateDiscount(odd, promotion(), context()).discountMinor).toBe(100)
    })

    it('always produces a whole number of minor units, never a fraction of a penny', () => {
      const odd = [line({ quantity: 3, unitPriceMinor: 3_333 })]
      const result = calculateDiscount(odd, promotion({ percentage: 17 }), context())

      expect(Number.isSafeInteger(result.discountMinor)).toBe(true)
      expect(Number.isSafeInteger(result.finalSubtotalMinor)).toBe(true)
    })

    it('applies a zero-per-cent code rather than rejecting it, and takes nothing', () => {
      // 0 means NONE, not INVALID: the code is genuinely applied, the reason is null, and the bag
      // shows an applied code worth nothing rather than an error the customer cannot act on.
      const result = calculateDiscount(BAG, promotion({ percentage: 0 }), context())

      expect(result.reason).toBeNull()
      expect(result.discountMinor).toBe(0)
      expect(result.finalSubtotalMinor).toBe(BAG_SUBTOTAL)
    })

    it('treats a missing percentage as nothing off rather than as a free bag', () => {
      const result = calculateDiscount(BAG, promotion({ percentage: null }), context())

      expect(result.discountMinor).toBe(0)
      expect(result.finalSubtotalMinor).toBe(BAG_SUBTOTAL)
    })

    it('floors a negative percentage at zero instead of charging the customer more', () => {
      const result = calculateDiscount(BAG, promotion({ percentage: -25 }), context())

      expect(result.discountMinor).toBe(0)
      expect(result.finalSubtotalMinor).toBe(BAG_SUBTOTAL)
    })

    it('clamps a percentage over 100 to the eligible subtotal — §15.1c’s first overflow', () => {
      const result = calculateDiscount(BAG, promotion({ percentage: 150 }), context())

      expect(result.discountMinor).toBe(BAG_SUBTOTAL)
      expect(result.finalSubtotalMinor).toBe(0)
    })

    it('clamps an absurd percentage the same way, so the clamp is not a validator’s courtesy', () => {
      const result = calculateDiscount(BAG, promotion({ percentage: 1_000_000 }), context())

      expect(result.discountMinor).toBe(BAG_SUBTOTAL)
      expect(result.finalSubtotalMinor).toBe(0)
    })

    it('takes 100% down to exactly zero and no further', () => {
      const result = calculateDiscount(BAG, promotion({ percentage: 100 }), context())

      expect(result.finalSubtotalMinor).toBe(0)
      expect(result.finalSubtotalMinor).not.toBeLessThan(0)
    })
  })

  describe('fixed amount', () => {
    const fixed = (valueMinor: null | number) =>
      promotion({ currency: 'USD', percentage: null, type: 'fixed', valueMinor })

    it('takes exactly its stated amount off a bag that can absorb it', () => {
      const result = calculateDiscount(BAG, fixed(2_500), context())

      expect(result.discountMinor).toBe(2_500)
      expect(result.finalSubtotalMinor).toBe(BAG_SUBTOTAL - 2_500)
    })

    it('clamps against the ELIGIBLE subtotal, not the bag — §15.1c’s second overflow', () => {
      // A $500 code on a bag holding $100 of ineligible goods and $50 of eligible ones takes $50.
      // Clamping against the bag instead would let a scoped code spend money it was never given.
      const scoped = promotion({
        currency: 'USD',
        eligibleProductIds: [2],
        percentage: null,
        type: 'fixed',
        valueMinor: 50_000,
      })
      const result = calculateDiscount(BAG, scoped, context())

      expect(result.eligibleSubtotalMinor).toBe(LINE_TWO_SUBTOTAL)
      expect(result.discountMinor).toBe(LINE_TWO_SUBTOTAL)
      expect(result.finalSubtotalMinor).toBe(LINE_ONE_SUBTOTAL)
    })

    it('never drives the total below zero, however large the amount', () => {
      const result = calculateDiscount(BAG, fixed(Number.MAX_SAFE_INTEGER), context())

      expect(result.finalSubtotalMinor).toBe(0)
      expect(result.discountMinor).toBe(BAG_SUBTOTAL)
    })

    it('treats a negative amount as nothing off, never as a surcharge', () => {
      expect(calculateDiscount(BAG, fixed(-5_000), context()).discountMinor).toBe(0)
    })

    it('floors a fractional amount, because money is integer minor units everywhere', () => {
      expect(calculateDiscount(BAG, fixed(999.9), context()).discountMinor).toBe(999)
    })

    it('treats an unusable amount as nothing off rather than poisoning the total', () => {
      // Not-finite is zero: the guard in lib/money.ts exists because Math.max(0, NaN) is NaN, which
      // reads like a clamp and is not one.
      const notANumber = calculateDiscount(BAG, fixed(Number.NaN), context())

      expect(notANumber.discountMinor).toBe(0)
      expect(notANumber.finalSubtotalMinor).toBe(BAG_SUBTOTAL)
      expect(calculateDiscount(BAG, fixed(Number.POSITIVE_INFINITY), context()).discountMinor).toBe(
        0,
      )
      expect(calculateDiscount(BAG, fixed(null), context()).discountMinor).toBe(0)
    })
  })

  describe('free shipping', () => {
    const shipping = promotion({ percentage: null, type: 'free_shipping' })

    it('carries its effect in the flag and takes nothing off the goods', () => {
      // A free-shipping code that wrote a discountMinor would draw a -$0.00 row in the bag: a
      // control that looks functional and does nothing.
      const result = calculateDiscount(BAG, shipping, context())

      expect(result).toEqual({
        discountMinor: 0,
        eligibleSubtotalMinor: BAG_SUBTOTAL,
        finalSubtotalMinor: BAG_SUBTOTAL,
        freeShipping: true,
        reason: null,
      })
    })

    it('is still subject to all eight checks, and does not free the shipping when it fails', () => {
      const expired = { ...shipping, endsAt: new Date(NOW.getTime() - MINUTE).toISOString() }
      const result = calculateDiscount(BAG, expired, context())

      expect(result.reason).toBe('expired')
      expect(result.freeShipping).toBe(false)
    })
  })

  describe('when the code does not apply', () => {
    it('charges the full subtotal, discounts nothing, and frees no shipping', () => {
      const result = calculateDiscount(BAG, promotion({ active: false }), context())

      expect(result).toEqual({
        discountMinor: 0,
        eligibleSubtotalMinor: BAG_SUBTOTAL,
        finalSubtotalMinor: BAG_SUBTOTAL,
        freeShipping: false,
        reason: 'inactive',
      })
    })

    it('still reports what the code WOULD have covered, so the bag can explain itself', () => {
      const scoped = promotion({ eligibleProductIds: [2], minimumSubtotalMinor: 999_999 })
      const result = calculateDiscount(BAG, scoped, context())

      expect(result.reason).toBe('minimumSubtotal')
      expect(result.eligibleSubtotalMinor).toBe(LINE_TWO_SUBTOTAL)
    })

    it('returns zeroes rather than NaN for a code applied to an empty bag', () => {
      const result = calculateDiscount([], promotion(), context())

      expect(result).toEqual({
        discountMinor: 0,
        eligibleSubtotalMinor: 0,
        finalSubtotalMinor: 0,
        freeShipping: false,
        reason: 'noEligibleItems',
      })
    })
  })

  describe('an untrustworthy bag', () => {
    it('counts a fractional quantity as whole units, because a bag holds no half jackets', () => {
      const messy = [line({ quantity: 2.7, unitPriceMinor: 1_000 })]

      expect(
        calculateDiscount(messy, promotion({ percentage: 100 }), context()).discountMinor,
      ).toBe(2_000)
    })

    it('treats a negative price or quantity as zero, never as a credit', () => {
      // The browser is never authoritative for price. A line that arrives negative contributes
      // nothing rather than paying the customer to check out.
      const messy = [line({ quantity: -3, unitPriceMinor: 5_000 }), line({ unitPriceMinor: -900 })]

      expect(calculateDiscount(messy, promotion(), context()).eligibleSubtotalMinor).toBe(0)
    })

    it('does not let an unusable number reach the total', () => {
      const messy = [line({ quantity: Number.NaN }), line({ unitPriceMinor: Number.NaN })]
      const result = calculateDiscount(messy, promotion({ percentage: 100 }), context())

      expect(result.finalSubtotalMinor).toBe(0)
      expect(Number.isNaN(result.finalSubtotalMinor)).toBe(false)
    })
  })

  describe('the invariants that hold for every promotion in the matrix', () => {
    const matrix: PromotionInput[] = [
      promotion(),
      promotion({ percentage: 0 }),
      promotion({ percentage: 100 }),
      promotion({ percentage: 137 }),
      promotion({ percentage: null }),
      promotion({ eligibleCollectionIds: [20], percentage: 40 }),
      promotion({ percentage: null, type: 'fixed', valueMinor: 1 }),
      promotion({ percentage: null, type: 'fixed', valueMinor: BAG_SUBTOTAL - 1 }),
      promotion({ percentage: null, type: 'fixed', valueMinor: BAG_SUBTOTAL }),
      promotion({ percentage: null, type: 'fixed', valueMinor: 900_000 }),
      promotion({ eligibleProductIds: [1], percentage: null, type: 'fixed', valueMinor: 900_000 }),
      promotion({ percentage: null, type: 'free_shipping' }),
      promotion({ active: false }),
      promotion({ minimumSubtotalMinor: 999_999 }),
      promotion({ eligibleProductIds: [999] }),
    ]
    const bags: DiscountLine[][] = [[], BAG, [line({ quantity: 1, unitPriceMinor: 0 })]]

    it.each(matrix.map((promo, index) => [index, promo] as const))(
      'promotion %i keeps the total at or above zero and the discount inside what it discounts',
      (_index, promo) => {
        for (const bag of bags) {
          const result = calculateDiscount(bag, promo, context())
          const subtotal = bag.reduce(
            (total, item) => total + Math.max(0, item.unitPriceMinor) * Math.max(0, item.quantity),
            0,
          )

          // The one rule that must never bend: a discount cannot become a refund.
          expect(result.finalSubtotalMinor).toBeGreaterThanOrEqual(0)
          expect(result.discountMinor).toBeGreaterThanOrEqual(0)
          // The ceiling is the eligible subtotal, so a scoped code cannot spend the rest of the bag.
          expect(result.discountMinor).toBeLessThanOrEqual(result.eligibleSubtotalMinor)
          expect(result.eligibleSubtotalMinor).toBeLessThanOrEqual(subtotal)
          // Money stays integral; the single division lives in lib/money.ts, at the format boundary.
          expect(Number.isSafeInteger(result.discountMinor)).toBe(true)
          expect(Number.isSafeInteger(result.finalSubtotalMinor)).toBe(true)
          expect(Number.isSafeInteger(result.eligibleSubtotalMinor)).toBe(true)
          // The arithmetic is exactly one subtraction, and it reconciles.
          expect(result.finalSubtotalMinor).toBe(subtotal - result.discountMinor)

          // A rejected code costs the customer nothing and gives them nothing.
          if (result.reason !== null) {
            expect(result.discountMinor).toBe(0)
            expect(result.freeShipping).toBe(false)
            expect(result.finalSubtotalMinor).toBe(subtotal)
          }
        }
      },
    )
  })
})

/* -------------------------------------------------------------------------------------------------
 * §15.1c — the two cases that span cart and checkout
 * ---------------------------------------------------------------------------------------------- */

describe('a code that stops working between the cart and the checkout', () => {
  it('re-decides an expired code on the spot rather than honouring a cart-time amount', () => {
    // Nothing about the amount is stored: only the choice of code. Running the same inputs with a
    // later clock is exactly what checkout does, so a stale discount is unrepresentable.
    const promo = promotion({ endsAt: new Date(NOW.getTime() + MINUTE).toISOString() })

    const atCart = calculateDiscount(BAG, promo, context({ now: NOW }))
    const atCheckout = calculateDiscount(
      BAG,
      promo,
      context({ now: new Date(NOW.getTime() + 2 * MINUTE) }),
    )

    expect(atCart.reason).toBeNull()
    expect(atCart.discountMinor).toBe(1_500)
    expect(atCheckout.reason).toBe('expired')
    expect(atCheckout.discountMinor).toBe(0)
    // The customer pays the full price rather than the price the cart quoted them.
    expect(atCheckout.finalSubtotalMinor).toBe(BAG_SUBTOTAL)
  })

  it('re-decides a code that somebody else exhausted while the bag sat open', () => {
    const atCart = calculateDiscount(BAG, promotion({ timesUsed: 99, usageLimit: 100 }), context())
    const atCheckout = calculateDiscount(
      BAG,
      promotion({ timesUsed: 100, usageLimit: 100 }),
      context(),
    )

    expect(atCart.reason).toBeNull()
    expect(atCheckout.reason).toBe('usageLimit')
    expect(atCheckout.finalSubtotalMinor).toBe(BAG_SUBTOTAL)
  })

  it('re-decides a per-customer limit reached by the customer’s own earlier order', () => {
    const promo = promotion({ perCustomerLimit: 1 })

    expect(calculateDiscount(BAG, promo, context({ customerUses: 0 })).reason).toBeNull()
    expect(calculateDiscount(BAG, promo, context({ customerUses: 1 })).reason).toBe(
      'perCustomerLimit',
    )
  })

  it('re-decides a minimum after the customer removes an item', () => {
    const promo = promotion({ minimumSubtotalMinor: 12_000 })

    expect(calculateDiscount(BAG, promo, context()).reason).toBeNull()
    expect(calculateDiscount([BAG[1]], promo, context()).reason).toBe('minimumSubtotal')
  })
})

/* -------------------------------------------------------------------------------------------------
 * Copy
 * ---------------------------------------------------------------------------------------------- */

describe('PROMOTION_COPY', () => {
  const failures: PromotionFailure[] = [
    'currency',
    'expired',
    'inactive',
    'minimumSubtotal',
    'noEligibleItems',
    'notStarted',
    'perCustomerLimit',
    'unknownCode',
    'usageLimit',
  ]

  it.each(failures)('has a sentence for %s, so no failure can reach a customer bare', (failure) => {
    expect(PROMOTION_COPY[failure]).toBeTruthy()
    expect(PROMOTION_COPY[failure].length).toBeGreaterThan(0)
  })

  it('says the same thing for a switched-off code as for one that does not exist', () => {
    // Byte for byte. A different message tells the world that the code exists but is off, which is
    // how an unreleased campaign leaks out of a form field one guess at a time.
    expect(PROMOTION_COPY.inactive).toBe(PROMOTION_COPY.unknownCode)
  })

  it('covers every reason the engine can return, and nothing beyond the lookup’s own', () => {
    // `unknownCode` is the only member validatePromotion never produces: there is no promotion to
    // validate when the code was not found, so the lookup layer raises that one.
    expect(Object.keys(PROMOTION_COPY).sort()).toEqual([...failures].sort())
  })
})

describe('discountLabel', () => {
  it('names the effect rather than an amount for free shipping', () => {
    expect(discountLabel(promotion({ type: 'free_shipping' }))).toBe('Free delivery')
  })

  it('shows the rate for a percentage code', () => {
    expect(discountLabel(promotion({ percentage: 25 }))).toBe('25% off')
  })

  it('shows no rate rather than "null% off" when the percentage is missing', () => {
    expect(discountLabel(promotion({ percentage: null }))).toBe('0% off')
  })

  it('does not put a currency amount in the label, because the label knows no currency', () => {
    // The number belongs to the discount row, which is formatted once, in the caller's currency.
    const label = discountLabel(promotion({ percentage: null, type: 'fixed', valueMinor: 5_000 }))

    expect(label).toBe('Amount off')
    expect(label).not.toContain('5000')
  })
})
