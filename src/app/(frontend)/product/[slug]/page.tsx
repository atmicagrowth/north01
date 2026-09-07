import { notFound } from 'next/navigation'

import { ProductPage } from '@/components/product/product-page'
import { loadProductParams } from '@/lib/product/params'
import { getProduct } from '@/lib/product/product'

/**
 * **`/product/<slug>` — the route every phase since 9 has recorded as owed.**
 *
 * `documentHref('products', slug)` has returned `/product/<slug>` since Phase 9, and until now every
 * one of those links 404'd: the homepage rails, the mega menu's featured products, the shop grid,
 * the search suggestions and the search results all pointed here. Phase 10, 11 and 12 each recorded
 * it in *"what is now owed"*. This closes it.
 *
 * ### One 404 for four different absences
 *
 * A slug that does not exist, a draft, a drop scheduled for next week, and a product whose every
 * variant has been switched off all return `null` from `getProduct` and land on the same page.
 *
 * That is deliberate. `publishedProductWhere` is the single definition of *listable*, shared with
 * both catalogue engines and the search indexer, so **a product that cannot appear in a listing
 * cannot be reached by typing its URL either** — there is no back door around the rule. It also
 * means the 404 leaks nothing: an unpublished product and a nonexistent one are indistinguishable
 * from outside, which is what stops a URL being a way to enumerate next season's line.
 *
 * `notFound()` renders `global-not-found.tsx` inside the shell — decision **D-31** — so the customer
 * lands somewhere with navigation rather than on a blank document.
 *
 * **No `generateMetadata` and no `generateStaticParams`.** SEO is Phase 24, exactly as Phases 10, 11
 * and 12 deferred it; `seoField()` is already on the collection for that phase to read. Static
 * generation is a Phase 30 performance question, and it is not obviously right here — the page reads
 * live stock.
 */
export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ slug }, selection] = await Promise.all([params, loadProductParams(searchParams)])

  const view = await getProduct(slug, selection)

  if (!view) {
    notFound()
  }

  return <ProductPage view={view} />
}
