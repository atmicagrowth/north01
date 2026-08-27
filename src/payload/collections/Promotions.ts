import type { CollectionConfig, NumberFieldSingleValidation } from 'payload'

import { isAdmin, isStaff } from '../access'
import { CURRENCY_OPTIONS, DEFAULT_CURRENCY, minorUnits } from '../fields/money'
import { normaliseCode } from '../fields/slug'

/**
 * Discount codes. Plan §6.1l lists the fields and ends with the sentence that governs everything
 * else about them: **"Server-side validation is mandatory."**
 *
 * Nothing in this table is a rule the browser may evaluate. Plan §15.1a enumerates the checks — the
 * code exists, is active, is inside its date window, has usage left, has per-customer usage left,
 * meets the minimum subtotal, matches the eligible products or collections, and matches the currency
 * — and plan §15.1b requires them to run again *"during checkout creation rather than trusting cart
 * state"*, because plan §15.1c's edge cases are all the same shape: the code was valid when the bag
 * was filled and is not valid now. These columns are the *inputs* to that validation. The validation
 * itself is **Phase 15**.
 *
 * ---
 *
 * **The code is normalised, so the unique index means something.** Plan §15.1c lists case
 * sensitivity and whitespace among the edge cases; both stop being edge cases once ` welcome10 ` and
 * `WELCOME10` are the same stored string. Trimmed and upper-cased before validation, so the index
 * compares what the customer will actually type.
 *
 * **`timesUsed` is a counter this phase does not increment.** It is the other half of `usageLimit`,
 * and Phase 17 is where it moves — inside the same transaction that finalises the order, for the
 * same reason inventory does (**D-06**, plan §17.1f). Incrementing it anywhere earlier means a code
 * consumed by an abandoned checkout.
 *
 * **Per-customer limits are not a counter.** `perCustomerLimit` is compared against a count of that
 * customer's paid orders carrying this promotion, which the `orders.promotion` relationship already
 * answers exactly. A second counter would be a duplicate of a fact the orders table owns — the §6
 * prompt's "without duplicating business data" — and would be wrong the first time an order was
 * refunded.
 *
 * **`combinable` is modelled and unused**, exactly as **DEV-08** records. Plan §15.1c defaults to one
 * code at a time and the plan outranks feature matrix §18's *"not combinable with conflicting
 * discount"*; the column exists so the rule is visible rather than implicit, and the cart carries a
 * single `promotion` relationship which makes stacking unrepresentable regardless.
 */
/**
 * A promotion's value lives in a different column depending on its type, and nothing in Payload ties
 * the two together: `admin.condition` decides whether a field is *rendered* and whether its value is
 * kept on save, but a percentage promotion with no percentage is still a valid document as far as the
 * field configs are concerned. Phase 15's calculation layer would then be handed a code whose discount
 * is `null` — plan §15.1a's *"server-side validation is mandatory"* applied to the promotion's own
 * shape rather than to the customer's use of it.
 *
 * So each value field validates against its sibling `type`. The pairing is checked on every save,
 * through every API, and a promotion that cannot compute a discount cannot be stored.
 */
const requiredForType =
  (type: string, message: string): NumberFieldSingleValidation =>
  (value, { siblingData }) => {
    if ((siblingData as { type?: unknown })?.type !== type) {
      return true
    }

    return value === null || value === undefined ? message : true
  }

