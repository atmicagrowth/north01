import {
  createSerializer,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs/server'
import type { Where } from 'payload'

import { normaliseSearchTerm } from './search'

/**
 * **A URL, turned into a question the catalogue can answer.**
 *
 * Pure. This module imports nothing from Next, nothing from Payload that survives compilation
 * (`Where` is a type and TypeScript erases it), and nothing marked `server-only` — the same
 * separation `lib/home/resolve.ts` keeps, and for the same reason: `pnpm verify:catalog` exercises
 * every rule in here as a function, with no browser and no database. Plan §11.1d's six edge cases
 * are six fixtures rather than six things somebody remembered to click.
 *
 * It is also the *shared* half of the two engines. `catalog.ts` picks between Postgres and Algolia
 * at request time; both are handed the same `CatalogQuery` produced here, which is what stops the
 * two paths quietly disagreeing about what `?color=black&sort=price-asc` means.
 *
 * ---
 *
 * ### Why the nuqs parsers live here and not in the components
 *
 * Plan §11.1d requires URL parameters *"through nuqs"*, and the trap with URL state is that the
 * server and the client end up with two parsers. The server component reads `searchParams`; the
 * filter panel writes through `useQueryStates`. If those disagree by one character — a different
 * separator, a different default, a different clamp — the page renders one thing and the controls
 * claim another.
 *
 * So there is exactly one parser map, `CATALOG_PARSERS`, and both sides import it. `nuqs/server` is
 * the import rather than `nuqs` because the main entry carries `'use client'`; the `/server` entry
 * is plain isomorphic code and is safe on both sides of the boundary.
 *
 * ### Parsing is not validation, and the difference is the whole edge-case list
 *
 * `CATALOG_PARSERS` turns text into shapes. `normaliseCatalogQuery` turns shapes into a question
 * that is answerable — and that second step is where feature matrix §5's *"invalid filter values
 * are ignored safely"* actually happens. It needs the catalogue's own vocabulary (which categories
 * exist, which sizes are stocked), so it cannot be a parser, which sees only a string.
 *
 * Everything it drops is **reported** rather than silently discarded. A filter that vanishes with no
 * explanation is worse than one that returns nothing: the customer sees a grid that does not match
 * the URL they were sent, and no way to tell which half is lying.
 */

/* -------------------------------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------------------------------- */

/**
 * Twenty-four per page.
 *
 * Divisible by 2, 3 and 4, which are the column counts the grid uses, so the last row is never a
 * ragged remainder at any breakpoint. Small enough that the first screen is not a megabyte of
 * photography; large enough that a ten-product demo catalogue is one page.
 */
export const CATALOG_PAGE_SIZE = 24

/**
 * A hard ceiling on `?page=`, checked *before* the query runs.
 *
 * Without it, `?page=99999999` is an `OFFSET 2399999976` — a request that costs the database real
 * work in order to return nothing. Postgres walks the offset even when the result is empty. Anything
 * past the last real page renders the same empty state either way, so the clamp costs nothing a
 * customer can observe.
 */
export const CATALOG_MAX_PAGE = 500

/**
 * The sorts, and the deliberate absence of a sixth.
 *
 * Plan §11.1e: *"Keep sort options intentionally limited."* Feature matrix §5 lists six, and
 * **Rating is not among these five** — it is qualified in the matrix itself as *"where enough real
 * review data exists"*, and reviews are **Phase 21**. A rating sort today would order every product
 * by the same absent number, which is a control that does nothing.
 *
 * `best-sellers` deserves its own note, because it is the one whose name promises more than the data
 * currently holds. There is no order history until **Phase 18**, so this orders by the
 * `isBestSeller` merchandising flag — the merchandiser's own declaration of what sells — and then by
 * curated order. That is a real, editorially owned answer rather than a fabricated metric, and Phase
 * 18 is where it can become a measured one.
 */
export const CATALOG_SORTS = [
  'featured',
  'newest',
  'best-sellers',
  'price-asc',
  'price-desc',
] as const

export type CatalogSort = (typeof CATALOG_SORTS)[number]

export const CATALOG_SORT_LABELS: Record<CatalogSort, string> = {
  featured: 'Featured',
  newest: 'Newest',
  'best-sellers': 'Best sellers',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
}

export const DEFAULT_CATALOG_SORT: CatalogSort = 'featured'

/**
 * The one availability filter.
 *
 * Feature matrix §5 lists availability as a facet; there is only one useful side of it. Nobody
 * filters a shop down to the things they cannot buy, and offering "Sold out" as a tick box would be
 * a control whose only purpose is to empty the grid.
 */
export const CATALOG_AVAILABILITY = ['in-stock'] as const

export type CatalogAvailability = (typeof CATALOG_AVAILABILITY)[number]

/* -------------------------------------------------------------------------------------------------
 * Parsers
 * ---------------------------------------------------------------------------------------------- */

/**
 * The URL contract, in one object.
 *
 * Multi-value facets are comma-separated (`?color=black,bone`) rather than repeated keys
 * (`?color=black&color=bone`). Both are legal; the comma form is chosen because plan §11.1d's own
 * example URL is `/shop?category=hoodies&color=black&size=m&sort=newest` — flat, readable, and short
 * enough to paste into a message, which is what feature matrix §5's *"URL is shareable"* is actually
 * asking for. No facet value in this schema can contain a comma: category and collection slugs are
 * `[a-z0-9-]`, colour families are a fixed enum, and sizes are trimmed, upper-cased text where a
 * comma would be a data-entry error rather than a size.
 *
 * `priceMin` / `priceMax` are in **major units** — the whole number a customer types — and are
 * converted to the minor units decision **D-20** stores. A URL carrying `24000` for "$240" would be
 * unreadable, which defeats the point of putting it in the URL at all.
 */
export const CATALOG_PARSERS = {
  /**
   * The search term.
   *
   * It joins **this** map rather than getting one of its own, and that single decision is what makes
   * `/search` inherit URL preservation, canonicalisation, the filter chips, pagination and
   * Back/Forward instead of rebuilding all five. Feature matrix §2 requires that a full results page
   * keep "query preserved in URL, filters and sorting preserved in URL" — which is exactly what one
   * shared parser map already guarantees for every other parameter.
   */
  q: parseAsString,
  category: parseAsArrayOf(parseAsString, ',').withDefault([]),
  collection: parseAsArrayOf(parseAsString, ',').withDefault([]),
  color: parseAsArrayOf(parseAsString, ',').withDefault([]),
  size: parseAsArrayOf(parseAsString, ',').withDefault([]),
  availability: parseAsStringLiteral(CATALOG_AVAILABILITY),
  priceMin: parseAsInteger,
  priceMax: parseAsInteger,
  sort: parseAsStringLiteral(CATALOG_SORTS).withDefault(DEFAULT_CATALOG_SORT),
  page: parseAsInteger.withDefault(1),
}

/**
 * Build a catalogue URL — used by pagination, the empty state's escape hatches and the active-filter
 * chips.
 *
 * `createSerializer` is the mirror of the loader: it omits any value equal to its parser's default,
 * so `/shop` stays `/shop` rather than becoming
 * `/shop?category=&collection=&color=&size=&sort=featured&page=1`. That matters beyond tidiness —
 * feature matrix §5 requires a *shareable* URL, and a canonical one is also the difference between
 * one page in a crawler's index and several that are the same page.
 *
 * **Pagination is built from this rather than from nuqs hooks**, and deliberately so: page links are
 * real `<a href>`s that work with JavaScript disabled, can be opened in a new tab, and are followed
 * by a crawler. The filter controls are the opposite case — they mutate state a customer is actively
 * adjusting — and those use `useQueryStates`.
 */
const serializeCatalog = createSerializer(CATALOG_PARSERS)

/**
 * `null` is meaningful here and is not the same as omitting a key.
 *
 * Omitting `page` leaves whatever the spread carried; passing `page: null` **clears** it, and the
 * serializer then drops the parameter from the URL entirely. That is how a filter chip removes one
 * value while preserving the rest of the query, and how every facet write resets pagination without
 * writing a redundant `page=1`.
 */
export type CatalogHrefValues = Partial<{
  [K in keyof CatalogParams]: CatalogParams[K] | null
}>

export function catalogHref(basePath: string, values: CatalogHrefValues): string {
  return serializeCatalog(basePath, values)
}

/** What `CATALOG_PARSERS` produces. Shapes, not yet answers — see `normaliseCatalogQuery`. */
export type CatalogParams = {
  availability: CatalogAvailability | null
  /** The raw search term as it arrived. `normaliseCatalogQuery` is what cleans it. */
  q: null | string
  category: string[]
  collection: string[]
  color: string[]
  page: number
  priceMax: null | number
  priceMin: null | number
  size: string[]
  sort: CatalogSort
}

/* -------------------------------------------------------------------------------------------------
 * Vocabulary
 * ---------------------------------------------------------------------------------------------- */

/** One selectable value in a facet group. */
export type FacetOption = {
  label: string
  value: string
}

/**
 * A category, plus the one relationship that makes `/shop/clothing` mean *"everything under
 * Clothing"* rather than *"products somebody remembered to tag Clothing as well as Hoodies"*.
 */
export type CategoryOption = FacetOption & {
  /** `null` for a top-level category. */
  parent: null | string
}

/**
 * Everything the catalogue can be filtered *by*, as it exists right now.
 *
 * Read once per request from Postgres (cached under the `catalog` tag) and handed to
 * `normaliseCatalogQuery`, which is what lets an unknown value be recognised as unknown. Without it
 * the only way to discover that `?color=puce` matches nothing would be to run the query — and plan
 * §11.1d's *"filter references deleted value"* would render an empty grid with no explanation.
 *
 * `sizes` is the one that cannot be a constant. Colour families are a `select` enum on the variant,
 * but `size` is deliberately free text there — *"apparel sizing is not one scale"* — so the sizes a
 * customer may filter by are whatever the catalogue currently stocks.
 */
export type CatalogVocabulary = {
  categories: CategoryOption[]
  collections: FacetOption[]
  colors: FacetOption[]
  /** The dearest and cheapest purchasable product, in minor units. `null` on an empty catalogue. */
  priceCeilingMinor: null | number
  priceFloorMinor: null | number
  sizes: FacetOption[]
}

/** The shape a category row arrives in, whatever depth it was read at. */
export type RawCategory = {
  id: number
  name?: null | string
  parent?: number | null | { id?: number }
  slug?: null | string
}

/**
 * Category rows → facet options, with `parent` resolved from an **id** to a **slug**.
 *
 * This lives in the pure module rather than inside the loader because of the defect that put it
 * here. The loader read `doc.parent` as a document — but the query runs at `depth: 0`, where it is a
 * number — so every category resolved to `parent: null`, the taxonomy flattened, and
 * `expandCategory` built an empty child map. `/shop/clothing` quietly stopped meaning *"everything
 * under Clothing"*.
 *
 * The harness could not have caught it: `verify-catalog`'s category fixtures are written by hand
 * with the parents already resolved, so they proved `expandCategory` correct while the thing feeding
 * it was wrong. Phase 10's audit named that failure mode exactly — *"a harness meets the fixtures its
 * author imagined"* — and the answer is the same one that phase reached: move the rule somewhere the
 * harness can run it against **real documents**.
 *
 * Both shapes are accepted, so raising the query's depth later cannot silently break it again.
 */
export function toCategoryOptions(docs: readonly RawCategory[]): CategoryOption[] {
  const slugById = new Map<number, string>()

  for (const doc of docs) {
    const slug = doc.slug?.trim()

    if (slug) {
      slugById.set(doc.id, slug)
    }
  }

  const options: CategoryOption[] = []

  for (const doc of docs) {
    const slug = doc.slug?.trim()

    if (!slug) {
      continue
    }

    const parentId =
      typeof doc.parent === 'object' && doc.parent !== null ? doc.parent.id : doc.parent

    options.push({
      label: doc.name?.trim() || slug,
      parent: typeof parentId === 'number' ? (slugById.get(parentId) ?? null) : null,
      value: slug,
    })
  }

  return options
}

export const EMPTY_VOCABULARY: CatalogVocabulary = {
  categories: [],
  collections: [],
  colors: [],
  priceCeilingMinor: null,
  priceFloorMinor: null,
  sizes: [],
}

/**
 * **One spelling per query.** The URL a customer arrives on, rewritten to the one this shop owns.
 *
 * ### The defect this exists to make impossible
 *
 * `normaliseCatalogQuery` maps `?size=m` onto the stored value `M`, because a size is upper-cased by
 * the variant's own `beforeValidate` hook and a lower-case one in the address bar is perfectly
 * reasonable. That produced a **dead control**: the filter chip's label came from the *normalised*
 * value while its remove-link was built from the *raw* URL token, so `params.size.filter(v => v !==
 * 'M')` on `['m']` removed nothing, and the chip's href was byte-identical to the page it was on.
 * Measured on `/shop?size=m`: clicking Remove left the same six products and the same URL.
 *
 * Fixing the comparison alone would have closed one instance. Canonicalising closes the class —
 * after this runs, every downstream comparison is normalised-against-normalised **by construction**,
 * so no future code can reintroduce it by comparing the raw params against the resolved query.
 *
 * It also earns the thing feature matrix §5 asks for. *"URL is shareable"* is worth more when two
 * people filtering the same way land on the same address: one canonical URL per query, which is also
 * one entry in a crawler's index rather than four spellings of one page.
 *
 * ### What it deliberately does **not** touch
 *
 * Two things a customer got wrong are left exactly as they typed them, and both are deliberate:
 *
 * - **An unknown value** — `?color=puce`. Rewriting it away would strip the evidence before the
 *   toolbar could report *"one filter was ignored because the shop no longer has that value"*.
 *   Plan §11.1d's *"filter references deleted value"* requires the customer be **told**, and a
 *   redirect that silently deletes the token tells them nothing.
 * - **A reversed price range** — `?priceMin=400&priceMax=100`. Same reasoning: the swap is announced,
 *   and it cannot be announced if the URL no longer shows it happened.
 * - **An over-long search term.** The term is trimmed and NFC-normalised here but **not clamped**,
 *   which is why `normaliseSearchTerm` takes a `clamp` option at all. Clamping it made the "that
 *   search was very long" notice unreachable: the redirect rewrote a 400-character paste to 256
 *   bytes, and `normaliseCatalogQuery` then saw an already-short term with `truncated: false`. The
 *   third instance of the same mistake, found by the sweep in the one place it had not been checked.
 *
 * So this canonicalises **spelling, order and duplication of values the shop recognises**, and
 * nothing else. Unknown values are preserved in the order they arrived, after the known ones.
 */
export function canonicaliseParams(
  params: CatalogParams,
  vocabulary: CatalogVocabulary,
): CatalogParams {
  const canonicalList = (requested: string[], options: FacetOption[]): string[] => {
    const byKey = new Map(options.map((option) => [option.value.toLowerCase(), option.value]))
    const known = new Set<string>()
    const unknown: string[] = []

    for (const raw of requested) {
      const trimmed = raw.trim()

      if (trimmed === '') {
        continue
      }

      const match = byKey.get(trimmed.toLowerCase())

      if (match === undefined) {
        // Preserved, and de-duplicated on its own spelling so `?color=puce,puce` still settles.
        if (!unknown.includes(trimmed)) {
          unknown.push(trimmed)
        }

        continue
      }

      known.add(match)
    }

    return [
      ...options.map((option) => option.value).filter((value) => known.has(value)),
      ...unknown,
    ]
  }

  const { term } = normaliseSearchTerm(params.q, { clamp: false })

  return {
    ...params,
    /*
     * The term is canonicalised like every other parameter, so `?q=%20hoodie%20` and `?q=hoodie` are
     * one URL. An empty or punctuation-only term becomes `null` and the serializer drops the key —
     * `/search?q=%20` is not a search and must not look like one in the address bar.
     */
    q: term,
    category: canonicalList(params.category, vocabulary.categories),
    collection: canonicalList(params.collection, vocabulary.collections),
    color: canonicalList(params.color, vocabulary.colors),
    /*
     * Clamped here as well as in `normaliseCatalogQuery`, so a URL carrying `?page=0` or `?page=4.5`
     * is rewritten to one the rest of the system agrees with rather than merely tolerated. Without
     * it the address bar would keep a page number no query ever ran.
     */
    page: Math.min(
      Math.max(Number.isSafeInteger(params.page) ? params.page : 1, 1),
      CATALOG_MAX_PAGE,
    ),
    size: canonicalList(params.size, vocabulary.sizes),
  }
}

/* -------------------------------------------------------------------------------------------------
 * The query
 * ---------------------------------------------------------------------------------------------- */

/**
 * A validated question. Every value in here is known to exist in the catalogue's vocabulary, so an
 * engine may pass it through without re-checking.
 *
 * `categories` is the *expanded* set — the requested slugs plus every descendant — because a
 * customer who clicks Clothing means Clothing and everything filed under it. The expansion happens
 * here rather than in an engine so that both engines expand it identically.
 */
export type CatalogQuery = {
  availability: CatalogAvailability | null
  /** The normalised search term, or `null` for a browse. */
  q: null | string
  /** What the query filters on: the requested categories **expanded to include every descendant**. */
  categories: string[]
  collections: string[]
  colors: string[]
  page: number
  priceMaxMinor: null | number
  priceMinMinor: null | number
  /**
   * What the customer actually chose, before expansion — and it is carried separately because the
   * two are needed for different jobs.
   *
   * `categories` answers *"which products"*. This answers *"what did they tick"*, which is what an
   * active-filter chip has to show. Deriving the chips from `categories` instead produced a chip per
   * descendant: ticking **Clothing** rendered *Clothing*, *Tops* and *Hoodies*, three controls for
   * one decision, two of which the customer never made and could not meaningfully remove one at a
   * time. Found by `verify:catalog`.
   *
   * Empty when the category came from the route (`/shop/<slug>`) rather than from a facet — standing
   * somewhere is not a filter, so it is not a chip.
   */
  requestedCategories: string[]
  sizes: string[]
  sort: CatalogSort
}

export const EMPTY_QUERY: CatalogQuery = {
  availability: null,
  q: null,
  categories: [],
  collections: [],
  colors: [],
  page: 1,
  priceMaxMinor: null,
  priceMinMinor: null,
  requestedCategories: [],
  sizes: [],
  sort: DEFAULT_CATALOG_SORT,
}

/** What was thrown away on the way in, so the page can say so out loud. */
export type IgnoredFilter = {
  /** The facet it was offered as — `category`, `collection`, `color`, `size`, `price`. */
  facet: string
  reason: 'reversed' | 'truncated' | 'unknown'
  value: string
}

export type NormalisedCatalogQuery = {
  ignored: IgnoredFilter[]
  query: CatalogQuery
}

/**
 * Major units to minor. Two decimal places, because that is the assumption `lib/money.ts` already
 * bakes in when it divides by 100 — the two must agree, or a price filter would silently mean a
 * different number from the price it filters on.
 */
const MINOR_UNITS_PER_MAJOR = 100

/**
 * A price a customer could plausibly have typed.
 *
 * `Number.isSafeInteger` alone is not enough: a negative price is meaningless, and a value large
 * enough to overflow the column is a filter that can only return nothing. The ceiling is ten million
 * major units — four orders of magnitude past the most expensive garment anyone will list here, and
 * still nowhere near the integer limit.
 */
const MAX_PRICE_MAJOR = 10_000_000

const isUsablePrice = (value: null | number): value is number =>
  value !== null && Number.isSafeInteger(value) && value >= 0 && value <= MAX_PRICE_MAJOR

/**
 * Every descendant of `slug`, plus `slug` itself.
 *
 * Breadth-first with a `seen` set, and the set is not defensive decoration. `Categories.ts` is
 * explicit that the schema stops a category being *its own* parent and deliberately does not stop a
 * longer cycle: *"A longer cycle (A → B → A) is still reachable through two separate saves; Phase 9,
 * which renders the tree, is where a traversal guard belongs, because it is the code that would
 * otherwise loop."* This is the second such traversal and it needs the same guard for the same
 * reason — a two-save cycle here would hang a request rather than render a wrong menu.
 */
export function expandCategory(vocabulary: CatalogVocabulary, slug: string): string[] {
  const children = new Map<string, string[]>()

  for (const category of vocabulary.categories) {
    if (category.parent) {
      children.set(category.parent, [...(children.get(category.parent) ?? []), category.value])
    }
  }

  const seen = new Set<string>()
  const queue = [slug]

  while (queue.length > 0) {
    const current = queue.shift() as string

    if (seen.has(current)) {
      continue
    }

    seen.add(current)
    queue.push(...(children.get(current) ?? []))
  }

  return [...seen]
}

/**
 * **The whole of feature matrix §5's *"invalid filter values are ignored safely"*, and plan §11.1d's
 * edge-case list.**
 *
 * | Case | Behaviour |
 * |---|---|
 * | Filter references a deleted value | dropped, and reported in `ignored` |
 * | URL contains an unknown category | dropped, and reported |
 * | Price range reversed | **swapped**, and reported — the intent is not in doubt |
 * | Duplicate filter values | de-duplicated silently; there is nothing to tell anyone |
 * | Filter produces zero results | not this function's job — that is a real answer, not a bad input |
 * | Search service unavailable | not this function's job — see `catalog.ts` |
 *
 * The asymmetry between *dropped-and-reported* and *de-duplicated-silently* is deliberate. A
 * duplicate changes nothing about the answer, so mentioning it would be noise. A dropped value
 * changes the answer, and a grid that silently disagrees with its own URL is the defect this
 * function exists to avoid.
 *
 * **Order is preserved and comes from the vocabulary, not from the URL.** Two URLs listing the same
 * colours in a different order are the same question and should produce byte-identical queries —
 * which matters the moment anything upstream caches on one.
 */
export function normaliseCatalogQuery(
  params: CatalogParams,
  vocabulary: CatalogVocabulary,
  /**
   * A category fixed by the route rather than by the query string — the `<slug>` of `/shop/<slug>`.
   * Assumed to exist: the route resolves it before rendering and 404s when it does not.
   */
  routeCategory?: null | string,
): NormalisedCatalogQuery {
  const ignored: IgnoredFilter[] = []

  /**
   * Keep the values the vocabulary knows, in the vocabulary's order, and report the rest.
   *
   * The comparison is trimmed and case-insensitive because these arrive from a URL a human may have
   * typed or hand-edited. `?size=m` and `?size=M` are the same size — `size` is stored upper-cased
   * by the variant's own `beforeValidate` hook, so `m` would otherwise match nothing while looking
   * perfectly reasonable in the address bar.
   */
  const keepKnown = (facet: string, requested: string[], options: FacetOption[]): string[] => {
    const byKey = new Map(options.map((option) => [option.value.toLowerCase(), option.value]))
    const kept = new Set<string>()

    for (const raw of requested) {
      const key = raw.trim().toLowerCase()

      if (key === '') {
        continue
      }

      const match = byKey.get(key)

      if (match === undefined) {
        ignored.push({ facet, reason: 'unknown', value: raw })
        continue
      }

      kept.add(match)
    }

    return options.map((option) => option.value).filter((value) => kept.has(value))
  }

  const requestedCategories = keepKnown('category', params.category, vocabulary.categories)

  /*
   * The route's category and the facet's categories combine as a union of subtrees rather than a set
   * intersection: standing in `/shop/clothing` and ticking Hoodies means hoodies, and the two slugs
   * expand to overlapping subtrees. Taking the facet's subtree when one is present, and the route's
   * when it is not, is what makes the breadcrumb and the grid agree.
   */
  const categorySeeds =
    requestedCategories.length > 0 ? requestedCategories : routeCategory ? [routeCategory] : []

  const categories = [...new Set(categorySeeds.flatMap((slug) => expandCategory(vocabulary, slug)))]

  /*
   * Reversed range: swap rather than drop. `?priceMin=400&priceMax=100` is unambiguously "between
   * 100 and 400" typed the wrong way round, and dropping both would answer a question nobody asked.
   * Reported anyway, so the controls can show what was actually applied.
   */
  let priceMin = isUsablePrice(params.priceMin) ? params.priceMin : null
  let priceMax = isUsablePrice(params.priceMax) ? params.priceMax : null

  if (params.priceMin !== null && priceMin === null) {
    ignored.push({ facet: 'price', reason: 'unknown', value: String(params.priceMin) })
  }

  if (params.priceMax !== null && priceMax === null) {
    ignored.push({ facet: 'price', reason: 'unknown', value: String(params.priceMax) })
  }

  if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
    ignored.push({ facet: 'price', reason: 'reversed', value: `${priceMin}-${priceMax}` })

    const swap = priceMin
    priceMin = priceMax
    priceMax = swap
  }

  const search = normaliseSearchTerm(params.q)

  /*
   * A clamped term is reported rather than silently shortened. §12.1d's "very long query" is a real
   * input — a paste of a whole paragraph — and the customer is told the shop used the first part of
   * it, instead of being shown results for a sentence they cannot see.
   */
  if (search.truncated) {
    ignored.push({ facet: 'q', reason: 'truncated', value: search.term ?? '' })
  }

  return {
    ignored,
    query: {
      availability: params.availability,
      q: search.term,
      categories,
      collections: keepKnown('collection', params.collection, vocabulary.collections),
      colors: keepKnown('color', params.color, vocabulary.colors),
      page: Math.min(
        Math.max(Number.isSafeInteger(params.page) ? params.page : 1, 1),
        CATALOG_MAX_PAGE,
      ),
      priceMaxMinor: priceMax === null ? null : priceMax * MINOR_UNITS_PER_MAJOR,
      priceMinMinor: priceMin === null ? null : priceMin * MINOR_UNITS_PER_MAJOR,
      requestedCategories,
      sizes: keepKnown('size', params.size, vocabulary.sizes),
      sort: params.sort,
    },
  }
}

