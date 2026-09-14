import 'server-only'

import { sql } from '@payloadcms/db-postgres'
import type { Payload, Where } from 'payload'

import type { PaymentStatus } from '@/lib/checkout/rules'

import { reportFailure } from '@/lib/observability/report'

/**
 * **The daily retention sweep** — plan §34.1c data minimisation, audit R1-27, and the owner's
 * retention decision of 2026-09-11.
 *
 * Two rules live here, and they live together on purpose: they are the only two places this shop
 * deletes personal data on a clock, and a reader deciding whether a promise in the privacy notice is
 * actually kept should not have to find them in two files.
 *
 * | What | Window | Clock it runs on |
 * |---|---|---|
 * | An `active` bag and its lines | 30 days (`Carts.expiresAt` = creation + 30 days) | `expiresAt` |
 * | An **unpaid order** with no fulfilment hold, its lines and the customer data on it | {@link UNPAID_ORDER_RETENTION_DAYS} days | `updatedAt` — see below |
 *
 * Both are bounded per run so one invocation stays well inside a function's time limit; a backlog
 * clears over successive days. Both run from the one cron entry — `GET /api/carts/sweep`, daily —
 * because the Hobby plan allows two cron entries and the email drain is the other. The route path is
 * historical and is deliberately not renamed: the `vercel.json` cron entry is what actually calls it,
 * and `docs/DEPLOYMENT.md` §7, `docs/COMMERCE.md` §3 and `docs/SECURITY.md` §4 name it. No
 * customer-facing text does — the privacy notice states the windows, not the route.
 */

/* -------------------------------------------------------------------------------------------------
 * Bags — plan §34.1c, audit R1-27
 * ---------------------------------------------------------------------------------------------- */

/**
 * **Expired bags are deleted.**
 *
 * `Carts.expiresAt` was added so that a sweep was possible, and no phase ever ran one: every visit
 * that put something in a bag left a row — and its lines — forever. An anonymous bag is still personal
 * data by association (it sits beside a cookie, a time and what someone considered buying), and
 * keeping it past the thirty days it can be used serves nobody.
 *
 * Only `active` bags past their expiry. A `converted` bag is the order's history and is not touched.
 * An order that pointed at a swept bag keeps its snapshot; the relationship clears (`Orders.ts`
 * already documents that the link lives "while that bag still exists"), and a Stripe Checkout
 * Session lives 31 minutes (`lib/checkout/session.ts`), far inside the thirty days.
 *
 * Deleting through Payload runs `Carts.beforeDelete`, which removes the lines first.
 */
export const CART_SWEEP_BATCH = 200

export async function sweepExpiredCarts(
  payload: Payload,
  now: Date = new Date(),
  batch: number = CART_SWEEP_BATCH,
): Promise<{ deleted: number; more: boolean }> {
  const expired = await payload.find({
    collection: 'carts',
    depth: 0,
    limit: batch,
    overrideAccess: true,
    select: {},
    sort: 'expiresAt',
    where: {
      and: [{ status: { equals: 'active' } }, { expiresAt: { less_than: now.toISOString() } }],
    },
  })

  const ids = expired.docs.map((cart) => cart.id)

  if (ids.length === 0) return { deleted: 0, more: false }

  const result = await payload.delete({
    collection: 'carts',
    overrideAccess: true,
    where: { id: { in: ids } },
  })

  if (result.errors.length > 0) {
    payload.logger.error({
      errors: result.errors.length,
      msg: 'Cart sweep: some bags were not deleted',
    })

    reportFailure(new Error('Cart sweep: some bags were not deleted'), 'retention.carts', {
      errors: result.errors.length,
      selected: ids.length,
    })
  }

  return { deleted: result.docs.length, more: ids.length === batch }
}

/* -------------------------------------------------------------------------------------------------
 * Unpaid orders — the owner's decision of 2026-09-11
 * ---------------------------------------------------------------------------------------------- */

/**
 * **An order that was never paid for is deleted after thirty days, and the customer data on it goes
 * with it.**
 *
 * The owner decided this on 2026-09-11; `docs/SECURITY.md` §4 recorded it as an open question until
 * then, because it is a legal decision rather than a technical one. A paid order is a financial
 * record and is kept indefinitely — tax law, not preference. An abandoned checkout is not a financial
 * record of anything: it is an email address, a delivery address and a name, held because somebody
 * started buying something and stopped.
 *
 * Thirty days matches the bag window above, which is the same promise about the same visit.
 */
export const UNPAID_ORDER_RETENTION_DAYS = 30

/** Bounded like the bag sweep, and for the same reason. */
export const UNPAID_ORDER_SWEEP_BATCH = 200

