/**
 * **Plan §27.1a — price calculations.**
 *
 * Everything a customer reads about money passes through `lib/money.ts`, and everything a *card*
 * says about money passes through `lib/catalog/resolve.ts`. Both are pure, so every interesting
 * failure mode below is reachable from a literal — no database, no Payload, no DOM.
 *
 * - **Division happens once, at the formatting boundary.** D-20 stores money as integer minor units;
 *   a second division, or a hand-rolled `` `$${minor / 100}` ``, is how `$1234.5` and a European
 *   separator in the wrong place reach a page. The round-trip invariant below asserts that no
 *   floating-point error escapes: the digits that come out are the digits that went in.
 * - **`null` is UNKNOWN, `0` is NONE.** A product with no active variant has `priceFromMinor === null`
 *   and must render *no price line* — never `$0.00`. A genuinely free item priced at `0` must render
 *   `$0.00` — never nothing. The same distinction governs stock and both price-range bounds.
 * - **A compare-at price that is not a real saving must not render as one.** `ProductVariants.ts`:
 *   *"an equal or lower value is not a sale and must not be displayed as one."* An equal, lower,
 *   fractional or negative `compareAtFromMinor` must produce `compareAtLabel: null`, because a struck
 *   price is a claim about what the garment used to cost.
 * - **A bad locale degrades, it does not crash.** `formatMinorUnits` catches `Intl`'s `RangeError`
 *   and logs it; one malformed `site-settings.defaultLocale` must not take out a homepage rail.
 * - **Poison in, zero out.** `toMinorAmount`/`toWholeCount` exist because `Math.max(0, Math.floor(x))`
 *   is not a clamp — `NaN` walks straight through it, which is how Phase 16 shipped a `NaN` tax base.
 */

import {
  activeFilterChips,
  productCardBadge,
  productCardState,
  resolveProductCard,
  resolveProductCards,
  type ProductCard,
} from '@/lib/catalog/resolve'
import { formatMinorUnits, formatPriceRange, toMinorAmount, toWholeCount } from '@/lib/money'
import type { CatalogQuery, CatalogVocabulary } from '@/lib/catalog/query'
import type { CurrencyCode } from '@/payload/fields/money'
import { describe, expect, it, vi } from 'vitest'

const USD: CurrencyCode = 'USD'
const EN = 'en-US'

/** Every digit the formatter emitted, with symbol and separators discarded. */
const digitsOf = (value: null | string): string => (value ?? '').replace(/\D/g, '')

type DerivedRow = {
  compareAtFromMinor?: null | number
  inventoryTotal?: null | number
  priceFromMinor?: null | number
  priceToMinor?: null | number
}

/** A product row as the database hands one over: partial, untrusted, `unknown` at the boundary. */
const productRow = (derived: DerivedRow, rest: Record<string, unknown> = {}): unknown => ({
  derived,
  gallery: [],
  id: 41,
  name: 'Merino Crew',
  slug: 'merino-crew',
  ...rest,
})

/** Resolve a fixture expected to resolve; a `null` here is a broken test, not a result. */
const resolved = (input: unknown, threshold = 5): ProductCard => {
  const card = resolveProductCard(input, USD, EN, threshold)

  if (card === null) {
    throw new Error('fixture failed to resolve into a card')
  }

  return card
}

const cardFixture = (overrides: Partial<ProductCard> = {}): ProductCard => ({
  compareAtLabel: null,
  href: '/product/merino-crew',
  id: 41,
  image: null,
  isLimitedEdition: false,
  isNew: false,
  lowStockLabel: null,
  name: 'Merino Crew',
  priceLabel: '$240.00',
  state: 'available',
  ...overrides,
})

/* -------------------------------------------------------------------------------------------------
 * money.ts — formatMinorUnits
 * ---------------------------------------------------------------------------------------------- */

