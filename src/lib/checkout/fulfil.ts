import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

import { queueOrderConfirmation, queueRefundMessage } from '@/lib/email/orders'
import { dedupeKeyFor } from '@/lib/email/rules'
import type { EnqueueOutcome } from '@/lib/email/send'
import { reportFailure } from '@/lib/observability/report'

import {
  classifyUnclaimedSessionEvent,
  FINALISABLE_STATUSES,
  isFullRefund,
  planStockDecrements,
  planStripeEvent,
  statusesThatCanReach,
  type PaymentStatus,
  type StockLine,
} from './rules'

/**
 * **What a verified Stripe event does to an order** — plan §17.1d, §17.1e and §17.1f.
 *
 * Reached only from the webhook route, only after `stripe.webhooks.constructEvent` has verified the
 * signature. `AGENTS.md`: *"Only a signature-verified Stripe webhook marks an order paid."* This file
 * is the only one in the project that writes `paymentStatus: 'paid'`.
 *
 * **No `server-only` guard, and that is the same structural choice `lib/promotions/read.ts` made.**
 * It takes a `Payload` instance as an argument rather than reaching for one, and touches no cookie,
 * request or secret — so `pnpm verify:webhook` can drive it exactly as the route does, which is the
 * only way the idempotency barriers, the transaction and the inventory race can be observed rather
 * than reasoned about. The guard sits on `stripe.ts`, which is where the key lives.
 *
 * Third time this has come up: Phase 15 had the guard on a module the harness needed, Phase 16 had it
 * on the right module with the decision in the wrong place, and this is the rule both produced —
 * **a guard belongs where a secret or a request could leak, and nowhere else.**
 *
 * ---
 *
 * ### §17.1e's sequence, and why the order of the last three steps is not arbitrary
 *
 * > Webhook verified → Order marked paid → Inventory adjusted → Confirmation email
 *
 * Inventory is adjusted **inside the same transaction** that marks the order paid, not after it. The
 * email is split in two (Phase 36 sweep 1): its **row** is queued inside the transaction, so it
 * commits with the payment or not at all, and its **send** happens after the response — a mail
 * provider being slow or down must not roll back, or delay, a payment that has already happened.
 *
 * ### The barriers
 *
 * §17.1d: *"The unique Stripe event ID is the first idempotency barrier. Business-state guards are
 * the second."* The first is the unique `stripe-events.eventId`, in the route. The second is here:
 * every transition is one conditional `UPDATE` whose `WHERE` carries the states it may move from, so
 * a second event describing the same payment (`completed`, then `async_payment_succeeded`) matches
 * nothing. `payment_intent.succeeded` is **not** handled — earlier docblocks said it was.
 *
 * ### Phase 36: which session, for how much — audit R1-01
 *
 * An order is reused across checkout attempts, so an event naming it proves only that *some* session
 * for it completed. Every session-shaped event now carries that session's id, amount, currency and
 * payment status (`SessionFacts`), and the claims require them: paying needs the order's **current**
 * session at the order's **current** total and currency; expiring or failing needs the current
 * session. A claim that matches nothing is then classified — a redelivery (`alreadyFinal`), an
 * expected event for a replaced session (`superseded`), or money that moved against something this
 * order no longer describes (`mismatch`), which is recorded and alerted and never applied.
 */

/** The four facts about a Checkout Session the order is checked against. */
export type SessionFacts = {
  /** Minor units, as Stripe charged it. */
  amountTotal: null | number
  currency: null | string
  id: string
  /** `paid` | `unpaid` | `no_payment_required`. */
  paymentStatus: null | string
}

export type ShortLine = { available: number; quantity: number; variantId: number }

/*
 * `confirmationEmailId` / `emailId`: the email-messages row queued **inside** the same transaction
 * as the state change (Phase 36 sweep 1), so a crash after the commit cannot lose it — the route
 * only delivers it. `null` when nothing new was queued.
 *
 * `rolledBack`: the shortfall was found by a decrement failing mid-loop, and the savepoint undid the
 * decrements before it (as opposed to the plan refusing up front). Reported for the harness.
 */
