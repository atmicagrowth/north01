import type { Metadata } from 'next'

import { ProductCard } from '@/components/catalog/product-card'
import { PageTitle } from '@/components/layout/page-title'
import { Link } from '@/components/ui/link'
import { requireCustomer } from '@/lib/auth/session'
import { getCatalogSettings } from '@/lib/catalog/catalog'
import { CATALOG_IMAGE_SIZES } from '@/lib/catalog/sizes'
import { getPayloadClient } from '@/lib/payload'
import { readWishlist } from '@/lib/wishlist/read'
import { WISHLIST_EMPTY_COPY } from '@/lib/wishlist/rules'
import { privateMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = privateMetadata('Saved items')

/**
 * **`/account/wishlist`** — plan §20.1d, and the destination the header's heart has pointed at since
 * Phase 9 (**C-09**).
 *
 * ### Saved products are validated on every render, not on save
 *
 * `readWishlist` runs the same `publishedProductWhere` the shop grid uses, so a product withdrawn
 * since it was saved is simply absent — the phase prompt's *"remove invalid/deleted products
 * gracefully"*. The **row is not deleted**: unpublishing a product for an afternoon should not
 * silently empty somebody's list, and it reappears when the product does.
 *
 * That does mean a customer can have saved items and see fewer than they saved. The alternative —
 * rendering a card for something they cannot buy — is worse, and it is the same decision the bag
 * makes.
 *
 * ### Each card keeps its heart
 *
 * Which on this page is the remove control. A saved-items screen whose only way to unsave something
 * is to navigate to the product would be a list you can add to and not subtract from.
 */
export default async function AccountWishlistPage() {
  const customer = await requireCustomer('/account/wishlist')

  const [payload, settings] = await Promise.all([getPayloadClient(), getCatalogSettings()])

  const { cards } = await readWishlist(payload, customer.id, settings, new Date().toISOString())

  return (
    <div className="flex flex-col gap-l">
      <PageTitle eyebrow="Account" size="display-l">
        Saved
      </PageTitle>

      {cards.length === 0 ? (
        <div className="flex flex-col items-start gap-s border-t border-border pt-6">
          <p className="font-sans text-body text-foreground">{WISHLIST_EMPTY_COPY.title}</p>
          <p className="max-w-measure font-sans text-body-sm text-foreground-muted">
            {WISHLIST_EMPTY_COPY.body}
          </p>
          <Link className="mt-s font-sans text-meta uppercase" href="/shop">
            {WISHLIST_EMPTY_COPY.cta}
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-m sm:grid-cols-3">
          {cards.map((card) => (
            <li key={card.id}>
              <ProductCard
                card={card}
                savedForCustomer
                sizes={CATALOG_IMAGE_SIZES.accountGrid}
                signedIn
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
