import type { CollectionConfig } from 'payload'

import { freezeOrderLines } from '../hooks/freezeOrderLines'

import { isAdmin, isStaff, nobody, nobodyField, ownedByCustomer } from '../access'
import { minorUnits } from '../fields/money'

/**
 * A purchased line, frozen. Plan §6.1k is unusually direct about why this table exists:
 *
 * > "Store stable snapshot data for historical accuracy… **Do not reconstruct historical orders
 * > entirely from current product records.**"
 *
 * and plan §18.1d repeats it: *"order item name/price/variant/SKU snapshots remain unchanged after a
 * product is edited later."*
 *
 * So every value a receipt needs is a column here, written once at purchase and never updated. The
 * relationships beside them — `product`, `variant` — are **navigation, not data**: they let the
 * account page link back to a product that still exists, and they are permitted to resolve to
 * nothing, because `ON DELETE SET NULL` guarantees they eventually will (`docs/DATABASE.md` §8).
 * When they do, the order still reads correctly, which is the whole point.
 *
 * That is why `sku`, `productName`, `variantLabel` and `unitPriceMinor` are all `required` while
 * `product` and `variant` are not. The inversion is deliberate: the copies are the record and the
 * pointers are the convenience.
 *
 * `lineTotalMinor` is stored rather than computed from `unitPriceMinor × quantity`. It is the same
 * number today, and storing it means a future line that carries a per-line adjustment — a partial
 * refund, an item-level promotion — cannot silently disagree with what the customer was charged. An
 * order is a record of a transaction, not a formula that re-evaluates.
 */
export const OrderItems: CollectionConfig = {
  slug: 'order-items',

  labels: { singular: 'Order line', plural: 'Order lines' },

  admin: {
    useAsTitle: 'productName',
    defaultColumns: ['order', 'productName', 'variantLabel', 'sku', 'quantity', 'lineTotalMinor'],
    group: 'Commerce',
    description:
      'Frozen purchase lines. Never edited after the order is placed. Search by SKU to find every ' +
      'order that contains a particular item.',

    /**
     * **The recall question, which is the only reason to open this list directly.**
     *
     * An order's lines are read from the order itself — the `items` join on `Orders` shows them in
     * place, and that is how they are looked at ninety-nine times in a hundred. The hundredth is the
     * other direction: *"this batch of `N01-TEE-BONE-M` was faulty — who has one?"* That question has
     * no answer through the orders list, because the SKU is not a column on an order; it is a column
     * here, on every line that ever shipped.
     *
     * Without this key the list search matched `useAsTitle` alone — `productName` — which answers a
     * blunter version of the same question and cannot tell a size or a colourway apart. `sku` first,
     * because it is the precise handle; `variantLabel` beside it because *"Bone / M"* is what a person
     * has in front of them when the SKU is on a label they cannot read.
     */
    listSearchableFields: ['sku', 'productName', 'variantLabel'],
  },

  /**
   * Soft-deleted for the same reason as the order it belongs to: it is part of a financial record.
   * The cascade in `Orders.beforeDelete` passes `trash: true` so that permanently deleting an order
   * takes its trashed lines with it rather than leaving them behind.
   */
  trash: true,

  /**
   * Ownership through the order, and creation closed for the same reason as `Orders`: a line on an
   * order is a historical fact written by the checkout, not a document anybody authors.
   */
  access: {
    read: ownedByCustomer('order.customer'),
    create: nobody,
    update: isStaff,
    delete: isAdmin,
  },

  fields: [
    {
      /*
       * **Closed to the browser in Phase 28, and it is the one hole `freezeOrderLines` leaves.**
       *
       * That hook refuses §18.1d's four snapshot columns, and `nobodyField` closes `quantity` and
       * `lineTotalMinor`. `order` was neither — so `update: isStaff` meant a staff member could
       * reparent a purchased line onto a different order, which rewrites **two** financial records at
       * once: one loses a line it was paid for, the other gains a line nobody paid for. Both totals
       * then disagree with what Stripe charged, and neither order says why.
       *
       * It is not the correctable-pointer case the docblock above describes. `product` and `variant`
       * are navigation and are meant to be fixable; `order` is what makes this row part of that
       * purchase at all, and it was decided by the checkout that created it. There is no support task
       * that needs it moved — a line on the wrong order is a refund and a new order, not a re-link.
       *
       * `readOnly` is only how the panel says so; `overrideAccess: true` skips field access, so
       * `checkout/preflight.ts` still writes it at create (and it only ever creates — the snapshot is
       * deleted and rewritten per attempt rather than edited).
       */
      name: 'order',
      type: 'relationship',
      relationTo: 'orders',
      required: true,
      index: true,
      access: { update: nobodyField },
      admin: {
        readOnly: true,
        description:
          'The purchase this line belongs to, fixed when the order was placed. A line cannot be moved to another order — if one is on the wrong order, that is a refund and a new order, not an edit.',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'product',
          type: 'relationship',
          relationTo: 'products',
          admin: {
            width: '50%',
            description:
              'A link back, if the product still exists. The snapshot below is the record.',
          },
        },
        {
          name: 'variant',
          type: 'relationship',
          relationTo: 'product-variants',
          admin: { width: '50%', description: 'Likewise — navigation, not data.' },
        },
      ],
    },
    /*
     * The four columns plan §18.1d names, and the two beside them, are closed to the browser by
     * `nobodyField` and — for §18.1d's four — closed to *everything* by `hooks/freezeOrderLines.ts`.
     * The docblock above has said "never edited after the order is placed" since Phase 6; Phase 18
     * is where that stopped being a sentence and became a refusal.
     */
    {
      name: 'sku',
      type: 'text',
      required: true,
      index: true,
      access: { update: nobodyField },
      admin: {
        readOnly: true,
        description:
          'The SKU at the moment of purchase. Durable because SKUs are never reassigned — see ProductVariants.',
      },
    },
    {
      name: 'productName',
      type: 'text',
      required: true,
      access: { update: nobodyField },
      admin: {
        readOnly: true,
        description: 'The product name as it read on the day. Never updated.',
      },
    },
    {
      name: 'variantLabel',
      type: 'text',
      required: true,
      access: { update: nobodyField },
      admin: {
        readOnly: true,
        description: 'Colour and size as they read on the day — "Bone / M".',
      },
    },
    {
      type: 'row',
      fields: [
        minorUnits({
          name: 'unitPriceMinor',
          label: 'Unit price',
          required: true,
          access: { update: nobodyField },
          admin: { width: '33%', readOnly: true, description: 'What one cost, then.' },
        }),
        {
          name: 'quantity',
          type: 'number',
          required: true,
          min: 1,
          access: { update: nobodyField },
          admin: { width: '33%', readOnly: true, step: 1 },
          validate: (value: unknown) =>
            typeof value === 'number' && Number.isInteger(value) && value >= 1
              ? true
              : 'A whole number of one or more.',
        },
        minorUnits({
          name: 'lineTotalMinor',
          label: 'Line total',
          required: true,
          access: { update: nobodyField },
          admin: {
            width: '33%',
            readOnly: true,
            description: 'What this line contributed to the subtotal. Stored, not recomputed.',
          },
        }),
      ],
    },
  ],

  hooks: {
    beforeChange: [freezeOrderLines],
  },
}
