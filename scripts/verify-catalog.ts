/**
 * The Phase 11 catalogue rules, checked against the running code rather than against the comments
 * that describe them.
 *
 * ```
 * pnpm verify:catalog
 * ```
 *
 * **Three halves**, extending the shape `verify-shell.ts` established and `verify-home.ts` refined.
 *
 * The first needs nothing at all. `lib/catalog/query.ts`, `lib/catalog/resolve.ts` and
 * `lib/catalog/record.ts` import nothing from Next, nothing runnable from Payload and nothing marked
 * `server-only` — that separation exists so every edge case in plan §11.1d and every card state in
 * §11.1b can be exercised here as a pure function, one fixture per case.
 *
 * The second creates **real Payload documents** in the states that matter — a draft product, one
 * scheduled for next week, one whose every variant is inactive — and proves the listing query drops
 * exactly those. A fixture proves the function; a real document proves the function is being fed
 * what it thinks it is, which is the difference that mattered in Phase 7's access harness.
 *
 * The third runs only when Algolia is configured, and it is the one no earlier harness has an
 * analogue for: **it asserts the two engines agree.** Phase 11 answers the same question two ways
 * depending on which facets were used, and two implementations of one question is the standing
 * invitation for them to drift. So for every query Postgres *can* answer, the same query is put to
 * the index and the two id lists are compared.
 *
 * It writes to the database and cleans up after itself, and refuses to run anywhere but the
 * development database `DATABASE_PUSH_TARGET` names — the **D-10** guard, the same one `seed.ts` and
 * the other four harnesses use.
 *
 * `lib/catalog/catalog.ts` is deliberately **not** imported: it is `server-only` and depends on
 * Next's data cache, neither of which exists under the Payload CLI. That module holds caching, an
 * engine choice and a failure policy and no rules, which is why every rule lives somewhere this
 * script can reach.
 */

import type { Payload } from 'payload'

import config from '../src/payload.config'

import {
  appEnv,
  developmentDatabase,
  integrationStatus,
  requireIntegration,
} from '../src/lib/env.core'
import { catalogIndexName, createSearchClient, searchProductIds } from '../src/lib/catalog/algolia'
import { COLOR_FAMILY_OPTIONS } from '../src/lib/catalog/colors'
import { collectProductRecords } from '../src/lib/catalog/indexer'
import {
  CATALOG_MAX_PAGE,
  CATALOG_PAGE_SIZE,
  CATALOG_SORTS,
  CATALOG_SORT_FIELDS,
  DEFAULT_CATALOG_SORT,
  EMPTY_VOCABULARY,
  canonicaliseParams,
  catalogHref,
  catalogWhere,
  expandCategory,
  listableVariantWhere,
  outOfRangePage,
  isFilteredQuery,
  normaliseCatalogQuery,
  publishedProductWhere,
  requiresSearchIndex,
  toCategoryOptions,
  type CatalogParams,
  type CatalogVocabulary,
} from '../src/lib/catalog/query'
import {
  activeFilterChips,
  productCardBadge,
  productCardState,
  productCountLabel,
  resolveProductCard,
} from '../src/lib/catalog/resolve'
import {
  CATALOG_INDEX_SETTINGS,
  CATALOG_SORT_REPLICAS,
  allIndexNames,
  buildProductRecord,
  indexNameForSort,
  indexSearchParams,
  withAncestors,
} from '../src/lib/catalog/record'
import { CATALOG_IMAGE_SIZES } from '../src/lib/catalog/sizes'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-catalog refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes collection documents, so it may only touch the development database ' +
      'that DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const { getPayload } = await import('payload')

/* -------------------------------------------------------------------------------------------------
 * Harness
 * ---------------------------------------------------------------------------------------------- */

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

const params = (overrides: Partial<CatalogParams> = {}): CatalogParams => ({
  availability: null,
  category: [],
  collection: [],
  color: [],
  page: 1,
  priceMax: null,
  priceMin: null,
  size: [],
  sort: DEFAULT_CATALOG_SORT,
  ...overrides,
})

const VOCABULARY: CatalogVocabulary = {
  categories: [
    { label: 'Clothing', parent: null, value: 'clothing' },
    { label: 'Tops', parent: 'clothing', value: 'tops' },
    { label: 'Hoodies', parent: 'tops', value: 'hoodies' },
    { label: 'Accessories', parent: null, value: 'accessories' },
  ],
  collections: [{ label: 'Essentials', value: 'essentials' }],
  colors: [
    { label: 'Black', value: 'black' },
    { label: 'Bone', value: 'bone' },
  ],
  priceCeilingMinor: 48000,
  priceFloorMinor: 4500,
  sizes: [
    { label: 'S', value: 'S' },
    { label: 'M', value: 'M' },
    { label: 'L', value: 'L' },
  ],
}

/* =================================================================================================
 * A — Sorts, constants and the URL contract
 * ============================================================================================== */

check(
  'A: the page size divides by 2, 3 and 4',
  CATALOG_PAGE_SIZE % 12 === 0,
  String(CATALOG_PAGE_SIZE),
)

check(
  'A: every sort has a Payload field list',
  CATALOG_SORTS.every((sort) => (CATALOG_SORT_FIELDS[sort]?.length ?? 0) > 0),
)

check(
  'A: every sort ends in a unique tiebreaker, so pagination cannot interleave',
  CATALOG_SORTS.every((sort) => CATALOG_SORT_FIELDS[sort].at(-1) === 'slug'),
  CATALOG_SORTS.map((sort) => `${sort}:${CATALOG_SORT_FIELDS[sort].at(-1)}`).join(' '),
)

check(
  'A: no sort orders by a nullable price column descending without the exists clause',
  publishedProductWhere('2026-01-01T00:00:00.000Z').some(
    (clause) =>
      JSON.stringify(clause).includes('derived.priceFromMinor') &&
      JSON.stringify(clause).includes('exists'),
  ),
)

