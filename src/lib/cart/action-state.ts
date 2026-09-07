/**
 * **What a cart action returns, and its idle value.**
 *
 * A separate file for two lines, and the reason is a constraint rather than a preference: a
 * `'use server'` module may export **async functions and nothing else**. `actions.ts` originally
 * exported this constant beside them, and every page that rendered a cart control answered
 *
 * > `A "use server" file can only export async functions, found object.`
 *
 * with a 500 — at **runtime**. `pnpm typecheck`, `pnpm lint` and `pnpm build` were all green, because
 * the rule is enforced by the server-actions runtime rather than by the compiler. It was found by
 * clicking the button.
 *
 * That is the Phase 13 lesson in a new place: the gates check shapes and types, and this is neither.
 */

export type CartActionState = {
  /** A sentence to show, or `null`. Not an error unless `ok` is false. */
  notice: null | string
  ok: boolean
}

export const CART_ACTION_IDLE: CartActionState = { notice: null, ok: true }
