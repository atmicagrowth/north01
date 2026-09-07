# Search

How text search works in NORTH / 01, what it costs, and how to reproduce every state it can be in.

Plan §38 asks operational documentation to *"explain how to reproduce the behavior instead of merely
describing it"*, so every section below ends in something you can run.

---

## 1. The shape of it

```
customer types  ──►  /search/suggest  ──►  Algolia (ids only)  ──►  Postgres (products)
                                                │
customer submits ──►  /search  ────────────────►┘
```

Algolia answers **which products, in what order**. Postgres answers **what they are**. Nothing a
customer reads ever comes from the index.

| Layer | File | Pure? |
|---|---|---|
| Rules — normalisation, states, failures, keyboard | `src/lib/catalog/search.ts` | yes |
| The panel's payload | `src/lib/catalog/suggest.ts` | yes |
| URL contract, engine routing | `src/lib/catalog/query.ts` | yes |
| Index record and settings | `src/lib/catalog/record.ts` | yes |
| Provider boundary — the only file importing `algoliasearch` | `src/lib/catalog/algolia.ts` | no SDK-free, but no Next |
| Loaders, caching, failure policy | `src/lib/catalog/catalog.ts` | `server-only` |
| Typeahead endpoint | `src/app/(frontend)/search/suggest/route.ts` | — |
| Panel | `src/components/shell/search-panel.tsx` | — |
| Results page | `src/app/(frontend)/search/page.tsx` | — |

Everything in the "pure" rows is imported by `pnpm verify:search`, which is why §12.1d's ten edge
cases are 200 assertions rather than a manual checklist.

---

## 2. What is searchable, and how §12.1a is answered

Plan §12.1a lists nine searchable fields. Four of them are not columns on `products` and are answered
through **one derived attribute**, `searchTerms`:

| §12.1a asks for | Answered by |
|---|---|
| Product name | `name` |
| Description / summary | `shortDescription` |
| Category | `searchTerms` — the category's **name**, including every ancestor's |
| Collection | `searchTerms` — the collection's **title** |
| Tags | `tags` |
| Colour | `searchTerms` — the variant's display colour **and** the colour-family label |
| Size | `searchTerms` — every size on an active variant |
| Material | `materials` |
| Fit | `fit` |

They are collapsed into one attribute because Algolia's Attribute ranking criterion is **positional**:
five separate entries would impose an arbitrary precedence between a category name and a colour name,
and every product carries all of them, so the ordering would be noise outranking relevance.

Slugs are deliberately **not** searchable. They are machine strings; their human names are what a
customer types, and `categorySlugs` already covers the subtree for the *facet*.

```bash
# Every one of these returned ZERO before Phase 12.
pnpm verify:search      # section N asserts all six
```

### The known limitation

**`medium` does not match size `M`.** No synonym map ships, and that is a decision rather than an
omission: an Algolia synonym expands the query token *globally*, so `medium` → `M` would prefix-match
Merino, Moss and Melton inside `name` — the highest-ranked attribute — under the live
`queryType: 'prefixLast'`. `XL`, `32` and `ONE SIZE` are what customers actually type and they all
match. The size **filter** on the results page is where structure §12 puts this anyway. **DEV-53.**

---

## 3. The index returns nothing but an id

Decision **D-37**, and it is a **staleness** guarantee, not a confidentiality one.

`attributesToRetrieve: ['objectID']` is an index **default**. A per-request parameter overrides it —
measured with the public search key alone, a query asking for `['name','slug','priceFromMinor']`
returned all three. The index contains only published, listable products (`buildProductRecord`
excludes drafts, scheduled drops and withdrawn products), so nothing confidential is exposed; but the
setting is not a boundary and must not be described as one.

What it buys is that **the storefront cannot render a stale copy**. Feature matrix §2 requires that a
*"deleted/unpublished product indexed stale"* has its *"publish state validated before display"*, and
a row rendered from index-resident fields has had no such fetch.

The one setting here that **is** a hard boundary is `unretrievableAttributes: ['inventoryTotal']`,
which no search key can override.

```bash
# Prove the retrieve default is not a boundary, and that stock is:
curl -s "https://$APP-dsn.algolia.net/1/indexes/north01_products_local/query" \
  -H "X-Algolia-Application-Id: $APP" -H "X-Algolia-API-Key: $SEARCH_KEY" \
  -d '{"params":"query=hoodie&attributesToRetrieve=name,priceFromMinor,inventoryTotal"}'
# -> name and priceFromMinor come back; inventoryTotal does not.
```

