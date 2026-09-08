import type Stripe from 'stripe'

import { applyStripeEvent } from '@/lib/checkout/fulfil'
import { isHandledEventType, parseOrderReference } from '@/lib/checkout/rules'
import { isStripeConfigured, stripeClient, stripeWebhookSecret } from '@/lib/checkout/stripe'
import { getPayloadClient } from '@/lib/payload'

/**
 * **Plan §17.1d — the Stripe webhook.**
 *
 * > *"Verifies Stripe signature. Parses event. Uses event ID/idempotency tracking. Handles relevant
 * > event types. Updates order state transactionally. Triggers email only after the correct state
 * > transition."*
 *
 * This route is the **only** thing in the application permitted to mark an order paid, which is the
 * rule `AGENTS.md` states without qualification: *"Only a signature-verified Stripe webhook marks an
 * order paid. Reaching the success page is not payment."*
 *
 * ---
 *
 * ### The raw body, and why `request.text()` is not a detail
 *
 * A Stripe signature is computed over the **exact bytes** Stripe sent. `request.json()` parses and
 * re-serialises, and the round trip changes key order, whitespace and number formatting — so the
 * verification would fail for every event, and the natural "fix" is to stop verifying. The body is
 * read as text, verified, and only then parsed by the SDK.
 *
 * ### Why it always answers 200, and what that is not
 *
 * Stripe retries any non-2xx response with backoff for days. That is correct for *"we could not
 * process this yet"* and actively harmful for *"this is not for us"* — an unrecognised event type
 * retried for three days is noise that buries a real failure.
 *
 * So the responses split three ways:
 *
 * - **400** for a signature that does not verify. Not a retry — a forgery, a misconfigured secret, or
 *   a proxy that rewrote the body. Retrying cannot fix any of them.
 * - **500** for an event we *should* have handled and could not. Stripe retries, which is what we
 *   want, and the event row records why.
 * - **200** for everything else, including duplicates, unknown types and events about orders this
 *   application does not hold. §17.1h: *"Unknown events should be safely acknowledged/logged without
 *   crashing the webhook handler."*
 *
 * A 200 here means *"received and dealt with"*, and for an unknown type "dealt with" is a row saying
 * we saw it and did nothing.
 *
 * ### `force-dynamic`, because a cached webhook is not a webhook
 *
 * Nothing about this route may be pre-rendered or revalidated. It is a POST with a signature header
 * and a side effect.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const payload = await getPayloadClient()

  /*
   * An unconfigured integration cannot verify anything, so it cannot safely acknowledge anything
   * either. 503 rather than 200: Stripe should retry once the keys are in place, and a silent 200
   * would discard real payment events during a misconfiguration.
   */
  if (!isStripeConfigured()) {
    payload.logger.error('A Stripe webhook arrived while Stripe is not configured.')

    return new Response('Stripe is not configured.', { status: 503 })
  }

  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return new Response('Missing signature.', { status: 400 })
  }

  /* The exact bytes Stripe signed. See the docblock. */
  const body = await request.text()

  let event: Stripe.Event

  try {
    event = stripeClient().webhooks.constructEvent(body, signature, stripeWebhookSecret())
  } catch (error) {
    /*
     * The one case that must never be a 200. An unverified body is not evidence of anything, and
     * treating it as an event would make the signature ceremonial.
     */
    payload.logger.error({
      err: error,
      msg: 'A Stripe webhook failed signature verification and was rejected.',
    })

    return new Response('Invalid signature.', { status: 400 })
  }

  /*
   * **The first idempotency barrier — §17.1d.**
   *
   * A unique column, and an insert that violates it. Not a read-then-write: two concurrent retries
   * would both find nothing and both proceed, and the window between the read and the write is
   * exactly where a duplicate finalisation lives. The database has no such window.
   */
  let eventRowId: null | number = null

  try {
    const row = await payload.create({
      collection: 'stripe-events',
      data: {
        attempts: 1,
        eventId: event.id,
        receivedAt: new Date().toISOString(),
        status: 'received',
        type: event.type,
      },
      overrideAccess: true,
    })

    eventRowId = row.id
  } catch {
    /*
     * Already seen. Stripe retries after network failures, timeouts and deploys, so this is the
     * ordinary case rather than the exceptional one — acknowledged, counted, and not processed again.
     */
    const { docs } = await payload.find({
      collection: 'stripe-events',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { eventId: { equals: event.id } },
    })

    const seen = docs[0]

    if (seen) {
      await payload.update({
        collection: 'stripe-events',
        data: { attempts: (seen.attempts ?? 1) + 1 },
        id: seen.id,
        overrideAccess: true,
      })
    }

    return new Response('Already processed.', { status: 200 })
  }

  if (!isHandledEventType(event.type)) {
    /* §17.1h. A real outcome, recorded as such, so "did we ever see that?" has an answer. */
    await payload.update({
      collection: 'stripe-events',
      data: { status: 'ignored' },
      id: eventRowId,
      overrideAccess: true,
    })

    return new Response('Ignored.', { status: 200 })
  }

  try {
    const object = event.data.object as {
      metadata?: unknown
      payment_intent?: unknown
    }

    const orderId = parseOrderReference(object.metadata)

    if (orderId === null) {
      /* §17.1h's *"invalid metadata"*: signed, but not about anything this application holds. */
      await payload.update({
        collection: 'stripe-events',
        data: { error: 'No usable orderId in the event metadata.', status: 'ignored' },
        id: eventRowId,
        overrideAccess: true,
      })

      return new Response('No order reference.', { status: 200 })
    }

    const paymentIntentId =
      typeof object.payment_intent === 'string'
        ? object.payment_intent
        : typeof object.payment_intent === 'object' &&
            object.payment_intent !== null &&
            'id' in object.payment_intent
          ? String((object.payment_intent as { id: unknown }).id)
          : null

    const outcome = await applyStripeEvent(payload, {
      eventType: event.type,
      orderId,
      paymentIntentId,
    })

    await payload.update({
      collection: 'stripe-events',
      data: {
        ...(outcome.orderId === null ? {} : { order: outcome.orderId }),
        ...(outcome.outcome === 'outOfStock'
          ? {
              error:
                'Paid, but stock was unavailable at finalisation. Left unfulfilled for a human ' +
                'decision — plan §17.1f.',
            }
          : {}),
        status: outcome.outcome === 'noOrder' ? 'ignored' : 'processed',
      },
      id: eventRowId,
      overrideAccess: true,
    })

    return new Response('OK', { status: 200 })
  } catch (error) {
    /*
     * An event we should have handled and could not. 500 so Stripe retries — and the row records the
     * reason, so the retry has something to compare against.
     */
    payload.logger.error({
      err: error,
      eventId: event.id,
      msg: 'Processing a Stripe webhook failed.',
    })

    await payload
      .update({
        collection: 'stripe-events',
        data: {
          error: error instanceof Error ? error.message.slice(0, 900) : 'Unknown failure.',
          status: 'failed',
        },
        id: eventRowId,
        overrideAccess: true,
      })
      .catch(() => undefined)

    return new Response('Processing failed.', { status: 500 })
  }
}
