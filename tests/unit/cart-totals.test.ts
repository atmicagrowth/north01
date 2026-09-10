import { describe, expect, it } from 'vitest'

import { cartTotals, type PricedLine } from '@/lib/cart/rules'

/**
 * **Plan §27.1a — "Cart totals", over `cartTotals` from `src/lib/cart/rules.ts`.**
 *
 * The arithmetic itself is one multiply and three adds. Everything interesting here is about the
 * *kinds of ignorance* the shape encodes, which is where §14.1d's five components ("subtotal,
 * discount, shipping estimate, tax estimate where appropriate, and total") get their meaning.
 *
 * ### The failure modes this file is aimed at
 *
 * 1. **`null` collapsing into `0`.** `shippingMinor: null` says *nobody has quoted this yet*;
 *    `shippingMinor: 0` says *delivery is free*. A bag that renders the first as the second is
 *    plan §0.1.17's fake UI expressed as a number — the most persuasive kind, because a customer
 *    cannot tell a computed zero from a placeholder. Every unknown component is asserted to stay
 *    strictly `null`, and `isFinal` is asserted to be the only thing a surface may trust.
 * 2. **`NaN` leaking.** `Math.max(0, Math.floor(NaN))` is `NaN`, so one unusable price could turn a
 *    whole bag's total into `NaN` — which formats as nothing and reconciles against nothing.
 *    `toMinorAmount` exists to stop that; these tests hold the line at this call site.
 * 3. **A discount that outruns the goods.** A code worth more than the bag must not produce a
 *    negative total, and must not eat the delivery the courier is still owed.
 * 4. **Fractions of a minor unit.** Money is an integer count of minor units everywhere; the single
 *    division lives at the formatting boundary in `@/lib/money`. Nothing here may emit a fraction.
 *
 * `cartTotals` is deliberately free of Next, Payload and `server-only` — the policy (an empty bag is
 * not quoted for delivery, an unpriced variant never becomes a line) lives in `lib/cart/cart.ts`
 * above it. So these tests assert the arithmetic exactly as written, and note where a guard upstream
 * is what keeps a shape out of production.
 */

/** A line with a price the catalogue could not supply. The type forbids it; the wire does not. */
const unpricedLine = { quantity: 2, unitPriceMinor: null } as unknown as PricedLine

describe('cartTotals: the subtotal and the item count', () => {
  it('totals an empty bag at zero rather than throwing, because an empty bag is a normal bag', () => {
    const totals = cartTotals([])

    expect(totals.subtotalMinor).toBe(0)
    expect(totals.itemCount).toBe(0)
    expect(totals.totalMinor).toBe(0)
  })

  it('multiplies the unit price by the quantity for a single line', () => {
    const totals = cartTotals([{ quantity: 3, unitPriceMinor: 24_000 }])

    expect(totals.subtotalMinor).toBe(72_000)
    expect(totals.itemCount).toBe(3)
  })

  it('counts units rather than lines, so a bag of three lines is not a bag of three garments', () => {
    const totals = cartTotals([
      { quantity: 2, unitPriceMinor: 9_500 },
      { quantity: 1, unitPriceMinor: 24_000 },
      { quantity: 4, unitPriceMinor: 1_250 },
    ])

    expect(totals.subtotalMinor).toBe(19_000 + 24_000 + 5_000)
    // Seven garments across three lines. The header badge reads this, not `lines.length`.
    expect(totals.itemCount).toBe(7)
  })

  it('stays an exact integer at the top of the allowed range, where floats begin to lie', () => {
    // 99 is `QUANTITY_HARD_CAP`; the price is a plausible outerwear price in minor units.
    const totals = cartTotals([{ quantity: 99, unitPriceMinor: 249_900 }])

    expect(totals.subtotalMinor).toBe(24_740_100)
    expect(Number.isSafeInteger(totals.subtotalMinor)).toBe(true)
  })

  it('never emits a fraction of a minor unit, because the one division happens at formatting', () => {
    const totals = cartTotals([{ quantity: 1.5, unitPriceMinor: 999.99 }], 0.5, 0.5, 0.5)

    for (const amount of [
      totals.subtotalMinor,
      totals.discountMinor,
      totals.shippingMinor,
      totals.taxMinor,
      totals.totalMinor,
      totals.itemCount,
    ]) {
      expect(Number.isInteger(amount)).toBe(true)
    }
  })
})

