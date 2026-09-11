import { randomBytes } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import type { CartView } from '@/lib/cart/cart'
import type { ShippingRate } from '@/lib/shipping/rules'

import type { CheckoutContact } from './preflight'
import {
  formatOrderNumber,
  REUSABLE_ORDER_STATUSES,
  type PaymentStatus,
  type PreflightFailure,
} from './rules'

/**
 * **Plan §17.1a step 10 — *"create or update pending order context"* — safe under concurrency.**
 *
 * Split out of `preflight.ts` in Phase 36's first sweep, for the same reason `fulfil.ts` has no
 * `server-only` guard: it takes a `Payload` and touches no cookie, request or secret, so
 * `pnpm verify:checkout` can run two of these **at the same instant** against the real database. The
 * one thing that talks to Stripe — retiring the previous session — is passed in.
 *
 * ### The two races the sweep found, and what closes each
 *
 * 1. **Two first attempts on one bag** both looked for an order, both found none, and both created
 *    one — two live orders and two live sessions for one cart. Closed by a per-cart
 *    `pg_advisory_xact_lock` around the lookup and the write. A partial unique index on `orders(cart)`
 *    would say it more declaratively, but Payload's `indexes` has no `where` clause (it is
 *    `{ fields, unique }` only) and the index would be a hand-authored migration, which
 *    `docs/DATABASE.md` forbids. The lock is held only for this transaction, and only per cart.
 * 2. **Two attempts on an order already at `pending_payment`**: the reuse rewrite was unconditional, so
 *    both requests rewrote it, both created a session, and the first session was never expired. Now
 *    the rewrite is a conditional claim on the status and session id the lookup saw (zero rows →
 *    refuse, try again), and the order's `updated_at` after this write is returned as `preparedAt`.
 *    `claimOrderForSession` requires it: an attempt whose order was rewritten by a later attempt can
 *    no longer take it, and `session.ts` expires the session it made, so it can never be paid.
 *
 * The rest is as Phase 17 designed it: one order per cart, reused across attempts; written at
 * `checkout_started`, **never at `paid`**; lines snapshotted here, because this is the price the
 * Checkout Session will charge. See `preflight.ts` for why an old session is retired first.
 */

/** Namespace for this file's advisory locks, so a cart id cannot collide with another lock's key. */
const CART_LOCK_NAMESPACE = 3_601_017

export type PendingOrderInput = {
  cart: CartView
  contact: CheckoutContact
  customerId: null | number
  rate: ShippingRate
  /** The Stripe Tax calculation behind `totals.taxMinor`, or `null` when none was made. */
  taxCalculationId: null | string
  totals: {
    discountMinor: number
    shippingMinor: number
    subtotalMinor: number
    taxMinor: number
    totalMinor: number
  }
}

/** Ask Stripe about the reused order's old session; `null` means it can no longer be paid. */
export type RetirePriorSession = (
  orderId: number,
  sessionId: string,
  orderStatus: PaymentStatus,
) => Promise<null | PreflightFailure>

type TxHandle = { execute: (query: unknown) => Promise<{ rowCount?: number }> }

function txHandle(payload: Payload, transactionID: number | string): TxHandle {
  const handle = (payload.db as unknown as { sessions?: Record<string, { db: TxHandle }> })
    .sessions?.[String(transactionID)]?.db

  if (!handle) {
    throw new Error('The transaction session was not available.')
  }

  return handle
}

const trimmed = (value: null | string | undefined): string => (value ?? '').trim()

export async function upsertPendingOrder(
  payload: Payload,
  input: PendingOrderInput,
  retirePriorSession: RetirePriorSession,
): Promise<
  { ok: false; reason: PreflightFailure } | { ok: true; orderId: number; preparedAt: string }
