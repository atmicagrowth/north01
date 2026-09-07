import 'server-only'

import { unstable_cache } from 'next/cache'
import { cache } from 'react'
import type { Payload, Where } from 'payload'

import { appEnv, integrationStatus, serverEnv } from '@/lib/env.server'
import { getPayloadClient } from '@/lib/payload'
import { DEFAULT_CURRENCY, type CurrencyCode } from '@/payload/fields/money'

import {
  catalogIndexName,
  countHitsForTerms,
  createSearchClient,
  searchProductIds,
  searchSuggestionIds,
} from './algolia'
import { COLOR_FAMILY_LABELS, COLOR_FAMILY_OPTIONS } from './colors'
import {
  CATALOG_PAGE_SIZE,
  CATALOG_SORT_FIELDS,
  catalogWhere,
  listableVariantWhere,
  normaliseCatalogQuery,
  publishedProductWhere,
  requiresSearchIndex,
  toCategoryOptions,
  type CatalogParams,
  type CatalogQuery,
  type CatalogVocabulary,
  type FacetOption,
} from './query'
import {
  resolveProductCards,
  type CatalogResult,
  type CatalogView,
  type ProductCard,
} from './resolve'
import {
  SEARCH_FAILURE_HINT,
  SEARCH_SUGGESTION_LIMIT,
  classifySearchFailure,
  correctedTotal,
} from './search'

/**
 * **The reads that build the shop page.**
 *
 * A loader and an engine choice, and nothing else — the same split `lib/home/home.ts` and
 * `lib/navigation/shell.ts` use. Every *rule* lives in `query.ts` and `resolve.ts`, which import
 * nothing from Next and nothing runnable from Payload, so `pnpm verify:catalog` exercises all of
 * them outside a request. What is left here is caching, two engines, and the failure policy.
 *
 * ---
 *
 * ## The engine decision, in full
 *
 * Plan §11.1d says *"use Algolia as the query/facet engine"*; plan §0 says Postgres is the source of
 * truth; plan §A.5 says that when Algolia is unavailable *"catalog remains usable through curated
 * category navigation"*. All three are satisfied by asking a narrower question than "which engine
 * runs the shop": **which engine can answer *this* query.**
 *
 * `requiresSearchIndex` is that predicate and it is not a preference — it is a fact about the
 * schema. Three of feature matrix §5's six facets are not columns on `products`:
 *
 * | Facet | Lives on | Engine |
 * |---|---|---|
 * | Category | `products.categories` (indexed relationship) | Postgres |
 * | Price | `products.derived.priceFromMinor` (indexed) | Postgres |
 * | Availability | `products.derived.inventoryTotal` (indexed) | Postgres |
 * | **Size** | `product-variants.size` — reached through a Payload `join`, which has no column | **Algolia** |
 * | **Colour** | `product-variants.colorFamily` — same | **Algolia** |
 * | **Collection** | `collections.products` — membership is owned by the list | **Algolia** |
 *
 * A Postgres answer to *"products with an active Black variant in M"* means querying the variant
 * table, collecting distinct product ids and paginating over that set — the *"expensive full-catalog
 * scan on every request"* §11.1d forbids by name. Algolia does it in one call because the record is
 * flattened.
 *
 * The consequence is the good one: **an Algolia outage cannot take the shop down.** `/shop`,
 * `/shop/<category>`, every sort, the price filter and the in-stock filter are all Postgres, so they
 * keep working exactly as before. Only the three variant-and-membership facets degrade, and they
 * degrade into §11.1d's stated fallback — a controlled state offering category navigation, not an
 * empty grid implying the shop has nothing.
 *
 * ## Algolia returns ids; Postgres returns products
 *
 * `record.ts` argues this at length. The index answers *which products and in what order*; every
 * word the customer reads is then fetched from Postgres through the ordinary access-controlled
 * `find`. A stale index costs a missing card and can never cost a wrong price, a draft product, or a
 * garment that was deleted an hour ago.
 *
 * It also means **one** card resolver for both engines. Two rendering paths is how the filtered and
 * unfiltered grids would start disagreeing about what a sale looks like.
 *
 * ## What is cached and what is not
 *
 * The **vocabulary** is cached (`unstable_cache`, tag `catalog`, 300s): it is one small answer shared
 * by every visitor, it changes only when an editor changes the taxonomy, and
 * `payload/hooks/revalidateTags.ts` invalidates it on a product, category or collection save.
 *
 * The **listing is not cached**, and that is deliberate rather than an omission. It is a function of
 * nine URL parameters, so a data-cache entry per distinct query would be an unbounded key space
 * filled almost entirely with entries nobody reads twice — and `?page=`, `?sort=` and five facets is
 * a combinatorial number of keys, not a handful. The query is a single indexed round trip against
 * columns chosen for it. Phase 30 owns performance polish and is where measurement, rather than
 * intuition, decides whether this needs more.
 */

