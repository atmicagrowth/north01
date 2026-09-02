import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { ActiveFilters } from '@/components/catalog/active-filters'
import { CatalogToolbar } from '@/components/catalog/catalog-toolbar'
import { FilterPanel } from '@/components/catalog/filter-controls'
import {
  CatalogEmpty,
  CatalogPagination,
  CatalogUnavailable,
  ProductGrid,
  ProductGridSkeleton,
} from '@/components/catalog/product-grid'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { getCatalog, getCatalogSettings, getCatalogVocabulary } from '@/lib/catalog/catalog'
import {
  canonicaliseParams,
  catalogHref,
  isFilteredQuery,
  outOfRangePage,
  type CatalogParams,
} from '@/lib/catalog/query'
import { formatMinorUnits } from '@/lib/money'

/**
 * **`/shop` and `/shop/<category>`, which are the same page.**
 *
 * The only difference between them is a fixed category and a different title, so they are one
 * component with two callers rather than two routes that drift. Plan §11.1a's five required
 * elements — count, grid, filters, sort, pagination, empty state — are all here, once.
 *
 * ---
 *
 * ### The layout, and guide §09's "quiet, spacious grid"
 *
 * A two-column grid above `lg`: a 224px filter rail and the products. Below `lg` the rail becomes
 * the drawer, which is structure §5's *"desktop filter area, mobile filter drawer"* exactly. The
 * rail is `sticky` so a customer twenty products down can still change a filter without scrolling
 * back — and `max-h`/`overflow-y-auto` so a long facet list scrolls inside itself rather than
 * running off the bottom of the viewport with no way to reach the last option.
 *
 * ### Where the Suspense boundary is, and why not around everything
 *
 * Phase 10 recorded that a homepage `loading.tsx` would be theatre — *"`/` is statically
 * prerendered; every query resolves at build time"* — and named this page as where streaming earns
 * its place. It does, because this route is genuinely dynamic: it reads nine URL parameters and
 * cannot be prerendered.
 *
 * The boundary wraps the **results only**. The page title and the filter panel stay outside it, and
 * that is the whole design:
 *
 * - The panel is a client component reading URL state, so a ticked box is reflected *instantly*,
 *   before the server has answered. Putting it inside the boundary would replace the control the
 *   customer is using with a skeleton of itself at the exact moment they use it.
 * - The `key` is the serialized query, so every filter change is a new boundary and paints
 *   skeletons. Without the key React reuses the boundary and leaves the **previous** products on
 *   screen while the new ones load — which is worse than a spinner, because stale results that look
 *   settled are indistinguishable from an answer.
 */
export async function CatalogPage({
  basePath,
  eyebrow,
  lede,
  params,
  routeCategory = null,
  title,
}: {
  basePath: string
  eyebrow?: string
  lede?: null | string
  params: CatalogParams
  routeCategory?: null | string
  title: string
}) {
  const vocabulary = await getCatalogVocabulary()

  /*
   * **One spelling per query.** `?size=m` becomes `?size=M` before a single element is rendered, so
   * every comparison downstream is normalised-against-normalised by construction — see
   * `canonicaliseParams` for the dead filter chip that made this necessary rather than merely tidy.
   *
   * `redirect()` throws, so it must run outside any `try`. It is here rather than in
   * `CatalogResults` deliberately: redirecting from inside the suspense boundary would paint a shell
   * and a grid of skeletons first, then throw them away.
   */
  const canonical = canonicaliseParams(params, vocabulary)
  const canonicalHref = catalogHref(basePath, canonical)

  if (canonicalHref !== catalogHref(basePath, params)) {
    redirect(canonicalHref)
  }

  return (
    <Section spacing="tight">
      <PageContainer>
        <PageTitle eyebrow={eyebrow} lede={lede ?? undefined} className="mb-l">
          {title}
        </PageTitle>

        <div className="grid gap-l lg:grid-cols-[14rem_1fr] lg:gap-x-[3.5rem]">
          <aside className="hidden lg:block" aria-label="Filters">
            {/*
              `top-[5.5rem]` clears the sticky header. `globals.css` already sets
              `scroll-padding-top: 4.5rem` for the same header — the two are the same measurement,
              and this adds a spacing step so the rail does not sit flush against the bar.
            */}
            <div className="sticky top-[5.5rem] max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
              <h2 className="sr-only">Filters</h2>
              <FilterPanel routeCategory={routeCategory} vocabulary={vocabulary} />
            </div>
          </aside>

          <div className="min-w-0">
            <Suspense
              key={canonicalHref}
              fallback={
                <div className="flex flex-col gap-m">
                  <div className="h-[3.25rem] border-b border-border" />
                  <ProductGridSkeleton />
                </div>
              }
            >
              <CatalogResults
                basePath={basePath}
                params={canonical}
                routeCategory={routeCategory}
              />
            </Suspense>
          </div>
        </div>
      </PageContainer>
    </Section>
  )
}