/**
 * Is anything actually narrowed?
 *
 * Drives the empty state's wording and whether a "Clear all" control is offered at all. On
 * `/shop/<category>` the route's own category is **not** a filter — it is where the customer is
 * standing, and offering to clear it would be offering to leave the page they asked for.
 */
export function isFilteredQuery(
  query: CatalogQuery,
  routeCategory?: null | string,
  /**
   * The term that IS the route, on `/search`. Like `routeCategory`, standing somewhere is not
   * filtering — offering to "clear" the search from the search page would offer to leave it.
   */
  routeQuery?: null | string,
): boolean {
  const onlyTheRouteCategory =
    typeof routeCategory === 'string' && routeCategory !== '' && query.categories.length > 0

  const onlyTheRouteQuery = typeof routeQuery === 'string' && routeQuery !== '' && query.q !== null

  return (
    (query.q !== null && !onlyTheRouteQuery) ||
    query.colors.length > 0 ||
    query.sizes.length > 0 ||
    query.collections.length > 0 ||
    query.availability !== null ||
    query.priceMinMinor !== null ||
    query.priceMaxMinor !== null ||
    (query.categories.length > 0 && !onlyTheRouteCategory)
  )
}

/**
 * **Which engine can answer this.**
 *
 * The routing rule of the whole phase, in one predicate; the argument for it is in `catalog.ts`. The
 * short version: three of the six facets are not properties of a product row.
 *
 * - **`size` and `color`** live on `product-variants`. `products.variants` is a Payload `join`,
 *   which is virtual and has no column, so a product cannot be filtered by one. Answering *"products
 *   with an active Black variant in M"* from Postgres means querying variants, collecting distinct
 *   product ids and paginating over that — which is the *"expensive full-catalog scan"* plan §11.1d
 *   forbids.
 * - **`collection`** is the same shape inverted. `Products.ts` puts membership on the collection
 *   (*"an order is a property of the list, not of its members"*), so `products.collections` is a
 *   join too.
 *
 * Everything else — category, price, availability, every sort, and the page — is an indexed column
 * on `products`, and Postgres answers those exactly, authoritatively, and with no network hop.
 */
