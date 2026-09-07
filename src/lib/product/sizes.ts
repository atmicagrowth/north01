/**
 * **Every `sizes` string the product page uses.**
 *
 * The third such table, after `lib/home/sizes.ts` and `lib/catalog/sizes.ts`, and separate for the
 * same reason those two are separate from each other: `MediaImage` requires `sizes` and deliberately
 * does not default it, and the widths here are a different layout's widths. Reusing the catalogue's
 * card string would describe a four-up grid on a page that has a half-width gallery column.
 *
 * ### The arithmetic
 *
 * `PageContainer` is `max-w-page` (1440px) with `clamp(1.25rem, 4vw, 4rem)` inline padding, and the
 * product page is a two-column grid above `lg`: the gallery takes 7 of 12 columns with a `gap-l`
 * (40px) between.
 *
 * | Viewport | Container | Gallery column |
 * |---|---|---|
 * | 1600+ | 1440 − 128 = 1312 | (1312 − 40) × 7/12 = **742px** |
 * | 1280 | 1280 − 102 = 1178 | (1178 − 40) × 7/12 = 664px ≈ **52vw** |
 * | 1024 | 1024 − 82 = 942 | (942 − 40) × 7/12 = 526px ≈ **51vw** |
 * | below `lg` | full width | **100vw** |
 *
 * The `vw` figures are the fraction of the **container** expressed against the viewport at the
 * breakpoint where each tier starts — the correction Phase 10's audit forced after two strings were
 * found describing the viewport when they meant the container.
 */
export const PRODUCT_IMAGE_SIZES = {
  /** The gallery frame. Full-bleed on a phone, seven of twelve columns above `lg`. */
  gallery: '(min-width: 1440px) 742px, (min-width: 1024px) 52vw, 100vw',
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
  /** A recommendation card — four across in the container, two on a phone. */
  recommendation:
    '(min-width: 1440px) 304px, (min-width: 1024px) 22vw, (min-width: 640px) 30vw, 44vw',
} as const

export type ProductImageSurface = keyof typeof PRODUCT_IMAGE_SIZES
