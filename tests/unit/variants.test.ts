import { describe, expect, it } from 'vitest'

import {
  buildVariantMatrix,
  compareAtForColor,
  inventoryMessage,
  priceRangeForColor,
  resolveVariant,
  type SelectableVariant,
} from '@/lib/product/variants'

/**
 * **Plan §27.1a — unit tests for variant resolution (`lib/product/variants.ts`, plan §13.1c).**
 *
 * The module is the whole of *"variant selection must be authoritative"*: the swatch row, the size
 * row and the resolved variant all come out of one pass, so they cannot disagree about the same
 * catalogue. These tests exist for the failure modes a screenshot of a working page cannot show,
 * and each one is a bug this project has an explicit rule against:
 *
 * - **Guessing a size.** A stale link carrying an unknown size must resolve to *no size*, never to
 *   a neighbouring one. Feature matrix §7 lists *"invalid variant query"*; picking on a customer's
 *   behalf is how somebody is shipped the wrong garment.
 * - **Colour falls back, size does not.** The asymmetry is deliberate and is exactly the kind of
 *   thing a later refactor "tidies" into symmetry.
 * - **Three states, not two.** `active: false` is withdrawn and must not appear at all;
 *   `inventoryQuantity: 0` is sold out and must appear, listed; a combination never made is
 *   `missing`. Collapsing any two loses the fact a shopper most wants — whether the garment is made
 *   in their size at all.
 * - **`null` is UNKNOWN, `0` is NONE.** An absent `priceMinor` is not a free product, and an absent
 *   `inventoryQuantity` is not stock.
 * - **Money stays in integer minor units.** Nothing here divides; division happens once, inside
 *   `formatMinorUnits`, at the formatting boundary.
 * - **A selection that resolves to nothing must not look purchasable.** `selected === null` is what
 *   denies the page a variant id, a price and an add-to-bag target.
 *
 * The plan's own named example is the centrepiece: *"if Black / M exists but Cream / M does not"*.
 */

const USD = 'USD' as const
const LOCALE = 'en-US'
const THRESHOLD = 5

const row = (variant: Partial<SelectableVariant> & { id: number }): SelectableVariant => ({
  active: true,
  color: 'Black',
  colorHex: '#111111',
  inventoryQuantity: 10,
  priceMinor: 9500,
  size: 'M',
  sizeSortOrder: 20,
  ...variant,
})

/**
 * The plan's catalogue: Black in S/M/L, Cream in S/L only — Cream / M was never made. Cream is
 * listed first on purpose, so an alphabetical swatch row has to be the module's doing rather than
 * an accident of the fixture.
 */
const CATALOGUE: SelectableVariant[] = [
  {
    color: 'Cream',
    colorHex: '#f2ece1',
    id: 4,
    inventoryQuantity: 3,
    priceMinor: 12000,
    size: 'S',
    sizeSortOrder: 10,
    sku: 'N01-CRM-S',
  },
  {
    color: 'Cream',
    colorHex: '#f2ece1',
    id: 5,
    inventoryQuantity: 0,
    priceMinor: 12000,
    size: 'L',
    sizeSortOrder: 30,
    sku: 'N01-CRM-L',
  },
  {
    color: 'Black',
    colorHex: '#111111',
    id: 1,
    inventoryQuantity: 0,
    priceMinor: 9500,
    size: 'S',
    sizeSortOrder: 10,
    sku: 'N01-BLK-S',
  },
  {
    color: 'Black',
    colorHex: '#111111',
    id: 2,
    inventoryQuantity: 4,
    priceMinor: 9500,
    size: 'M',
    sizeSortOrder: 20,
    sku: 'N01-BLK-M',
  },
  {
    color: 'Black',
    colorHex: '#111111',
    id: 3,
    inventoryQuantity: 12,
    priceMinor: 9500,
    size: 'L',
    sizeSortOrder: 30,
    sku: 'N01-BLK-L',
  },
].map((variant) => row(variant))

const matrix = (
  requested: { color?: null | string; size?: null | string },
  variants: SelectableVariant[] = CATALOGUE,
) => buildVariantMatrix(variants, requested, USD, LOCALE, THRESHOLD)

type Matrix = ReturnType<typeof matrix>

const sizeNamed = (sizes: Matrix['sizes'], value: string): Matrix['sizes'][number] => {
  const found = sizes.find((size) => size.value === value)

  if (!found) {
    throw new Error(`Fixture expected a size row for ${value}.`)
  }

  return found
}