describe('cartTotals: numbers that are not usable amounts', () => {
  it('treats a NaN price as nothing rather than poisoning every number in the bag', () => {
    const totals = cartTotals([
      { quantity: 1, unitPriceMinor: Number.NaN },
      { quantity: 2, unitPriceMinor: 5_000 },
    ])

    // The point of the coercion: one bad row must not turn the customer's total into `NaN`, which
    // formats as nothing and reconciles against nothing.
    expect(totals.subtotalMinor).toBe(10_000)
    expect(Number.isNaN(totals.subtotalMinor)).toBe(false)
    expect(Number.isFinite(totals.totalMinor)).toBe(true)
  })

  it('treats a NaN quantity as no units, so the line contributes neither money nor a count', () => {
    const totals = cartTotals([{ quantity: Number.NaN, unitPriceMinor: 5_000 }])

    expect(totals.subtotalMinor).toBe(0)
    expect(totals.itemCount).toBe(0)
  })

  it('treats an infinite price or quantity as nothing, since neither is an amount anyone can charge', () => {
    expect(cartTotals([{ quantity: 1, unitPriceMinor: Infinity }]).subtotalMinor).toBe(0)
    expect(cartTotals([{ quantity: Infinity, unitPriceMinor: 100 }]).subtotalMinor).toBe(0)
    expect(cartTotals([{ quantity: 1, unitPriceMinor: -Infinity }]).subtotalMinor).toBe(0)
  })

  it('floors a fractional quantity, because nobody is shipped two thirds of a coat', () => {
    const totals = cartTotals([{ quantity: 2.7, unitPriceMinor: 100 }])

    expect(totals.subtotalMinor).toBe(200)
    expect(totals.itemCount).toBe(2)
  })

  it('floors a fractional price down, so a stray decimal can never round in the shop favour', () => {
    const totals = cartTotals([{ quantity: 2, unitPriceMinor: 100.99 }])

    expect(totals.subtotalMinor).toBe(200)
  })

  it('refuses to let a negative price credit the bag', () => {
    const totals = cartTotals([
      { quantity: 1, unitPriceMinor: -500 },
      { quantity: 1, unitPriceMinor: 500 },
    ])

    // A negative price is not a refund, it is a corrupt row. It contributes zero, and the honest
    // line beside it survives untouched.
    expect(totals.subtotalMinor).toBe(500)
  })

  it('refuses a negative quantity, which would otherwise subtract stock it never had', () => {
    const totals = cartTotals([{ quantity: -3, unitPriceMinor: 500 }])

    expect(totals.subtotalMinor).toBe(0)
    expect(totals.itemCount).toBe(0)
  })

  it('prices a line whose price is unknown at nothing rather than at NaN', () => {
    const totals = cartTotals([unpricedLine, { quantity: 1, unitPriceMinor: 4_000 }])

    // `clampQuantity` drops a variant with `priceMinor === null` before it can become a line, so
    // this shape should not reach production. When it does, the bag under-reports rather than
    // showing `NaN` — and the units are still counted, so the discrepancy is visible on screen
    // instead of silent.
    expect(totals.subtotalMinor).toBe(4_000)
    expect(totals.itemCount).toBe(3)
  })

  it('is unbothered by a bag holding nothing but unusable lines', () => {
    const totals = cartTotals([unpricedLine, { quantity: Number.NaN, unitPriceMinor: Number.NaN }])

    expect(totals.subtotalMinor).toBe(0)
    expect(totals.totalMinor).toBe(0)
  })
})

describe('cartTotals: null means unknown, 0 means none', () => {
  const bag: PricedLine[] = [{ quantity: 1, unitPriceMinor: 10_000 }]

  it('reports an unquoted delivery cost as null and never as a confident zero', () => {
    const totals = cartTotals(bag)

    expect(totals.shippingMinor).toBeNull()
    // The distinction this whole shape exists for: `0` would tell the customer delivery is free.
    expect(totals.shippingMinor).not.toBe(0)
    expect(totals.taxMinor).toBeNull()
  })

  it('does not let an unknown delivery cost quietly join the total as zero', () => {
    const totals = cartTotals(bag, null, null, null)

    // The total is "the sum of what is known", so it equals the goods — but `isFinal` is false,
    // which is the only thing that lets a surface print it without the estimate caveat.
    expect(totals.totalMinor).toBe(10_000)
    expect(totals.isFinal).toBe(false)
  })

  it('reports a quoted free delivery as 0, which is a different claim from unquoted', () => {
    const free = cartTotals(bag, null, 0, 0)
    const unquoted = cartTotals(bag, null, null, null)

    expect(free.shippingMinor).toBe(0)
    expect(free.taxMinor).toBe(0)
    expect(unquoted.shippingMinor).toBeNull()
    // Identical totals, opposite meanings — which is exactly why the total alone is not readable.
    expect(free.totalMinor).toBe(unquoted.totalMinor)
    expect(free.isFinal).not.toBe(unquoted.isFinal)
  })

  it('leaves the discount null when no code is applied, so no discount row is drawn', () => {
    expect(cartTotals(bag).discountMinor).toBeNull()
  })

  it('reports a discount of 0 when a code applies and takes nothing off, because that is surprising', () => {
    const totals = cartTotals(bag, 0)

    expect(totals.discountMinor).toBe(0)
    expect(totals.discountMinor).not.toBeNull()
    expect(totals.totalMinor).toBe(10_000)
  })

  it('treats an omitted component as unknown rather than as none', () => {
    const totals = cartTotals(bag, undefined, undefined, undefined)

    expect(totals.discountMinor).toBeNull()
    expect(totals.shippingMinor).toBeNull()
    expect(totals.taxMinor).toBeNull()
  })

  it('coerces an unusable known amount to 0 without promoting it back to unknown', () => {
    const totals = cartTotals(bag, -1, Number.NaN, -0.5)

    // A provider that returned garbage still returned *something*, so these stay known-and-zero.
    // Flipping them to `null` would hide a broken quote behind an honest-looking caveat.
    expect(totals.shippingMinor).toBe(0)
    expect(totals.taxMinor).toBe(0)
    expect(totals.discountMinor).toBe(0)
    expect(totals.isFinal).toBe(true)
  })
})

