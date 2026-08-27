import { randomBytes } from 'crypto'

import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff, ownedByCustomer } from '../access'
import { CURRENCY_OPTIONS, DEFAULT_CURRENCY } from '../fields/money'
import { cascadeDelete } from '../hooks/cascadeDelete'

/**
 * A bag. Plan §6.1k gives the fields — session token, optional customer, currency, status,
 * expiration — and plan §14.1a gives the identity model: a guest gets *"a cryptographically strong
 * server-issued cart token stored in a secure, HTTP-only cookie"*, and an authenticated shopper's
 * cart is *"associated with customer ID"*.
 *
 * Both, not either. `token` is present on every cart including a signed-in one, because a customer
 * who signs out mid-session still has a bag, and because plan §14.1b's merge needs to load a guest
 * cart *and* a customer cart at the same moment and reconcile them.
 *
 * **There are no totals on this table.** Not subtotal, not discount, not shipping, not tax, not
 * total. Plan §14.1d requires every one of them to be *"calculated on the server"* and
 * `docs/ARCHITECTURE.md` §2 states the rule the schema has to make true: the browser is never
 * authoritative. A stored subtotal is a cached answer that goes stale the moment a price changes, a
 * promotion expires or a variant is withdrawn — and plan §14.1e lists all three as edge cases the
 * cart must *notice*. Totals are computed per request from the line items and the live catalogue,
 * which is the only version of them that can be trusted. The order, which must never change again,
 * is where they are finally written down.
 *
 * **`status` has two values and both are used.** `active` is a bag; `converted` is a bag that became
 * an order and must not be mutated again. There is deliberately no `abandoned` and no `expired`:
 * nothing in the corpus sends an abandoned-cart email (plan §19.1b's template list does not include
 * one), and expiry is `expiresAt` compared against the clock — a status value would need a scheduled
 * job to flip it and would be wrong between runs.
 *
 * **One discount code per cart** — plan §15.1c's default, confirmed as **DEV-08**. `promotion` is a
 * single relationship rather than a list. It records *which* code was applied; whether it is still
 * valid is recomputed on every read and again at checkout (plan §15.1a), because a code can expire
 * or hit its usage limit while the bag sits open.
 */
export const Carts: CollectionConfig = {
  slug: 'carts',

  admin: {
    useAsTitle: 'token',
    defaultColumns: ['token', 'customer', 'status', 'currency', 'updatedAt'],
    group: 'Commerce',
    description:
      'Server-side bags. Totals are never stored here — they are recalculated from the live catalogue on every request.',
  },

  /**
   * **A customer may read their bag through the API; they may not write it.**
   *
   * §7.1b grants a customer write access to two things — their wishlist and their addresses — and a
   * cart is neither. That is not an oversight in the plan: every mutation of a bag has server-side
   * consequences the browser must not be trusted with. Quantity is bounded by live inventory and by
   * `maxQuantityPerLine` (§14.1b), a line's variant has to still exist and still be purchasable, and
   * the promotion attached to the cart has to be revalidated. **Phase 14** performs all of that in
   * server code through the Local API, which runs past these rules; opening `PATCH /api/carts` would
   * put a second, unvalidated door onto the same table.
   *
   * A guest's bag has no `customer`, so `ownedByCustomer` refuses it — a guest cart is addressed by
   * its unguessable `token` from server code, and Phase 14 owns that path.
   */
  access: {
    read: ownedByCustomer('customer'),
    create: isStaff,
    update: isStaff,
    delete: isAdmin,
  },

  fields: [
    {
      /**
       * 32 bytes of CSPRNG entropy, base64url. Generated here so that a cart cannot exist without
       * one; Phase 14 owns issuing it to the browser in an HTTP-only cookie, and may supply its own
       * value, which this leaves alone.
       *
       * Guessing a token is reading a stranger's bag, so the width matters: 256 bits is not
       * brute-forceable, and it is not derived from anything about the customer.
       */
      name: 'token',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'The guest cart identifier. Issued by the server, never by the browser.',
      },
      hooks: {
        beforeValidate: [({ value }) => value ?? randomBytes(32).toString('base64url')],
      },
    },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      index: true,
      admin: {
        description: 'Empty for a guest bag. Set when a guest signs in and the carts are merged.',
      },
    },
    {
      name: 'items',
      type: 'join',
      collection: 'cart-items',
      on: 'cart',
      admin: { description: 'The lines in this bag.' },
    },
    {
      name: 'currency',
      type: 'select',
      required: true,
      defaultValue: DEFAULT_CURRENCY,
      options: [...CURRENCY_OPTIONS],
      admin: {
        description:
          'Fixed when the bag is created, so a later change to the store default cannot reprice an open bag.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      index: true,
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Converted to an order', value: 'converted' },
      ],
      admin: { description: 'A converted bag is history. Nothing may be added to it.' },
    },
    {
      name: 'promotion',
      type: 'relationship',
      relationTo: 'promotions',
      admin: {
        description:
          'The applied discount code — one per bag (DEV-08). Its validity is rechecked on every read and again at checkout.',
      },
    },
    {
      /**
       * A bag is not permanent. Thirty days is long enough that a shopper who comes back next
       * weekend finds their bag, and short enough that the table does not become a permanent record
       * of every anonymous visit — which matters because a cart with no customer is still personal
       * data by association.
       *
       * Nothing here deletes an expired cart. The column is what makes a sweep possible; the sweep
       * itself is a maintenance task, and no phase has claimed it yet.
       */
      name: 'expiresAt',
      type: 'date',
      required: true,
      index: true,
      defaultValue: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Thirty days from creation by default. An expired bag is treated as empty.',
      },
    },
  ],

  hooks: {
    /**
     * `cart-items.cart` is required, so it is `NOT NULL` with `ON DELETE SET NULL` — deleting a cart
     * with lines in it fails on a not-null violation unless the lines go first. See
     * `hooks/cascadeDelete.ts`; carts are not soft-deleted, so this is the only delete path there is.
     */
    beforeDelete: [cascadeDelete([{ collection: 'cart-items', on: 'cart' }])],
  },
}