export function requiresSearchIndex(query: CatalogQuery): boolean {
  /*
   * **A text query is ALWAYS the index.** This clause is the single highest-consequence line in the
   * phase: without it `/search?q=hoodie` routes to Postgres, `catalogWhere` builds no clause from
   * `q` because there is no text column to build one from, and the page renders the ENTIRE
   * catalogue while the URL and the page title both claim a search. A wrong answer that looks
   * exactly like a right one.
   */
  return (
    query.q !== null ||
    query.colors.length > 0 ||
    query.sizes.length > 0 ||
    query.collections.length > 0
  )
}

/* -------------------------------------------------------------------------------------------------
 * The Postgres engine's half
 * ---------------------------------------------------------------------------------------------- */

/**
 * The published-state clauses, identical in intent to `lib/home/resolve.ts`'s `railWhere`.
 *
 * Three conditions, and one of them is easy to forget: a product may be `published` *and* carry a
 * `publishedAt` in the future, which is how a drop is scheduled. `exists: false` is the first branch
 * because most products never carry a date at all.
 *
 * `derived.priceFromMinor` existing is the fourth, and it is a **merchandising** rule rather than a
 * publishing one. It is `null` exactly when a product has no active variant — the merchandiser has
 * switched every colour and size off, so the product is withdrawn from sale rather than merely out
 * of stock. Listing it would be *"a dead end dressed as an offer"*, which is the judgement
 * `resolveProductTile` already makes on the homepage. The card still renders that state, because
 * later phases link to a *specific* product regardless of whether a listing would have offered it.
 *
 * It also removes the only `null` that could reach a price sort. Drizzle emits a bare `ORDER BY x
 * DESC` and Postgres sorts `NULL` **first** under `DESC`, so without this clause every withdrawn
 * product would head the "Price: high to low" grid. Verified in
 * `@payloadcms/drizzle/dist/queries/buildOrderBy.js`, which maps a `-` prefix onto Drizzle's `desc()`
 * with no nulls-ordering control of any kind.
 *
 * Soft-deleted rows need no clause: `payload.find` excludes them unless asked.
 */
