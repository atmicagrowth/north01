/**
 * **Plan §27.1a — "Search mapping": the seam between a Postgres row and a search query.**
 *
 * Four pure modules meet here and they have to agree, because nothing at runtime tells you when they
 * stop agreeing — a facet that names an attribute the record does not carry simply returns nothing,
 * and a grid that quietly returns nothing looks exactly like a shop with nothing in it.
 *
 * - `record.ts` decides **what goes into the index** and what the facets are called there.
 * - `query.ts` decides **what a URL means** and canonicalises it into one spelling.
 * - `search.ts` decides **what a search term is** before a request exists.
 * - `suggest.ts` decides **what the panel offers**, and in what keyboard order.
 *
 * ### The failure modes this file is aimed at
 *
 * 1. **A draft, a scheduled drop or a withdrawn product reaching the index.** The index is a derived
 *    copy; a row in it that Postgres will not return makes the printed count a lie — "24 products"
 *    over a page of 19 — so the exclusion rules have to be identical to `publishedProductWhere`'s.
 * 2. **The record and the query drifting apart.** `indexSearchParams` emits `colorFamilies:black`;
 *    `buildProductRecord` writes `colorFamilies`. Those two strings are related only by intent, so
 *    they are asserted against each other here rather than trusted.
 * 3. **`null` (UNKNOWN) confused with `0` (NONE).** A missing price is not a free product, an unknown
 *    publication date is not the epoch, and a `priceMin` of zero is a filter the customer set — not
 *    an absent one.
 * 4. **A term that is not a search being sent as one.** Punctuation, a mangled percent-escape, a
 *    pasted paragraph — each is decided before the network, so each is a fixture.
 * 5. **A canonical URL that is not canonical.** `?color=` is not the same URL as no `color` key, and
 *    a page number no query ever ran must not survive in the address bar.
 * 6. **A control that looks functional but does nothing** — the dead filter chip `query.ts`'s own
 *    docblock records, where the label was normalised and the remove-link was not.
 *
 * Money is asserted in integer minor units throughout: nothing in this seam divides by 100.
 */

import { describe, expect, it } from 'vitest'

import { COLOR_FAMILY_LABELS } from '@/lib/catalog/colors'
import {
  CATALOG_MAX_PAGE,
  EMPTY_QUERY,
  canonicaliseParams,
  catalogHref,
  type CatalogParams,
  type CatalogQuery,
  type CatalogVocabulary,
} from '@/lib/catalog/query'
import {
  CATALOG_INDEX_SETTINGS,
  buildProductRecord,
  buildSearchTerms,
  indexSearchParams,
  withAncestors,
  type IndexableProduct,
  type IndexableVariant,
  type ProductIndexRecord,
} from '@/lib/catalog/record'
import type { ProductCard } from '@/lib/catalog/resolve'
import {
  SEARCH_MIN_TERM_LENGTH,
  SEARCH_TERM_MAX_BYTES,
  normaliseSearchTerm,
  truncateToBytes,
} from '@/lib/catalog/search'
import {
  buildSuggestions,
  suggestionGroups,
  suggestionOptions,
  type SuggestionPayload,
} from '@/lib/catalog/suggest'

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

const DERIVED = {
  compareAtFromMinor: 32000,
  inventoryTotal: 12,
  priceFromMinor: 24000,
  priceToMinor: 28000,
}

const PRODUCT: IndexableProduct = {
  categoryNames: ['Hoodies', 'Tops', 'Clothing'],
  categorySlugs: ['hoodies', 'tops', 'clothing'],
  collectionSlugs: ['essentials'],
  collectionTitles: ['Essentials'],
  derived: DERIVED,
  featured: true,
  fit: 'Relaxed',
  gender: 'unisex',
  id: 7,
  isBestSeller: true,
  isLimitedEdition: false,
  isNew: true,
  materials: ['Cotton', 'Cotton', '   '],
  name: 'Heavyweight Hoodie',
  publishedAt: '2026-01-01T00:00:00.000Z',
  shortDescription: '  500 gsm loopback.  ',
  slug: 'heavyweight-hoodie',
  sortOrder: 3,
  status: 'published',
  tags: ['heavyweight', 'heavyweight'],
}

const VARIANTS: IndexableVariant[] = [
  { active: true, color: 'Graphite', colorFamily: 'charcoal', inventoryQuantity: 4, size: 'M' },
  { active: true, color: 'Bone', colorFamily: 'bone', inventoryQuantity: 8, size: 'L' },
  // Withdrawn from sale: it must contribute neither a facet value nor a searchable label.
  { active: false, color: 'Rust', colorFamily: 'rust', inventoryQuantity: 6, size: 'XL' },
]

const NOW = new Date('2026-06-01T00:00:00.000Z')

const build = (
  overrides: Partial<IndexableProduct> = {},
  variants: IndexableVariant[] = VARIANTS,
  now: Date = NOW,
): null | ProductIndexRecord => buildProductRecord({ ...PRODUCT, ...overrides }, variants, now)

/** The same thing, for the cases where a `null` would be the bug rather than the assertion. */
const mustBuild = (
  overrides: Partial<IndexableProduct> = {},
  variants: IndexableVariant[] = VARIANTS,
  now: Date = NOW,
): ProductIndexRecord => {
  const record = build(overrides, variants, now)

  if (record === null) {
    throw new Error('fixture was expected to be indexable')
  }

  return record
}

