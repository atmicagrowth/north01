/**
 * **The container arithmetic every `sizes` table shares.**
 *
 * Three tables describe images — `lib/home/sizes.ts`, `lib/catalog/sizes.ts` and
 * `lib/product/sizes.ts` — and they are deliberately separate, because the same photograph is a
 * different width in a rail, a grid and a gallery. But three of their tiers describe the *same*
 * layout: a grid inside `PageContainer` on a narrow screen. Those tiers were written out three
 * times, each rounded to a plausible `vw`, and all three were wrong in the same place.
 *
 * ### Why the small tier is a subtraction rather than a fraction
 *
 * `PageContainer` is `max-w-page` with `clamp(1.25rem, 4vw, 4rem)` of inline padding. That `clamp`
 * has three regimes and only the middle one is proportional:
 *
 * | Viewport | Padding a side | Container inner |
 * |---|---|---|
 * | below 500px | `1.25rem` — the floor | `100vw - 2.5rem` |
 * | 500–1600px | `4vw` | `92vw` |
 * | above 1600px | `4rem` — the cap | capped by `max-w-page` anyway |
 *
 * A single `vw` figure can only be right in one of them. `48vw` and `44vw` were each about right in
 * the middle of their range and up to **20% wrong at 320px** — the width where an over-request costs
 * the most, on the connection least able to pay for it.
 *
 * Measured at fourteen viewport widths against the box each element is actually laid out in, rather
 * than derived on paper. Paper is how the tiers got wrong the first time.
 */

/** Two across inside `PageContainer`, with the `gap-x-m` (24px) the grids use. Exact at every measured width. */
export const TWO_UP_IN_CONTAINER = '(min-width: 500px) calc(46vw - 12px), calc(50vw - 32px)'

/** Three across inside `PageContainer`, same gap. */
export const THREE_UP_IN_CONTAINER = 'calc(30.667vw - 16px)'

/**
 * ### The editorial index grids — a different gap, and a column count that changes twice
 *
 * The two tiers above describe a grid whose column count is fixed and whose gap is `gap-x-m` (24px).
 * `/journal`, `/lookbook`, `/collections` and `/edit` are neither: they use `gap-l` (**40px**) and
 * they *drop columns* at `sm` and `lg`, so a single N-up fraction is wrong at both ends of the range.
 *
 * All four shipped with `HOME_IMAGE_SIZES.figureContained`, which promises the **entire** container —
 * 1312px at 1920 — for a card that is 411px wide there. Correct for a full-bleed-within-gutters
 * editorial figure, which is what that constant is named for and what `editorial-body`, `-blocks`,
 * `collection-page` and `lookbook-page`'s chapter hero still correctly use it for — but not the
 * lookbook's chapter *gallery*, which is a grid too (`EDITORIAL_GALLERY_TWO_UP`, below). Inside a grid it makes the
 * browser fetch a **3.2×** candidate: measured `natural=1177` against `rendered=366`.
 *
 * Both strings below are derived from `C(v)` — the container inner width, whose three regimes the
 * table above gives — and then **checked against the rendered card width at nine viewports**:
 *
 * | Viewport | 320 | 375 | 430 | 640 | 768 | 1024 | 1280 | 1440 | 1920 |
 * |---|---|---|---|---|---|---|---|---|---|
 * | 3-up measured | 280 | 335 | 390 | 274 | 333 | 287 | 366 | 415 | 411 |
 * | 2-up measured | 280 | 335 | 390 | 274 | 333 | 451 | 569 | 642 | 636 |
 *
 * Every tier is exact at every one of them. The 1440–1600 tier exists because `max-w-page` (1440px)
 * caps the container *before* the padding `clamp` reaches its 4rem ceiling at 1600px — a 160px band
 * where the container **shrinks as the viewport grows**, which no single figure describes.
 */

/** Two across at `sm`, one below it, `gap-l`. `/lookbook`, `/collections`, `/edit`. */
export const EDITORIAL_GRID_TWO_UP =
  '(min-width: 1600px) 636px, (min-width: 1440px) calc(700px - 4vw), (min-width: 640px) calc(46vw - 20px), (min-width: 500px) 92vw, calc(100vw - 2.5rem)'

/** Three across at `lg`, two at `sm`, one below it, `gap-l`. `/journal`. */
export const EDITORIAL_GRID_THREE_UP =
  '(min-width: 1600px) 411px, (min-width: 1440px) calc(453.333px - 2.667vw), (min-width: 1024px) calc(30.667vw - 26.667px), (min-width: 640px) calc(46vw - 20px), (min-width: 500px) 92vw, calc(100vw - 2.5rem)'

/**
 * **A lookbook chapter's gallery** — two across at `sm` with `gap-m` (24px), not `gap-l`, so it is
 * not `EDITORIAL_GRID_TWO_UP`. It claimed `figureContained`: 1312px for a 644px tile at 1920 and
 * 707 for 341 at 768, about 2x. Matches 644 / 650.4 / 459 / 341.3 / 282.4 / 335 at 1920, 1440,
 * 1024, 768, 640 and 375 — sweep 1's measurement, taken by the same arithmetic as the two above.
 */
export const EDITORIAL_GALLERY_TWO_UP =
  '(min-width: 1600px) 644px, (min-width: 1440px) calc(708px - 4vw), (min-width: 640px) calc(46vw - 12px), (min-width: 500px) 92vw, calc(100vw - 2.5rem)'
