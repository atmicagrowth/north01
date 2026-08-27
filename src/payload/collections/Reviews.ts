import type { CollectionConfig } from 'payload'

/**
 * Product reviews. Plan §6.1j lists the fields and states the rule the schema has to make
 * structurally true:
 *
 * > "Reviews must not become publicly visible before moderation if moderation is enabled."
 *
 * `status` defaults to `pending`, so a review is unpublished by construction rather than by
 * remembering to set something. Plan §21.1b names the three states — pending, approved, rejected —
 * and *"only approved reviews appear publicly"*. The public read rule that enforces it is **Phase
 * 7**'s; until then Payload's default access refuses everyone without a session, which is closed
 * rather than open and is the safe direction to be wrong in.
 *
 * ---
 *
 * ### `customer` is required — a deliberate departure from §6.1j
 *
 * Plan §6.1j says *"customer reference **if applicable**"*, which reads as nullable. It is required
 * here, because two other requirements are unsatisfiable without it:
 *
 * - **Duplicate prevention.** Plan §21.1c's first abuse case is *"duplicate review by same customer
 *   for same product"*. The constraint that stops it is `UNIQUE (product, customer)` — and over a
 *   nullable `customer` that constraint does nothing, because Postgres treats NULLs as distinct, so
 *   every anonymous review would satisfy it (`docs/DATABASE.md` §8, measured in Phase 5). Requiring
 *   the column is what turns the index from decoration into enforcement.
 * - **Verified purchase.** Feature matrix §9 wants a *"verified-purchase indicator based on order
 *   history"* and plan §21.1a wants to *"match customer to a paid order containing the product"*.
 *   Neither is possible without knowing who wrote the review.
 *
 * Plan §21.1a independently expects it: *"only authenticated customers should submit reviews unless
 * a deliberately designed verified-review workflow is implemented."* No such workflow is designed
 * anywhere in the corpus, so the required column follows the more specific instruction. `displayName`
 * remains a separate field precisely so the public byline never has to be the account name.
 *
 * Recorded as a deviation.
 *
 * ---
 *
 * `verifiedPurchase` is stored rather than derived. It is a statement about the past — *this person
 * had bought this product when they wrote this* — and re-deriving it on every read would make it
 * flicker as orders are refunded or accounts are tidied, on a badge whose entire value is that it
 * does not move. Phase 21 sets it at submission, from order history.
 */
export const Reviews: CollectionConfig = {
  slug: 'reviews',

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['product', 'rating', 'displayName', 'status', 'verifiedPurchase', 'createdAt'],
    group: 'Customers',
    description: 'Pending until moderated. Only approved reviews are ever rendered publicly.',
  },

  /**
   * `product_customer_idx` — distinct from the schema's other compound indexes by column names, per
   * the naming rule in `docs/DATABASE.md` §8.
   */
  indexes: [{ fields: ['product', 'customer'], unique: true }],

  defaultSort: '-createdAt',

  fields: [
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      index: true,
    },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      index: true,
      admin: {
        description:
          'Required — it is what makes the one-review-per-product rule enforceable and the verified badge possible.',
      },
    },
    {
      name: 'displayName',
      type: 'text',
      required: true,
      maxLength: 60,
      admin: {
        description: 'The public byline. Deliberately separate from the account name.',
      },
    },
    {
      name: 'rating',
      type: 'number',
      required: true,
      min: 1,
      max: 5,
      index: true,
      admin: { step: 1, description: 'Whole stars, 1 to 5.' },
      validate: (value: unknown) =>
        typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
          ? true
          : 'A whole number of stars between 1 and 5.',
    },
    {
      name: 'title',
      type: 'text',
      maxLength: 120,
      admin: { description: 'Optional headline.' },
    },
    {
      /**
       * Bounded because plan §21.1c lists *"oversized text"* as an abuse case, and an unbounded
       * `text` column is an invitation to paste a novel into a product page. Two thousand characters
       * is several long paragraphs.
       */
      name: 'body',
      type: 'textarea',
      required: true,
      minLength: 10,
      maxLength: 2000,
      admin: { description: 'Up to 2000 characters — plan §21.1c\'s "oversized text" case.' },
    },
    {
      name: 'photos',
      type: 'array',
      maxRows: 4,
      labels: { singular: 'Photo', plural: 'Photos' },
      admin: {
        description:
          'Optional — plan §6.1j. Upload limits and mime validation are Phase 8\'s; the count bound is here because plan §21.1c names "huge image upload".',
      },
      fields: [
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          required: true,
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      index: true,
      options: [
        { label: 'Pending moderation', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
      ],
      admin: {
        position: 'sidebar',
        description:
          'Pending by default, so nothing can reach the public site unmoderated by accident.',
      },
    },
    {
      name: 'verifiedPurchase',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      index: true,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description:
          'Set at submission from order history (Phase 21). A fact about the past, so it is stored.',
      },
    },
  ],
}
