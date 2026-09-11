import type { Metadata } from 'next'

import { CatalogPage } from '@/components/catalog/catalog-page'
import { loadCatalogParams } from '@/lib/catalog/params'
import { pageMetadata } from '@/lib/seo/site'

/**
 * **`/shop` — the whole catalogue.**
 *
 * Structure §2 draws SHOP with an *All* child, and this is it: no category, every published product,
 * the same filters and sorts as every category page.
 *
 * The route is **dynamic**, and unavoidably so — it is a function of nine query parameters, and
 * prerendering it would mean prerendering one page per combination. Next infers that from the
 * `searchParams` read; there is no `export const dynamic` here because a directive that restates
 * what the code already forces is one more thing that can fall out of step with it.
 *
 * `loadCatalogParams` is handed the promise rather than an awaited value, which nuqs supports
 * explicitly for this shape. The parse is deferred into the component that needs it, so the shell
 * around the suspense boundary is not waiting on a query string to render a page title.
 *
 * Phase 10 recorded the absence of a `<title>` here as a decision rather than an omission, on the
 * grounds that adding a bespoke one to this route alone would leave the storefront half-done in a
 * way that looks finished. Phase 24 finished it everywhere at once, which is what that note was
 * waiting for.
 */

/**
 * §24.1a. The canonical is `/shop` with **no query**, which is the whole point on this route: the
 * page is a function of nine parameters, and canonicalising each combination would ask an index to
 * hold every filter of every sort of every page. `canonicalUrl` strips the query for exactly this.
 */
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    description: 'Every published garment, filterable by category, size, color and price.',
    path: '/shop',
    title: 'Shop',
  })
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await loadCatalogParams(searchParams)

  /*
   * Phase 35 (P35-19): the header's NEW is `/shop?sort=newest`, and it landed on a page titled
   * "All". The listing is the same catalogue; the page now says which way round it is.
   */
  const newest = params.sort === 'newest'

  return (
    <CatalogPage
      basePath="/shop"
      eyebrow="Shop"
      lede={
        newest
          ? 'The most recent additions first, across the whole range.'
          : 'Everything in the current range, filterable by size, color, collection and price.'
      }
      params={params}
      title={newest ? 'New arrivals' : 'All'}
    />
  )
}
