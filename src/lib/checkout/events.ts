import type { Payload } from 'payload'

import { sql } from '@payloadcms/db-postgres'

import { STALE_RECEIVED_SECONDS } from './rules'

/**
 * **The `stripe-events` row's bookkeeping** — the delivery counter, and (Phase 36) the test for a
 * genuine duplicate and the atomic re-claim of a delivery that failed.
 *
 * In its own module, taking a `Payload` rather than reaching for one, so a harness can drive it. The
 * `server-only` guard belongs next door on `stripe.ts`, where the secret lives.
 *
 * Raw SQL because Payload's Local API has no expression update or conditional update.
 * `docs/DATABASE.md` allows it; what it forbids is hand-authored *migrations*.
 */

/**
 * The delivery counter. An expression, not a `read + 1`: two retries of one event can be in flight
 * at the same instant, and a read-then-write would have both write the same number.
 */
export async function countWebhookDelivery(payload: Payload, eventRowId: number): Promise<void> {
  await payload.db.drizzle.execute(
    sql`UPDATE "stripe_events" SET "attempts" = "attempts" + 1 WHERE "id" = ${eventRowId}`,
  )
}

/**
 * **Did this insert fail because the event id is already stored?** — Phase 36, audit R1-04.
 *
 * The route's `catch` around the insert used to answer *"Already processed"* for **any** error, so a
 * dropped connection or a pool timeout was acknowledged with a 200 and Stripe stopped retrying an
 * event that was never recorded, let alone processed. Only a unique violation is a duplicate:
 *
 * - SQLSTATE `23505`, on the error or its `cause` (node-postgres puts it on `code`);
 * - Payload's Postgres adapter, which turns that violation into a `ValidationError` naming the field
 *   — `eventId` here, and only `eventId`: a validation error about anything else is a real failure.
 *
 * The same shape `email/send.ts`'s `isDuplicateKey` reads, for the same reason.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const candidate = error as {
    cause?: { code?: unknown }
    code?: unknown
    data?: { errors?: { path?: unknown }[] }
    message?: unknown
    name?: unknown
  }

  if (candidate.code === '23505' || candidate.cause?.code === '23505') {
    return true
  }

  if (typeof candidate.message === 'string' && /duplicate key value/i.test(candidate.message)) {
    return true
  }

  return (
    candidate.name === 'ValidationError' &&
    Array.isArray(candidate.data?.errors) &&
    candidate.data.errors.some((issue) => issue?.path === 'eventId')
  )
}

/**
 * **Take a stored delivery back for reprocessing, if nobody else has** — Phase 36, audit R1-04.
 *
 * The predicate is `decideDuplicateDelivery`'s `reprocess` case — `failed`, or `received` and older
 * than {@link STALE_RECEIVED_SECONDS} — enforced in the `WHERE`, so two retries arriving together
 * cannot both win: the loser matches no row and is told to retry later. The winner's row goes back to
 * `received` with a fresh timestamp and a cleared error, so it is itself measured from now.
 *
 * Returns whether this caller holds the row.
 */
export async function reclaimWebhookDelivery(
  payload: Payload,
  eventRowId: number,
): Promise<boolean> {
  const result = await payload.db.drizzle.execute(
    sql`UPDATE "stripe_events"
        SET "status" = 'received',
            "attempts" = "attempts" + 1,
            "received_at" = now(),
            "error" = NULL
        WHERE "id" = ${eventRowId}
          AND (
            "status" = 'failed'
            OR (
              "status" = 'received'
              AND "received_at" < now() - make_interval(secs => ${STALE_RECEIVED_SECONDS})
            )
          )`,
  )

  return (result.rowCount ?? 0) > 0
}
