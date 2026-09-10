import 'server-only'

import { cache } from 'react'
import type { Payload } from 'payload'

import { getCatalogSettings, type CatalogSettings } from '@/lib/catalog/catalog'
import { publishedProductWhere } from '@/lib/catalog/query'
import { resolveProductCards, type ProductCard } from '@/lib/catalog/resolve'
import { getPayloadClient } from '@/lib/payload'
import type { Product, SizeGuide } from '@/payload-types'

import { buildVariantMatrix, type SelectableVariant, type VariantMatrix } from './variants'

/**
 * **The reads that build a product page.**
 *
 * A loader and nothing else — every *rule* lives in `variants.ts`, which imports nothing from Next
 * and nothing runnable from Payload, so `pnpm verify:product` exercises plan §13.1c's whole
 * combination table without a browser or a request. The same split `lib/catalog/catalog.ts` keeps.
 *
 * ### Why this reads variants separately rather than through the join
 *
 * `products.variants` is a Payload `join`, and a join populates at a fixed `defaultLimit` with no
 * control over which columns come back. This page needs six columns per row and needs *all* of them
 * — a product with more sizes than the join's page would silently render a size selector missing its
 * last size, which is the worst possible failure for a control whose entire job is to be exhaustive.
 *
 * One explicit query, ordered by the merchandiser's `sizeSortOrder`, removes the question.
 *
 * ### The read is access-controlled, and that is load-bearing here
 *
 * `overrideAccess: false, user: null` — the same constant posture Phase 12 gave both catalogue
 * engines. `Products.publishedOnly` turns a draft into *absent* rather than *forbidden*, which is
 * what lets the route answer a draft slug with a 404 instead of a 403. Feature matrix §7 lists
 * *"product unpublished while page is open"*; that is handled by this read returning nothing on the
 * next request rather than by anything clever.
 */

const STOREFRONT_ACCESS = { overrideAccess: false, user: null } as const

/** Two hops: `gallery[].image` and `variants[].image` are the only relationships the page renders. */
const PRODUCT_DEPTH = 2

/**
 * Every size of every colour.
 *
 * `pagination: false` does **not** make `limit` decorative — measured, a `pagination: false` read
 * with `limit: 2` returns two rows. So this is a real cap, on the one control whose entire job is to
 * be exhaustive, and reaching it would drop sizes from the selector with nothing to show for it.
 *
 * 500 is far beyond any real garment — ten colours in ten sizes is a hundred — so the cap should
 * never bind. `readVariants` logs if it ever does, because "should never" and "cannot" are different
 * words and only one of them is checkable.
 */
const VARIANT_LIMIT = 500

export type ProductView = {
  matrix: VariantMatrix
  product: Product
  /** Products from the same categories — feature matrix §10, Postgres-backed. */
  recommendations: ProductCard[]
  settings: CatalogSettings
  sizeGuide: null | SizeGuide
  variants: SelectableVariant[]
}

/** Everything the page reads, before a variant has been chosen. */
export type ProductRecord = Omit<ProductView, 'matrix'>

/**
 * **A published product by slug, with everything the page needs, or `null` — and cached by slug
 * alone.**
 *
 * `null` is the route's 404. A draft, a scheduled drop and a product withdrawn from sale all reach
 * it the same way — `publishedProductWhere` is the one definition of *listable*, shared with both
 * catalogue engines and the indexer, so a product that cannot appear in a listing cannot be reached
 * by typing its URL either.
 *
 * ### Why the reads are separated from the selection — Phase 24
 *
 * `getProduct` takes a `selection` **object**, and React's `cache` compares arguments with
 * `Object.is`. Two callers passing `{ color: null, size: null }` therefore miss each other's entry
 * and both run the queries, because the two objects are not the same object. That did not matter
 * while the page was the only caller; `generateMetadata` is a second one, in the same request, and
 * memoisation that silently does not apply is worse than none — it looks free.
 *
 * So the queries are keyed by the slug, which is a string, and the variant matrix — pure, cheap, and
 * the only part that depends on the selection — is built on top of the memoised result.
 */
