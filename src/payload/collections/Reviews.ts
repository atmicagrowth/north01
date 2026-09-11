import type { CollectionConfig, Where } from 'payload'

import {
  activeCustomer,
  isAdmin,
  isStaff,
  isStaffField,
  nobodyField,
  staffUser,
  VERIFIED_PUBLIC_WRITE,
} from '../access'
import { validateRequiredUpload } from '../fields/required'
import { enforceCustomerOwnership } from '../hooks/enforceCustomerOwnership'

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
    /**
     * **`displayName`, not `title` — Phase 28.**
     *
     * `title` is optional (plan §6.1j makes the headline a nicety), and `useAsTitle` pointing at an
     * optional column means every review written without one renders as `ID 412` — in the list, in
     * the document header, and in any relationship field that points here. A moderation queue where
     * half the rows have no name is a queue nobody can work through. The byline is required, so it
     * is always there, and it is what a moderator recognises the row by.
     */
    useAsTitle: 'displayName',
    defaultColumns: ['product', 'rating', 'displayName', 'status', 'verifiedPurchase', 'createdAt'],
    /**
     * The search box looks at `useAsTitle` alone unless told otherwise, and moderation is not a job
     * done by searching bylines: it is done by searching for *what somebody wrote* — a phrase
     * reported as abusive, a competitor named in a body, the wording of a duplicate.
     *
     * None of the three is indexed, and an index would not serve them anyway: the search builder
     * emits `ILIKE '%term%'`, which a leading wildcard puts beyond any btree. This is a sequential
     * scan over a moderation queue somebody works through by hand a few times a day, which is the
     * one shape that costs nothing.
     */
    listSearchableFields: ['displayName', 'title', 'body'],
    group: 'Customers',
    description:
      'Pending until moderated. Only approved reviews are ever rendered publicly — filter Status to "Pending moderation" for the queue.',
  },

  /**
   * `product_customer_idx` — distinct from the schema's other compound indexes by column names, per
   * the naming rule in `docs/DATABASE.md` §8.
   */
  indexes: [{ fields: ['product', 'customer'], unique: true }],

  defaultSort: '-createdAt',

  /**
   * **Three readers, three answers.** Anyone sees approved reviews. The author additionally sees
   * their own, whatever state it is in — which is what makes "submitted, awaiting moderation" a
   * thing the storefront can honestly show them instead of a review that vanishes on submit. Staff
   * see everything, because moderating requires seeing the unmoderated.
   *
   * `create` is open to any active customer and the row is forced to be theirs, but `status` and
   * `verifiedPurchase` are staff-only *fields* — so a review created through the API lands `pending`
   * and unverified no matter what the request body says, and is invisible to everyone but its author
   * until a human approves it. That is §21.1b's moderation rule expressed as access control rather
   * than as a hook that could be bypassed.
   *
   * `update` and `delete` stay with staff. Whether an author may edit or withdraw their own review —
   * and what that does to a rating aggregate — is **Phase 21**'s question (§21.1a), and answering it
   * here by guessing would be the wrong kind of early.
   */
  access: {
    read: ({ req: { user } }) => {
      if (staffUser(user)) {
        return true
      }

      const approved: Where = { status: { equals: 'approved' } }
      const customer = activeCustomer(user)

      if (!customer) {
        return approved
      }

      return { or: [approved, { customer: { equals: customer.id } }] }
    },
    /*
     * Plan §34 — the review form checks Turnstile, and `POST /api/reviews` did not: a customer's
     * cookie was enough to post around it. The Server Action sets the verified flag, which the REST
     * API cannot (see `verifiedPublicWrite`), so every path to a new review has been through the guard.
     */
    create: ({ req }) =>
      activeCustomer(req.user) !== null && req.context?.[VERIFIED_PUBLIC_WRITE] === true,
    update: isStaff,
    delete: isAdmin,
  },

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
      /*
       * Plan §34 — an approved review is public, and so was the id of the account behind it:
       * `GET /api/reviews?where[customer][equals]=…` listed everything one person had written. The
       * published name is `displayName`; the account is for staff and the author.
       */
      access: {
        read: ({ doc, req: { user } }) => {
          if (staffUser(user)) return true

          const customer = activeCustomer(user)
          const owner = typeof doc?.customer === 'object' ? doc?.customer?.id : doc?.customer

          return customer !== null && owner === customer.id
        },
      },
      admin: {
        description:
          'Required — it is what makes the one-review-per-product rule enforceable and the verified badge possible.',
      },
    },
    {
      name: 'displayName',
      /*
       * **Moderation is three states, not editing — Phase 28's first sweep.**
       *
       * `access.update` on this collection is `isStaff`, which is right: somebody has to move a
       * review between pending, approved and rejected. It also meant a moderator could rewrite the
       * customer's **words** — the body, the rating, the name it is published under — and §21.1b
       * defines moderation as approving or rejecting, not as authoring.
       *
       * A staff-edited review is words put in a customer's mouth under their own name, on a public
       * page, with no version history to show it happened. Field access closes it the way Payload
       * closes these: the key is deleted from the incoming data and the stored value stands, so a
       * moderator saving a status change cannot take the body with it.
       *
       * A review that must not be published is **rejected**, which is the control that exists for it.
       */
      access: { update: nobodyField },
      type: 'text',
      required: true,
      maxLength: 60,
      admin: {
        description: 'The public byline. Deliberately separate from the account name.',
      },
    },
    {
      name: 'rating',
      access: { update: nobodyField },
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
      access: { update: nobodyField },
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
      access: { update: nobodyField },
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
          validate: validateRequiredUpload,
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      index: true,
      access: {
        create: isStaffField,
        update: isStaffField,
      },
      options: [
        { label: 'Pending moderation', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
      ],
      admin: {
        position: 'sidebar',
        description:
          'Pending by default, so nothing can reach the public site unmoderated by accident. ' +
          'Rejected keeps the review on file and off the site — deleting it instead loses the record ' +
          'of what was submitted, and frees the customer to post the same thing again.',
      },
    },
    {
      name: 'verifiedPurchase',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      index: true,
      access: {
        create: isStaffField,
        update: isStaffField,
      },
      admin: {
        position: 'sidebar',
        readOnly: true,
        description:
          'Set at submission from order history (Phase 21). A fact about the past, so it is stored.',
      },
    },
  ],

  hooks: {
    /**
     * A review belongs to the account that submitted it, not to whichever customer id the request
     * named. Same pairing as `Addresses` and `WishlistItems` — see `hooks/enforceCustomerOwnership.ts`.
     */
    beforeValidate: [enforceCustomerOwnership('customer')],
  },
}
