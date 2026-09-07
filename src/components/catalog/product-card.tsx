import { MediaImage } from '@/components/media/media-image'
import { Badge } from '@/components/ui/badge'
import { Link } from '@/components/ui/link'
import { Skeleton } from '@/components/ui/skeleton'
import { CATALOG_IMAGE_SIZES } from '@/lib/catalog/sizes'
import { productCardBadge, type ProductCard as ProductCardModel } from '@/lib/catalog/resolve'
import { cn } from '@/lib/cn'

/**
 * **Plan §11.1b's product card.** The nine states, and only the ones that are data.
 *
 * `lib/catalog/resolve.ts` holds the table mapping each of the nine onto where it lives. Three of
 * them are not props: **hover** is a CSS transition, **loading** is `ProductCardSkeleton` below, and
 * **image unavailable** was solved in Phase 8 by `MediaImage`, which reserves the box from the
 * delivery context and paints a placeholder into it. The other six arrive on the model.
 *
 * ### What this is, next to `components/home/product-tile.tsx`
 *
 * The homepage tile deliberately renders image, name and price and nothing else — its docblock says
 * so, and names this component as the thing that would eventually carry the states. They are not
 * merged, because they are not the same component wearing two hats:
 *
 * - the tile is a **merchandising** surface inside an editorial page, where guide §09 wants product
 *   areas to *"feel like interruptions in a fashion story"* — a badge on it would be a sticker in
 *   the middle of a campaign;
 * - the card is a **catalogue** surface, where a customer is comparing twenty-four garments and the
 *   difference between "sold out" and "three left" is the information they came for.
 *
 * They share the parts that must not drift — `MediaImage`, the `productCard` crop, `Link`, the price
 * formatter — and differ in exactly the way the two pages differ.
 *
 * ### Guide §07, applied as literally as on the tile
 *
 * *"Product names and pricing should be visually quieter than the imagery."* *"Avoid turning every
 * product into a floating rounded card."* So: no border, no surface fill, no radius, no shadow. An
 * image with two lines under it, and at most one small typographic badge over the image — §06's
 * *"small, typographic, quiet, monochrome or very restrained"*, never a filled sticker.
 *
 * `alt=""` is correct and not an oversight: the link's accessible name comes from the product name
 * inside it, and a second announcement of the same words is noise to a screen-reader user. This is
 * the WAI-ARIA "functional image inside a labelled link" pattern, and it is the same choice
 * `ProductTile` documents.
 *
 * ### The sold-out card is still a link, and that is deliberate
 *
 * It would be easy to make an unbuyable card inert. It would also be wrong: a customer wants to
 * *look* at the garment, check the size chart, and be told when it returns — all of which live on
 * the PDP. Feature matrix §4 lists "sold-out product" as a card **state**, not as a removal. What
 * changes is the photograph's weight and one badge, so the grid reads at a glance without any card
 * becoming a dead end.
 *
 * The badge is inside the link on purpose, so the accessible name of a sold-out card is
 * *"Merino Crew, Sold out"* — the state reaches a screen-reader user through the same words a
 * sighted customer reads, rather than through a colour or an opacity they cannot perceive.
 */
