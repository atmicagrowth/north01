import { describe, expect, it } from 'vitest'

import type { LineAvailability } from '@/lib/cart/rules'
import { clampNotice, clampQuantity, QUANTITY_HARD_CAP } from '@/lib/cart/rules'
import { productCardBadge, productCardState, resolveProductCard } from '@/lib/catalog/resolve'

/**
 * **Plan §27.1a — inventory rules.**
 *
 * Two pure modules decide everything the shop says about stock, and neither may consult a browser:
 * `lib/cart/rules.ts` decides *how many a customer may have*, and `lib/catalog/resolve.ts` decides
 * *what the card says about it*. `lib/cart/cart.ts` and the components do the reads and the
 * rendering; they decide nothing, which is why these two can be proved without a database.
 *
 * The failure modes worth spending a test on, in the order they have historically bitten:
 *
 * 1. **The wrong bound reported.** `inventoryQuantity` is a fact about the warehouse and
 *    `maxQuantityPerLine` is merchandising policy. *"Only 4 left"* and *"10 per customer"* are
 *    different sentences and the wrong one is misleading, so a clamp must say **which** bound bit,
 *    not merely that one did.
 * 2. **A stock figure that is not a count.** Negative, fractional, `NaN` and — despite the type —
 *    `null` all reach these functions from a database column. Every one must fail *closed*: an
 *    unusable stock number sells nothing. `null` means UNKNOWN and `0` means NONE, and this is the
 *    one place the project deliberately collapses them, because the safe collapse is downward.
 * 3. **The ceiling that disabled every `+` control.** `clampQuantity(policy, availability, policy)`
 *    is the idiom `cart.ts` uses to ask *how many could they have?*; clamping the **held** quantity
 *    instead once made `atCeiling` true on every line from the moment it was added — a control that
 *    looked functional and did nothing, which plan §0.1.17 forbids outright.
 * 4. **The low-stock threshold off by one.** `stock === threshold` is low stock; one more is not.
 *    A threshold of `0` would make `lowStock` unreachable and reclassify sold-out products as
 *    available, so the floor of 1 is load-bearing rather than defensive noise.
 * 5. **`null` price versus `0` price.** A variant with no usable price is unbuyable; a variant
 *    priced at zero is a price of zero. Conflating them either hides a giveaway or sells a garment
 *    whose price nobody set.
 */

/** A saleable variant, with only the number under test varying. Prices are integer minor units. */
const available = (
  inventoryQuantity: number,
  priceMinor: null | number = 12_000,
): LineAvailability => ({
  active: true,
  inventoryQuantity,
  priceMinor,
  productPublished: true,
})

describe('clampQuantity: two bounds, and the shop must say which one bit', () => {
  it('grants the request in full, and reports no clamp, when it is under both bounds', () => {
    expect(clampQuantity(3, available(40), 10)).toEqual({ clampedBy: null, quantity: 3 })
  })

  it('gives the customer everything the warehouse has when they asked for more', () => {
    // Clamped, never rejected: they wanted six, four exist, four is what they get and are told.
    expect(clampQuantity(6, available(4), 10)).toEqual({ clampedBy: 'stock', quantity: 4 })
  })

  it('reports the policy cap, not the shelf, when policy is the tighter of the two', () => {
    // 500 in the warehouse and 10 per customer: the honest sentence is "10 per customer".
    expect(clampQuantity(25, available(500), 10)).toEqual({ clampedBy: 'policy', quantity: 10 })
  })

  it('reports the shelf when both bounds are exceeded but stock is the lower one', () => {
    // Both bite; the number the customer can act on is 4, and the shelf is why.
    expect(clampQuantity(25, available(4), 10)).toEqual({ clampedBy: 'stock', quantity: 4 })
  })

  it('reports the shelf when stock and policy are equal, because it is the more specific sentence', () => {
    // A tie at 5: either reason is true, and "only 5 left" tells the customer more than policy does.
    expect(clampQuantity(9, available(5), 5)).toEqual({ clampedBy: 'stock', quantity: 5 })
  })

  it('never grants more than the schema can store, however generous the policy is', () => {
    // `cart-items.quantity` caps at 99; a policy above it cannot raise it.
    expect(QUANTITY_HARD_CAP).toBe(99)
    expect(clampQuantity(5_000, available(10_000), 10_000)).toEqual({
      clampedBy: 'policy',
      quantity: QUANTITY_HARD_CAP,
    })
  })

  it('treats a policy of zero or less as a policy of one, so a line can still exist', () => {
    // A misconfigured cap must not silently empty every bag; the floor is one.
    expect(clampQuantity(4, available(50), 0)).toEqual({ clampedBy: 'policy', quantity: 1 })
    expect(clampQuantity(4, available(50), -7)).toEqual({ clampedBy: 'policy', quantity: 1 })
  })

  it('floors a fractional policy rather than offering half a garment', () => {
    expect(clampQuantity(4, available(50), 2.9)).toEqual({ clampedBy: 'policy', quantity: 2 })
  })
})

