/**
 * **Cart merges — plan §27.1a's *"Cart merges"*, over the rules §14.1b states and the collision
 * §27.1d names (*"guest cart merge collision"*).**
 *
 * A guest fills a bag, signs in, and finds a bag that is already theirs. §14.1b's seven steps say
 * what must come out of that: merge by variant, revalidate, *"resolve duplicate items by summing
 * quantities subject to stock/max limits"*, remove what is invalid, keep the rest. Steps 1 and 2 are
 * reads; `mergeCartLines` is everything from step 3, and it is pure — no Payload, no request, no
 * `server-only` — which is the whole reason two bags, a stock change and a deleted product can be
 * put through it as fixtures.
 *
 * `scripts/verify-cart.ts` already walks the seven edge cases in the plan's own words. This file is
 * not that walk again: it goes after the invariants and the boundaries that walk asserts by example.
 *
 * ### The failure modes worth naming
 *
 * - **Clamping the halves instead of the sum.** Two of three in one bag and three of three in the
 *   other are two requests that each pass, and one bag holding six of a thing with four in stock.
 *   §14.1b step 5 is an ordering instruction, and every test under *sums first, clamps second*
 *   exists because the wrong order still looks right on a happy path.
 * - **Zeroing instead of dropping.** A line at quantity zero is a control that looks functional and
 *   does nothing. Step 6 says *remove*, and the removal has to be reported, or the bag quietly
 *   loses things.
 * - **`null` read as `0`.** An absent availability row and an absent price both mean *unknown*, and
 *   unknown is never buyable. A price of `0` is a different claim — a real price — and must survive.
 * - **Reporting the wrong bound.** *"Only 4 left"* and *"10 per customer"* are different sentences,
 *   and the one reported must be the one that actually bit.
 * - **Order and purity.** Signing in must not reorder your own bag, must not mutate what it was
 *   handed, and must not depend on the insertion order of a lookup map.
 */

import { describe, expect, it } from 'vitest'

import type { CartLineInput, LineAvailability } from '@/lib/cart/rules'

import { clampQuantity, mergeCartLines, QUANTITY_HARD_CAP } from '@/lib/cart/rules'

/** A variant the warehouse is happy about, unless a test says otherwise. */
const stocked = (overrides: Partial<LineAvailability> = {}): LineAvailability => ({
  active: true,
  inventoryQuantity: 10,
  priceMinor: 12_000,
  productPublished: true,
  ...overrides,
})

/** Product ids are derived from the variant id, so a mixed-up pairing is visible in a failure. */
const line = (variantId: number, quantity: number, productId = variantId * 100): CartLineInput => ({
  productId,
  quantity,
  variantId,
})

const catalogue = (entries: [number, LineAvailability | null][]) =>
  new Map<number, LineAvailability | null>(entries)

/** The merchandising policy a shop would actually ship with — `catalog.ts` defaults to 10. */
const POLICY = 10

