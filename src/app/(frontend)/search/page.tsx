import { CatalogPage } from '@/components/catalog/catalog-page'
import { SearchLanding } from '@/components/catalog/search-landing'
import { getCatalogVocabulary, getCuratedProducts } from '@/lib/catalog/catalog'
import { loadCatalogParams } from '@/lib/catalog/params'
import { SEARCH_PATH, normaliseSearchTerm } from '@/lib/catalog/search'

/**
 * **`/search` — the full results page.**
 *
 * Feature matrix §2 asks a full results page for four things: *"query preserved in URL, filters and
 * sorting preserved in URL, result count, pagination"*. All four arrive for free, because `q` joined
 * the one `CATALOG_PARSERS` map rather than getting a parser of its own — so this route is a **third
 * caller of `CatalogPage`**, not a second implementation of it.
 *
 * That is the whole design. The grid, the filter rail, the chips, the sort control, the pagination,
 * the canonical redirect and the out-of-range redirect are all the same code `/shop` and
 * `/shop/<category>` run. A search result is a catalogue listing with one more clause.
 *
 * ### Two states, and the first one runs no query
 *
 * `/search` with no term is a landing page, not an empty result. Running a query for nothing and
 * reporting "no products" would be answering a question nobody asked — so it renders a real form,
 * the categories, and a curated row instead.
 *
 * The form is a genuine `<form method="get" action="/search">` with `name="q"`, which means the
 * results page is reachable **with JavaScript disabled**. The overlay is an enhancement over this,
 * not the only way in.
 *
 * ### No `generateMetadata`, no canonical, no `noindex`
 *
 * Phase 24 owns SEO — including the separate question of whether a search results page should be
 * indexable at all. Phase 10 and Phase 11 deferred the same way. What this phase hands Phase 24 is
 * *one* crawlable search namespace rather than two, because `/shop?q=` redirects here.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await loadCatalogParams(searchParams)
  const { term } = normaliseSearchTerm(params.q)

  if (term === null) {
    const [vocabulary, curated] = await Promise.all([getCatalogVocabulary(), getCuratedProducts(4)])

    return <SearchLanding categories={vocabulary.categories} curated={curated} />
  }

  return (
    <CatalogPage
      basePath={SEARCH_PATH}
      eyebrow="Search"
      params={params}
      routeQuery={term}
      scope="search"
      title={`“${term}”`}
    />
  )
}