const VOCABULARY: CatalogVocabulary = {
  categories: [
    { label: 'Clothing', parent: null, value: 'clothing' },
    { label: 'Tops', parent: 'clothing', value: 'tops' },
    { label: 'Hoodies', parent: 'tops', value: 'hoodies' },
    { label: 'Shorts', parent: 'clothing', value: 'shorts' },
    { label: 'Fisherman Shorts', parent: 'shorts', value: 'fisherman-shorts' },
  ],
  collections: [{ label: 'Essentials', value: 'essentials' }],
  colors: [
    { label: 'Black', value: 'black' },
    { label: 'Bone', value: 'bone' },
  ],
  priceCeilingMinor: 40000,
  priceFloorMinor: 9500,
  sizes: [
    { label: 'S', value: 'S' },
    { label: 'M', value: 'M' },
    { label: 'L', value: 'L' },
  ],
}

const PARAMS: CatalogParams = {
  availability: null,
  q: null,
  category: [],
  collection: [],
  color: [],
  page: 1,
  priceMax: null,
  priceMin: null,
  size: [],
  sort: 'featured',
}

const params = (overrides: Partial<CatalogParams> = {}): CatalogParams => ({
  ...PARAMS,
  ...overrides,
})

const FULL_QUERY: CatalogQuery = {
  ...EMPTY_QUERY,
  availability: 'in-stock',
  q: 'hoodie',
  categories: ['hoodies', 'tops'],
  collections: ['essentials'],
  colors: ['black', 'bone'],
  page: 2,
  priceMaxMinor: 30000,
  priceMinMinor: 10000,
  requestedCategories: ['hoodies'],
  sizes: ['M'],
  sort: 'price-asc',
}

/** `filterOnly(categorySlugs)` -> `categorySlugs`, and `unordered(fit)` -> `fit`. */
const unwrap = (entry: string): string =>
  /^(?:filterOnly|unordered|searchable)\((.+)\)$/u.exec(entry)?.[1] ?? entry

const FACETABLE = CATALOG_INDEX_SETTINGS.attributesForFaceting.map(unwrap)

/* -------------------------------------------------------------------------------------------------
 * record.ts — what belongs in the index
 * ---------------------------------------------------------------------------------------------- */

describe('buildProductRecord decides what "belongs in a listing"', () => {
  it('indexes the ordinary published product, so the exclusions below mean something', () => {
    expect(build()).not.toBeNull()
  })

  it('refuses anything but `published`, because a row the API hides must not be counted', () => {
    // Each of these reads as "not in the shop" through payload.find; the index must agree, or
    // nbHits counts products Postgres will then refuse to return.
    expect(build({ status: 'draft' })).toBeNull()
    expect(build({ status: 'archived' })).toBeNull()
    expect(build({ status: null })).toBeNull()
    expect(build({ status: undefined })).toBeNull()
    expect(build({ status: 'PUBLISHED' })).toBeNull()
  })

  it('refuses a product with no slug or no name, because neither can be linked or read', () => {
    expect(build({ slug: null })).toBeNull()
    expect(build({ slug: '   ' })).toBeNull()
    expect(build({ name: null })).toBeNull()
    expect(build({ name: '  ' })).toBeNull()
  })

  it('refuses a product with no derived price, which is "withdrawn from sale", not "free"', () => {
    expect(build({ derived: null })).toBeNull()
    expect(build({ derived: undefined })).toBeNull()
    expect(build({ derived: { ...DERIVED, priceFromMinor: null } })).toBeNull()
    expect(build({ derived: { ...DERIVED, priceToMinor: null } })).toBeNull()
  })

  it('indexes a price of zero, because 0 is a real amount and null is the absent one', () => {
    // The distinction this project keeps everywhere: null means UNKNOWN, 0 means NONE. A zero-priced
    // product is listable; a null-priced one has no active variant at all.
    const record = mustBuild({ derived: { ...DERIVED, priceFromMinor: 0, priceToMinor: 0 } })

    expect(record.priceFromMinor).toBe(0)
    expect(record.priceToMinor).toBe(0)
  })

  it('refuses a scheduled drop, because published-in-the-future is not published yet', () => {
    expect(build({ publishedAt: '2026-06-02T00:00:00.000Z' })).toBeNull()
  })

  it('indexes a product published at exactly this instant — the boundary is strictly "after"', () => {
    // `> now` rather than `>=`: a drop whose moment has arrived is live, not pending.
    expect(build({ publishedAt: NOW.toISOString() })).not.toBeNull()
  })

  it('sorts an unknown publication date last rather than pretending it is the epoch', () => {
    // 0 is chosen because "Newest" ranks descending, so an unknown date lands at the bottom — the
    // honest place for a row written straight to the database.
    expect(mustBuild({ publishedAt: null }).publishedAtMs).toBe(0)
    expect(mustBuild({ publishedAt: 'not a date' }).publishedAtMs).toBe(0)
    expect(mustBuild({ publishedAt: '' }).publishedAtMs).toBe(0)
    expect(mustBuild().publishedAtMs).toBe(Date.parse('2026-01-01T00:00:00.000Z'))
  })

  it('defaults `now` to the present, so a caller omitting it cannot list a future drop', () => {
    expect(
      buildProductRecord({ ...PRODUCT, publishedAt: '2999-01-01T00:00:00.000Z' }, VARIANTS),
    ).toBeNull()
  })
})