/* -------------------------------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------------------------- */

export const CATALOG_CACHE_TAG = 'catalog'

export type CatalogSettings = {
  currency: CurrencyCode
  locale: string
  lowStockThreshold: number
  /**
   * The shipping and returns prose, for Phase 13's *Shipping & Returns* accordion.
   *
   * Read here rather than by the product page because `SiteSettings.ts` is explicit that these are
   * **one policy with one source** — gap **G-08** already records that the dedicated `/help/*` pages
   * must render these same fields rather than a second copy. A page that fetched them itself would
   * be the first of those copies.
   */
  returnsPolicy: unknown
  shippingPolicy: unknown
}

const DEFAULT_SETTINGS: CatalogSettings = {
  currency: DEFAULT_CURRENCY,
  locale: 'en-US',
  lowStockThreshold: 5,
  returnsPolicy: null,
  shippingPolicy: null,
}

/**
 * Site settings, with a literal fallback for every value.
 *
 * Losing this read must cost the currency format, not the storefront — the same posture
 * `lib/home/home.ts` takes, and for the same reason: `ARCHITECTURE.md` §2 requires an unavailable
 * optional dependency to degrade rather than stop the shop. The `lowStockThreshold` fallback of 5
 * is the field's own `defaultValue`.
 */
async function readSettings(payload: Payload): Promise<CatalogSettings> {
  const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 }).catch((error) => {
    console.error('[catalog] Site settings could not be read; using defaults.', error)

    return null
  })

  if (!settings) {
    return DEFAULT_SETTINGS
  }

  return {
    currency: (settings.defaultCurrency ?? DEFAULT_CURRENCY) as CurrencyCode,
    locale: settings.defaultLocale?.trim() || DEFAULT_SETTINGS.locale,
    lowStockThreshold:
      typeof settings.lowStockThreshold === 'number' && settings.lowStockThreshold >= 1
        ? settings.lowStockThreshold
        : DEFAULT_SETTINGS.lowStockThreshold,
    returnsPolicy: settings.returnsPolicy ?? null,
    shippingPolicy: settings.shippingPolicy ?? null,
  }
}

/* -------------------------------------------------------------------------------------------------
 * Vocabulary
 * ---------------------------------------------------------------------------------------------- */

/**
 * **Sizes are sorted by the merchandiser's number, not by the alphabet.**
 *
 * `ProductVariants.sizeSortOrder` exists precisely because *"alphabetically, L comes before M and
 * both come before S, which is how a size selector ends up reading L / M / S / XL."* A filter panel
 * has the identical problem, so it takes the identical answer: each distinct size is ranked by the
 * **lowest** `sizeSortOrder` any variant gives it, so one mis-keyed row cannot push XS to the end of
 * the list.
 */
function sizeOptions(
  variants: { size?: null | string; sizeSortOrder?: null | number }[],
): FacetOption[] {
  const ranks = new Map<string, number>()

  for (const variant of variants) {
    const size = variant.size?.trim()

    if (!size) {
      continue
    }

    const rank = typeof variant.sizeSortOrder === 'number' ? variant.sizeSortOrder : 0
    const existing = ranks.get(size)

    ranks.set(size, existing === undefined ? rank : Math.min(existing, rank))
  }

  return [...ranks.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([size]) => ({ label: size, value: size }))
}