describe('formatMinorUnits', () => {
  it('divides by 100 exactly once, at the formatting boundary', () => {
    expect(formatMinorUnits(24000, USD, EN)).toBe('$240.00')
    expect(formatMinorUnits(9500, USD, EN)).toBe('$95.00')
  })

  it('renders the smallest representable amount rather than rounding it away', () => {
    expect(formatMinorUnits(1, USD, EN)).toBe('$0.01')
  })

  it('renders zero as $0.00, because 0 means NONE and is a price a product may have', () => {
    expect(formatMinorUnits(0, USD, EN)).toBe('$0.00')
  })

  it('returns null for null and undefined, because UNKNOWN has no price line to render', () => {
    // The caller must render nothing at all here. `$0.00` would invent a free product.
    expect(formatMinorUnits(null, USD, EN)).toBeNull()
    expect(formatMinorUnits(undefined, USD, EN)).toBeNull()
  })

  it('refuses a negative amount, which is not a price', () => {
    expect(formatMinorUnits(-1, USD, EN)).toBeNull()
    expect(formatMinorUnits(-24000, USD, EN)).toBeNull()
  })

  it('refuses a fractional amount, because minor units are whole by definition', () => {
    // 1999.5 is a tenth of a cent: a row written by something that never read D-20.
    expect(formatMinorUnits(1999.5, USD, EN)).toBeNull()
    expect(formatMinorUnits(0.1, USD, EN)).toBeNull()
  })

  it('refuses NaN and the infinities rather than printing "$NaN"', () => {
    expect(formatMinorUnits(Number.NaN, USD, EN)).toBeNull()
    expect(formatMinorUnits(Number.POSITIVE_INFINITY, USD, EN)).toBeNull()
    expect(formatMinorUnits(Number.NEGATIVE_INFINITY, USD, EN)).toBeNull()
  })

  it('refuses anything that is not a number, including a numeric string', () => {
    // A string price is the classic symptom of a value that skipped the money field entirely.
    expect(formatMinorUnits('1999' as unknown as number, USD, EN)).toBeNull()
    expect(formatMinorUnits(true as unknown as number, USD, EN)).toBeNull()
    expect(formatMinorUnits({} as unknown as number, USD, EN)).toBeNull()
  })

  it('accepts the largest safe integer and refuses the first unsafe one', () => {
    // Past 2^53 integers stop being exact, so the value is no longer the amount that was stored.
    expect(formatMinorUnits(Number.MAX_SAFE_INTEGER, USD, EN)).toEqual(expect.any(String))
    expect(formatMinorUnits(Number.MAX_SAFE_INTEGER + 1, USD, EN)).toBeNull()
  })

  it('lets Intl place the symbol and the separators, never a template literal', () => {
    expect(formatMinorUnits(123456789, USD, EN)).toBe('$1,234,567.89')
    expect(formatMinorUnits(1999, 'GBP', 'en-GB')).toBe('£19.99')
    // Trailing symbol, comma decimal, dot grouping, non-breaking space: four things a hand-rolled
    // `$${minor / 100}` gets wrong at once, and the reason locale is an argument.
    expect(formatMinorUnits(123456, 'EUR', 'de-DE')).toBe('1.234,56 €')
  })

  it('lets no floating-point error escape: the digits out are the digits in', () => {
    const samples = [1, 7, 29, 99, 100, 101, 999, 1999, 2000, 8999, 10_000, 99_999, 123_456_789]

    for (const minor of samples) {
      // padStart(3) because everything under a dollar still prints two decimal places.
      expect(digitsOf(formatMinorUnits(minor, USD, EN))).toBe(String(minor).padStart(3, '0'))
    }
  })

  it('degrades to null and logs when the locale is malformed, rather than taking out the page', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(formatMinorUnits(24000, USD, 'not a locale')).toBeNull()
    // Logged, not merely swallowed: on screen this null is indistinguishable from "no price", so a
    // single bad settings row would empty every rail with no other symptom.
    expect(spy).toHaveBeenCalledTimes(1)

    spy.mockRestore()
  })

  it('degrades the same way for an unknown currency code', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(formatMinorUnits(24000, 'XX' as CurrencyCode, EN)).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)

    spy.mockRestore()
  })
})

/* -------------------------------------------------------------------------------------------------
 * money.ts — formatPriceRange
 * ---------------------------------------------------------------------------------------------- */

