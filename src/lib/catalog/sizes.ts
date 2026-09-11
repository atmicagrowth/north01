import { THREE_UP_IN_CONTAINER, TWO_UP_IN_CONTAINER } from '@/lib/media/grid'

/**
 * **Every `sizes` string the catalogue uses, in one place.**
 *
 * The same table `lib/home/sizes.ts` keeps for the homepage, and it exists for the same reason:
 * `MediaImage` requires `sizes` and deliberately does not default it, because *"a `srcset` with `w`
 * descriptors and no `sizes` is specified to fall back to `100vw`"*. On a four-up grid that asks the
 * browser for an image four times wider than the box.
 *
 * ### The numbers are read off the layout, and the layout has a sidebar
 *
 * This is the difference from `HOME_IMAGE_SIZES.productTileGrid`, and it is why the two tables are
 * separate rather than one shared constant. A homepage rail is four tiles across the whole
 * container; the shop grid is four tiles across *the container minus a 224px filter rail and the
 * 40px gap beside it*. Reusing the homepage string here would over-request by roughly a fifth on
 * every card on the page.
 *
 * Phase 10's audit is the reason each tier is derived rather than guessed: **a `vw` unit measures
 * the viewport, and every element here lives in a container that stops growing at 1440px.** So each
 * figure below is the fraction of the *container* expressed against the viewport at the breakpoint
 * where that tier starts, with a fixed-pixel tier above 1440 where the container stops growing.
 *
 * The arithmetic, written out so a reviewer can check it rather than trust it. `PageContainer` is
 * `max-w-page` (1440px) with a `clamp(1.25rem, 4vw, 4rem)` inline padding, and the grid is
 * `gap-x-m` (24px):
 *
 * | Viewport | Container content | Grid area | Columns | Card |
 * |---|---|---|---|---|
 * | 1600+ | 1440 − 128 = 1312 | 1312 − 264 = 1048 | 4 | (1048 − 72) / 4 = **244px** |
 * | 1280 | 1280 − 102 = 1178 | 1178 − 264 = 914 | 4 | (914 − 72) / 4 = 210px ≈ **17vw** |
 * | 1024 | 1024 − 82 = 942 | 942 − 264 = 678 | 3 | (678 − 48) / 3 = 210px ≈ **21vw** |
 * | 640 | 640 − 51 = 589 | 589 | 2 | (589 − 24) / 2 = 282px ≈ **44vw** |
 *
 * The browser pass asserts the same property Phase 10's did: no image is delivered narrower than the
 * box it renders into. Over-requesting wastes bytes; under-requesting upscales, which is worse.
 */
export const CATALOG_IMAGE_SIZES = {
  /**
   * A product card in the shop grid — two across on a phone, three beside the filter rail at `lg`,
   * four at `xl`.
   *
   * Every tier below 1440 was re-derived from measurement in Phase 13's second sweep. The two above
   * `lg` sit beside the filter rail, so they are the container **minus a fixed 353px of sidebar and
   * gaps** rather than a clean fraction of it — `17vw` and `21vw` were the fraction, and each
   * over-claimed by 5–6%. The bottom tier read `44vw`, which is what a two-up grid measures at about
   * 700px and not what it measures at 320, where it is 40vw.
   *
   * | Viewport | Columns | Measured | Declared now |
   * |---|---|---|---|
   * | 1920 | 4 | 240 | 244px |
   * | 1440 | 4 | 243 | 244px |
   * | 1280 | 4 | 206 | `23vw - 88px` = 206 |
   * | 1100 | 3 | 228 | `30.667vw - 109px` = 228 |
   * | 1024 | 3 | 205 | 205 |
   * | 640 | 2 | 282 | `46vw - 12px` = 282 |
   * | 320 | 2 | 128 | `50vw - 32px` = 128 |
   */
  productCardGrid: `(min-width: 1440px) 244px, (min-width: 1280px) calc(23vw - 88px), (min-width: 1024px) calc(30.667vw - 109px), ${TWO_UP_IN_CONTAINER}`,
  /**
   * **The same grid with no filter rail beside it** — collections, edits, journal articles and the
   * search landing. Phase 30's sweep found all five using `productCardGrid`, which subtracts a 353px
   * rail that is not there, so every card was **under**-fetched: 205px declared for a 298px card at
   * 1024, and a 1024@2x screen served `w_430` where 596 was needed. Under-fetching upscales, which
   * the table above calls worse than over-fetching.
   *
   * Derived from `ProductGrid`'s own `grid-cols-2 gap-x-m lg:grid-cols-3 xl:grid-cols-4` inside
   * `PageContainer`, and matching the measured 310 / 313 / 276 / 298 / 341 / 128 at 1920, 1440,
   * 1280, 1024, 768 and 320. The 1440–1600 tier is the band where `max-w-page` caps the container
   * before the padding `clamp` does (`lib/media/grid.ts`).
   */
  productCardGridFull: `(min-width: 1600px) 310px, (min-width: 1440px) calc(342px - 2vw), (min-width: 1280px) calc(23vw - 18px), (min-width: 1024px) calc(30.667vw - 16px), ${TWO_UP_IN_CONTAINER}`,
  /**
   * **`/account/wishlist`** — `grid-cols-2 gap-m sm:grid-cols-3` inside the NARROW container (1024px
   * border-box). It used `productCardGrid`, the shop's rail-adjusted string: 1.75x over-fetch at 768,
   * 0.72x under-fetch at 1024 and 1280. Matches the measured 219.5 / 298 / 291 / 287 / 283 at 768,
   * 1024, 1280, 1440 and 1920 to within half a pixel.
   */
  accountGrid: `(min-width: 1600px) 283px, (min-width: 1024px) calc(325px - 2.667vw), (min-width: 640px) ${THREE_UP_IN_CONTAINER}, ${TWO_UP_IN_CONTAINER}`,
  /**
   * The category header image on `/shop/<category>`: full container width, no sidebar beside it.
   * Identical to the homepage's contained figure, because that is what it is.
   */
  categoryHeader: '(min-width: 1440px) 1312px, (min-width: 500px) 92vw, calc(100vw - 2.5rem)',
  /**
   * The thumbnail on a search-suggestion row. A fixed 56px box at every width.
   *
   * `MediaImage.sizes` is required and deliberately not defaulted, so this entry has to exist —
   * and reusing `productCardGrid` here would be worse than forgetting it: that string promises a
   * 244px minimum, so every settled keystroke would request six images four times wider than the
   * 56px box they render into, on the one code path that runs per keystroke.
   */
  searchSuggestionThumb: '56px',
} as const

export type CatalogImageSurface = keyof typeof CATALOG_IMAGE_SIZES
