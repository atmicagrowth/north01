/**
 * **Every `sizes` string the homepage uses, in one place.**
 *
 * `MediaImage` requires `sizes` and deliberately does not default it, because *"a `srcset` with `w`
 * descriptors and no `sizes` is specified to fall back to `100vw`"* — which on a four-up grid asks
 * the browser for an image four times wider than the box. The values below are the widths each
 * surface actually occupies, and they are a table rather than a dozen literals scattered through
 * components so that `verify-home.ts` can assert every one of them exists and is non-empty.
 *
 * The numbers are read off the layout, not guessed:
 *
 * - **1312px** is the `page` container at its 1440px maximum minus two 64px gutters — the outer
 *   margin is `clamp(1.25rem, 4vw, 4rem)`, so 64px is where it stops growing.
 * - **58vw** is the 7/12 media pane in `EditorialBlock`'s asymmetric split, at the `lg` breakpoint
 *   where that grid engages.
 * - The tile percentages follow the column counts in the components: four across at `lg`, three at
 *   `sm`, two below.
 *
 * Two entries deserve their reasons written down:
 *
 * **Shop-the-look is `editorial`, and it must be.** `lib/media/cloudinary-url.ts` says any surface
 * carrying hotspots has to use the uncropped context, because hotspot coordinates are percentages of
 * the delivered frame and a `c_fill` would move every marker off its garment.
 *
 * **Social tiles are `productCard` (4:5), not square.** The only square context is `thumbnail`,
 * whose largest width is 320px — a quarter of what a four-up desktop grid needs at 2× DPR. Adding a
 * ninth context is a Phase 8 change (**DEV-34** fixed the set at eight), and a portrait crop suits
 * fashion imagery anyway.
 */
export const HOME_IMAGE_SIZES = {
  /** Full-bleed campaign frame. */
  hero: '100vw',
  /** Full-bleed collection opener. */
  collectionFeature: '100vw',
  /** A figure given the whole viewport. */
  figureFullBleed: '100vw',
  /** A figure inside the page gutters. */
  figureContained: '(min-width: 1440px) 1312px, (min-width: 1024px) 92vw, 100vw',
  /** The 7-of-12 media pane in an asymmetric split. */
  splitFeature: '(min-width: 1024px) 58vw, 100vw',
  /**
   * The full contained width — the same as a contained figure, because that is what it is.
   *
   * This read `66vw` until it was **measured**: the block renders inside `PageContainer`, so at a
   * 1440px viewport the element is 1325px wide and the browser was choosing the 1024px candidate —
   * a 28% shortfall, upscaled, on the one image whose detail the customer is asked to point at.
   * A `sizes` string is a promise about layout, and it is only worth what a measurement says.
   */
  shopTheLook: '(min-width: 1440px) 1312px, (min-width: 1024px) 92vw, 100vw',
  /** Four across on desktop, three on tablet, two on a phone. */
  categoryTile: '(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw',
  productTileGrid: '(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw',
  /** A horizontal rail shows a little over four, and a peek of the next, on a phone. */
  productTileRail: '(min-width: 1024px) 22vw, (min-width: 640px) 40vw, 72vw',
  socialTile: '(min-width: 1024px) 25vw, 50vw',
} as const

export type HomeImageSurface = keyof typeof HOME_IMAGE_SIZES
