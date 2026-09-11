import { formatMinorUnits, formatPriceRange } from '@/lib/money'
import { documentHref } from '@/lib/navigation/routes'
import type { CurrencyCode } from '@/payload/fields/money'
import type { Media, Product } from '@/payload-types'

import type { CatalogQuery, CatalogVocabulary, FacetOption, IgnoredFilter } from './query'

/**
 * **A product, as a listing shows one — and the nine states plan §11.1b requires it to have.**
 *
 * Pure, for the same reason `lib/home/resolve.ts` is: every state below is reachable from a fixture,
 * so `pnpm verify:catalog` can prove that a sold-out product reads as sold out without seeding one,
 * opening a browser, or trusting a docblock.
 *
 * ---
 *
 * ### The nine states, and where each one actually lives
 *
 * Plan §11.1b lists nine. They are not nine variants of one enum — three of them are not data at
 * all, and pretending otherwise is how a card model grows fields nothing reads.
 *
 * | §11.1b | Where it lives |
 * |---|---|
 * | 1. Normal | `state: 'available'` |
 * | 2. Hover | **CSS.** A `group-hover` opacity settle on the photograph, no state and no JavaScript |
 * | 3. Loading | **`ProductCardSkeleton`.** A different component; a card with data is never loading |
 * | 4. New | `isNew` |
 * | 5. Sale | `compareAtLabel !== null` — and only when the saving is real, see below |
 * | 6. Low stock | `state: 'lowStock'` |
 * | 7. Sold out | `state: 'soldOut'` |
 * | 8. Out of season / inactive | `state: 'unavailable'` |
 * | 9. Image unavailable | **`MediaImage`.** It reserves the box from the context and paints a placeholder |
 *
 * So the model carries one `state` for the four mutually exclusive *availability* answers, two
 * independent merchandising booleans, and nothing for the three that belong to CSS, a sibling
 * component, and the image component that already solved it in Phase 8.
 *
 * ### Availability is derived, never stored
 *
 * `ProductVariants.ts` settled this as gap **G-05** and the derivation is copied here rather than
 * re-invented:
 *
 * ```text
 * unavailable   no active variant at all      (derived.priceFromMinor === null)
 * soldOut       active variants, no stock     (inventoryTotal === 0)
 * lowStock      0 < inventoryTotal <= threshold
 * available     inventoryTotal > threshold
 * ```
 *
 * The threshold is `site-settings.lowStockThreshold`, passed in rather than imported, because
 * `SiteSettings.ts` is explicit that it must be *"applied to it at render"* — a stored flag would be
 * stale on every product in the catalogue the moment an editor changed the number.
 *
 * **`unavailable` never appears in the shop grid**, and that is a deliberate asymmetry rather than
 * dead code. `publishedProductWhere` filters those products out of every listing, because a product
 * whose every variant is switched off has been withdrawn from sale. The state exists because later
 * phases link to a *specific* product regardless — a wishlist entry (Phase 20), a curated collection
 * (Phase 23), a recently-viewed rail — and those surfaces must be able to say "not available" rather
 * than render a card with no price and no explanation.
 */

/* -------------------------------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------------------------- */

export type ProductCardState = 'available' | 'lowStock' | 'soldOut' | 'unavailable'

export type ProductCard = {
  /**
   * The struck-through former price, or `null`.
   *
   * `null` unless the saving is **real**. `ProductVariants.ts` says it in the field description —
   * *"an equal or lower value is not a sale and must not be displayed as one"* — and Phase 10
   * declined to render this at all rather than risk it: *"showing 'was $400' next to a price no
   * variant ever sold at is a false saving claim."* The comparison is on minor units, before
   * formatting, so two amounts that format identically under a zero-decimal currency cannot produce
   * a strike-through that says nothing.
   */
  compareAtLabel: null | string
  href: string
  id: number
  /** Populated `Media`, or `null`. A bare id cannot be rendered and is treated as absent. */
  image: Media | null
  isLimitedEdition: boolean
  isNew: boolean
  /** `"Only 3 left"`, or `null`. Never rendered for a state other than `lowStock`. */
  lowStockLabel: null | string
  name: string
  /** `"$240.00"` or `"From $95.00"`. `null` only in the `unavailable` state. */
  priceLabel: null | string
  state: ProductCardState
}