describe('merging a guest bag into a signed-in customer bag (§14.1b steps 3–7)', () => {
  it('sums the quantities when the same variant sits in both bags, rather than picking a winner', () => {
    const merged = mergeCartLines([line(1, 2)], [line(1, 3)], catalogue([[1, stocked()]]), POLICY)

    expect(merged.lines).toHaveLength(1)
    expect(merged.lines[0]?.quantity).toBe(5)
    // Nothing was lost, so nothing is reported: `reduced` is for a bag that did not get what it asked.
    expect(merged.reduced).toEqual([])
    expect(merged.dropped).toEqual([])
  })

  it('marks a line that came from both bags as combined, and one that came from a single bag as not', () => {
    const merged = mergeCartLines(
      [line(1, 1), line(2, 1)],
      [line(1, 1), line(3, 1)],
      catalogue([
        [1, stocked()],
        [2, stocked()],
        [3, stocked()],
      ]),
      POLICY,
    )

    expect(merged.lines.map((entry) => [entry.variantId, entry.combined])).toEqual([
      [1, true],
      [2, false],
      [3, false],
    ])
  })

  it('keeps a variant only the guest had, at the quantity the guest chose', () => {
    const merged = mergeCartLines([], [line(7, 4)], catalogue([[7, stocked()]]), POLICY)

    expect(merged.lines).toEqual([{ combined: false, productId: 700, quantity: 4, variantId: 7 }])
  })

  it('leaves a variant only the customer had exactly as it was', () => {
    const merged = mergeCartLines([line(7, 4)], [], catalogue([[7, stocked()]]), POLICY)

    expect(merged.lines).toEqual([{ combined: false, productId: 700, quantity: 4, variantId: 7 }])
  })

  it('returns three empty lists when both bags are empty, because an empty bag is an answer and not an error', () => {
    expect(mergeCartLines([], [], catalogue([]), POLICY)).toEqual({
      dropped: [],
      lines: [],
      reduced: [],
    })
  })

  it('leads with the customer own lines in their own order, so signing in never reorders the bag you already had', () => {
    const merged = mergeCartLines(
      [line(20, 1), line(21, 1)],
      [line(22, 1), line(20, 1)],
      catalogue([
        [20, stocked()],
        [21, stocked()],
        [22, stocked()],
      ]),
      POLICY,
    )

    // 20 is in both bags; it holds the customer's position rather than jumping to the guest's.
    expect(merged.lines.map((entry) => entry.variantId)).toEqual([20, 21, 22])
  })

  it('keeps the customer own product id when the two bags disagree about which product a variant belongs to', () => {
    const merged = mergeCartLines(
      [line(5, 1, 900)],
      [line(5, 1, 111)],
      catalogue([[5, stocked()]]),
      POLICY,
    )

    // Only one of the two can survive, and it must be the same one every run — the customer's.
    expect(merged.lines[0]?.productId).toBe(900)
  })

  it('collapses a variant that appears twice inside one bag, so a duplicated row cannot double a total', () => {
    // `(cart, variant)` is unique in the schema, so this is defence against a state that should not
    // exist — collapsing is still the only safe reading of two rows for one thing.
    const merged = mergeCartLines([line(5, 2), line(5, 2)], [], catalogue([[5, stocked()]]), POLICY)

    expect(merged.lines).toHaveLength(1)
    expect(merged.lines[0]?.quantity).toBe(4)
  })
})