export type FulfilOutcome =
  | { confirmationEmailId: null | number; orderId: number; outcome: 'finalised' }
  /** `status` is the order's status as the event found it. */
  | { orderId: number; outcome: 'alreadyFinal'; status: null | PaymentStatus }
  | { orderId: number; outcome: 'awaitingPayment' }
  | { orderId: number; outcome: 'transitioned'; status: PaymentStatus }
  | {
      amountRefundedMinor: number
      emailId: null | number
      full: boolean
      orderId: number
      outcome: 'refunded'
    }
  | {
      confirmationEmailId: null | number
      orderId: number
      outcome: 'outOfStock'
      rolledBack: boolean
      short: ShortLine[]
    }
  | { orderId: number; outcome: 'mismatch'; reason: string }
  | { orderId: number; outcome: 'superseded' }
  | { orderId: number; outcome: 'recorded' }
  | { orderId: null; outcome: 'noOrder' }
  | { orderId: null; outcome: 'ignored' }

const relatedId = (value: unknown): null | number =>
  typeof value === 'number'
    ? value
    : typeof value === 'object' && value && 'id' in value
      ? ((value as { id: number }).id ?? null)
      : null

/**
 * The payment statuses as SQL literals.
 *
 * A conditional `UPDATE` needs the new value in the statement, and `payment_status` is a Postgres
 * enum: a bound parameter there has to be told which enum it is, which means writing the generated
 * type name into application code and hoping a later migration does not rename it. The union is
 * closed and exhaustively keyed, so a literal is both safer and one fewer thing to keep in step. The
 * `IN (...)` side stays parameterised, where Postgres infers the type from the column.
 */
const STATUS_LITERAL: Record<PaymentStatus, ReturnType<typeof sql>> = {
  cancelled: sql`'cancelled'`,
  checkout_started: sql`'checkout_started'`,
  draft: sql`'draft'`,
  paid: sql`'paid'`,
  payment_failed: sql`'payment_failed'`,
  pending_payment: sql`'pending_payment'`,
  refunded: sql`'refunded'`,
}

const statusList = (statuses: readonly PaymentStatus[]) =>
  sql.join(
    statuses.map((status) => sql`${status}`),
    sql`, `,
  )

/**
 * Apply one verified event to one order.
 *
 * `paymentIntentId` is recorded when the event carries one, because `Orders.stripePaymentIntentId` is
 * unique and is what makes a duplicate finalisation detectable from the data alone, months later.
 *
 * **`orderId` may be `null`, and that is Phase 18's refund path.** A `charge.refunded` event's object
 * is a Charge, whose `metadata` is the charge's own; the link that survives is the payment intent,
 * which is stored on the order — so an event with no usable reference falls back to it.
 *
 * **`session` is required for every `checkout.session.*` event** (Phase 36, R1-01). One that
 * arrives without it cannot be checked against the order, so it is a `mismatch`, never a payment.
 */
export type StripeEventInput = {
  amountRefundedMinor?: null | number
  eventType: string
  orderId: null | number
  paymentIntentId: null | string
  session?: null | SessionFacts
}

/**
 * **A mismatch is flagged on the order, not only on the event row** — Phase 36 sweep 1.
 *
 * A mismatched session may have taken the customer's money while the order stays unpaid, and an
 * event row is not where anyone looks for an order. So the order named in the metadata gets
 * `fulfilmentHold: paymentMismatch`, which the Orders list shows and filters on. Its payment status
 * is left alone — what the money was for is exactly what is in doubt — and nothing is refunded
 * automatically: whether this payment is a duplicate to return or the customer's only payment to
 * reconcile is a decision for a person with the Stripe dashboard open.
 */