/**
 * **The statuses in which this application has recorded no payment**, spelled as an exhaustive map
 * rather than a list.
 *
 * `Record<Exclude<PaymentStatus, 'paid' | 'refunded'>, true>` is doing real work in both directions:
 *
 * - **`paid` and `refunded` cannot be added**, by anybody, ever — they are excluded from the key
 *   type, so writing either here is a compile error rather than a very expensive Tuesday.
 * - **A new payment status cannot be forgotten.** Add one to the union in `lib/checkout/rules.ts` and
 *   this object stops compiling until somebody decides whether it means "never paid".
 *
 * The five that remain are the unpaid states of §17.1c's machine. `draft` never reached preflight;
 * `checkout_started` and `pending_payment` were sent to Stripe and never came back paid;
 * `payment_failed` and `cancelled` are the two ways that ends. The machine guarantees an order that
 * was ever *recorded* paid can never arrive in any of these five: `paid` has exactly one outgoing
 * edge, to `refunded`.
 *
 * **The status alone is not "no money moved", though**, and the sweep does not treat it as such. A
 * signed payment that did not match its order (`fulfil.ts`, Phase 36 sweep 1) leaves the status
 * exactly where it was and sets `fulfilmentHold: paymentMismatch` instead — the money may have been
 * taken. That is why {@link unpaidOrderRetentionWhere} also requires no hold.
 */
const NEVER_PAID: Record<Exclude<PaymentStatus, 'paid' | 'refunded'>, true> = {
  cancelled: true,
  checkout_started: true,
  draft: true,
  payment_failed: true,
  pending_payment: true,
}

export const NEVER_PAID_STATUSES = Object.keys(NEVER_PAID) as Exclude<
  PaymentStatus,
  'paid' | 'refunded'
>[]

/**
 * **Which orders the retention promise covers — the whole predicate, in one place.**
 *
 * The sweep's read and its delete both use this, so the row that is deleted is always a row that
 * still qualifies at the moment of deletion (see {@link sweepUnpaidOrders}). Three clauses, all
 * required:
 *
 * 1. **An unpaid status** — {@link NEVER_PAID_STATUSES}.
 * 2. **`updatedAt` older than the window**, measured back from the clock the caller passes.
 * 3. **No fulfilment hold.** The sweep never deletes a held order, however old it is. Nobody can clear
 *    a hold (`fulfilmentHold` is `update: nobodyField`), so a held order stays until an admin
 *    permanently deletes it after resolving the payment in Stripe.
 *    `paymentMismatch` is the one that matters — captured money that the order's status does not
 *    show, and whose only in-app record is this order and the `stripe-events` rows pointing at it;
 *    deleting it would clear those links and leave exactly the failure this sweep is designed
 *    around. The column is **nullable** (`Orders.fulfilmentHold` is not `required`, and "no hold" is
 *    `none` or empty), so "no hold" is spelled positively, `equals: 'none' OR exists: false`, and
 *    both halves are measured against real rows (`verify:orders` M). Not `not_equals`, for two
 *    reasons: it would name the holds to exclude rather than the one state that may be deleted, so a
 *    new hold value would be swept by default; and its NULL handling is the adapter's choice, not
 *    SQL's — a bare `<> 'paymentMismatch'` is NULL, not true, for an empty column. (Payload 3.88's
 *    Postgres adapter does add `IS NULL OR` to `not_equals` — `@payloadcms/drizzle`
 *    `queries/parseParams.js` — which the retention review measured; the positive spelling does not
 *    depend on it.) Every hold is excluded, not only `paymentMismatch`: a hold is by definition a
 *    question for a person, and the retention clock is not an answer to it.
 */
export function unpaidOrderRetentionWhere(now: Date): { and: Where[] } {
  const cutoff = new Date(now.getTime() - UNPAID_ORDER_RETENTION_DAYS * 24 * 60 * 60 * 1000)

  return {
    and: [
      { paymentStatus: { in: NEVER_PAID_STATUSES } },
      { updatedAt: { less_than: cutoff.toISOString() } },
      { or: [{ fulfilmentHold: { equals: 'none' } }, { fulfilmentHold: { exists: false } }] },
    ],
  }
}

type TxHandle = { execute: (query: unknown) => Promise<unknown> }

