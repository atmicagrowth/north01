import type { CollectionConfig } from 'payload'

/**
 * One line in a bag. Plan §6.1k: cart, product, variant, quantity, and *"snapshot of presentation
 * data only if needed"*.
 *
 * **It is not needed, and storing it would be a defect.** A snapshot exists to freeze a fact that
 * must not change — which is exactly right for an order and exactly wrong for a bag. Plan §14.1e
 * lists *"product price changed"*, *"product becomes unavailable"* and *"quantity becomes
 * unavailable"* as things the cart must surface to the customer; a cached name and price would hide
 * all three behind stale text and let a customer reach checkout believing a price that is no longer
 * real. Every line is therefore rendered from the live product and variant, and revalidated on the
 * server at every mutation (plan §14.1c) and again at preflight (plan §17.1a). The freeze happens
 * once, at `order-items`, and only after payment.
 *
 * **`(cart, variant)` is unique, and that is plan §14.1b step 5 expressed as a constraint.** The
 * merge rule — *"resolve duplicate items by summing quantities"* — presumes a variant appears at
 * most once per bag; without the constraint, a double-tapped Add button or two tabs racing produce
 * two lines for the same thing and every total is quietly wrong. Both columns are `required`, which
 * is what makes the constraint mean what it reads like: a compound unique index over a nullable
 * column does not (`docs/DATABASE.md` §8).
 *
 * **`product` is stored beside `variant` although the variant knows its product.** It is one
 * integer, and it is what lets a bag be read — and a "product deleted while browsing" line be
 * detected — without joining through the variant on every row. The two cannot disagree: a variant
 * cannot change parent without breaking its own SKU discipline, and the write path sets both from
 * the same lookup.
 */
export const CartItems: CollectionConfig = {
  slug: 'cart-items',

  labels: { singular: 'Bag line', plural: 'Bag lines' },

  admin: {
    useAsTitle: 'id',
    defaultColumns: ['cart', 'variant', 'quantity', 'updatedAt'],
    group: 'Commerce',
    description:
      'Lines in a bag. No prices are stored — they are read live so that changes are visible.',
  },

  indexes: [{ fields: ['cart', 'variant'], unique: true }],

  fields: [
    {
      name: 'cart',
      type: 'relationship',
      relationTo: 'carts',
      required: true,
      index: true,
    },
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      index: true,
    },
    {
      name: 'variant',
      type: 'relationship',
      relationTo: 'product-variants',
      required: true,
      index: true,
      admin: { description: 'The exact colour and size. This is what is actually being bought.' },
    },
    {
      /**
       * `max` is a sanity bound, not an inventory check. Stock is per variant and changes between
       * requests, so the real check is the server-side revalidation at every mutation (plan §14.1c)
       * and at preflight (plan §17.1a) — this only stops a typed `99999` from becoming a row.
       */
      name: 'quantity',
      type: 'number',
      required: true,
      defaultValue: 1,
      min: 1,
      max: 99,
      admin: {
        step: 1,
        description:
          'Availability is checked against live stock on every mutation, not by this bound.',
      },
      validate: (value: unknown) =>
        typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 99
          ? true
          : 'A whole number between 1 and 99.',
    },
  ],
}