export async function applyStripeEvent(
  payload: Payload,
  input: StripeEventInput,
): Promise<FulfilOutcome> {
  const outcome = await applyEvent(payload, input)

  if (outcome.outcome === 'mismatch') {
    await payload.db.drizzle.execute(
      sql`UPDATE "orders" SET "fulfilment_hold" = 'paymentMismatch' WHERE "id" = ${outcome.orderId}`,
    )
  }

  return outcome
}

async function applyEvent(payload: Payload, input: StripeEventInput): Promise<FulfilOutcome> {
  const plan = planStripeEvent(input.eventType, input.session?.paymentStatus ?? null)

  if (plan.kind === 'ignore') {
    return { orderId: null, outcome: 'ignored' }
  }

  const order = await resolveOrder(payload, input.orderId, input.paymentIntentId)

  if (!order && plan.kind === 'refund' && input.orderId === null && input.paymentIntentId) {
    /*
     * Phase 36 sweep 1: a refund found by payment intent alone, for an intent no order holds yet.
     * The intent is stored when the payment is applied, so the likeliest reason is that the payment
     * event has not been processed — a refund issued within seconds, or a payment event still being
     * retried. Acknowledging it would lose the refund for good; throwing makes the route answer 500,
     * and Stripe's retry finds the order once the payment lands. (An intent that belongs to another
     * application is retried until Stripe gives up, and shows as a failed row — noisy, not lossy.)
     */
    throw new Error(
      `No order holds payment intent ${input.paymentIntentId} yet — the payment may not have been applied. Retry.`,
    )
  }

  if (!order) {
    /*
     * §17.1h's *"invalid metadata"*. A signature proves Stripe sent it; it does not prove the order
     * exists here — another application on the same account, an older deploy, a hand-made test event.
     * Acknowledged and recorded, never crashed on.
     */
    return { orderId: null, outcome: 'noOrder' }
  }

  /* See `planStripeEvent`: a declined attempt inside Checkout does not end the session. */
  if (plan.kind === 'record') {
    return { orderId: order.id, outcome: 'recorded' }
  }

  if (plan.kind === 'refund') {
    return applyRefund(payload, order, input.amountRefundedMinor)
  }

  const session = input.session ?? null

  if (session === null) {
    return {
      orderId: order.id,
      outcome: 'mismatch',
      reason: 'A Checkout Session event arrived without its session.',
    }
  }

  if (plan.kind === 'mismatch') {
    return { orderId: order.id, outcome: 'mismatch', reason: plan.reason }
  }

  if (plan.kind === 'finalise') {
    return finalisePaidOrder(payload, order.id, input.paymentIntentId, session)
  }

  /*
   * **Every other transition is claimed, not checked** — one statement whose `WHERE` carries both
   * the states it may move from and the session it belongs to. The failure case that made claims
   * necessary: a failure event for a superseded attempt, arriving at the same instant as the event
   * that paid the order, read `pending_payment`, agreed the transition was legal, and wrote
   * `payment_failed` over a payment that had already succeeded.
   *
   * `awaitPayment` is `completed` with `payment_status: unpaid` — a delayed bank payment. The order
   * stays (or becomes) `pending_payment`; no stock moves and no email is sent until
   * `async_payment_succeeded` arrives.
   */
  const to: PaymentStatus = plan.kind === 'awaitPayment' ? 'pending_payment' : plan.to
  const from: readonly PaymentStatus[] =
    plan.kind === 'awaitPayment'
      ? ['checkout_started', 'pending_payment']
      : statusesThatCanReach(to)

  const claim = await payload.db.drizzle.execute(
    sql`UPDATE "orders"
        SET "payment_status" = ${STATUS_LITERAL[to]}
        WHERE "id" = ${order.id}
          AND "stripe_checkout_session_id" = ${session.id}
          AND "payment_status" IN (${statusList(from)})`,
  )

  if ((claim.rowCount ?? 0) === 0) {
    return classifyUnclaimed(payload, order.id, plan.kind, session)
  }

  if (to === 'cancelled') {
    /*
     * An expired session cancels the fulfilment half too. Separate from the claim because the claim
     * is what guarantees exactly one caller reaches here. **Stock is deliberately not returned**:
     * inventory moves only at confirmed payment, so there is nothing to give back.
     */
    await payload.update({
      collection: 'orders',
      data: { fulfillmentStatus: 'cancelled' },
      id: order.id,
      overrideAccess: true,
    })
  }

  return plan.kind === 'awaitPayment'
    ? { orderId: order.id, outcome: 'awaitingPayment' }
    : { orderId: order.id, outcome: 'transitioned', status: to }
}

