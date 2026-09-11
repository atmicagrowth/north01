import { TWO_UP_IN_CONTAINER } from '@/lib/media/grid'

/**
 * **Every `sizes` string the product page uses.**
 *
 * The third such table, after `lib/home/sizes.ts` and `lib/catalog/sizes.ts`, and separate for the
 * same reason those two are separate from each other: `MediaImage` requires `sizes` and deliberately
 * does not default it, and the widths here are a different layout's widths. Reusing the catalogue's
 * card string would describe a four-up grid on a page that has a half-width gallery column.
 *
 * ### Every figure below was measured, not derived
 *
 * Phase 13's second sweep resolved each of these strings the way a browser resolves them — walking
 * the media conditions with `matchMedia`, converting the winning value to pixels with a probe
 * element — and compared the answer to the box the element is actually laid out in, at fourteen
 * widths. Arithmetic on paper is how the last three tables got tiers wrong; a measurement is the only
 * thing a `sizes` string is worth.
 *
 * | Viewport | Container inner | Gallery (7 of 12) | Recommendation (4-up, 24px gaps) |
 * |---|---|---|---|
 * | 1920 | 1312 | 749 | 310 |
 * | 1440 | 1325 | **756** | **313** |
 * | 1280 | 1178 | 670 (52.3vw) | 276 |
 * | 1024 | 942 | 533 (52.1vw) | 218 |
 * | 1000 | 920 | 920 (92vw) | 448 (2-up) |
 * | 640 | 589 | 589 (92vw) | 282 (2-up) |
 * | 390 | 350 | 350 | 163 (2-up) |
 *
 * `PageContainer` is `max-w-page` (1440px) with `clamp(1.25rem, 4vw, 4rem)` inline padding, which is
 * why the container is **widest at 1440** rather than above it: the padding is still 4vw there and
 * has not yet reached its 4rem cap. That is the number a `sizes` string wants — the largest box the
 * element is ever laid out in.
 */

export const PRODUCT_IMAGE_SIZES = {
  /**
   * The gallery frame. Seven of twelve columns above `lg`, the full container below it.
   *
   * The bottom tier read `100vw` until it was measured. It is not: the gallery sits inside
   * `PageContainer`, so it is `92vw` from 500px up and `100vw` minus two `1.25rem` gutters below —
   * an over-request of 8% on a tablet and **14% at 320px**. That is Phase 10's audit finding
   * repeating itself in the one tier nobody re-derived, on the largest image the site ships.
   *
   * **Phase 35:** below `lg` the gallery is capped at `52svh` wide (`product-gallery.tsx`), so both
   * lower tiers take the smaller of the container and that cap. The string says `52vh`: `svh` is
   * never larger than `vh`, so the request can only err towards a rendition slightly too big — the
   * direction that costs bytes, not sharpness.
   */
  gallery:
    '(min-width: 1440px) 756px, (min-width: 1024px) 52vw, (min-width: 500px) min(92vw, 52vh), min(calc(100vw - 2.5rem), 52vh)',
  /**
   * The full-screen viewer.
   *
   * `100vw` is honest here: the dialog is the viewport. `productZoom` is Phase 8's largest context,
   * so this is the one surface allowed to ask for the biggest rendition — which is the whole point
   * of a zoom.
   */
  zoom: '100vw',
  /** A 64px thumbnail. Fixed at every width, so no media conditions. */
  thumbnail: '64px',
  /**
   * A recommendation card — four across in the container at `lg`, two below it.
   *
   * This constant existed from the first commit of the phase and **nothing used it**: the row is
   * built from `ProductCard`, which carried the catalogue grid's string, and that string describes a
   * narrower card sitting beside a filter rail. Measured, it under-claimed by **22%** at 1440 — the
   * one direction that costs picture quality rather than bytes, because the browser fetches a
   * rendition too small and the card is upscaled. A constant that is never imported is not a
   * decision; it is a comment that type-checks.
   */
  recommendation: `(min-width: 1440px) 313px, (min-width: 1024px) calc(23vw - 18px), ${TWO_UP_IN_CONTAINER}`,
} as const

export type ProductImageSurface = keyof typeof PRODUCT_IMAGE_SIZES
