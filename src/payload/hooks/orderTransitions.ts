import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'

import { sql } from '@payloadcms/db-postgres'
import { ValidationError } from 'payload'

import type { PaymentStatus } from '@/lib/checkout/rules'
import type { FulfillmentStatus } from '@/lib/orders/rules'

import { FULFILLMENT_COPY, planFulfillmentChange } from '@/lib/orders/rules'

/**
 * **Plan §18.1b: *"Do not let arbitrary transitions happen from the admin UI."***
 *
 * The rules live in `lib/orders/rules.ts`, where a harness can reach them. This is the enforcement,
 * and it sits in a `beforeChange` hook rather than in field access or in the admin UI for one reason:
 * **a hook runs on every path.** Field access is skipped by `overrideAccess: true`, and an admin
 * component is a suggestion a `PATCH` can ignore. A transition rule that only the panel obeys is not a
 * rule about the order, it is a rule about one form.
 *
 * ### What it does not do
 *
 * It does not authorise. §18.1c's *"server-side authorization is required"* is `Orders.access.update`,
 * which is `isStaff`, and it has already run by the time a hook sees the write. This decides whether
 * the *transition* is legal, which is a different question from who is asking — and both have to be
 * answered, because a correctly authorised editor can still click Delivered on an order that was never
 * dispatched.
 *
 * It also does not touch `paymentStatus`. That axis belongs to Phase 17's webhook and is closed to the
 * browser by `nobodyField` on the field itself.
 *
 * ### Which paths it covers, verified rather than assumed — Phase 28
 *
 * §28.1d asks that the admin UI must not permit arbitrary order status transitions, so *"a hook runs
 * on every path"* was worth checking against the framework rather than repeating. It holds, and the
 * bulk case is the one that could plausibly have been an exception:
 *
 * | Path | Runs this hook? | Why |
 * |---|---|---|
 * | Admin single save, REST `PATCH /api/orders/:id` | yes | `updateByIDOperation` → `updateDocument` |
 * | **Payload bulk edit**, REST `PATCH /api/orders?where=…` | **yes** | `collections/operations/update.js` maps over the matched docs and calls the same `updateDocument` per document — *"runs all document level hooks"*, in its own comment. There is no batch path that skips it. |
 * | Local API, including the Stripe webhook | yes | same operations; `overrideAccess` skips *access*, never hooks |
 *
 * The gap Phase 28 did find was not enforcement but **legibility on the bulk path**, and it is a
 * framework property this hook cannot fix from here: the bulk endpoint catches each document's error
 * and returns a summary — *"Unable to update 18 out of 30 Orders"* — and the admin's `Form` toasts
 * that summary and returns before it ever looks at the per-document reasons. The refusals below are
 * produced correctly and then discarded by the transport.
 *
 * So the fix is in `Orders.ts`, not here: `admin.disableBulkEdit` on `fulfillmentStatus`, `carrier`,
 * `trackingNumber` and `trackingUrl` removes them from the bulk-edit field picker entirely, which is
 * independently right — a dispatch is per parcel, and a mixed selection half-applies, mailing the
 * orders that pass and silently leaving the rest. What remains here is `label`, below, so that the
 * sentence a REST caller does get names a field rather than a column.
 *
 * ### Restocking is deliberately absent
 *
 * Cancelling an order does not return its units to inventory. Phase 17 moves stock **only** at
 * confirmed payment, so an unpaid cancellation has nothing to return; and a *paid* cancellation is a
 * refund, which is a decision with money attached and belongs with the refund path rather than as a
 * silent side effect of a select box. Recorded rather than forgotten — see §1.23.
 */