/**
 * Everything the shop can be filtered by, as it exists right now.
 *
 * Two properties are load-bearing and neither is obvious:
 *
 * **Only stocked values are offered.** The colour list is the intersection of the schema's eleven
 * families with the families the catalogue actually carries, and the size list is whatever is on an
 * active variant. A facet that can only ever return nothing is worse than a missing facet: the
 * customer ticks it, the grid empties, and nothing on screen explains that no such garment exists.
 *
 * **The vocabulary is read from Postgres even when Algolia answers the query.** Algolia could
 * compute facet counts, and this deliberately does not ask it to — see `CATALOG_INDEX_SETTINGS`,
 * where every attribute is `filterOnly`. Two reasons: the panel shows no counts, so they would be
 * numbers nothing renders; and the panel must look identical whichever engine answered, including
 * when Algolia is down and the panel is the only thing still standing.
 */
const loadVocabulary = unstable_cache(
  async (): Promise<CatalogVocabulary> => {
    const payload = await getPayloadClient()
    const now = new Date().toISOString()

    const publishedProducts: Where = { and: publishedProductWhere(now) }

    const [categories, collections, variants, cheapest, dearest] = await Promise.all([
      payload.find({
        collection: 'categories',
        depth: 0,
        limit: 0,
        pagination: false,
        sort: ['sortOrder', 'name'],
        where: { status: { equals: 'published' } },
      }),
      payload.find({
        collection: 'collections',
        depth: 0,
        limit: 0,
        pagination: false,
        sort: ['sortOrder', 'title'],
        where: { status: { equals: 'published' } },
      }),
      /*
       * Every active variant, for the size and colour vocabularies. Two columns and a filter on an
       * indexed boolean; the result is cached for five minutes and shared by every visitor.
       */
      /*
       * Every active variant **of a listable product**, for the size and colour vocabularies.
       *
       * `active: true` alone was not enough, and the gap was measurable: a draft product carrying a
       * size nothing published stocks put that size in the filter panel, where ticking it returned
       * zero products with nothing on screen explaining why. Verified with a draft product sized
       * `AUDIT-ONLY` — offered by the panel, 0 results.
       *
       * That contradicted this function's own docblock, which claims only stocked values are
       * offered *because* "a facet that can only ever return nothing is worse than a missing facet".
       * The three clauses below are `publishedProductWhere`'s, reached through the `product.` join
       * — the same dotted path `access/publishedOn` resolves, so the vocabulary and the listing now
       * agree on what "listable" means instead of each deciding separately.
       */
      payload.find({
        collection: 'product-variants',
        depth: 0,
        limit: 0,
        pagination: false,
        select: { colorFamily: true, size: true, sizeSortOrder: true },
        where: listableVariantWhere(now),
      }),
      payload.find({
        collection: 'products',
        depth: 0,
        limit: 1,
        select: { derived: true },
        sort: 'derived.priceFromMinor',
        where: publishedProducts,
      }),
      payload.find({
        collection: 'products',
        depth: 0,
        limit: 1,
        select: { derived: true },
        sort: '-derived.priceFromMinor',
        where: publishedProducts,
      }),
    ])

    const stockedFamilies = new Set<string>(
      variants.docs
        .map((variant) => variant.colorFamily)
        .filter((family) => typeof family === 'string'),
    )

    return {
      /*
       * Shaped by `toCategoryOptions`, which resolves `parent` from an id to a slug. That rule lives
       * in the pure module deliberately: reading `doc.parent` as a document here — which it is not at
       * `depth: 0` — flattened the whole taxonomy, and only a check against real documents could have
       * caught it. See that function's docblock.
       */
      categories: toCategoryOptions(categories.docs),
      collections: collections.docs
        .filter((doc) => typeof doc.slug === 'string' && doc.slug !== '')
        .map((doc) => ({ label: doc.title ?? (doc.slug as string), value: doc.slug as string })),
      colors: COLOR_FAMILY_OPTIONS.filter((option) => stockedFamilies.has(option.value)).map(
        (option) => ({
          label: COLOR_FAMILY_LABELS[option.value] ?? option.value,
          value: option.value,
        }),
      ),
      priceCeilingMinor: dearest.docs[0]?.derived?.priceToMinor ?? null,
      priceFloorMinor: cheapest.docs[0]?.derived?.priceFromMinor ?? null,
      sizes: sizeOptions(variants.docs),
    }
  },
  ['north01-catalog-vocabulary'],
  { revalidate: 300, tags: [CATALOG_CACHE_TAG] },
)

