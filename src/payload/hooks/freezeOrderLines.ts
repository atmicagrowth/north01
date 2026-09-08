import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import { frozenFieldsTouched } from '@/lib/orders/rules'

/**
 * **Plan §18.1d, enforced rather than described.**
 *
 * > *"Order item name/price/variant/SKU snapshots remain unchanged after a product is edited later."*
 *
 * Half of that was true from Phase 6: `OrderItems` stores the name, SKU, variant label and unit price
 * as **columns**, so editing a product cannot reach them — there is no read-through to break. That is
 * the half the plan is actually about, and it needs no hook.
 *
 * This is the other half. The columns being copies does not make them immutable; `Orders.access.update`
 * is `isStaff`, and a receipt line that staff can retype is a receipt that can be made to say anything.
 * Phase 17's second sweep found the identical door standing open on `paymentStatus` — a rule stated in
 * a docblock, and a select box that ignored it — so the lesson is applied here in the same phase rather
 * than waiting for a sweep to find it again.
 *
 * **A hook, not field access**, because field access is skipped for `overrideAccess: true` and these
 * four columns should not move for server code either. Nothing in this application writes them after
 * the checkout that created them, and a future thing that tries is a bug worth failing loudly.
 *
 * `quantity` and `lineTotalMinor` are **not** in the frozen set, and `lib/orders/rules.ts` explains
 * why: `OrderItems`' own docblock reserves them for a per-line partial refund. They are closed to the
 * browser by field access instead. The plan names four columns; this refuses exactly those four.
 */
export const freezeOrderLines: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (operation !== 'update' || !originalDoc) {
    return data
  }

  /*
   * Compared by value against the row as it stands, because the admin panel posts every field on every
   * save. A hook that could not tell a re-submission from an edit would make an order line unsaveable
   * — including the `product` and `variant` pointers beside them, which are ordinary navigation and
   * are meant to be correctable.
   */
  const touched = frozenFieldsTouched(originalDoc, data)

  if (touched.length > 0) {
    throw new ValidationError({
      collection: 'order-items',
      errors: touched.map((field) => ({
        message:
          'This is a snapshot of the purchase and does not change — plan §18.1d. Editing the ' +
          'product does not change it either, which is the point.',
        path: field,
      })),
      req,
    })
  }

  return data
}