export function ProductCard({
  card,
  priority = false,
  sizes = CATALOG_IMAGE_SIZES.productCardGrid,
}: {
  card: ProductCardModel
  /** The first card of the first page may be the LCP element. Everything else is lazy. */
  priority?: boolean
  /**
   * The layout this card is in.
   *
   * Defaulted to the shop grid, because that is where most of them live — but it is a **prop**
   * rather than a constant since Phase 13's second sweep, which measured the product page's
   * recommendation row rendering this component 313px wide while its hard-coded string promised the
   * browser 244px. A card is not the same width everywhere it appears, and `sizes` is a promise
   * about where it is.
   */
  sizes?: string
}) {
  const badge = productCardBadge(card)
  const isUnbuyable = card.state === 'soldOut' || card.state === 'unavailable'

  return (
    <Link
      href={card.href}
      variant="unstyled"
      className="group block focus-visible:outline-offset-4"
      data-slot="product-card"
      data-state={card.state}
    >
      <div className="relative">
        <MediaImage
          media={card.image}
          context="productCard"
          sizes={sizes}
          priority={priority}
          alt=""
          imageClassName={cn(
            'object-cover transition-opacity duration-(--duration-base) ease-editorial group-hover:opacity-85',
            /*
             * The sold-out photograph recedes rather than being covered by a scrim. A scrim is an
             * opaque panel over a garment somebody is trying to look at; halving the contrast says
             * the same thing and leaves the product visible, which is guide §11's "avoid heavy
             * overlays on imagery".
             */
            isUnbuyable && 'opacity-55',
          )}
        />

        {badge ? (
          <Badge
            variant={badge.tone}
            className={cn(
              'absolute left-2 top-2 bg-canvas/85 backdrop-blur-[2px]',
              /* `muted` loses its rule, so it needs the ground to stay legible over a photograph. */
              badge.tone === 'muted' && 'border-border',
            )}
          >
            {badge.label}
          </Badge>
        ) : null}
      </div>

      <div className="mt-s flex flex-col gap-1">
        <p className="font-sans text-body-sm text-foreground">{card.name}</p>

        <p className="flex items-baseline gap-2 font-sans text-meta text-foreground-muted">
          {card.priceLabel ? (
            /*
             * The price actually payable is the brighter of the two when there is a saving, which is
             * hierarchy rather than decoration: the number a customer will be charged should not be
             * the quieter one on the card.
             */
            <span className={card.compareAtLabel ? 'text-foreground' : undefined}>
              {card.priceLabel}
            </span>
          ) : (
            /*
             * The `unavailable` state has no price, and `formatPriceRange` returned `null` rather
             * than `$0.00` precisely so this branch has to exist. A product with no purchasable
             * variant has no price, and inventing one is the false claim `lib/money.ts` refuses to
             * make.
             */
            <span>Currently unavailable</span>
          )}

          {card.compareAtLabel ? (
            /*
             * **Stone (7.91:1), not the disabled tone (4.15:1).** This read `text-foreground-disabled`
             * and axe-core called it, correctly: a former price is *information a customer reads*,
             * not a dimmed control. `Badge`'s own docblock states the rule that was broken here —
             * "'Sold out' is information a customer reads, so it keeps Stone's 7.91:1 rather than
             * dropping to the 4.15:1 tone reserved for disabled" — and the same applies to a struck
             * price. The strike-through is what marks it as former; the colour must not also have to.
             */
            <s className="text-foreground-muted">
              {/*
                The struck price is announced with its meaning rather than as a bare number: `<s>`
                conveys nothing to a screen reader, so "Merino Crew, $180.00, was $240.00" is what
                the visually-hidden word buys. Without it the two prices are read as one confusing
                sequence.
              */}
              <span className="sr-only">was </span>
              {card.compareAtLabel}
            </s>
          ) : null}
        </p>
      </div>
    </Link>
  )
}

/**
 * **§11.1b state 3, loading.**
 *
 * A separate component rather than a prop, because a card that has data is never loading and a card
 * that is loading has no data to give it. One `ProductCard` with every field optional would be a
 * component whose type says nothing.
 *
 * The proportions are the real card's: the same 4:5 frame, the same two lines beneath it at the same
 * rhythm. A skeleton whose shape differs from the content it stands in for causes the layout shift
 * it exists to prevent — which is the same argument `MediaImage` makes for reserving its box from
 * the context rather than from the asset.
 *
 * Phase 10 recorded that the `Skeleton` primitive was going unused and that *"Phase 11's shop page
 * has real filter-driven streaming and is where it earns its place."* This is that place: the grid
 * is wrapped in a `<Suspense>` keyed on the query, so changing a filter paints a full grid of these
 * immediately instead of leaving the previous results on screen looking like the new answer.
 */
export function ProductCardSkeleton() {
  return (
    <div data-slot="product-card-skeleton">
      <Skeleton className="aspect-[4/5] w-full" />

      <div className="mt-s flex flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  )
}
