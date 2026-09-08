import 'server-only'

import { getPayloadClient } from '@/lib/payload'
import { siteUrl } from '@/lib/env.server'

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
 * The line items are built from the **order snapshot's** numbers, which preflight wrote from the
 * database moments earlier. Nothing in this function accepts an amount, and the only values that
 * cross from the browser — an email and an address — were validated before this was called and are
 * sent to Stripe as *display* data rather than as anything that decides a price.
 *
 * ### Why the whole bag is one line item and not several
 *
 * Stripe would happily take a line per product, and it would look tidier on their receipt. It would
 * also be a **second place the total is computed**: Stripe sums the line items, and if our subtotal
 * and their sum ever disagreed — a rounding difference on a percentage discount, a shipping amount
 * allocated across lines — the customer would be charged Stripe's answer while the order recorded
 * ours. One line item priced at the order's own `totalMinor` makes that disagreement impossible to
 * express.
 *
 * The itemisation the customer needs is on the bag page and on the confirmation, both rendered from
 * `order-items`, which is the record. Stripe's page is where they type a card number.
 *
 * ### The metadata is the webhook's way home
 *
 * `orderId` is what §17.1b means by *"internal references … so webhook processing can identify the
 * application order/cart safely"*. It arrives back inside a signed payload, so it cannot be forged —
 * but it is still *parsed* rather than trusted, because a signature proves who sent an event and not
 * that its contents mean what this application expects. See `parseOrderReference`.
 */
export type SessionResult = { ok: false; reason: 'stripeFailed' } | { ok: true; url: string }

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
      /*
       * A single line item priced at the server's own total — see the docblock. `unit_amount` is in
       * minor units, which is what every amount in this project already is.
       */
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

      return { ok: false, reason: 'stripeFailed' }
    }

    /*
     * Recorded before the redirect, so a webhook that arrives while the customer is still typing can
     * be matched to this attempt. `stripeCheckoutSessionId` is unique — two orders cannot claim the
     * same payment.
     */
    await payload.update({
      collection: 'orders',
      data: { paymentStatus: 'pending_payment', stripeCheckoutSessionId: session.id },
      id: preflight.orderId,
      overrideAccess: true,
    })

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

    return { ok: false, reason: 'stripeFailed' }
  }
}