export const Promotions: CollectionConfig = {
  slug: 'promotions',

  admin: {
    useAsTitle: 'code',
    defaultColumns: ['code', 'type', 'active', 'startsAt', 'endsAt', 'timesUsed'],
    group: 'Commerce',
    description:
      'Discount codes. Every rule here is evaluated on the server, never in the browser.',
  },

  /**
   * **Staff only, including read.** A discount code is not content: an open `GET /api/promotions`
   * hands every unreleased code, every threshold and every exclusion to anyone who asks, which is
   * both a margin leak and a live rehearsal of the checkout the codes are meant to gate.
   *
   * The storefront never reads this collection directly. Plan §15.1c requires a code to be validated
   * on the server against the real cart at the moment it is applied, which **Phase 15** does through
   * the Local API — past access control, and past the browser entirely. That is the same rule as
   * price and inventory: the browser is never authoritative.
   */
  access: {
    read: isStaff,
    create: isStaff,
    update: isStaff,
    delete: isAdmin,
  },

  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      maxLength: 32,
      admin: {
        description:
          'What the customer types. Stored upper-case and trimmed, so case and spacing cannot differ.',
      },
      hooks: { beforeValidate: [normaliseCode] },
      validate: (value: unknown) =>
        typeof value === 'string' && /^[A-Z0-9][A-Z0-9-]{1,31}$/.test(value)
          ? true
          : 'Letters, numbers and hyphens — at least two characters.',
    },
    {
      name: 'description',
      type: 'text',
      admin: { description: 'Internal note. Never shown to the customer.' },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'type',
          type: 'select',
          required: true,
          defaultValue: 'percentage',
          index: true,
          options: [
            { label: 'Percentage off', value: 'percentage' },
            { label: 'Fixed amount off', value: 'fixed' },
            { label: 'Free shipping', value: 'free_shipping' },
          ],
          admin: { width: '50%' },
        },
        {
          /**
           * A percentage for `percentage`, ignored for `free_shipping`, and unused for `fixed` —
           * which reads its amount from `valueMinor` below, because a discount in money is money and
           * has to obey the same minor-unit rule as every other amount in the schema. Two columns
           * rather than one polymorphic number: one of them is a percentage and one of them is
           * currency, and a single column would have to be interpreted differently depending on a
           * sibling field, which is how a 20%-off code becomes a $20-off code.
           */
          name: 'percentage',
          type: 'number',
          min: 1,
          max: 100,
          validate: requiredForType(
            'percentage',
            'A percentage discount needs a percentage between 1 and 100.',
          ),
          admin: {
            width: '50%',
            step: 1,
            condition: (_data, siblingData: { type?: unknown }) =>
              siblingData?.type === 'percentage',
            description:
              '1–100. Plan §15.1c: a percentage discount may never exceed the eligible subtotal.',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        minorUnits({
          name: 'valueMinor',
          label: 'Amount off',
          validate: requiredForType('fixed', 'A fixed discount needs an amount, in minor units.'),
          admin: {
            width: '50%',
            condition: (_data, siblingData: { type?: unknown }) => siblingData?.type === 'fixed',
          },
        }),
        {
          name: 'currency',
          type: 'select',
          defaultValue: DEFAULT_CURRENCY,
          options: [...CURRENCY_OPTIONS],
          admin: {
            width: '50%',
            condition: (_data, siblingData: { type?: unknown }) => siblingData?.type === 'fixed',
            description:
              'A fixed amount is only meaningful in one currency — plan §15.1a\'s "currency compatibility".',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'startsAt',
          type: 'date',
          index: true,
          admin: {
            width: '50%',
            date: { pickerAppearance: 'dayAndTime' },
            description: 'Empty means active immediately.',
          },
        },
        {
          name: 'endsAt',
          type: 'date',
          index: true,
          admin: {
            width: '50%',
            date: { pickerAppearance: 'dayAndTime' },
            description: 'Empty means no expiry.',
          },
        },
      ],
    },
    minorUnits({
      name: 'minimumSubtotalMinor',
      label: 'Minimum subtotal',
      admin: { description: 'Optional. Compared against the subtotal before shipping and tax.' },
    }),
    {
      type: 'row',
      fields: [
        {
          name: 'eligibleProducts',
          type: 'relationship',
          relationTo: 'products',
          hasMany: true,
          admin: {
            width: '50%',
            description: 'Optional. Leave both eligibility lists empty to apply to the whole bag.',
          },
        },
        {
          name: 'eligibleCollections',
          type: 'relationship',
          relationTo: 'collections',
          hasMany: true,
          admin: {
            width: '50%',
            description: 'Optional. Membership is resolved at validation time.',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'usageLimit',
          type: 'number',
          min: 1,
          admin: {
            width: '33%',
            step: 1,
            description: 'Total redemptions allowed. Empty means unlimited.',
          },
        },
        {
          name: 'perCustomerLimit',
          type: 'number',
          min: 1,
          admin: {
            width: '33%',
            step: 1,
            description: 'Counted from paid orders carrying this code, not from a stored tally.',
          },
        },
        {
          name: 'timesUsed',
          type: 'number',
          required: true,
          defaultValue: 0,
          min: 0,
          admin: {
            width: '33%',
            readOnly: true,
            step: 1,
            description: 'Incremented by Phase 17, in the transaction that finalises payment.',
          },
        },
      ],
    },
    {
      name: 'active',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      index: true,
      admin: {
        position: 'sidebar',
        description:
          'Off by default — a half-written promotion must not be live. This is the switch; the dates are the schedule.',
      },
    },
    {
      name: 'combinable',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description:
          'Modelled but unused: this demo allows one code per order (DEV-08). Kept so the rule is explicit.',
      },
    },
  ],
}
