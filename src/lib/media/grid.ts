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
