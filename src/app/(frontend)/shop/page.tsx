import { CatalogPage } from '@/components/catalog/catalog-page'
import { loadCatalogParams } from '@/lib/catalog/params'

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
 * **No `generateMetadata`.** The layout's default title and description apply, exactly as they do on
 * the homepage. Phase 10 recorded the same absence as a decision rather than an omission — SEO is
 * **Phase 24**, `site-settings` already holds the defaults it will read, and adding a bespoke
 * `<title>` here alone would leave the storefront half-done in a way that looks finished.
 */
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await loadCatalogParams(searchParams)

  return (
    <CatalogPage
      basePath="/shop"
      eyebrow="Shop"
      lede="Everything in the current range, filterable by size, colour, collection and price."
      params={params}
      title="All"
    />
  )
}