/** Re-read the order after a claim matched nothing, and say why — see `classifyUnclaimedSessionEvent`. */
async function classifyUnclaimed(
  payload: Payload,
  orderId: number,
  kind: 'awaitPayment' | 'finalise' | 'transition',
  session: SessionFacts,
): Promise<FulfilOutcome> {
  const order = await payload.findByID({
    collection: 'orders',
    depth: 0,
    id: orderId,
    overrideAccess: true,
  })

  const status = order.paymentStatus as PaymentStatus

  const verdict = classifyUnclaimedSessionEvent({
    kind,
    order: {
      currency: String(order.currency),
      sessionId: order.stripeCheckoutSessionId ?? null,
      status,
      totalMinor: order.totalMinor,
    },
    session,
  })

  return verdict.outcome === 'alreadyFinal'
    ? { orderId, outcome: 'alreadyFinal', status }
    : verdict.outcome === 'superseded'
      ? { orderId, outcome: 'superseded' }
      : { orderId, outcome: 'mismatch', reason: verdict.reason }
}

/**
 * **Payload's `NotFound` is "no such order"; anything else is not** — Phase 36, audit R1-04.
 *
 * This was `.catch(() => null)`, so a dropped connection became `noOrder`, the event was recorded
 * `ignored`, and the route answered 200: Stripe stopped retrying a payment the shop had never
 * applied. Only a 404 is absence. Everything else is rethrown, the route records the row `failed`
 * and answers 500, and Stripe's retry is reprocessed.
 */
function notFoundAsNull(error: unknown): null {
  if ((error as { status?: unknown } | null)?.status === 404) {
    return null
  }

  throw error
}

/**
 * The order this event is about — by reference if it carries one, and by payment intent if it does
 * not. Both columns are unique and both lookups are exact, so neither can return somebody else's
 * order.
 */
async function resolveOrder(
  payload: Payload,
  orderId: null | number,
  paymentIntentId: null | string,
) {
  if (orderId !== null) {
    return payload
      .findByID({ collection: 'orders', depth: 0, id: orderId, overrideAccess: true })
      .catch(notFoundAsNull)
  }

  if (paymentIntentId === null) {
    return null
  }

  const { docs } = await payload.find({
    collection: 'orders',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { stripePaymentIntentId: { equals: paymentIntentId } },
  })

  return docs[0] ?? null
}

/**
 * **A refund, recorded by amount** — §18.1b's `PAID → REFUNDED`, and Phase 36's audit R1-09.
 *
 * `charge.refunded` carries the **cumulative** `amount_refunded`, for partial refunds as well as full
 * ones. So the statement:
 *
 * - raises `refunded_minor` to the new cumulative figure and never lowers it — `GREATEST`, because
 *   two refund events can arrive out of order and the smaller one must not overwrite the larger;
 * - moves the order to `refunded` only when the refund covers the total (`isFullRefund`); a partial
 *   refund leaves it `paid`, so what remains can still be picked and sent;
 * - matches only when the figure is **new** — so a redelivery changes nothing, and each new
 *   cumulative amount is one outcome, which the route turns into one email (the dedupe key includes
 *   the amount).
 *
 * `refunded` stays in the `WHERE` because a later event can still carry a larger cumulative figure
 * than the one that first crossed the total, and the recorded amount should say what Stripe says.
 */
