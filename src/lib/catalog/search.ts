import type { FacetOption } from './query'
import type { CatalogResult } from './resolve'

/**
 * **Every rule text search obeys, as functions a CLI harness can run.**
 *
 * Pure. No Next, nothing runnable from Payload, nothing `server-only`, and — deliberately — no
 * `algoliasearch` import even for a type. `classifySearchFailure` duck-types the error it is handed
 * rather than instantiating the SDK's classes, because the moment this module imports the provider
 * it stops being loadable by `pnpm verify:search` and by the browser both.
 *
 * That matters more here than anywhere else in the catalogue, because plan §12.1d is a list of ten
 * *failures*. A failure that can only be reproduced by unplugging a network cable is a failure
 * nothing tests. Every one of the ten is decided by a function in this file, so every one of them is
 * a fixture.
 *
 * ---
 *
 * ### The state machine is total, and that is the point
 *
 * `searchState` returns exactly one of seven values for every possible input. The reason is plan
 * §11.1d's fallback policy generalised: **an outage must never render as "no results."** Those are
 * different sentences to a customer — one says the shop has nothing for you, the other says the shop
 * is broken — and the only way to guarantee they cannot be confused is to make the thing that
 * decides them total, exhaustive and testable, rather than a chain of `if`s spread across three
 * components.
 */

/* -------------------------------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------------------------------- */

/** The results route. `/shop?q=` redirects here, so there is one crawlable search namespace. */
export const SEARCH_PATH = '/search'

/**
 * The typeahead floor, in **code points**, and it answers two of §12.1d's cases outright.
 *
 * Below it the panel makes no network call at all — that is *"empty query"* and *"1-character
 * query"* handled rather than merely tolerated. Code points, not `.length`, because a single emoji
 * is two UTF-16 units and one character to the person who typed it.
 *
 * **It binds the typeahead only.** An explicit submit searches any non-empty term: `h` really does
 * return prefix matches, and refusing a deliberate submit withholds a real answer to save a request
 * the customer asked for.
 */
export const SEARCH_MIN_TERM_LENGTH = 2

/**
 * The hard clamp on a submitted term, in **bytes**, not characters.
 *
 * Algolia's limit is on the encoded query, so a character cap is the wrong unit and fails on exactly
 * the input that needs it: 128 shirt emoji are 128 characters and **512 bytes**. Measured against
 * the live index — 512 bytes of ASCII returns 200, 513 returns **400**. 256 leaves room the customer
 * will never need and the engine will never refuse.
 */
export const SEARCH_TERM_MAX_BYTES = 256

export const SEARCH_SUGGESTION_LIMIT = 6
export const SEARCH_CATEGORY_SUGGESTION_LIMIT = 4
export const SEARCH_COLLECTION_SUGGESTION_LIMIT = 3
export const RECENT_SEARCH_LIMIT = 6

/** `localStorage` key, namespaced so it cannot collide with anything else on the origin. */
export const RECENT_SEARCH_KEY = 'north01:recent-searches'

/**
 * Trailing-edge debounce for the typeahead, in milliseconds.
 *
 * Not a preference — it is the **only** request-reduction mechanism available at this SDK's default
 * configuration. The Node build constructs its transporter with `responsesCache: createNullCache()`
 * and issues requests through `node:https` rather than global `fetch`, so the SDK will not dedupe a
 * repeated query and Next's fetch cache and `revalidateTag` cannot reach it either.
 */
export const SUGGEST_DEBOUNCE_MS = 200

/**
 * Deadlines, and why they exist on top of the SDK's own timeouts.
 *
 * `algolia.ts`'s `TIMEOUTS` bound one **socket**, and the SDK escalates that per attempt across four
 * hosts — so a single call can spend far longer than its read timeout before throwing `RetryError`.
 * These bound the **page**. A customer waiting on a suggestion has already typed the next character;
 * a customer waiting on a results page has already decided the shop is broken.
 */
export const SUGGEST_DEADLINE_MS = 1200
export const RESULTS_DEADLINE_MS = 2500

/* -------------------------------------------------------------------------------------------------
 * Normalisation
 * ---------------------------------------------------------------------------------------------- */

/**
 * Truncate to at most `maxBytes` of UTF-8 **without splitting a code point**.
 *
 * Slicing a JavaScript string by `.length` and hoping is how a lone surrogate reaches an HTTP query
 * string. This walks code points, measures each, and stops before the budget is exceeded — so the
 * output is always valid UTF-8 and always re-encodable.
 */
