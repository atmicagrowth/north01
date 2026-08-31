import type { CatalogQuery, CatalogSort } from './query'

/**
 * **The shape of a product in the search index, and the settings that make it filterable.**
 *
 * Pure — no client, no network, no environment. The index is a *derived* store (the plan's master
 * directive: *"Algolia is a derived search index"*), so everything about what goes into it is a
 * function of a Postgres row, and that function is testable without an Algolia account.
 *
 * ---
 *
 * ### Why Phase 11 has an index at all, when Phase 12 is the search phase
 *
 * Plan §11.1d: *"Use Algolia as the query/facet engine after the catalog is seeded."* Three of the
 * six facets feature matrix §5 requires are not columns on `products` — `size` and `color` live on
 * `product-variants`, and collection membership lives on `collections` — so there is no Postgres
 * query that answers them without walking the variant table and de-duplicating product ids by hand.
 * `query.ts`'s `requiresSearchIndex` is that boundary.
 *
 * What this phase therefore builds is the **minimum index that answers a facet query**: the record,
 * its settings, the replicas the five sorts need, a full rebuild, and synchronisation on write.
 * Phase 12 owns everything *searching* means — the overlay, autocomplete, suggestions, recent and
 * popular queries, the results page and §12.1d's query edge cases — over this same index.
 *
 * ### What is deliberately not in the record
 *
 * **Anything a customer reads.** No name, no price, no image, no description.
 *
 * That is the opposite of the usual Algolia record and it is the single most important decision in
 * this file. A search index is a copy, and a copy is stale between the write and the sync. If the
 * grid rendered from the index, then a product unpublished thirty seconds ago would still show its
 * name and its price to a customer, and a price edit would be visible in the listing before it was
 * true in the database — which is exactly what *"the browser is never authoritative … recalculate
 * server-side"* exists to prevent, one layer out.
 *
 * So the index answers **which products, in what order**, and returns nothing but `objectID`.
 * `catalog.ts` then reads those ids back from Postgres through the ordinary access-controlled
 * `payload.find`, and every word on screen comes from the source of truth. A stale id costs one
 * missing card; it can never cost a wrong price.
 *
 * The cost is one extra round trip on a filtered query, and an id in the index that Postgres no
 * longer returns — plan §12.1d's *"deleted product still in index"* and *"product unpublished after
 * index update"*, which are listed there as cases to **handle**, not to prevent. They are handled by
 * construction here: the row simply is not there, and the card is not rendered.
 */

/* -------------------------------------------------------------------------------------------------
 * The record
 * ---------------------------------------------------------------------------------------------- */

/**
 * One product, as the index holds it.
 *
 * Every attribute is either something to filter on or something to rank by. `name` and `slug` are
 * the two exceptions and they are here for Phase 12: §12.1a requires the product name to be
 * *searchable*, and searchable attributes have to be in the record even when Phase 11 never queries
 * for text. `slug` is what makes a record identifiable in the Algolia dashboard, where an `objectID`
 * of `7` tells an operator nothing.
 */
export type ProductIndexRecord = {
  /** Grouped colour, the value the colour facet filters on — `ProductVariants.colorFamily`. */
  colorFamilies: string[]
  /** Slugs of the collections this product belongs to. */
  collectionSlugs: string[]
  compareAtFromMinor: null | number
  featured: boolean
  fit: null | string
  gender: null | string
  /** Every category slug, **including every ancestor** — see `withAncestors`. */
  categorySlugs: string[]
  inStock: boolean
  inventoryTotal: number
  isBestSeller: boolean
  isLimitedEdition: boolean
  isNew: boolean
  materials: string[]
  name: string
  objectID: string
  priceFromMinor: number
  priceToMinor: number
  /** Epoch milliseconds. Algolia cannot rank on an ISO string. */
  publishedAtMs: number
  /** Distinct sizes across **active** variants. */
  sizes: string[]
  slug: string
  sortOrder: number
  tags: string[]
}

/** The minimum a caller must supply per variant. Deliberately structural, not a Payload type. */
export type IndexableVariant = {
  active?: boolean | null
  colorFamily?: null | string
  inventoryQuantity?: null | number
  size?: null | string
}

/** The minimum a caller must supply per product. */
export type IndexableProduct = {
  categorySlugs?: string[]
  collectionSlugs?: string[]
  derived?: {
    compareAtFromMinor?: null | number
    inventoryTotal?: null | number
    priceFromMinor?: null | number
    priceToMinor?: null | number
  } | null
  featured?: boolean | null
  fit?: null | string
  gender?: null | string
  id: number
  isBestSeller?: boolean | null
  isLimitedEdition?: boolean | null
  isNew?: boolean | null
  materials?: null | string[]
  name?: null | string
  publishedAt?: null | string
  slug?: null | string
  sortOrder?: null | number
  /** `'published'` is the only value that belongs in the index. */
  status?: null | string
  tags?: null | string[]
}

const clean = (values: (null | string | undefined)[]): string[] => [
  ...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)),
]