describe('clampQuantity: stock figures that are not a count of garments', () => {
  it('calls zero stock sold out, and zero is a real answer rather than an error', () => {
    expect(clampQuantity(1, available(0), 10)).toEqual({ clampedBy: 'soldOut', quantity: 0 })
  })

  it('treats negative stock as none rather than as a debt to be sold against', () => {
    // A negative column value is corruption, not an obligation; it must never permit a sale.
    expect(clampQuantity(1, available(-5), 10)).toEqual({ clampedBy: 'soldOut', quantity: 0 })
  })

  it('treats unknown stock as sold out, collapsing null into none in the one safe direction', () => {
    /*
     * `LineAvailability.inventoryQuantity` is typed `number`, but the column it is read from can be
     * null. The project's rule is that null (UNKNOWN) and 0 (NONE) are never interchangeable — here
     * the collapse is deliberate and one-way: an unknown shelf sells nothing. The opposite collapse
     * would let a customer buy stock nobody has counted.
     */
    const unknownStock = { ...available(0), inventoryQuantity: null } as unknown as LineAvailability

    expect(clampQuantity(1, unknownStock, 10)).toEqual({ clampedBy: 'soldOut', quantity: 0 })
  })

  it('treats a NaN or infinite stock figure as sold out rather than passing the poison through', () => {
    // `Math.max(0, Math.floor(NaN))` is NaN; the shared coercion exists so that cannot leak here.
    expect(clampQuantity(2, available(Number.NaN), 10).quantity).toBe(0)
    expect(clampQuantity(2, available(Number.POSITIVE_INFINITY), 10).quantity).toBe(0)
  })

  it('floors a fractional stock figure downward, never rounding one into existence', () => {
    // 2.9 jackets is 2 jackets. Rounding up sells one that does not exist.
    expect(clampQuantity(5, available(2.9), 10)).toEqual({ clampedBy: 'stock', quantity: 2 })
    expect(clampQuantity(5, available(0.9), 10)).toEqual({ clampedBy: 'soldOut', quantity: 0 })
  })

  it('lets a single unit be bought when exactly one is left', () => {
    expect(clampQuantity(1, available(1), 10)).toEqual({ clampedBy: null, quantity: 1 })
    expect(clampQuantity(2, available(1), 10)).toEqual({ clampedBy: 'stock', quantity: 1 })
  })
})

describe('clampQuantity: requests that are not a number of garments', () => {
  it('returns zero with no clamp reason for a request of zero, leaving removal to the caller', () => {
    // Nothing was clamped: the customer asked for none. The caller decides that means "remove".
    expect(clampQuantity(0, available(10), 10)).toEqual({ clampedBy: null, quantity: 0 })
  })

  it('treats a negative request as a request for none rather than as a subtraction', () => {
    expect(clampQuantity(-4, available(10), 10)).toEqual({ clampedBy: null, quantity: 0 })
  })

  it('floors a fractional request', () => {
    expect(clampQuantity(2.99, available(10), 10)).toEqual({ clampedBy: null, quantity: 2 })
  })

  it('refuses an unbounded request instead of granting it the maximum', () => {
    /*
     * Infinity and NaN are not counts, so the coercion yields 0 and the customer gets nothing —
     * fail-closed. A posted quantity of Infinity cannot be laundered into the policy cap.
     */
    expect(clampQuantity(Number.POSITIVE_INFINITY, available(10), 10).quantity).toBe(0)
    expect(clampQuantity(Number.NaN, available(10), 10).quantity).toBe(0)
  })

  it('clamps a merely enormous request down to the tighter bound', () => {
    // MAX_SAFE_INTEGER is finite, so it is a real request — and a real request meets the real cap.
    expect(clampQuantity(Number.MAX_SAFE_INTEGER, available(10_000), 12)).toEqual({
      clampedBy: 'policy',
      quantity: 12,
    })
  })
})