/**
 * The vocabulary, or an empty one.
 *
 * Unlike `getHome`, a failure here **does not** fail the render, and the asymmetry is deliberate.
 * The homepage *is* its content, so an empty one is a broken page and must not be cached in place of
 * a good one. The shop's vocabulary is only its controls: losing it means the filter panel has
 * nothing to offer, which is a degraded page rather than a wrong one — and the grid beneath it still
 * lists the catalogue, which is what the customer came for.
 */
const getVocabulary = cache(async (): Promise<CatalogVocabulary> => {
  try {
    return await loadVocabulary()
  } catch (error) {
    console.error('[catalog] The filter vocabulary could not be read; offering no filters.', error)

    return {
      categories: [],
      collections: [],
      colors: [],
      priceCeilingMinor: null,
      priceFloorMinor: null,
      sizes: [],
    }
  }
})

/* -------------------------------------------------------------------------------------------------
 * Engines
 * ---------------------------------------------------------------------------------------------- */

/** One hop is enough: `gallery[].image` is the only relationship a card reads. */
const CARD_DEPTH = 1

/**
 * **Both engines read as an anonymous visitor, and they must read identically.**
 *
 * `payload.find` defaults to `overrideAccess: true` in the Local API, so D-37's phrase *"the ordinary
 * access-controlled `payload.find`"* was aspirational rather than true: the read was bypassing
 * `Products.publishedOnly` and relying entirely on `publishedProductWhere` to filter drafts.
 *
 * That produced the right answer, because the explicit clause is correct — but it meant one
 * forgotten clause in a refactor would leak a draft rather than being caught by the access layer. It
 * is spread into both engines from one constant so the two can never answer under different rules,
 * which `verify:search` asserts directly.
 */
const STOREFRONT_ACCESS = { overrideAccess: false, user: null } as const

/** The one shape an unreachable engine produces. Never `empty` -- see `searchState`. */
const UNAVAILABLE_RESULT = (page: number): CatalogResult => ({
  engine: 'unavailable',
  exhaustive: true,
  page,
  products: [],
  stale: false,
  totalPages: 0,
  totalProducts: 0,
})

async function runPostgres(
  payload: Payload,
  query: CatalogQuery,
  settings: CatalogSettings,
): Promise<CatalogResult> {
  const now = new Date().toISOString()

  const result = await payload.find({
    collection: 'products',
    depth: CARD_DEPTH,
    limit: CATALOG_PAGE_SIZE,
    page: query.page,
    sort: CATALOG_SORT_FIELDS[query.sort],
    ...STOREFRONT_ACCESS,
    where: catalogWhere(query, now),
  })

  return {
    engine: 'postgres',
    exhaustive: true,
    page: result.page ?? query.page,
    products: resolveProductCards(
      result.docs,
      settings.currency,
      settings.locale,
      settings.lowStockThreshold,
    ),
    stale: false,
    totalPages: result.totalPages ?? 0,
    totalProducts: result.totalDocs ?? 0,
  }
}

/**
 * **Ids from the index, products from Postgres.** The one path from an id to a card.
 *
 * Both the results grid and the typeahead call this, so there is literally one implementation of
 * D-37's contract rather than two that can drift. It is also what makes §12.1d's *"deleted product
 * still in index"* and *"product unpublished after index update"* structural rather than handled:
 * the row is simply not returned, and no card is built.
 *
 * The re-sort at the end is not optional. `payload.find` with an `id IN (…)` clause returns rows in
 * *its* order, not the order the ids were given, so without it the index's ranking — the entire
 * reason the query went to Algolia — would be discarded and the grid would come back in
 * `-createdAt` order under every sort.
 */
async function rehydrateProductIds(
  payload: Payload,
  ids: number[],
  settings: CatalogSettings,
): Promise<ProductCard[]> {
  if (ids.length === 0) {
    return []
  }

  const now = new Date().toISOString()

  const result = await payload.find({
    collection: 'products',
    depth: CARD_DEPTH,
    limit: ids.length,
    pagination: false,
    ...STOREFRONT_ACCESS,
    where: { and: [...publishedProductWhere(now), { id: { in: ids } }] },
  })

  const byId = new Map(result.docs.map((doc) => [doc.id, doc]))

  return resolveProductCards(
    ids.map((id) => byId.get(id)).filter((doc) => doc !== undefined),
    settings.currency,
    settings.locale,
    settings.lowStockThreshold,
  )
}