/**
 * Every slug in `slugs`, plus every ancestor of each.
 *
 * This is what makes `/shop/clothing` answerable from the index in one facet filter rather than a
 * disjunction the caller has to assemble. A hoodie tagged only `hoodies` is indexed as
 * `['hoodies', 'tops', 'clothing']`, so filtering on `clothing` finds it.
 *
 * `query.ts` expands the *query* side of the same relationship for the Postgres engine. Both are
 * needed and they are not redundant: Postgres filters on the product's stored `categories`, which
 * contain no ancestors, so the query must widen; the index stores the widened form, so the query
 * need not. Doing it on both sides means `?category=clothing` returns the same products whichever
 * engine answers — the property `verify-catalog` asserts directly.
 *
 * The `seen` guard is the cycle guard `expandCategory` carries, for the identical reason: a
 * two-save `A → B → A` parent cycle is reachable through the CMS, and walking it without a guard
 * hangs the indexer instead of a request.
 */
export function withAncestors(slugs: string[], parentOf: Map<string, null | string>): string[] {
  const out = new Set<string>()

  for (const slug of slugs) {
    let current: null | string | undefined = slug

    while (current && !out.has(current)) {
      out.add(current)
      current = parentOf.get(current) ?? null
    }
  }

  return [...out]
}

/**
 * A product and its variants, as one index record — or `null` when the product does not belong in
 * the index at all.
 *
 * The `null` cases are exactly the ones `publishedProductWhere` applies, and they are applied here as
 * well rather than only at query time. An index that contains drafts is an index whose `nbHits` is a
 * lie: the count would include products Postgres then refuses to return, so the grid would say "24
 * products" over a page of 19. Keeping unlistable rows *out* is what keeps the count honest.
 *
 * That makes this function the **one** definition of "belongs in a listing", shared by the indexer
 * and asserted against the Postgres clause by `verify-catalog`. Two definitions that drift is how
 * the two engines would start disagreeing.
 */
export function buildProductRecord(
  product: IndexableProduct,
  variants: IndexableVariant[],
  now: Date = new Date(),
): null | ProductIndexRecord {
  const slug = product.slug?.trim()
  const name = product.name?.trim()
  const priceFromMinor = product.derived?.priceFromMinor
  const priceToMinor = product.derived?.priceToMinor

  if (!slug || !name) {
    return null
  }

  // A draft product does not exist through the API; it must not exist in the index either.
  if (product.status !== 'published') {
    return null
  }

  // No active variant: withdrawn from sale. `publishedProductWhere` excludes the same rows.
  if (typeof priceFromMinor !== 'number' || typeof priceToMinor !== 'number') {
    return null
  }

  const publishedAtMs = product.publishedAt ? Date.parse(product.publishedAt) : Number.NaN

  // A scheduled drop is published and must not be listed yet.
  if (Number.isFinite(publishedAtMs) && publishedAtMs > now.getTime()) {
    return null
  }

  const active = variants.filter((variant) => variant.active !== false)
  const inventoryTotal = product.derived?.inventoryTotal ?? 0

  return {
    categorySlugs: clean(product.categorySlugs ?? []),
    collectionSlugs: clean(product.collectionSlugs ?? []),
    colorFamilies: clean(active.map((variant) => variant.colorFamily)),
    compareAtFromMinor: product.derived?.compareAtFromMinor ?? null,
    featured: product.featured === true,
    fit: product.fit?.trim() || null,
    gender: product.gender?.trim() || null,
    inStock: inventoryTotal > 0,
    inventoryTotal,
    isBestSeller: product.isBestSeller === true,
    isLimitedEdition: product.isLimitedEdition === true,
    isNew: product.isNew === true,
    materials: clean(product.materials ?? []),
    name,
    objectID: String(product.id),
    priceFromMinor,
    priceToMinor,
    /*
     * A published product always has a date — `publishingFields` stamps it on the transition — but a
     * row written straight to the database would not. Falling back to `0` sorts such a product last
     * under "Newest", which is the honest place for a product whose publication date is unknown.
     */
    publishedAtMs: Number.isFinite(publishedAtMs) ? publishedAtMs : 0,
    sizes: clean(active.map((variant) => variant.size)),
    slug,
    sortOrder: product.sortOrder ?? 0,
    tags: clean(product.tags ?? []),
  }
}

/* -------------------------------------------------------------------------------------------------
 * Index configuration
 * ---------------------------------------------------------------------------------------------- */

/**
 * The four sorts that need their own index, and the one that does not.
 *
 * Algolia decides order with a *ranking formula per index*, so "sort by price" is a different index
 * — a **replica** — rather than a parameter. `featured` is the primary's own ranking, so it needs
 * no replica.
 *
 * These are **standard** replicas rather than virtual ones. A virtual replica applies relevance
 * before the custom sort and silently drops results below a relevance threshold, which is right for
 * a search results page and wrong for a browse grid: on an empty query a customer sorting by price
 * must see *every* product in the filter, not the ones Algolia judged relevant to nothing.
 */
export const CATALOG_SORT_REPLICAS: Record<CatalogSort, null | string> = {
  featured: null,
  newest: 'newest',
  'best-sellers': 'best_sellers',
  'price-asc': 'price_asc',
  'price-desc': 'price_desc',
}