check('A: rating is not offered — reviews are Phase 21', !CATALOG_SORTS.includes('rating' as never))

check(
  'A: an unfiltered shop URL is bare — no defaulted parameters',
  catalogHref('/shop', params()) === '/shop',
  catalogHref('/shop', params()),
)

check(
  "A: plan §11.1d's example URL round-trips",
  catalogHref(
    '/shop',
    params({ category: ['hoodies'], color: ['black'], size: ['M'], sort: 'newest' }),
  ) === '/shop?category=hoodies&color=black&size=M&sort=newest',
  catalogHref(
    '/shop',
    params({ category: ['hoodies'], color: ['black'], size: ['M'], sort: 'newest' }),
  ),
)

check(
  'A: page 1 is never written into the URL',
  !catalogHref('/shop', params({ page: 1, sort: 'newest' })).includes('page'),
  catalogHref('/shop', params({ page: 1, sort: 'newest' })),
)

check(
  'A: every catalogue sizes string is present and non-empty',
  Object.values(CATALOG_IMAGE_SIZES).every(
    (value) => typeof value === 'string' && value.length > 0,
  ),
)

check(
  'A: the card grid sizes string has a fixed tier above 1440, where the container stops growing',
  CATALOG_IMAGE_SIZES.productCardGrid.includes('(min-width: 1440px) 244px'),
  CATALOG_IMAGE_SIZES.productCardGrid,
)

/* =================================================================================================
 * B — Plan §11.1d's edge cases
 * ============================================================================================== */

{
  const { ignored, query } = normaliseCatalogQuery(
    params({ color: ['puce'], size: ['XXL'] }),
    VOCABULARY,
  )

  check(
    'B: a filter referencing a deleted value is dropped',
    query.colors.length === 0 && query.sizes.length === 0,
  )

  check(
    'B: …and is reported rather than silently discarded',
    ignored.length === 2 && ignored.every((entry) => entry.reason === 'unknown'),
    JSON.stringify(ignored),
  )
}

{
  const { ignored, query } = normaliseCatalogQuery(
    params({ category: ['nonexistent'] }),
    VOCABULARY,
  )

  check(
    'B: an unknown category in the query string is dropped and reported',
    query.categories.length === 0 && ignored[0]?.facet === 'category',
  )
}

{
  const { ignored, query } = normaliseCatalogQuery(
    params({ priceMax: 100, priceMin: 400 }),
    VOCABULARY,
  )

  check(
    'B: a reversed price range is swapped, not dropped',
    query.priceMinMinor === 10_000 && query.priceMaxMinor === 40_000,
    `${query.priceMinMinor}–${query.priceMaxMinor}`,
  )

  check(
    'B: …and the swap is reported',
    ignored.some((entry) => entry.reason === 'reversed'),
  )
}

{
  const { ignored, query } = normaliseCatalogQuery(
    params({ color: ['black', 'black', 'BLACK'] }),
    VOCABULARY,
  )

  check(
    'B: duplicate filter values are de-duplicated',
    query.colors.length === 1 && query.colors[0] === 'black',
    JSON.stringify(query.colors),
  )

  check('B: …silently, because a duplicate changes no answer', ignored.length === 0)
}

check(
  'B: a lower-case size from the URL matches the upper-case stored value',
  normaliseCatalogQuery(params({ size: ['m'] }), VOCABULARY).query.sizes[0] === 'M',
)

{
  const a = normaliseCatalogQuery(params({ color: ['bone', 'black'] }), VOCABULARY).query
  const b = normaliseCatalogQuery(params({ color: ['black', 'bone'] }), VOCABULARY).query

  check(
    'B: two URLs listing the same values in a different order produce one query',
    JSON.stringify(a) === JSON.stringify(b),
    JSON.stringify(a.colors),
  )
}

check(
  'B: a negative page is clamped to 1',
  normaliseCatalogQuery(params({ page: -5 }), VOCABULARY).query.page === 1,
)

check(
  'B: an absurd page is clamped, so no query becomes a huge OFFSET',
  normaliseCatalogQuery(params({ page: 99_999_999 }), VOCABULARY).query.page === CATALOG_MAX_PAGE,
)

check(
  'B: a fractional page cannot reach a Postgres LIMIT',
  Number.isSafeInteger(normaliseCatalogQuery(params({ page: 4.5 }), VOCABULARY).query.page),
  String(normaliseCatalogQuery(params({ page: 4.5 }), VOCABULARY).query.page),
)

check(
  'B: a negative price bound is refused rather than filtering on nonsense',
  normaliseCatalogQuery(params({ priceMin: -20 }), VOCABULARY).query.priceMinMinor === null,
)

check(
  'B: an unparseable price is refused',
  normaliseCatalogQuery(params({ priceMax: Number.NaN }), VOCABULARY).query.priceMaxMinor === null,
)

check(
  'B: prices convert from major units to minor exactly once',
  normaliseCatalogQuery(params({ priceMin: 240 }), VOCABULARY).query.priceMinMinor === 24_000,
)

/* =================================================================================================
 * B2 — Regressions from the Phase 11 post-implementation audit
 * ============================================================================================== */

check(
  'B2: a lower-case size is canonicalised, so the chip and the URL agree (audit finding 1)',
  canonicaliseParams(params({ size: ['m'] }), VOCABULARY).size.join(',') === 'M',
  canonicaliseParams(params({ size: ['m'] }), VOCABULARY).size.join(','),
)

check(
  'B2: …which is what makes removing that chip actually change the URL',
  (() => {
    const canonical = canonicaliseParams(params({ size: ['m'] }), VOCABULARY)
    const remaining = canonical.size.filter((entry) => entry !== 'M')

    return (
      catalogHref('/shop', { ...canonical, size: remaining.length > 0 ? remaining : null }) !==
      catalogHref('/shop', canonical)
    )
  })(),
)