describe('the facet fields the query side filters on', () => {
  it('takes colour and size from active variants only, never from a withdrawn one', () => {
    const record = mustBuild()

    // 'rust' / 'XL' belong to the inactive variant: offering them would return a product that
    // cannot be bought in the thing that was filtered for.
    expect(record.colorFamilies).toEqual(['charcoal', 'bone'])
    expect(record.sizes).toEqual(['M', 'L'])
  })

  it('treats a missing or null `active` as active, because only `false` is a withdrawal', () => {
    const record = mustBuild({}, [
      { color: 'Oat', colorFamily: 'bone', size: 'S' },
      { active: null, color: 'Ink', colorFamily: 'black', size: 'M' },
    ])

    expect(record.colorFamilies).toEqual(['bone', 'black'])
    expect(record.sizes).toEqual(['S', 'M'])
  })

  it('de-duplicates and trims every list, so a facet cannot offer one value twice', () => {
    const record = mustBuild(
      { categorySlugs: [' hoodies ', 'hoodies', ''], materials: ['Cotton', 'Cotton', '   '] },
      [
        { active: true, colorFamily: 'black', size: 'M' },
        { active: true, colorFamily: 'black', size: ' M ' },
      ],
    )

    expect(record.categorySlugs).toEqual(['hoodies'])
    expect(record.materials).toEqual(['Cotton'])
    expect(record.colorFamilies).toEqual(['black'])
    expect(record.sizes).toEqual(['M'])
    expect(record.tags).toEqual(['heavyweight'])
  })

  it('leaves the facet arrays empty rather than undefined when the product has none', () => {
    // An absent attribute and an empty one behave differently in a facet filter; empty is the shape
    // the query side can reason about.
    const record = mustBuild(
      { categorySlugs: undefined, collectionSlugs: undefined, materials: null, tags: null },
      [],
    )

    expect(record.categorySlugs).toEqual([])
    expect(record.collectionSlugs).toEqual([])
    expect(record.colorFamilies).toEqual([])
    expect(record.sizes).toEqual([])
    expect(record.materials).toEqual([])
    expect(record.tags).toEqual([])
  })

  it('derives `inStock` from the stock count, and treats an unknown count as none in stock', () => {
    expect(mustBuild().inStock).toBe(true)
    expect(mustBuild({ derived: { ...DERIVED, inventoryTotal: 0 } }).inStock).toBe(false)
    expect(mustBuild({ derived: { ...DERIVED, inventoryTotal: 1 } }).inStock).toBe(true)

    // A null count is unknown; the index resolves it to 0 so an unknown never reads as purchasable.
    const unknownStock = mustBuild({ derived: { ...DERIVED, inventoryTotal: null } })

    expect(unknownStock.inventoryTotal).toBe(0)
    expect(unknownStock.inStock).toBe(false)
  })

  it('keeps money in integer minor units — nothing in this seam divides by 100', () => {
    const record = mustBuild()

    expect(record.priceFromMinor).toBe(24000)
    expect(record.priceToMinor).toBe(28000)
    expect(record.compareAtFromMinor).toBe(32000)
    expect(Number.isInteger(record.priceFromMinor)).toBe(true)
    expect(Number.isInteger(record.priceToMinor)).toBe(true)
  })

  it('records an absent former price as null, so no record claims a saving it does not have', () => {
    const record = mustBuild({ derived: { ...DERIVED, compareAtFromMinor: null } })

    expect(record.compareAtFromMinor).toBeNull()
  })

  it('gives Algolia a string objectID, because a numeric id is not one', () => {
    const record = mustBuild({ id: 7 })

    expect(record.objectID).toBe('7')
    expect(typeof record.objectID).toBe('string')
  })

  it('collapses a blank text field to null rather than indexing an empty string', () => {
    const record = mustBuild({ fit: '   ', gender: '', shortDescription: '  ' })

    expect(record.fit).toBeNull()
    expect(record.gender).toBeNull()
    expect(record.shortDescription).toBeNull()
    expect(mustBuild().shortDescription).toBe('500 gsm loopback.')
    expect(mustBuild().fit).toBe('Relaxed')
  })

  it('treats every merchandising flag as strictly boolean, so null never ranks as true', () => {
    const off = mustBuild({
      featured: null,
      isBestSeller: null,
      isLimitedEdition: null,
      isNew: null,
    })

    expect(off.featured).toBe(false)
    expect(off.isBestSeller).toBe(false)
    expect(off.isLimitedEdition).toBe(false)
    expect(off.isNew).toBe(false)
    expect(mustBuild().featured).toBe(true)
    expect(mustBuild().isBestSeller).toBe(true)
  })

  it('keeps an explicit sortOrder of 0 and only defaults a missing one', () => {
    // 0 is a legitimate first position, so `?? 0` must not be reachable by a real value.
    expect(mustBuild({ sortOrder: 0 }).sortOrder).toBe(0)
    expect(mustBuild({ sortOrder: null }).sortOrder).toBe(0)
    expect(mustBuild({ sortOrder: -5 }).sortOrder).toBe(-5)
    expect(mustBuild().sortOrder).toBe(3)
  })
})

describe('buildSearchTerms collects the labels a customer would actually type', () => {
  it('gathers category names, collection titles, colours, colour labels and sizes, in order', () => {
    expect(buildSearchTerms(PRODUCT, VARIANTS)).toEqual([
      'Hoodies',
      'Tops',
      'Clothing',
      'Essentials',
      'Graphite',
      'Bone',
      'Charcoal',
      'M',
      'L',
    ])
  })

  it('omits an inactive variant, so a search cannot match on something withdrawn from sale', () => {
    const terms = buildSearchTerms(PRODUCT, VARIANTS)

    expect(terms).not.toContain('Rust')
    expect(terms).not.toContain('XL')
  })

  it('contributes the colour family LABEL, not its stored enum value', () => {
    // 'bone' is what the facet filters on; "Bone" is what somebody types into the box.
    expect(COLOR_FAMILY_LABELS.bone).toBe('Bone')
    expect(buildSearchTerms({}, [{ colorFamily: 'bone' }])).toEqual(['Bone'])
  })

  it('falls back to the raw family when the CMS grows a value the label map has not seen', () => {
    // A new select option is a data change, not a deploy; degrading to the raw value keeps the term
    // searchable instead of dropping it.
    expect(buildSearchTerms({}, [{ colorFamily: 'puce' }])).toEqual(['puce'])
  })

  it('returns nothing at all for a product with no names and no variants', () => {
    expect(buildSearchTerms({}, [])).toEqual([])
    expect(buildSearchTerms({ categoryNames: [], collectionTitles: [] }, [])).toEqual([])
  })
})