describe('the merge sums first and clamps second (§14.1b step 5, in that order)', () => {
  it('clamps three plus three to the four that exist, because the browser is never authoritative for stock', () => {
    const merged = mergeCartLines(
      [line(6, 3)],
      [line(6, 3)],
      catalogue([[6, stocked({ inventoryQuantity: 4 })]]),
      POLICY,
    )

    expect(merged.lines[0]?.quantity).toBe(4)
    expect(merged.reduced).toEqual([{ reason: 'stock', requested: 6, resolved: 4, variantId: 6 }])
  })

  it('would have let each half through on its own — which is exactly why the order is sum, then clamp', () => {
    const availability = stocked({ inventoryQuantity: 4 })

    // Both halves are individually legal, so a merge that clamped per side would store six of four.
    expect(clampQuantity(3, availability, POLICY)).toEqual({ clampedBy: null, quantity: 3 })
    expect(
      mergeCartLines([line(6, 3)], [line(6, 3)], catalogue([[6, availability]]), POLICY).lines[0]
        ?.quantity,
    ).toBe(4)
  })

  it('clamps to merchandising policy when policy is the tighter bound, and says policy rather than stock', () => {
    const merged = mergeCartLines(
      [line(6, 6)],
      [line(6, 6)],
      catalogue([[6, stocked({ inventoryQuantity: 50 })]]),
      POLICY,
    )

    expect(merged.lines[0]?.quantity).toBe(POLICY)
    // "10 per customer" and "only 10 left" are different sentences, and the wrong one misleads.
    expect(merged.reduced[0]?.reason).toBe('policy')
    expect(merged.reduced[0]?.requested).toBe(12)
  })

  it('refuses to exceed the schema hard cap of 99 even when merchandising policy allows more', () => {
    const merged = mergeCartLines(
      [line(6, 60)],
      [line(6, 60)],
      catalogue([[6, stocked({ inventoryQuantity: 1_000 })]]),
      500,
    )

    expect(QUANTITY_HARD_CAP).toBe(99)
    // A quantity above the cap cannot be stored, so a merge that planned one would fail on write.
    expect(merged.lines[0]?.quantity).toBe(QUANTITY_HARD_CAP)
    expect(merged.reduced[0]?.resolved).toBe(QUANTITY_HARD_CAP)
  })

  it('never returns more than the smallest of the sum, the stock and the policy — across every combination tried', () => {
    const cases: { customer: number; guest: number; policy: number; stock: number }[] = [
      { customer: 1, guest: 1, policy: 10, stock: 10 },
      { customer: 5, guest: 5, policy: 10, stock: 10 },
      { customer: 5, guest: 6, policy: 10, stock: 10 },
      { customer: 9, guest: 9, policy: 10, stock: 4 },
      { customer: 1, guest: 0, policy: 10, stock: 1 },
      { customer: 25, guest: 25, policy: 10, stock: 20 },
      { customer: 2, guest: 2, policy: 3, stock: 99 },
      { customer: 1, guest: 1, policy: 1, stock: 99 },
      { customer: 50, guest: 50, policy: 99, stock: 99 },
      { customer: 2, guest: 2, policy: 500, stock: 2 },
    ]

    for (const { customer, guest, policy, stock } of cases) {
      const merged = mergeCartLines(
        [line(1, customer)],
        [line(1, guest)],
        catalogue([[1, stocked({ inventoryQuantity: stock })]]),
        policy,
      )
      const effectivePolicy = Math.min(policy, QUANTITY_HARD_CAP)
      const expected = Math.min(customer + guest, stock, effectivePolicy)
      const label = `customer ${customer} + guest ${guest}, stock ${stock}, policy ${policy}`

      expect(merged.lines[0]?.quantity, label).toBe(expected)
      // A merged quantity is a count: whole, finite and never negative.
      expect(Number.isSafeInteger(merged.lines[0]?.quantity), label).toBe(true)

      if (expected < customer + guest) {
        // The reported bound is the one that actually bit, not whichever was tested first.
        expect(merged.reduced[0]?.reason, label).toBe(stock <= effectivePolicy ? 'stock' : 'policy')
        expect(merged.reduced[0]?.requested, label).toBe(customer + guest)
        expect(merged.reduced[0]?.resolved, label).toBe(expected)
      } else {
        expect(merged.reduced, label).toEqual([])
      }
    }
  })

  it('floors a fractional policy and refuses a nonsensical one, so a bad setting can never widen the cap', () => {
    const bag = (): CartLineInput[] => [line(1, 8)]
    const shelf = catalogue([[1, stocked({ inventoryQuantity: 50 })]])

    expect(mergeCartLines(bag(), [], shelf, 2.9).lines[0]?.quantity).toBe(2)
    // A policy of zero or less would empty every bag on sign-in, so one is the safer reading — and
    // `catalog.ts` substitutes its default of 10 long before either value could reach here.
    expect(mergeCartLines(bag(), [], shelf, 0).lines[0]?.quantity).toBe(1)
    expect(mergeCartLines(bag(), [], shelf, -5).lines[0]?.quantity).toBe(1)
  })
})