### `_highlightResult` is the leak `attributesToRetrieve` does not close

A text query returns `_highlightResult` **alongside** `objectID`, carrying the product name with
`<em>` markup plus fit, materials and tags. It is suppressed by `attributesToHighlight: []`, which
ships in the same settings object. Without it, D-37's own sentence becomes false the moment text
search is enabled, and rendering the highlight would need `dangerouslySetInnerHTML` — the Phase 10
D-35 defect class.

---

## 4. Which engine answers

Decision **D-36**: the engine is chosen **per query**, not per route.

| Query carries | Engine | Survives an Algolia outage? |
|---|---|---|
| nothing, or category / price / availability / any sort | Postgres | **yes** |
| a **term** | Algolia | no — degrades |
| colour, size or collection | Algolia | no — degrades |

`requiresSearchIndex` in `query.ts` is that predicate. The clause `query.q !== null` is the highest
consequence line in the phase: without it `/search?q=hoodie` routes to Postgres, `catalogWhere` builds
no text clause because there is no text column to build one from, and the whole catalogue renders
while the URL and the page title both claim a search.

---

## 5. Settings vs records — and which command applies which

This is the trap most likely to waste an afternoon.

| Change | Applied by | NOT applied by |
|---|---|---|
| A new searchable attribute, a ranking change, a replica | `configureCatalogIndex` (runs inside `pnpm reindex`) | — |
| A new field on the record | `pnpm reindex` | — |

`replaceAllObjects` keeps `scopes: ['settings','rules','synonyms']`, so a rebuild **preserves**
settings and will not apply a settings change on its own. `pnpm reindex` runs `configureCatalogIndex`
first for exactly this reason.

### Replica parity

Every sort is a separate Algolia index. `setSettings` leaves anything it is **not** given unchanged,
so handing a replica a hand-picked subset silently leaves the rest at whatever it was — which is how
every replica came to have *no* `searchableAttributes` (meaning "search every attribute") while the
primary had four.

Measured before the fix: `black` returned **0 hits on the primary and 1 on `..._price_asc`**.

`CATALOG_SHARED_SETTINGS` is derived **by omission** from the primary's object, so a setting added
later cannot be forgotten for the replicas.

```bash
pnpm verify:search   # section N asserts primary/replica parity on four settings
```

---

## 6. Runbook

```bash
pnpm reindex         # rebuild settings + records. Atomic; safe at any time; idempotent.
pnpm reindex:check   # report drift. Writes nothing. Exit 1 if the index disagrees with Postgres.
pnpm verify:search   # 200 checks. Live section runs only when Algolia is configured.
```

**Order matters once:** a settings change needs `pnpm reindex`, not a restart.

**When to reindex.** Sync-on-write covers every write that happens *inside Next*. Three cases fall
outside it:

1. **CLI writes** — `pnpm seed`, a migration backfill, any `payload run` script. The hook's
   environment import cannot resolve outside Next, so those reach Postgres and not Algolia.
2. **Structural edits** a hook does not cover. `syncTaxonomyRename` handles a category or collection
   rename; anything else is `reindex:check`'s job to find.
3. **Recovery** — the index is derived, so it is always reconstructible.

The index name is derived from `appEnv` and there is deliberately **no** `ALGOLIA_INDEX_NAME`
variable: a name that can be set by hand can be set to production by hand.

---

## 7. Reproducing every §12.1d edge case

| # | Case | Reproduce | Expected |
|---|---|---|---|
| 1 | Empty query | `/search` | Landing page, **no query runs** |
| 2 | 1-character query | type `h` in the panel | `tooShort`; no network call. Submitting `/search?q=h` **does** search |
| 3 | Very long query | `/search?q=` + 400 characters | Clamped to 256 **bytes**; toolbar says the first part was used |
| 4 | Special characters | `/search?q=%25`, `/search?q=!!!` | Treated as empty — punctuation alone is not a search |
| 5 | Repeated submission | press Enter twice on the same term | History is **replaced**, not pushed |
| 6 | Network timeout | throttle to offline mid-request | `unavailable`, never "no results" |
| 7 | No results | `/search?q=zzzznope` | "Nothing matched", category alternatives, curated row |
| 8 | Deleted product still in index | delete a product, do **not** reindex, search for it | Card absent; count reconciled; `stale` copy if all dropped |
| 9 | Unpublished after index update | set a product to draft, search for it | Same as 8 |
| 10 | Quota / API error | point `NEXT_PUBLIC_ALGOLIA_APP_ID` at a bad app | `unavailable`; log names the class and the fix |