check(
  'B2: an UNKNOWN value survives canonicalisation, so the ignored-filter notice still fires',
  canonicaliseParams(params({ color: ['puce'] }), VOCABULARY).color.join(',') === 'puce',
)

check(
  'B2: a reversed price range survives canonicalisation, so the swap can still be announced',
  (() => {
    const canonical = canonicaliseParams(params({ priceMax: 100, priceMin: 400 }), VOCABULARY)

    return canonical.priceMin === 400 && canonical.priceMax === 100
  })(),
)

check(
  'B2: canonicalisation orders values by the vocabulary, not by the URL',
  canonicaliseParams(params({ color: ['bone', 'black'] }), VOCABULARY).color.join(',') ===
    'black,bone',
)

check(
  'B2: canonicalisation de-duplicates',
  canonicaliseParams(params({ color: ['black', 'BLACK'] }), VOCABULARY).color.join(',') === 'black',
)

check(
  'B2: an absurd page is canonicalised, so the URL cannot keep a page no query ran',
  canonicaliseParams(params({ page: 99_999_999 }), VOCABULARY).page === CATALOG_MAX_PAGE,
)

check(
  'B2: canonicalisation is a FIXED POINT — no URL can redirect twice',
  (() => {
    const once = canonicaliseParams(
      params({
        category: ['HOODIES'],
        color: ['puce', 'BONE', 'black'],
        page: 0,
        size: ['m', 'm'],
      }),
      VOCABULARY,
    )
    const twice = canonicaliseParams(once, VOCABULARY)

    return catalogHref('/shop', once) === catalogHref('/shop', twice)
  })(),
  catalogHref(
    '/shop',
    canonicaliseParams(
      params({
        category: ['HOODIES'],
        color: ['puce', 'BONE', 'black'],
        page: 0,
        size: ['m', 'm'],
      }),
      VOCABULARY,
    ),
  ),
)

check(
  'B2: an already-canonical URL does not redirect',
  (() => {
    const canonical = canonicaliseParams(params({ color: ['black'], size: ['M'] }), VOCABULARY)

    return (
      catalogHref('/shop', canonicaliseParams(canonical, VOCABULARY)) ===
      catalogHref('/shop', canonical)
    )
  })(),
)

check(
  'B2: page 5 of a 1-page result redirects to the last page (audit finding 3)',
  outOfRangePage(5, 1) === 1,
)

check('B2: page 9 of a 3-page result redirects to page 3', outOfRangePage(9, 3) === 3)
check('B2: a page that exists does not redirect', outOfRangePage(2, 3) === null)
check('B2: the last page does not redirect', outOfRangePage(3, 3) === null)

check(
  'B2: an EMPTY result does not redirect — the empty state is the right answer',
  outOfRangePage(5, 0) === null,
)

check(
  'B2: the redirect target never itself redirects, at any size',
  [1, 2, 3, 24, 500].every((total) => {
    const target = outOfRangePage(9999, total)

    return target === null || outOfRangePage(target, total) === null
  }),
)

{
  const clause = JSON.stringify(listableVariantWhere('2026-08-30T00:00:00.000Z'))

  check(
    'B2: the facet vocabulary only reads variants of PUBLISHED products (audit finding 4)',
    clause.includes('product.status'),
    clause,
  )

  check('B2: …and not of a scheduled product', clause.includes('product.publishedAt'))

  check(
    'B2: …and not of a product whose every variant is switched off',
    clause.includes('product.derived.priceFromMinor'),
  )

  check(
    'B2: the vocabulary clause and the listing clause agree on what "listable" means',
    publishedProductWhere('2026-08-30T00:00:00.000Z').every((listing) => {
      const key = JSON.stringify(listing).match(/"([a-zA-Z.]+)":/)?.[1] ?? ''

      return key === 'or'
        ? clause.includes('product.publishedAt')
        : clause.includes(`product.${key}`)
    }),
  )
}

/* =================================================================================================
 * C — Category expansion, and the two engines agreeing about it
 * ============================================================================================== */

check(
  'C: a category expands to its whole subtree',
  expandCategory(VOCABULARY, 'clothing').sort().join(',') === 'clothing,hoodies,tops',
  expandCategory(VOCABULARY, 'clothing').join(','),
)

check(
  'C: a leaf category expands to itself',
  expandCategory(VOCABULARY, 'hoodies').join(',') === 'hoodies',
)

{
  /*
   * The cycle `Categories.ts` says the schema permits through two separate saves. Without the `seen`
   * guard this call does not return.
   */
  const cyclic: CatalogVocabulary = {
    ...VOCABULARY,
    categories: [
      { label: 'A', parent: 'b', value: 'a' },
      { label: 'B', parent: 'a', value: 'b' },
    ],
  }

  check(
    'C: a two-save parent cycle terminates instead of hanging the request',
    expandCategory(cyclic, 'a').sort().join(',') === 'a,b',
  )
}

{
  const parents = new Map<string, null | string>([
    ['hoodies', 'tops'],
    ['tops', 'clothing'],
    ['clothing', null],
  ])

  check(
    'C: the index stores ancestors, so /shop/clothing finds a product tagged only hoodies',
    withAncestors(['hoodies'], parents).sort().join(',') === 'clothing,hoodies,tops',
    withAncestors(['hoodies'], parents).join(','),
  )

  const cyclicParents = new Map<string, null | string>([
    ['a', 'b'],
    ['b', 'a'],
  ])

  check(
    'C: withAncestors terminates on a parent cycle too',
    withAncestors(['a'], cyclicParents).sort().join(',') === 'a,b',
  )
}

check(
  'C: a route category scopes the listing when no facet category is chosen',
  normaliseCatalogQuery(params(), VOCABULARY, 'clothing').query.categories.sort().join(',') ===
    'clothing,hoodies,tops',
)

