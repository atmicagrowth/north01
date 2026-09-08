import { randomInt } from 'crypto'

import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff, nobody, ownedByCustomer } from '../access'
import { addressFields } from '../fields/address'
import { CURRENCY_OPTIONS, DEFAULT_CURRENCY, minorUnits } from '../fields/money'
import { cascadeDelete } from '../hooks/cascadeDelete'

/**
 * The durable record of a purchase — the one table in this schema that must still be readable and
 * still be *true* years after every product in it has been edited or withdrawn.
 *
 * ---
 *
 * ### Order state is two axes
 *
 * Plan §18.1b draws one linear machine (`DRAFT → CHECKOUT_STARTED → PAID → PROCESSING → SHIPPED →
 * DELIVERED`, with `PAYMENT_FAILED`, `REFUNDED` and `CANCELLED` branching off). Feature matrix §21
 * stores *"payment status"* and *"fulfillment status"* as two fields. Both are satisfied by carrying
 * two columns and deriving the plan's single machine for display — decision **D-05**, deviation
 * **DEV-03**, resolving gap **G-11**.
 *
 * It is not a compromise between two documents; a single axis genuinely cannot express the two
 * states this business has. "Paid, not yet picked" and "refunded after it shipped" both need a
 * payment fact and a fulfilment fact at once, and a linear enum has room for only one of them.
 *
 * `PENDING_PAYMENT` is included per **DEV-02** / **C-05**: plan §17.1c lists it among the allowed
 * states while §18.1b's diagram omits it, and plan §31.1f requires a *"payment succeeded but webhook
 * not yet reflected"* screen — which needs a state to render. Without it, the window between
 * creating a Checkout Session and the webhook arriving is unrepresentable.
 *
 * **Transitions are not restricted here.** Plan §18.1b's *"do not let arbitrary transitions happen
 * from the admin UI"* and §18.1c's server-side authorisation are **Phase 18**. This phase defines
 * the vocabulary those rules will be written in; a half-built state machine enforced by a field hook
 * would be a rule to work around rather than a rule to rely on.
 *
 * ---
 *
 * ### What "authoritative" means for this table
 *
 * Every money column is written by the server from server-derived values. `docs/ARCHITECTURE.md` §2:
 * the browser is never authoritative for a total, and *a browser reaching the success page is not
 * payment* — only a signature-verified Stripe webhook moves `paymentStatus` to `paid` (plan §17.1d).
 * That rule is enforced in Phase 17's webhook handler, not by this config; what this config does is
 * make sure the fields that rule protects all exist in one row, so there is one place to look.
 *
 * ### Why the addresses are copies and not references
 *
 * Plan §6.1k asks for *"shipping address snapshot"* and *"billing address snapshot"* in those words.
 * A relationship to `addresses` would mean a customer editing their saved address rewrites where a
 * parcel was sent last year, and deleting it would blank the field entirely — `ON DELETE SET NULL`.
 * See `fields/address.ts`.
 *
 * ### Why the order number is not the primary key
 *
 * Decision **D-17**: primary keys stay `serial`, and *"where an identifier becomes customer-visible,
 * the order number in particular, that phase adds an opaque public column beside the primary key"*.
 * This is that column. `#1043` tells a customer how many orders the shop has taken and lets them
 * try `#1042`; `N01-7K4QX2M9` tells them nothing and cannot be walked.
 */

/**
 * Crockford's base32 alphabet minus `I`, `L`, `O` and `U` — the four that a customer reading an
 * order number aloud, or typing it into the tracking form in structure §18, gets wrong. 32^8 is
 * about 1.1 × 10^12, so a collision is vanishingly unlikely; if one ever happens the unique index
 * rejects the insert with a clear error rather than silently issuing a duplicate, and the caller
 * retries.
 */
const ORDER_NUMBER_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const generateOrderNumber = (): string => {
  let suffix = ''

  for (let index = 0; index < 8; index += 1) {
    suffix += ORDER_NUMBER_ALPHABET[randomInt(ORDER_NUMBER_ALPHABET.length)]
  }

  return `N01-${suffix}`
}

