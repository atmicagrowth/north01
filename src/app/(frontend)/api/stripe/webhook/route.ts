import { after } from 'next/server'
import type { Payload } from 'payload'
import type Stripe from 'stripe'

import {
  countWebhookDelivery,
  isUniqueViolation,
  reclaimWebhookDelivery,
} from '@/lib/checkout/events'
import { courierFor } from '@/lib/email/courier'
import { deliverEmail, drainEmails } from '@/lib/email/send'
import { recordTaxTransaction, type TaxTransactionClient } from '@/lib/tax/transactions'
import { applyStripeEvent, type FulfilOutcome, type SessionFacts } from '@/lib/checkout/fulfil'
import {
  decideDuplicateDelivery,
  isHandledEventType,
  isSessionEvent,
  parseOrderReference,
} from '@/lib/checkout/rules'
import { isStripeConfigured, stripeClient, stripeWebhookSecret } from '@/lib/checkout/stripe'
import { reportFailure } from '@/lib/observability/report'
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
 * re-serialises, which changes them, so verification would fail for every event and the natural
 * "fix" is to stop verifying. The body is read as text, verified, and only then parsed by the SDK.
 *
 * ### What each status code means
 *
 * Stripe retries any non-2xx response with backoff for days. That is correct for *"we could not
 * process this yet"* and harmful for *"this is not for us"*:
 *
 * - **503** when Stripe is not configured: nothing can be verified, so nothing can be acknowledged.
 * - **400** for a signature that does not verify. A retry cannot fix a forgery or a wrong secret.
 * - **409** for an event another delivery is still working on (Phase 36). Stripe retries, and by
 *   then the row says how it went.
 * - **500** for an event we should have handled and could not — including a database error while
 *   recording it. Stripe retries, and the retry is **reprocessed** (Phase 36, audit R1-04): until
 *   then a failed row answered every retry with *"Already processed"*, which made this path dead.
 * - **200** for everything else: done, duplicate, unknown type, not our order — and a **mismatch**,
 *   a session that does not match the order it names. That is recorded, logged and alerted, and a
 *   retry could never fix it, so asking Stripe for one would only bury it.
 *
 * ### The email is after the response — Phase 36, audit R1-21
 *
 * The email **row** is queued inside the same transaction as the state change (`fulfil.ts`, Phase 36
 * sweep 1), so it commits with the payment or refund or not at all. The **send** runs in Next's
 * `after()` (supported in route handlers — `next/dist/docs/.../functions/after.md`), because a slow
 * mail provider used to hold Stripe's request open, and a timeout there is a failure to Stripe even
 * though the order was already paid. If the send never runs, the queued row is delivered by the
 * drain. The Stripe Tax transaction is recorded there too, for the same reason.
 *
 * ### `force-dynamic`, because a cached webhook is not a webhook
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const payload = await getPayloadClient()

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
    payload.logger.error({
      err: error,
      msg: 'A Stripe webhook failed signature verification and was rejected.',
    })

    return new Response('Invalid signature.', { status: 400 })
  }

  /*
   * **The first idempotency barrier — §17.1d.** A unique column and an insert that violates it,
   * never a read-then-write. What the violation *means* is then decided from the stored row.
   */
  let eventRowId: number

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
  } catch (error) {
    if (!isUniqueViolation(error)) {
      /* Not a duplicate: the database failed. Nothing was recorded, so Stripe must retry. */
      payload.logger.error({
        err: error,
        eventId: event.id,
        msg: 'A Stripe webhook could not be recorded.',
      })
      reportFailure(error, 'stripe.webhook.record', { eventType: event.type })

      return new Response('Could not record the event.', { status: 500 })
    }

    const { docs } = await payload.find({
      collection: 'stripe-events',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { eventId: { equals: event.id } },
    })

    const seen = docs[0]

    if (!seen) {
      return new Response('Could not read the stored event.', { status: 500 })
    }

    const decision = decideDuplicateDelivery({
      now: new Date(),
      receivedAt: seen.receivedAt,
      status: seen.status,
    })

    if (decision === 'acknowledge') {
      await countWebhookDelivery(payload, seen.id)

      return new Response('Already processed.', { status: 200 })
    }

    if (decision === 'retryLater' || !(await reclaimWebhookDelivery(payload, seen.id))) {
      if (decision === 'retryLater') {
        await countWebhookDelivery(payload, seen.id)
      }

      return new Response('Still being processed.', { status: 409 })
    }

    /* A failed or abandoned delivery, now ours. Reprocessing is safe: every write is a claim. */
    eventRowId = seen.id
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
      amount_refunded?: unknown
      amount_total?: unknown
      currency?: unknown
      id?: unknown
      metadata?: unknown
      payment_intent?: unknown
      payment_status?: unknown
    }

    /*
     * **Two ways back to the order.** Session-shaped events carry §17.1b's metadata reference;
     * `charge.refunded` carries a Charge, whose metadata is its own, so `applyStripeEvent` falls
     * back to the payment intent Phase 17 stored on the order.
     */
    const orderId = parseOrderReference(object.metadata)

    const paymentIntentId =
      typeof object.payment_intent === 'string'
        ? object.payment_intent
        : typeof object.payment_intent === 'object' &&
            object.payment_intent !== null &&
            'id' in object.payment_intent
          ? String((object.payment_intent as { id: unknown }).id)
          : null

    /* Phase 36, R1-01 and R1-05: which session this is, for how much, and whether it is paid. */
    const session: null | SessionFacts =
      isSessionEvent(event.type) && typeof object.id === 'string'
        ? {
            amountTotal: typeof object.amount_total === 'number' ? object.amount_total : null,
            currency: typeof object.currency === 'string' ? object.currency : null,
            id: object.id,
            paymentStatus: typeof object.payment_status === 'string' ? object.payment_status : null,
          }
        : null

    const outcome = await applyStripeEvent(payload, {
      amountRefundedMinor:
        typeof object.amount_refunded === 'number' ? object.amount_refunded : null,
      eventType: event.type,
      orderId,
      paymentIntentId,
      session,
    })

    if (outcome.outcome === 'mismatch') {
      /*
       * Money may have moved for something this order no longer describes. Not applied, not retried,
       * and not quiet: the row, the log and the alert all carry the reason.
       */
      payload.logger.error({
        eventId: event.id,
        msg: `A Stripe session did not match its order, and nothing was applied: ${outcome.reason}`,
        orderId: outcome.orderId,
      })
      reportFailure(
        new Error(`Stripe session mismatch: ${outcome.reason}`),
        'stripe.webhook.mismatch',
        {
          eventType: event.type,
          orderId: outcome.orderId,
        },
      )
    }

    await payload.update({
      collection: 'stripe-events',
      data: {
        ...(outcome.orderId === null ? {} : { order: outcome.orderId }),
        ...rowRecordFor(outcome),
      },
      id: eventRowId,
      overrideAccess: true,
    })

    /* §17.1d: the email was queued with the state change; this only delivers it. */
    after(() => afterResponse(payload, event.id, outcome))

    return new Response('OK', { status: 200 })
  } catch (error) {
    payload.logger.error({
      err: error,
      eventId: event.id,
      msg: 'Processing a Stripe webhook failed.',
    })
    reportFailure(error, 'stripe.webhook.process', { eventType: event.type })

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

/** How each outcome is recorded on the `stripe-events` row. */
function rowRecordFor(outcome: FulfilOutcome): { error?: string; status: 'ignored' | 'processed' } {
  switch (outcome.outcome) {
    case 'noOrder':
      return {
        error: 'No order reference and no known payment intent in the event.',
        status: 'ignored',
      }
    case 'mismatch':
      return { error: `MISMATCH: ${outcome.reason}`.slice(0, 900), status: 'ignored' }
    case 'superseded':
      return {
        error: 'Superseded: this session is no longer the order’s current one. Nothing changed.',
        status: 'ignored',
      }
    case 'outOfStock':
      return {
        error:
          'Paid, but stock was unavailable at finalisation. Held (fulfilmentHold = stockShortfall) ' +
          'for a human decision; no stock was taken — plan §17.1f.',
        status: 'processed',
      }
    default:
      return { status: 'processed' }
  }
}

/**
 * Everything that may happen after the response, none of which may throw.
 *
 * **Emails are delivered, not queued, here** (Phase 36 sweep 1). `fulfil.ts` queues the confirmation
 * (for `finalised`, and `outOfStock` — the customer was charged and deserves the receipt; it confirms
 * the order, never dispatch) and the refund message in the **same transaction** as the state change,
 * so the row exists whether or not this runs. If it does not run, the drain delivers it later.
 *
 * **The Stripe Tax transaction** is recorded for a newly paid order — see `lib/tax/transactions.ts`.
 * A failure is logged and reported for someone to record by hand; it never touches the order.
 */
async function afterResponse(
  payload: Payload,
  eventId: string,
  outcome: FulfilOutcome,
): Promise<void> {
  try {
    const courier = await courierFor(payload)

    const emailId =
      outcome.outcome === 'finalised' || outcome.outcome === 'outOfStock'
        ? outcome.confirmationEmailId
        : outcome.outcome === 'refunded'
          ? outcome.emailId
          : null

    if (emailId !== null && courier) {
      const delivered = await deliverEmail(payload, emailId, courier)

      if (delivered.outcome !== 'sent') {
        payload.logger.error({
          emailId,
          eventId,
          msg: `An order email was queued but not delivered (${delivered.outcome}); the drain will retry it.`,
        })
      }
    }

    /*
     * Opportunistic, and bounded. The admin-panel messages are queued inside a transaction and have
     * no sender of their own; a webhook is the most frequent server-side event this application has.
     */
    if (courier) {
      await drainEmails(payload, courier, { limit: 5 })
    }
  } catch (error) {
    payload.logger.error({
      err: error,
      eventId,
      msg: 'Sending an order email failed. The order is unaffected — see the email-messages record.',
    })
    reportFailure(error, 'stripe.webhook.email', { eventId })
  }

  if (outcome.outcome === 'finalised' || outcome.outcome === 'outOfStock') {
    try {
      const order = await payload.findByID({
        collection: 'orders',
        depth: 0,
        id: outcome.orderId,
        overrideAccess: true,
      })

      const recorded = await recordTaxTransaction(stripeClient() as TaxTransactionClient, {
        orderNumber: String(order.orderNumber),
        taxCalculationId: order.taxCalculationId,
      })

      if (recorded.outcome === 'failed') {
        throw new Error(recorded.reason)
      }
    } catch (error) {
      payload.logger.error({
        err: error,
        eventId,
        msg: 'A paid order’s Stripe Tax transaction could not be recorded. Record it in Stripe by hand.',
        orderId: outcome.orderId,
      })
      reportFailure(error, 'stripe.webhook.taxTransaction', { orderId: outcome.orderId })
    }
  }
}