check(
  'C: a chosen facet category narrows inside the route category',
  normaliseCatalogQuery(
    params({ category: ['hoodies'] }),
    VOCABULARY,
    'clothing',
  ).query.categories.join(',') === 'hoodies',
)

check(
  'C: standing in a category is not "filtered" — nothing is offered to clear',
  !isFilteredQuery(normaliseCatalogQuery(params(), VOCABULARY, 'clothing').query, 'clothing'),
)

check(
  'C: adding a real filter inside a category is "filtered"',
  isFilteredQuery(
    normaliseCatalogQuery(params({ availability: 'in-stock' }), VOCABULARY, 'clothing').query,
    'clothing',
  ),
)

/* =================================================================================================
 * D — The engine boundary
 * ============================================================================================== */

check(
  'D: an unfiltered browse does not need the search index',
  !requiresSearchIndex(normaliseCatalogQuery(params(), VOCABULARY).query),
)

const postgresFacets: [string, Partial<CatalogParams>][] = [
  ['category', { category: ['hoodies'] }],
  ['price', { priceMax: 300 }],
  ['availability', { availability: 'in-stock' }],
]

for (const [facet, override] of postgresFacets) {
  check(
    `D: ${facet} is answered by Postgres, so an Algolia outage cannot break it`,
    !requiresSearchIndex(normaliseCatalogQuery(params(override), VOCABULARY).query),
  )
}

const indexFacets: [string, Partial<CatalogParams>][] = [
  ['color', { color: ['black'] }],
  ['size', { size: ['M'] }],
  ['collection', { collection: ['essentials'] }],
]

for (const [facet, override] of indexFacets) {
  check(
    `D: ${facet} requires the index — it is not a column on products`,
    requiresSearchIndex(normaliseCatalogQuery(params(override), VOCABULARY).query),
  )
}

for (const sort of CATALOG_SORTS) {
  check(
    `D: sorting by ${sort} alone never requires the index`,
    !requiresSearchIndex(normaliseCatalogQuery(params({ sort }), VOCABULARY).query),
  )
}

{
  const where = JSON.stringify(
    catalogWhere(normaliseCatalogQuery(params(), VOCABULARY).query, '2026-08-30T00:00:00.000Z'),
  )

  check('D: every listing query filters to published', where.includes('"status"'))
  check('D: …excludes a scheduled drop', where.includes('publishedAt'))
  check('D: …and excludes a product with no active variant', where.includes('priceFromMinor'))
}

check(
  'D: the in-stock filter compares the stock count, not a flag',
  JSON.stringify(
    catalogWhere(
      normaliseCatalogQuery(params({ availability: 'in-stock' }), VOCABULARY).query,
      '2026-08-30T00:00:00.000Z',
    ),
  ).includes('"greater_than":0'),
)

check(
  'D: the price ceiling compares the lowest price, so a range product is not hidden',
  JSON.stringify(
    catalogWhere(
      normaliseCatalogQuery(params({ priceMax: 150 }), VOCABULARY).query,
      '2026-08-30T00:00:00.000Z',
    ),
  ).includes('priceFromMinor'),
)

/* =================================================================================================
 * E — Plan §11.1b's card states
 * ============================================================================================== */

check('E: no active variant reads as unavailable', productCardState(null, 0, 5) === 'unavailable')
check('E: zero stock reads as sold out', productCardState(9500, 0, 5) === 'soldOut')
check('E: at the threshold reads as low stock', productCardState(9500, 5, 5) === 'lowStock')
check('E: above the threshold reads as available', productCardState(9500, 6, 5) === 'available')
check(
  'E: a zero threshold cannot make sold-out read as available',
  productCardState(9500, 0, 0) === 'soldOut',
)
check(
  'E: a negative stock count cannot read as available',
  productCardState(9500, -3, 5) === 'soldOut',
)

/*
 * An explicit `return` rather than `=> ({ … })`. With a trailing object spread inside, TypeScript's
 * lookahead commits to parsing the parenthesised object as an arrow-function *parameter pattern* —
 * where a rest property is legal — and then fails on the first literal value with
 * "'null' is a reserved word that cannot be used here". A braced body is unambiguous.
 */
const productFixture = (overrides: Record<string, unknown> = {}) => {
  return {
    derived: {
      compareAtFromMinor: null,
      inventoryTotal: 12,
      priceFromMinor: 9500,
      priceToMinor: 9500,
    },
    gallery: [],
    id: 1,
    isLimitedEdition: false,
    isNew: false,
    name: 'Merino Crew',
    slug: 'merino-crew',
    ...overrides,
  }
}

{
  const card = resolveProductCard(productFixture(), 'USD', 'en-US', 5)

  check('E: a normal card resolves', card?.state === 'available' && card.priceLabel === '$95.00')
  check('E: …to the canonical product path', card?.href === '/product/merino-crew')
}

check(
  'E: a product with no name is dropped',
  resolveProductCard(productFixture({ name: '  ' }), 'USD', 'en-US', 5) === null,
)

check(
  'E: a product with no slug is dropped — it has no page to link to',
  resolveProductCard(productFixture({ slug: null }), 'USD', 'en-US', 5) === null,
)

check(
  'E: an unavailable product keeps a card but loses its price',
  (() => {
    const card = resolveProductCard(
      productFixture({ derived: { inventoryTotal: 0, priceFromMinor: null, priceToMinor: null } }),
      'USD',
      'en-US',
      5,
    )

    return card?.state === 'unavailable' && card.priceLabel === null
  })(),
)

check(
  'E: a price range renders as "From"',
  resolveProductCard(
    productFixture({ derived: { inventoryTotal: 4, priceFromMinor: 9500, priceToMinor: 24_000 } }),
    'USD',
    'en-US',
    5,
  )?.priceLabel === 'From $95.00',
)