export function truncateToBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder()

  if (encoder.encode(value).length <= maxBytes) {
    return value
  }

  let used = 0
  let out = ''

  for (const codePoint of value) {
    const size = encoder.encode(codePoint).length

    if (used + size > maxBytes) {
      break
    }

    used += size
    out += codePoint
  }

  return out
}

export type SearchTermStatus = 'empty' | 'ok' | 'tooShort'

export type NormalisedSearchTerm = {
  status: SearchTermStatus
  /** `null` when there is nothing searchable left. */
  term: null | string
  /** True when the byte clamp actually cut something, so the page can say so. */
  truncated: boolean
}

/**
 * Characters removed outright, named by code point rather than written literally.
 *
 * - **U+0000-U+001F, U+007F-U+009F** — C0/C1 controls and DEL. Never typed; they break a URL and a
 *   log line.
 * - **U+200B-U+200D, U+FEFF** — zero-width. Invisible in the address bar and in a filter chip, so
 *   two visually identical terms would otherwise be two different searches.
 * - **U+202A-U+202E, U+2066-U+2069** — bidi overrides. This is the range that matters for display: a
 *   term echoed into a page title and a chip can visually reorder the sentence around it.
 *
 * These are written as escapes and **never as literals**, here or anywhere else in the repository.
 * An earlier draft of this docblock pasted real examples of each range into the comment, which made
 * the source file itself contain C0 controls and bidi overrides — `file` reported it as binary data
 * and `grep` refused to read it as text. A file that hides its own contents from review is the
 * Trojan-Source hazard, arriving through a comment explaining the Trojan-Source hazard.
 */
const STRIPPED = /[-----]/gu

/** Combining marks, for accent folding. */
const COMBINING = /[̀-ͯ]/gu

/**
 * **One place decides what a search term is.**
 *
 * `normalize('NFC')` first, so a term typed with combining marks and one typed pre-composed are the
 * same term — otherwise the two spellings of `café` are two different chips, two different recent
 * searches and two different URLs.
 *
 * Then: strip the invisible and the dangerous; drop wrapping quotes and a leading `-`, both of which
 * are Algolia query *operators* rather than text a customer meant; collapse whitespace; clamp to
 * bytes; trim.
 *
 * **Case is preserved.** The term is echoed back — as the page title, as a chip, as a recent search
 * — and lower-casing it would show the customer something they did not type. Matching is
 * case-insensitive at the engine, so folding here would buy nothing and cost that.
 */