export function publishedProductWhere(now: string): Where[] {
  return [
    { status: { equals: 'published' } },
    { or: [{ publishedAt: { exists: false } }, { publishedAt: { less_than_equal: now } }] },
    { 'derived.priceFromMinor': { exists: true } },
  ]
}

/**
 * **Which variants may contribute a filter option.**
 *
 * The filter panel offers a size or a colour because *some product stocks it*, so "listable" has to
 * mean the same thing here as it does for the listing — and it did not. This clause used to be
 * `{ active: true }` alone, inline in the loader, which put the sizes of **draft** products into the
 * panel: measured with a draft product sized `AUDIT-ONLY`, the size was offered and returned zero
 * products, with nothing on screen to explain why.
 *
 * It is `publishedProductWhere`'s three conditions reached through the `product.` join — the same
 * dotted path `access/publishedOn` resolves to a join on an indexed column. Written here rather than
 * in the loader for the reason every other rule is: the loader is `server-only` and a harness cannot
 * import it, so a rule that lives there is a rule nothing executes.
 */
export function listableVariantWhere(now: string): Where {
  return {
    and: [
      { active: { equals: true } },
      { 'product.status': { equals: 'published' } },
      {
        or: [
          { 'product.publishedAt': { exists: false } },
          { 'product.publishedAt': { less_than_equal: now } },
        ],
      },
      { 'product.derived.priceFromMinor': { exists: true } },
    ],
  }
}