describe('formatPriceRange', () => {
  it('says "From $95.00" only when the range is real', () => {
    expect(formatPriceRange(9500, 24000, USD, EN)).toBe('From $95.00')
  })

  it('drops the "From" when every variant is one price', () => {
    // A "From" over a single price promises a cheaper option that does not exist.
    expect(formatPriceRange(24000, 24000, USD, EN)).toBe('$240.00')
  })

  it('treats one minor unit of spread as a real range', () => {
    expect(formatPriceRange(9500, 9501, USD, EN)).toBe('From $95.00')
  })

  it('never points the range downwards when the bounds arrive reversed', () => {
    // priceTo < priceFrom is a data error; "From $240.00" would misprice the product upward.
    expect(formatPriceRange(24000, 9500, USD, EN)).toBe('$240.00')
  })

  it('falls back to the single price when the upper bound is unusable', () => {
    expect(formatPriceRange(9500, null, USD, EN)).toBe('$95.00')
    expect(formatPriceRange(9500, undefined, USD, EN)).toBe('$95.00')
    expect(formatPriceRange(9500, Number.NaN, USD, EN)).toBe('$95.00')
    expect(formatPriceRange(9500, 24000.5, USD, EN)).toBe('$95.00')
    expect(formatPriceRange(9500, Number.MAX_SAFE_INTEGER + 1, USD, EN)).toBe('$95.00')
  })

  it('returns null when the lower bound is unknown, even if an upper bound exists', () => {
    // No lower bound means no price at all; "Up to $240.00" is not a thing this shop says.
    expect(formatPriceRange(null, 24000, USD, EN)).toBeNull()
    expect(formatPriceRange(undefined, 24000, USD, EN)).toBeNull()
    expect(formatPriceRange(-1, 24000, USD, EN)).toBeNull()
  })

  it('distinguishes a free product from an unpriced one', () => {
    // 0 is NONE and prints; null is UNKNOWN and prints nothing.
    expect(formatPriceRange(0, 0, USD, EN)).toBe('$0.00')
    expect(formatPriceRange(0, 9500, USD, EN)).toBe('From $0.00')
    expect(formatPriceRange(null, null, USD, EN)).toBeNull()
  })

  it('suppresses the whole label when the locale cannot be formatted', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Not a bare "From", which would be a price line with no price in it.
    expect(formatPriceRange(9500, 24000, USD, 'not a locale')).toBeNull()

    spy.mockRestore()
  })
})

/* -------------------------------------------------------------------------------------------------
 * money.ts — toMinorAmount / toWholeCount
 * ---------------------------------------------------------------------------------------------- */