export const Orders: CollectionConfig = {
  slug: 'orders',

  admin: {
    useAsTitle: 'orderNumber',
    defaultColumns: [
      'orderNumber',
      'email',
      'paymentStatus',
      'fulfillmentStatus',
      'totalMinor',
      'createdAt',
    ],
    group: 'Commerce',
    description:
      'Durable purchase records. Item names, prices and addresses are frozen at purchase.',
  },

  /**
   * `docs/DATABASE.md` §8 names orders as the collection where a delete must be recoverable, and it
   * is the strongest case in the schema: an order is a financial record, and a mis-click in the
   * admin panel must not be the end of it.
   */
  trash: true,

  defaultSort: '-createdAt',

  /**
   * **§7.1b's sharpest line: a customer may read their own orders and may not read anyone else's.**
   *
   * `ownedByCustomer` returns a `Where`, so the cross-account attempt is not a 403 that confirms the
   * order exists — it is an empty result, which confirms nothing. That distinction is the difference
   * between "you may not see order 1042" and "there is no order 1042 for you".
   *
   * **`create` is `nobody`, deliberately, and that includes admins.** An order is not authored; it is
   * the record of something that happened. Plan §17 creates it from the checkout and finalises it
   * from a signature-verified Stripe webhook, both in server code through the Local API, which does
   * not consult this rule. What `nobody` forbids is `POST /api/orders` — a request that could only
   * ever be someone inventing a purchase, whoever they are.
   *
   * `update` is staff, because fulfilment status, tracking numbers and refunds are administered
   * (§18.1c). The transitions themselves are Phase 18's; this only says who may attempt one.
   */
  access: {
    read: ownedByCustomer('customer'),
    create: nobody,
    update: isStaff,
    delete: isAdmin,
  },

  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Order',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'paymentStatus',
                  type: 'select',
                  required: true,
                  defaultValue: 'draft',
                  index: true,
                  options: [
                    { label: 'Draft', value: 'draft' },
                    { label: 'Checkout started', value: 'checkout_started' },
                    { label: 'Pending payment', value: 'pending_payment' },
                    { label: 'Paid', value: 'paid' },
                    { label: 'Payment failed', value: 'payment_failed' },
                    { label: 'Refunded', value: 'refunded' },
                    { label: 'Cancelled', value: 'cancelled' },
                  ],
                  admin: {
                    width: '50%',
                    description:
                      'Moved to Paid only by a signature-verified Stripe webhook — never by a browser reaching the success page.',
                  },
                },
                {
                  name: 'fulfillmentStatus',
                  type: 'select',
                  required: true,
                  defaultValue: 'unfulfilled',
                  index: true,
                  options: [
                    { label: 'Unfulfilled', value: 'unfulfilled' },
                    { label: 'Processing', value: 'processing' },
                    { label: 'Shipped', value: 'shipped' },
                    { label: 'Delivered', value: 'delivered' },
                    { label: 'Cancelled', value: 'cancelled' },
                  ],
                  admin: {
                    width: '50%',
                    description:
                      'Independent of payment. An order can be refunded after it shipped.',
                  },
                },
              ],
            },
            {
              name: 'items',
              type: 'join',
              collection: 'order-items',
              on: 'order',
              admin: {
                description:
                  'The purchased lines, frozen at purchase. Editing a product does not change them.',
              },
            },
            {
              /**
               * The customer *may* be null — plan §14.1a and structure §16 both allow a guest to buy
               * without an account — and it may *become* null, because deleting a customer nulls it
               * (`ON DELETE SET NULL`). `email` below is required for exactly that reason: it is the
               * order's own copy of who placed it, and it survives both cases.
               */
              name: 'customer',
              type: 'relationship',
              relationTo: 'customers',
              index: true,
              admin: {
                description: 'Empty for a guest purchase, and after an account is deleted.',
              },
            },
            {
              /**
               * **The bag this order was raised from** — plan §17.1a step 10's *"create or update
               * pending order context"*, which needs a key to find the pending order by.
               *
               * Navigation, not data. It is nullable and `ON DELETE SET NULL`, so a converted or
               * expired cart being cleaned up leaves the order intact — an order is a snapshot
               * (`docs/ARCHITECTURE.md` §2) and nothing about it may depend on a row that is designed
               * to be temporary. Its only job is to let a second checkout attempt find the first
               * attempt's order instead of creating a second one, so that a customer who changes
               * their mind twice does not leave three abandoned orders behind.
               *
               * Added in **Phase 17**. Nothing before it wrote here.
               */
              name: 'cart',
              type: 'relationship',
              relationTo: 'carts',
              index: true,
              admin: {
                readOnly: true,
                description: 'The bag this order came from, while that bag still exists.',
              },
            },
            {
              name: 'email',
              type: 'email',
              required: true,
              index: true,
              admin: {
                description:
                  'Where the confirmation was sent, as given at checkout. A snapshot — not read from the customer record.',
              },
            },
          ],
        },
        {
          label: 'Money',
          fields: [
            {
              name: 'currency',
              type: 'select',
              required: true,
              defaultValue: DEFAULT_CURRENCY,
              options: [...CURRENCY_OPTIONS],
              admin: { description: 'Fixed at checkout. Every amount below is in this currency.' },
            },
            {
              type: 'row',
              fields: [
                minorUnits({
                  name: 'subtotalMinor',
                  label: 'Subtotal',
                  required: true,
                  defaultValue: 0,
                  admin: {
                    width: '50%',
                    description: 'The sum of the line totals, before anything else.',
                  },
                }),
                minorUnits({
                  name: 'discountMinor',
                  label: 'Discount',
                  required: true,
                  defaultValue: 0,
                  admin: {
                    width: '50%',
                    description: 'Recalculated server-side at checkout — plan §15.1a.',
                  },
                }),
              ],
            },
            {
              type: 'row',
              fields: [
                minorUnits({
                  name: 'shippingMinor',
                  label: 'Shipping',
                  required: true,
                  defaultValue: 0,
                  admin: { width: '50%' },
                }),
                minorUnits({
                  name: 'taxMinor',
                  label: 'Tax',
                  required: true,
                  defaultValue: 0,
                  admin: {
                    width: '50%',
                    description: 'The authoritative amount used for the transaction — plan §16.1d.',
                  },
                }),
              ],
            },
            minorUnits({
              name: 'totalMinor',
              label: 'Total',
              required: true,
              defaultValue: 0,
              index: true,
              admin: {
                description:
                  'What was charged. Stored rather than derived so it can be compared against Stripe and never silently recomputed.',
              },
            }),
            {
              type: 'row',
              fields: [
                {
                  name: 'promotion',
                  type: 'relationship',
                  relationTo: 'promotions',
                  admin: {
                    width: '50%',
                    description: 'The promotion applied — one per order (DEV-08).',
                  },
                },
                {
                  /**
                   * The code as it was, beside the relationship. A promotion can be renamed, expired
                   * or deleted; the order has to keep saying which code produced its discount, and
                   * the relationship alone cannot promise that.
                   */
                  name: 'discountCode',
                  type: 'text',
                  admin: {
                    width: '50%',
                    readOnly: true,
                    description:
                      'Snapshot of the code used. Survives the promotion being renamed or deleted.',
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Delivery',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'shippingMethodCode',
                  type: 'text',
                  index: true,
                  admin: {
                    width: '50%',
                    description:
                      'The normalised method ID from the shipping provider — plan §16.1a.',
                  },
                },
                {
                  name: 'shippingMethodLabel',
                  type: 'text',
                  admin: {
                    width: '50%',
                    description:
                      'As the customer chose it — "Express". A snapshot; the rate card may change.',
                  },
                },
              ],
            },
            {
              name: 'shippingAddress',
              type: 'group',
              label: 'Shipping address (snapshot)',
              admin: {
                description:
                  'Frozen at purchase. Empty on a draft order — checkout preflight is what requires it (plan §17.1a, DEV-11).',
              },
              fields: addressFields({ required: false }),
            },
            {
              name: 'billingAddress',
              type: 'group',
              label: 'Billing address (snapshot)',
              admin: {
                description: 'Frozen at purchase. Defaults to the shipping address at checkout.',
              },
              fields: addressFields({ required: false }),
            },
          ],
        },
        {
          label: 'Fulfilment',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'carrier',
                  type: 'text',
                  admin: {
                    width: '50%',
                    description: 'Required in practice when marking shipped — plan §18.1c.',
                  },
                },
                {
                  name: 'trackingNumber',
                  type: 'text',
                  index: true,
                  admin: { width: '50%' },
                },
              ],
            },
            {
              name: 'trackingUrl',
              type: 'text',
              admin: {
                description:
                  "The carrier's tracking page. Manually managed for the demo — structure §18 allows exactly this.",
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'shippedAt',
                  type: 'date',
                  admin: { width: '50%', date: { pickerAppearance: 'dayAndTime' } },
                },
                {
                  name: 'deliveredAt',
                  type: 'date',
                  admin: { width: '50%', date: { pickerAppearance: 'dayAndTime' } },
                },
              ],
            },
          ],
        },
        {
          label: 'Stripe',
          fields: [
            {
              /**
               * Plan §17.1b attaches internal references through Stripe metadata so the webhook can
               * find its way back to this row; these two are the other direction, and they are what
               * make a duplicate finalisation detectable. They are unique so that two orders cannot
               * both claim the same payment.
               *
               * Read-only, and populated by **Phase 17**. Nothing before it writes here — a hand-typed
               * payment intent is an order attached to somebody else's money.
               */
              name: 'stripeCheckoutSessionId',
              type: 'text',
              unique: true,
              index: true,
              admin: {
                readOnly: true,
                description: 'Set when the Checkout Session is created (Phase 17).',
              },
            },
            {
              name: 'stripePaymentIntentId',
              type: 'text',
              unique: true,
              index: true,
              admin: {
                readOnly: true,
                description: 'Set from the verified webhook event (Phase 17).',
              },
            },
            {
              name: 'paidAt',
              type: 'date',
              admin: {
                readOnly: true,
                date: { pickerAppearance: 'dayAndTime' },
                description:
                  'When the verified webhook confirmed payment. Distinct from createdAt, which is when the draft was made.',
              },
            },
          ],
        },
      ],
    },

    {
      name: 'orderNumber',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'The customer-facing reference. Opaque and non-sequential — decision D-17.',
      },
      hooks: {
        beforeValidate: [({ value }) => value ?? generateOrderNumber()],
      },
    },
  ],

  hooks: {
    /**
     * Reached only by a permanent delete from the trash view — the admin panel's ordinary delete is
     * an update that sets `deletedAt`. `includeTrashed` matters here and nowhere else: an order line
     * can be in the trash independently of its order, and leaving one behind would strand an
     * unattributable financial record. See `hooks/cascadeDelete.ts`.
     */
    beforeDelete: [
      cascadeDelete([{ collection: 'order-items', on: 'order', includeTrashed: true }]),
    ],
  },
}
