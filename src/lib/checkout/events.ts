import type { Payload } from 'payload'

import { sql } from '@payloadcms/db-postgres'

/**
 * **The `stripe-events` row's delivery counter.**
 *
 * One statement, in its own module, for two reasons that both come from earlier phases:
 *
 * 1. **It is an expression, not a `read + 1`.** Stripe retries after network failures, timeouts and
 *    deploys, and two retries of one event can be in flight at the same instant — the first barrier
 *    refuses both, and both then land here. A read-then-write has both read the same count and both
 *    write the same number, so the column silently under-reports how hard Stripe tried. The cost is
 *    only a wrong number in an operational column rather than money, which is exactly why it is worth
 *    fixing: the shape is what should be consistent, not the stakes.
 * 2. **It takes a `Payload` rather than reaching for one**, so a harness can drive it. Three phases
 *    have now produced that rule — a guard belongs where a secret or a request could leak, and the
 *    secret lives next door in `stripe.ts`, not here.
 *
 * Raw SQL because Payload's Local API has no expression update. `docs/DATABASE.md` allows it; what it
 * forbids is hand-authored *migrations*.
 */
export async function countWebhookDelivery(payload: Payload, eventRowId: number): Promise<void> {
  await payload.db.drizzle.execute(
    sql`UPDATE "stripe_events" SET "attempts" = "attempts" + 1 WHERE "id" = ${eventRowId}`,
  )
}
