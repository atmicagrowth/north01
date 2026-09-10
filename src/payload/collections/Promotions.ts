import type { CollectionConfig, DateFieldValidation, NumberFieldSingleValidation } from 'payload'

import type { Promotion } from '@/payload-types'

import { toPromotionInput } from '@/lib/promotions/read'
import { type PromotionFailure, validatePromotion } from '@/lib/promotions/rules'

import { isAdmin, isStaff, nobodyField } from '../access'
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

/**
 * **A window that runs backwards is a promotion that is never live — Phase 28, §28.1d.**
 *
 * Nothing downstream breaks on `endsAt < startsAt`: §15.1a checks *"has it started"* and *"has it
 * ended"* as two independent gates, so an inverted window simply fails both, forever, silently. The
 * code sits in the list with `active` ticked, and the first anyone hears of it is a customer being
 * told their code is invalid.
 *
 * Refusing it at the point it is typed is the whole of the fix. It costs no column — a `validate` is
 * not a migration — and it is the difference between a mistake caught on Monday morning and one
 * discovered by a shopper.
 */
const validateEndsAfterStart: DateFieldValidation = (value, { siblingData }) => {
  const startsAt = (siblingData as { startsAt?: unknown })?.startsAt

  if (!value || !startsAt) {
    return true
  }

  const start = new Date(startsAt as Date | string).getTime()
  const end = new Date(value as Date | string).getTime()

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return true
  }

  return end > start
    ? true
    : 'The end must come after the start, or this code can never be live. Leave it empty for no expiry.'
}

/**
 * **"Is this code live right now?" — the question the columns could not answer.**
 *
 * `active`, `startsAt`, `endsAt` and `usageLimit` are four true facts that mean nothing until they
 * are combined in somebody's head. A code with `active` ticked and an `endsAt` of last Tuesday reads
 * as ON in the list and is OFF at the till; a code that has hit its usage limit reads the same way.
 * Both directions of that gap end in the same Monday morning question — *why isn't my code working*,
 * or the more expensive *why is this one still working* — and neither is answerable by looking.
 *
 * **Virtual, so it costs nothing.** `virtual: true` keeps it out of the database entirely: no column,
 * no migration, computed on read. Payload also refuses to sort a virtual column
 * (`buildColumnState` disables the header), which is the correct behaviour here — there is no
 * `live_now` to `ORDER BY`.
 *
 * **It reuses `validatePromotion` rather than re-deriving the window**, so the admin's answer and
 * checkout's answer are the same answer by construction. A second copy of *has it started, has it
 * ended, is it used up* would drift the first time §15.1a changed, and it would drift in the
 * direction of an admin panel that lies about what the shop will honour.
 *
 * The empty bag is deliberate. The four gates named below are properties of the **promotion**; the
 * gates §15.1a checks after them — currency, minimum subtotal, product eligibility — are properties
 * of a **bag**, which a list view does not have and must not invent. Those fall through to "Live
 * now", which is the honest answer to the question actually being asked.
 */
const NOT_LIVE_COPY: Partial<Record<PromotionFailure, string>> = {
  expired: 'Ended — the end date has passed.',
  inactive: 'Off — the Active switch is unticked.',
  notStarted: 'Scheduled — it goes live on the start date.',
  usageLimit: 'Used up — it has reached its total usage limit.',
}

export const Promotions: CollectionConfig = {
  slug: 'promotions',

  admin: {
    useAsTitle: 'code',
    /**
     * `usageLimit` sits beside `timesUsed` because a count with no denominator is not a fact anyone
     * can act on: *used 3 times* is unremarkable against a limit of 500 and means the code is dead
     * against a limit of 3. `liveNow` leads because it is the column the list is read for.
     */
    defaultColumns: [
      'code',
      'liveNow',
      'type',
      'active',
      'startsAt',
      'endsAt',
      'timesUsed',
      'usageLimit',
    ],
    /**
     * A code is found by what it is called *or* by what it was for. `description` is the internal
     * note — "Black Friday, email list" — and it is usually the only thing anyone remembers three
     * months later. `code` is repeated because declaring this list replaces the `useAsTitle` default
     * outright rather than adding to it.
     */
    listSearchableFields: ['code', 'description'],
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
          validate: validateEndsAfterStart,
          admin: {
            width: '50%',
            date: { pickerAppearance: 'dayAndTime' },
            description: 'Empty means no expiry. Must be after the start date.',
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
          /*
           * Not editable from a browser. `usageLimit` is measured against this, so a staff member who
           * could retype it could quietly extend a code past what the shop agreed to — and the honest
           * way to extend a code is to raise the limit, not to falsify the count. Phase 17 increments
           * it with an expression update inside the payment transaction, past Payload entirely, so
           * the guard costs that path nothing. Found by Phase 18's second sweep, reading for fields
           * whose `readOnly` was a UI hint with no rule behind it.
           */
          name: 'timesUsed',
          type: 'number',
          required: true,
          defaultValue: 0,
          min: 0,
          /*
           * **`create` as well as `update` — Phase 28.** The update guard closed the door on
           * retyping the counter and left the one beside it open: `POST /api/promotions` is
           * `isStaff`, so a code could be *born* claiming ninety-nine redemptions it never had. That
           * is the same lie as resetting it, told at the other end, and it is worse in one respect —
           * there is no earlier value to notice the difference against.
           *
           * Denied field access does not fail the write: Payload deletes the key and falls back to
           * `defaultValue` (`getFallbackValue`), so a staff-created promotion starts at 0, which is
           * the only honest number for a code nobody has used yet. Phase 17's increment runs with
           * `overrideAccess: true` past field access entirely, so the fulfilment path is untouched.
           */
          access: { create: nobodyField, update: nobodyField },
          admin: {
            width: '33%',
            readOnly: true,
            step: 1,
            description:
              'Incremented by Phase 17, in the transaction that finalises payment. Never typed by hand, here or through the API — a count somebody chose is a usage limit that lies.',
          },
        },
      ],
    },
    {
      /** See `NOT_LIVE_COPY` above for why this exists and why it is derived rather than stored. */
      name: 'liveNow',
      type: 'text',
      virtual: true,
      label: 'Live now',
      admin: {
        position: 'sidebar',
        /*
         * There is no `live_now` column, so there is nothing for a filter to compare against. Payload
         * already refuses to *sort* a virtual column; the filter list is not disabled for us.
         */
        disableListFilter: true,
        description:
          'Worked out from the switch, the dates and the usage limit — the same checks checkout runs. A code discounts nothing unless this says Live now.',
      },
      hooks: {
        afterRead: [
          ({ siblingData }) => {
            const doc = siblingData as Promotion

            const failure = validatePromotion(toPromotionInput(doc), [], {
              cartCurrency: doc.currency ?? DEFAULT_CURRENCY,
              customerUses: 0,
              now: new Date(),
            })

            return (failure === null ? undefined : NOT_LIVE_COPY[failure]) ?? 'Live now'
          },
        ],
      },
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