> {
  const { cart, contact, customerId, rate, taxCalculationId, totals } = input

  const transactionID = await payload.db.beginTransaction()

  if (transactionID === null) {
    throw new Error('Could not begin a transaction to prepare the order.')
  }

  const req = { transactionID } as Parameters<typeof payload.find>[0]['req']

  const refuse = async (reason: PreflightFailure) => {
    await payload.db.rollbackTransaction(transactionID)

    return { ok: false as const, reason }
  }

  try {
    const tx = txHandle(payload, transactionID)

    /* Race 1: one attempt at a time per bag, from the lookup to the commit. */
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${CART_LOCK_NAMESPACE}::int, ${cart.id}::int)`,
    )

    const { docs: existing } = await payload.find({
      collection: 'orders',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      sort: '-createdAt',
      where: {
        and: [
          { cart: { equals: cart.id } },
          { paymentStatus: { in: [...REUSABLE_ORDER_STATUSES] } },
        ],
      },
    })

    const seen = existing[0] ?? null
    const seenSessionId = seen?.stripeCheckoutSessionId ?? null

    if (seen && seenSessionId) {
      const refusal = await retirePriorSession(
        seen.id,
        seenSessionId,
        seen.paymentStatus as PaymentStatus,
      )

      if (refusal !== null) {
        return await refuse(refusal)
      }
    }

    if (seen) {
      /*
       * Race 2: the rewrite is claimed on what the lookup saw. A webhook that moved the order during
       * the Stripe call above — the old session completing, say — makes this match nothing, and the
       * customer is asked to try again rather than having a paid order re-priced.
       */
      const claim = await tx.execute(
        sql`UPDATE "orders"
            SET "payment_status" = 'checkout_started', "stripe_checkout_session_id" = NULL
            WHERE "id" = ${seen.id}
              AND "payment_status" = ${seen.paymentStatus}
              AND "stripe_checkout_session_id" IS NOT DISTINCT FROM ${seenSessionId}`,
      )

      if ((claim.rowCount ?? 0) === 0) {
        return await refuse('checkoutFailed')
      }
    }

    const address = {
      city: trimmed(contact.shippingAddress.city),
      company: null,
      country: trimmed(contact.shippingAddress.country).toUpperCase(),
      firstName: trimmed(contact.shippingAddress.firstName),
      lastName: trimmed(contact.shippingAddress.lastName),
      line1: trimmed(contact.shippingAddress.line1),
      line2: trimmed(contact.shippingAddress.line2) || null,
      phone: trimmed(contact.shippingAddress.phone) || null,
      postalCode: trimmed(contact.shippingAddress.postalCode),
      region: trimmed(contact.shippingAddress.region) || null,
    }

    const data = {
      billingAddress: address,
      cart: cart.id,
      currency: cart.currency,
      ...(customerId === null ? {} : { customer: customerId }),
      discountCode: cart.discount?.code ?? null,
      discountMinor: totals.discountMinor,
      email: trimmed(contact.email).toLowerCase(),
      /* Required, and starts unfulfilled. Nothing here may write `paid` — see the docblock. */
      fulfillmentStatus: 'unfulfilled' as const,
      paymentStatus: 'checkout_started' as const,
      /*
       * Always written, and `null` when there is no code (R1-08): a conditional spread omitted the
       * key on an update, so Payload kept the previous attempt's promotion.
       */
      promotion: cart.discount?.id ?? null,
      shippingAddress: address,
      shippingMethodCode: rate.id,
      shippingMethodLabel: rate.name,
      shippingEstimate: rate.estimate,
      shippingMinor: totals.shippingMinor,
      subtotalMinor: totals.subtotalMinor,
      taxCalculationId,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
    }

    const order = seen
      ? await payload.update({
          collection: 'orders',
          data: { ...data, stripeCheckoutSessionId: null },
          id: seen.id,
          overrideAccess: true,
          req,
        })
      : await payload.create({
          collection: 'orders',
          data: { ...data, orderNumber: formatOrderNumber(new Date(), randomBytes(6)) },
          overrideAccess: true,
          req,
        })

    /*
     * The snapshot is rewritten from scratch on every attempt rather than diffed: a bag can change
     * between attempts, and deleting and rewriting has no edge cases. These rows exist only for this
     * order.
     */
    const { docs: staleLines } = await payload.find({
      collection: 'order-items',
      depth: 0,
      limit: 500,
      overrideAccess: true,
      pagination: false,
      req,
      where: { order: { equals: order.id } },
    })

    for (const line of staleLines) {
      await payload.delete({ collection: 'order-items', id: line.id, overrideAccess: true, req })
    }

    for (const line of cart.lines) {
      const unitPriceMinor = line.unitPriceMinor ?? 0

      await payload.create({
        collection: 'order-items',
        data: {
          /* Stored, not recomputed — `OrderItems.ts` says so. */
          lineTotalMinor: unitPriceMinor * line.effectiveQuantity,
          order: order.id,
          product: line.productId,
          productName: line.productName,
          quantity: line.effectiveQuantity,
          /* A withdrawn variant has no SKU to read; the snapshot records that rather than inventing one. */
          sku: line.sku ?? 'UNKNOWN',
          unitPriceMinor,
          variant: line.variantId,
          variantLabel: [line.color, line.size].filter(Boolean).join(' / ') || '—',
        },
        overrideAccess: true,
        req,
      })
    }

    await payload.db.commitTransaction(transactionID)

    return { ok: true, orderId: order.id, preparedAt: order.updatedAt }
  } catch (error) {
    /* Payload may already have killed the transaction on a failed Local API call. */
    await payload.db.rollbackTransaction(transactionID).catch(() => undefined)

    throw error
  }
}

/**
 * **Record a new Checkout Session on the order it was made for — or refuse.**
 *
 * One statement. It matches only an order still exactly as this attempt's preflight left it:
 * `checkout_started`, no session recorded, and **the same `updated_at`** — so if a later attempt on
 * the same bag rewrote the order in between, this one loses, and the caller must expire the session
 * it created. Two attempts can therefore never both leave a payable session behind.
 *
 * Returns whether the session now belongs to the order.
 */
export async function claimOrderForSession(
  payload: Payload,
  input: { orderId: number; preparedAt: string; sessionId: string },
): Promise<boolean> {
  const claim = await payload.db.drizzle.execute(
    sql`UPDATE "orders"
        SET "payment_status" = 'pending_payment',
            "stripe_checkout_session_id" = ${input.sessionId}
        WHERE "id" = ${input.orderId}
          AND "payment_status" = 'checkout_started'
          AND "stripe_checkout_session_id" IS NULL
          AND "updated_at" = ${input.preparedAt}::timestamptz`,
  )

  return (claim.rowCount ?? 0) > 0
}
