import type { CollectionConfig } from 'payload'

import { addressFields } from '../fields/address'

/**
 * A customer's saved address book. **Gap G-01**, assigned to this phase and recorded in **DEV-10**:
 * `/account/addresses` is a route (structure §16), customer access rules govern it (plan §7.1b,
 * *"read/write their own addresses"*), and order snapshots depend on the shape (plan §6.1k) — yet
 * the entity appears in neither the plan's entity list §2.2 nor Phase 6.
 *
 * **These are not the addresses on an order.** An order carries its own frozen copy; see
 * `fields/address.ts` for why that duplication is required rather than avoidable. Deleting a saved
 * address, or editing it after moving house, must leave every past order exactly as it was.
 *
 * **The default flags are booleans, not a pointer from the customer.** The alternative —
 * `customers.defaultShippingAddress` as a relationship — puts the fact on the wrong side: deleting
 * the address would silently null the default, and the customer row would need updating on every
 * address change. Here it travels with the address it describes.
 *
 * What is *not* enforced in the schema is that only one address per customer carries each flag. It
 * is a real constraint and Payload cannot express it: it is a partial unique index — `UNIQUE
 * (customer_id) WHERE is_default_shipping` — and the compound-index API has no `where` clause
 * (the same limitation `ProductVariants.ts` discusses). Unlike the SKU case there is no stricter
 * constraint that is also correct, because the flag is legitimately false on most rows. So it is
 * held by the hook below, which clears the flag on the customer's other addresses whenever one
 * claims it. That is weaker than a constraint — two simultaneous writes could both win — and the
 * consequence is benign: a customer sees two addresses marked default and fixes it by choosing one.
 * The alternative, a partial index invisible to the snapshot chain, was rejected for the reasons in
 * `docs/DATABASE.md` §8.
 */
export const Addresses: CollectionConfig = {
  slug: 'addresses',

  labels: { singular: 'Address', plural: 'Addresses' },

  admin: {
    useAsTitle: 'line1',
    defaultColumns: ['customer', 'line1', 'city', 'postalCode', 'country'],
    group: 'Customers',
    description:
      'Saved addresses. Orders keep their own frozen copy and are unaffected by edits here.',
  },

  fields: [
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      index: true,
      admin: {
        description: 'The account this address belongs to. Ownership is enforced in Phase 7.',
      },
    },
    {
      name: 'label',
      type: 'text',
      admin: {
        description: 'Optional. What the customer calls it — "Home", "Studio".',
      },
    },
    ...addressFields({ required: true }),
    {
      type: 'row',
      fields: [
        {
          name: 'isDefaultShipping',
          type: 'checkbox',
          defaultValue: false,
          label: 'Default for delivery',
          admin: { width: '50%' },
        },
        {
          name: 'isDefaultBilling',
          type: 'checkbox',
          defaultValue: false,
          label: 'Default for billing',
          admin: { width: '50%' },
        },
      ],
    },
  ],

  hooks: {
    afterChange: [
      async ({ context, doc, req }) => {
        if (context?.skipDefaultAddressSync) {
          return doc
        }

        const record = doc as {
          id: number | string
          customer?: unknown
          isDefaultShipping?: boolean
          isDefaultBilling?: boolean
        }

        const customerId =
          typeof record.customer === 'object' && record.customer !== null && 'id' in record.customer
            ? (record.customer as { id: number | string }).id
            : record.customer

        if (
          (typeof customerId !== 'number' && typeof customerId !== 'string') ||
          (!record.isDefaultShipping && !record.isDefaultBilling)
        ) {
          return doc
        }

        const clear: Record<string, boolean> = {}

        if (record.isDefaultShipping) {
          clear.isDefaultShipping = false
        }

        if (record.isDefaultBilling) {
          clear.isDefaultBilling = false
        }

        try {
          await req.payload.update({
            collection: 'addresses',
            where: {
              and: [
                { customer: { equals: customerId } },
                { id: { not_equals: record.id } },
                { or: Object.keys(clear).map((key) => ({ [key]: { equals: true } })) },
              ],
            },
            data: clear,
            depth: 0,
            context: { skipDefaultAddressSync: true },
            req,
          })
        } catch (error) {
          /**
           * Rethrown, for the same reason as the derived-price sync. "A bookkeeping failure must not
           * fail the write that caused it" is the right instinct and it is not available here:
           * Payload's operations end by calling `killTransaction(req)`, which has already rolled the
           * caller's transaction back by the time this runs. Swallowing would report a saved address
           * that was not saved.
           */
          req.payload.logger.error({
            err: error,
            msg: `Could not clear the previous default address for customer ${String(customerId)}. The enclosing transaction has been rolled back.`,
          })

          throw error
        }

        return doc
      },
    ],
  },
}
