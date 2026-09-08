import 'server-only'

import { quoteShipping, type ShippingQuote, type ShippingQuoteInput } from './rules'

/**
 * **Plan §16.1a's `ShippingProvider` interface**, and the static provider that implements it.
 *
 * > *"Create a server-only `ShippingProvider` interface even though the initial NORTH / 01 demo can
 * > use static shipping methods."*
 *
 * The interface is the deliverable. The demo's answers are three constants, and the whole point of
 * writing them behind a boundary today is that replacing them with a carrier's API tomorrow changes
 * one file and nothing that reads a rate — *"the storefront should consume a normalized shipping-rate
 * shape rather than provider-specific objects."*
 *
 * **`server-only`, and this time the guard is on the right module.** Phase 15 put one on a file the
 * harness needed and had to move it; the rule that emerged is that a guard belongs where a *secret or
 * a request* could leak, not on shared logic. A real provider holds an API key, so the boundary is
 * where the key would live — and every *rule* stays in `rules.ts`, unguarded and testable.
 *
 * **No Shippo, EasyPost or ShipStation.** §16.1a says not to *"until a real fulfillment requirement
 * exists"*, and none does. Adding one now would be three dependencies, a key to store and a webhook
 * to secure, in exchange for answers this demo already knows.
 */
export type ShippingProvider = {
  /** Identifies the implementation in logs and on an order. */
  readonly id: string
  /** Every rate this provider offers for one cart and destination, already normalised. */
  quote(input: ShippingQuoteInput): Promise<ShippingQuote>
}

/**
 * The demo's provider. Synchronous work behind an async signature, on purpose.
 *
 * A carrier call is a network round trip that can be slow, rate-limited or down, and a caller written
 * against a synchronous interface would have to be rewritten to cope with any of that. Returning a
 * resolved promise from a pure function costs nothing and means the call sites are already the shape
 * they need to be — which is the same reason the interface exists at all.
 */
export const staticShippingProvider: ShippingProvider = {
  id: 'static',
  quote: (input) => Promise.resolve(quoteShipping(input)),
}

/**
 * The provider this application uses.
 *
 * One export, so a future carrier is a one-line change here rather than a search for call sites.
 */
export const shippingProvider: ShippingProvider = staticShippingProvider