/**
 * **Deletes unpaid, unheld orders that have sat untouched for {@link UNPAID_ORDER_RETENTION_DAYS}
 * days.**
 *
 * ### Why `updatedAt` and not `createdAt`
 *
 * Because an order is **reused**. `REUSABLE_ORDER_STATUSES` lets a customer who comes back to a bag
 * check out again against the order the first attempt created, so a row created ninety days ago can
 * have a Stripe Checkout Session opened against it one minute ago. On `createdAt` this sweep would
 * delete that order while its customer was on Stripe's payment page — and the payment would then
 * land, signed, against an order that no longer exists. That is the one failure mode worth designing
 * around: money taken with no record of what it was for.
 *
 * ### `updatedAt` is every write to the order — and that had to be made true
 *
 * Payload stamps `updatedAt` on every Local API write. The checkout's **claims** are not Local API
 * writes: they are conditional raw-SQL `UPDATE`s (Payload has no conditional update), and until the
 * retention review none of them touched `updated_at` — so a session being recorded, a delayed bank
 * payment moving the order to `pending_payment`, an expiry, a refund or a payment-mismatch hold all
 * left the clock at the preflight write. Every raw `UPDATE "orders"` in `lib/checkout/pending-order.ts`
 * and `lib/checkout/fulfil.ts` now sets `"updated_at" = now()` (`verify:webhook` T and
 * `verify:checkout` G2 prove it against the real database), so the window really is *thirty days in
 * which nothing at all happened to this order*.
 *
 * What that buys, concretely:
 *
 * - **A live session** lives 31 minutes (`lib/checkout/session.ts`), and recording it is a write.
 * - **A delayed bank payment** (ACH, SEPA, Bacs — the session sets no `payment_method_types`, so the
 *   Dashboard's dynamic payment methods apply) is `checkout.session.completed` with
 *   `payment_status: unpaid`, which claims the order into `pending_payment` and restarts the clock.
 *   Its `async_payment_succeeded` / `_failed` follows within the method's settlement time — days for
 *   ACH and Bacs, up to about three weeks for SEPA. **A method with a longer payment window** (a
 *   voucher or bank-transfer method that stays payable for weeks) is not covered by that margin, and
 *   enabling one in the Dashboard means revisiting this window (`docs/DEPLOYMENT.md` §7).
 * - **What is left** is an event that arrives more than thirty days after the order's last write — a
 *   webhook outage recovered late, or an event resent by hand from the Dashboard. The webhook no
 *   longer calls that "no order reference": it records `ORDER MISSING`, logs it and reports
 *   `stripe.webhook.orderMissing` (`app/(frontend)/api/stripe/webhook/route.ts`), so a person
 *   reconciles it in Stripe.
 *
 * A pending order with a session is deliberately **not** exempted. Its `expired` event may never have
 * been processed, and exempting it would keep that customer's name and address forever.
 *
 * `updatedAt >= createdAt` always, so the only direction this errs is *keeping* an order longer.
 * Both columns are indexed (Payload indexes them for every collection), so either would have served
 * the query equally well; this is a correctness choice, not a performance one.
 *
 * ### Why the delete re-checks, under a lock
 *
 * The read and the delete are separate statements, and a webhook can pay or hold an order between
 * them. So the delete runs in its own transaction that first takes `SELECT … FOR UPDATE` on the
 * selected rows (in id order, so two overlapping sweeps cannot deadlock), and then deletes with
 * {@link unpaidOrderRetentionWhere} **re-applied** alongside the ids. Under the lock nothing can
 * change those rows until the commit, and Payload's delete reads the rows it will remove inside the
 * same transaction — so an order paid, held or touched before the lock was granted no longer
 * matches and is left alone, and a payment that arrives after it waits for the commit, finds no row,
 * and is reported as `orderMissing` by the webhook rather than lost.
 *
 * ### Why `trash: true`, which is the opposite of what it reads like
 *
 * It does **not** mean "soft delete". Payload's own words for the delete operation are *"permanently
 * delete both normal and trashed documents"*, against `trash: false`'s *"only normal (non-trashed)
 * documents will be permanently deleted"* — both are permanent; the flag only decides whether rows
 * already in the trash are included (`appendNonTrashedFilter` adds `deletedAt exists: false` only when
 * `trash` is false). `docs/DATABASE.md` §8 records this as a trap that has cost this project a
 * debugging cycle before.
 *
 * So `trash: false` would leave one category behind forever: an unpaid order somebody moved to the
 * trash in the admin panel, which still holds the name, email and address in full. A retention
 * promise that exempts the rows a person tried hardest to get rid of is not a retention promise, so
 * the find and the delete both carry `trash: true`.
 *
 * Deleting through Payload runs `Orders.beforeDelete`, which removes the order's lines first — itself
 * with `includeTrashed: true`, so a trashed line cannot outlive the order and strand an
 * unattributable purchase record. Everything else that points at an order — `email-messages.order`,
 * `stripe-events.order` — is nullable and clears to null, which is why the outbox still needs a
 * decision of its own (`docs/SECURITY.md` §4).
 *
 * Oldest first, so a backlog clears in the order it accumulated. `deleted` is what Payload's delete
 * reports it removed, which is fewer than was selected when a row stopped qualifying or failed.
 */