describe('buildVariantMatrix, with nothing asked for', () => {
  it('refuses to choose a size on the customer’s behalf, because a size is a commitment', () => {
    const result = matrix({})

    expect(result.selectedSize).toBeNull()
    /* No size means no purchasable row: the page has nothing it could submit yet. */
    expect(result.selected).toBeNull()
  })

  it('still chooses a colour, because a product page with no colourway cannot be bought from', () => {
    expect(matrix({}).selectedColor).toBe('Black')
  })

  it('does not report an invalid selection when the URL asked for nothing', () => {
    expect(matrix({}).invalidSelection).toBe(false)
  })

  it('lists each colour exactly once, alphabetically, whatever order the rows arrive in', () => {
    /*
     * Cream is first in the fixture. Alphabetical is the module's decision and it matters: the
     * default colourway falls back to this row's first stocked entry, so an order that depended on
     * which sizes a colour happens to come in would let the page's default vary between requests.
     */
    expect(matrix({}).colors.map((color) => color.value)).toEqual(['Black', 'Cream'])
  })

  it('carries each colour’s swatch hex through untouched', () => {
    expect(matrix({}).colors.map((color) => color.hex)).toEqual(['#111111', '#f2ece1'])
  })

  it('lists every size the product is made in, across all colours, in the merchandiser’s order', () => {
    expect(matrix({}).sizes.map((size) => size.value)).toEqual(['S', 'M', 'L'])
  })

  it('orders sizes by sizeSortOrder rather than alphabetically, so S precedes M precedes L', () => {
    expect(matrix({}).sizes.map((size) => size.sortOrder)).toEqual([10, 20, 30])
  })
})

describe('buildVariantMatrix, given a colour and no size', () => {
  it('marks a size that exists in this colour but has no stock as unavailable, not missing', () => {
    /* Sold out is a state the customer is told about; withdrawn is a removal. Black / S is sold out. */
    const blackS = sizeNamed(matrix({ color: 'Black' }).sizes, 'S')

    expect(blackS.available).toBe(false)
    expect(blackS.missing).toBe(false)
  })

  it('marks a size the colour was never made in as missing as well as unavailable', () => {
    const creamM = sizeNamed(matrix({ color: 'Cream' }).sizes, 'M')

    expect(creamM.missing).toBe(true)
    expect(creamM.available).toBe(false)
  })

  it('keeps a size that is missing in this colour in the row rather than hiding it', () => {
    /* §13.1c: disable, never remove — a size that vanishes on a colour change reads as a fault. */
    expect(matrix({ color: 'Cream' }).sizes.map((size) => size.value)).toEqual(['S', 'M', 'L'])
  })

  it('re-answers the size row for the colour in hand: Cream / S is buyable, Cream / L is not', () => {
    const cream = matrix({ color: 'Cream' })

    expect(sizeNamed(cream.sizes, 'S').available).toBe(true)
    expect(sizeNamed(cream.sizes, 'L').available).toBe(false)
    /* Cream / L exists and is sold out — a different sentence from "not made in this colour". */
    expect(sizeNamed(cream.sizes, 'L').missing).toBe(false)
  })

  it('matches the colour case-insensitively and answers with the stored spelling', () => {
    /* `?color=cream` is a hand-typed URL; canonicalising the case is this module's job. */
    const result = matrix({ color: 'cream' })

    expect(result.selectedColor).toBe('Cream')
    expect(result.invalidSelection).toBe(false)
  })

  it('resolves no variant from a colour alone, because a colour is not a purchasable thing', () => {
    const result = matrix({ color: 'Black' })

    expect(result.selected).toBeNull()
    expect(result.selectedSize).toBeNull()
  })
})