export const getProductRecord = cache(async (slug: string): Promise<ProductRecord | null> => {
  const payload = await getPayloadClient()
  const settings = await getCatalogSettings()
  const now = new Date().toISOString()

  const { docs } = await payload.find({
    collection: 'products',
    depth: PRODUCT_DEPTH,
    limit: 1,
    ...STOREFRONT_ACCESS,
    where: { and: [...publishedProductWhere(now), { slug: { equals: slug } }] },
  })

  const product = docs[0]

  if (!product) {
    return null
  }

  return {
    product,
    recommendations: await readRecommendations(payload, product, settings, now),
    settings,
    sizeGuide:
      typeof product.sizeGuide === 'object' && product.sizeGuide ? product.sizeGuide : null,
    variants: await readVariants(payload, product.id),
  }
})

export async function getProduct(
  slug: string,
  selection: { color?: null | string; size?: null | string },
): Promise<ProductView | null> {
  const record = await getProductRecord(slug)

  if (!record) {
    return null
  }

  return {
    ...record,
    matrix: buildVariantMatrix(
      record.variants,
      selection,
      record.settings.currency,
      record.settings.locale,
      record.settings.lowStockThreshold,
    ),
  }
}

async function readVariants(payload: Payload, productId: number): Promise<SelectableVariant[]> {
  const { docs } = await payload.find({
    collection: 'product-variants',
    depth: 1,
    limit: VARIANT_LIMIT,
    pagination: false,
    /*
     * A TOTAL order. `(sizeSortOrder, size)` leaves two colours in the same size tied, and a tie is
     * whatever the planner returns — stable until a VACUUM, an UPDATE that moves the tuple, or a
     * parallel scan says otherwise. `id` last makes the read reproducible; see `buildVariantMatrix`
     * for why the swatch row no longer depends on this order at all.
     */
    sort: ['sizeSortOrder', 'size', 'color', 'id'],
    ...STOREFRONT_ACCESS,
    where: { product: { equals: productId } },
  })

  if (docs.length >= VARIANT_LIMIT) {
    payload.logger.error(
      { productId, variants: docs.length },
      `A product reached the ${VARIANT_LIMIT}-variant read cap. The size selector may be missing ` +
        'rows — raise VARIANT_LIMIT in lib/product/product.ts.',
    )
  }

  return docs.map((variant) => ({
    active: variant.active,
    color: variant.color,
    colorHex: variant.colorHex,
    compareAtPriceMinor: variant.compareAtPriceMinor,
    id: variant.id,
    image: variant.image ?? null,
    inventoryQuantity: variant.inventoryQuantity,
    priceMinor: variant.priceMinor,
    size: variant.size,
    sizeSortOrder: variant.sizeSortOrder,
    sku: variant.sku,
  }))
}

/**
 * **"You may also like"** — feature matrix §10's recommendations, at the only strength the data
 * currently supports.
 *
 * Products sharing a category, in the merchandiser's curated order, excluding this one. That is a
 * *rule*, which is exactly what feature matrix §10 asks for — *"application-level recommendation
 * rules backed by Payload/Postgres"* — and it is deliberately not dressed up as anything cleverer.
 * The behavioural signals the same section mentions are analytics, which is Phase 25, and Algolia's
 * "assist discovery" would make a recommendation row depend on a service the page does not otherwise
 * need.
 *
 * Postgres-only for the same reason the curated row on the no-results page is: a recommendation that
 * disappears when the search service does is a worse recommendation.
 *
 * A product in no category falls back to the curated order across the catalogue rather than showing
 * nothing, because an empty row here is a heading with a gap under it.
 */
async function readRecommendations(
  payload: Payload,
  product: Product,
  settings: CatalogSettings,
  now: string,
): Promise<ProductCard[]> {
  const categoryIds = (product.categories ?? [])
    .map((entry) => (typeof entry === 'object' && entry ? entry.id : entry))
    .filter((id): id is number => typeof id === 'number')

  const read = async (categoryScoped: boolean) => {
    const { docs } = await payload.find({
      collection: 'products',
      depth: 1,
      limit: 4,
      sort: ['sortOrder', '-publishedAt', 'slug'],
      ...STOREFRONT_ACCESS,
      where: {
        and: [
          ...publishedProductWhere(now),
          { id: { not_equals: product.id } },
          ...(categoryScoped && categoryIds.length > 0
            ? [{ categories: { in: categoryIds } }]
            : []),
        ],
      },
    })

    return resolveProductCards(docs, settings.currency, settings.locale, settings.lowStockThreshold)
  }

  const related = categoryIds.length > 0 ? await read(true) : []

  return related.length > 0 ? related : await read(false)
}