async function applyRefund(
  payload: Payload,
  order: { id: number; paymentStatus?: unknown; totalMinor: number },
  amountRefundedMinor: null | number | undefined,
): Promise<FulfilOutcome> {
  if (
    typeof amountRefundedMinor !== 'number' ||
    !Number.isSafeInteger(amountRefundedMinor) ||
    amountRefundedMinor <= 0
  ) {
    return {
      orderId: order.id,
      outcome: 'alreadyFinal',
      status: (order.paymentStatus as PaymentStatus) ?? null,
    }
  }

  const full = isFullRefund(amountRefundedMinor, order.totalMinor)
  const { req, transactionID, tx } = await openTransaction(payload)

  let emailId: null | number = null

  try {
    const claim = await tx.execute(
      sql`UPDATE "orders"
          SET "refunded_minor" = GREATEST(COALESCE("refunded_minor", 0), ${amountRefundedMinor}),
              "refunded_at" = ${new Date().toISOString()},
              "payment_status" = ${full ? STATUS_LITERAL.refunded : sql`"payment_status"`}
          WHERE "id" = ${order.id}
            AND "payment_status" IN (${statusList(['paid', 'refunded'])})
            AND COALESCE("refunded_minor", 0) < ${amountRefundedMinor}`,
    )

    if ((claim.rowCount ?? 0) === 0) {
      await payload.db.commitTransaction(transactionID)

      const status = (order.paymentStatus as PaymentStatus) ?? null

      if (status !== 'paid' && status !== 'refunded') {
        /*
         * Phase 36 sweep 1: a refund for an order whose payment has not been applied yet — the
         * `completed` event is still on its way or being retried. Recording it `processed` lost the
         * refund; throwing makes Stripe retry until the payment has landed and this can apply.
         */
        throw new Error(
          `A refund arrived for order ${order.id} while it is ${String(status)}; the payment has not been applied yet. Retry.`,
        )
      }

      return { orderId: order.id, outcome: 'alreadyFinal', status }
    }

    /* The refund email rides in the same transaction, so it cannot be lost after the commit. */
    emailId = await queueOnce(
      payload,
      req,
      transactionID,
      dedupeKeyFor('refund', { amountMinor: amountRefundedMinor, id: order.id }),
      () => queueRefundMessage(payload, order.id, amountRefundedMinor, req as PayloadRequest),
    )

    await payload.db.commitTransaction(transactionID)
  } catch (error) {
    await payload.db.rollbackTransaction(transactionID).catch(() => undefined)

    throw error
  }

  return { amountRefundedMinor, emailId, full, orderId: order.id, outcome: 'refunded' }
}

type TxHandle = {
  execute: (query: unknown) => Promise<{ rowCount?: number; rows?: unknown[] }>
}

/** A transaction, its Local API `req`, and the raw handle for expression updates. */
async function openTransaction(payload: Payload) {
  const transactionID = await payload.db.beginTransaction()

  if (transactionID === null) {
    throw new Error('Could not begin a transaction.')
  }

  const tx = (payload.db as unknown as { sessions?: Record<string, { db: TxHandle }> }).sessions?.[
    String(transactionID)
  ]?.db

  if (!tx) {
    throw new Error('The transaction session was not available.')
  }

  const req = { transactionID } as Parameters<typeof payload.find>[0]['req']

  return { req, transactionID, tx }
}

/**
 * **Queue one email inside an open transaction, without letting it endanger the transaction.**
 *
 * The obvious call — `enqueueEmail` with `req` — would, on a duplicate key, fail an insert inside the
 * payment's transaction, and Payload answers a failed Local API write by **killing the transaction**:
 * the payment would silently roll back while this code went on to report success. So the dedupe key
 * is checked first, with the same `req` (the row being paid is already claimed in this transaction,
 * so no other finaliser can be inserting the same key). If the transaction was killed anyway, that is
 * thrown — the route answers 500 and Stripe retries the whole thing — never swallowed. Any other
 * refusal (`error`) is logged and reported; the payment stands.
 */
