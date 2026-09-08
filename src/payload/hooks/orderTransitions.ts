import type { CollectionBeforeChangeHook } from 'payload'

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
 * ### Restocking is deliberately absent
 *
 * Cancelling an order does not return its units to inventory. Phase 17 moves stock **only** at
 * confirmed payment, so an unpaid cancellation has nothing to return; and a *paid* cancellation is a
 * refund, which is a decision with money attached and belongs with the refund path rather than as a
 * silent side effect of a select box. Recorded rather than forgotten — see §1.23.
 */
export const enforceOrderTransitions: CollectionBeforeChangeHook = ({
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

  const from = originalDoc.fulfillmentStatus as FulfillmentStatus
  const to = data.fulfillmentStatus as FulfillmentStatus | undefined

  /*
   * A write that does not carry the column, or carries the value it already has, is not a transition.
   * The admin panel posts the **whole document** on every save, so treating an unchanged value as a
   * refusal would make an order unsaveable the moment it reached a terminal state — including saving
   * a tracking number onto a delivered order, which is an ordinary correction.
   */
  if (to === undefined || to === from) {
    return data
  }

  const plan = planFulfillmentChange({
    carrier: text(data.carrier ?? originalDoc.carrier),
    from,
    now: new Date(),
    payment: originalDoc.paymentStatus as PaymentStatus,
    to,
    trackingNumber: text(data.trackingNumber ?? originalDoc.trackingNumber),
  })

  if (!plan.ok) {
    throw new ValidationError({
      collection: 'orders',
      errors: [{ message: FULFILLMENT_COPY[plan.reason], path: 'fulfillmentStatus' }],
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

function text(value: unknown): null | string {
  return typeof value === 'string' ? value : null
}