export const enforceOrderTransitions: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  /*
   * Creates are not transitions. `Orders.access.create` is `nobody`, so the only creator is Phase
   * 17's preflight, and it writes `unfulfilled` — the state every order starts in by `defaultValue`.
   */
  if (operation !== 'update' || !originalDoc) {
    return data
  }

  const to = data.fulfillmentStatus as FulfillmentStatus | undefined

  /*
   * A write that does not carry the column is not a transition. The unchanged case is settled below,
   * against the locked row rather than against the possibly-stale document Payload read for us.
   */
  if (to === undefined) {
    return data
  }

  const live = await lockOrder(req, Number(originalDoc.id))
  const from = (live?.fulfillment_status ?? originalDoc.fulfillmentStatus) as FulfillmentStatus
  const payment = (live?.payment_status ?? originalDoc.paymentStatus) as PaymentStatus

  /*
   * The admin panel posts the **whole document** on every save, so an unchanged `fulfillmentStatus`
   * arrives on every write. Treating that as a refusal would make an order unsaveable the moment it
   * reached a terminal state — including saving a tracking number onto a delivered order, which is an
   * ordinary correction.
   */
  if (to === from) {
    return data
  }

  /*
   * `in` rather than `??`, because a write that *clears* the carrier sends `null` and `??` would read
   * straight past it to the value being cleared — letting one write dispatch an order and remove the
   * carrier it was dispatched with. What the write says wins, including when what it says is nothing.
   */
  const proposed = (field: string, current: unknown) => text(field in data ? data[field] : current)

  const plan = planFulfillmentChange({
    carrier: proposed('carrier', live?.carrier ?? originalDoc.carrier),
    from,
    now: new Date(),
    payment,
    to,
    trackingNumber: proposed('trackingNumber', live?.tracking_number ?? originalDoc.trackingNumber),
  })

  if (!plan.ok) {
    /*
     * **A `ValidationError` rather than an `APIError`, and the difference is where the sentence lands.**
     *
     * `formatErrors` gives a `ValidationError` its own `data.errors` array, and the admin's `Form`
     * feeds every entry carrying a `path` to `ADD_SERVER_ERRORS` — so `FULFILLMENT_COPY` renders
     * *underneath the Fulfilment status select*, in the tab, next to the carrier and tracking fields it
     * is usually talking about. An `APIError` would produce a cleaner toast and attach to nothing,
     * which is worse: the editor has to carry the sentence back to the field themselves.
     *
     * `label` is what Payload composes the outer message from — without it that message ends in the
     * raw column name, `fulfillmentStatus`. It is the only part of the error that survives the bulk
     * endpoint's per-document `error.message`, so it is written as something a person reads.
     */
    throw new ValidationError({
      collection: 'orders',
      errors: [
        {
          label: 'Fulfilment status',
          message: FULFILLMENT_COPY[plan.reason],
          path: 'fulfillmentStatus',
        },
      ],
      req,
    })
  }

  /*
   * §18.1c's timestamps, written by the transition rather than typed beside it. A `shippedAt` a person
   * can set independently of `fulfillmentStatus` is a date that will eventually disagree with it.
   */
  if (plan.stamps.shippedAt !== null) {
    data.shippedAt = plan.stamps.shippedAt
  }

  if (plan.stamps.deliveredAt !== null) {
    data.deliveredAt = plan.stamps.deliveredAt
  }

  return data
}

type LiveOrder = {
  carrier: null | string
  fulfillment_status: string
  payment_status: string
  tracking_number: null | string
}

/**
 * **The row as it is *now*, locked until this write commits.**
 *
 * Phase 18's first sweep demonstrated why the hook cannot decide from `originalDoc`. Two staff, two
 * requests, two transactions, both reading `processing` before either wrote:
 *
 * ```
 * both read: processing / processing
 * ship:   ok      (carrier, tracking number and shippedAt written)
 * cancel: ok      ← the machine says shipped → cancelled is impossible
 * final:  cancelled, shippedAt = null
 * ```
 *
 * The transition was checked against a value that stopped being true between the read and the write —
 * the same shape as Phase 17's two sweeps, on the axis Phase 18 introduced, and worse than it looks:
 * the second write also carried the *rest* of its stale document, so the carrier, the tracking number
 * and the dispatch timestamp were all wiped. By §18.1c a shipment email had already been triggered.
 *
 * `SELECT … FOR UPDATE` closes it. The second transaction blocks on the row until the first commits,
 * then reads `shipped` and is refused by the same rule that always applied — no new rule, just one
 * that is now asked about the state the row is actually in.
 *
 * **A lock rather than a conditional `UPDATE`**, which is what `fulfil.ts` uses for the payment axis:
 * this write goes through Payload rather than raw SQL, because it has to pass validation, run the
 * remaining hooks and produce a document the admin panel can render. A lock is the version of the same
 * guarantee that works when something else does the writing.
 *
 * Returns `null` when there is no transaction to hold a lock in, and the hook then falls back to
 * `originalDoc` — the pre-sweep behaviour, which is still correct for everything except a race. Every
 * Payload write on this adapter runs in a transaction, so that path is a safety net rather than a
 * plan.
 */
async function lockOrder(req: PayloadRequest, id: number): Promise<LiveOrder | null> {
  const transactionID = req?.transactionID

  if (transactionID === undefined || transactionID === null) {
    return null
  }

  const session = (
    req.payload.db as unknown as {
      sessions?: Record<
        string,
        { db: { execute: (query: unknown) => Promise<{ rows?: unknown[] }> } }
      >
    }
  ).sessions?.[String(transactionID)]

  if (!session) {
    return null
  }

  const result = await session.db.execute(
    sql`SELECT "carrier", "fulfillment_status", "payment_status", "tracking_number"
        FROM "orders"
        WHERE "id" = ${id}
        FOR UPDATE`,
  )

  return (result.rows?.[0] as LiveOrder | undefined) ?? null
}

function text(value: unknown): null | string {
  return typeof value === 'string' ? value : null
}