describe('withAncestors is what makes /shop/clothing answerable in one facet filter', () => {
  const parents = new Map<string, null | string>([
    ['hoodies', 'tops'],
    ['tops', 'clothing'],
    ['clothing', null],
  ])

  it('walks a slug up to its root', () => {
    expect(withAncestors(['hoodies'], parents)).toEqual(['hoodies', 'tops', 'clothing'])
  })

  it('emits each ancestor once when two slugs share one', () => {
    expect(withAncestors(['hoodies', 'tops'], parents)).toEqual(['hoodies', 'tops', 'clothing'])
  })

  it('returns the slug alone when the map knows nothing about it', () => {
    expect(withAncestors(['orphan'], parents)).toEqual(['orphan'])
    expect(withAncestors([], parents)).toEqual([])
  })

  it('terminates on a two-save A -> B -> A cycle instead of hanging the indexer', () => {
    // Categories.ts deliberately allows this shape through two separate saves; the guard is here.
    const cycle = new Map<string, null | string>([
      ['a', 'b'],
      ['b', 'a'],
    ])

    expect(withAncestors(['a'], cycle)).toEqual(['a', 'b'])
    expect(withAncestors(['a', 'b'], cycle)).toEqual(['a', 'b'])
  })

  it('terminates on a self-parenting category', () => {
    expect(withAncestors(['a'], new Map([['a', 'a']]))).toEqual(['a'])
  })
})

describe('the record and the index settings cannot drift apart', () => {
  it('facets only attributes the record actually carries', () => {
    // An attribute missing from the record is a filter that silently matches nothing; an attribute
    // missing from `attributesForFaceting` is a 400 from the engine. Neither shows up in a diff.
    const keys = Object.keys(mustBuild())

    for (const attribute of FACETABLE) {
      expect(keys).toContain(attribute)
    }
  })

  it('searches only attributes the record actually carries', () => {
    const keys = Object.keys(mustBuild())
    const searchable = CATALOG_INDEX_SETTINGS.searchableAttributes
      .flatMap((entry) => entry.split(','))
      .map(unwrap)

    for (const attribute of searchable) {
      expect(keys).toContain(attribute)
    }
  })

  it('filters numerically only on attributes that really are numbers on the record', () => {
    const record = mustBuild()

    for (const attribute of CATALOG_INDEX_SETTINGS.numericAttributesForFiltering) {
      expect(typeof record[attribute as 'priceFromMinor']).toBe('number')
    }
  })

  it('withholds the stock level from every search key, while still indexing it', () => {
    // `attributesToRetrieve` is only a default and a request can override it; unretrievable cannot
    // be overridden, which is why stock is listed there and nowhere else.
    expect(CATALOG_INDEX_SETTINGS.unretrievableAttributes).toContain('inventoryTotal')
    expect(CATALOG_INDEX_SETTINGS.attributesToRetrieve).toEqual(['objectID'])
    expect(FACETABLE).not.toContain('inventoryTotal')
    expect(mustBuild().inventoryTotal).toBe(12)
  })

  it('highlights nothing, so no customer-facing index text rides along with an objectID', () => {
    expect(CATALOG_INDEX_SETTINGS.attributesToHighlight).toEqual([])
  })
})

/* -------------------------------------------------------------------------------------------------
 * record.ts — query translation
 * ---------------------------------------------------------------------------------------------- */

