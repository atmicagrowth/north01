import type { CollectionAfterChangeHook } from 'payload'

import type { FulfillmentStatus } from '@/lib/orders/rules'

import { queueFulfilmentMessage } from '@/lib/email/orders'

/**
 * **§18.1c's *"trigger shipment email"*, finally triggered.**
 *
 * Phase 18 built the transition and named this obligation in three places without being able to meet
 * it, because there was no transport. This is the seam it left.
 *
 * ---
 *
 * ### Why `afterChange` and not `beforeChange`
 *
 * `enforceOrderTransitions` decides the transition in `beforeChange`, and the message cannot be
 * raised there: the row has not been written yet, so the write can still fail validation, and the
 * hook holds the `SELECT … FOR UPDATE` lock that serialises staff edits to the order.
 *
 * ### Why it *enqueues* rather than sends
 *
 * Payload 3 runs `afterChange` **inside the open transaction** — `commitTransaction` comes after both
 * `afterChange` and `afterOperation`, so there is no post-commit collection hook to use instead.
 * Sending here would mean a dispatch notice sent for a dispatch that could still roll back, and a
 * mail provider's latency added to the duration of a row lock.
 *
 * So it writes the *intent*, in the same transaction, and delivery happens outside — from the drain.
 * The rollback case then behaves correctly by construction: if the order never reached `shipped`, the
 * intention to say so never existed either.
 *
 * ### The `previousDoc` comparison is load-bearing, not defensive
 *
 * The admin panel posts the **whole document** on every save, so `fulfillmentStatus` arrives on every
 * write — `enforceOrderTransitions` has an early return for exactly that, so that saving a tracking
 * URL onto an already-shipped order stays possible. A hook keyed on `doc.fulfillmentStatus ===
 * 'shipped'` alone would re-mail the customer every time a staff member corrected a typo.
 *
 * The unique `dedupeKey` would catch it anyway. Both are kept: the comparison is the intent, and the
 * constraint is the guarantee.
 */
export const queueOrderEmails: CollectionAfterChangeHook = async ({
  doc,
  operation,
  previousDoc,
  req,
}) => {
  if (operation !== 'update' || !previousDoc) {
    return doc
  }

  const from = previousDoc.fulfillmentStatus as FulfillmentStatus
  const to = doc.fulfillmentStatus as FulfillmentStatus

  if (to === from || (to !== 'delivered' && to !== 'shipped')) {
    return doc
  }

  /*
   * Wrapped, and the wrap is the point. A throw here would kill the update — Payload's catch calls
   * `killTransaction` — so a mail-queue hiccup would roll back a dispatch a warehouse has already
   * performed. §19.1d: the email must never be able to undo the thing it is reporting.
   */
  try {
    const outcome = await queueFulfilmentMessage(
      req.payload,
      doc,
      to === 'shipped' ? 'orderShipped' : 'orderDelivered',
      req,
    )

    if (outcome.outcome === 'error') {
      req.payload.logger.error({
        msg: 'An order transition email could not be queued.',
        orderId: doc.id,
        reason: outcome.reason,
      })
    }
  } catch (error) {
    req.payload.logger.error({
      err: error,
      msg: 'Queueing an order transition email threw. The order transition itself is unaffected.',
      orderId: doc.id,
    })
  }

  return doc
}
