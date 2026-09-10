import type { ReactNode } from 'react'

import { TrackList, TrackOnMount } from '@/components/analytics/trackers'
import { AddToBag } from '@/components/cart/add-to-bag'
import { RecentlyViewed, RecordProductView } from '@/components/recently-viewed/recently-viewed'
import { WishlistControl } from '@/components/wishlist/wishlist-button'
import { ProductCard } from '@/components/catalog/product-card'
import { PageContainer } from '@/components/layout/page-container'
import { Section, SectionHeading } from '@/components/layout/section'
import { ProductDetails } from '@/components/product/product-details'
import { ProductGallery } from '@/components/product/product-gallery'
import { VariantSelector } from '@/components/product/variant-selector'
import { Badge } from '@/components/ui/badge'
import { Link } from '@/components/ui/link'
import { cardsToAnalyticsItems, variantLabel } from '@/lib/analytics/items'
import { PRODUCT_IMAGE_SIZES } from '@/lib/product/sizes'
import { clampQuantity } from '@/lib/cart/rules'
import { inventoryMessage, priceRangeForColor } from '@/lib/product/variants'
import type { ProductView } from '@/lib/product/product'
import type { Media } from '@/payload-types'

/**
 * **The product page**, in structure §7's order:
 *
 * ```
 * Gallery → identity → price → colour → size → details → you may also like
 * ```
 *
 * Two of that list's nodes are deliberately absent and one is deferred; the reasons are below and in
 * **DEV-55**. Everything else is here.
 *
 * ---
 *
 * ### What is not on this page, and why that is not an omission
 *
 * Structure §7 puts **Quantity**, **Add to Bag** and reviews between size and the detail sections.
 * None of them ships, because none of them can:
 *
 * - **Add to Bag / Buy Now** need a cart. The cart is **Phase 14** and checkout is **Phase 17**. A
 *   button that looks like it adds to a bag and does not is precisely what plan §0.1.17 forbids, and
 *   it is a worse lie than a missing button because the customer only learns the truth after
 *   committing to a purchase decision.
 * - **Quantity** is a control whose only consumer is Add to Bag. Shipping it alone would be a
 *   stepper that changes a number nothing reads.
 * - **Rating and reviews** (§13.1b, §13.1f) need the reviews collection populated and moderated,
 *   which is **Phase 21**. §13.1f is explicit that an empty star histogram must not be shown, and a
 *   catalogue with no reviews is exactly that state.
 * - **Wishlist** is **Phase 20**.
 *
 * What ships instead is the whole of the page that *can* be true today: the gallery, the identity,
 * an authoritative variant selector, live stock messaging, the size guide, the detail accordions and
 * recommendations. The purchase controls arrive in Phase 14 and slot in below the selector, which is
 * why the selector already resolves and exposes the exact variant they will need.
 *
 * ### The price is the selected variant's, and it moves
 *
 * §13.1c: *"Update price if variant pricing differs."* Before a size is chosen the page shows the
 * range **for the selected colour** — not for the product — because a page showing bone's price
 * under a black swatch is quoting a price the customer cannot have. Once a size is chosen the price
 * is that variant's exactly.
 */