async function queueOnce(
  payload: Payload,
  req: Parameters<typeof payload.find>[0]['req'],
  transactionID: number | string,
  dedupeKey: string,
  queue: () => Promise<EnqueueOutcome>,
): Promise<null | number> {
  const { totalDocs } = await payload.find({
    collection: 'email-messages',
    depth: 0,
    limit: 0,
    overrideAccess: true,
    req,
    where: { dedupeKey: { equals: dedupeKey } },
  })

  if (totalDocs > 0) {
    return null
  }

  const queued = await queue()

  const alive = Boolean(
    (payload.db as unknown as { sessions?: Record<string, unknown> }).sessions?.[
      String(transactionID)
    ],
  )

  if (!alive) {
    throw new Error(
      `Queueing ${dedupeKey} ended the transaction${queued.outcome === 'error' ? `: ${queued.reason}` : ''}. Retry.`,
    )
  }

  if (queued.outcome === 'claimed') {
    return queued.id
  }

  if (queued.outcome === 'error') {
    payload.logger.error({ dedupeKey, msg: `An order email could not be queued: ${queued.reason}` })
    reportFailure(new Error(queued.reason), 'checkout.queueEmail', { dedupeKey })
  }

  return null
}

/**
 * **§17.1f, in one transaction.**
 *
 * > *"At order finalization: re-check inventory transactionally. Atomically decrement or otherwise
 * > reserve/commit stock. If stock is unavailable, do not mark an impossible order as fulfilled."*
 *
 * ### The claim — which session, for how much
 *
 * One conditional `UPDATE` sets `paid` and refuses to if the order is already paid, **or** if the
 * session is not the order's current one, **or** if the amount or currency differ from what the order
 * records (Phase 36, R1-01). Zero rows is then classified; see `classifyUnclaimed`. The same
 * statement resets `fulfillment_status` to `unfulfilled`, because a finalisable order has never been
 * picked and a `cancelled` left behind by an earlier expiry is terminal.
 *
 * ### What happens when the stock is not there — R1-10 and R3-19
 *
 * The payment has already succeeded, so the order is marked **paid** and left **unfulfilled**, and
 * a human decides between refunding, back-ordering and substituting (§17.1f's *"exception path"*).
 * Phase 36 made that true all the way through:
 *
 * - **No partial pick.** A `SAVEPOINT` is taken after the claim, and if any decrement affects no row
 *   the transaction rolls back to it — so no line's stock moves, which is what `planStockDecrements`
 *   always promised and the per-variant loop did not deliver.
 * - **The same tail either way.** The promotion is counted and the bag is converted on both paths: the
 *   customer paid with that code and for that bag, whether or not the goods are there.
 * - **It is visible.** `fulfilmentHold: stockShortfall` and the `shortfall` detail are written in the
 *   same transaction, and the failure is reported beyond the log.
 */
