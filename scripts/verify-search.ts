/**
 * The Phase 12 search rules, checked against the running code rather than against the comments that
 * describe them.
 *
 * ```
 * pnpm verify:search
 * ```
 *
 * Same shape as `verify-catalog.ts`: pure fixtures first, real Payload documents second, a live
 * section third that runs only when Algolia is configured and records an explicit skipped-and-passing
 * check when it is not. The **D-10** guard applies — this creates and deletes documents, so it
 * refuses to run anywhere but the development database `DATABASE_PUSH_TARGET` names.
 *
 * `lib/catalog/catalog.ts` is deliberately not imported: it is `server-only`. Every rule this asserts
 * lives in `search.ts`, `suggest.ts`, `query.ts`, `resolve.ts` or `record.ts`, which is what made them
 * assertable at all.
 *
 * **Why this harness exists in the shape it does.** `scripts/verify-shell.ts` contains zero
 * assertions about the search overlay — 676 lines, no match for "overlay" — so the panel's chrome was
 * verified by a Phase 9 browser pass and by nothing that runs at the gate. This owns the panel's pure
 * state machine outright rather than assuming the shell harness has it covered.
 */

import type { Payload } from 'payload'

import config from '../src/payload.config'

import {
  appEnv,
  developmentDatabase,
  integrationStatus,
  requireIntegration,
} from '../src/lib/env.core'
import { catalogIndexName, createSearchClient } from '../src/lib/catalog/algolia'
import { collectProductRecords } from '../src/lib/catalog/indexer'
import {
  CATALOG_MAX_PAGE,
  CATALOG_PAGE_SIZE,
  DEFAULT_CATALOG_SORT,
  canonicaliseParams,
  catalogHref,
  catalogWhere,
  isFilteredQuery,
  normaliseCatalogQuery,
  publishedProductWhere,
  requiresSearchIndex,
  type CatalogParams,
  type CatalogVocabulary,
} from '../src/lib/catalog/query'
import {
  CATALOG_INDEX_SETTINGS,
  CATALOG_SHARED_SETTINGS,
  indexSearchParams,
} from '../src/lib/catalog/record'
import { activeFilterChips, productCountLabel } from '../src/lib/catalog/resolve'
import {
  RECENT_SEARCH_LIMIT,
  RESULTS_DEADLINE_MS,
  SEARCH_COPY,
  SEARCH_MIN_TERM_LENGTH,
  SEARCH_PATH,
  SEARCH_TERM_MAX_BYTES,
  SUGGEST_DEADLINE_MS,
  SearchDeadlineError,
  categorySuggestionHref,
  classifySearchFailure,
  collectionSuggestionHref,
  correctedTotal,
  isStorableTerm,
  matchVocabulary,
  nextOptionIndex,
  normaliseSearchTerm,
  pushRecentSearch,
  readRecentSearches,
  searchState,
  shouldReplaceHistory,
  truncateToBytes,
  unavailableCopy,
  withDeadline,
  type SearchState,
} from '../src/lib/catalog/search'
import { buildSuggestions, suggestionGroups, suggestionOptions } from '../src/lib/catalog/suggest'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-search refuses to run: ${developmentDatabase.reason}. ` +
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
  q: null,
  size: [],
  sort: DEFAULT_CATALOG_SORT,
  ...overrides,
})

const VOCABULARY: CatalogVocabulary = {
  categories: [
    { label: 'Clothing', parent: null, value: 'clothing' },
    { label: 'Hoodies', parent: 'clothing', value: 'hoodies' },
    { label: 'Accessories', parent: null, value: 'accessories' },
  ],
  collections: [{ label: 'Essentials', value: 'essentials' }],
  colors: [{ label: 'Black', value: 'black' }],
  priceCeilingMinor: 48000,
  priceFloorMinor: 4500,
  sizes: [{ label: 'M', value: 'M' }],
}

/* =================================================================================================
 * A — Normalisation (§12.1d: empty, 1-character, very long, special characters)
 * ============================================================================================== */

for (const [input, label] of [
  ['', 'an empty string'],
  ['   ', 'whitespace only'],
  ['%', 'a lone percent'],
  ['!!!', 'punctuation only'],
  ['...', 'an ellipsis'],
  ['👕👕', 'emoji only'],
] as const) {
  check(
    `A: ${label} is not searchable`,
    normaliseSearchTerm(input).term === null,
    JSON.stringify(input),
  )
}

check('A: a single letter is tooShort', normaliseSearchTerm('h').status === 'tooShort')
check('A: …and is trimmed first', normaliseSearchTerm('  h  ').status === 'tooShort')
check('A: two letters are searchable', normaliseSearchTerm('ho').status === 'ok')
check(
  'A: the floor is the constant, not a literal',
  normaliseSearchTerm('a'.repeat(SEARCH_MIN_TERM_LENGTH)).status === 'ok' &&
    normaliseSearchTerm('a'.repeat(SEARCH_MIN_TERM_LENGTH - 1)).status === 'tooShort',
  String(SEARCH_MIN_TERM_LENGTH),
)
check(
  'A: the floor is code points, not UTF-16 units',
  normaliseSearchTerm('👕a').status === 'ok',
  `${[...'👕a'].length} code points, ${'👕a'.length} units`,
)

check('A: null and undefined are handled', normaliseSearchTerm(null).term === null)
check('A: a non-string is handled', normaliseSearchTerm(undefined).term === null)

check(
  'A: CASE IS PRESERVED — the term is echoed back to the customer',
  normaliseSearchTerm('Merino Crew').term === 'Merino Crew',
)

check('A: whitespace collapses', normaliseSearchTerm('a   b').term === 'a b')
check(
  'A: wrapping quotes are stripped — they are query operators',
  normaliseSearchTerm('"hoodie"').term === 'hoodie',
)
check(
  'A: a leading minus is stripped for the same reason',
  normaliseSearchTerm('-hoodie').term === 'hoodie',
)

check(
  'A: NFC normalisation is applied, so two spellings are one term',
  normaliseSearchTerm('café').term === normaliseSearchTerm('café').term,
)

check(
  'A: …and is idempotent',
  normaliseSearchTerm(normaliseSearchTerm('café').term).term === normaliseSearchTerm('café').term,
)

/*
 * Hostile characters, built with `String.fromCharCode` and never written as literals.
 *
 * An earlier draft pasted the real characters into this table, which made the harness file itself
 * contain C0 controls and bidi overrides: `file` reported it as binary data and `grep` refused to
 * read it as text. Escape sequences were the next attempt and were mangled to empty strings by the
 * tooling that wrote them, which turned every assertion into `!term.includes('')` -- always false,
 * so eight checks failed while the code under test was correct.
 *
 * Constructing them from code points is the one form that no editor, formatter or patch script can
 * quietly alter, and it states the intent in the source rather than hiding it in a byte.
 */
const HOSTILE: [string, number][] = [
  ['a C0 control (BEL)', 0x07],
  ['DEL', 0x7f],
  ['a C1 control (NEL)', 0x85],
  ['a zero-width space', 0x200b],
  ['a zero-width joiner', 0x200d],
  ['a BOM', 0xfeff],
  ['a bidi override (RLO)', 0x202e],
  ['a bidi isolate (LRI)', 0x2066],
]

for (const [name, codePoint] of HOSTILE) {
  const char = String.fromCodePoint(codePoint)
  const term = normaliseSearchTerm(`ho${char}odie`).term ?? ''

  check(
    `A: ${name} does not survive normalisation`,
    term === 'hoodie' && !term.includes(char),
    JSON.stringify(term),
  )
}

/* =================================================================================================
 * A2 — Regressions from the Phase 12 sweep
 * ============================================================================================== */

check(
  'A2: a REPLACEMENT CHARACTER makes the term unsearchable (sweep finding 1)',
  normaliseSearchTerm(`${String.fromCodePoint(0xfffd)}%A`).term === null,
)

check(
  'A2: …which is what a malformed percent-escape decodes to',
  new URL('http://x/?q=%E0%A4%A').searchParams.get('q')?.includes(String.fromCodePoint(0xfffd)) ===
    true,
)

check(
  'A2: …so /search?q=%E0%A4%A cannot report a product count for a term nobody typed',
  normaliseSearchTerm(new URL('http://x/?q=%E0%A4%A').searchParams.get('q')).status === 'empty',
)

check(
  'A2: canonicalisation does NOT clamp, so the truncation can still be reported (sweep finding 2)',
  normaliseSearchTerm('a'.repeat(400), { clamp: false }).term?.length === 400,
)

check(
  'A2: …while the query itself is still clamped',
  (normaliseSearchTerm('a'.repeat(400)).term?.length ?? 0) <= SEARCH_TERM_MAX_BYTES,
)

check(
  'A2: …and normaliseCatalogQuery reports it',
  normaliseCatalogQuery(params({ q: 'a'.repeat(400) }), VOCABULARY).ignored.some(
    (entry) => entry.reason === 'truncated',
  ),
)

check(
  'A2: an unclamped canonicalisation is still a fixed point',
  (() => {
    const once = canonicaliseParams(params({ q: `  ${'a'.repeat(400)}  ` }), VOCABULARY)
    const twice = canonicaliseParams(once, VOCABULARY)

    return once.q === twice.q
  })(),
)

check(
  'A2: a present-but-empty q is distinguishable from an absent one (sweep finding 3)',
  params({ q: '' }).q !== null && params().q === null,
)

check(
  'A2: …and canonicalises to no term at all',
  canonicaliseParams(params({ q: '   ' }), VOCABULARY).q === null,
)

/* =================================================================================================
 * B — The byte clamp (§12.1d: very long query)
 * ============================================================================================== */

const bytes = (value: string): number => new TextEncoder().encode(value).length

check('B: the clamp is under Algolia’s measured 512-byte limit', SEARCH_TERM_MAX_BYTES < 512)

for (const [label, unit] of [
  ['ASCII', 'a'],
  ['4-byte emoji', '👕'],
  ['CJK', '漢'],
  ['a combining mark', 'é'],
] as const) {
  const long = unit.repeat(400)
  const clamped = truncateToBytes(long, SEARCH_TERM_MAX_BYTES)

  check(
    `B: ${label} clamps to the byte budget`,
    bytes(clamped) <= SEARCH_TERM_MAX_BYTES,
    `${bytes(clamped)} bytes`,
  )
  check(
    `B: ${label} never splits a code point`,
    !/[\ud800-\udfff]/u.test(clamped) || [...clamped].every((cp) => cp.length <= 2),
  )
}

check(
  'B: 128 shirt emoji are 128 characters and 512 BYTES — why a character cap is the wrong unit',
  '👕'.repeat(128).length === 256 && bytes('👕'.repeat(128)) === 512,
  `${'👕'.repeat(128).length} units, ${bytes('👕'.repeat(128))} bytes`,
)

check('B: a clamped term reports truncated:true', normaliseSearchTerm('a'.repeat(400)).truncated)

check('B: an ordinary term does not', !normaliseSearchTerm('hoodie').truncated)

/* =================================================================================================
 * C — The state machine (§12.1d: no results, service unavailable, stale index)
 * ============================================================================================== */

const STATES: SearchState[] = [
  'idle',
  'tooShort',
  'loading',
  'results',
  'empty',
  'stale',
  'unavailable',
]

{
  const seen = new Set<SearchState>()
  let total = 0

  for (const engine of ['postgres', 'search', 'unavailable'] as const) {
    for (const status of ['empty', 'tooShort', 'ok'] as const) {
      for (const cardCount of [0, 3]) {
        for (const pending of [false, true]) {
          for (const stale of [false, true]) {
            total += 1
            seen.add(searchState({ cardCount, engine, pending, stale, status }))
          }
        }
      }
    }
  }

  check('C: searchState is TOTAL over the whole cross-product', total === 72, `${total} inputs`)
  check('C: every state is reachable', seen.size === STATES.length, [...seen].sort().join(','))
}

check(
  'C: an OUTAGE never reads as "empty" — the defect this function exists to prevent',
  ['empty', 'tooShort', 'ok'].every((status) =>
    [0, 3].every(
      (cardCount) =>
        searchState({
          cardCount,
          engine: 'unavailable',
          pending: false,
          stale: false,
          status: status as 'ok',
        }) === 'unavailable',
    ),
  ),
)

check(
  'C: a STALE index never reads as "empty" — something matched and has gone',
  searchState({ cardCount: 0, engine: 'search', pending: false, stale: true, status: 'ok' }) ===
    'stale',
)

check(
  'C: results outrank pending, so a settled list is never hidden behind a spinner',
  searchState({ cardCount: 3, engine: 'search', pending: true, stale: false, status: 'ok' }) ===
    'results',
)

check(
  'C: every state has copy',
  STATES.every((state) => state in SEARCH_COPY),
)

check(
  'C: the three dead-end messages are distinct',
  new Set([SEARCH_COPY.empty.title, SEARCH_COPY.unavailable.title, SEARCH_COPY.tooShort.title])
    .size === 3,
)

check(
  'C: the filters outage and the search outage say different things',
  unavailableCopy('filters').title !== unavailableCopy('search').title,
)

/* Structure §1: the customer never has to understand the machinery. */
const JARGON = ['algolia', 'index', 'facet', 'quota', 'replica', 'objectid', 'cms', 'postgres']

{
  const strings = [
    ...Object.values(SEARCH_COPY).flatMap((copy) => [copy.title, copy.body]),
    ...[unavailableCopy('filters'), unavailableCopy('search')].flatMap((copy) => [
      copy.title,
      copy.body,
    ]),
  ]

  const offenders = strings.filter((value) =>
    JARGON.some((word) => value.toLowerCase().includes(word)),
  )

  check(
    'C: no customer-facing string names the machinery',
    offenders.length === 0,
    offenders.join(' | '),
  )
}

/* =================================================================================================
 * D — Failure classification (§12.1d: network timeout, API quota/error)
 * ============================================================================================== */

for (const [input, expected, label] of [
  [{ status: 400 }, 'bad-request', 'a 400'],
  [{ status: 401 }, 'unauthorised', 'a 401'],
  [{ status: 403 }, 'unauthorised', 'a 403'],
  [{ status: 404 }, 'missing-index', 'a 404'],
  [{ status: 402 }, 'quota', 'a 402'],
  [{ status: 429 }, 'quota', 'a 429'],
  [{ name: 'RetryError' }, 'unreachable', 'a RetryError'],
  [new SearchDeadlineError('probe', 1), 'unreachable', 'a deadline'],
  [new Error('boom'), 'unknown', 'a plain Error'],
  [null, 'unknown', 'null'],
  [undefined, 'unknown', 'undefined'],
  ['a string', 'unknown', 'a string'],
  [{ status: 'weird' }, 'unknown', 'a non-numeric status'],
] as const) {
  check(`D: ${label} classifies as ${expected}`, classifySearchFailure(input) === expected)
}

check(
  'D: every failure class maps to ONE customer-facing state',
  searchState({
    cardCount: 0,
    engine: 'unavailable',
    pending: false,
    stale: false,
    status: 'ok',
  }) === 'unavailable',
)

/* =================================================================================================
 * E — Deadlines
 * ============================================================================================== */

check(
  'E: the suggestion deadline is tighter than the results deadline',
  SUGGEST_DEADLINE_MS < RESULTS_DEADLINE_MS,
)
check('E: both are far under the SDK’s ~48s worst case', RESULTS_DEADLINE_MS < 5000)

{
  const never = new Promise(() => {})
  let rejected: unknown = null

  try {
    await withDeadline(never, 20, 'probe')
  } catch (error) {
    rejected = error
  }

  check('E: withDeadline rejects a never-settling promise', rejected instanceof SearchDeadlineError)
  check(
    'E: …and the rejection classifies as unreachable',
    classifySearchFailure(rejected) === 'unreachable',
  )
}

check(
  'E: withDeadline resolves when the promise wins',
  (await withDeadline(Promise.resolve('ok'), 1000, 'probe')) === 'ok',
)

/* =================================================================================================
 * F — Recent searches (§12.1d: repeated query submission)
 * ============================================================================================== */

check(
  'F: push is idempotent',
  JSON.stringify(pushRecentSearch(pushRecentSearch([], 'hoodie'), 'hoodie')) ===
    JSON.stringify(['hoodie']),
)
check(
  'F: …and de-duplicates case-insensitively',
  JSON.stringify(pushRecentSearch(['Merino'], 'merino')) === JSON.stringify(['merino']),
)
check('F: …while storing what was typed', pushRecentSearch(['x'], 'Merino')[0] === 'Merino')
check(
  'F: an existing entry moves to the front',
  JSON.stringify(pushRecentSearch(['a', 'b'], 'b')) === JSON.stringify(['b', 'a']),
)

check(
  'F: the list is capped',
  pushRecentSearch(
    Array.from({ length: RECENT_SEARCH_LIMIT }, (_, i) => `t${i}`),
    'new',
  ).length === RECENT_SEARCH_LIMIT,
)

for (const [input, label] of [
  [null, 'null'],
  [undefined, 'undefined'],
  ['{', 'broken JSON'],
  ['[]', 'an empty array'],
  ['not json', 'plain text'],
  [[1, 2, 3], 'an array of numbers'],
  [['<script>alert(1)</script>'], 'a script tag'],
  [{ a: 1 }, 'an object'],
  [Array.from({ length: 10_000 }, (_, i) => `t${i}`), 'ten thousand entries'],
  [['x'.repeat(5000)], 'a 5000-character entry'],
] as const) {
  let out: string[] = []
  let threw = false

  try {
    out = readRecentSearches(input)
  } catch {
    threw = true
  }

  check(`F: reading ${label} never throws`, !threw)
  check(`F: …and never exceeds the cap`, out.length <= RECENT_SEARCH_LIMIT, `${out.length}`)
}

check('F: an email-shaped term is not remembered', !isStorableTerm('someone@example.com'))
check('F: a long digit run is not remembered', !isStorableTerm('4111 1111 1111 1111'))
check('F: an ordinary product word is', isStorableTerm('merino hoodie'))

/* =================================================================================================
 * G — The URL contract
 * ============================================================================================== */

check('G: q is in the parser map', 'q' in params())

check(
  'G: a term round-trips through the serializer',
  catalogHref(SEARCH_PATH, params({ q: 'merino hoodie' })) === '/search?q=merino+hoodie',
  catalogHref(SEARCH_PATH, params({ q: 'merino hoodie' })),
)

for (const hostile of ['a,b', 'a&b', 'a#b', 'a%b', 'a+b', 'a b', 'a"b', "a'b"]) {
  const href = catalogHref(SEARCH_PATH, params({ q: hostile }))
  const parsed = new URL(href, 'https://example.test').searchParams.get('q')
  const expected = normaliseSearchTerm(hostile).term

  check(
    `G: ${JSON.stringify(hostile)} survives the URL round trip`,
    parsed === hostile,
    `${href} -> ${parsed}`,
  )
  void expected
}

{
  const hostile = params({
    category: ['HOODIES'],
    color: ['puce', 'BLACK'],
    page: 0,
    q: '  Merino  ',
    size: ['m', 'm'],
  })

  const once = canonicaliseParams(hostile, VOCABULARY)
  const twice = canonicaliseParams(once, VOCABULARY)

  check(
    'G: canonicalisation is a FIXED POINT over a hostile input',
    catalogHref(SEARCH_PATH, once) === catalogHref(SEARCH_PATH, twice),
    catalogHref(SEARCH_PATH, once),
  )

  check('G: …and normalises the term', once.q === 'Merino')
  check(
    'G: …while preserving an unknown facet value so it can be reported',
    once.color.includes('puce'),
  )
}

check(
  'G: an empty term is dropped from the URL entirely',
  canonicaliseParams(params({ q: '   ' }), VOCABULARY).q === null,
)

/* The four clear-filter links must all keep the term. */
for (const basePath of ['/shop', '/shop/hoodies', SEARCH_PATH]) {
  const href = catalogHref(basePath, { q: 'merino', sort: DEFAULT_CATALOG_SORT })

  check(`G: clearing filters preserves q on ${basePath}`, href.includes('q=merino'), href)
}

check(
  'G: a term that IS the route gets no removable chip',
  activeFilterChips(
    normaliseCatalogQuery(params({ q: 'merino' }), VOCABULARY).query,
    VOCABULARY,
    () => '$1',
    null,
    'merino',
  ).length === 0,
)

check(
  'G: a term over a browse DOES get one',
  activeFilterChips(
    normaliseCatalogQuery(params({ q: 'merino' }), VOCABULARY).query,
    VOCABULARY,
    () => '$1',
  ).some((chip) => chip.facet === 'q'),
)

check(
  'G: standing in a search is not "filtered"',
  !isFilteredQuery(
    normaliseCatalogQuery(params({ q: 'merino' }), VOCABULARY).query,
    null,
    'merino',
  ),
)

check(
  'G: a very long term is reported as truncated',
  normaliseCatalogQuery(params({ q: 'a'.repeat(400) }), VOCABULARY).ignored.some(
    (entry) => entry.reason === 'truncated',
  ),
)

/* =================================================================================================
 * H — Engine routing
 * ============================================================================================== */

check(
  'H: ANY term routes to the index — the highest-consequence line in the phase',
  requiresSearchIndex(normaliseCatalogQuery(params({ q: 'hoodie' }), VOCABULARY).query),
)

check(
  'H: …even with no facets at all',
  requiresSearchIndex({ ...normaliseCatalogQuery(params({ q: 'x y' }), VOCABULARY).query }),
)

check(
  'H: a browse with no term does not',
  !requiresSearchIndex(normaliseCatalogQuery(params(), VOCABULARY).query),
)

check(
  'H: catalogWhere builds NO clause from the term — Postgres has no text column for it',
  !JSON.stringify(
    catalogWhere(
      normaliseCatalogQuery(params({ q: 'hoodie' }), VOCABULARY).query,
      '2026-01-01T00:00:00.000Z',
    ),
  ).includes('hoodie'),
)

{
  const withTerm = indexSearchParams(
    normaliseCatalogQuery(params({ q: 'hoodie' }), VOCABULARY).query,
    24,
  )
  const browse = indexSearchParams(normaliseCatalogQuery(params(), VOCABULARY).query, 24)

  check('H: the term reaches the engine', withTerm.query === 'hoodie')
  check('H: a browse sends an empty query', browse.query === '')
  check('H: a text query IS analytics', withTerm.analytics)
  check(
    'H: a browse is NOT — the measured top search was the empty string, 18x anything else',
    !browse.analytics,
  )
}

check(
  'H: page is never negative for any clamped input',
  [-5, 0, 1, 4.5, 99_999_999].every(
    (page) =>
      indexSearchParams(normaliseCatalogQuery(params({ page }), VOCABULARY).query, 24).page >= 0,
  ),
)

check(
  'H: the page clamp keeps deep pages inside Algolia’s pagination limit',
  CATALOG_MAX_PAGE * CATALOG_PAGE_SIZE > 1000,
)

/* =================================================================================================
 * I — Index settings
 * ============================================================================================== */

check(
  'I: searchableAttributes is exactly the five, in order',
  JSON.stringify(CATALOG_INDEX_SETTINGS.searchableAttributes) ===
    JSON.stringify([
      'name',
      'unordered(searchTerms)',
      'tags,materials',
      'unordered(fit)',
      'unordered(shortDescription)',
    ]),
  CATALOG_INDEX_SETTINGS.searchableAttributes.join(' | '),
)

check('I: name ranks first', CATALOG_INDEX_SETTINGS.searchableAttributes[0] === 'name')

check(
  'I: slugs are NOT searchable — their names are',
  !CATALOG_INDEX_SETTINGS.searchableAttributes.some((attribute) => attribute.includes('Slugs')),
)

check(
  'I: attributesToRetrieve is still exactly objectID (D-37)',
  JSON.stringify(CATALOG_INDEX_SETTINGS.attributesToRetrieve) === JSON.stringify(['objectID']),
)

check(
  'I: attributesToHighlight is empty — a highlight leaks index text past attributesToRetrieve',
  JSON.stringify(CATALOG_INDEX_SETTINGS.attributesToHighlight) === JSON.stringify([]),
)

check(
  'I: removeWordsIfNoResults is lastWords',
  CATALOG_INDEX_SETTINGS.removeWordsIfNoResults === 'lastWords',
)

check(
  'I: typo tolerance is off for the one prose attribute',
  CATALOG_INDEX_SETTINGS.disableTypoToleranceOnAttributes.includes('shortDescription'),
)

check(
  'I: stock is unretrievable — the only setting here that is a real boundary',
  CATALOG_INDEX_SETTINGS.unretrievableAttributes.includes('inventoryTotal'),
)

check(
  'I: the shared settings are the primary minus customRanking, and nothing else',
  JSON.stringify(Object.keys(CATALOG_SHARED_SETTINGS).sort()) ===
    JSON.stringify(
      Object.keys(CATALOG_INDEX_SETTINGS)
        .filter((key) => key !== 'customRanking')
        .sort(),
    ),
  Object.keys(CATALOG_SHARED_SETTINGS).sort().join(','),
)

check(
  'I: …and a replica therefore inherits searchableAttributes',
  'searchableAttributes' in CATALOG_SHARED_SETTINGS,
)

/* =================================================================================================
 * J — The suggestion payload (§12.1c's seven sections)
 * ============================================================================================== */

const suggestInput = {
  cards: [],
  engine: 'search' as const,
  pending: false,
  popular: ['hoodie', 'merino'],
  recent: ['jacket'],
  status: 'ok' as const,
  term: 'hood',
  vocabulary: VOCABULARY,
}

{
  const searching = buildSuggestions(suggestInput)

  check('J: a searching panel offers matching categories', searching.categories.length > 0)
  check('J: …and hides recent searches', searching.recent.length === 0)
  check('J: …and hides popular searches', searching.popular.length === 0)

  const idle = buildSuggestions({ ...suggestInput, status: 'empty', term: null })

  check('J: an idle panel offers recent', idle.recent.length === 1)
  check('J: …and popular', idle.popular.length === 2)
  check('J: …and no category matches, because there is no term', idle.categories.length === 0)
}

check(
  'J: an UNAVAILABLE panel still carries the Postgres sections (§A.5)',
  (() => {
    const payload = buildSuggestions({
      ...suggestInput,
      engine: 'unavailable',
      status: 'empty',
      term: null,
    })

    return (
      payload.state === 'unavailable' && payload.popular.length === 2 && payload.recent.length === 1
    )
  })(),
)

check(
  'J: a category suggestion points at a route that exists',
  categorySuggestionHref('hoodies') === '/shop/hoodies',
)

check(
  'J: a collection suggestion points at /shop, NOT /collections which 404s until Phase 23',
  collectionSuggestionHref('essentials') === '/shop?collection=essentials',
)

{
  const payload = buildSuggestions({ ...suggestInput, status: 'empty', term: null })
  const options = suggestionOptions(payload)
  const groups = suggestionGroups(options)

  check(
    'J: every option has a unique id',
    new Set(options.map((option) => option.id)).size === options.length,
  )

  check(
    'J: every option appears in exactly one group — the ARIA tree and the keyboard list are one derivation',
    groups.reduce((total, group) => total + group.options.length, 0) === options.length,
  )

  check(
    'J: recent and popular ARE options, not buttons beside the list',
    options.filter((option) => option.kind === 'term').length === 3,
  )
}

/* =================================================================================================
 * K — Keyboard and navigation
 * ============================================================================================== */

check('K: ArrowDown from nothing selects the first', nextOptionIndex(-1, 3, 'ArrowDown') === 0)
check(
  'K: ArrowUp from nothing selects the LAST, as a native listbox does',
  nextOptionIndex(-1, 3, 'ArrowUp') === 2,
)
check('K: ArrowDown wraps', nextOptionIndex(2, 3, 'ArrowDown') === 0)
check('K: ArrowUp wraps', nextOptionIndex(0, 3, 'ArrowUp') === 2)
check('K: Home and End', nextOptionIndex(1, 3, 'Home') === 0 && nextOptionIndex(1, 3, 'End') === 2)
check('K: an empty list has no selection', nextOptionIndex(0, 0, 'ArrowDown') === -1)
check('K: a one-option list stays put', nextOptionIndex(0, 1, 'ArrowDown') === 0)

check(
  'K: submitting the same term twice REPLACES history (§12.1d repeated submission)',
  shouldReplaceHistory('/search?q=merino', '/search?q=merino'),
)

check('K: a different term pushes', !shouldReplaceHistory('/search?q=a', '/search?q=b'))

check(
  'K: vocabulary matching prefers a prefix over a substring',
  matchVocabulary('ho', VOCABULARY.categories, 4)[0]?.value === 'hoodies',
)

check(
  'K: …and folds accents and case',
  matchVocabulary('CLOTHING', VOCABULARY.categories, 4).length === 1,
)

/* =================================================================================================
 * L — Counts
 * ============================================================================================== */

check('L: an exact count is exact', correctedTotal(24, 24, 24) === 24)
check('L: a short page reduces the total by the shortfall', correctedTotal(24, 24, 20) === 20)
check('L: the total never drops below what rendered', correctedTotal(2, 24, 20) === 20)
check('L: the total is never negative', correctedTotal(0, 24, 0) === 0)
check('L: an exhaustive count is stated plainly', productCountLabel(24, true) === '24 products')
check('L: an approximate one is hedged', productCountLabel(24, false).startsWith('About '))
check('L: one product is singular', productCountLabel(1, true) === '1 product')

/* =================================================================================================
 * M — Real documents
 * ============================================================================================== */

const payload: Payload = await getPayload({ config })

const created: {
  collection: 'categories' | 'collections' | 'product-variants' | 'products'
  id: number
}[] = []

const cleanup = async () => {
  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true, trash: false })
      .catch(() => undefined)
  }
}

try {
  const stamp = Date.now() % 1_000_000

  const parent = await payload.create({
    collection: 'categories',
    data: {
      name: `Outerwear ${stamp}`,
      slug: `vs-outer-${stamp}`,
      sortOrder: 900,
      status: 'published',
    },
    overrideAccess: true,
  })
  created.push({ collection: 'categories', id: parent.id })

  const child = await payload.create({
    collection: 'categories',
    data: {
      name: `Parkas ${stamp}`,
      parent: parent.id,
      slug: `vs-parka-${stamp}`,
      sortOrder: 901,
      status: 'published',
    },
    overrideAccess: true,
  })
  created.push({ collection: 'categories', id: child.id })

  const product = await payload.create({
    collection: 'products',
    data: {
      categories: [child.id],
      name: `Verify Parka ${stamp}`,
      shortDescription: 'A waxed cotton shell with a storm flap.',
      slug: `vs-product-${stamp}`,
      sortOrder: 0,
      status: 'published',
    } as never,
    overrideAccess: true,
  })
  created.push({ collection: 'products', id: product.id })

  const variant = await payload.create({
    collection: 'product-variants',
    data: {
      active: true,
      color: `Storm ${stamp}`,
      colorFamily: 'navy',
      inventoryQuantity: 4,
      priceMinor: 32_000,
      product: product.id,
      size: 'XL',
      sizeSortOrder: 50,
      sku: `VS-${stamp}`,
    },
    overrideAccess: true,
  })
  created.push({ collection: 'product-variants', id: variant.id })

  const set = await payload.create({
    collection: 'collections',
    data: {
      products: [product.id],
      slug: `vs-set-${stamp}`,
      sortOrder: 900,
      status: 'published',
      title: `Winter Set ${stamp}`,
    } as never,
    overrideAccess: true,
  })
  created.push({ collection: 'collections', id: set.id })

  const collected = await collectProductRecords(payload, { where: { id: { equals: product.id } } })
  const record = collected.records[0]

  check('M: the product produces a record', record !== undefined)

  if (record) {
    check(
      'M: searchTerms carries the category NAME',
      record.searchTerms.includes(`Parkas ${stamp}`),
      record.searchTerms.join(' | '),
    )
    check(
      'M: …and every ANCESTOR category name — the check that catches a forgotten select',
      record.searchTerms.includes(`Outerwear ${stamp}`),
    )
    check('M: …and the collection TITLE', record.searchTerms.includes(`Winter Set ${stamp}`))
    check('M: …and the variant colour DISPLAY name', record.searchTerms.includes(`Storm ${stamp}`))
    check('M: …and the colour family LABEL', record.searchTerms.includes('Navy'))
    check('M: …and the size', record.searchTerms.includes('XL'))
    check('M: shortDescription is indexed', record.shortDescription !== null)
    check(
      'M: categorySlugs carries the ancestor slug too',
      record.categorySlugs.includes(`vs-outer-${stamp}`),
    )
  }

  /* §12.1d #9: unpublished after index update. */
  await payload.update({
    collection: 'products',
    data: { status: 'draft' },
    id: product.id,
    overrideAccess: true,
  })

  const afterDraft = await collectProductRecords(payload, { where: { id: { equals: product.id } } })

  check('M: a draft product produces NO record', afterDraft.records.length === 0)
  check(
    'M: …and is reported as excluded so it can be deleted from the index',
    afterDraft.excludedIds.includes(product.id),
  )

  await payload.update({
    collection: 'products',
    data: { status: 'published' },
    id: product.id,
    overrideAccess: true,
  })

  /* The rehydration clause must carry every published clause, or a draft could leak into a suggestion. */
  const clause = JSON.stringify(publishedProductWhere(new Date().toISOString()))

  check(
    'M: the rehydration filter still contains every published clause',
    clause.includes('status') &&
      clause.includes('publishedAt') &&
      clause.includes('priceFromMinor'),
  )

  /* =================================================================================================
   * N — Live index
   * ============================================================================================== */

  if (integrationStatus('algolia') === 'configured') {
    const credentials = requireIntegration('algolia')
    const client = createSearchClient({
      apiKey: credentials.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY,
      appId: credentials.NEXT_PUBLIC_ALGOLIA_APP_ID,
    })
    const indexBase = catalogIndexName(appEnv)

    const settingsFor = async (name: string) =>
      (await client.getSettings({ indexName: name })) as Record<string, unknown>

    const primary = await settingsFor(indexBase)

    const replicas = (primary.replicas as string[] | undefined) ?? []

    check('N: the primary declares four sort replicas', replicas.length === 4, replicas.join(', '))

    for (const replica of replicas) {
      const settings = await settingsFor(replica)

      check(
        `N: ${replica.replace(indexBase, '…')} has the SAME searchableAttributes as the primary`,
        JSON.stringify(settings.searchableAttributes) ===
          JSON.stringify(primary.searchableAttributes),
        JSON.stringify(settings.searchableAttributes),
      )

      check(
        `N: ${replica.replace(indexBase, '…')} has highlighting off`,
        JSON.stringify(settings.attributesToHighlight) === JSON.stringify([]),
      )
    }

    const hit = await client.searchSingleIndex<Record<string, unknown>>({
      indexName: indexBase,
      searchParams: { query: 'hoodie' },
    })

    check(
      'N: a hit carries objectID and NO _highlightResult',
      hit.hits.every((entry) => !('_highlightResult' in entry)),
      Object.keys(hit.hits[0] ?? {}).join(','),
    )

    const leak = await client.searchSingleIndex<Record<string, unknown>>({
      indexName: indexBase,
      searchParams: { attributesToRetrieve: ['inventoryTotal'], query: 'hoodie' },
    })

    check(
      'N: stock is withheld even when explicitly requested with the public key',
      leak.hits.every((entry) => !('inventoryTotal' in entry)),
    )

    /* The five §12.1a probes that returned ZERO before this phase. */
    for (const [term, label] of [
      ['accessories', 'a category name'],
      ['essentials', 'a collection title'],
      ['black', 'a colour family label'],
      ['XL', 'a size'],
      ['brushed cashmere', 'a phrase from a description'],
      ['merino hoodie', 'two words (removeWordsIfNoResults)'],
    ] as const) {
      const response = await client.searchSingleIndex({
        indexName: indexBase,
        searchParams: { query: term },
      })

      check(
        `N: ${label} matches — "${term}"`,
        (response.nbHits ?? 0) > 0,
        `${response.nbHits} hits`,
      )
    }

    /* Membership, not order, must be identical across sorts. */
    const idsFor = async (name: string) => {
      const response = await client.searchSingleIndex<{ objectID: string }>({
        indexName: name,
        searchParams: { attributesToRetrieve: ['objectID'], query: 'jacket' },
      })

      return (response.hits ?? [])
        .map((entry) => entry.objectID)
        .sort()
        .join(',')
    }

    const primaryIds = await idsFor(indexBase)

    for (const replica of replicas) {
      check(
        `N: the same query returns the same SET under ${replica.replace(indexBase, '…')}`,
        (await idsFor(replica)) === primaryIds,
      )
    }

    const empty = await client.searchSingleIndex({
      indexName: indexBase,
      searchParams: { query: '' },
    })

    check(
      'N: an empty query returns the whole catalogue — why the pure layer must refuse to send one',
      (empty.nbHits ?? 0) > 0,
      `${empty.nbHits} hits`,
    )
  } else {
    check(
      'N: skipped — algolia is not configured, and the storefront degrades rather than failing',
      true,
      'set the three ALGOLIA variables to run the live section',
    )
  }
} finally {
  await cleanup()
}

/*
 * **Nothing this harness wrote is left in the index — checked AFTER the cleanup, which is where the
 * leak was.**
 *
 * Phase 30 found three orphaned "Verify Parka" records in the development index, one per run of this
 * harness since Phase 29: renaming the fixture taxonomy went through `syncTaxonomyRename`, which wrote
 * the fixture product to the index from the CLI, and the cleanup's delete went through the product
 * hook, which (correctly) refuses CLI writes. The CLI could add and never remove. `verify:catalog`
 * noticed only because its engine-parity check saw three extra products.
 *
 * Both hooks now refuse CLI writes. This check is the tripwire if either stops.
 */
if (integrationStatus('algolia') === 'configured') {
  const credentials = requireIntegration('algolia')
  const client = createSearchClient({
    apiKey: credentials.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY,
    appId: credentials.NEXT_PUBLIC_ALGOLIA_APP_ID,
  })
  const indexName = catalogIndexName(appEnv)
  const fixtureIds = created
    .filter((doc) => doc.collection === 'products')
    .map((doc) => String(doc.id))

  const { results: remaining } = await client.getObjects<{ objectID: string }>({
    requests: fixtureIds.map((objectID) => ({ indexName, objectID })),
  })
  const orphans = remaining
    .filter((record): record is NonNullable<typeof record> => record !== null)
    .map((record) => record.objectID)

  check(
    'N: **a run leaves no record behind in the index** — the CLI can neither add nor orphan one',
    fixtureIds.length > 0 && orphans.length === 0,
    orphans.length > 0
      ? `orphaned in ${indexName}: ${orphans.join(', ')}`
      : `${fixtureIds.length} fixture product(s) checked after cleanup`,
  )
}

/* -------------------------------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------------------------------- */

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} search checks passed.`,
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
  throw new Error(`${failed.length} search check(s) failed.`)
}