describe('indexSearchParams translates a CatalogQuery into an Algolia search', () => {
  it('sends no filter at all for a bare browse', () => {
    const sent = indexSearchParams(EMPTY_QUERY, 24)

    expect(sent.facetFilters).toEqual([])
    expect(sent.numericFilters).toEqual([])
    expect(sent.query).toBe('')
    expect(sent.hitsPerPage).toBe(24)
  })

  it('nests ticked values as OR inside AND, because flattening would empty the grid', () => {
    // [['a','b'],['c']] reads "(a or b) and c". Flattened it reads "a and b and c", which no single
    // product satisfies — two ticked colours would permanently show nothing.
    expect(indexSearchParams(FULL_QUERY, 24).facetFilters).toEqual([
      ['categorySlugs:hoodies', 'categorySlugs:tops'],
      ['collectionSlugs:essentials'],
      ['colorFamilies:black', 'colorFamilies:bone'],
      ['sizes:M'],
      ['inStock:true'],
    ])
  })

  it('names only attributes that are both faceted in the settings and present on a record', () => {
    const keys = Object.keys(mustBuild())
    const attributes = indexSearchParams(FULL_QUERY, 24)
      .facetFilters.flat()
      .map((clause) => clause.split(':')[0])

    expect(attributes.length).toBeGreaterThan(0)

    for (const attribute of attributes) {
      expect(FACETABLE).toContain(attribute)
      expect(keys).toContain(attribute)
    }
  })

  it('converts the one-based page a customer sees to the zero-based one the engine wants', () => {
    expect(indexSearchParams({ ...EMPTY_QUERY, page: 1 }, 24).page).toBe(0)
    expect(indexSearchParams({ ...EMPTY_QUERY, page: 3 }, 24).page).toBe(2)
    expect(indexSearchParams(FULL_QUERY, 24).page).toBe(1)
  })

  it('never asks for a negative page, however the query was built', () => {
    expect(indexSearchParams({ ...EMPTY_QUERY, page: 0 }, 24).page).toBe(0)
    expect(indexSearchParams({ ...EMPTY_QUERY, page: -12 }, 24).page).toBe(0)
  })

  it('filters on the LOWEST price, so a $95-$240 product still answers "under $150"', () => {
    expect(indexSearchParams(FULL_QUERY, 24).numericFilters).toEqual([
      'priceFromMinor>=10000',
      'priceFromMinor<=30000',
    ])
  })

  it('emits a price floor of zero, because 0 is a filter the customer set and null is none', () => {
    // The classic null/0 confusion: `if (min)` would drop this filter silently.
    expect(indexSearchParams({ ...EMPTY_QUERY, priceMinMinor: 0 }, 24).numericFilters).toEqual([
      'priceFromMinor>=0',
    ])
    expect(indexSearchParams({ ...EMPTY_QUERY, priceMaxMinor: 0 }, 24).numericFilters).toEqual([
      'priceFromMinor<=0',
    ])
  })

  it('asks for in-stock only when the customer asked, and never for the sold-out side', () => {
    expect(indexSearchParams({ ...EMPTY_QUERY, availability: null }, 24).facetFilters).toEqual([])
    expect(
      indexSearchParams({ ...EMPTY_QUERY, availability: 'in-stock' }, 24).facetFilters,
    ).toEqual([['inStock:true']])
  })

  it('counts a query as customer behaviour only when a customer typed one', () => {
    // A faceted /shop request sends query:'' — recording that as a search made the empty string the
    // shop's most popular term by eighteen times.
    expect(indexSearchParams(EMPTY_QUERY, 24).analytics).toBe(false)
    expect(indexSearchParams({ ...EMPTY_QUERY, q: 'hoodie' }, 24).analytics).toBe(true)
    expect(indexSearchParams({ ...EMPTY_QUERY, q: 'hoodie' }, 24).query).toBe('hoodie')
  })
})

/* -------------------------------------------------------------------------------------------------
 * search.ts — what a search term is
 * ---------------------------------------------------------------------------------------------- */

describe('normaliseSearchTerm decides, before any request, what counts as a search', () => {
  it('treats anything that is not a string as no search at all', () => {
    expect(normaliseSearchTerm(null)).toEqual({ status: 'empty', term: null, truncated: false })
    expect(normaliseSearchTerm(undefined)).toEqual({
      status: 'empty',
      term: null,
      truncated: false,
    })
    expect(normaliseSearchTerm(42 as unknown as string).term).toBeNull()
  })

  it('treats empty and whitespace-only input as no search', () => {
    expect(normaliseSearchTerm('').status).toBe('empty')
    expect(normaliseSearchTerm('     ').term).toBeNull()
    expect(normaliseSearchTerm(' ').term).toBeNull()
  })

  it('refuses a term carrying U+FFFD, because the decoder is saying it could not read it', () => {
    // A mangled percent-escape once rendered "9 products" for a term nobody typed.
    expect(normaliseSearchTerm('�%A')).toEqual({
      status: 'empty',
      term: null,
      truncated: false,
    })
    expect(normaliseSearchTerm('hoodie�').term).toBeNull()
  })

  it('refuses punctuation alone, which matches nothing and is not worth a request', () => {
    expect(normaliseSearchTerm('!!!').term).toBeNull()
    expect(normaliseSearchTerm('%').term).toBeNull()
    expect(normaliseSearchTerm('...').term).toBeNull()
    expect(normaliseSearchTerm('&&&').status).toBe('empty')
  })

  it('refuses a lone emoji, which is a symbol rather than a letter or a number', () => {
    expect(normaliseSearchTerm('\u{1F455}').term).toBeNull()
    // ...but keeps one attached to real text, because that text is searchable.
    expect(normaliseSearchTerm('hoodie \u{1F455}').term).toBe('hoodie \u{1F455}')
  })

  it('accepts digits as searchable, because a size or a gsm figure is a real query', () => {
    expect(normaliseSearchTerm('500').term).toBe('500')
    expect(normaliseSearchTerm('500').status).toBe('ok')
  })

  it('preserves the capitalisation that was typed, because the term is echoed back', () => {
    // Matching is case-insensitive at the engine, so folding here would buy nothing and would show
    // the customer a term they did not type.
    expect(normaliseSearchTerm('Merino Wool').term).toBe('Merino Wool')
    expect(normaliseSearchTerm('HOODIE').term).toBe('HOODIE')
  })

  it('collapses runs of whitespace and trims the ends', () => {
    expect(normaliseSearchTerm('   red    hoodie   ').term).toBe('red hoodie')
  })

  it('drops wrapping quotes and a leading dash, which are engine operators rather than text', () => {
    expect(normaliseSearchTerm('"merino"').term).toBe('merino')
    expect(normaliseSearchTerm("'merino'").term).toBe('merino')
    expect(normaliseSearchTerm('-hoodie').term).toBe('hoodie')
    // A dash inside or at the end is ordinary text — only the leading one is the negation operator.
    expect(normaliseSearchTerm('half-zip').term).toBe('half-zip')
    expect(normaliseSearchTerm('-hoodie-').term).toBe('hoodie-')
  })

  it('strips the invisible characters that make two identical-looking terms two searches', () => {
    expect(normaliseSearchTerm('ho​odie').term).toBe('hoodie')
    expect(normaliseSearchTerm('﻿hoodie').term).toBe('hoodie')
    expect(normaliseSearchTerm('‮hoodie').term).toBe('hoodie')
  })

  it('normalises to NFC, so the two spellings of cafe-acute are one search', () => {
    const decomposed = normaliseSearchTerm('café')

    expect(decomposed.term).toBe('café')
    expect(decomposed.term).toBe(normaliseSearchTerm('café').term)
    expect(decomposed.term?.length).toBe(4)
  })

  it('holds the typeahead below two characters, counted in code points not UTF-16 units', () => {
    expect(SEARCH_MIN_TERM_LENGTH).toBe(2)
    expect(normaliseSearchTerm('h').status).toBe('tooShort')
    expect(normaliseSearchTerm('ho').status).toBe('ok')
    // U+1D400 is one letter to the person who typed it and two UTF-16 units to `.length`, which
    // would call it long enough and fire a request for a single character.
    expect('\u{1D400}'.length).toBe(2)
    expect(normaliseSearchTerm('\u{1D400}').status).toBe('tooShort')
    expect(normaliseSearchTerm('\u{1D400}').term).toBe('\u{1D400}')
  })

  it('clamps a pasted paragraph to the byte budget and says that it did', () => {
    const long = normaliseSearchTerm('a'.repeat(300))

    expect(long.term?.length).toBe(SEARCH_TERM_MAX_BYTES)
    expect(long.truncated).toBe(true)
    expect(long.status).toBe('ok')
  })

  it('measures the clamp in bytes, not characters, which is the unit the engine rejects on', () => {
    // 200 e-acutes are 200 characters and 400 bytes; a character cap would let a 400-byte query
    // through and the engine would answer 400.
    const accented = normaliseSearchTerm('é'.repeat(200))

    expect(accented.term?.length).toBe(128)
    expect(new TextEncoder().encode(accented.term ?? '').length).toBe(SEARCH_TERM_MAX_BYTES)
  })

  it('does not clamp at the boundary, so a term of exactly the budget survives whole', () => {
    const exact = normaliseSearchTerm('a'.repeat(SEARCH_TERM_MAX_BYTES))

    expect(exact.truncated).toBe(false)
    expect(exact.term?.length).toBe(SEARCH_TERM_MAX_BYTES)
    expect(normaliseSearchTerm('a'.repeat(SEARCH_TERM_MAX_BYTES + 1)).truncated).toBe(true)
  })

  it('reports the truncation even when nothing searchable survived it', () => {
    // 128 shirt emoji are 512 bytes: the clamp fires, then the punctuation rule empties the term.
    // `truncated` must still be true, or the "that search was very long" notice never fires.
    const emoji = normaliseSearchTerm('\u{1F455}'.repeat(128))

    expect(emoji.term).toBeNull()
    expect(emoji.truncated).toBe(true)
  })

  it('leaves the term unclamped when asked, which is what keeps that notice reachable', () => {
    // canonicaliseParams passes clamp:false so the redirect cannot rewrite the evidence away.
    const unclamped = normaliseSearchTerm('a'.repeat(300), { clamp: false })

    expect(unclamped.term?.length).toBe(300)
    expect(unclamped.truncated).toBe(false)
  })
})

