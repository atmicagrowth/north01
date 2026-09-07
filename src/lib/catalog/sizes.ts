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
   */
  productCardGrid:
    '(min-width: 1440px) 244px, (min-width: 1280px) 17vw, (min-width: 1024px) 21vw, 44vw',
  /**
   * The category header image on `/shop/<category>`: full container width, no sidebar beside it.
   * Identical to the homepage's contained figure, because that is what it is.
   */
  categoryHeader: '(min-width: 1440px) 1312px, (min-width: 1024px) 92vw, 100vw',
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