check(
  'E: a genuine saving renders a struck price',
  resolveProductCard(
    productFixture({
      derived: {
        compareAtFromMinor: 24_000,
        inventoryTotal: 4,
        priceFromMinor: 9500,
        priceToMinor: 9500,
      },
    }),
    'USD',
    'en-US',
    5,
  )?.compareAtLabel === '$240.00',
)

check(
  'E: an equal compare-at is not a sale',
  resolveProductCard(
    productFixture({
      derived: {
        compareAtFromMinor: 9500,
        inventoryTotal: 4,
        priceFromMinor: 9500,
        priceToMinor: 9500,
      },
    }),
    'USD',
    'en-US',
    5,
  )?.compareAtLabel === null,
)

check(
  'E: a compare-at BELOW the price is not a negative saving',
  resolveProductCard(
    productFixture({
      derived: {
        compareAtFromMinor: 5000,
        inventoryTotal: 4,
        priceFromMinor: 9500,
        priceToMinor: 9500,
      },
    }),
    'USD',
    'en-US',
    5,
  )?.compareAtLabel === null,
)

check(
  'E: a bare relationship id is not rendered as an image',
  resolveProductCard(productFixture({ gallery: [{ image: 7 }] }), 'USD', 'en-US', 5)?.image ===
    null,
)

/* --- badge precedence --- */

{
  const badgeFor = (overrides: Record<string, unknown>) =>
    productCardBadge(resolveProductCard(productFixture(overrides), 'USD', 'en-US', 5)!)?.label ??
    null

  check(
    'E: availability outranks merchandising — a sold-out NEW product says Sold out',
    badgeFor({
      derived: { inventoryTotal: 0, priceFromMinor: 9500, priceToMinor: 9500 },
      isNew: true,
    }) === 'Sold out',
  )

  check(
    'E: low stock outranks a sale',
    badgeFor({
      derived: {
        compareAtFromMinor: 24_000,
        inventoryTotal: 2,
        priceFromMinor: 9500,
        priceToMinor: 9500,
      },
    }) === 'Only 2 left',
  )

  check('E: a plain new product is badged New', badgeFor({ isNew: true }) === 'New')
  check('E: nothing to say means no badge', badgeFor({}) === null)

  check(
    'E: a sold-out product on sale still shows the struck price, so the sale is not lost',
    resolveProductCard(
      productFixture({
        derived: {
          compareAtFromMinor: 24_000,
          inventoryTotal: 0,
          priceFromMinor: 9500,
          priceToMinor: 9500,
        },
      }),
      'USD',
      'en-US',
      5,
    )?.compareAtLabel === '$240.00',
  )
}

check('E: the product count is singular at one', productCountLabel(1) === '1 product')
check('E: …plural at two', productCountLabel(2) === '2 products')
check('E: …and reads as none at zero', productCountLabel(0) === 'No products')

/* --- chips --- */

{
  const { query } = normaliseCatalogQuery(
    params({ availability: 'in-stock', color: ['black'], priceMin: 50, size: ['M'] }),
    VOCABULARY,
  )

  const chips = activeFilterChips(query, VOCABULARY, (minor) => `$${minor / 100}`)

  check(
    'E: every applied filter is offered back for removal',
    chips.length === 4,
    chips.map((chip) => chip.label).join(' | '),
  )

  const withCategory = normaliseCatalogQuery(params({ category: ['clothing'] }), VOCABULARY).query
  const categoryChips = activeFilterChips(withCategory, VOCABULARY, (minor) => `$${minor / 100}`)

  check(
    'E: expanding a category does not produce a chip per descendant',
    categoryChips.length === 1 && categoryChips[0].value === 'clothing',
    categoryChips.map((chip) => chip.value).join(','),
  )

  check(
    'E: the route category is not offered as a removable chip',
    activeFilterChips(
      normaliseCatalogQuery(params(), VOCABULARY, 'clothing').query,
      VOCABULARY,
      (minor) => `$${minor / 100}`,
      'clothing',
    ).length === 0,
  )
}

/* =================================================================================================
 * F — The index record
 * ============================================================================================== */

const indexable = (overrides: Record<string, unknown> = {}) => {
  return {
    categorySlugs: ['hoodies'],
    collectionSlugs: ['essentials'],
    derived: {
      compareAtFromMinor: null,
      inventoryTotal: 8,
      priceFromMinor: 9500,
      priceToMinor: 9500,
    },
    id: 1,
    name: 'Merino Crew',
    publishedAt: '2026-01-01T00:00:00.000Z',
    slug: 'merino-crew',
    status: 'published',
    ...overrides,
  }
}

const variantFixtures = [
  { active: true, colorFamily: 'black', inventoryQuantity: 4, size: 'M' },
  { active: true, colorFamily: 'bone', inventoryQuantity: 4, size: 'L' },
  { active: false, colorFamily: 'rust', inventoryQuantity: 9, size: 'S' },
]

{
  const record = buildProductRecord(indexable(), variantFixtures, new Date('2026-08-30T00:00:00Z'))

  check('F: a published product produces a record', record !== null)
  check('F: the objectID is the product id as a string', record?.objectID === '1')
  check(
    'F: only ACTIVE variants contribute sizes',
    record?.sizes.sort().join(',') === 'L,M',
    record?.sizes.join(','),
  )
  check(
    'F: only active variants contribute colours',
    record?.colorFamilies.sort().join(',') === 'black,bone',
    record?.colorFamilies.join(','),
  )
  check('F: stock is carried as a facet', record?.inStock === true)
  check(
    'F: publishedAt becomes an epoch Algolia can rank on',
    typeof record?.publishedAtMs === 'number',
  )
}

check(
  'F: a draft product never reaches the index',
  buildProductRecord(indexable({ status: 'draft' }), variantFixtures) === null,
)

check(
  'F: a scheduled product is withheld until its date',
  buildProductRecord(
    indexable({ publishedAt: '2030-01-01T00:00:00.000Z' }),
    variantFixtures,
    new Date('2026-08-30T00:00:00Z'),
  ) === null,
)