describe('truncateToBytes never emits half a character', () => {
  it('returns the input untouched when it already fits', () => {
    expect(truncateToBytes('hoodie', 256)).toBe('hoodie')
    expect(truncateToBytes('', 0)).toBe('')
  })

  it('stops before a code point it cannot fit, rather than splitting a surrogate pair', () => {
    // A lone surrogate in a query string is unencodable; this is the one place that is prevented.
    expect(truncateToBytes('\u{1F455}\u{1F455}', 4)).toBe('\u{1F455}')
    expect(truncateToBytes('\u{1F455}', 3)).toBe('')
    expect(truncateToBytes('a\u{1F455}', 4)).toBe('a')
  })

  it('degrades to an empty string on a nonsensical budget instead of throwing', () => {
    expect(truncateToBytes('hoodie', 0)).toBe('')
    expect(truncateToBytes('hoodie', -1)).toBe('')
  })
})

/* -------------------------------------------------------------------------------------------------
 * query.ts — one spelling per query
 * ---------------------------------------------------------------------------------------------- */

describe('canonicaliseParams rewrites a URL to the one spelling this shop owns', () => {
  it('maps a value onto the stored spelling, which is what kills the dead filter chip', () => {
    // The measured defect: the chip's label came from the normalised value and its remove-link from
    // the raw token, so removing 'm' from ['m'] removed nothing and the href was the current page.
    expect(canonicaliseParams(params({ size: ['m'] }), VOCABULARY).size).toEqual(['M'])
    expect(canonicaliseParams(params({ color: ['BLACK'] }), VOCABULARY).color).toEqual(['black'])
    expect(canonicaliseParams(params({ size: [' m ', 'M'] }), VOCABULARY).size).toEqual(['M'])
  })

  it('orders known values by the vocabulary, so two URLs asking the same thing are one URL', () => {
    // Order comes from the vocabulary rather than the URL, which is what makes the answer cacheable.
    expect(canonicaliseParams(params({ color: ['bone', 'black'] }), VOCABULARY).color).toEqual([
      'black',
      'bone',
    ])
    expect(canonicaliseParams(params({ size: ['L', 'S', 'M'] }), VOCABULARY).size).toEqual([
      'S',
      'M',
      'L',
    ])
  })

  it('drops empty tokens, so ?color=,, is not three filters', () => {
    expect(canonicaliseParams(params({ color: ['', '  ', 'black'] }), VOCABULARY).color).toEqual([
      'black',
    ])
  })

  it('preserves an unknown value rather than deleting the evidence a filter was ignored', () => {
    // Rewriting ?color=puce away would strip the very thing the toolbar has to report.
    expect(canonicaliseParams(params({ color: ['puce', 'black'] }), VOCABULARY).color).toEqual([
      'black',
      'puce',
    ])
  })

  it('de-duplicates an unknown value on its own exact spelling', () => {
    // Known values fold case; an unknown one cannot, because the shop has no canonical spelling to
    // fold it onto — so 'puce' and 'PUCE' both survive, and both are reported as ignored.
    expect(canonicaliseParams(params({ color: ['puce', 'puce'] }), VOCABULARY).color).toEqual([
      'puce',
    ])
    expect(canonicaliseParams(params({ color: ['puce', 'PUCE'] }), VOCABULARY).color).toEqual([
      'puce',
      'PUCE',
    ])
  })

  it('clamps every unusable page to 1 rather than leaving one in the address bar', () => {
    // A page number no query ever ran must not survive canonicalisation.
    expect(canonicaliseParams(params({ page: 0 }), VOCABULARY).page).toBe(1)
    expect(canonicaliseParams(params({ page: -5 }), VOCABULARY).page).toBe(1)
    expect(canonicaliseParams(params({ page: 4.5 }), VOCABULARY).page).toBe(1)
    expect(canonicaliseParams(params({ page: Number.NaN }), VOCABULARY).page).toBe(1)
    expect(canonicaliseParams(params({ page: 1e21 }), VOCABULARY).page).toBe(1)
  })

  it('caps the page at the ceiling, because OFFSET is walked even when nothing comes back', () => {
    expect(canonicaliseParams(params({ page: 99999 }), VOCABULARY).page).toBe(CATALOG_MAX_PAGE)
    expect(canonicaliseParams(params({ page: CATALOG_MAX_PAGE }), VOCABULARY).page).toBe(
      CATALOG_MAX_PAGE,
    )
    expect(canonicaliseParams(params({ page: 2 }), VOCABULARY).page).toBe(2)
  })

  it('normalises the term but does NOT clamp it, so the "very long" notice stays reachable', () => {
    expect(canonicaliseParams(params({ q: '   hoodie   ' }), VOCABULARY).q).toBe('hoodie')
    expect(canonicaliseParams(params({ q: '%' }), VOCABULARY).q).toBeNull()
    expect(canonicaliseParams(params({ q: 'a'.repeat(400) }), VOCABULARY).q?.length).toBe(400)
  })

  it('leaves a reversed price range exactly as typed, because the swap has to be announceable', () => {
    const canonical = canonicaliseParams(params({ priceMax: 100, priceMin: 400 }), VOCABULARY)

    expect(canonical.priceMin).toBe(400)
    expect(canonical.priceMax).toBe(100)
  })

  it('is idempotent, which is the property that makes it a canonical form at all', () => {
    const once = canonicaliseParams(
      params({ color: ['BONE', 'puce'], page: 0, q: '  Merino  ', size: ['m'] }),
      VOCABULARY,
    )

    expect(canonicaliseParams(once, VOCABULARY)).toEqual(once)
  })

  it('leaves an empty facet empty rather than inventing a value', () => {
    expect(canonicaliseParams(params(), VOCABULARY).color).toEqual([])
    // An emptied vocabulary makes every previously known value unknown — and unknown is preserved,
    // so a colour deleted in the CMS is still reportable rather than silently gone.
    expect(
      canonicaliseParams(params({ color: ['black'] }), { ...VOCABULARY, colors: [] }).color,
    ).toEqual(['black'])
  })
})