describe('cartTotals: isFinal is true only when every unknowable component is known', () => {
  const bag: PricedLine[] = [{ quantity: 1, unitPriceMinor: 10_000 }]

  it('is false while delivery has not been quoted', () => {
    expect(cartTotals(bag, 500, null, 1_667).isFinal).toBe(false)
  })

  it('is false while tax is uncalculated, which is every bag with no destination', () => {
    expect(cartTotals(bag, 500, 995, null).isFinal).toBe(false)
  })

  it('is false when neither is known', () => {
    expect(cartTotals(bag).isFinal).toBe(false)
  })

  it('is true once both are known, even when both are zero', () => {
    expect(cartTotals(bag, null, 0, 0).isFinal).toBe(true)
  })

  it('does not wait on a discount, because an absent discount is known to be nothing', () => {
    // The bug the source comment records: requiring `discountMinor !== null` made `isFinal`
    // unreachable for every bag without a code, which is most of them.
    expect(cartTotals(bag, null, 995, 1_667).isFinal).toBe(true)
    expect(cartTotals(bag, 0, 995, 1_667).isFinal).toBe(true)
  })

  it('is decided by the components alone, not by whether the bag has anything in it', () => {
    expect(cartTotals([], null, 0, 0).isFinal).toBe(true)
    expect(cartTotals([]).isFinal).toBe(false)
  })
})

describe('cartTotals: the grand total', () => {
  it('adds known delivery and tax on top of the discounted goods', () => {
    const totals = cartTotals([{ quantity: 2, unitPriceMinor: 10_000 }], 2_000, 995, 3_600)

    // 20000 goods − 2000 off = 18000, plus 995 delivery plus 3600 tax.
    expect(totals.totalMinor).toBe(22_595)
    expect(totals.subtotalMinor).toBe(20_000)
    expect(totals.isFinal).toBe(true)
  })

  it('equals the subtotal when nothing else is known, rather than guessing at the rest', () => {
    const totals = cartTotals([{ quantity: 2, unitPriceMinor: 10_000 }])

    expect(totals.totalMinor).toBe(totals.subtotalMinor)
  })

  it('caps a discount at the goods, so a bag can never owe the customer money', () => {
    const totals = cartTotals([{ quantity: 1, unitPriceMinor: 10_000 }], 99_999)

    expect(totals.discountMinor).toBe(10_000)
    expect(totals.totalMinor).toBe(0)
    expect(totals.totalMinor).toBeGreaterThanOrEqual(0)
  })

  it('still charges known delivery when the discount has swallowed the goods entirely', () => {
    const totals = cartTotals([{ quantity: 1, unitPriceMinor: 1_000 }], 99_999, 500, 0)

    // The cap applies to the goods, not to the courier: free garments are not free postage.
    expect(totals.discountMinor).toBe(1_000)
    expect(totals.totalMinor).toBe(500)
  })

  it('caps a discount on an empty bag at zero, and reports it applied rather than absent', () => {
    const totals = cartTotals([], 5_000)

    expect(totals.discountMinor).toBe(0)
    expect(totals.totalMinor).toBe(0)
  })

  it('leaves the subtotal undiscounted, because the two numbers are printed on separate rows', () => {
    const totals = cartTotals([{ quantity: 1, unitPriceMinor: 10_000 }], 2_500)

    expect(totals.subtotalMinor).toBe(10_000)
    expect(totals.totalMinor).toBe(7_500)
  })
})

describe('cartTotals: the shape it returns', () => {
  it('returns exactly the seven fields the summary reads, and no accidental eighth', () => {
    // The bag summary destructures this; a renamed or dropped field is a blank row, not a crash.
    expect(Object.keys(cartTotals([])).sort()).toEqual([
      'discountMinor',
      'isFinal',
      'itemCount',
      'shippingMinor',
      'subtotalMinor',
      'taxMinor',
      'totalMinor',
    ])
  })

  it('is a pure function of its arguments: same input, same answer, and no mutation', () => {
    const lines: PricedLine[] = [
      { quantity: 2, unitPriceMinor: 2.9 },
      { quantity: 1, unitPriceMinor: 10_000 },
    ]
    const snapshot = structuredClone(lines)

    const first = cartTotals(lines, 100, 200, 300)
    const second = cartTotals(lines, 100, 200, 300)

    expect(first).toEqual(second)
    // Flooring happens on a copy of the number, never on the caller's line — the same array is
    // handed to the renderer afterwards.
    expect(lines).toEqual(snapshot)
  })
})