describe('buildVariantMatrix, given a colour and size that exist', () => {
  it('resolves exactly the row that was asked for', () => {
    const selected = matrix({ color: 'Black', size: 'M' }).selected

    expect(selected?.id).toBe(2)
    expect(selected?.color).toBe('Black')
    expect(selected?.size).toBe('M')
    expect(selected?.sku).toBe('N01-BLK-M')
  })

  it('keeps the price in integer minor units and formats it once, at the boundary', () => {
    const selected = matrix({ color: 'Black', size: 'M' }).selected

    /* 9500, never 95 — the matrix must not divide. Division happens inside formatMinorUnits. */
    expect(selected?.priceMinor).toBe(9500)
    expect(Number.isSafeInteger(selected?.priceMinor)).toBe(true)
    expect(selected?.priceLabel).toBe('$95.00')
  })

  it('reports low stock against the threshold it was handed, not a hard-coded number', () => {
    /* Black / M holds 4 against a threshold of 5; Black / L holds 12. */
    expect(matrix({ color: 'Black', size: 'M' }).selected?.availability).toBe('lowStock')
    expect(matrix({ color: 'Black', size: 'L' }).selected?.availability).toBe('available')
  })

  it('matches the size case-insensitively and answers with the stored spelling', () => {
    const result = matrix({ color: 'black', size: 'm' })

    expect(result.selectedSize).toBe('M')
    expect(result.selected?.id).toBe(2)
    expect(result.invalidSelection).toBe(false)
  })

  it('resolves a sold-out combination rather than refusing it, so the page can say so', () => {
    const soldOut = matrix({ color: 'Black', size: 'S' }).selected

    expect(soldOut?.id).toBe(1)
    expect(soldOut?.availability).toBe('soldOut')
    expect(soldOut?.inventoryQuantity).toBe(0)
  })
})

describe('the invalid variant query, feature matrix §7', () => {
  it('falls back to a colour when the URL names one that does not exist, and says so', () => {
    const result = matrix({ color: 'Chartreuse' })

    expect(result.invalidSelection).toBe(true)
    expect(result.selectedColor).toBe('Black')
  })

  it('still resolves the requested size under the fallback colour, so the page stays buyable', () => {
    const result = matrix({ color: 'Chartreuse', size: 'M' })

    /* A colour is a way of looking at the product; substituting one is recoverable, and flagged. */
    expect(result.selectedColor).toBe('Black')
    expect(result.selected?.id).toBe(2)
    expect(result.invalidSelection).toBe(true)
  })

  it('resolves a size the product does not have to no size at all, never to a neighbouring one', () => {
    const result = matrix({ color: 'Black', size: 'XXL' })

    expect(result.selectedSize).toBeNull()
    expect(result.selected).toBeNull()
    expect(result.invalidSelection).toBe(true)
  })

  it('flags a URL that names neither a real colour nor a real size', () => {
    const result = matrix({ color: 'Chartreuse', size: 'XXL' })

    expect(result.invalidSelection).toBe(true)
    expect(result.selectedSize).toBeNull()
    expect(result.selected).toBeNull()
  })

  it('treats a blank parameter as absent rather than as a failed lookup', () => {
    /* `?color=&size=` is what an empty control submits; nobody asked for anything unavailable. */
    const result = matrix({ color: '   ', size: '' })

    expect(result.invalidSelection).toBe(false)
    expect(result.selectedColor).toBe('Black')
    expect(result.selectedSize).toBeNull()
  })
})

describe('the plan’s named case: Black / M exists but Cream / M does not', () => {
  it('refuses to resolve Cream / M, so the combination cannot be submitted', () => {
    /*
     * The one thing §13.1c states outright — "do not permit submission of Cream / M". A null
     * `selected` is what denies the page a variant id, a price and an add-to-bag target, and it is
     * the assertion that must never be relaxed.
     *
     * How the page *explains* the refusal is deliberately not asserted here; see the report note on
     * `invalidSelection` for a combination whose size exists elsewhere in the catalogue.
     */
    expect(matrix({ color: 'Cream', size: 'M' }).selected).toBeNull()
  })

  it('keeps Cream selectable and keeps M in the size row, disabled', () => {
    const result = matrix({ color: 'Cream', size: 'M' })

    expect(result.selectedColor).toBe('Cream')
    expect(sizeNamed(result.sizes, 'M').missing).toBe(true)
    expect(sizeNamed(result.sizes, 'M').available).toBe(false)
  })

  it('still resolves Black / M, so the combination that was made is unaffected', () => {
    expect(matrix({ color: 'Black', size: 'M' }).selected?.id).toBe(2)
  })

  it('flags it as an invalid selection, so the page explains itself instead of going quiet', () => {
    /*
     * **The defect Phase 27's tests found, now pinned.**
     *
     * `invalidSelection` used to catch only a colour or a size that exists nowhere on the product.
     * It missed the version feature matrix §7 actually names: `sizes` is every size across the
     * WHOLE product — each entry carrying `missing` for the selected colour — so "M" was found,
     * the flag stayed false, and the live region that exists to say *"that combination is not
     * available — showing what we do have"* said nothing at all. The customer saw M apparently
     * chosen, Add to bag disabled, and no explanation.
     *
     * `product-page.tsx` is the only consumer, and it renders exactly that sentence.
     */
    const result = matrix({ color: 'Cream', size: 'M' })

    expect(result.invalidSelection).toBe(true)

    /* And it stays false where nothing was asked for that does not exist. */
    expect(matrix({ color: 'Cream', size: 'S' }).invalidSelection).toBe(false)
    expect(matrix({ color: 'Cream' }).invalidSelection).toBe(false)
  })
})

