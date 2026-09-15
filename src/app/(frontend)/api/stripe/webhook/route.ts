import { after } from 'next/server'
import type Stripe from 'stripe'

import {
  countWebhookDelivery,
  isUniqueViolation,
  reclaimWebhookDelivery,
} from '@/lib/checkout/events'
import { courierFor } from '@/lib/email/courier'
import type { TaxTransactionClient } from '@/lib/tax/transactions'
import { settleStripeEvent } from '@/lib/checkout/after-stripe-event'
import { applyStripeEvent, type SessionFacts } from '@/lib/checkout/fulfil'
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
 * - **200** too for **an order that is missing** (the retention review): the metadata names an order
 *   id that parses, and no such order exists — most likely an unpaid order the retention sweep
 *   deleted after 30 days without activity, reached by a late or resent event. A retry cannot
 *   recreate the order, so it is not requested; instead the row says `ORDER MISSING: …`, and the
 *   event is logged and reported as `stripe.webhook.orderMissing` so a person checks Stripe for
 *   money it may have moved. (An event with no reference at all stays `noOrder`, unalerted.)
 *
 * ### The email is after the response — Phase 36, audit R1-21
 *
 * The email **row** is queued inside the same transaction as the state change (`fulfil.ts`, Phase 36
 * sweep 1), so it commits with the payment or refund or not at all. The **send** runs in Next's
 * `after()` (supported in route handlers — `next/dist/docs/.../functions/after.md`), because a slow
 * mail provider used to hold Stripe's request open, and a timeout there is a failure to Stripe even
 * though the order was already paid. If the send never runs, the queued row is delivered by the
 * drain. The Stripe Tax transaction is recorded there too, for the same reason, and so (sweep 1, S01)
 * is the refresh of the products' cached stock figure after a sale, whose index upsert is a network
 * call to Algolia. All three are `afterStripeEvent` (`lib/checkout/after-stripe-event.ts`), which
 * starts them together so none waits on another, and which `pnpm verify:webhook` runs as this route
 * does, with the courier and the Stripe client this route passes swapped for stubs.
 *
 * **It is registered before the `stripe-events` row is written** (the lost-side-effect review), by
 * `settleStripeEvent` in the same module. Registered after it, a failed row write left a committed
 * payment with no tax record and no stock refresh, and the redelivery — answered `alreadyFinal` — does
 * neither. Next runs `after()` work on an error response too, so now that write costs only a retry.
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

    /*
     * The outcome has committed. `settleStripeEvent` registers the after-response work **first** — §17.1d's
     * email delivery, the tax record and the stock-figure refresh (`afterStripeEvent`) — and only then
     * raises the `orderMissing` / `mismatch` alerts and writes the `stripe-events` row, so a failed
     * bookkeeping write can no longer skip work a redelivery would never redo. See it for why.
     */
    await settleStripeEvent(
      payload,
      { id: event.id, rowId: eventRowId, type: event.type },
      outcome,
      {
        courier: () => courierFor(payload),
        schedule: after,
        taxClient: () => stripeClient() as TaxTransactionClient,
      },
    )

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
