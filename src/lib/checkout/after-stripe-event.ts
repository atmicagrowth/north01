import type { Payload } from 'payload'

import { deliverEmail, drainEmails, type Courier } from '@/lib/email/send'
import { reportFailure } from '@/lib/observability/report'
import { recordTaxTransaction, type TaxTransactionClient } from '@/lib/tax/transactions'

import { refreshDerivedStock, type FulfilOutcome } from './fulfil'

/**
 * **Everything the Stripe webhook does after its response** — extracted from the route in sweep 1's
 * recheck of S01, so `pnpm verify:webhook` (section U) can run the exact sequence the route runs.
 *
 * The route answers Stripe first and then calls this inside Next's `after()`. Nothing here may throw,
 * and nothing here can change the order or the response.
 *
 * ### Three steps, started together, none waiting on another
 *
 * - **Deliver the order email** the payment transaction already queued (`fulfil.ts` queues the
 *   confirmation for `finalised` and `outOfStock` — the customer was charged and deserves the receipt;
 *   it confirms the order, never dispatch — and the refund message, in the **same transaction** as the
 *   state change, so the row exists whether or not this runs). Then an opportunistic drain of up to
 *   five queued messages. A failed delivery stays on its row for the drain.
 * - **Record the Stripe Tax transaction** for a newly paid order (`lib/tax/transactions.ts`). A failure
 *   is logged and reported for someone to record by hand.
 * - **Refresh the cached stock figure** of every product a `finalised` order took stock from
 *   (`refreshDerivedStock` in `fulfil.ts`, sweep 1 S01), whose product update also re-syncs the search
 *   index — a network call to Algolia.
 *
 * They were a sequence, and the recheck found the cost of that: with the refresh first, a degraded
 * Algolia (a 30-second write timeout, retried across hosts, per product) held the tax record back, and
 * if the platform ended the `after()` work at the function's duration limit the tax transaction was
 * never recorded — with nothing logged, because only a thrown failure is. Before that, the tax record
 * waited on the mail provider in the same way. So the three are started at once and awaited with
 * `Promise.allSettled`: each takes its own time, and each reports its own failure.
 *
 * A step lost to a killed `after()` is not retried by this code. The email row is delivered by the
 * drain; a missing tax transaction is noticed only by reconciling Stripe Tax; a missed refresh leaves
 * the product's cached figure at its pre-sale value until it or a variant is next saved — and a Stripe
 * redelivery cannot repair that, because it is answered `alreadyFinal`, which refreshes nothing.
 *
 * ### The two dependencies are injected
 *
 * The courier and the Stripe client are both behind `server-only` modules and read secrets, so the
 * route passes them in (`courierFor`, `stripeClient`) and a harness passes stubs. Each is only called
 * inside its own step, so a courier that cannot be built, or a client that throws, is that step's
 * reported failure and nobody else's.
 */
export type AfterStripeEventDeps = {
  /** The mail courier, or `null` when email is not configured (nothing is sent, nothing is drained). */
  courier: () => Promise<Courier | null>
  /** The Stripe client, narrowed to the one tax method. Called only when a paid order needs it. */
  taxClient: () => TaxTransactionClient
}

export async function afterStripeEvent(
  payload: Payload,
  eventId: string,
  outcome: FulfilOutcome,
  deps: AfterStripeEventDeps,
): Promise<void> {
  const steps: [area: string, work: Promise<void>][] = [
    ['stripe.webhook.email', deliverOrderEmail(payload, eventId, outcome, deps)],
    ['stripe.webhook.taxTransaction', recordPaidOrderTax(payload, eventId, outcome, deps)],
    ['checkout.derivedStock', refreshDerivedStock(payload, outcome)],
  ]

  const settled = await Promise.allSettled(steps.map(([, work]) => work))

  /*
   * Each step catches and reports its own failures, so this is only the net under that promise: a step
   * that rejected anyway (its logger threw, say) is still logged and reported under its own area.
   */
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      const area = steps[index]![0]

      try {
        payload.logger.error({
          err: result.reason,
          eventId,
          msg: `A Stripe webhook's after-response step (${area}) failed unexpectedly. The order is unaffected.`,
        })
      } catch {
        /* Nothing left to tell. */
      }

      reportFailure(result.reason, area, { eventId })
    }
  })
}

async function deliverOrderEmail(
  payload: Payload,
  eventId: string,
  outcome: FulfilOutcome,
  deps: AfterStripeEventDeps,
): Promise<void> {
  try {
    const courier = await deps.courier()

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
}

async function recordPaidOrderTax(
  payload: Payload,
  eventId: string,
  outcome: FulfilOutcome,
  deps: AfterStripeEventDeps,
): Promise<void> {
  if (outcome.outcome !== 'finalised' && outcome.outcome !== 'outOfStock') {
    return
  }

  try {
    const order = await payload.findByID({
      collection: 'orders',
      depth: 0,
      id: outcome.orderId,
      overrideAccess: true,
    })

    const recorded = await recordTaxTransaction(deps.taxClient(), {
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
