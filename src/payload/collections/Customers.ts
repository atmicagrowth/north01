import type { CollectionConfig } from 'payload'

import { normaliseEmail } from '../fields/slug'
import { cascadeDelete } from '../hooks/cascadeDelete'

/**
 * The shopper's account — and a **separate auth collection from `users`**, which is staff.
 *
 * Plan §2.2 lists "User / customer" as one conceptual entity and plan §7.1a lists Customer, Editor
 * and Admin as roles, which reads like one table with a `role` column. It is two, for a reason plan
 * §7.1b states as a hard boundary: customers *"may NOT access Payload Admin"*. With one collection
 * that boundary is a conditional inside an access function — one that has to be right on every
 * operation, forever, and that is one inverted comparison away from letting a shopper into the CMS.
 * With two, the admin panel is bound to `users` by `admin.user` in the Payload config and a customer
 * has nowhere to log in *to*. A structural guarantee beats a well-tested one.
 *
 * The existing `users` collection already anticipated this split in Phase 2: *"customer-facing
 * accounts are a separate concern defined in Phases 6 and 7"*. This is the Phase 6 half.
 *
 * **What Phase 7 adds and this does not pre-empt.** Roles, access rules, the registration, login,
 * password-reset and session flows, protected account routes, and the "account is disabled" state
 * from §7.1e's edge-case list. Access control here is Payload's default — every operation requires
 * an authenticated session — which is closed, not open, and is the right thing to leave in place
 * until the phase that owns opening it deliberately.
 *
 * **Email verification is deliberately off.** Payload's `auth.verify` would make every registration
 * depend on an email being delivered, and there is no email infrastructure until **Phase 19**.
 * Turning it on now would mean either accounts that can never be activated or a verification mail
 * nobody sends — plan §0.1.17's fake functionality, in the account system. §7.1e says *"email
 * verification **if enabled**"*, which is permission to decide, and the decision is: Phase 19, once
 * Resend exists.
 */
export const Customers: CollectionConfig = {
  slug: 'customers',

  auth: {
    /**
     * `useAPIKey` is off: an API key is a machine credential and a shopper is not a machine.
     * Everything else is Payload's default token lifetime and login handling, which Phase 7 revisits
     * with the session requirements in §7.1e.
     */
    useAPIKey: false,
  },

  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'firstName', 'lastName', 'createdAt'],
    group: 'Customers',
    description:
      'Shopper accounts. Separate from staff Users — a customer cannot sign in to this admin panel.',
  },

  /**
   * `docs/DATABASE.md` §8 names customers as one of the two collections where a delete must be
   * recoverable. Beyond the mis-click, erasure here is a legal question rather than a UI one: an
   * account is attached to orders that must survive it, and a hard delete would null the customer
   * on every one of them at once (`ON DELETE SET NULL`). The order stays readable either way,
   * because it snapshots the email and the addresses — see `Orders.ts`.
   */
  trash: true,

  fields: [
    // `email` and `password` are added implicitly by `auth`.
    {
      type: 'row',
      fields: [
        {
          name: 'firstName',
          type: 'text',
          required: true,
          admin: { width: '50%' },
        },
        {
          name: 'lastName',
          type: 'text',
          required: true,
          admin: { width: '50%' },
        },
      ],
    },
    {
      name: 'phone',
      type: 'text',
      admin: { description: 'Optional. Offered to carriers as a delivery contact.' },
    },
    {
      /**
       * The mapping the tech stack §3 assigns to this side of the boundary: *"Customer identity —
       * source of truth: Payload Auth + PostgreSQL; derived/external: Stripe customer ID mapping."*
       * Stripe owns the customer object; this column is our end of the pointer, so a returning
       * shopper reaches the same Stripe customer and their saved payment methods rather than a new
       * one on every order.
       *
       * Written by **Phase 17**, on the first checkout. Empty until then, read-only always: it is
       * Stripe's identifier, and typing one in by hand is how an order gets attached to somebody
       * else's payment methods. Unique for the same reason.
       */
      name: 'stripeCustomerId',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Set by Stripe at first checkout (Phase 17). Never edited by hand.',
      },
    },
    {
      name: 'addresses',
      type: 'join',
      collection: 'addresses',
      on: 'customer',
      admin: {
        description: "The customer's saved address book, editable by them at /account/addresses.",
      },
    },
    {
      name: 'orders',
      type: 'join',
      collection: 'orders',
      on: 'customer',
      defaultSort: '-createdAt',
      admin: { description: 'Every order placed by this account.' },
    },
  ],

  hooks: {
    /**
     * Three dependants carry a **required** customer reference, which Postgres stores as `NOT NULL`
     * with `ON DELETE SET NULL` — so a permanent delete fails unless they go first. See
     * `hooks/cascadeDelete.ts`.
     *
     * Note what this does *not* remove. `orders.customer` and `carts.customer` are nullable and stay
     * that way: an order must outlive the account that placed it — it keeps its own email and
     * address snapshots — and an orphaned bag simply expires. That is the right shape for an erasure
     * request too: the person's identity, addresses, saved items and reviews go, and the financial
     * record remains without them.
     */
    beforeDelete: [
      cascadeDelete([
        { collection: 'addresses', on: 'customer' },
        { collection: 'wishlist-items', on: 'customer' },
        { collection: 'reviews', on: 'customer' },
      ]),
    ],

    beforeValidate: [
      /**
       * Payload lowercases the email it authenticates with, but a value arriving through the Local
       * API or a seed script skips that path. Normalising here means the unique index compares the
       * same string the login flow will.
       */
      ({ data }) => {
        if (data && typeof data.email === 'string') {
          return { ...data, email: normaliseEmail({ value: data.email }) as string }
        }

        return data
      },
    ],
  },
}
