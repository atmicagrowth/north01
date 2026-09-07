import {
  SEARCH_CATEGORY_SUGGESTION_LIMIT,
  SEARCH_COLLECTION_SUGGESTION_LIMIT,
  categorySuggestionHref,
  collectionSuggestionHref,
  matchVocabulary,
  searchState,
  type SearchState,
  type SearchTermStatus,
} from './search'
import type { CatalogVocabulary } from './query'
import type { ProductCard } from './resolve'

/**
 * **The whole of plan §12.1c's panel, as one pure function.**
 *
 * The seven sections, their order, their caps, their labels and their hrefs are decided here rather
 * than in JSX, so `pnpm verify:search` can assert the payload without a browser — including the one
 * property that is easy to get wrong and impossible to see in a screenshot: **the unavailable
 * payload still carries categories, collections, recent and popular.**
 *
 * That is plan §A.5 made structural. Those four sections come from Postgres and from the customer's
 * own browser; none of them ever needed the search engine. A panel that empties itself when Algolia
 * is unreachable would take the shop's navigation down with a service the shop's navigation does not
 * use.
 */

export type SuggestionLink = {
  href: string
  label: string
}

export type SuggestionPayload = {
  categories: SuggestionLink[]
  collections: SuggestionLink[]
  /** Terms, not links — the panel turns them into a submit. */
  popular: string[]
  products: ProductCard[]
  recent: string[]
  state: SearchState
}

export type SuggestionInput = {
  /** Product cards already rehydrated from Postgres. Empty when the engine could not answer. */
  cards: ProductCard[]
  engine: 'postgres' | 'search' | 'unavailable'
  /** True while a request is in flight, so the panel can show `loading` rather than `empty`. */
  pending: boolean
  popular: string[]
  recent: string[]
  status: SearchTermStatus
  term: null | string
  vocabulary: CatalogVocabulary
}

/**
 * Build the panel's payload.
 *
 * Two rules govern every section and both are §0.1.17's "no fake UI" applied to a list:
 *
 * - **A section with nothing in it is absent, never empty.** An empty "Popular searches" heading is
 *   a control that promises something the shop cannot give.
 * - **Recent and popular show only before a term is typed.** Once the customer is searching, the
 *   panel is about *this* search. Keeping yesterday's terms on screen beside live results is two
 *   answers to one question.
 */
export function buildSuggestions({
  cards,
  engine,
  pending,
  popular,
  recent,
  status,
  term,
  vocabulary,
}: SuggestionInput): SuggestionPayload {
  const state = searchState({
    cardCount: cards.length,
    engine,
    pending,
    /*
     * The panel never distinguishes `stale` from `empty`: a suggestion list that came back short is
     * simply a shorter list, and there is no count on screen for it to contradict. The results page
     * is where that distinction earns its own sentence.
     */
    stale: false,
    status,
  })

  const searching = term !== null && status === 'ok'

  return {
    categories: searching
      ? matchVocabulary(term, vocabulary.categories, SEARCH_CATEGORY_SUGGESTION_LIMIT).map(
          (option) => ({ href: categorySuggestionHref(option.value), label: option.label }),
        )
      : [],
    collections: searching
      ? matchVocabulary(term, vocabulary.collections, SEARCH_COLLECTION_SUGGESTION_LIMIT).map(
          (option) => ({ href: collectionSuggestionHref(option.value), label: option.label }),
        )
      : [],
    popular: searching ? [] : popular,
    products: cards,
    recent: searching ? [] : recent,
    state,
  }
}

/**
 * Every option in the panel, flattened in the order they are rendered.
 *
 * The combobox's arrow keys walk **one** list across three visual groups, because that is what a
 * customer expects and what `aria-activedescendant` requires: one active option at a time, from one
 * index. Building it here rather than in the component means `nextOptionIndex` and the rendered
 * order can never disagree — which they would the first time somebody reorders a section in JSX.
 *
 * The ids are stable and unique, so `aria-activedescendant` can never point at an element that is
 * not on the page. A dangling id is silent: the attribute is set, no element matches, and the
 * screen reader announces nothing at all.
 */
export function suggestionOptions(payload: SuggestionPayload): {
  href: null | string
  id: string
  kind: 'category' | 'collection' | 'product' | 'term'
  label: string
}[] {
  return [
    ...payload.products.map((product, index) => ({
      href: product.href,
      id: `search-option-product-${index}`,
      kind: 'product' as const,
      label: product.name,
    })),
    ...payload.categories.map((entry, index) => ({
      href: entry.href,
      id: `search-option-category-${index}`,
      kind: 'category' as const,
      label: entry.label,
    })),
    ...payload.collections.map((entry, index) => ({
      href: entry.href,
      id: `search-option-collection-${index}`,
      kind: 'collection' as const,
      label: entry.label,
    })),
    ...payload.recent.map((entry, index) => ({
      href: null,
      id: `search-option-recent-${index}`,
      kind: 'term' as const,
      label: entry,
    })),
    ...payload.popular.map((entry, index) => ({
      href: null,
      id: `search-option-popular-${index}`,
      kind: 'term' as const,
      label: entry,
    })),
  ]
}