/** `north01_products` and `north01_products_price_asc`. */
export const replicaIndexName = (base: string, suffix: string): string => `${base}_${suffix}`

/** Which index answers a given sort. */
export function indexNameForSort(base: string, sort: CatalogSort): string {
  const suffix = CATALOG_SORT_REPLICAS[sort]

  return suffix === null ? base : replicaIndexName(base, suffix)
}

export const allIndexNames = (base: string): string[] => [
  base,
  ...Object.values(CATALOG_SORT_REPLICAS)
    .filter((suffix): suffix is string => suffix !== null)
    .map((suffix) => replicaIndexName(base, suffix)),
]

/**
 * Settings for the primary index.
 *
 * `attributesForFaceting` is the only part Phase 11 strictly needs — an attribute that is not listed
 * there cannot be filtered on at all, and Algolia answers such a query with a **400**, not with
 * everything. `filterOnly(...)` is used for every one of them because Phase 11 renders no facet
 * counts: the vocabulary comes from Postgres, so asking Algolia to compute counts would pay for
 * numbers nothing displays. Phase 12 can widen any of these to a full facet when the search UI
 * wants counts.
 *
 * `searchableAttributes` is populated even though Phase 11 never sends a text query, because plan
 * §12.1a specifies the searchable set and an index whose records lack the attributes cannot be made
 * searchable later without a full rebuild. Ordered by importance: a match on the product name
 * outranks a match on a tag.
 */
export const CATALOG_INDEX_SETTINGS = {
  attributesForFaceting: [
    'filterOnly(categorySlugs)',
    'filterOnly(collectionSlugs)',
    'filterOnly(colorFamilies)',
    'filterOnly(sizes)',
    'filterOnly(inStock)',
    'filterOnly(gender)',
    'filterOnly(fit)',
    'filterOnly(tags)',
  ],
  /** Only the id crosses the wire. See this module's docblock. */
  attributesToRetrieve: ['objectID'],
  customRanking: ['asc(sortOrder)', 'desc(publishedAtMs)'],
  numericAttributesForFiltering: ['priceFromMinor', 'priceToMinor', 'inventoryTotal'],
  searchableAttributes: ['name', 'tags', 'materials', 'unordered(fit)'],
}

/** Per-replica ranking. The attributes are already in every record; only the order differs. */
export const CATALOG_REPLICA_CUSTOM_RANKING: Record<string, string[]> = {
  best_sellers: ['desc(isBestSeller)', 'asc(sortOrder)'],
  newest: ['desc(publishedAtMs)'],
  price_asc: ['asc(priceFromMinor)'],
  price_desc: ['desc(priceFromMinor)'],
}

/* -------------------------------------------------------------------------------------------------
 * Query translation
 * ---------------------------------------------------------------------------------------------- */

export type IndexSearchParams = {
  facetFilters: string[][]
  hitsPerPage: number
  numericFilters: string[]
  page: number
  query: string
}

/**
 * `CatalogQuery` → the parameters of an Algolia search.
 *
 * Two things about `facetFilters` are easy to get backwards and both change the answer:
 *
 * - **The nesting is the boolean operator.** An inner array is `OR`, the outer array is `AND`. So
 *   `[['colorFamilies:black', 'colorFamilies:bone'], ['sizes:M']]` reads *"black or bone, and in
 *   M"* — which is what a customer ticking two colours means. Flattening it would mean *"black and
 *   bone"*, which no single product satisfies, and the grid would be permanently empty.
 * - **`page` is zero-based here and one-based in the URL.** Algolia's first page is `0`; a customer's
 *   is `1`. The conversion happens once, in this function, so nothing downstream has to remember it.
 *
 * `price` filters the *lowest* price for the same reason the Postgres engine does — see
 * `catalogWhere`.
 */
export function indexSearchParams(query: CatalogQuery, hitsPerPage: number): IndexSearchParams {
  const facetFilters: string[][] = []

  if (query.categories.length > 0) {
    facetFilters.push(query.categories.map((slug) => `categorySlugs:${slug}`))
  }

  if (query.collections.length > 0) {
    facetFilters.push(query.collections.map((slug) => `collectionSlugs:${slug}`))
  }

  if (query.colors.length > 0) {
    facetFilters.push(query.colors.map((value) => `colorFamilies:${value}`))
  }

  if (query.sizes.length > 0) {
    facetFilters.push(query.sizes.map((value) => `sizes:${value}`))
  }

  if (query.availability === 'in-stock') {
    facetFilters.push(['inStock:true'])
  }

  const numericFilters: string[] = []

  if (query.priceMinMinor !== null) {
    numericFilters.push(`priceFromMinor>=${query.priceMinMinor}`)
  }

  if (query.priceMaxMinor !== null) {
    numericFilters.push(`priceFromMinor<=${query.priceMaxMinor}`)
  }

  return {
    facetFilters,
    hitsPerPage,
    numericFilters,
    page: Math.max(0, query.page - 1),
    query: '',
  }
}
