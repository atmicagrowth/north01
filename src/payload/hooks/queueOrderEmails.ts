import { APIError, type CollectionAfterChangeHook, type Payload } from 'payload'

import type { FulfillmentStatus } from '@/lib/orders/rules'

import { queueFulfilmentMessage } from '@/lib/email/orders'
import { dedupeKeyFor } from '@/lib/email/rules'
import { reportFailure } from '@/lib/observability/report'

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
 * The dedupe key is checked too, before the insert — both are kept: the comparison is the intent, and
 * the key is the guarantee. It is checked with a read rather than left to the unique constraint for
 * the reason below: a refused insert here would end the order's own transaction.
 *
 * ### A failed queue write fails the save — the lost-side-effect review
 *
 * The queue write is a Local API `create` with this hook's `req`, and Payload answers **any** failed
 * Local API write by killing the transaction it joined (`killTransaction` in the operation's catch).
 * `enqueueEmail` turns that throw into `{ outcome: 'error' }`, so this hook used to log it and return —
 * and `updateByID` then committed a transaction that no longer existed, which does nothing. The admin
 * saw "shipped" saved while the status, the tracking number and the email had all been rolled back.
 *
 * So after queueing it checks that the transaction is still alive — the check `queueOnce` in
 * `lib/checkout/fulfil.ts` makes for the payment's confirmation — and throws when it is not, so the
 * save fails visibly and staff retry it. That does not break §19.1d (*the email must never undo the
 * thing it reports*): nothing had been saved to undo. A queue refusal that left the transaction
 * standing is logged and reported, and the transition stands.
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

  const { payload } = req
  const kind = to === 'shipped' ? 'orderShipped' : 'orderDelivered'
  const dedupeKey = dedupeKeyFor(kind, { id: doc.id })
  /* Captured now: Payload deletes `req.transactionID` when it kills the transaction. */
  const transactionID = req.transactionID instanceof Promise ? null : (req.transactionID ?? null)

  /*
   * Already queued: an insert would be refused by the unique key, and the refusal would end the
   * transaction. Read with `req`, so the lock `enforceOrderTransitions` holds on the order means no
   * other save of this order can be inserting the same key.
   */
  const { totalDocs } = await payload.find({
    collection: 'email-messages',
    depth: 0,
    limit: 0,
    overrideAccess: true,
    req,
    where: { dedupeKey: { equals: dedupeKey } },
  })

  if (totalDocs > 0) {
    return doc
  }

  let reason: null | string = null

  try {
    const outcome = await queueFulfilmentMessage(payload, doc, kind, req)

    if (outcome.outcome === 'error') {
      reason = outcome.reason
    }
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error)
  }

  if (transactionID !== null && !transactionAlive(payload, transactionID)) {
    /* Public, so the admin shows this sentence rather than Payload's generic 500 text. */
    const error = new APIError(
      `The order was not saved: queueing its ${to} email failed and rolled the change back` +
        `${reason === null ? '' : ` (${reason})`}. Save it again.`,
      500,
      null,
      true,
    )

    payload.logger.error({ dedupeKey, err: error, msg: error.message, orderId: doc.id })
    reportFailure(error, 'orders.fulfilmentEmail', { dedupeKey, orderId: doc.id, rolledBack: true })

    throw error
  }

  if (reason !== null) {
    payload.logger.error({
      dedupeKey,
      msg: `An order transition email could not be queued; the transition itself stands: ${reason}`,
      orderId: doc.id,
    })
    reportFailure(new Error(reason), 'orders.fulfilmentEmail', { dedupeKey, orderId: doc.id })
  }

  return doc
}

/** Whether the adapter still holds the session — the same test as `queueOnce` in `fulfil.ts`. */
function transactionAlive(payload: Payload, transactionID: number | string): boolean {
  return Boolean(
    (payload.db as unknown as { sessions?: Record<string, unknown> }).sessions?.[
      String(transactionID)
    ],
  )
}
