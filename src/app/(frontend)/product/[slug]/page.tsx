import type { Metadata } from 'next'

import { notFound } from 'next/navigation'

import { JsonLd } from '@/components/seo/json-ld'
import { ProductPage, productBreadcrumb } from '@/components/product/product-page'
import type { Media } from '@/payload-types'

import { getCustomer } from '@/lib/auth/session'
import { getPayloadClient } from '@/lib/payload'
import { ProductReviews } from '@/components/reviews/product-reviews'
import { readProductReviews, resolveEligibility } from '@/lib/reviews/read'
import { readWishlistProductIds } from '@/lib/wishlist/read'
import { loadProductParams } from '@/lib/product/params'
import { getProduct, getProductRecord } from '@/lib/product/product'
import { documentSeo } from '@/lib/seo/document'
import { absoluteImageUrl, privateMetadata } from '@/lib/seo/metadata'
import { getSiteUrl, pageMetadata } from '@/lib/seo/site'
import { breadcrumbStructuredData, productStructuredData } from '@/lib/seo/structured-data'

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
 * **`generateMetadata` arrived in Phase 24**, which is where Phases 10, 11 and 12 deferred it. There
 * is still no `generateStaticParams`: static generation is a Phase 30 performance question, and it is
 * not obviously right here, because the page reads live stock.
 */

/**
 * §24.1a for the page that matters most, and §24.1b's structured data below it.
 *
 * **`getProductRecord`, not `getProduct`.** The reads are memoised by **slug**, so this call and the
 * render below are one query — which `getProduct(slug, selection)` could not have given, because
 * React's `cache` compares its object argument with `Object.is` and two identical-looking selections
 * are not the same object. See `lib/product/product.ts`.
 *
 * The selection is not passed here in any case: metadata describes the product, and the canonical URL
 * has no query — `?size=m` is a variant of a page, not a page.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const record = await getProductRecord(slug)

  if (!record) {
    return privateMetadata('Not found')
  }

  const { product } = record

  return pageMetadata({
    /*
     * `||`, not `??`. An editor who cleared the short description left an empty string, not a
     * decision to publish no description — so it falls through to the full one rather than past it.
     */
    description: product.shortDescription || product.description,
    image: firstGalleryImage(product.gallery),
    path: `/product/${slug}`,
    seo: documentSeo(product.seo),
    title: product.name,
  })
}

/** The card image, populated. An unpopulated relationship is an id, which cannot make a URL. */
function firstGalleryImage(gallery: unknown): Media | null {
  const first = Array.isArray(gallery) ? gallery[0] : null
  const image = (first as { image?: unknown } | null)?.image

  return typeof image === 'object' && image !== null && 'id' in image ? (image as Media) : null
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ slug }, selection] = await Promise.all([params, loadProductParams(searchParams)])

  /*
   * The customer and the product are independent reads, and on a remote database each is a round
   * trip — so they go out together. `getCustomer` for a guest is a cookie check and costs nothing;
   * for a signed-in customer it was a whole query waiting on the product for no reason.
   */
  const [view, customer, payload] = await Promise.all([
    getProduct(slug, selection),
    getCustomer(),
    getPayloadClient(),
  ])

  if (!view) {
    notFound()
  }

  /*
   * **§20.1a's saved state, resolved on the server.**
   *
   * The heart has to be correct in the markup rather than after a fetch, or a customer who has saved
   * this product sees an empty heart for a beat and reasonably concludes it did not save. One query,
   * and only when somebody is signed in — a guest's list lives on their device and the control reads
   * it there.
   */
  const savedForCustomer =
    customer !== null &&
    (await readWishlistProductIds(payload, customer.id)).includes(view.product.id)

  /*
   * **§13.1f's block, read on the server.**
   *
   * Reviews are public content and belong in the markup — a rating that arrives after hydration is a
   * rating a crawler never sees, and §29 wants review data in the structured markup eventually.
   *
   * `resolveEligibility` costs **no queries at all** for a signed-out visitor, which is the
   * overwhelming majority of product-page views: the answer is already known without asking anything.
   */
  const [{ reviews, summary }, eligibility] = await Promise.all([
    readProductReviews(payload, view.product.id),
    resolveEligibility(payload, customer, view.product.id, true),
  ])

  const siteUrl = getSiteUrl()
  const socialImage = absoluteImageUrl(siteUrl, firstGalleryImage(view.product.gallery)?.url)

  /*
   * **§24.1b, emitted from the same numbers the page renders.**
   *
   * The offers are filtered to variants a customer can put in a bag **today** — active and in stock —
   * which is what *"prices not actually purchasable"* forbids claiming otherwise. The rating is the
   * summary already computed above from approved reviews, so a product with none emits no
   * `aggregateRating` at all rather than a default.
   *
   * A SKU is emitted only when the product **is** one variant. With several, a product-level SKU is a
   * claim about which one, and there is no honest answer.
   */
  const purchasable = view.variants.filter((variant) => variant.active !== false)

  const structuredData = productStructuredData({
    currency: view.settings.currency,
    description: view.product.shortDescription ?? null,
    image: socialImage,
    name: view.product.name,
    offers: purchasable.map((variant) => ({
      available: variant.inventoryQuantity ?? 0,
      priceMinor: variant.priceMinor ?? Number.NaN,
    })),
    rating:
      summary.average !== null && summary.count > 0
        ? { average: summary.average, count: summary.count }
        : null,
    sku: view.variants.length === 1 ? (view.variants[0]?.sku ?? null) : null,
    url: `${siteUrl}/product/${slug}`,
  })

  return (
    <>
      <JsonLd data={structuredData} />
      {/* The same list the page draws, so the visible trail and the search result's cannot drift. */}
      <JsonLd data={breadcrumbStructuredData(siteUrl, productBreadcrumb(view.product))} />

      <ProductPage
        reviews={
          <ProductReviews
            displayName={customer?.firstName ?? ''}
            eligibility={eligibility}
            productId={view.product.id}
            reviews={reviews}
            summary={summary}
          />
        }
        savedForCustomer={savedForCustomer}
        signedIn={customer !== null}
        view={view}
      />
    </>
  )
}