async function finalisePaidOrder(
  payload: Payload,
  orderId: number,
  paymentIntentId: null | string,
  session: SessionFacts,
): Promise<FulfilOutcome> {
  /*
   * `tx` is the narrowed handle for the statements that must be expression updates rather than
   * read-then-write. Only `execute` is used, and only with parameterised SQL.
   */
  const { req, transactionID, tx } = await openTransaction(payload)

  let short: ShortLine[] = []
  let rolledBack = false
  let promotionCounted = true
  let promotionId: null | number = null
  let confirmationEmailId: null | number = null

  try {
    /*
     * **The claim, and the only barrier that holds under concurrency.** Postgres serialises two
     * statements on the row, the loser sees zero rows affected, and it stops. `FINALISABLE_STATUSES`
     * comes from the state machine so the SQL and the machine cannot drift. `amount_total = NULL`
     * is never true, so a session with no amount cannot pay anything.
     */
    const claim = await tx.execute(
      sql`UPDATE "orders"
          SET "payment_status" = 'paid',
              "paid_at" = ${new Date().toISOString()},
              "fulfillment_status" = 'unfulfilled',
              "stripe_payment_intent_id" = COALESCE(${paymentIntentId}, "stripe_payment_intent_id")
          WHERE "id" = ${orderId}
            AND "payment_status" IN (${statusList(FINALISABLE_STATUSES)})
            AND "stripe_checkout_session_id" = ${session.id}
            AND "total_minor" = ${session.amountTotal}
            AND lower("currency"::text) = lower(${session.currency ?? ''})`,
    )

    if ((claim.rowCount ?? 0) === 0) {
      await payload.db.commitTransaction(transactionID)

      return classifyUnclaimed(payload, orderId, 'finalise', session)
    }

    /* Everything after this point may be undone without undoing the claim. See the docblock. */
    await tx.execute(sql`SAVEPOINT "finalise_stock"`)

    const order = await payload.findByID({
      collection: 'orders',
      depth: 0,
      id: orderId,
      overrideAccess: true,
      req,
    })

    const { docs: items } = await payload.find({
      collection: 'order-items',
      depth: 0,
      limit: 500,
      overrideAccess: true,
      pagination: false,
      req,
      where: { order: { equals: orderId } },
    })

    const variantIds = items
      .map((item) => relatedId(item.variant))
      .filter((id): id is number => typeof id === 'number')

    const { docs: variants } = await payload.find({
      collection: 'product-variants',
      depth: 0,
      limit: Math.max(1, variantIds.length),
      overrideAccess: true,
      pagination: false,
      req,
      where: { id: { in: variantIds.length > 0 ? variantIds : [0] } },
    })

    const stockOf = new Map(
      variants.map((variant) => [
        variant.id,
        typeof variant.inventoryQuantity === 'number' ? variant.inventoryQuantity : 0,
      ]),
    )

    const lines: StockLine[] = items.flatMap((item) => {
      const variantId = relatedId(item.variant)

      return variantId === null
        ? []
        : [{ quantity: item.quantity, stock: stockOf.get(variantId) ?? 0, variantId }]
    })

    const plan = planStockDecrements(lines)

    if (!plan.ok) {
      short = plan.short
    } else {
      /*
       * **Each decrement is one atomic statement**, evaluated by Postgres against the row it locks,
       * with a guard that refuses rather than go negative. Zero rows means somebody else took the
       * stock between the plan and the write — and then every decrement already made in this loop is
       * rolled back with the savepoint, so the order takes no stock at all rather than some of it.
       */
      for (const decrement of plan.decrements) {
        const updated = await tx.execute(
          sql`UPDATE "product_variants"
              SET "inventory_quantity" = "inventory_quantity" - ${decrement.quantity}
              WHERE "id" = ${decrement.variantId}
                AND "inventory_quantity" >= ${decrement.quantity}`,
        )

        if ((updated.rowCount ?? 0) === 0) {
          await tx.execute(sql`ROLLBACK TO SAVEPOINT "finalise_stock"`)

          rolledBack = true

          /*
           * Phase 36 sweep 1: record every short line with what is **actually** available now,
           * not just the one that failed with a guessed zero. The stock is re-read after the
           * rollback, so it is the committed figure the next decision would be made on.
           */
          short = await shortfallNow(tx, lines, decrement)

          break
        }
      }
    }

    if (short.length > 0) {
      await tx.execute(
        sql`UPDATE "orders"
            SET "fulfilment_hold" = 'stockShortfall',
                "shortfall" = ${JSON.stringify(short)}::jsonb
            WHERE "id" = ${orderId}`,
      )
    }

    /*
     * **The promotion is counted, but only while it is under its limit** — Phase 36, R1-07.
     *
     * `timesUsed` moves inside the payment transaction (Phase 17), as an expression so two
     * concurrent payments both count. The limit used to be checked only at preflight, so N
     * overlapping checkouts on a code limited to one were all honoured and all counted. The
     * predicate makes the counter unable to pass the limit. The payment itself stands either way —
     * the money has moved at the discounted price — so zero rows is recorded and reported as an
     * over-redemption rather than refused.
     */
    promotionId = relatedId(order.promotion)

    if (promotionId !== null) {
      const counted = await tx.execute(
        sql`UPDATE "promotions"
            SET "times_used" = "times_used" + 1
            WHERE "id" = ${promotionId}
              AND ("usage_limit" IS NULL OR "times_used" < "usage_limit")`,
      )

      promotionCounted = (counted.rowCount ?? 0) > 0
    }

    /* The bag is history now — on both paths. §14's `converted` status exists for this moment. */
    const cartId = relatedId(order.cart)

    if (cartId !== null) {
      /*
       * Phase 36 sweep 1: a raw statement through this transaction, not a Local API update. A
       * Local API write that fails — a bag deleted meanwhile is a `NotFound` — makes Payload kill
       * the transaction, and the payment rolled back silently while this function went on to report
       * `finalised`. Zero rows here just means the bag is gone, which is fine.
       */
      await tx.execute(sql`UPDATE "carts" SET "status" = 'converted' WHERE "id" = ${cartId}`)
    }

    /*
     * **The confirmation is queued in this transaction** (Phase 36 sweep 1) — it commits with the
     * payment or not at all. It used to be queued after the response, once the event row already
     * said `processed`, so a crash in between lost it and no retry would ever recreate it. The
     * route now only delivers the queued row. See `queueOnce` for why this cannot harm the payment.
     */
    confirmationEmailId = await queueOnce(
      payload,
      req,
      transactionID,
      dedupeKeyFor('orderConfirmation', { id: orderId }),
      () => queueOrderConfirmation(payload, orderId, req as PayloadRequest),
    )

    await payload.db.commitTransaction(transactionID)
  } catch (error) {
    await payload.db.rollbackTransaction(transactionID).catch(() => undefined)

    throw error
  }

  /* Reported after the commit, so a report can never describe a transaction that rolled back. */
  if (!promotionCounted) {
    const error = new Error('A promotion was redeemed beyond its usage limit.')

    payload.logger.error({
      msg:
        'A paid order used a promotion that had already reached its usage limit (or was deleted). ' +
        'The payment stands; the redemption was not counted.',
      orderId,
      promotionId,
    })
    reportFailure(error, 'checkout.promotionOverRedeemed', { orderId, promotionId })
  }

  if (short.length > 0) {
    payload.logger.error({
      msg:
        'An order was paid that cannot be fulfilled from stock. It is marked paid, held with ' +
        'fulfilmentHold=stockShortfall, and no stock was taken — plan §17.1f.',
      orderId,
      short,
    })
    reportFailure(
      new Error('A paid order could not be fulfilled from stock.'),
      'checkout.oversold',
      {
        orderId,
        shortLines: short.length,
      },
    )

    return { confirmationEmailId, orderId, outcome: 'outOfStock', rolledBack, short }
  }

  return { confirmationEmailId, orderId, outcome: 'finalised' }
}

/**
 * Every line that cannot be met, with the stock actually available, read inside the transaction
 * after the savepoint rollback. If a re-plan finds nothing short (the stock came back in the
 * meantime), the line whose decrement failed is still reported — the order is held either way,
 * because a person should look at an order that raced for its last units.
 */
async function shortfallNow(
  tx: TxHandle,
  lines: StockLine[],
  failed: { quantity: number; variantId: number },
): Promise<ShortLine[]> {
  const ids = [...new Set(lines.map((line) => line.variantId))]

  const result = await tx.execute(
    sql`SELECT "id", "inventory_quantity" FROM "product_variants"
        WHERE "id" IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`,
  )

  const stock = new Map(
    ((result.rows ?? []) as { id: number | string; inventory_quantity: null | number }[]).map(
      (row) => [Number(row.id), Number(row.inventory_quantity ?? 0)],
    ),
  )

  const replanned = planStockDecrements(
    lines.map((line) => ({ ...line, stock: stock.get(line.variantId) ?? 0 })),
  )

  return replanned.short.length > 0
    ? replanned.short
    : [
        {
          available: stock.get(failed.variantId) ?? 0,
          quantity: failed.quantity,
          variantId: failed.variantId,
        },
      ]
}