/** One page of the catalogue, whichever engine produced it. */
export type CatalogResult = {
  /**
   * How the answer was produced, so the page can be honest about a degraded one.
   *
   * `unavailable` is not an error the customer caused and not an empty result — it is plan §11.1d's
   * *"search service unavailable"*, and it renders a different surface entirely.
   */
  engine: 'postgres' | 'search' | 'unavailable'
  /**
   * Whether `totalProducts` is exact.
   *
   * Algolia reports `exhaustiveNbHits: false` once a result set is large enough that it stops
   * counting precisely. Printing an approximation as a fact is a small lie the customer can catch by
   * paging to the end, so the count label says "About 240 products" when this is false.
   */
  exhaustive: boolean
  page: number
  products: ProductCard[]
  /**
   * The engine returned hits that Postgres then refused — a product unpublished or deleted since the
   * last sync. Distinct from an empty result, and `searchState` ranks it above one: "nothing
   * matched" would be false when something matched and has just gone.
   */
  stale: boolean
  totalPages: number
  totalProducts: number
}

export const EMPTY_RESULT: CatalogResult = {
  engine: 'postgres',
  exhaustive: true,
  stale: false,
  page: 1,
  products: [],
  totalPages: 0,
  totalProducts: 0,
}

/** Everything `/shop` and `/shop/<category>` need in order to render, in one object. */
export type CatalogView = {
  ignored: IgnoredFilter[]
  query: CatalogQuery
  result: CatalogResult
  vocabulary: CatalogVocabulary
}

/* -------------------------------------------------------------------------------------------------
 * Resolution
 * ---------------------------------------------------------------------------------------------- */

/** An `upload` or `relationship` holds a populated document or a bare id; only the first renders. */
const asMedia = (value: unknown): Media | null =>
  typeof value === 'object' && value !== null && 'id' in value ? (value as Media) : null

const text = (value: null | string | undefined): null | string => value?.trim() || null

/** A whole, non-negative, safe integer. Anything else is not a price. */
const isMinorUnits = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/**
 * The availability state, from the one column that cannot drift.
 *
 * `threshold` is clamped to at least 1 because `SiteSettings.lowStockThreshold` has `min: 1` but the
 * value arrives here from a database row that may predate that constraint. A threshold of `0` would
 * make `lowStock` unreachable and would silently reclassify every sold-out product as available.
 */
export function productCardState(
  priceFromMinor: null | number | undefined,
  inventoryTotal: null | number | undefined,
  threshold: number,
): ProductCardState {
  if (!isMinorUnits(priceFromMinor)) {
    return 'unavailable'
  }

  const stock = typeof inventoryTotal === 'number' && inventoryTotal > 0 ? inventoryTotal : 0

  if (stock === 0) {
    return 'soldOut'
  }

  return stock <= Math.max(1, Math.floor(threshold)) ? 'lowStock' : 'available'
}

/**
 * One product, or `null`.
 *
 * The `null` cases are every way a row can be something a customer must not see, checked in cost
 * order — the cheap structural ones first. A product is dropped when it has no resolvable path or no
 * name; it is **not** dropped for having no price, because unlike the homepage rail this model has a
 * state for that and later phases need it.
 *
 * Nothing here builds a URL. `documentHref` encodes the slug, which is Phase 9's rule and the reason
 * a stored `../../admin` cannot climb out of its namespace.
 */
export function resolveProductCard(
  value: unknown,
  currency: CurrencyCode,
  locale: string,
  lowStockThreshold: number,
): ProductCard | null {
  const product = typeof value === 'object' && value !== null ? (value as Product) : null

  if (!product) {
    return null
  }

  const slug = text(product.slug)

  if (!slug) {
    return null
  }

  const href = documentHref('products', slug)

  if (!href) {
    return null
  }

  const name = text(product.name)

  if (!name) {
    return null
  }

  const priceFromMinor = product.derived?.priceFromMinor
  const priceToMinor = product.derived?.priceToMinor
  const compareAtFromMinor = product.derived?.compareAtFromMinor
  const inventoryTotal = product.derived?.inventoryTotal

  const state = productCardState(priceFromMinor, inventoryTotal, lowStockThreshold)

  /*
   * A genuine saving only. Both values must be prices, and the former one must be strictly greater —
   * `compareAt === price` is not a sale, and `compareAt < price` is a data-entry error that would
   * otherwise render as a *negative* saving.
   */
  const hasRealSaving =
    isMinorUnits(compareAtFromMinor) &&
    isMinorUnits(priceFromMinor) &&
    compareAtFromMinor > priceFromMinor

  return {
    compareAtLabel: hasRealSaving ? formatMinorUnits(compareAtFromMinor, currency, locale) : null,
    href,
    id: product.id,
    // The first gallery image is the card image — `Products.ts` says so in the field description.
    image: asMedia(product.gallery?.[0]?.image),
    isLimitedEdition: product.isLimitedEdition === true,
    isNew: product.isNew === true,
    lowStockLabel:
      state === 'lowStock' && typeof inventoryTotal === 'number'
        ? `Only ${inventoryTotal} left`
        : null,
    name,
    priceLabel: formatPriceRange(priceFromMinor, priceToMinor, currency, locale),
    state,
  }
}