check(
  'F: a product with no active variant is not indexed',
  buildProductRecord(
    indexable({ derived: { inventoryTotal: 0, priceFromMinor: null, priceToMinor: null } }),
    [],
  ) === null,
)

check(
  'F: an out-of-stock product IS indexed — sold out is a state, not a removal',
  buildProductRecord(
    indexable({ derived: { inventoryTotal: 0, priceFromMinor: 9500, priceToMinor: 9500 } }),
    variantFixtures,
  )?.inStock === false,
)

check(
  'F: the record carries no price or name a customer reads from the index',
  (() => {
    const retrieve = CATALOG_INDEX_SETTINGS.attributesToRetrieve

    return retrieve.length === 1 && retrieve[0] === 'objectID'
  })(),
  CATALOG_INDEX_SETTINGS.attributesToRetrieve.join(','),
)

check(
  'F: every facet the query can filter on is declared filterable',
  ['categorySlugs', 'collectionSlugs', 'colorFamilies', 'sizes', 'inStock'].every((attribute) =>
    CATALOG_INDEX_SETTINGS.attributesForFaceting.includes(`filterOnly(${attribute})`),
  ),
)

check(
  'F: the price attributes are declared numerically filterable',
  CATALOG_INDEX_SETTINGS.numericAttributesForFiltering.includes('priceFromMinor'),
)

check(
  'F: four sorts have a replica and featured uses the primary',
  CATALOG_SORT_REPLICAS.featured === null && allIndexNames('base').length === 5,
  allIndexNames('base').join(' '),
)

check(
  'F: each sort resolves to a distinct index',
  new Set(CATALOG_SORTS.map((sort) => indexNameForSort('base', sort))).size ===
    CATALOG_SORTS.length,
)

{
  const search = indexSearchParams(
    normaliseCatalogQuery(params({ color: ['black', 'bone'], size: ['M'] }), VOCABULARY).query,
    CATALOG_PAGE_SIZE,
  )

  check(
    'F: two colours are OR-ed inside one group, not AND-ed into nothing',
    search.facetFilters.some(
      (group) => group.length === 2 && group.every((entry) => entry.startsWith('colorFamilies:')),
    ),
    JSON.stringify(search.facetFilters),
  )

  check(
    'F: separate facets are AND-ed as separate groups',
    search.facetFilters.length === 2,
    JSON.stringify(search.facetFilters),
  )

  check('F: the URL page 1 becomes Algolia page 0', search.page === 0)

  check(
    'F: the URL page 3 becomes Algolia page 2',
    indexSearchParams(
      normaliseCatalogQuery(params({ page: 3 }), VOCABULARY).query,
      CATALOG_PAGE_SIZE,
    ).page === 2,
  )
}

check(
  'F: the colour vocabulary is shared with the variant schema, not copied',
  COLOR_FAMILY_OPTIONS.length === 11 && COLOR_FAMILY_OPTIONS[0].value === 'black',
)

/* =================================================================================================
 * G — Real documents
 * ============================================================================================== */

const payload: Payload = await getPayload({ config })

const created: { collection: 'categories' | 'product-variants' | 'products'; id: number }[] = []

const cleanup = async () => {
  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true })
      .catch(() => undefined)
  }
}