/**
 * Ask the index which products, then ask Postgres what they are.
 *
 * The re-sort at the end is not optional. `payload.find` with an `id IN (…)` clause returns rows in
 * *its* order, not in the order the ids were given, so without this the index's ranking — which is
 * the entire reason the query went to Algolia — would be discarded and the grid would come back in
 * `-createdAt` order under every sort.
 *
 * The count comes from Algolia while the rows come from Postgres, so a stale index can make them
 * disagree by the number of products unpublished since the last sync. That is plan §12.1d's
 * *"deleted product still in index"* landing exactly where it should: a card fewer, never a wrong
 * one, self-healing on the next write to that product.
 */
async function runSearch(
  payload: Payload,
  query: CatalogQuery,
  settings: CatalogSettings,
): Promise<CatalogResult> {
  const client = createSearchClient({
    apiKey: serverEnv.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY as string,
    appId: serverEnv.NEXT_PUBLIC_ALGOLIA_APP_ID as string,
  })

  const { exhaustive, ids, totalPages, totalProducts } = await searchProductIds(
    client,
    catalogIndexName(appEnv),
    query,
    CATALOG_PAGE_SIZE,
  )

  const products = await rehydrateProductIds(payload, ids, settings)

  return {
    engine: 'search',
    exhaustive,
    page: query.page,
    products,
    /*
     * The engine found something and Postgres refused all of it. That is a *stale* answer, not an
     * empty one, and `searchState` ranks it above `empty` so the customer is told the pieces have
     * just gone rather than that nothing matched.
     */
    stale: ids.length > 0 && products.length === 0,
    totalPages,
    totalProducts: correctedTotal(totalProducts, ids.length, products.length),
  }
}

/* -------------------------------------------------------------------------------------------------
 * The loader
 * ---------------------------------------------------------------------------------------------- */

/**
 * One page of the shop, with the filters that produced it and the vocabulary to change them.
 *
 * `routeCategory` is the `<slug>` of `/shop/<slug>` — already known to exist, because the route
 * resolves it and 404s first.
 *
 * ### Failure, at three scales
 *
 * - **The vocabulary** — swallowed. The panel loses its options; the grid still lists products.
 * - **The search index** — caught here and turned into `engine: 'unavailable'`, which is plan
 *   §11.1d's *"graceful error state and a Browse categories fallback"*. It is emphatically **not**
 *   an empty result: telling a customer "nothing matches your filters" during an outage blames their
 *   taste for the service being down.
 * - **Postgres** — allowed to throw. It is the source of truth; there is no honest page without it,
 *   and `global-error` is a better answer than a shop that silently claims to be empty.
 */
export const getCatalog = cache(
  async (params: CatalogParams, routeCategory: null | string = null): Promise<CatalogView> => {
    const payload = await getPayloadClient()
    const [vocabulary, settings] = await Promise.all([getVocabulary(), getCatalogSettings()])

    const { ignored, query } = normaliseCatalogQuery(params, vocabulary, routeCategory)

    if (!requiresSearchIndex(query)) {
      return { ignored, query, result: await runPostgres(payload, query, settings), vocabulary }
    }

    if (integrationStatus('algolia') !== 'configured') {
      return {
        ignored,
        query,
        result: UNAVAILABLE_RESULT(query.page),
        vocabulary,
      }
    }

    try {
      return { ignored, query, result: await runSearch(payload, query, settings), vocabulary }
    } catch (error) {
      /*
       * Logged rather than merely swallowed. An outage and a genuinely empty result look identical
       * on screen and could not be more different to an operator — the same argument
       * `lib/navigation/shell.ts` makes for logging a degraded shell.
       */
      console.error(
        '[catalog] The search index could not be queried; degrading the filters.',
        error,
      )

      return {
        ignored,
        query,
        result: UNAVAILABLE_RESULT(query.page),
        vocabulary,
      }
    }
  },
)

/**
 * The formatter the chips and the price facet need, bound to the site's currency and locale.
 *
 * **`cache()` wraps the read itself, not each caller.** `getCatalog` and this export both need the
 * settings, and each used to call the un-memoised `readSettings` — two `findGlobal('site-settings')`
 * round trips on every shop render, for one small document that cannot change between them. React's
 * `cache` is per-render, so hoisting it here makes the second caller free and keeps the two callers
 * looking at literally the same object.
 */