/**
 * **Every product field a card or a tile reads — and nothing else.** Pass it as
 * `populate: { products: PRODUCT_CARD_POPULATE }` on any read whose products arrive *populated*
 * through a relationship rather than queried directly.
 *
 * Phase 30 measured why it exists. A product carries two `join` fields — `variants` and
 * `collections` — and Payload populates both on every product it populates, at whatever depth is
 * left. A collection page read at `depth: 2` therefore fetched nine products **with ten variants
 * each**, every variant's image, and each product's collection back-references, then handed them to
 * `resolveProductCards`, which reads six fields. `joins: false` on the outer query does not reach
 * the nested products; this does. Measured against the development branch: 890ms to 675ms on a
 * collection, 900 to 720 on a journal article, 480 to 380 on an edit.
 *
 * The list is the union of what `resolveProductCards` (above), `resolveProductTile` **and
 * `isPublicDocument`** (both `lib/home/resolve.ts`) read. Add to it when any of them starts reading a
 * new field — a field missing here arrives `undefined`, and nothing errors.
 *
 * **This list shipped without `status` and `publishedAt`, and every lookbook lost its hotspots.**
 * `resolveProductTile` asks `isPublicDocument` before it will link a product, and that asks
 * `status === 'published'` — so with `status` absent, every tile in a lookbook chapter, a
 * `productGroup` and a `shopTheLook` block resolved to `null` and was dropped as *unpublished*. The
 * before-and-after DOM diff that was meant to prove this change safe did not catch it, because the
 * card path (`resolveProductCard`) never checks `status`, and the one lookbook it rendered had no
 * hotspots to lose. Sweep 1 found it; `verify:lookbook` now asserts a seeded lookbook resolves its
 * hotspots through this exact read.
 *
 * `publishedAt` is not optional either: `isPublicDocument` skips its scheduled-drop gate when the key
 * is *absent*, so selecting `status` alone would have let a product scheduled for next week link from
 * a lookbook today.
 *
 * Direct reads use `joins: false` instead, for the same reason and with the same measurement behind
 * it: no storefront code reads either join field. The product page reads its variants with an
 * explicit, exhaustive query, and a card reads `derived`.
 */
export const PRODUCT_CARD_POPULATE = {
  derived: true,
  gallery: true,
  isLimitedEdition: true,
  isNew: true,
  name: true,
  /*
   * `status` and `publishedAt` are read by `isPublicDocument`, not by either card — and leaving them
   * out emptied every lookbook of its hotspots. See the docblock.
   */
  publishedAt: true,
  slug: true,
  status: true,
} as const

export const resolveProductCards = (
  values: readonly unknown[] | null | undefined,
  currency: CurrencyCode,
  locale: string,
  lowStockThreshold: number,
): ProductCard[] =>
  (values ?? [])
    .map((value) => resolveProductCard(value, currency, locale, lowStockThreshold))
    .filter((card) => card !== null)

/* -------------------------------------------------------------------------------------------------
 * Presentation helpers
 * ---------------------------------------------------------------------------------------------- */

/**
 * **One badge, by precedence — never a row of stickers.**
 *
 * Visual guide §06 asks for badges that are *"small, typographic, quiet, monochrome or very
 * restrained"* and says outright: *"avoid colourful sticker-like badges."* §07 adds that product
 * information should be *"visually quieter than the imagery."* A card that can show NEW and SALE and
 * LIMITED and LOW STOCK at once is four labels over a photograph, which is the thing both sections
 * forbid.
 *
 * So availability outranks merchandising, always. *"Sold out"* is something the customer needs
 * before they need to know the garment is new — a NEW badge on a product that cannot be bought is an
 * advertisement for a disappointment.
 *
 * The sale state is **not** dropped when it loses the badge: `compareAtLabel` still renders as a
 * struck-through price in the price line, which is where a saving is legible anyway. So a sold-out
 * item on sale shows "Sold out" over the image and the struck price beneath it, and nothing is lost.
 */
