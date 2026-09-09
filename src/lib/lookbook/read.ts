import type { Payload } from 'payload'

import type { CatalogSettings } from '@/lib/catalog/catalog'
import type { LookProduct, LookVariant } from './rules'

import { formatMinorUnits, formatPriceRange } from '@/lib/money'
import { publishedProductWhere } from '@/lib/catalog/query'

/**
 * **Resolving a hotspot's product into something a preview can render** — plan §22.1c.
 *
 * > *"Click hotspot: open product preview. Show image/name/price/variant state. Allow add to bag.
 * > Allow full PDP navigation."*
 *
 * *"Variant state"* is the demanding word in that list, and it is why this module exists rather than
 * the editorial resolver being extended. `resolveProductTile` gives a name, an image, a price and a
 * sold-out flag from data the page already had; a preview that can add to a bag needs to know **which
 * variants can actually be bought**, and that is a second read the editorial resolver has no reason
 * to make for a section that may never be opened.
 *
 * So the preview is resolved **on demand**, when a marker is opened. The homepage carries four of
 * these blocks and none of them pays for a variant query until somebody taps a dot.
 *
 * No `server-only` guard: it takes a `Payload` and its settings as arguments, so the harness can
 * drive §22.1d's plan against real stock.
 */

const STOREFRONT_ACCESS = { overrideAccess: false, user: null } as const

/**
 * One product, with every variant that can actually be bought.
 *
 * **Published, active and in stock — all three.** §22.1b's *"if the product reference is invalid,
 * hide the hotspot"* is enforced by the resolver upstream; this is the finer-grained version of the
 * same idea, and the reason a preview can be honest about what it is offering: a variant that is
 * active but out of stock is not purchasable, and offering it would be the silent guess §22.1d
 * forbids wearing a different hat.
 *
 * Returns `null` for a product that is not published, which is what a deleted or withdrawn product
 * looks like from here.
 */
export async function readLookProduct(
  payload: Payload,
  productId: number,
  settings: CatalogSettings,
): Promise<LookProduct | null> {
  const { docs } = await payload.find({
    collection: 'products',
    depth: 0,
    limit: 1,
    ...STOREFRONT_ACCESS,
    where: {
      and: [...publishedProductWhere(new Date().toISOString()), { id: { equals: productId } }],
    },
  })

  const product = docs[0]

  if (!product || typeof product.slug !== 'string') {
    return null
  }

  const variants = await payload.find({
    collection: 'product-variants',
    depth: 0,
    limit: 100,
    ...STOREFRONT_ACCESS,
    sort: 'sizeSortOrder',
    where: {
      and: [
        { product: { equals: productId } },
        { active: { equals: true } },
        { inventoryQuantity: { greater_than: 0 } },
      ],
    },
  })

  const purchasable: LookVariant[] = variants.docs.map((variant) => ({
    available: Number(variant.inventoryQuantity),
    id: variant.id,
    label: `${String(variant.color)} / ${String(variant.size)}`,
  }))

  return {
    href: `/product/${product.slug}`,
    id: product.id,
    name: String(product.name),
    /*
     * A single purchasable variant has one price; several may span a range. `formatPriceRange`
     * returns `null` rather than inventing a number when it has nothing to work with, and the
     * preview renders the absence rather than a zero.
     */
    priceLabel:
      purchasable.length === 1
        ? formatMinorUnits(variants.docs[0]?.priceMinor, settings.currency, settings.locale)
        : formatPriceRange(
            product.derived?.priceFromMinor,
            product.derived?.priceToMinor,
            settings.currency,
            settings.locale,
          ),
    purchasable,
  }
}

/**
 * The same for every product in a look, in one pass.
 *
 * Products that resolve to nothing are **dropped rather than reported**, because §22.1b already said
 * what to do about an invalid product reference: hide it. A customer cannot be told about a product
 * they were never shown.
 */
export async function readLookProducts(
  payload: Payload,
  productIds: readonly number[],
  settings: CatalogSettings,
): Promise<LookProduct[]> {
  const unique = [...new Set(productIds.filter((id) => Number.isSafeInteger(id) && id > 0))]

  const resolved = await Promise.all(unique.map((id) => readLookProduct(payload, id, settings)))

  return resolved.filter((product): product is LookProduct => product !== null)
}