describe('buildVariantMatrix, colour fallback and stock', () => {
  const ash = row({ color: 'Ash', colorHex: '#d9d9d9', id: 20, inventoryQuantity: 0, size: 'M' })
  const bone = row({ color: 'Bone', colorHex: '#efe9df', id: 21, inventoryQuantity: 6, size: 'M' })

  it('prefers a colour with stock over the alphabetically first one', () => {
    /* Ash sorts first and is sold out; defaulting to it would open the page on a dead colourway. */
    expect(matrix({}, [ash, bone]).selectedColor).toBe('Bone')
  })

  it('falls back to the first colour when every colour is sold out, because sold out is a state', () => {
    const allGone = matrix({}, [ash, row({ ...bone, inventoryQuantity: 0 })])

    expect(allGone.selectedColor).toBe('Ash')
    expect(allGone.colors.map((color) => color.available)).toEqual([false, false])
  })

  it('marks a colour available when anything in it is in stock, not when everything is', () => {
    /* Black is S sold out, M and L stocked — one buyable size is enough to offer the swatch. */
    expect(matrix({}).colors).toEqual([
      { available: true, hex: '#111111', value: 'Black' },
      { available: true, hex: '#f2ece1', value: 'Cream' },
    ])
  })

  it('honours an explicitly requested colour even when it has nothing in stock', () => {
    const soldOutColour = matrix({ color: 'Ash' }, [ash, bone])

    expect(soldOutColour.selectedColor).toBe('Ash')
    expect(soldOutColour.invalidSelection).toBe(false)
  })
})

describe('buildVariantMatrix, degenerate catalogues', () => {
  it('returns an empty matrix when every variant is withdrawn', () => {
    const withdrawn = CATALOGUE.map((variant) => ({ ...variant, active: false }))
    const result = matrix({ color: 'Black', size: 'M' }, withdrawn)

    /* active: false is a removal — an inactive row must reach neither the swatches nor the sizes. */
    expect(result.colors).toEqual([])
    expect(result.sizes).toEqual([])
    expect(result.selectedColor).toBeNull()
    expect(result.selectedSize).toBeNull()
    expect(result.selected).toBeNull()
    /* From outside, the URL named a colour and a size that are simply not there. */
    expect(result.invalidSelection).toBe(true)
  })

  it('survives a product with no variants at all without inventing a selection', () => {
    const empty = matrix({}, [])

    expect(empty.colors).toEqual([])
    expect(empty.sizes).toEqual([])
    expect(empty.selectedColor).toBeNull()
    expect(empty.selected).toBeNull()
    expect(empty.invalidSelection).toBe(false)
  })

  it('selects the only size of a one-size product, because a row of one is not a choice', () => {
    const only = [
      row({
        color: 'Bone',
        id: 30,
        inventoryQuantity: 1,
        priceMinor: 20000,
        size: 'OS',
        sizeSortOrder: 0,
      }),
    ]
    const result = matrix({}, only)

    expect(result.colors).toHaveLength(1)
    expect(result.sizes).toEqual([{ available: true, missing: false, sortOrder: 0, value: 'OS' }])
    /*
     * Phase 35 (P35-31). Selected, not added: the customer still presses Add to bag. What changed
     * is that they are no longer asked to "choose" from a row of one first.
     */
    expect(result.selectedSize).toBe('OS')
    expect(result.selected?.id).toBe(30)
    expect(result.invalidSelection).toBe(false)
    expect(matrix({ color: 'Bone', size: 'OS' }, only).selected?.priceMinor).toBe(20000)
  })

  it('still refuses to substitute the only size for a different size the URL asked for', () => {
    const only = [row({ color: 'Bone', id: 32, size: 'OS', sizeSortOrder: 0 })]
    const result = matrix({ color: 'Bone', size: 'XL' }, only)

    expect(result.selectedSize).toBeNull()
    expect(result.selected).toBeNull()
    expect(result.invalidSelection).toBe(true)
  })

  it('selects the only size in every colour, and resolves a sold-out one as sold out', () => {
    const twoColours = [
      row({ color: 'Bone', id: 33, size: 'OS', sizeSortOrder: 0 }),
      row({ color: 'Ink', id: 34, inventoryQuantity: 0, size: 'OS', sizeSortOrder: 0 }),
    ]

    expect(matrix({ color: 'Bone' }, twoColours).selected?.id).toBe(33)
    /* Selected so the page can say "sold out", exactly as an explicitly chosen sold-out size does. */
    expect(matrix({ color: 'Ink' }, twoColours).selected?.availability).toBe('soldOut')
  })

  it('does not select anything automatically when the product has more than one size', () => {
    expect(matrix({ color: 'Black' }).selectedSize).toBeNull()
  })

  it('shows a single sold-out variant rather than hiding the product’s only row', () => {
    const only = [row({ color: 'Bone', id: 31, inventoryQuantity: 0, size: 'OS' })]
    const result = matrix({ color: 'Bone', size: 'OS' }, only)

    expect(result.colors[0]?.available).toBe(false)
    expect(sizeNamed(result.sizes, 'OS').missing).toBe(false)
    expect(result.selected?.availability).toBe('soldOut')
  })
})