describe('clampQuantity: lines that cannot exist at all', () => {
  it('refuses a variant whose row has gone, because a missing lookup is not a stocked shelf', () => {
    expect(clampQuantity(1, null, 10)).toEqual({ clampedBy: 'soldOut', quantity: 0 })
  })

  it('refuses an inactive variant and an unpublished product however full the shelf is', () => {
    expect(clampQuantity(1, { ...available(99), active: false }, 10).quantity).toBe(0)
    expect(clampQuantity(1, { ...available(99), productPublished: false }, 10).quantity).toBe(0)
  })

  it('refuses a variant with no usable price, since an unpriced line cannot be charged for', () => {
    // Checked before stock: a full warehouse is irrelevant if nobody set a price.
    expect(clampQuantity(1, available(99, null), 10)).toEqual({ clampedBy: 'soldOut', quantity: 0 })
  })

  it('sells a variant priced at zero, because zero is a price and null is the absence of one', () => {
    // The null/0 distinction in the direction that matters for money: 0 minor units is a giveaway.
    expect(clampQuantity(2, available(99, 0), 10)).toEqual({ clampedBy: null, quantity: 2 })
  })
})

describe('clampQuantity: the stepper ceiling the bag and the product page both read', () => {
  it('answers min(stock, policy) when asked with the policy as the request', () => {
    /*
     * `cart.ts` computes the `+` control's ceiling as clampQuantity(policy, availability, policy),
     * and `product-page.tsx` computes the stepper maximum the same way. The invariant that makes
     * that idiom sound is asserted directly, across both orderings and both degenerate ends.
     */
    const cases = [
      { expected: 2, policy: 10, stock: 2 },
      { expected: 10, policy: 10, stock: 50 },
      { expected: 7, policy: 7, stock: 7 },
      { expected: 1, policy: 10, stock: 1 },
      { expected: 0, policy: 10, stock: 0 },
    ]

    for (const { expected, policy, stock } of cases) {
      expect(clampQuantity(policy, available(stock), policy).quantity).toBe(expected)
    }
  })

  it('leaves the increment control live when one is held and two are in stock', () => {
    // The regression the idiom exists for: the held quantity must not be mistaken for the ceiling.
    const held = clampQuantity(1, available(2), 10)
    const ceiling = clampQuantity(10, available(2), 10)

    expect(held.quantity).toBe(1)
    expect(ceiling.quantity).toBe(2)
    expect(held.quantity < ceiling.quantity).toBe(true)
  })
})

describe('clampNotice: the sentence a clamp produces', () => {
  it('says nothing at all when the customer got what they asked for', () => {
    expect(clampNotice(clampQuantity(2, available(10), 10))).toBeNull()
  })

  it('uses words for one left, because "Only 1 left" is the tell of an unread template', () => {
    expect(clampNotice(clampQuantity(3, available(1), 10))).toBe('Only one left, so we added one.')
    expect(clampNotice(clampQuantity(3, available(2), 10))).toBe(
      'Only 2 left, so that is what we added.',
    )
  })

  it('names the policy rather than the shelf when policy is what bit', () => {
    expect(clampNotice(clampQuantity(30, available(500), 4))).toBe(
      'You can add up to 4 of this per order.',
    )
  })

  it('says sold out for every unbuyable line, whatever made it unbuyable', () => {
    expect(clampNotice(clampQuantity(1, null, 10))).toBe('That size is sold out.')
    expect(clampNotice(clampQuantity(1, available(0), 10))).toBe('That size is sold out.')
  })
})

describe('productCardState: the four availability answers a card can give', () => {
  it('reads a well-stocked, priced product as available', () => {
    expect(productCardState(9_500, 40, 5)).toBe('available')
  })

  it('reads a priced product with nothing left as sold out', () => {
    expect(productCardState(9_500, 0, 5)).toBe('soldOut')
  })

  it('reads a product with no resolvable price as unavailable, not as sold out', () => {
    /*
     * `derived.priceFromMinor === null` means no active variant at all — withdrawn from sale, which
     * is a different sentence from "sold out" and outranks it even when stock is also zero.
     */
    expect(productCardState(null, 40, 5)).toBe('unavailable')
    expect(productCardState(undefined, 40, 5)).toBe('unavailable')
    expect(productCardState(null, 0, 5)).toBe('unavailable')
  })

  it('refuses any price that is not whole, non-negative and safe', () => {
    // Money is integer minor units everywhere; a fractional or negative "price" is not one.
    expect(productCardState(-1, 40, 5)).toBe('unavailable')
    expect(productCardState(99.5, 40, 5)).toBe('unavailable')
    expect(productCardState(Number.NaN, 40, 5)).toBe('unavailable')
    expect(productCardState(Number.MAX_VALUE, 40, 5)).toBe('unavailable')
  })

  it('treats a price of zero as a price, because null is the absence and zero is the amount', () => {
    expect(productCardState(0, 40, 5)).toBe('available')
    expect(productCardState(0, 0, 5)).toBe('soldOut')
  })

  it('treats unknown or corrupt stock as sold out rather than quietly offering it', () => {
    // null (unknown), negative (corrupt) and NaN all fail closed to "none".
    expect(productCardState(9_500, null, 5)).toBe('soldOut')
    expect(productCardState(9_500, undefined, 5)).toBe('soldOut')
    expect(productCardState(9_500, -3, 5)).toBe('soldOut')
    expect(productCardState(9_500, Number.NaN, 5)).toBe('soldOut')
  })
})