export function productCardBadge(card: ProductCard): null | {
  tone: 'accent' | 'default' | 'muted'
  label: string
} {
  if (card.state === 'soldOut') {
    return { label: 'Sold out', tone: 'muted' }
  }

  if (card.state === 'unavailable') {
    return { label: 'Unavailable', tone: 'muted' }
  }

  if (card.state === 'lowStock' && card.lowStockLabel) {
    return { label: card.lowStockLabel, tone: 'default' }
  }

  if (card.compareAtLabel) {
    return { label: 'Sale', tone: 'accent' }
  }

  if (card.isNew) {
    return { label: 'New', tone: 'accent' }
  }

  if (card.isLimitedEdition) {
    return { label: 'Limited', tone: 'accent' }
  }

  return null
}

/**
 * `"24 products"`, `"1 product"`, `"No products"`.
 *
 * Plan §11.1a lists the product count as a required element of the shop page, and the singular
 * matters more than it looks: *"1 products"* is the tell of a listing nobody read the output of.
 */
export function productCountLabel(total: number, exhaustive = true): string {
  if (total <= 0) {
    return 'No products'
  }

  if (total === 1) {
    return '1 product'
  }

  /*
   * "About" only when the engine said it was approximating. Hedging an exact count would be as
   * dishonest as stating an approximate one — in the opposite direction, and on every page.
   */
  return `${exhaustive ? '' : 'About '}${total.toLocaleString('en-US')} products`
}

/**
 * The applied filters, as removable chips.
 *
 * Built here rather than in the component so the harness can assert that every applied filter is
 * offered back for removal. A filter a customer can apply and cannot see is a filter they cannot
 * clear, which is how a shop ends up looking permanently empty.
 *
 * The route's own category is excluded by the caller passing `routeCategory` — see
 * `isFilteredQuery` for why standing somewhere is not the same as filtering by it.
 */
export function activeFilterChips(
  query: CatalogQuery,
  vocabulary: CatalogVocabulary,
  formatPrice: (minor: number) => null | string,
  routeCategory?: null | string,
  /**
   * The term that IS the route.
   *
   * On `/search?q=merino` the term is the page title, so a chip for it would be a second copy of the
   * heading whose only action is to leave the page. On `/shop?q=merino` it IS a filter over a
   * browse, and gets a removable chip like any other.
   */
  routeQuery?: null | string,
): { facet: string; label: string; value: string }[] {
  const chips: { facet: string; label: string; value: string }[] = []

  if (query.q !== null && !routeQuery) {
    chips.push({ facet: 'q', label: `“${query.q}”`, value: query.q })
  }

  const label = (options: FacetOption[], value: string): string =>
    options.find((option) => option.value === value)?.label ?? value

  if (!routeCategory) {
    /*
     * `requestedCategories`, not `categories`. The latter is the expanded subtree, so building chips
     * from it renders one per descendant — ticking Clothing produced *Clothing*, *Tops* and
     * *Hoodies*. Both fields exist precisely so this distinction can be made; see `CatalogQuery`.
     */
    for (const value of query.requestedCategories) {
      chips.push({ facet: 'category', label: label(vocabulary.categories, value), value })
    }
  }

  for (const value of query.collections) {
    chips.push({ facet: 'collection', label: label(vocabulary.collections, value), value })
  }

  for (const value of query.colors) {
    chips.push({ facet: 'color', label: label(vocabulary.colors, value), value })
  }

  for (const value of query.sizes) {
    chips.push({ facet: 'size', label: `Size ${label(vocabulary.sizes, value)}`, value })
  }

  if (query.availability === 'in-stock') {
    chips.push({ facet: 'availability', label: 'In stock', value: 'in-stock' })
  }

  if (query.priceMinMinor !== null || query.priceMaxMinor !== null) {
    const from = query.priceMinMinor === null ? null : formatPrice(query.priceMinMinor)
    const to = query.priceMaxMinor === null ? null : formatPrice(query.priceMaxMinor)

    chips.push({
      facet: 'price',
      label: from && to ? `${from} – ${to}` : from ? `From ${from}` : `Up to ${to}`,
      value: 'price',
    })
  }

  return chips
}