export const getCatalogSettings = cache(async (): Promise<CatalogSettings> => {
  const payload = await getPayloadClient()

  return readSettings(payload)
})

/**
 * The filter vocabulary on its own, for the panel.
 *
 * The panel renders *outside* the results' `<Suspense>` boundary — a customer changing a filter must
 * keep looking at the controls they are using, not at a skeleton of them — so it needs the
 * vocabulary before the listing has resolved. `cache()` makes this and the `getCatalog` call that
 * follows it one read rather than two.
 */
export const getCatalogVocabulary = cache(async (): Promise<CatalogVocabulary> => getVocabulary())

export type ShopCategory = {
  description: null | string
  name: string
  slug: string
}

/**
 * A published category by slug, or `null`.
 *
 * `null` is the route's 404. That distinction matters more than it looks: an **unknown category in
 * the path** is a page that does not exist, while an unknown category in `?category=` is plan
 * §11.1d's *"URL contains unknown category"* — a bad filter on a page that does exist, which
 * `normaliseCatalogQuery` drops and reports. Same bad slug, two different right answers, decided by
 * where it appeared.
 *
 * The read goes through the ordinary access rules rather than `overrideAccess`, so a draft category
 * is absent rather than forbidden and the route 404s for an anonymous visitor exactly as
 * `publishedOnly` intends.
 */
export const getShopCategory = cache(async (slug: string): Promise<ShopCategory | null> => {
  const payload = await getPayloadClient()

  try {
    const { docs } = await payload.find({
      collection: 'categories',
      depth: 0,
      limit: 1,
      where: { and: [{ slug: { equals: slug } }, { status: { equals: 'published' } }] },
    })

    const doc = docs[0]

    if (!doc?.slug || !doc.name) {
      return null
    }

    return {
      description: doc.description?.trim() || null,
      name: doc.name,
      slug: doc.slug,
    }
  } catch (error) {
    /*
     * Rethrown, not swallowed. A category page whose read failed is not a missing category, and
     * turning a database outage into a 404 would tell a customer — and a crawler — that a page which
     * exists has been deleted.
     */
    console.error(`[catalog] The category "${slug}" could not be read.`, error)

    throw error
  }
})

/* -------------------------------------------------------------------------------------------------
 * Search
 * ---------------------------------------------------------------------------------------------- */

export type SearchSuggestions = {
  engine: 'search' | 'unavailable'
  products: ProductCard[]
}

/** The credentials both read paths use. The search key, never the write key. */
const searchCredentials = () => ({
  apiKey: serverEnv.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY as string,
  appId: serverEnv.NEXT_PUBLIC_ALGOLIA_APP_ID as string,
})

/**
 * Product suggestions for the typeahead.
 *
 * Ids from the index, products from Postgres, through the **same** `rehydrateProductIds` the results
 * grid uses -- so a suggestion row and a result card can never disagree about a price, and a product
 * unpublished a second ago cannot appear in either.
 *
 * **Deliberately not cached.** This module already refuses to cache the listing because it is a
 * function of nine parameters; a free-text term keyed by unauthenticated input is worse on every
 * axis, and with a trailing debounce every settled prefix of every word anybody types would become
 * its own durable cache entry. The debounce, the two-character floor and the six-hit cap are what
 * bound this path.
 *
 * Returns `engine: 'unavailable'` rather than throwing, because the panel keeps working without it:
 * categories, collections, recent and popular searches all come from Postgres.
 */
export const getSearchSuggestions = cache(async (term: string): Promise<SearchSuggestions> => {
  if (integrationStatus('algolia') !== 'configured') {
    return { engine: 'unavailable', products: [] }
  }

  try {
    const payload = await getPayloadClient()
    const settings = await getCatalogSettings()

    const ids = await searchSuggestionIds(
      createSearchClient(searchCredentials()),
      catalogIndexName(appEnv),
      term,
      SEARCH_SUGGESTION_LIMIT,
    )

    return { engine: 'search', products: await rehydrateProductIds(payload, ids, settings) }
  } catch (error) {
    const failure = classifySearchFailure(error)

    console.error(
      `[catalog] Suggestions could not be read (${failure}). ` + SEARCH_FAILURE_HINT[failure],
      error,
    )

    return { engine: 'unavailable', products: [] }
  }
})

