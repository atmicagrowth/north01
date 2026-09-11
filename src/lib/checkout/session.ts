import 'server-only'

import { sql } from '@payloadcms/db-postgres'

import { getPayloadClient } from '@/lib/payload'
import { siteUrl } from '@/lib/env.server'
import { reportFailure } from '@/lib/observability/report'

import type { PreflightResult } from './preflight'
import { stripeClient } from './stripe'

/**
 * **Plan §17.1a step 11, and all of §17.1b.**
 *
 * > *"Use Stripe's official server SDK. Never accept a client-provided total. Use trusted
 * > server-derived values. Attach internal references through Stripe metadata so webhook processing
 * > can identify the application order/cart safely."*
 *
 * ### Every amount here came from preflight
 *
 * The line item is built from the **order snapshot's** numbers, which preflight wrote from the
 * database moments earlier. Nothing in this function accepts an amount, and the only values that
 * cross from the browser — an email and an address — were validated before this was called and are
 * sent to Stripe as *display* data rather than as anything that decides a price.
 *
 * ### Why the whole bag is one line item and not several — DEV-63
 *
 * A line per product would make Stripe a **second place the total is computed**. One line item priced
 * at the order's own `totalMinor` makes a disagreement between the two impossible to express.
 *
 * ### The metadata is the webhook's way home
 *
 * `orderId` arrives back inside a signed payload, so it cannot be forged — but it is still *parsed*
 * rather than trusted. See `parseOrderReference`. Since Phase 36 the webhook also checks the event's
 * session id, amount and currency against the order, so the reference alone no longer pays anything.
 *
 * ### Phase 36: a short-lived session, recorded by a claim — audit R1-01
 *
 * Sessions used to live for Stripe's default 24 hours, so an abandoned attempt stayed payable long
 * after the bag had changed. They now expire after about half an hour (`expires_at`), which is
 * Stripe's minimum. And the order is moved to `pending_payment` by a **conditional** statement rather
 * than an unconditional write, so session creation can no longer overwrite a status the webhook
 * set in the meantime, or a session id another attempt recorded first.
 */
export type SessionResult = { ok: false; reason: 'stripeFailed' } | { ok: true; url: string }

/**
 * **How long a Checkout Session stays payable.**
 *
 * Stripe accepts 30 minutes to 24 hours, measured from **its** creation time. This timestamp is taken
 * before the request leaves, so exactly thirty minutes would land a little under Stripe's floor and
 * be refused; the extra minute absorbs request latency and clock skew.
 */
const CHECKOUT_SESSION_LIFETIME_SECONDS = 31 * 60

export async function createCheckoutSession(
  preflight: Extract<PreflightResult, { ok: true }>,
): Promise<SessionResult> {
  const payload = await getPayloadClient()
  const stripe = stripeClient()
  const origin = siteUrl

  try {
    const session = await stripe.checkout.sessions.create({
      /*
       * The customer cannot change this on Stripe's page, so the order and the receipt agree about
       * who bought it. Preflight already validated it.
       */
      customer_email: preflight.contact.email,
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_LIFETIME_SECONDS,
      /* A single line item priced at the server's own total — see the docblock. */
      line_items: [
        {
          price_data: {
            currency: preflight.cart.currency.toLowerCase(),
            product_data: {
              description:
                `${preflight.totals.subtotalMinor === preflight.totals.totalMinor ? '' : 'Includes delivery and tax. '}Order ${preflight.orderId}`.trim(),
              name: `NORTH / 01 — ${preflight.cart.totals.itemCount} item${preflight.cart.totals.itemCount === 1 ? '' : 's'}`,
            },
            unit_amount: preflight.totals.totalMinor,
          },
          quantity: 1,
        },
      ],
      /* §17.1b: the reference the webhook comes home by. */
      metadata: { orderId: String(preflight.orderId) },
      mode: 'payment',
      /*
       * Also on the payment intent, because §17.1h's *"invalid metadata"* includes the case where an
       * event carries the intent rather than the session. Both routes home lead to the same order.
       */
      payment_intent_data: { metadata: { orderId: String(preflight.orderId) } },
      /*
       * §17.1g: the browser may never reach either of these, and the order state must not depend on
       * it doing so. They carry the ORDER id rather than the Stripe session id, so the success page
       * looks up our own record and shows only what the webhook has confirmed.
       */
      cancel_url: `${origin}/checkout/cancelled?order=${preflight.orderId}`,
      success_url: `${origin}/checkout/success?order=${preflight.orderId}`,
    })

    if (!session.url) {
      payload.logger.error({
        msg: 'Stripe returned a session with no URL.',
        orderId: preflight.orderId,
      })

      await stripe.checkout.sessions.expire(session.id).catch(() => undefined)

      return { ok: false, reason: 'stripeFailed' }
    }

    /*
     * **Recorded by a claim, before the redirect**, so a webhook that arrives while the customer is
     * still typing can be matched to this attempt.
     *
     * Only an order preflight has just prepared — `checkout_started`, with no session recorded
     * (preflight clears a reused order's old one) — can take this session. Zero rows means something
     * else got there first: a concurrent attempt for the same bag recorded its own session, or an
     * event moved the order. Then this session belongs to nothing, so it is expired before anyone can
     * pay it, and the customer is asked to try again.
     *
     * `stripeCheckoutSessionId` is also unique — two orders cannot claim the same payment.
     */
    const claim = await payload.db.drizzle.execute(
      sql`UPDATE "orders"
          SET "payment_status" = 'pending_payment',
              "stripe_checkout_session_id" = ${session.id}
          WHERE "id" = ${preflight.orderId}
            AND "payment_status" = 'checkout_started'
            AND "stripe_checkout_session_id" IS NULL`,
    )

    if ((claim.rowCount ?? 0) === 0) {
      payload.logger.error({
        msg: 'A Checkout Session was created for an order that had moved on; it was expired unused.',
        orderId: preflight.orderId,
      })

      await stripe.checkout.sessions.expire(session.id).catch(() => undefined)

      return { ok: false, reason: 'stripeFailed' }
    }

    return { ok: true, url: session.url }
  } catch (error) {
    /*
     * §17.1h. A Stripe outage, a rejected key, a rate limit — none of them may surface as a stack
     * trace to a customer, and none of them may leave the order looking paid. It stays at
     * `checkout_started`, which is exactly what it is.
     */
    payload.logger.error({
      err: error,
      msg: 'Creating a Stripe Checkout Session failed.',
      orderId: preflight.orderId,
    })
    reportFailure(error, 'checkout.createSession', { orderId: preflight.orderId })

    return { ok: false, reason: 'stripeFailed' }
  }
}
