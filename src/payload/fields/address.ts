import type { Field, TextFieldSingleValidation } from 'payload'

import { ADDRESS_MAX_LENGTH } from '../../lib/address-limits'

/**
 * A postal address, defined once and used in two structurally different ways.
 *
 * - As the fields of the `addresses` collection — a customer's saved address book, which they edit.
 *   Gap **G-01**: `/account/addresses` is a route in the structure document §16, customer access
 *   rules in plan §7.1b govern it, and plan §6.1k needs it for order snapshots, yet the entity
 *   appears in neither the plan's entity list §2.2 nor Phase 6. Recorded in **DEV-10**.
 * - As a `group` on an order — a **snapshot**, frozen at purchase. Plan §6.1k asks for "shipping
 *   address snapshot" and "billing address snapshot" in exactly those words.
 *
 * **Why the order does not simply point at the saved address.** Because "Orders are snapshots"
 * (`docs/ARCHITECTURE.md` §2, plan §18.1d): a customer who moves house and edits their saved address
 * must not retroactively change where a parcel was sent two years ago. A relationship would do
 * precisely that, and `ON DELETE SET NULL` would do something worse — deleting a saved address would
 * silently empty the shipping address of every past order that referenced it. The duplication is the
 * feature, and it is duplication of a *historical fact*, not of business data that has one owner.
 *
 * **No country-specific structure.** `region` covers a US state, a UK county and a French
 * département, and `postalCode` covers formats that agree on nothing. Validating either against the
 * country is a real problem with a real answer — the address validation in Stripe Checkout, which
 * Phase 17 puts in the path of every order that matters. Inventing a second, weaker validator here
 * would only disagree with it.
 *
 * `country` is ISO 3166-1 alpha-2, uppercase, because that is what Stripe and every shipping
 * calculation will expect. The two-letter constraint is enforced; the *list* is not, because the
 * set of countries this store ships to is a shipping-provider question (plan §16.1b) and not a
 * property of an address.
 *
 * ---
 *
 * ### Why `required` is a parameter, and why an order's copy is not required
 *
 * A saved address is required to be complete — a half-typed one in an address book is useless. An
 * order's snapshot is not, and making it so was a real defect: plan §18.1a creates a **pending order
 * before or at checkout creation**, which is before the customer has typed an address, so required
 * sub-fields make a draft order impossible to save at all. Found by running it: creating an order
 * with no address failed on twelve validation errors at once.
 *
 * Payload has no "required only when the group has any data" — a `required` sub-field is required on
 * every save — so the requirement moves to where the corpus already puts it: checkout preflight
 * (plan §17.1a, and **DEV-11**, which adds shipping-address validation to it precisely because
 * shipping and tax cannot be computed without one). A schema-level `required` here would enforce the
 * rule at the wrong moment and block the state the plan asks for.
 */
type AddressOptions = {
  /**
   * `true` for the address book, where an incomplete row is meaningless. `false` for an order
   * snapshot, which begins empty and is filled by checkout.
   */
  required: boolean
}

/*
 * Plan §34 (audit R1-24): every free-text line has a domain-sized `maxLength` (`lib/address-limits.ts`) —
 * Payload's default is 40,000 characters a field. Validation only: Postgres stores these as unbounded `varchar`, so no
 * migration, and a too-long value is refused before it is written.
 */
export const addressFields = ({ required }: AddressOptions): Field[] => [
  {
    type: 'row',
    fields: [
      {
        name: 'firstName',
        type: 'text',
        maxLength: ADDRESS_MAX_LENGTH.firstName,
        required,
        admin: { width: '50%' },
      },
      {
        name: 'lastName',
        type: 'text',
        maxLength: ADDRESS_MAX_LENGTH.lastName,
        required,
        admin: { width: '50%' },
      },
    ],
  },
  {
    name: 'company',
    type: 'text',
    maxLength: ADDRESS_MAX_LENGTH.company,
    admin: { description: 'Optional.' },
  },
  {
    name: 'line1',
    type: 'text',
    maxLength: ADDRESS_MAX_LENGTH.line1,
    required,
    label: 'Address line 1',
  },
  {
    name: 'line2',
    type: 'text',
    maxLength: ADDRESS_MAX_LENGTH.line2,
    label: 'Address line 2',
    admin: { description: 'Optional. Apartment, suite, floor.' },
  },
  {
    type: 'row',
    fields: [
      {
        name: 'city',
        type: 'text',
        maxLength: ADDRESS_MAX_LENGTH.city,
        required,
        admin: { width: '50%' },
      },
      {
        name: 'region',
        type: 'text',
        maxLength: ADDRESS_MAX_LENGTH.region,
        label: 'State / province / county',
        admin: {
          width: '50%',
          description: 'Optional — many countries do not use one.',
        },
      },
    ],
  },
  {
    type: 'row',
    fields: [
      {
        name: 'postalCode',
        type: 'text',
        maxLength: ADDRESS_MAX_LENGTH.postalCode,
        required,
        admin: { width: '50%' },
      },
      {
        name: 'country',
        type: 'text',
        required,
        minLength: 2,
        maxLength: 2,
        admin: {
          width: '50%',
          description: 'ISO 3166-1 alpha-2 — GB, US, FR.',
        },
        hooks: {
          beforeValidate: [
            ({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
          ],
        },
        /**
         * Empty is accepted only when the field is optional — an order snapshot on a draft order
         * legitimately has none. When it is required, this has to say so itself: supplying a custom
         * `validate` replaces Payload's built-in one, which is what would otherwise enforce
         * `required`, `minLength` and `maxLength`. Without this branch a saved address could pass
         * validation with no country and fail on the `NOT NULL` column instead.
         */
        validate: ((value, { req: { t } }) =>
          value === null || value === undefined || value === ''
            ? required
              ? t('validation:required')
              : true
            : typeof value === 'string' && /^[A-Z]{2}$/.test(value)
              ? true
              : 'Two-letter ISO country code — GB, US, FR.') satisfies TextFieldSingleValidation,
      },
    ],
  },
  {
    name: 'phone',
    type: 'text',
    maxLength: ADDRESS_MAX_LENGTH.phone,
    admin: {
      description: 'Optional. Used by carriers for delivery contact.',
    },
  },
]
