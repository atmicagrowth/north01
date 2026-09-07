/**
 * What the discount-code action returns.
 *
 * Separate from `actions.ts` for the reason `lib/cart/action-state.ts` records at length: a
 * `'use server'` module may export **async functions and nothing else**, and a constant beside them
 * is a runtime 500 that every gate passes.
 */
export type PromotionActionState = {
  notice: null | string
  ok: boolean
}

export const PROMOTION_ACTION_IDLE: PromotionActionState = { notice: null, ok: true }