describe('a variant that stopped being buyable while the guest was browsing (§14.1b step 6, §27.1d)', () => {
  it('drops a sold-out variant instead of keeping it at zero, because a line that cannot be bought is a control that does nothing', () => {
    const merged = mergeCartLines(
      [line(6, 2)],
      [line(6, 3)],
      catalogue([[6, stocked({ inventoryQuantity: 0 })]]),
      POLICY,
    )

    expect(merged.lines).toEqual([])
    // The whole request is echoed back, so the shopper can be told what left the bag and why.
    expect(merged.dropped).toEqual([{ reason: 'soldOut', requested: 5, resolved: 0, variantId: 6 }])
    expect(merged.reduced).toEqual([])
  })

  it('drops a variant whose catalogue row has gone — the deleted product §14.1b lists', () => {
    const merged = mergeCartLines([], [line(7, 1)], catalogue([[7, null]]), POLICY)

    expect(merged.lines).toEqual([])
    expect(merged.dropped[0]).toEqual({
      reason: 'soldOut',
      requested: 1,
      resolved: 0,
      variantId: 7,
    })
  })

  it('drops a variant the availability lookup never answered for, because unknown is not the same as fine', () => {
    // An absent key reads as `undefined`, not `null`; both must mean unbuyable rather than in stock.
    const merged = mergeCartLines([line(7, 1)], [], catalogue([]), POLICY)

    expect(merged.lines).toEqual([])
    expect(merged.dropped).toHaveLength(1)
  })

  it('drops a deactivated variant and an unpublished product alike, since neither may be sold', () => {
    const merged = mergeCartLines(
      [line(1, 1), line(2, 1), line(3, 1)],
      [],
      catalogue([
        [1, stocked({ active: false })],
        [2, stocked({ productPublished: false })],
        [3, stocked()],
      ]),
      POLICY,
    )

    expect(merged.lines.map((entry) => entry.variantId)).toEqual([3])
    expect(merged.dropped.map((entry) => entry.variantId)).toEqual([1, 2])
  })

  it('drops an unpriced variant but keeps one priced at zero, because null means unknown and 0 is a real price', () => {
    const merged = mergeCartLines(
      [line(1, 1), line(2, 1)],
      [],
      catalogue([
        [1, stocked({ priceMinor: null })],
        [2, stocked({ priceMinor: 0 })],
      ]),
      POLICY,
    )

    // Selling at a price nobody knows is worse than not selling; a genuine zero is a decision.
    expect(merged.dropped.map((entry) => entry.variantId)).toEqual([1])
    expect(merged.lines.map((entry) => entry.variantId)).toEqual([2])
  })

  it('reads a negative inventory as sold out rather than as a negative allowance', () => {
    // Oversold stock is a real database state; it must never come back as a buyable number.
    const merged = mergeCartLines(
      [line(1, 1)],
      [line(1, 1)],
      catalogue([[1, stocked({ inventoryQuantity: -4 })]]),
      POLICY,
    )

    expect(merged.lines).toEqual([])
    expect(merged.dropped[0]?.reason).toBe('soldOut')
  })

  it('reads an unusable stock figure — NaN or infinite — as sold out rather than as unlimited', () => {
    const merged = mergeCartLines(
      [line(1, 1), line(2, 1)],
      [],
      catalogue([
        [1, stocked({ inventoryQuantity: Number.NaN })],
        [2, stocked({ inventoryQuantity: Number.POSITIVE_INFINITY })],
      ]),
      POLICY,
    )

    expect(merged.lines).toEqual([])
    expect(merged.dropped.map((entry) => entry.variantId)).toEqual([1, 2])
  })

  it('floors a fractional stock count down, never up, so the merge cannot promise a unit that is not there', () => {
    const merged = mergeCartLines(
      [line(1, 5)],
      [],
      catalogue([[1, stocked({ inventoryQuantity: 3.9 })]]),
      POLICY,
    )

    expect(merged.lines[0]?.quantity).toBe(3)
  })

  it('still sells the last one when exactly one is left, because 1 is a boundary and not an edge to round away', () => {
    const merged = mergeCartLines(
      [line(1, 1)],
      [line(1, 1)],
      catalogue([[1, stocked({ inventoryQuantity: 1 })]]),
      POLICY,
    )

    expect(merged.lines[0]?.quantity).toBe(1)
    expect(merged.reduced[0]).toEqual({ reason: 'stock', requested: 2, resolved: 1, variantId: 1 })
  })

  it('grants a sum that lands exactly on stock, and reports no reduction that did not happen', () => {
    const merged = mergeCartLines(
      [line(1, 2)],
      [line(1, 2)],
      catalogue([[1, stocked({ inventoryQuantity: 4 })]]),
      POLICY,
    )

    expect(merged.lines[0]?.quantity).toBe(4)
    expect(merged.reduced).toEqual([])
  })
})

