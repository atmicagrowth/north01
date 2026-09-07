import { NextResponse } from 'next/server'

import {
  getCatalogVocabulary,
  getPopularSearches,
  getSearchSuggestions,
} from '@/lib/catalog/catalog'
import { normaliseSearchTerm } from '@/lib/catalog/search'
import { buildSuggestions } from '@/lib/catalog/suggest'

/**
 * **The typeahead endpoint** — this project's first storefront route handler.
 *
 * The search panel is a client component, so it cannot call a `server-only` loader directly. This is
 * the boundary: it reads the term, calls the same loaders the pages call, and returns the payload
 * `buildSuggestions` produced.
 *
 * ### It always answers 200, and always carries the Postgres half
 *
 * Even when the search service is unreachable. That is plan §A.5 as a response shape rather than as
 * an intention: categories, collections, recent searches and popular searches all come from Postgres
 * and from the customer's own browser, so an Algolia outage must cost the **product suggestions**
 * and nothing else. A handler that 500s, or that returns an empty body on failure, would take the
 * shop's navigation down with a service the navigation does not use.
 *
 * The failure is reported in the payload's `state`, not in the status code, because the panel needs
 * to *render* something different rather than to catch an exception.
 *
 * ### Reading the term
 *
 * `request.nextUrl.searchParams` and never `decodeURIComponent`. A malformed percent-escape —
 * `%E0%A4%A` — makes `decodeURIComponent` **throw**, which would turn a mistyped URL into a 500.
 * `URLSearchParams` yields a replacement character instead, and `normaliseSearchTerm` then strips it.
 *
 * ### What this deliberately does not have
 *
 * **No rate limiting, no throttling, no Turnstile.** Phase 26 owns those and §26.1a's surface list
 * does not name search. The two-character floor, the debounce, the six-hit cap and the byte clamp are
 * §12.1d edge cases and cost controls — they are *not* security controls and must not be described
 * as such. The honest position is `newsletter/actions.ts`'s: the write path is open, it is recorded
 * as owed, and it is not improvised here. **DEV-51.**
 */

/**
 * `force-dynamic` and `no-store`.
 *
 * The response depends on a query parameter and on live catalogue state, and it is read once per
 * settled keystroke. Caching it would serve one customer's suggestions to another and would keep a
 * withdrawn product on screen after it had gone — the exact staleness D-37 exists to prevent, at a
 * different layer.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const { status, term } = normaliseSearchTerm(url.searchParams.get('q'))

  /*
   * The three Postgres-backed sections are loaded regardless of the term and regardless of whether
   * the engine is reachable — see the docblock. `getPopularSearches` and `getCatalogVocabulary` both
   * fail open to an empty list rather than throwing.
   */
  const [vocabulary, popular] = await Promise.all([getCatalogVocabulary(), getPopularSearches()])

  /*
   * Below the floor, no network call is made at all. §12.1d's "empty query" and "1-character query"
   * are answered by not asking — which is also what keeps a per-keystroke endpoint affordable.
   */
  const suggestions =
    term !== null && status === 'ok'
      ? await getSearchSuggestions(term)
      : { engine: 'postgres' as const, products: [] }

  const payload = buildSuggestions({
    cards: suggestions.products,
    engine: suggestions.engine,
    pending: false,
    popular,
    /*
     * Recent searches live in the customer's browser and are merged there. Sending them to the
     * server would be sending a behavioural record of one person's browsing to a log for no reason —
     * and the panel already holds them.
     */
    recent: [],
    status,
    term,
    vocabulary,
  })

  return NextResponse.json(payload, {
    headers: { 'cache-control': 'no-store' },
  })
}