describe('productCardState: the low-stock threshold, exactly at the boundary', () => {
  it('calls stock equal to the threshold low, and one above it plainly available', () => {
    // The boundary is inclusive: 5 of 5 is low stock, 6 is not.
    expect(productCardState(9_500, 5, 5)).toBe('lowStock')
    expect(productCardState(9_500, 6, 5)).toBe('available')
  })

  it('calls a single remaining unit low stock at every sane threshold', () => {
    expect(productCardState(9_500, 1, 1)).toBe('lowStock')
    expect(productCardState(9_500, 1, 20)).toBe('lowStock')
  })

  it('floors the threshold at one, so a stored zero cannot make low stock unreachable', () => {
    /*
     * A stored `0` — from a row predating `SiteSettings.lowStockThreshold`'s `min: 1` — would
     * otherwise mean nothing is ever low, and the docblock's worry is the second half: sold-out
     * products must still test as sold out, not as available.
     */
    expect(productCardState(9_500, 1, 0)).toBe('lowStock')
    expect(productCardState(9_500, 2, 0)).toBe('available')
    expect(productCardState(9_500, 0, 0)).toBe('soldOut')
    expect(productCardState(9_500, 1, -10)).toBe('lowStock')
  })

  it('floors a fractional threshold rather than comparing against a fraction', () => {
    // 3.9 means 3, so four left is not low stock.
    expect(productCardState(9_500, 3, 3.9)).toBe('lowStock')
    expect(productCardState(9_500, 4, 3.9)).toBe('available')
  })

  it('lets an editor raise the threshold and reclassify the catalogue with no rewrite', () => {
    // Derived at render from site-settings, never stored — the same stock reads differently.
    expect(productCardState(9_500, 8, 5)).toBe('available')
    expect(productCardState(9_500, 8, 10)).toBe('lowStock')
  })
})

describe('the card a listing renders from that state', () => {
  const product = (derived: Record<string, null | number>): unknown => ({
    derived,
    gallery: [],
    id: 42,
    name: 'Merino Crew',
    slug: 'merino-crew',
  })

  const card = (inventoryTotal: null | number, priceFromMinor: null | number = 9_500) =>
    resolveProductCard(product({ inventoryTotal, priceFromMinor }), 'USD', 'en-US', 5)

  it('prints the exact count only while the product is inside the low-stock band', () => {
    expect(card(3)?.state).toBe('lowStock')
    expect(card(3)?.lowStockLabel).toBe('Only 3 left')
    // A count beside a product with plenty, or with none, is noise and a lie respectively.
    expect(card(30)?.lowStockLabel).toBeNull()
    expect(card(0)?.lowStockLabel).toBeNull()
  })

  it('drops the price line rather than printing a confident zero for a withdrawn product', () => {
    // `unavailable` is the one state with no price label; $0.00 would be a fake number.
    expect(card(0, null)?.state).toBe('unavailable')
    expect(card(0, null)?.priceLabel).toBeNull()
  })

  it('divides by one hundred exactly once, at the formatting boundary', () => {
    // 9_500 minor units is $95.00 — stored as an integer, divided only to be read.
    expect(card(30)?.priceLabel).toBe('$95.00')
  })

  it('shows one badge, and availability outranks merchandising every time', () => {
    const badge = productCardBadge({
      compareAtLabel: '$140.00',
      href: '/products/merino-crew',
      id: 1,
      image: null,
      isLimitedEdition: true,
      isNew: true,
      lowStockLabel: null,
      name: 'Merino Crew',
      priceLabel: '$95.00',
      state: 'soldOut',
    })

    // NEW over a garment nobody can buy is an advertisement for a disappointment.
    expect(badge).toEqual({ label: 'Sold out', tone: 'muted' })
  })
})