describe('the three result lists, read as a report the shopper can be shown', () => {
  it('puts every variant in exactly one outcome, and never the same one in two', () => {
    const merged = mergeCartLines(
      [line(8, 1), line(9, 9), line(10, 1)],
      [line(9, 1), line(11, 2)],
      catalogue([
        [8, stocked()],
        [9, stocked({ inventoryQuantity: 2 })],
        [10, null],
        [11, stocked()],
      ]),
      POLICY,
    )

    expect(merged.lines.map((entry) => entry.variantId)).toEqual([8, 9, 11])
    expect(merged.dropped.map((entry) => entry.variantId)).toEqual([10])
    // A reduced line is still a kept line; a dropped one is never also reduced.
    expect(merged.reduced.map((entry) => entry.variantId)).toEqual([9])

    const accounted = [...merged.lines, ...merged.dropped].map((entry) => entry.variantId)

    expect(new Set(accounted).size).toBe(accounted.length)
    expect(new Set(accounted)).toEqual(new Set([8, 9, 10, 11]))
  })

  it('resolves every dropped line to zero and every kept line to something a shopper can actually buy', () => {
    const merged = mergeCartLines(
      [line(1, 3), line(2, 3)],
      [line(3, 3)],
      catalogue([
        [1, stocked()],
        [2, stocked({ inventoryQuantity: 0 })],
        [3, stocked({ inventoryQuantity: 1 })],
      ]),
      POLICY,
    )

    expect(merged.dropped).toHaveLength(1)
    expect(merged.reduced).toHaveLength(1)

    for (const gone of merged.dropped) {
      expect(gone.resolved).toBe(0)
      expect(gone.requested).toBeGreaterThan(0)
    }

    for (const kept of merged.lines) {
      expect(kept.quantity).toBeGreaterThan(0)
    }

    for (const cut of merged.reduced) {
      // A "reduction" that kept the whole request, or that kept nothing, is a wrong report.
      expect(cut.resolved).toBeGreaterThan(0)
      expect(cut.resolved).toBeLessThan(cut.requested)
    }
  })

  it('reports drops in the same customer-first order as the bag itself', () => {
    const merged = mergeCartLines(
      [line(30, 1), line(31, 1)],
      [line(32, 1)],
      catalogue([
        [30, null],
        [31, null],
        [32, null],
      ]),
      POLICY,
    )

    expect(merged.dropped.map((entry) => entry.variantId)).toEqual([30, 31, 32])
  })
})

describe('the merge is a function of its inputs and nothing else', () => {
  const customer = () => [line(30, 2), line(31, 4)]
  const guest = () => [line(31, 4), line(32, 1)]
  const shelf = (): [number, LineAvailability | null][] => [
    [30, stocked()],
    [31, stocked({ inventoryQuantity: 6 })],
    [32, null],
  ]

  it('gives the identical bag when called twice with the same inputs', () => {
    expect(mergeCartLines(customer(), guest(), catalogue(shelf()), POLICY)).toEqual(
      mergeCartLines(customer(), guest(), catalogue(shelf()), POLICY),
    )
  })

  it('does not depend on the insertion order of the availability lookup', () => {
    // That map is built from reads whose row order is not guaranteed; the bag must not notice.
    expect(mergeCartLines(customer(), guest(), catalogue(shelf()), POLICY)).toEqual(
      mergeCartLines(customer(), guest(), catalogue([...shelf()].reverse()), POLICY),
    )
  })

  it('does not mutate either bag it was handed, so the caller can still see what was asked for', () => {
    const customerLines = customer()
    const guestLines = guest()
    const before = structuredClone({ customerLines, guestLines })

    mergeCartLines(customerLines, guestLines, catalogue(shelf()), POLICY)

    // `cart.ts` reads the customer's own lines again after the merge to choose update over create.
    expect({ customerLines, guestLines }).toEqual(before)
  })

  it('returns fresh line objects rather than aliases of the rows it was given', () => {
    const customerLines = customer()
    const merged = mergeCartLines(customerLines, [], catalogue(shelf()), POLICY)

    expect(merged.lines[0]).not.toBe(customerLines[0])
    expect(merged.lines[0]).toEqual({ ...customerLines[0], combined: false })
  })
})
