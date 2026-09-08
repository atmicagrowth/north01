/**
 * What the checkout action returns.
 *
 * Separate from `actions.ts` because a `'use server'` module may export **async functions and nothing
 * else** — the runtime 500 that every gate passes, recorded at length in `lib/cart/action-state.ts`.
 */
export type CheckoutActionState = {
  /** Why checkout could not proceed, or `null` before the first attempt. */
  error: null | string
  /** Which field to point at, when the failure is about one. */
  field: null | 'address' | 'method'
}

export const CHECKOUT_ACTION_IDLE: CheckoutActionState = { error: null, field: null }