describe('what counts as a purchasable row at all', () => {
  const offeredColours = (variant: SelectableVariant) =>
    matrix({}, [variant]).colors.map((color) => color.value)

  it('treats a null price as UNKNOWN and withdraws the row, rather than reading it as free', () => {
    expect(offeredColours(row({ id: 40, priceMinor: null }))).toEqual([])
  })

  it('treats a zero price as NONE — a real, formattable amount — and keeps the row', () => {
    /* 0 and null are not interchangeable: a gift with purchase is priced; an unpriced row is broken. */
    expect(offeredColours(row({ id: 41, priceMinor: 0 }))).toEqual(['Black'])
    expect(
      matrix({ color: 'Black', size: 'M' }, [row({ id: 41, priceMinor: 0 })]).selected?.priceLabel,
    ).toBe('$0.00')
  })

  it('withdraws a negative, fractional or NaN price, because minor units are whole and non-negative', () => {
    expect(offeredColours(row({ id: 42, priceMinor: -1 }))).toEqual([])
    /* 19.99 is the classic "someone stored major units" bug; it must not reach a customer. */
    expect(offeredColours(row({ id: 43, priceMinor: 19.99 }))).toEqual([])
    expect(offeredColours(row({ id: 44, priceMinor: Number.NaN }))).toEqual([])
  })

  it('withdraws a row with no colour or no size, since neither can be selected', () => {
    expect(offeredColours(row({ color: '   ', id: 45 }))).toEqual([])
    expect(offeredColours(row({ id: 46, size: null }))).toEqual([])
  })

  it('treats only an explicit active:false as withdrawn, so an unset flag still sells', () => {
    expect(offeredColours(row({ active: null, id: 47 }))).toEqual(['Black'])
    expect(offeredColours(row({ active: undefined, id: 48 }))).toEqual(['Black'])
    expect(offeredColours(row({ active: false, id: 49 }))).toEqual([])
  })

  it('trims stored whitespace, so a padded colour and its clean twin are one swatch', () => {
    const padded = [
      row({ color: '  Black  ', id: 50, size: ' M ' }),
      row({ id: 51, size: 'L', sizeSortOrder: 30 }),
    ]

    expect(matrix({}, padded).colors.map((color) => color.value)).toEqual(['Black'])
    expect(matrix({}, padded).sizes.map((size) => size.value)).toEqual(['M', 'L'])
    /* And the trimmed value is what resolves, so the URL contract is the stored spelling. */
    expect(matrix({ color: 'Black', size: 'M' }, padded).selected?.id).toBe(50)
  })
})