describe('catalogHref keeps the shareable URL free of parameters that say nothing', () => {
  it('serialises an empty array to nothing at all, not to ?color=', () => {
    // '?color=' is a different URL from no color key, and a crawler indexes it as a second page.
    expect(catalogHref('/shop', { color: [] })).toBe('/shop')
    expect(catalogHref('/shop', {})).toBe('/shop')
    expect(catalogHref('/shop', PARAMS)).toBe('/shop')
  })

  it('omits every value that equals its default', () => {
    expect(catalogHref('/shop', { sort: 'featured' })).toBe('/shop')
    expect(catalogHref('/shop', { page: 1 })).toBe('/shop')
    expect(catalogHref('/shop', { sort: 'newest' })).toBe('/shop?sort=newest')
    expect(catalogHref('/shop', { page: 2 })).toBe('/shop?page=2')
  })

  it('treats null as "clear this key", which is how a chip drops one filter and keeps the rest', () => {
    expect(catalogHref('/shop', { color: ['black'], page: null })).toBe('/shop?color=black')
    expect(catalogHref('/search', { q: null })).toBe('/search')
  })

  it('joins multiple values with a comma, the flat form the plan’s own example URL uses', () => {
    expect(catalogHref('/shop', { category: ['hoodies', 'tops'] })).toBe(
      '/shop?category=hoodies,tops',
    )
  })

  it('never emits an empty parameter for a canonicalised query', () => {
    const href = catalogHref('/shop', canonicaliseParams(params({ size: ['m'] }), VOCABULARY))

    expect(href).toBe('/shop?size=M')
    expect(href).not.toContain('=&')
    expect(href.endsWith('=')).toBe(false)
  })
})

/* -------------------------------------------------------------------------------------------------
 * suggest.ts — the panel's payload and its one keyboard list
 * ---------------------------------------------------------------------------------------------- */

const card = (id: number, name: string): ProductCard => ({
  compareAtLabel: null,
  href: `/products/p-${id}`,
  id,
  image: null,
  isLimitedEdition: false,
  isNew: false,
  lowStockLabel: null,
  name,
  priceLabel: '$240.00',
  state: 'available',
})