export async function sweepUnpaidOrders(
  payload: Payload,
  now: Date = new Date(),
  batch: number = UNPAID_ORDER_SWEEP_BATCH,
): Promise<{ deleted: number; more: boolean }> {
  const retention = unpaidOrderRetentionWhere(now)

  const abandoned = await payload.find({
    collection: 'orders',
    depth: 0,
    limit: batch,
    overrideAccess: true,
    select: {},
    sort: 'updatedAt',
    trash: true,
    where: retention,
  })

  const ids = abandoned.docs.map((order) => order.id)

  if (ids.length === 0) return { deleted: 0, more: false }

  const transactionID = await payload.db.beginTransaction()

  if (transactionID === null) {
    throw new Error('Could not begin a transaction for the unpaid-order sweep.')
  }

  let result: Awaited<ReturnType<typeof deleteQualifying>>

  try {
    const tx = (payload.db as unknown as { sessions?: Record<string, { db: TxHandle }> })
      .sessions?.[String(transactionID)]?.db

    if (!tx) {
      throw new Error('The unpaid-order sweep’s transaction session was not available.')
    }

    await tx.execute(
      sql`SELECT "id" FROM "orders"
          WHERE "id" IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})
          ORDER BY "id"
          FOR UPDATE`,
    )

    result = await deleteQualifying(payload, transactionID, ids, retention)

    await payload.db.commitTransaction(transactionID)
  } catch (error) {
    /* Payload may already have ended the transaction on a failed Local API call. */
    await payload.db.rollbackTransaction(transactionID).catch(() => undefined)

    throw error
  }

  if (result.errors.length > 0) {
    payload.logger.error({
      errors: result.errors.length,
      msg: 'Retention sweep: some unpaid orders were not deleted',
    })

    reportFailure(
      new Error('Retention sweep: some unpaid orders were not deleted'),
      'retention.orders',
      { errors: result.errors.length, selected: ids.length },
    )
  }

  return { deleted: result.docs.length, more: ids.length === batch }
}

/** The selected ids, **and** the whole predicate again — see "Why the delete re-checks". */
function deleteQualifying(
  payload: Payload,
  transactionID: number | string,
  ids: (number | string)[],
  retention: { and: Where[] },
) {
  return payload.delete({
    collection: 'orders',
    depth: 0,
    overrideAccess: true,
    req: { transactionID } as Parameters<typeof payload.find>[0]['req'],
    trash: true,
    where: { and: [{ id: { in: ids } }, ...retention.and] },
  })
}

/* -------------------------------------------------------------------------------------------------
 * The one run the cron makes
 * ---------------------------------------------------------------------------------------------- */

export type SweepOutcome = {
  deleted: number
  /** True when the step threw. The count is then what was deleted before it did, which is none. */
  failed: boolean
  /** True when the batch was full, so more rows are waiting for tomorrow. */
  more: boolean
}

/**
 * **Both rules, one request, neither able to stop the other.**
 *
 * The two sweeps are independent, so a failure in one must not skip the other — which is what a bare
 * `await` of both would do, and it would be the bag sweep silently taking the order sweep down with
 * it for as long as nobody read the logs. Each step is therefore caught on its own: logged, reported
 * to Sentry through `reportFailure` (`AGENTS.md`'s handled failures reach Sentry as well as the log),
 * and reported in the response as `failed` so the cron's own log line says which half ran.
 *
 * A failed step reports `more: true`. It is honest — rows it was meant to delete are still there —
 * and it keeps "the sweep is behind" and "the sweep is broken" from looking identical to a reader.
 */
export async function sweepRetention(
  payload: Payload,
  now: Date = new Date(),
): Promise<{ carts: SweepOutcome; orders: SweepOutcome }> {
  return {
    carts: await runStep(payload, 'carts', () => sweepExpiredCarts(payload, now)),
    orders: await runStep(payload, 'orders', () => sweepUnpaidOrders(payload, now)),
  }
}

async function runStep(
  payload: Payload,
  step: 'carts' | 'orders',
  run: () => Promise<{ deleted: number; more: boolean }>,
): Promise<SweepOutcome> {
  try {
    const { deleted, more } = await run()

    payload.logger.info({ deleted, more, msg: `Retention sweep: ${step}`, step })

    return { deleted, failed: false, more }
  } catch (error) {
    payload.logger.error({ err: error, msg: `Retention sweep failed: ${step}`, step })
    reportFailure(error, `retention.${step}`)

    return { deleted: 0, failed: true, more: true }
  }
}
