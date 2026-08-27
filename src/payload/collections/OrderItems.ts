import type { CollectionConfig } from 'payload'

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
    description: 'Frozen purchase lines. Never edited after the order is placed.',
  },

  /**
   * Soft-deleted for the same reason as the order it belongs to: it is part of a financial record.
   * The cascade in `Orders.beforeDelete` passes `trash: true` so that permanently deleting an order
   * takes its trashed lines with it rather than leaving them behind.
   */
  trash: true,

  fields: [
    {
      name: 'order',
      type: 'relationship',
      relationTo: 'orders',
      required: true,
      index: true,
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
    {
      name: 'sku',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description:
          'The SKU at the moment of purchase. Durable because SKUs are never reassigned — see ProductVariants.',
      },
    },
    {
      name: 'productName',
      type: 'text',
      required: true,
      admin: { description: 'The product name as it read on the day. Never updated.' },
    },
    {
      name: 'variantLabel',
      type: 'text',
      required: true,
      admin: { description: 'Colour and size as they read on the day — "Bone / M".' },
    },
    {
      type: 'row',
      fields: [
        minorUnits({
          name: 'unitPriceMinor',
          label: 'Unit price',
          required: true,
          admin: { width: '33%', description: 'What one cost, then.' },
        }),
        {
          name: 'quantity',
          type: 'number',
          required: true,
          min: 1,
          admin: { width: '33%', step: 1 },
          validate: (value: unknown) =>
            typeof value === 'number' && Number.isInteger(value) && value >= 1
              ? true
              : 'A whole number of one or more.',
        },
        minorUnits({
          name: 'lineTotalMinor',
          label: 'Line total',
          required: true,
          admin: {
            width: '33%',
            description: 'What this line contributed to the subtotal. Stored, not recomputed.',
          },
        }),
      ],
    },
  ],
}