/**
 * **Popular searches -- curated by an editor, validated against the index.**
 *
 * Decision **D-38**. The terms come from `site-settings`, not from analytics, and the reasoning is in
 * the notes; the short version is that the measured analytics corpus for this application has the
 * empty string as its top search by a factor of eighteen, because every faceted `/shop` request sent
 * `query: ''` with Algolia's `analytics` parameter defaulting on.
 *
 * **Every term is checked before it is offered.** A curated search that returns nothing is a link to
 * the no-results page, which is plan section 0.1.17's fake control wearing official provenance. One
 * batched multi-query validates the whole list in a single round trip, and any term with no hits is
 * dropped.
 *
 * Cached under **`site-settings`**, not `catalog` -- that is the tag `SiteSettings.afterChange`
 * actually revalidates. Caching it under `catalog` would mean an editor's save invalidated nothing
 * that reads it, while every unrelated product save flushed it constantly.
 *
 * Fails open to an empty list, and an empty list means the section is **absent** rather than empty.
 */
export const getPopularSearches = cache(async (): Promise<string[]> => {
  try {
    return await loadPopularSearches()
  } catch (error) {
    console.error('[catalog] Popular searches could not be read; omitting the section.', error)

    return []
  }
})

const loadPopularSearches = unstable_cache(
  async (): Promise<string[]> => {
    const payload = await getPayloadClient()

    const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 }).catch(() => null)

    const terms = (settings?.search?.popularSearches ?? [])
      .map((row) => (typeof row === 'object' && row !== null ? row.term : null))
      .filter((term): term is string => typeof term === 'string' && term.trim() !== '')
      .map((term) => term.trim())

    if (terms.length === 0) {
      return []
    }

    if (integrationStatus('algolia') !== 'configured') {
      /*
       * **Unvalidated, but still offered.** §A.5 requires the catalogue to stay navigable when the
       * search service is not, and during an outage a popular search leads to the *designed*
       * search-unavailable state rather than to a dead end — so withholding the section would remove
       * navigation to avoid a page that already explains itself.
       *
       * Validation exists for the NORMAL case, where a curated term that has stopped matching would
       * lead to a real no-results page with no explanation. That is the fake control §0.1.17 forbids;
       * an honest outage notice is not.
       */
      return terms
    }

    try {
      const counts = await countHitsForTerms(
        createSearchClient(searchCredentials()),
        catalogIndexName(appEnv),
        terms,
      )

      return terms.filter((term) => (counts.get(term) ?? 0) > 0)
    } catch (error) {
      console.error('[catalog] Popular searches could not be validated; omitting them.', error)

      return []
    }
  },
  ['north01-popular-searches'],
  { revalidate: 300, tags: ['site-settings'] },
)

/**
 * A short curated row for the no-results and unavailable states.
 *
 * Structure section 12 asks a no-results state to *"offer popular/curated products when available"*,
 * and feature matrix section 2 repeats it. **Postgres only** -- this renders on the exact screens
 * where the index has just failed, so reaching for the index to populate it would guarantee it is
 * missing precisely when it is needed.
 */
export const getCuratedProducts = cache(async (limit = 4): Promise<ProductCard[]> => {
  try {
    const payload = await getPayloadClient()
    const settings = await getCatalogSettings()
    const now = new Date().toISOString()

    const read = async (where: Where) => {
      const result = await payload.find({
        collection: 'products',
        depth: CARD_DEPTH,
        limit,
        sort: ['sortOrder', '-publishedAt', 'slug'],
        ...STOREFRONT_ACCESS,
        where,
      })

      return resolveProductCards(
        result.docs,
        settings.currency,
        settings.locale,
        settings.lowStockThreshold,
      )
    }

    const featured = await read({
      and: [...publishedProductWhere(now), { featured: { equals: true } }],
    })

    if (featured.length > 0) {
      return featured
    }

    /* Nothing is flagged featured -- fall back to the merchandiser's curated order rather than none. */
    return await read({ and: publishedProductWhere(now) })
  } catch (error) {
    console.error('[catalog] Curated products could not be read; omitting them.', error)

    return []
  }
})
