import 'server-only'

import { decideDeferredTax, type TaxRequest, type TaxResult } from './rules'

/**
 * **Plan §16.1c's `TaxProvider` interface**, and the implementation this phase can honestly ship.
 *
 * The interface is the deliverable, and its whole purpose is that nothing above it knows which engine
 * answered: *"the checkout calculation layer should not depend directly on Stripe-specific data
 * structures."*
 *
 * ### Why the implementation is a deferral rather than Stripe Tax — DEV-61
 *
 * §16.1c says Stripe Tax *"may be"* the initial provider. It cannot be this one, for two reasons that
 * are both about phase order rather than preference:
 *
 * 1. **Stripe is Phase 17's dependency.** `AGENTS.md`: *"Do not build a later phase's feature early,
 *    and do not install its dependencies early."* The SDK, the secret key and the webhook signature
 *    all arrive together, and pulling one of them forward to compute a number nothing yet charges
 *    would be exactly that.
 * 2. **There is nothing to calculate.** Tax is a function of a destination, and no surface in this
 *    application collects one — the address form is checkout's, which is Phase 17. Every request this
 *    provider can currently receive has `address: null`.
 *
 * So the provider answers `pending_address` and says so. That is not a stub: it is the correct answer
 * to every question the application is currently able to ask, and the day an address exists the same
 * call site gets a real number from a different implementation without changing.
 *
 * **What it must never do is return `0`.** A tax amount of zero is a claim that no tax is owed, and a
 * checkout that acted on it would undercharge every order in a taxable jurisdiction. `amountMinor` is
 * `null` for both `pending_address` and `unavailable`, and the type makes the difference between
 * *unknown* and *none* impossible to lose.
 */
export type TaxProvider = {
  /** Identifies the implementation in logs and on an order. */
  readonly id: string
  calculate(request: TaxRequest): Promise<TaxResult>
}

/**
 * The provider Phase 16 ships: it answers honestly and calculates nothing.
 *
 * The decision is in `rules.ts` rather than here, so `pnpm verify:shipping` can execute it: this
 * module's `server-only` guard is correct — a real provider holds an API key — and `server-only`
 * cannot resolve outside Next, which would otherwise make the one claim worth testing untestable.
 */
export const deferredTaxProvider: TaxProvider = {
  calculate: (request) => Promise.resolve(decideDeferredTax(request)),
  id: 'deferred',
}

/**
 * The provider this application uses.
 *
 * One export, so Phase 17 swaps the implementation in a single line and every caller keeps compiling.
 */
export const taxProvider: TaxProvider = deferredTaxProvider
