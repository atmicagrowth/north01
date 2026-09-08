import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import {
  FINALISABLE_STATUSES,
  intendedStatusFor,
  needsPaymentFinalisation,
  planStockDecrements,
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
 * only way the two idempotency barriers, the transaction and the inventory race can be observed
 * rather than reasoned about. The guard sits on `stripe.ts`, which is where the key lives.
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
 * plan's diagram reads as three steps because it is describing a sequence of events, but two of them
 * are one write or the shop can pay for a parcel it cannot send: an order marked paid whose stock
 * decrement then failed is precisely the *"impossible order"* §17.1f says must not exist.
 *
 * The email is genuinely afterwards, and genuinely outside the transaction — it is **Phase 19**, and
 * a mail provider being slow or down must not roll back a payment that has already happened.
 *
 * ### The two barriers, both of them
 *
 * §17.1d: *"The unique Stripe event ID is the first idempotency barrier. Business-state guards are
 * the second."* The first is enforced by the database, in the webhook route, by inserting the event
 * id into a unique column. The second is `needsPaymentFinalisation`, here — because Stripe sends
 * `checkout.session.completed` **and** `payment_intent.succeeded` for a single payment, and those are
 * two different events with two different ids. The first barrier lets both through. Only the second
 * stops the inventory being decremented twice.
 */

export type FulfilOutcome =
  | { orderId: number; outcome: 'finalised' }
  | { orderId: number; outcome: 'alreadyFinal' }
  | { orderId: number; outcome: 'transitioned'; status: PaymentStatus }
  | {
      orderId: number
      outcome: 'outOfStock'
      short: { available: number; quantity: number; variantId: number }[]
    }
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
 * unique and is what makes a duplicate finalisation detectable from the data alone, months later,
 * without replaying anything.
 *
 * **`orderId` may be `null`, and that is Phase 18's refund path.** §17.1b attaches an order reference
 * through Checkout Session metadata, and every session-shaped event carries it back. A
 * `charge.refunded` event does not: its `data.object` is a Charge, whose `metadata` is the charge's
 * own and is usually empty. The link that *does* survive is the payment intent, which Phase 17 already
 * stores on the order and which Stripe puts on the charge -- so an event with no usable reference
 * falls back to it rather than being discarded. Without that, a refund would be signed, correct, about
 * an order this shop holds, and silently ignored.
 */
export async function applyStripeEvent(
  payload: Payload,
  input: {
    amountRefundedMinor?: null | number
    eventType: string
    orderId: null | number
    paymentIntentId: null | string
  },
): Promise<FulfilOutcome> {
  const intended = intendedStatusFor(input.eventType)

  if (intended === null) {
    return { orderId: null, outcome: 'ignored' }
  }

  const order = await resolveOrder(payload, input.orderId, input.paymentIntentId)

  if (!order) {
    /*
     * §17.1h's *"invalid metadata"*. A signature proves Stripe sent it; it does not prove the order
     * exists here — another application on the same account, an older deploy, a hand-made test event.
     * Acknowledged and recorded, never crashed on.
     */
    return { orderId: null, outcome: 'noOrder' }
  }

  const current = order.paymentStatus as PaymentStatus

  if (intended === 'paid') {
    if (!needsPaymentFinalisation(current)) {
      /*
       * **The second barrier.** Already paid, already refunded, or in a state from which payment is
       * not reachable. Not an error and not a retry: a correct, expected outcome of the second event
       * describing a payment that has already been applied.
       */
      return { orderId: order.id, outcome: 'alreadyFinal' }
    }

    return finalisePaidOrder(payload, order.id, input.paymentIntentId)
  }

  /*
   * **Every other transition is claimed, not checked** — the shape Phase 17's sweeps arrived at, now
   * applied to the paths they did not cover. The one that mattered: a `payment_intent.payment_failed`
   * for a superseded attempt, arriving at the same instant as the event that paid the order, read
   * `pending_payment`, agreed the transition was legal, and wrote `payment_failed` over a payment
   * that had already succeeded. The machine forbids `paid -> payment_failed`; the read simply never
   * saw `paid`. Here the condition and the write are one statement, and Postgres serialises them.
   *
   * A refund also records **how much** and **when**. A status alone cannot tell a partial refund from
   * a full one, and only the amount can.
   */
  const refundExtras =
    intended === 'refunded'
      ? sql`, "refunded_at" = ${new Date().toISOString()}, "refunded_minor" = ${
          typeof input.amountRefundedMinor === 'number' ? input.amountRefundedMinor : null
        }`
      : sql``

  const claim = await payload.db.drizzle.execute(
    sql`UPDATE "orders"
        SET "payment_status" = ${STATUS_LITERAL[intended]}${refundExtras}
        WHERE "id" = ${order.id}
          AND "payment_status" IN (${statusList(statusesThatCanReach(intended))})`,
  )

  if ((claim.rowCount ?? 0) === 0) {
    return { orderId: order.id, outcome: 'alreadyFinal' }
  }

  if (intended === 'cancelled') {
    /*
     * An expired session cancels the fulfilment half too. Separate from the claim above because the
     * claim is what guarantees exactly one caller reaches here — by the time this runs the race is
     * over.
     *
     * **Stock is deliberately not returned.** Phase 17 moves inventory only at confirmed payment, so
     * a cancellation at this point has nothing to give back: the units were never taken.
     */
    await payload.update({
      collection: 'orders',
      data: { fulfillmentStatus: 'cancelled' },
      id: order.id,
      overrideAccess: true,
    })
  }

  return { orderId: order.id, outcome: 'transitioned', status: intended }
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
      .catch(() => null)
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
 * **§17.1f, in one transaction.**
 *
 * > *"At order finalization: re-check inventory transactionally. Atomically decrement or otherwise
 * > reserve/commit stock. If stock is unavailable, do not mark an impossible order as fulfilled."*
 *
 * Stock is read **inside** the transaction that will write it, so the value a decision is made on
 * cannot change before the decision is written. That is the whole of the race: two customers buying
 * the last unit are two transactions, and the second one reads what the first one committed.
 *
 * ### What happens when the stock is not there
 *
 * The payment has already succeeded — Stripe took the money before this ran, and nothing here can
 * undo that. So the order is marked **paid** and left **unfulfilled**, and the shortfall is logged.
 * That is §17.1f's *"refund/exception path"*: a human decides between refunding, back-ordering and
 * substituting, because none of those is a decision code should make silently.
 *
 * The alternative — refusing to mark it paid — would be worse in every direction: the money is gone,
 * the customer has a receipt from Stripe, and the shop's own record would say the order was never
 * paid for. §17.1f says *"do not mark an impossible order as **fulfilled**"*, and fulfilment is
 * precisely the half that is withheld.
 */
async function finalisePaidOrder(
  payload: Payload,
  orderId: number,
  paymentIntentId: null | string,
): Promise<FulfilOutcome> {
  const transactionID = await payload.db.beginTransaction()

  if (transactionID === null) {
    throw new Error('Could not begin a transaction to finalise the order.')
  }

  const req = { transactionID } as Parameters<typeof payload.find>[0]['req']

  try {
    /*
     * The narrowed handle for the two statements that must be expression updates rather than
     * read-then-write. Only `execute` is used, and only with parameterised SQL.
     */
    const session = (
      payload.db as unknown as {
        sessions?: Record<
          string,
          { db: { execute: (query: unknown) => Promise<{ rowCount?: number }> } }
        >
      }
    ).sessions?.[transactionID]

    if (!session) {
      throw new Error('The transaction session was not available to finalise the order.')
    }

    /*
     * **The third barrier, and the only one that holds under concurrency.**
     *
     * The two in §17.1d are a unique event id and a status check. Phase 17's first sweep ran two
     * deliveries of one payment at the same instant and both passed the status check — because a
     * check is a *read*, and two transactions read the same row before either wrote it. The stock
     * then moved twice.
     *
     * So the order is **claimed**, not checked: one conditional UPDATE that both sets `paid` and
     * refuses to if it is already paid. Postgres serialises the two statements on the row, the loser
     * sees zero rows affected, and it stops. There is no window between the decision and the write
     * because they are the same statement.
     *
     * `FINALISABLE_STATUSES` comes from the state machine so the SQL and the machine cannot drift.
     */
    const claim = await session.db.execute(
      sql`UPDATE "orders"
          SET "payment_status" = 'paid',
              "paid_at" = ${new Date().toISOString()},
              "stripe_payment_intent_id" = COALESCE(${paymentIntentId}, "stripe_payment_intent_id")
          WHERE "id" = ${orderId}
            AND "payment_status" IN (${sql.join(
              FINALISABLE_STATUSES.map((status) => sql`${status}`),
              sql`, `,
            )})`,
    )

    if ((claim.rowCount ?? 0) === 0) {
      /* Somebody else finalised it, or it was never finalisable. Both are `alreadyFinal`. */
      await payload.db.commitTransaction(transactionID)

      return { orderId, outcome: 'alreadyFinal' }
    }

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
      payload.logger.error({
        msg:
          'An order was paid that cannot be fulfilled from stock. It is marked paid and left ' +
          'unfulfilled for a human decision — plan §17.1f.',
        orderId,
        short: plan.short,
      })

      await payload.db.commitTransaction(transactionID)

      return { orderId, outcome: 'outOfStock', short: plan.short }
    }

    /*
     * **The decrement is one atomic statement, not a read followed by a write.**
     *
     * §17.1f says *"atomically decrement"* and the first version of this did not: it wrote
     * `stockRead - quantity`, an absolute value computed from a read taken earlier in the
     * transaction. Two finalisations running at once both read 5, and both wrote their own answer —
     * the classic lost update. Phase 17's first sweep caught it by running two events concurrently
     * and watching **both** report success.
     *
     * `inventory_quantity = inventory_quantity - $n` is evaluated by Postgres against the row it is
     * locking, so the second statement waits for the first to commit and then subtracts from the
     * value the first left. The `AND inventory_quantity >= $n` guard makes it refuse rather than go
     * negative, and the row count says which happened — which is what turns *"atomically decrement
     * or otherwise reserve"* into something the database enforces rather than something this
     * function hopes for.
     *
     * Raw SQL through the transaction's own handle, because Payload's Local API has no expression
     * update. `docs/DATABASE.md` allows it; what it forbids is hand-authored *migrations*.
     */
    for (const decrement of plan.decrements) {
      const updated = await session.db.execute(
        sql`UPDATE "product_variants"
            SET "inventory_quantity" = "inventory_quantity" - ${decrement.quantity}
            WHERE "id" = ${decrement.variantId}
              AND "inventory_quantity" >= ${decrement.quantity}`,
      )

      /*
       * Zero rows means somebody else took the stock between the plan and the write. The payment has
       * happened, so this is §17.1f's exception path again: paid, unfulfilled, logged — never a
       * negative row and never a silent success.
       */
      if ((updated.rowCount ?? 0) === 0) {
        payload.logger.error({
          msg:
            'Stock disappeared between planning and decrementing. The order is paid and left ' +
            'unfulfilled for a human decision — plan §17.1f.',
          orderId,
          variantId: decrement.variantId,
        })

        await payload.db.commitTransaction(transactionID)

        return {
          orderId,
          outcome: 'outOfStock',
          short: [{ available: 0, quantity: decrement.quantity, variantId: decrement.variantId }],
        }
      }
    }

    /*
     * §15's owed item, paid here: `timesUsed` moves **inside the payment transaction**, which is what
     * `Promotions.ts` said Phase 17 would do — *"incrementing it anywhere earlier means a code
     * consumed by an abandoned checkout."*
     */
    const promotionId = relatedId(order.promotion)

    if (promotionId !== null) {
      /*
       * An expression, for the same reason the decrement above is one. This counter is what a
       * `usageLimit` is measured against, so a lost update here does not merely miscount — it lets a
       * code be honoured more often than the shop agreed to. Two customers paying with one code at
       * the same instant are two *different* orders, so neither §17.1d barrier applies and both are
       * genuinely owed an increment; a `read + 1` gives them one between them.
       *
       * Phase 17's second sweep found this by grepping for the **shape** of the first sweep's defect
       * rather than for another instance of it. `verify-webhook.ts` section L holds it, and section K
       * — which increments twice in sequence — passes either way, which is the point.
       */
      await session.db.execute(
        sql`UPDATE "promotions" SET "times_used" = "times_used" + 1 WHERE "id" = ${promotionId}`,
      )
    }

    /* The bag is history now. §14's `converted` status exists for exactly this moment. */
    const cartId = relatedId(order.cart)

    if (cartId !== null) {
      await payload
        .update({
          collection: 'carts',
          data: { status: 'converted' },
          id: cartId,
          overrideAccess: true,
          req,
        })
        .catch(() => undefined)
    }

    await payload.db.commitTransaction(transactionID)

    return { orderId, outcome: 'finalised' }
  } catch (error) {
    await payload.db.rollbackTransaction(transactionID)

    throw error
  }
}