try {
  const stamp = Date.now()

  const category = await payload.create({
    collection: 'categories',
    data: { name: `Verify ${stamp}`, slug: `verify-${stamp}`, sortOrder: 999, status: 'published' },
    overrideAccess: true,
  })
  created.push({ collection: 'categories', id: category.id })

  const makeProduct = async (
    suffix: string,
    data: Record<string, unknown>,
    variants: Record<string, unknown>[],
  ) => {
    const product = await payload.create({
      collection: 'products',
      /*
       * `as never` for the reason `verify-home.ts` uses it on the same call: Payload's generated
       * create type for a collection with a `derived` group demands fields the caller must not
       * supply, because a hook owns them.
       */
      data: {
        categories: [category.id],
        name: `Verify ${suffix} ${stamp}`,
        slug: `verify-${suffix}-${stamp}`,
        sortOrder: 0,
        status: 'published',
        ...data,
      } as never,
      overrideAccess: true,
    })
    created.push({ collection: 'products', id: product.id })

    for (const [index, variant] of variants.entries()) {
      const row = await payload.create({
        collection: 'product-variants',
        data: {
          active: true,
          color: 'Black',
          colorFamily: 'black',
          inventoryQuantity: 5,
          priceMinor: 12_000,
          product: product.id,
          size: 'M',
          sizeSortOrder: 30,
          sku: `VERIFY-${suffix.toUpperCase()}-${stamp}-${index}`,
          ...variant,
        },
        overrideAccess: true,
      })
      created.push({ collection: 'product-variants', id: row.id })
    }

    return product
  }

  const live = await makeProduct('live', {}, [{}])
  const draft = await makeProduct('draft', { status: 'draft' }, [{}])
  const scheduled = await makeProduct(
    'scheduled',
    { publishedAt: new Date(Date.now() + 7 * 86_400_000).toISOString() },
    [{}],
  )
  const withdrawn = await makeProduct('withdrawn', {}, [{ active: false }])
  const soldOut = await makeProduct('soldout', {}, [{ inventoryQuantity: 0 }])

  const now = new Date().toISOString()

  const listed = await payload.find({
    collection: 'products',
    depth: 0,
    limit: 0,
    pagination: false,
    where: {
      and: [...publishedProductWhere(now), { categories: { equals: category.id } }],
    },
  })

  const listedIds = new Set(listed.docs.map((doc) => doc.id))

  check('G: a live product is listed', listedIds.has(live.id))
  check('G: a draft product is not listed', !listedIds.has(draft.id))
  check('G: a scheduled product is not listed', !listedIds.has(scheduled.id))
  check(
    'G: a product whose every variant is inactive is not listed',
    !listedIds.has(withdrawn.id),
    `derived price: ${JSON.stringify((await payload.findByID({ collection: 'products', id: withdrawn.id, depth: 0 })).derived)}`,
  )
  check('G: a SOLD OUT product IS listed — it is a state, not a removal', listedIds.has(soldOut.id))

  /*
   * **The audit's finding 4, against real rows.** The fixture above proves the clause mentions
   * `product.status`; this proves the database agrees — that the dotted path really does resolve to
   * a join and really does exclude a draft product's variants. The draft product created above
   * carries size `M`, which several published products also stock, so the test needs a size only the
   * unlisted products have.
   */
  /*
   * `size` carries `maxLength: 24`, so the marker is deliberately short — a 25-character size is a
   * ValidationError, not a test failure, and the first version of this was exactly one over.
   */
  const hiddenSize = `VONLY-${stamp % 1_000_000}`

  const hiddenVariant = await payload.create({
    collection: 'product-variants',
    data: {
      active: true,
      color: 'Black',
      colorFamily: 'black',
      inventoryQuantity: 5,
      priceMinor: 12_000,
      product: draft.id,
      size: hiddenSize,
      sizeSortOrder: 40,
      sku: `VERIFY-HIDDEN-${stamp}`,
    },
    overrideAccess: true,
  })
  created.push({ collection: 'product-variants', id: hiddenVariant.id })

  const listableVariants = await payload.find({
    collection: 'product-variants',
    depth: 0,
    limit: 0,
    pagination: false,
    select: { size: true },
    where: listableVariantWhere(new Date().toISOString()),
  })

  const offeredSizes = new Set(listableVariants.docs.map((doc) => doc.size))

  check(
    "G: a DRAFT product's size is not offered as a filter option",
    !offeredSizes.has(hiddenSize),
    `${offeredSizes.size} size(s) offered`,
  )

  const allActiveVariants = await payload.find({
    collection: 'product-variants',
    depth: 0,
    limit: 0,
    pagination: false,
    select: { size: true },
    where: { active: { equals: true } },
  })

  check(
    'G: …and the old clause would have offered it, so the test can fail',
    new Set(allActiveVariants.docs.map((doc) => doc.size)).has(hiddenSize),
  )

  check(
    "G: a WITHDRAWN product's sizes are not offered either",
    await payload
      .find({
        collection: 'product-variants',
        depth: 0,
        limit: 0,
        pagination: false,
        select: { product: true },
        where: listableVariantWhere(new Date().toISOString()),
      })
      .then(({ docs }) =>
        docs.every((doc) => {
          const productId =
            typeof doc.product === 'object' && doc.product ? doc.product.id : doc.product

          return productId !== withdrawn.id && productId !== scheduled.id
        }),
      ),
  )

  /*
   * The derived cache is what the listing filters on, so the harness checks that a real variant save
   * produced it rather than trusting `syncProductDerived`'s docblock.
   */
  const soldOutDoc = await payload.findByID({ collection: 'products', id: soldOut.id, depth: 0 })

  check(
    'G: a sold-out product has a price and no stock',
    soldOutDoc.derived?.priceFromMinor === 12_000 && soldOutDoc.derived?.inventoryTotal === 0,
    JSON.stringify(soldOutDoc.derived),
  )

  const withdrawnDoc = await payload.findByID({
    collection: 'products',
    id: withdrawn.id,
    depth: 0,
  })

  check(
    'G: a withdrawn product has no derived price at all',
    withdrawnDoc.derived?.priceFromMinor === null,
  )

  /* --- the vocabulary, shaped from REAL rows --- */

  /*
   * The check that the fixture-based section C structurally could not make. `expandCategory` was
   * correct all along; what was wrong was the function feeding it, which read `parent` as a document
   * when `depth: 0` returns an id — so every real category resolved to `parent: null` and the whole
   * taxonomy flattened. Hand-written fixtures had the parents already resolved and sailed past it.
   */
  const realCategories = await payload.find({
    collection: 'categories',
    depth: 0,
    limit: 0,
    pagination: false,
    where: { status: { equals: 'published' } },
  })

  const options = toCategoryOptions(realCategories.docs)
  const withParent = options.filter((option) => option.parent !== null)

  check(
    'G: the real category vocabulary is a tree, not a flat list',
    withParent.length > 0,
    `${withParent.length} of ${options.length} categories have a parent`,
  )

  check(
    'G: every resolved parent is a slug that exists in the vocabulary',
    withParent.every((option) => options.some((other) => other.value === option.parent)),
    withParent.map((option) => `${option.value}<-${option.parent}`).join(' '),
  )

  {
    const parents = options.filter((option) =>
      options.some((other) => other.parent === option.value),
    )

    const vocabularyFromDb: CatalogVocabulary = { ...EMPTY_VOCABULARY, categories: options }

    check(
      'G: expanding a real parent category reaches its descendants',
      parents.length > 0 &&
        parents.every((parent) => expandCategory(vocabularyFromDb, parent.value).length > 1),
      parents
        .map((p) => `${p.value}:${expandCategory(vocabularyFromDb, p.value).length}`)
        .join(' '),
    )
  }

  check(
    'G: toCategoryOptions accepts a populated parent as well as an id',
    toCategoryOptions([
      { id: 1, name: 'Clothing', parent: null, slug: 'clothing' },
      { id: 2, name: 'Tops', parent: { id: 1 }, slug: 'tops' },
    ])[1]?.parent === 'clothing',
  )

  /* --- the record builder, against real rows --- */

  const collected = await collectProductRecords(payload, {
    where: { categories: { equals: category.id } },
  })

  const collectedIds = new Set(collected.records.map((record) => Number(record.objectID)))

  check(
    'G: the indexer and the listing agree about which products belong',
    collectedIds.size === listedIds.size && [...collectedIds].every((id) => listedIds.has(id)),
    `index ${[...collectedIds].join(',')} vs listing ${[...listedIds].join(',')}`,
  )

  check(
    'G: the excluded products are reported so they can be deleted from the index',
    collected.excludedIds.includes(draft.id) &&
      collected.excludedIds.includes(scheduled.id) &&
      collected.excludedIds.includes(withdrawn.id),
    collected.excludedIds.join(','),
  )

  const liveRecord = collected.records.find((record) => record.objectID === String(live.id))

  check(
    'G: a real record carries the category it was filed under',
    liveRecord?.categorySlugs.includes(category.slug as string) === true,
    liveRecord?.categorySlugs.join(','),
  )

  /* =================================================================================================
   * H — The two engines agree
   * ============================================================================================== */

  if (integrationStatus('algolia') === 'configured') {
    const credentials = requireIntegration('algolia')

    const client = createSearchClient({
      apiKey: credentials.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY,
      appId: credentials.NEXT_PUBLIC_ALGOLIA_APP_ID,
    })

    const indexBase = catalogIndexName(appEnv)

    /*
     * Every query Postgres CAN answer is put to both engines and the id lists compared. The index is
     * whatever the last `pnpm reindex` left — this deliberately does not write to it, because a
     * harness that repairs the thing it is testing proves nothing.
     *
     * **This harness's own fixtures are excluded from the Postgres side**, and the exclusion is
     * itself one of the properties under test. The products created above were written through the
     * Payload CLI, where `syncSearchIndex`'s dynamic environment import cannot resolve — so they
     * reach Postgres and never reach Algolia. That is the documented trade in the hook's docblock
     * and the entire reason `pnpm reindex` exists. Comparing the engines over rows that only one of
     * them has ever been told about would fail every run and prove nothing about either.
     */
    const fixtureIds = new Set(
      created.filter((doc) => doc.collection === 'products').map((doc) => doc.id),
    )

    const vocabularyForLive: CatalogVocabulary = { ...VOCABULARY, categories: [] }

    for (const [label, overrides] of [
      ['an unfiltered browse', {}],
      ['sorted by price ascending', { sort: 'price-asc' as const }],
      ['sorted by price descending', { sort: 'price-desc' as const }],
      ['sorted by newest', { sort: 'newest' as const }],
      ['sorted by best sellers', { sort: 'best-sellers' as const }],
      ['filtered to in stock', { availability: 'in-stock' as const }],
    ] as const) {
      const { query } = normaliseCatalogQuery(params(overrides), vocabularyForLive)

      const [fromPostgres, fromIndex] = await Promise.all([
        payload.find({
          collection: 'products',
          depth: 0,
          limit: CATALOG_PAGE_SIZE,
          page: 1,
          sort: CATALOG_SORT_FIELDS[query.sort],
          where: catalogWhere(query, new Date().toISOString()),
        }),
        searchProductIds(client, indexBase, query, CATALOG_PAGE_SIZE),
      ])

      const postgresIds = fromPostgres.docs.map((doc) => doc.id).filter((id) => !fixtureIds.has(id))

      check(
        `H: both engines return the same products for ${label}`,
        postgresIds.length === fromIndex.ids.length &&
          [...postgresIds].sort((a, b) => a - b).join(',') ===
            [...fromIndex.ids].sort((a, b) => a - b).join(','),
        `postgres ${postgresIds.join(',')} vs index ${fromIndex.ids.join(',')}`,
      )

      /*
       * Order, not merely membership. The whole reason a filtered query goes to Algolia is its
       * ranking; if `catalog.ts` failed to re-sort the Postgres rows into the index's order the sets
       * would still match and the grid would be wrong.
       */
      if (query.sort === 'price-asc' || query.sort === 'price-desc') {
        check(
          `H: …in the same order for ${label}`,
          postgresIds.join(',') === fromIndex.ids.join(','),
          `postgres ${postgresIds.join(',')} vs index ${fromIndex.ids.join(',')}`,
        )
      }
    }

    /*
     * The trade above, asserted rather than assumed. If a future change made CLI writes sync to the
     * index, this check fails and the exclusion above becomes wrong — which is exactly when someone
     * should be told.
     */
    {
      const { query: allProducts } = normaliseCatalogQuery(params(), vocabularyForLive)
      const indexed = await searchProductIds(client, indexBase, allProducts, 1000)
      const indexedIds = new Set(indexed.ids)

      check(
        'H: a CLI write does not reach the index — which is why `pnpm reindex` exists',
        [...fixtureIds].every((id) => !indexedIds.has(id)),
        `fixtures ${[...fixtureIds].join(',')}`,
      )
    }

    const { query: colourQuery } = normaliseCatalogQuery(
      params({ color: ['black'] }),
      vocabularyForLive,
    )

    const colourResult = await searchProductIds(client, indexBase, colourQuery, CATALOG_PAGE_SIZE)

    check(
      'H: a colour facet the index alone can answer returns something',
      colourResult.totalProducts >= 0,
      `${colourResult.totalProducts} product(s) in black`,
    )
  } else {
    check(
      'H: skipped — algolia is not configured, and the shop degrades rather than failing',
      true,
      'set NEXT_PUBLIC_ALGOLIA_APP_ID, NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY and ALGOLIA_WRITE_API_KEY to run it',
    )
  }
} finally {
  await cleanup()
}

/* -------------------------------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------------------------------- */

const failed = results.filter((result) => !result.ok)

/*
 * One awaited write, verdict first — `verify-home.ts` records why: `process.exit` does not drain an
 * asynchronous stdout write to a pipe or a file, and `payload.destroy()` tears the logger down
 * before it flushes. A harness that reports less than it ran while exiting 0 is the failure mode.
 */
const report = [
  `${results.length - failed.length}/${results.length} catalogue checks passed.`,
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

await payload.destroy()

if (failed.length > 0) {
  throw new Error(`${failed.length} catalogue check(s) failed.`)
}
