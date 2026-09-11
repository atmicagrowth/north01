import { MediaImage } from '@/components/media/media-image'
import { Link } from '@/components/ui/link'
import { HOME_IMAGE_SIZES } from '@/lib/home/sizes'
import type { ProductTile as ProductTileModel } from '@/lib/home/resolve'

/**
 * **A product, as the homepage shows one.** Image, name, price. Nothing else.
 *
 * ### What this is not
 *
 * It is **not** plan §11.1b's product card, and the restraint is deliberate rather than
 * unfinished. That card has nine states — hover, loading, new, sale, low stock, sold out,
 * out-of-season, image unavailable — and a wishlist control (§11.1c's quick view and quick add
 * were withdrawn, DEV-76). All of it belongs to **Phase 11**, which builds the catalogue those states describe.
 * Building them here would be a later phase's feature arriving early, and arriving without the
 * shop page that gives them meaning.
 *
 * So this renders, and only this:
 *
 * - one link wrapping the whole tile;
 * - the image, in the `productCard` context so every tile on the page is the same 4:5 rectangle;
 * - the name, quietly;
 * - one price line.
 *
 * And it deliberately does **not** render: a hover treatment beyond the design system's own colour
 * transition, an image swap, badges of any kind, a struck-through compare-at price, swatches, sizes,
 * stock counts, ratings, or a skeleton. `ProductTile.soldOut` is carried by the resolver and is
 * **read by nothing here** — Phase 11 owns that state, and the fact is on the model so the tile does
 * not have to be re-plumbed when it does.
 *
 * `compareAtFromMinor` exists on every product and is likewise unread. Showing *"was $400"* next to
 * a price no variant ever sold at is a false saving claim, and the sale state is §11.1b's.
 *
 * ### Guide §07, applied literally
 *
 * *"Product names and pricing should be visually quieter than the imagery."* *"Avoid turning every
 * product into a floating rounded card."* There is no border, no surface fill, no radius and no
 * shadow — an image with two lines under it. The only decoration is a slow opacity settle on the
 * photograph at hover, which is the guide's *"hover states should be subtle and controlled."*
 *
 * `alt=""` on the image is correct and not an oversight: the link's accessible name comes from the
 * product name inside it, and a second announcement of the same words is noise to a screen-reader
 * user. This is the WAI-ARIA "functional image inside a labelled link" pattern.
 *
 * The whole tile is a link to `/product/<slug>`, which **404s until Phase 13 builds the PDP**. That
 * is the same accepted state Phase 9 shipped for the navigation, and `global-not-found.tsx` answers
 * it inside the shell rather than with a blank page. Nothing here should paper over it.
 */
export function ProductTile({
  product,
  layout = 'grid',
  priority = false,
}: {
  product: ProductTileModel
  /** Decides the `sizes` string only — the tile's own shape is identical either way. */
  layout?: 'grid' | 'rail'
  /** The one image on the page allowed to be eager. See `home-sections.tsx`. */
  priority?: boolean
}) {
  return (
    <Link
      href={product.href}
      variant="unstyled"
      className="group block focus-visible:outline-offset-4"
      data-slot="product-tile"
    >
      <MediaImage
        media={product.image}
        context="productCard"
        sizes={
          layout === 'rail' ? HOME_IMAGE_SIZES.productTileRail : HOME_IMAGE_SIZES.productTileGrid
        }
        priority={priority}
        alt=""
        imageClassName="object-cover transition-opacity duration-(--duration-base) ease-editorial group-hover:opacity-85"
      />

      <div className="mt-s flex flex-col gap-1">
        <p className="font-sans text-body-sm text-foreground">{product.name}</p>
        <p className="font-sans text-meta text-foreground-muted">{product.priceLabel}</p>
      </div>
    </Link>
  )
}
