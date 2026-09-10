import type { Metadata } from 'next'

import { redirect } from 'next/navigation'

import { CatalogPage } from '@/components/catalog/catalog-page'
import { SearchLanding } from '@/components/catalog/search-landing'
import { getCatalogVocabulary, getCuratedProducts } from '@/lib/catalog/catalog'
import { loadCatalogParams } from '@/lib/catalog/params'
import { SEARCH_PATH, normaliseSearchTerm } from '@/lib/catalog/search'
import { privateMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = privateMetadata('Search')

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
 * ### Phase 24 answered the indexability question: no
 *
 * A search results page is a **query**, not a document. Indexing one produces a search result that
 * leads to a search result, and every distinct `?q=` is another near-duplicate. The bare route shows
 * an empty state, which is not a page anybody should arrive at from an index either — so `/search`
 * is `noindex` here and excluded from both the sitemap and `robots.txt` by
 * `NON_INDEXABLE_PREFIXES`. That `/shop?q=` redirects here still matters: it is the reason there is
 * one search namespace to exclude rather than two.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await loadCatalogParams(searchParams)
  const { term } = normaliseSearchTerm(params.q)

  if (term === null) {
    /*
     * **The landing branch canonicalises too.**
     *
     * `/search?q=`, `/search?q=%20` and `/search?q=%25` all render this page, so without this they
     * are four URLs for one document — and `/shop?q=` already redirects to `/shop`, so the two
     * routes disagreed about the same rule. The redirect runs before the reads because there is
     * nothing to read for a search nobody made.
     */
    if (searchParamsCarryATerm(params)) {
      redirect(SEARCH_PATH)
    }

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

/**
 * Did the URL carry a `q` at all?
 *
 * `params.q` is `null` when the parameter is absent and a string when it is present but unusable —
 * which is exactly the distinction between `/search` (canonical) and `/search?q=%20` (not).
 */
function searchParamsCarryATerm(params: { q: null | string }): boolean {
  return params.q !== null
}