export function normaliseSearchTerm(raw: null | string | undefined): NormalisedSearchTerm {
  if (typeof raw !== 'string') {
    return { status: 'empty', term: null, truncated: false }
  }

  const cleaned = raw
    .normalize('NFC')
    .replace(STRIPPED, '')
    .replace(/^["'\s-]+/gu, '')
    .replace(/["'\s]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()

  const clamped = truncateToBytes(cleaned, SEARCH_TERM_MAX_BYTES)
  const truncated = clamped.length < cleaned.length

  if (clamped === '') {
    return { status: 'empty', term: null, truncated }
  }

  /*
   * A term of punctuation alone is not a search. `%`, `!!!` and `...` all survive the strip above and
   * all match nothing, so they are treated as empty rather than sent to the engine — §12.1d's
   * "special characters", answered before a request exists.
   */
  if (!/[\p{L}\p{N}]/u.test(clamped)) {
    return { status: 'empty', term: null, truncated }
  }

  return {
    status: [...clamped].length < SEARCH_MIN_TERM_LENGTH ? 'tooShort' : 'ok',
    term: clamped,
    truncated,
  }
}

/* -------------------------------------------------------------------------------------------------
 * Failure classification
 * ---------------------------------------------------------------------------------------------- */

export type SearchFailure =
  'bad-request' | 'missing-index' | 'quota' | 'unauthorised' | 'unknown' | 'unreachable'

/** Thrown by `withDeadline`. Named so `classifySearchFailure` can recognise it without importing it. */
export class SearchDeadlineError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} exceeded ${ms}ms`)
    this.name = 'SearchDeadlineError'
  }
}

/**
 * What went wrong, in this application's vocabulary rather than the provider's.
 *
 * **Duck-typed on purpose.** Importing `ApiError` from the SDK would drag the provider into a module
 * the harness and the browser both load, and `instanceof` across a bundler boundary is unreliable
 * anyway. A status number and a name are all that is needed.
 *
 * Every class maps to the **same** customer-facing state — the shop cannot explain a quota to
 * somebody buying a coat — and to a **different** operator log line, which is the whole value:
 * `missing-index` names `pnpm reindex`, `unauthorised` names the key, `quota` names the plan.
 */
export function classifySearchFailure(error: unknown): SearchFailure {
  if (error instanceof SearchDeadlineError) {
    return 'unreachable'
  }

  const candidate = error as { name?: unknown; status?: unknown } | null

  if (candidate && typeof candidate === 'object') {
    if (candidate.name === 'SearchDeadlineError' || candidate.name === 'RetryError') {
      return 'unreachable'
    }

    const status = typeof candidate.status === 'number' ? candidate.status : null

    if (status === 400) return 'bad-request'
    if (status === 401 || status === 403) return 'unauthorised'
    if (status === 404) return 'missing-index'
    if (status === 402 || status === 429) return 'quota'
  }

  return 'unknown'
}

/** The operator's next move, per class. Never shown to a customer. */
export const SEARCH_FAILURE_HINT: Record<SearchFailure, string> = {
  'bad-request': 'The query was rejected. Check the term clamp in lib/catalog/search.ts.',
  'missing-index': 'The index does not exist in this environment. Run `pnpm reindex`.',
  quota: 'The Algolia plan limit was reached. Search degrades; browsing is unaffected.',
  unauthorised: 'The Algolia key was rejected. Check NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY.',
  unknown: 'Unrecognised search failure. The raw error is logged beside this line.',
  unreachable: 'Algolia did not answer in time. Browsing is unaffected.',
}

/**
 * Reject after `ms` regardless of what the underlying promise does.
 *
 * The SDK's `timeouts` bound one socket attempt and it retries across four hosts with an escalating
 * timeout, so the observable worst case is far longer than any single number configured there. This
 * is what actually bounds a page render.
 *
 * The timer is always cleared, including on the success path — an un-cleared timer keeps the Node
 * event loop alive and turns a fast request into a hung script under the CLI.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new SearchDeadlineError(label, ms)), ms)
  })

  return Promise.race([promise, deadline]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }) as Promise<T>
}

/* -------------------------------------------------------------------------------------------------
 * The state machine
 * ---------------------------------------------------------------------------------------------- */

export type SearchState =
  /** Nothing typed yet. The panel shows recent, popular and browse suggestions. */
  | 'idle'
  /** Typed, but under the typeahead floor. */
  | 'tooShort'
  /** A request is in flight and there is nothing settled to show. */
  | 'loading'
  /** Results, and there is at least one. */
  | 'results'
  /** A real answer: the engine looked and found nothing. */
  | 'empty'
  /** The engine answered but Postgres dropped every id — a stale index, not an empty shop. */
  | 'stale'
  /** The engine could not be reached, or is not configured. */
  | 'unavailable'

export type SearchStateInput = {
  /** How many cards actually resolved from Postgres. */
  cardCount: number
  engine: CatalogResult['engine']
  /** True while a request is in flight. */
  pending: boolean
  /** True when the engine reported hits that Postgres then dropped. */
  stale: boolean
  status: SearchTermStatus
}

/**
 * **Total and mutually exclusive.** Exactly one state for every input, and every state reachable.
 *
 * The branch order is the priority, and two of them are the whole reason this is a function rather
 * than a chain of `if`s inside a component:
 *
 * - **`unavailable` outranks everything.** A failed search has a `cardCount` of zero and so does an
 *   empty one. Deciding "empty" first is exactly how an outage comes to say *"nothing matches your
 *   search"* — which blames the customer's taste for the service being down.
 * - **`stale` outranks `empty`.** The engine found hits and Postgres refused them, which is §12.1d's
 *   *"deleted product still in index"* and *"product unpublished after index update"*. "Nothing
 *   matched" would be false: something matched, and it has just gone.
 */
export function searchState({
  cardCount,
  engine,
  pending,
  stale,
  status,
}: SearchStateInput): SearchState {
  if (engine === 'unavailable') {
    return 'unavailable'
  }

  if (status === 'empty') {
    return 'idle'
  }

  if (status === 'tooShort') {
    return 'tooShort'
  }

  if (cardCount > 0) {
    return 'results'
  }

  if (pending) {
    return 'loading'
  }

  return stale ? 'stale' : 'empty'
}

/**
 * The one sentence each state shows.
 *
 * **No word here names a mechanism.** Structure §1 lists "search indexes" among the things a
 * customer should never need to understand, and `verify:search` asserts that none of these strings —
 * nor the shipped empty and unavailable components — contains `Algolia`, `index`, `facet`, `quota`,
 * `replica`, `objectID` or `CMS`. That check exists because the shipped `CatalogEmpty` copy said
 * *"the search index has not caught up"* until this phase corrected it.
 */
export const SEARCH_COPY: Record<SearchState, { body: string; title: string }> = {
  empty: {
    body: 'Try fewer words, or a different spelling. The categories below are a good place to start.',
    title: 'Nothing matched.',
  },
  idle: { body: 'Search by name, colour, size or category.', title: 'What are you looking for?' },
  loading: { body: 'One moment.', title: 'Looking…' },
  results: { body: '', title: '' },
  stale: {
    body: 'They sold out or were withdrawn a moment ago. Try again, or browse a category below.',
    title: 'Those pieces have just gone.',
  },
  tooShort: { body: 'Keep typing — two characters or more.', title: 'Keep going.' },
  unavailable: {
    body: 'Search is not responding right now. Browsing by category still works normally.',
    title: 'Search is briefly unavailable.',
  },
}

/**
 * The unavailable sentence, which differs by *what* the customer was doing.
 *
 * On `/shop` they applied a colour filter and only the filter is broken; on `/search` the search
 * itself is. Telling a searching customer to "clear the filters to see everything" — which the
 * shipped `CatalogUnavailable` copy did — offers to erase the thing they came for.
 */
export function unavailableCopy(scope: 'filters' | 'search'): { body: string; title: string } {
  return scope === 'search'
    ? SEARCH_COPY.unavailable
    : {
        body: 'Colour, size and collection filters are not responding. The shop itself is unaffected — browse by category, or clear the filters to see everything.',
        title: 'Filtering is briefly unavailable.',
      }
}

/* -------------------------------------------------------------------------------------------------
 * Counts
 * ---------------------------------------------------------------------------------------------- */

/**
 * The count to print, reconciled against what actually rendered.
 *
 * The engine reports `nbHits`; Postgres then drops any id that is no longer listable. On a single
 * page those two can disagree, and printing the engine's number over a shorter grid is the
 * self-contradiction Phase 11's audit found in a different form.
 *
 * The rule: when the page came back short, the engine's total is provably too high by at least the
 * shortfall, so subtract it. Never negative, and never below what is on screen.
 */
export function correctedTotal(
  nbHits: number,
  requestedCount: number,
  resolvedCount: number,
): number {
  const dropped = Math.max(0, requestedCount - resolvedCount)

  return Math.max(resolvedCount, Math.max(0, nbHits - dropped))
}

/* -------------------------------------------------------------------------------------------------
 * Recent searches
 * ---------------------------------------------------------------------------------------------- */

/**
 * Is this term safe to *remember*?
 *
 * Recent searches persist in the customer's browser and render on every panel open, so the bar is
 * higher than for running a query once. An address and a long digit run are the two shapes somebody
 * pastes into a search box by accident, and neither should still be on screen tomorrow.
 *
 * This is not a security control — `localStorage` is the customer's own — it is not keeping their
 * mistake in front of them.
 */
export function isStorableTerm(term: string): boolean {
  if (/@/u.test(term)) {
    return false
  }

  return !/\d{9,}/u.test(term.replace(/[\s-]/gu, ''))
}

const recentKey = (term: string): string => term.normalize('NFC').toLowerCase()

/**
 * Most-recent-first, de-duplicated case-insensitively, capped.
 *
 * De-duplication is on the **folded** key while the stored value is **what was typed**, so searching
 * `Merino` after `merino` moves the entry rather than adding a second one, and the customer still
 * sees their own capitalisation.
 *
 * Idempotent: `push(push(list, q), q)` deep-equals `push(list, q)`, which the harness asserts —
 * because the panel writes on every submit, and a customer who searches the same thing twice must
 * not end up with a list of one repeated term.
 */
export function pushRecentSearch(list: readonly string[], term: string): string[] {
  const normalised = normaliseSearchTerm(term)

  if (normalised.term === null || !isStorableTerm(normalised.term)) {
    return [...list]
  }

  const key = recentKey(normalised.term)

  return [normalised.term, ...list.filter((entry) => recentKey(entry) !== key)].slice(
    0,
    RECENT_SEARCH_LIMIT,
  )
}

/**
 * Parse whatever `localStorage` held, and never throw.
 *
 * Storage is customer-writable and survives deployments, so the input is genuinely arbitrary: a
 * half-written JSON string, an array of numbers from an older shape, a 10,000-entry list, a
 * 5,000-character entry. Everything unusable is dropped and the result is capped, so a corrupted
 * store degrades to fewer recent searches rather than to a broken panel.
 */
export function readRecentSearches(raw: unknown): string[] {
  let parsed: unknown = raw

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }

  if (!Array.isArray(parsed)) {
    return []
  }

  const out: string[] = []

  for (const entry of parsed) {
    if (typeof entry !== 'string') {
      continue
    }

    const { status, term } = normaliseSearchTerm(entry)

    if (term === null || status !== 'ok' || !isStorableTerm(term)) {
      continue
    }

    if (!out.some((existing) => recentKey(existing) === recentKey(term))) {
      out.push(term)
    }

    if (out.length >= RECENT_SEARCH_LIMIT) {
      break
    }
  }

  return out
}

/* -------------------------------------------------------------------------------------------------
 * Navigation
 * ---------------------------------------------------------------------------------------------- */

/**
 * Should submitting replace the history entry rather than push one?
 *
 * §12.1d's *"repeated query submission"*. Pressing Enter twice on the same term must not put the
 * same URL into history twice, or Back becomes a no-op the customer has to press repeatedly to
 * escape. A different term gets its own entry.
 */
export function shouldReplaceHistory(currentHref: string, nextHref: string): boolean {
  return currentHref === nextHref
}

/** A category suggestion goes to its shop route — the one `documentHref` already produces. */
export const categorySuggestionHref = (slug: string): string => `/shop/${encodeURIComponent(slug)}`

/**
 * A collection suggestion goes to the **shop, filtered** — not to `/collections/<slug>`.
 *
 * `documentHref('collections', …)` returns `/collections/<slug>`, and there is no such route: Phase
 * 23 builds it. Linking there from a panel shipping this phase would be a suggestion that 404s.
 * `/shop?collection=<slug>` is a page that exists today and answers the same intent.
 */
export const collectionSuggestionHref = (slug: string): string =>
  `/shop?collection=${encodeURIComponent(slug)}`

/* -------------------------------------------------------------------------------------------------
 * Vocabulary matching
 * ---------------------------------------------------------------------------------------------- */

const fold = (value: string): string => value.normalize('NFD').replace(COMBINING, '').toLowerCase()

/**
 * Category and collection suggestions, matched locally.
 *
 * These come from the **vocabulary Postgres already gave us**, not from the index, and that is what
 * makes §A.5 achievable: when Algolia is unavailable the panel still offers categories and
 * collections, because nothing about them ever needed the engine.
 *
 * Accent- and case-folded, so `edit` matches `Édit`. Prefix matches rank above substring matches —
 * somebody typing `sho` means Shorts before Fisherman Shorts.
 */
export function matchVocabulary(
  term: string,
  options: readonly FacetOption[],
  limit: number,
): FacetOption[] {
  const needle = fold(term)

  if (needle === '') {
    return []
  }

  const prefix: FacetOption[] = []
  const substring: FacetOption[] = []

  for (const option of options) {
    const haystack = fold(option.label)

    if (haystack.startsWith(needle)) {
      prefix.push(option)
    } else if (haystack.includes(needle)) {
      substring.push(option)
    }
  }

  return [...prefix, ...substring].slice(0, limit)
}

/* -------------------------------------------------------------------------------------------------
 * Keyboard
 * ---------------------------------------------------------------------------------------------- */

/**
 * The roving-selection reducer for the combobox, as a pure function.
 *
 * `-1` means "nothing selected", which is a real state rather than an absence: it is where the
 * customer is after typing but before pressing a key, and Enter there must submit the term rather
 * than activate an option they never chose.
 *
 * Wrapping is deliberate in both directions — ArrowUp from nothing selects the **last** option,
 * which is what a native listbox does and what somebody reaching for the bottom of a short list
 * expects.
 */
export function nextOptionIndex(
  current: number,
  count: number,
  key: 'ArrowDown' | 'ArrowUp' | 'End' | 'Home',
): number {
  if (count <= 0) {
    return -1
  }

  switch (key) {
    case 'ArrowDown':
      return current >= count - 1 ? 0 : current + 1
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1
    case 'Home':
      return 0
    case 'End':
      return count - 1
  }
}