describe('resolveVariant', () => {
  const resolve = (variant: Partial<SelectableVariant> & { id: number }, threshold = THRESHOLD) =>
    resolveVariant(row(variant), USD, LOCALE, threshold)

  it('shows a struck-through former price only when the saving is real', () => {
    expect(resolve({ compareAtPriceMinor: 12000, id: 60 })?.compareAtLabel).toBe('$120.00')
  })

  it('refuses to dress an equal or lower former price as a saving', () => {
    /* Compared on minor units before formatting, so two amounts that format alike cannot lie. */
    expect(resolve({ compareAtPriceMinor: 9500, id: 61 })?.compareAtLabel).toBeNull()
    expect(resolve({ compareAtPriceMinor: 8000, id: 62 })?.compareAtLabel).toBeNull()
    expect(resolve({ compareAtPriceMinor: null, id: 63 })?.compareAtLabel).toBeNull()
  })

  it('reads unknown stock as none, because unknown is never a reason to sell', () => {
    const unknown = resolve({ id: 64, inventoryQuantity: null })

    expect(unknown?.inventoryQuantity).toBe(0)
    expect(unknown?.availability).toBe('soldOut')
  })

  it('clamps a negative stored quantity to zero rather than showing it to a customer', () => {
    const negative = resolve({ id: 65, inventoryQuantity: -3 })

    expect(negative?.inventoryQuantity).toBe(0)
    expect(negative?.availability).toBe('soldOut')
  })

  it('puts the low-stock boundary at the threshold itself, not below it', () => {
    expect(resolve({ id: 66, inventoryQuantity: 5 })?.availability).toBe('lowStock')
    expect(resolve({ id: 67, inventoryQuantity: 6 })?.availability).toBe('available')
    expect(resolve({ id: 68, inventoryQuantity: 1 })?.availability).toBe('lowStock')
    expect(resolve({ id: 69, inventoryQuantity: 0 })?.availability).toBe('soldOut')
  })

  it('clamps a threshold below one up to one, so the last item is always announced', () => {
    expect(resolve({ id: 70, inventoryQuantity: 1 }, 0)?.availability).toBe('lowStock')
    expect(resolve({ id: 71, inventoryQuantity: 1 }, -20)?.availability).toBe('lowStock')
    expect(resolve({ id: 72, inventoryQuantity: 2 }, 0)?.availability).toBe('available')
  })

  it('normalises an absent image and a blank sku to null rather than to a falsy string', () => {
    const bare = resolve({ id: 73, sku: '   ' })

    expect(bare?.image).toBeNull()
    expect(bare?.sku).toBeNull()
  })

  it('returns null for a row that is not purchasable, so a caller cannot render half of one', () => {
    expect(resolve({ id: 74, priceMinor: null })).toBeNull()
    expect(resolve({ color: null, id: 75 })).toBeNull()
    expect(resolve({ id: 76, size: '  ' })).toBeNull()
  })

  it('drops the row rather than crashing when the locale cannot format', () => {
    /* One malformed site-settings row must not take out every product page. */
    expect(resolveVariant(row({ id: 77 }), USD, 'not a locale', THRESHOLD)).toBeNull()
  })
})

describe('priceRangeForColor', () => {
  it('shows one price when the colour is all one price', () => {
    expect(priceRangeForColor(CATALOGUE, 'Black', USD, LOCALE)).toBe('$95.00')
  })

  it('says "From" only when the range within the colour is real, compared on minor units', () => {
    const mixed = [
      row({ color: 'Bone', id: 80, priceMinor: 9500, size: 'S' }),
      row({ color: 'Bone', id: 81, priceMinor: 12000, size: 'L' }),
    ]

    expect(priceRangeForColor(mixed, 'Bone', USD, LOCALE)).toBe('From $95.00')
  })

  it('spans the whole product when no colour is in effect', () => {
    /* null here means "no colour chosen yet", and the honest answer is the product's whole range. */
    expect(priceRangeForColor(CATALOGUE, null, USD, LOCALE)).toBe('From $95.00')
  })

  it('quotes the selected colour rather than the cheapest one in the product', () => {
    /* Black at 9500 must not advertise its price under a Cream swatch. */
    expect(priceRangeForColor(CATALOGUE, 'Cream', USD, LOCALE)).toBe('$120.00')
  })

  it('ignores withdrawn rows, so a retired cheaper variant cannot set the shelf price', () => {
    const withRetired = [
      ...CATALOGUE,
      row({ active: false, color: 'Black', id: 82, priceMinor: 100, size: 'XS', sizeSortOrder: 5 }),
    ]

    expect(priceRangeForColor(withRetired, 'Black', USD, LOCALE)).toBe('$95.00')
  })

  it('counts sold-out rows, because a sold-out size is still part of the price range', () => {
    /* Cream / L is sold out; excluding it would change the quoted price as stock moved. */
    const creamOnly = CATALOGUE.filter((variant) => variant.color === 'Cream')

    expect(priceRangeForColor(creamOnly, 'Cream', USD, LOCALE)).toBe('$120.00')
  })

  it('returns null rather than a guess when there is no purchasable row to quote', () => {
    expect(priceRangeForColor(CATALOGUE, 'Chartreuse', USD, LOCALE)).toBeNull()
    expect(priceRangeForColor([], null, USD, LOCALE)).toBeNull()
    expect(priceRangeForColor([row({ active: false, id: 83 })], null, USD, LOCALE)).toBeNull()
  })
})

