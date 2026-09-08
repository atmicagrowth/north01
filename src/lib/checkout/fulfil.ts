import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import {
  canTransition,
  FINALISABLE_STATUSES,
  intendedStatusFor,
  needsPaymentFinalisation,
  planStockDecrements,
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
 * Apply one verified event to one order.
 *
 * `paymentIntentId` is recorded when the event carries one, because `Orders.stripePaymentIntentId` is
 * unique and is what makes a duplicate finalisation detectable from the data alone, months later,
 * without replaying anything.
 */
export async function applyStripeEvent(
  payload: Payload,
  input: {
    eventType: string
    orderId: number
    paymentIntentId: null | string
  },
): Promise<FulfilOutcome> {
  const intended = intendedStatusFor(input.eventType)

  if (intended === null) {
    return { orderId: null, outcome: 'ignored' }
  }

  const order = await payload
    .findByID({ collection: 'orders', depth: 0, id: input.orderId, overrideAccess: true })
    .catch(() => null)

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

  if (!canTransition(current, intended)) {
    return { orderId: order.id, outcome: 'alreadyFinal' }
  }

  await payload.update({
    collection: 'orders',
    data: {
      paymentStatus: intended,
      ...(intended === 'cancelled' ? { fulfillmentStatus: 'cancelled' as const } : {}),
    },
    id: order.id,
    overrideAccess: true,
  })

  return { orderId: order.id, outcome: 'transitioned', status: intended }
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
