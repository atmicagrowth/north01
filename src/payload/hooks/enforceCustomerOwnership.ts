import type { CollectionBeforeValidateHook } from 'payload'

import { activeCustomer } from '../access'

/**
 * **The other half of `isActiveCustomer`.** Access control can say *who* may create a row; it cannot
 * say *whose* the row is.
 *
 * `POST /api/addresses` with `{ customer: 42, … }` passes an access rule that only asks "is this an
 * active customer", and writes a saved address into somebody else's address book. Payload has no
 * field-level answer to that either: denying `create` on the `customer` field **removes** the field
 * from the incoming data, and the column is `required`, so the write would fail for every customer
 * rather than only for the dishonest one.
 *
 * So the value is *forced* rather than validated. A customer's own id is the only ownership a
 * customer-authenticated request can express, on create and on update alike — reassigning an
 * existing row to another account is the same attack arriving a second later.
 *
 * Staff are left alone: an admin correcting which account an address belongs to is a legitimate
 * support action, and `req.user` is a staff account in exactly that case. Server code with no user
 * on the request — the seed, the checkout, the Stripe webhook — is left alone for the same reason.
 *
 * `beforeValidate` rather than `beforeChange` so the forced value is present when `required` is
 * checked, and so a hook further down the chain sees the corrected document rather than the
 * submitted one.
 */
export const enforceCustomerOwnership =
  (fieldName: string): CollectionBeforeValidateHook =>
  ({ data, req }) => {
    const customer = activeCustomer(req.user)

    if (!customer || !data) {
      return data
    }

    return { ...data, [fieldName]: customer.id }
  }