/**
 * The half that waits on the database.
 *
 * Split out purely so the `<Suspense>` above has something to suspend on — an `async` component is
 * the boundary's unit of work. Everything it renders is derived from one `getCatalog` call, so the
 * count, the chips, the grid and the pagination cannot disagree about which query produced them.
 */
async function CatalogResults({
  basePath,
  params,
  routeCategory,
}: {
  basePath: string
  params: CatalogParams
  routeCategory: null | string
}) {
  const [{ ignored, query, result, vocabulary }, settings] = await Promise.all([
    getCatalog(params, routeCategory),
    getCatalogSettings(),
  ])

  const formatPrice = (minor: number): null | string =>
    formatMinorUnits(minor, settings.currency, settings.locale)

  /*
   * **An out-of-range page is a redirect, not an empty grid.**
   *
   * `/shop?page=5` against a one-page catalogue used to render the toolbar's honest "10 products"
   * above the empty state's *"this part of the shop has no published products at the moment"* — two
   * statements on one screen that cannot both be true — and no pagination at all, because the
   * control lives in the branch that only runs when there are products. A customer who mistyped a
   * page number, or followed a link from when the catalogue was larger, had no way back but editing
   * the URL.
   *
   * Redirecting to the last real page means the customer always lands on products, the address
   * becomes canonical, and the empty state below can only ever mean *"nothing matched"* — which is
   * the one thing it should mean.
   *
   * `totalPages === 0` is deliberately excluded: there is no page to send them to, and the empty
   * state is the correct answer to a genuinely empty result.
   */
  const lastPage = outOfRangePage(query.page, result.totalPages)

  if (lastPage !== null) {
    redirect(catalogHref(basePath, { ...params, page: lastPage === 1 ? null : lastPage }))
  }

  const isFiltered = isFilteredQuery(query, routeCategory)

  return (
    <div className="flex flex-col gap-l">
      <CatalogToolbar
        basePath={basePath}
        ignored={ignored}
        params={params}
        routeCategory={routeCategory}
        total={result.totalProducts}
        vocabulary={vocabulary}
      />

      <ActiveFilters
        basePath={basePath}
        formatPrice={formatPrice}
        params={params}
        query={query}
        routeCategory={routeCategory}
        vocabulary={vocabulary}
      />

      {result.engine === 'unavailable' ? (
        <CatalogUnavailable
          basePath={basePath}
          categories={vocabulary.categories.filter((category) => category.parent === null)}
          sort={params.sort}
        />
      ) : result.products.length === 0 ? (
        <CatalogEmpty
          basePath={basePath}
          categories={vocabulary.categories.filter((category) => category.parent === null)}
          isFiltered={isFiltered}
          sort={params.sort}
          /*
           * The count, so the copy cannot contradict it. After the redirect above the only way to
           * reach this with a non-zero total is a search index that still holds ids Postgres has
           * stopped returning — plan §12.1d's "deleted product still in index", which deserves its
           * own sentence rather than the flat claim that the shop is empty.
           */
          total={result.totalProducts}
        />
      ) : (
        <>
          <ProductGrid
            cards={result.products}
            /*
             * The LCP candidate is the first card of the first page of an **unfiltered listing** —
             * which includes `/shop/<category>`, because standing in a category is not filtering and
             * that page is just as likely to be the one a customer lands on first. A filtered or
             * paged view is a navigation made from inside the site, where the largest paint is no
             * longer the thing being measured — and marking an image eager on every page would be
             * plan §10.1d's "proper priority only for the main hero/LCP image" ignored twenty-four
             * times over.
             */
            eager={!isFiltered && result.page === 1}
          />

          <CatalogPagination basePath={basePath} params={params} result={result} />
        </>
      )}
    </div>
  )
}