const payload = (overrides: Partial<SuggestionPayload> = {}): SuggestionPayload => ({
  categories: [],
  collections: [],
  popular: [],
  products: [],
  recent: [],
  state: 'results',
  ...overrides,
})

describe('suggestionOptions is the one list the arrow keys walk', () => {
  it('returns nothing for an empty panel, so there is no option to select', () => {
    expect(suggestionOptions(payload())).toEqual([])
  })

  it('orders products, then categories, then collections, then recent, then popular', () => {
    const options = suggestionOptions(
      payload({
        categories: [{ href: '/shop/hoodies', label: 'Hoodies' }],
        collections: [{ href: '/shop?collection=essentials', label: 'Essentials' }],
        popular: ['merino'],
        products: [card(1, 'Heavyweight Hoodie')],
        recent: ['hoodie'],
      }),
    )

    expect(options.map((option) => option.kind)).toEqual([
      'product',
      'category',
      'collection',
      'term',
      'term',
    ])
    expect(options.map((option) => option.group)).toEqual([
      'Products',
      'Categories',
      'Collections',
      'Recent searches',
      'Popular searches',
    ])
  })

  it('gives every option a unique id, even when two options read identically', () => {
    // aria-activedescendant pointing at an id that is not in the document is silent: the screen
    // reader announces nothing at all, and nothing on screen looks wrong.
    const options = suggestionOptions(
      payload({
        popular: ['hoodie'],
        products: [card(1, 'Hoodie'), card(2, 'Hoodie')],
        recent: ['hoodie'],
      }),
    )
    const ids = options.map((option) => option.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'search-option-product-0',
      'search-option-product-1',
      'search-option-recent-0',
      'search-option-popular-0',
    ])
  })

  it('points a product option back at its own index, and a term option at nothing', () => {
    const options = suggestionOptions(
      payload({ products: [card(1, 'A'), card(2, 'B')], recent: ['hoodie'] }),
    )

    expect(options[0]?.productIndex).toBe(0)
    expect(options[1]?.productIndex).toBe(1)
    expect(options[0]?.href).toBe('/products/p-1')
    // A recent search is a submit, not a link: a href would navigate somewhere nobody asked for.
    expect(options[2]?.productIndex).toBeNull()
    expect(options[2]?.href).toBeNull()
  })
})

describe('suggestionGroups is derived from the keyboard list, not assembled beside it', () => {
  it('flattens back to exactly the options it was given, in the same order', () => {
    // The two had drifted once, and the result was ARIA options rendered outside their listbox.
    const options = suggestionOptions(
      payload({
        categories: [{ href: '/shop/hoodies', label: 'Hoodies' }],
        popular: ['merino'],
        products: [card(1, 'A'), card(2, 'B')],
      }),
    )
    const groups = suggestionGroups(options)

    expect(groups.flatMap((group) => group.options)).toEqual(options)
    expect(groups.map((group) => group.label)).toEqual([
      'Products',
      'Categories',
      'Popular searches',
    ])
    expect(groups[0]?.options).toHaveLength(2)
  })

  it('produces no empty group, because a heading over nothing promises what cannot be given', () => {
    for (const group of suggestionGroups(suggestionOptions(payload({ recent: ['hoodie'] })))) {
      expect(group.options.length).toBeGreaterThan(0)
    }

    expect(suggestionGroups([])).toEqual([])
  })
})

describe('buildSuggestions keeps the panel useful when the engine is not', () => {
  it('still offers recent and popular searches while search is unavailable', () => {
    // Those come from Postgres and from the customer's own browser; neither ever needed the engine,
    // so emptying the panel would take the shop's navigation down with a service it does not use.
    const built = buildSuggestions({
      cards: [],
      engine: 'unavailable',
      pending: false,
      popular: ['merino'],
      recent: ['hoodie'],
      status: 'empty',
      term: null,
      vocabulary: VOCABULARY,
    })

    expect(built.state).toBe('unavailable')
    expect(built.recent).toEqual(['hoodie'])
    expect(built.popular).toEqual(['merino'])
  })

  it('hides the older terms once a search is under way, so there is one answer on screen', () => {
    const built = buildSuggestions({
      cards: [],
      engine: 'search',
      pending: false,
      popular: ['merino'],
      recent: ['hoodie'],
      status: 'ok',
      term: 'sho',
      vocabulary: VOCABULARY,
    })

    expect(built.recent).toEqual([])
    expect(built.popular).toEqual([])
    // Prefix matches rank above substring ones: 'sho' means Shorts before Fisherman Shorts.
    expect(built.categories.map((entry) => entry.label)).toEqual(['Shorts', 'Fisherman Shorts'])
    expect(built.categories[0]?.href).toBe('/shop/shorts')
    // 'Essentials' contains no 'sho', so the section is absent rather than padded.
    expect(built.collections).toEqual([])
  })

  it('reports an outage as unavailable rather than as "nothing matched"', () => {
    // A failed search has the same cardCount as an empty one; deciding "empty" first blames the
    // customer's taste for the service being down.
    const outage = buildSuggestions({
      cards: [],
      engine: 'unavailable',
      pending: false,
      popular: [],
      recent: [],
      status: 'ok',
      term: 'hoodie',
      vocabulary: VOCABULARY,
    })
    const genuinelyEmpty = buildSuggestions({
      cards: [],
      engine: 'search',
      pending: false,
      popular: [],
      recent: [],
      status: 'ok',
      term: 'hoodie',
      vocabulary: VOCABULARY,
    })

    expect(outage.state).toBe('unavailable')
    expect(genuinelyEmpty.state).toBe('empty')
  })
})