/**
 * The page to redirect to when the requested one does not exist, or `null` to stay put.
 *
 * `/shop?page=5` against a one-page catalogue rendered the toolbar's honest "10 products" above the
 * empty state's *"this part of the shop has no published products at the moment"* — two statements
 * on one screen that could not both be true — and no pagination at all, because that control lives
 * in the branch that only runs when there are products. The only way back was editing the URL.
 *
 * Returning the **last real page** means the customer always lands on products and the address
 * becomes canonical. `null` covers the two cases where there is nowhere better to send them: a page
 * that exists, and a result with no pages at all, where the empty state is the correct answer.
 *
 * A pure function rather than three lines in the component, so the harness can prove the one
 * property that matters: it never returns a page that would itself redirect.
 */
export function outOfRangePage(page: number, totalPages: number): null | number {
  if (totalPages <= 0 || page <= totalPages) {
    return null
  }

  return totalPages
}

/**
 * `CatalogQuery` → a Payload `Where`.
 *
 * Only the clauses Postgres can answer are built here; `requiresSearchIndex` guarantees the others
 * are absent by the time this runs. It is still written to be *safe* rather than merely correct
 * under that assumption — an unexpected `colors` simply fails to narrow the result, rather than
 * throwing or silently matching everything under a wrong column name.
 *
 * **`availability` is a stock count, not a flag**, which is `Products.ts`'s own argument for storing
 * a number: *"Sold out is `= 0`, low stock is `<= threshold` compared at render."* One column, three
 * states, nothing to keep in step.
 */