describe('compareAtForColor', () => {
  const sale = (variant: Partial<SelectableVariant> & { id: number }) =>
    row({ compareAtPriceMinor: 12000, priceMinor: 9500, ...variant })

  it('shows the former price when every real saving in the colour quotes the same one', () => {
    const variants = [sale({ id: 100, size: 'S' }), sale({ id: 101, size: 'M' })]

    expect(compareAtForColor(variants, 'Black', USD, LOCALE)).toBe('$120.00')
  })

  it('returns null when only some sizes are reduced — a saving no other size has is not claimed', () => {
    const variants = [sale({ id: 102, size: 'S' }), row({ id: 103, size: 'M' })]

    expect(compareAtForColor(variants, 'Black', USD, LOCALE)).toBeNull()
  })

  it('returns null when the only reduced size is sold out (Phase 35 sweep 1)', () => {
    const variants = [
      sale({ id: 112, inventoryQuantity: 0, size: 'S' }),
      row({ id: 113, size: 'M' }),
      row({ id: 114, size: 'L' }),
    ]

    expect(compareAtForColor(variants, 'Black', USD, LOCALE)).toBeNull()
  })

  it('applies resolveVariant’s rule: an equal or lower compare-at is not a saving', () => {
    expect(
      compareAtForColor([row({ compareAtPriceMinor: 9500, id: 104 })], 'Black', USD, LOCALE),
    ).toBeNull()
    expect(
      compareAtForColor([row({ compareAtPriceMinor: 8000, id: 105 })], 'Black', USD, LOCALE),
    ).toBeNull()
    expect(compareAtForColor([row({ id: 106 })], 'Black', USD, LOCALE)).toBeNull()
  })

  it('returns null when the colour quotes more than one former price, rather than choosing one', () => {
    const variants = [
      sale({ id: 107, size: 'S' }),
      sale({ compareAtPriceMinor: 14000, id: 108, size: 'M' }),
    ]

    expect(compareAtForColor(variants, 'Black', USD, LOCALE)).toBeNull()
  })

  it('reads only the selected colour, and ignores withdrawn rows', () => {
    const variants = [
      sale({ color: 'Bone', id: 109 }),
      sale({ active: false, id: 110 }),
      row({ id: 111 }),
    ]

    expect(compareAtForColor(variants, 'Black', USD, LOCALE)).toBeNull()
    expect(compareAtForColor(variants, 'Bone', USD, LOCALE)).toBe('$120.00')
  })

  it('returns null rather than throwing when the locale cannot format', () => {
    expect(compareAtForColor([sale({ id: 112 })], 'Black', USD, 'not a locale')).toBeNull()
  })
})

describe('inventoryMessage', () => {
  const resolved = (quantity: number) =>
    resolveVariant(row({ id: 90, inventoryQuantity: quantity }), USD, LOCALE, THRESHOLD)

  it('says nothing at all when there is nothing worth saying', () => {
    /* Announcing "in stock" on every product page in the catalogue is noise, not information. */
    expect(inventoryMessage(resolved(50))).toBeNull()
    expect(inventoryMessage(null)).toBeNull()
  })

  it('names the size when the combination is sold out, because the product is not', () => {
    expect(inventoryMessage(resolved(0))).toBe('Sold out in this size')
  })

  it('gives the real remaining count rather than a vague "only a few left"', () => {
    expect(inventoryMessage(resolved(4))).toBe('Only 4 left')
    expect(inventoryMessage(resolved(5))).toBe('Only 5 left')
  })

  it('says "Last one" rather than "Only 1 left"', () => {
    expect(inventoryMessage(resolved(1))).toBe('Last one')
  })
})