export function ProductPage({
  reviews,
  savedForCustomer = false,
  signedIn = false,
  view,
}: {
  /**
   * §13.1f's review block, composed by the route.
   *
   * Passed in rather than read here, because this component is a pure render of a `ProductView` and
   * the reviews need a customer, an order history and an eligibility decision that a view model has
   * no business carrying. The route owns the reads; this owns the layout.
   */
  reviews?: ReactNode
  /** Whether this product is on the signed-in customer's list. Resolved on the server, per request. */
  savedForCustomer?: boolean
  signedIn?: boolean
  view: ProductView
}) {
  const { matrix, product, recommendations, settings, sizeGuide, variants } = view

  const gallery = (product.gallery ?? [])
    .map((entry) =>
      typeof entry.image === 'object' && entry.image ? (entry.image as Media) : null,
    )
    .filter((frame): frame is Media => frame !== null)

  /*
   * A variant's own photograph leads the gallery when the colour is selected — §13.1c's "update
   * displayed media if available". It is prepended rather than substituted, so the product's other
   * frames stay reachable; a colourway with one photograph should not hide the rest of the garment.
   */
  const variantImage =
    matrix.selected && typeof matrix.selected.image === 'object' && matrix.selected.image
      ? (matrix.selected.image as Media)
      : null

  const frames = variantImage
    ? [variantImage, ...gallery.filter((frame) => frame.id !== variantImage.id)]
    : gallery

  const priceLabel =
    matrix.selected?.priceLabel ??
    priceRangeForColor(variants, matrix.selectedColor, settings.currency, settings.locale)

  const stock = inventoryMessage(matrix.selected)

  /*
   * How many of this exact variant may be added right now. The same function the server applies when
   * the form posts, given the same two inputs — so the control cannot offer a number the mutation
   * would refuse.
   */
  const bound = clampQuantity(
    settings.maxQuantityPerLine,
    matrix.selected
      ? {
          active: true,
          inventoryQuantity: matrix.selected.inventoryQuantity,
          priceMinor: matrix.selected.priceMinor,
          productPublished: true,
        }
      : null,
    settings.maxQuantityPerLine,
  )

  const video = typeof product.video === 'object' && product.video ? (product.video as Media) : null

  return (
    <>
      <Section spacing="tight">
        <PageContainer>
          <div className="grid gap-l lg:grid-cols-12">
            <div className="lg:col-span-7">
              <ProductGallery alt={product.name} frames={frames} video={video} />
            </div>

            <div className="flex flex-col gap-l lg:col-span-5">
              <div className="flex flex-col gap-s">
                <div className="flex flex-wrap items-center gap-s">
                  {product.isNew ? <Badge variant="accent">New</Badge> : null}
                  {product.isLimitedEdition ? <Badge variant="accent">Limited</Badge> : null}
                </div>

                <h1 className="font-display text-heading-m text-foreground">{product.name}</h1>

                {product.shortDescription ? (
                  <p className="max-w-measure font-sans text-body text-foreground-muted">
                    {product.shortDescription}
                  </p>
                ) : null}
              </div>

              <p className="flex items-baseline gap-s font-sans text-body">
                {priceLabel ? (
                  <span className="text-foreground">{priceLabel}</span>
                ) : (
                  <span className="text-foreground-muted">Currently unavailable</span>
                )}

                {matrix.selected?.compareAtLabel ? (
                  <s className="text-foreground-disabled">
                    <span className="sr-only">was </span>
                    {matrix.selected.compareAtLabel}
                  </s>
                ) : null}
              </p>

              <VariantSelector
                colors={matrix.colors}
                selectedColor={matrix.selectedColor}
                selectedSize={matrix.selectedSize}
                sizes={matrix.sizes}
              />

              {/*
                One live region for everything the selection changes, so a screen-reader user hears
                the consequence of picking a size rather than having to go looking for it.
              */}
              <div aria-live="polite" className="flex flex-col gap-1">
                {matrix.invalidSelection ? (
                  <p className="font-sans text-body-sm text-foreground-muted">
                    That combination is not available — showing what we do have.
                  </p>
                ) : null}

                {stock ? <p className="font-sans text-body-sm text-foreground">{stock}</p> : null}

                {matrix.selectedSize === null && matrix.sizes.length > 0 ? (
                  <p className="font-sans text-body-sm text-foreground-muted">
                    Choose a size to see availability.
                  </p>
                ) : null}
              </div>

              {/*
                Phase 14's purchase controls, which DEV-55 recorded as owed and which slot in exactly
                where that deviation said they would — beneath the selector, reading the variant it
                had already resolved. What is still absent is **Buy Now** (Phase 17, which owns
                checkout) and the wishlist (Phase 20).

                `maxQuantity` is the live bound: `clampQuantity` applied to this variant's stock and
                the shop's `maxQuantityPerLine`. It is computed on the server and passed down, so the
                stepper's ceiling and the server's clamp are the same number rather than two
                implementations of the same policy.
              */}
              <AddToBag
                item={{
                  itemId: String(product.id),
                  itemName: product.name,
                  /*
                   * The **selected** variant's price, in minor units, or `null` when no size is
                   * chosen yet. `events.ts` is explicit that `null` is unknown rather than free —
                   * and a customer who has not chosen a size has genuinely not chosen a price,
                   * because this shop's sizes may differ in it.
                   */
                  priceMinor: matrix.selected?.priceMinor ?? null,
                  variant: variantLabel(matrix.selectedColor, matrix.selectedSize),
                }}
                currency={settings.currency}
                disabledReason={
                  matrix.selectedSize === null
                    ? 'Choose a size.'
                    : matrix.selected === null
                      ? 'That combination is not available.'
                      : bound.quantity <= 0
                        ? 'Sold out in this size.'
                        : null
                }
                maxQuantity={bound.quantity}
                variantId={matrix.selected?.id ?? null}
              />

              {/*
                **DEV-45, discharged.** Phase 11 deferred the heart until there was a wishlist behind
                it; Phase 20 built one. It sits below the bag rather than beside it because saving is
                the quieter of the two intentions, and guide §06 allows one strong fill per page.
              */}
              <WishlistControl
                itemName={product.name}
                productId={product.id}
                savedForCustomer={savedForCustomer}
                signedIn={signedIn}
              />

              <ProductDetails
                product={product}
                returnsPolicy={settings.returnsPolicy}
                shippingPolicy={settings.shippingPolicy}
                sizeGuide={sizeGuide}
              />
            </div>
          </div>
        </PageContainer>
      </Section>

      {/*
        §20.1c. Renders nothing; it records that this product was seen, on the device only. The rail
        that reads it is below, and both are deliberately absent from the server's markup.
      */}
      <RecordProductView productId={product.id} />

      {/*
        **§25.1a's `view_item`.** Mounted beside the device-local view record it mirrors, because
        the two say the same thing to two different audiences — one to this browser's recently-viewed
        rail, one to the analytics property.

        The price is the **default** variant's, not the selected one: this fires once on arrival,
        and re-firing it on every size change would report one visit as six views. A size change is
        not a new product view, and §25.1a has no event for it.
      */}
      <TrackOnMount
        event="view_item"
        payload={{
          currency: settings.currency,
          items: [
            {
              itemId: String(product.id),
              itemName: product.name,
              priceMinor: matrix.selected?.priceMinor ?? null,
              variant: variantLabel(matrix.selectedColor, matrix.selectedSize),
            },
          ],
        }}
      />

      {/* §13.1f. Above recently-viewed and recommendations: it is about *this* product. */}
      {reviews}

      <RecentlyViewed exclude={product.id} />

      {recommendations.length > 0 ? (
        <Section divider="top" spacing="tight">
          <PageContainer>
            <SectionHeading className="mb-l">You may also like</SectionHeading>

            <TrackList
              items={cardsToAnalyticsItems(recommendations)}
              listId="pdp_recommended"
              listName="You may also like"
            >
              <ul className="grid grid-cols-2 gap-x-m gap-y-l lg:grid-cols-4">
                {recommendations.map((card) => (
                  <li key={card.id}>
                    <ProductCard card={card} sizes={PRODUCT_IMAGE_SIZES.recommendation} />
                  </li>
                ))}
              </ul>
            </TrackList>
          </PageContainer>
        </Section>
      ) : null}

      <Section spacing="tight">
        <PageContainer>
          <Link href="/shop" variant="meta">
            Back to the shop
          </Link>
        </PageContainer>
      </Section>
    </>
  )
}