export function catalogWhere(query: CatalogQuery, now: string): Where {
  const and: Where[] = [...publishedProductWhere(now)]

  if (query.categories.length > 0) {
    and.push({ 'categories.slug': { in: query.categories } })
  }

  if (query.availability === 'in-stock') {
    and.push({ 'derived.inventoryTotal': { greater_than: 0 } })
  }

  if (query.priceMinMinor !== null) {
    and.push({ 'derived.priceFromMinor': { greater_than_equal: query.priceMinMinor } })
  }

  if (query.priceMaxMinor !== null) {
    /*
     * The *lowest* price is compared against the ceiling, not the highest. A product whose range is
     * $95–$240 belongs in "under $150": the customer can buy it for $95. Comparing `priceToMinor`
     * would hide it, which is the wrong answer to "show me what I can afford".
     */
    and.push({ 'derived.priceFromMinor': { less_than_equal: query.priceMaxMinor } })
  }

  return { and }
}

/**
 * The Payload `sort` for each option.
 *
 * Every one ends in a **deterministic tiebreaker**, and that is not tidiness. Postgres guarantees no
 * order for equal keys, so page 1 and page 2 of a `sortOrder = 0` run can interleave between two
 * requests — the same product appears twice and another never appears at all. `slug` is unique and
 * stable, so it settles every tie.
 *
 * `publishedAt` is nullable in the schema but never null on a *published* product: `publishingFields`
 * stamps it on the transition to published, and `publishedProductWhere` filters to published rows.
 * So the nulls-first hazard that governs the price sorts does not arise for `newest`.
 */
export const CATALOG_SORT_FIELDS: Record<CatalogSort, string[]> = {
  featured: ['sortOrder', '-publishedAt', 'slug'],
  newest: ['-publishedAt', 'slug'],
  'best-sellers': ['-isBestSeller', 'sortOrder', 'slug'],
  'price-asc': ['derived.priceFromMinor', 'slug'],
  'price-desc': ['-derived.priceFromMinor', 'slug'],
}
