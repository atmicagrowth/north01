/**
 * **What a wishlist action returns, and its idle value.**
 *
 * A separate file for the same constraint `cart/action-state.ts` records: a `'use server'` module may
 * export **async functions and nothing else**, and the rule is enforced by the server-actions runtime
 * rather than by the compiler — so exporting a constant beside the actions type-checks, lints, builds
 * and then answers 500 when somebody presses the button.
 */

export type WishlistActionState = {
  /** A sentence to show, or `null`. */
  notice: null | string
  ok: boolean
  /** Whether the product is on the list *after* this action. Drives the control's pressed state. */
  saved: boolean
}

export const WISHLIST_ACTION_IDLE: WishlistActionState = { notice: null, ok: true, saved: false }