describe('toMinorAmount and toWholeCount', () => {
  it('turns NaN into 0, which Math.max(0, Math.floor(x)) on its own does not', () => {
    // The reason this function exists: Math.max(0, NaN) is NaN, and that NaN reached a tax base.
    expect(toMinorAmount(Number.NaN)).toBe(0)
    expect(toWholeCount(Number.NaN)).toBe(0)
  })

  it('turns both infinities into 0 rather than an unpayable total', () => {
    expect(toMinorAmount(Number.POSITIVE_INFINITY)).toBe(0)
    expect(toMinorAmount(Number.NEGATIVE_INFINITY)).toBe(0)
  })

  it('clamps a negative amount to 0, because a negative line is a refund, not a price', () => {
    expect(toMinorAmount(-1)).toBe(0)
    expect(toMinorAmount(-24000)).toBe(0)
    expect(toMinorAmount(-0.5)).toBe(0)
  })

  it('floors rather than rounds, so a coercion can never invent money or stock', () => {
    expect(toMinorAmount(1999.99)).toBe(1999)
    expect(toMinorAmount(0.9)).toBe(0)
    // 2.9 units must never become 3 units the warehouse does not hold.
    expect(toWholeCount(2.9)).toBe(2)
  })

  it('passes a whole non-negative number through untouched', () => {
    expect(toMinorAmount(0)).toBe(0)
    expect(toMinorAmount(1999)).toBe(1999)
    expect(toMinorAmount(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
    expect(toWholeCount(1)).toBe(1)
  })

  it('turns every non-number into 0, the numeric string included', () => {
    expect(toMinorAmount('1999' as unknown as number)).toBe(0)
    expect(toMinorAmount(null as unknown as number)).toBe(0)
    expect(toMinorAmount(undefined as unknown as number)).toBe(0)
    expect(toMinorAmount(true as unknown as number)).toBe(0)
    expect(toMinorAmount([] as unknown as number)).toBe(0)
    expect(toMinorAmount({} as unknown as number)).toBe(0)
  })

  it('is one implementation under two names, so the money and count rules cannot drift apart', () => {
    expect(toWholeCount).toBe(toMinorAmount)
  })
})

/* -------------------------------------------------------------------------------------------------
 * catalog/resolve.ts — productCardState
 * ---------------------------------------------------------------------------------------------- */

describe('productCardState', () => {
  it('is unavailable when there is no price, whatever the stock column says', () => {
    // No active variant. Stock is irrelevant: there is nothing to sell at any quantity.
    expect(productCardState(null, 40, 5)).toBe('unavailable')
    expect(productCardState(undefined, 40, 5)).toBe('unavailable')
  })

  it('is unavailable for a price that is not whole, non-negative and safe', () => {
    expect(productCardState(-1, 40, 5)).toBe('unavailable')
    expect(productCardState(1999.5, 40, 5)).toBe('unavailable')
    expect(productCardState(Number.NaN, 40, 5)).toBe('unavailable')
    expect(productCardState(Number.MAX_SAFE_INTEGER + 1, 40, 5)).toBe('unavailable')
  })

  it('treats a price of 0 as a price, so a free item is sold rather than hidden', () => {
    expect(productCardState(0, 40, 5)).toBe('available')
  })

  it('is sold out for no stock, and for unknown stock, which is the safe direction', () => {
    // null is UNKNOWN. Offering a garment whose stock cannot be confirmed is the failure that costs
    // money; refusing to offer one that does exist costs a click.
    expect(productCardState(24000, 0, 5)).toBe('soldOut')
    expect(productCardState(24000, null, 5)).toBe('soldOut')
    expect(productCardState(24000, undefined, 5)).toBe('soldOut')
    expect(productCardState(24000, -3, 5)).toBe('soldOut')
  })

  it('draws the low-stock line at the threshold itself, inclusive', () => {
    expect(productCardState(24000, 5, 5)).toBe('lowStock')
    expect(productCardState(24000, 6, 5)).toBe('available')
    expect(productCardState(24000, 1, 5)).toBe('lowStock')
  })

  it('clamps a threshold below 1, which would otherwise make low stock unreachable', () => {
    // A 0 stored before SiteSettings had min:1 would reclassify the last unit as plentiful.
    expect(productCardState(24000, 1, 0)).toBe('lowStock')
    expect(productCardState(24000, 1, -10)).toBe('lowStock')
    expect(productCardState(24000, 2, 0)).toBe('available')
  })

  it('floors a fractional threshold rather than comparing against a fraction', () => {
    expect(productCardState(24000, 5, 5.9)).toBe('lowStock')
    expect(productCardState(24000, 6, 5.9)).toBe('available')
  })

  it('is available for a warehouse full of stock', () => {
    expect(productCardState(24000, 100_000, 5)).toBe('available')
  })
})

/* -------------------------------------------------------------------------------------------------
 * catalog/resolve.ts — the price line on a card
 * ---------------------------------------------------------------------------------------------- */

describe('resolveProductCard price labels', () => {
  it('renders a single price for a product whose variants agree', () => {
    const card = resolved(
      productRow({ inventoryTotal: 40, priceFromMinor: 24000, priceToMinor: 24000 }),
    )

    expect(card.priceLabel).toBe('$240.00')
    expect(card.state).toBe('available')
  })

  it('renders "From $95.00" for a product whose variants do not', () => {
    const card = resolved(
      productRow({ inventoryTotal: 40, priceFromMinor: 9500, priceToMinor: 24000 }),
    )

    expect(card.priceLabel).toBe('From $95.00')
  })

  it('renders no price line at all for a product with no active variant', () => {
    const card = resolved(
      productRow({ inventoryTotal: 0, priceFromMinor: null, priceToMinor: null }),
    )

    // Not "$0.00" and not an empty string: the component must be able to omit the line entirely.
    expect(card.priceLabel).toBeNull()
    expect(card.state).toBe('unavailable')
  })

  it('renders a struck price only when the saving is real', () => {
    const card = resolved(
      productRow({ compareAtFromMinor: 40000, inventoryTotal: 40, priceFromMinor: 24000 }),
    )

    expect(card.compareAtLabel).toBe('$400.00')
  })

  it('refuses a compare-at equal to the price, because that is not a sale', () => {
    const card = resolved(
      productRow({ compareAtFromMinor: 24000, inventoryTotal: 40, priceFromMinor: 24000 }),
    )

    expect(card.compareAtLabel).toBeNull()
  })

  it('refuses a compare-at below the price, which would render as a negative saving', () => {
    const card = resolved(
      productRow({ compareAtFromMinor: 20000, inventoryTotal: 40, priceFromMinor: 24000 }),
    )

    expect(card.compareAtLabel).toBeNull()
  })

  it('refuses a compare-at that is not a usable price at all', () => {
    for (const compareAtFromMinor of [-1, 1999.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const card = resolved(
        productRow({ compareAtFromMinor, inventoryTotal: 40, priceFromMinor: 24000 }),
      )

      expect(card.compareAtLabel).toBeNull()
    }
  })

  it('refuses a compare-at when there is no current price to compare it against', () => {
    // "was $400" beside no price is a saving claim with nothing to subtract from.
    const card = resolved(
      productRow({ compareAtFromMinor: 40000, inventoryTotal: 0, priceFromMinor: null }),
    )

    expect(card.compareAtLabel).toBeNull()
    expect(card.priceLabel).toBeNull()
  })

  it('refuses a compare-at of 0 against a free product', () => {
    const card = resolved(
      productRow({ compareAtFromMinor: 0, inventoryTotal: 4, priceFromMinor: 0 }),
    )

    expect(card.compareAtLabel).toBeNull()
    expect(card.priceLabel).toBe('$0.00')
  })

  it('labels low stock with the count, and only in the low-stock state', () => {
    const low = resolved(productRow({ inventoryTotal: 3, priceFromMinor: 24000 }))
    const plenty = resolved(productRow({ inventoryTotal: 40, priceFromMinor: 24000 }))
    const gone = resolved(productRow({ inventoryTotal: 0, priceFromMinor: 24000 }))

    expect(low.lowStockLabel).toBe('Only 3 left')
    expect(low.state).toBe('lowStock')
    // A count on a well-stocked card is urgency invented from a number nobody asked about.
    expect(plenty.lowStockLabel).toBeNull()
    // "Only 0 left" is the tell of a label built without checking the state first.
    expect(gone.lowStockLabel).toBeNull()
  })

  it('drops a row that cannot be turned into a link or a name', () => {
    expect(resolveProductCard(null, USD, EN, 5)).toBeNull()
    expect(resolveProductCard('a product', USD, EN, 5)).toBeNull()
    expect(resolveProductCard(productRow({}, { slug: undefined }), USD, EN, 5)).toBeNull()
    expect(resolveProductCard(productRow({}, { slug: '   ' }), USD, EN, 5)).toBeNull()
    expect(resolveProductCard(productRow({}, { name: '   ' }), USD, EN, 5)).toBeNull()
  })

  it('keeps a priceless product rather than dropping it, because the card can say so', () => {
    // Unlike the homepage rail, this model has an `unavailable` state and later phases link to it.
    expect(resolveProductCard(productRow({ priceFromMinor: null }), USD, EN, 5)).not.toBeNull()
  })

  it('encodes the slug into the href rather than interpolating it', () => {
    const card = resolved(productRow({ priceFromMinor: 24000 }, { slug: '../../admin' }))

    expect(card.href).toBe('/product/..%2F..%2Fadmin')
  })

  it('treats a bare media id as no image, since an id cannot be rendered', () => {
    const bare = resolved(productRow({ priceFromMinor: 24000 }, { gallery: [{ image: 7 }] }))
    const populated = resolved(
      productRow({ priceFromMinor: 24000 }, { gallery: [{ image: { id: 7, url: '/a.jpg' } }] }),
    )

    expect(bare.image).toBeNull()
    expect(populated.image).toMatchObject({ id: 7 })
  })

  it('reads the merchandising flags strictly, so a truthy 1 is not a NEW badge', () => {
    const truthy = resolved(
      productRow({ priceFromMinor: 24000 }, { isLimitedEdition: 1, isNew: 'yes' }),
    )

    expect(truthy.isNew).toBe(false)
    expect(truthy.isLimitedEdition).toBe(false)
  })
})

describe('resolveProductCards', () => {
  it('answers with an empty list for a missing collection rather than throwing', () => {
    expect(resolveProductCards(null, USD, EN, 5)).toEqual([])
    expect(resolveProductCards(undefined, USD, EN, 5)).toEqual([])
    expect(resolveProductCards([], USD, EN, 5)).toEqual([])
  })

  it('drops the rows it cannot resolve and keeps the order of the rest', () => {
    const cards = resolveProductCards(
      [
        productRow({ priceFromMinor: 9500 }, { id: 1, slug: 'first' }),
        null,
        productRow({ priceFromMinor: 24000 }, { id: 2, slug: '' }),
        productRow({ priceFromMinor: 12000 }, { id: 3, slug: 'third' }),
      ],
      USD,
      EN,
      5,
    )

    expect(cards).toHaveLength(2)
    expect(cards.map((card) => card.id)).toEqual([1, 3])
    expect(cards[0]?.priceLabel).toBe('$95.00')
  })

  it('applies the threshold it is given to every card, because it is a render-time setting', () => {
    const rows = [productRow({ inventoryTotal: 8, priceFromMinor: 24000 })]

    // A stored flag would be stale on every product the moment an editor changed the number.
    expect(resolveProductCards(rows, USD, EN, 5)[0]?.state).toBe('available')
    expect(resolveProductCards(rows, USD, EN, 10)[0]?.state).toBe('lowStock')
  })
})

/* -------------------------------------------------------------------------------------------------
 * catalog/resolve.ts — the badge a sale competes for
 * ---------------------------------------------------------------------------------------------- */

describe('productCardBadge', () => {
  it('shows Sale when the card carries a real struck price', () => {
    expect(productCardBadge(cardFixture({ compareAtLabel: '$400.00' }))).toEqual({
      label: 'Sale',
      tone: 'accent',
    })
  })

  it('lets availability outrank the sale, without losing the struck price', () => {
    const soldOut = cardFixture({ compareAtLabel: '$400.00', state: 'soldOut' })

    // A SALE badge over a garment nobody can buy advertises a disappointment; the struck price still
    // renders in the price line, so the saving is not lost with the badge.
    expect(productCardBadge(soldOut)).toEqual({ label: 'Sold out', tone: 'muted' })
    expect(soldOut.compareAtLabel).toBe('$400.00')
  })

  it('prefers the low-stock count to the sale badge', () => {
    const badge = productCardBadge(
      cardFixture({ compareAtLabel: '$400.00', lowStockLabel: 'Only 2 left', state: 'lowStock' }),
    )

    expect(badge).toEqual({ label: 'Only 2 left', tone: 'default' })
  })

  it('falls through to New and then Limited only when there is no saving to announce', () => {
    expect(productCardBadge(cardFixture({ isNew: true }))?.label).toBe('New')
    expect(productCardBadge(cardFixture({ compareAtLabel: '$400.00', isNew: true }))?.label).toBe(
      'Sale',
    )
    expect(productCardBadge(cardFixture({ isLimitedEdition: true, isNew: true }))?.label).toBe(
      'New',
    )
    expect(productCardBadge(cardFixture({ isLimitedEdition: true }))?.label).toBe('Limited')
  })

  it('shows nothing at all for an ordinary in-stock product', () => {
    expect(productCardBadge(cardFixture())).toBeNull()
  })
})

/* -------------------------------------------------------------------------------------------------
 * catalog/resolve.ts — the price filter chip
 * ---------------------------------------------------------------------------------------------- */

describe('activeFilterChips price chip', () => {
  const EMPTY_VOCAB: CatalogVocabulary = {
    categories: [],
    collections: [],
    colors: [],
    priceCeilingMinor: null,
    priceFloorMinor: null,
    sizes: [],
  }

  const query = (overrides: Partial<CatalogQuery>): CatalogQuery => ({
    availability: null,
    categories: [],
    collections: [],
    colors: [],
    page: 1,
    priceMaxMinor: null,
    priceMinMinor: null,
    q: null,
    requestedCategories: [],
    sizes: [],
    sort: 'featured',
    ...overrides,
  })

  const format = (minor: number): null | string => formatMinorUnits(minor, USD, EN)

  it('formats both bounds through the caller-supplied formatter', () => {
    const chips = activeFilterChips(
      query({ priceMaxMinor: 20_000, priceMinMinor: 5000 }),
      EMPTY_VOCAB,
      format,
    )

    expect(chips).toEqual([{ facet: 'price', label: '$50.00 – $200.00', value: 'price' }])
  })

  it('says From when only a floor was set, and Up to when only a ceiling was', () => {
    expect(activeFilterChips(query({ priceMinMinor: 5000 }), EMPTY_VOCAB, format)[0]?.label).toBe(
      'From $50.00',
    )
    expect(activeFilterChips(query({ priceMaxMinor: 20_000 }), EMPTY_VOCAB, format)[0]?.label).toBe(
      'Up to $200.00',
    )
  })

  it('offers a removable chip for a floor of 0, because 0 was chosen and null was not', () => {
    // A filter that is applied and cannot be seen is a filter the customer cannot clear.
    expect(activeFilterChips(query({ priceMinMinor: 0 }), EMPTY_VOCAB, format)[0]?.label).toBe(
      'From $0.00',
    )
    expect(activeFilterChips(query({}), EMPTY_VOCAB, format)).toEqual([])
  })
})