Cases 8 and 9 are handled **by construction**: the id is not returned by `publishedProductWhere`, so
no card is built. There is no code path that renders an unpublished product from the index.

### The degraded pass

```bash
# Remove the three ALGOLIA_* variables from .env, restart, then:
curl -s localhost:3000/shop | grep -c 'data-slot="product-card"'          # unaffected
curl -s localhost:3000/shop/clothing | grep -c 'data-slot="product-card"' # unaffected
curl -s "localhost:3000/shop?sort=price-asc" | grep -c 'product-card'     # unaffected
curl -s "localhost:3000/search?q=hoodie" | grep -c 'catalog-unavailable'  # 1
curl -s "localhost:3000/search/suggest?q=hoodie" | python -m json.tool    # categories/collections/popular still present
```

Measured: `/shop` 10, `/shop/clothing` 8, `?sort=price-asc` 10, `?priceMax=150` 2,
`?availability=in-stock` 9 — identical with and without the index. Only search and the three
index-backed facets degrade, into the controlled state §11.1d and §A.5 require.

---

## 8. Popular searches

Decision **D-38**: an editor-curated list on `site-settings` → **Search**, validated against the index
once per cache window, with any zero-hit term dropped. Empty means the section is **absent**, not
empty.

Not Algolia Analytics — and the reason is data quality, not access. The write key already carries the
`analytics` ACL and `getTopSearches` works. What it returns is the problem: the measured top search
for this application was `{ search: '', count: 18 }` — the **empty string**, eighteen times the next —
because every faceted `/shop` request sent `query: ''` and Algolia's `analytics` parameter defaults
on. Several other recorded terms were engineer probes returning zero hits.

`indexSearchParams` now sends `analytics: false` for a browse and `true` for a text query, so the
corpus stops being polluted. The history already is; Phase 25 must not read the early window as
customer behaviour.

During an outage the curated terms are offered **unvalidated**, because they lead to the designed
search-unavailable state rather than to a dead end, and §A.5 asks for navigation to be preserved.

---

## 9. Cost

Per settled keystroke, above the two-character floor: **one** Algolia search (ids only, six hits) and
**one** Postgres read. Bounded by a 200 ms trailing debounce, an `AbortController` with a monotonic
request id, and a per-panel-session memo.

The debounce is the only request-reduction mechanism available at this SDK's default configuration:
the Node build constructs its transporter with `responsesCache: createNullCache()` and issues requests
through `node:https` rather than global `fetch`, so neither the SDK nor Next's fetch cache can dedupe
a repeated query.

**The suggestion path is deliberately not cached.** `catalog.ts` already refuses to cache the listing
because it is a function of nine parameters; a free-text term keyed by unauthenticated input is worse
on every axis, and every settled prefix of every word anybody types would become its own durable
entry.

Two questions could not be answered from the installed package and should be sourced from Algolia's
pricing documentation rather than inferred: whether a multi-request `client.search({ requests })`
counts as one operation or N, and how `replaceAllObjects` is billed.

---

## 10. What is not here

- **No rate limiting, throttling or Turnstile** on the search path. Phase 26 owns them, and §26.1a's
  surface list does not name search. The floor, the debounce, the six-hit cap and the byte clamp are
  edge-case handling and cost control — they are **not** security controls. **DEV-51.**
- **No analytics events.** `search_submitted` is Phase 25. **DEV-52.**
- **No `metadata`, canonical or `noindex`** on `/search`. Phase 24 owns SEO, including whether a
  search results page should be indexable at all. Redirecting `/shop?q=` here hands Phase 24 exactly
  one crawlable search namespace rather than two. **DEV-50.**
- **No dependent facets.** **DEV-49** — the reason is structural and is recorded there.
- **Typo tolerance reaches queries of four characters or more** (`minWordSizefor1Typo: 4`). Measured:
  `hod` → 0, `hoodei` → 1. Feature matrix §2 names typo tolerance without qualifying it; this is the
  actual boundary.
