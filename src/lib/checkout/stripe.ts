import 'server-only'

import Stripe from 'stripe'

import { integrationStatus, requireIntegration } from '@/lib/env.server'

/**
 * **The only file in this project that constructs a Stripe client**, and the only one that reads
 * `STRIPE_SECRET_KEY`.
 *
 * The same shape `payload/storage/cloudinary.ts` uses for the one other secret-bearing SDK: one
 * module, `server-only`, reached from a handful of server modules and from nowhere else, so the key
 * cannot enter a client bundle by any import path a bundler would follow.
 *
 * The phase prompt is explicit — *"Do not expose Stripe secret keys to the browser"* — and the
 * publishable key is deliberately **not** re-exported here. Nothing in this integration needs it:
 * Stripe Checkout is a redirect, not an embedded form, so the browser never talks to Stripe directly
 * and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` stays unused until something embeds Stripe Elements.
 *
 * ---
 *
 * ### Configured, unconfigured, and why the difference is a customer-visible decision
 *
 * `docs/ARCHITECTURE.md` §2 and `env.core.ts` both say the same thing: an unconfigured optional
 * service means *hide the feature*, not *crash the store*. Stripe is not optional in the sense that
 * the shop can sell without it — but it **is** optional in the sense that a shop with no keys must
 * still browse, search and fill a bag, which is the state this repository is actually in.
 *
 * So `isStripeConfigured()` is what the checkout surface asks, and it degrades: the button explains
 * rather than failing. `stripeClient()` is for the paths that genuinely cannot proceed — creating a
 * session, verifying a webhook — and it throws, which is what `requireIntegration` is documented for
 * in as many words.
 */

/**
 * The API version this integration is written against.
 *
 * Pinned rather than left to the SDK's default, because Stripe's default follows the *account's*
 * version, which an operator can change in a dashboard. A field appearing or disappearing under a
 * running deploy is not a failure anyone would connect to a setting they changed last week.
 */
const STRIPE_API_VERSION = '2026-07-29.dahlia' as const

let client: null | Stripe = null

export function isStripeConfigured(): boolean {
  return integrationStatus('stripe') === 'configured'
}

/**
 * The client, constructed once.
 *
 * Throws when the keys are absent. Every caller either checks `isStripeConfigured()` first and
 * degrades, or is a path — the webhook — that has no meaningful behaviour without them.
 */
export function stripeClient(): Stripe {
  if (client === null) {
    const { STRIPE_SECRET_KEY } = requireIntegration('stripe')

    client = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION,
      /* Named so a Stripe support conversation can identify the integration in their logs. */
      appInfo: { name: 'NORTH / 01', version: '1.0.0' },
      /*
       * Two retries. Stripe's own guidance is that idempotent requests are safe to retry, and the
       * SDK sends an idempotency key on every write it makes — so a retried session creation cannot
       * create two sessions. The default is zero, which turns one dropped packet into a customer
       * seeing an error on the last click before paying.
       */
      maxNetworkRetries: 2,
    })
  }

  return client
}

/** The webhook secret, for signature verification. Separate so the route reads only what it needs. */
export function stripeWebhookSecret(): string {
  return requireIntegration('stripe').STRIPE_WEBHOOK_SECRET
}
