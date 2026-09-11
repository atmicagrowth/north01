import { randomInt } from 'crypto'

import type { CollectionConfig } from 'payload'

import { isAdmin, isAdminField, isStaff, nobody, nobodyField, ownedByCustomer } from '../access'
import { addressFields } from '../fields/address'
import { CURRENCY_OPTIONS, DEFAULT_CURRENCY, minorUnits } from '../fields/money'
import { cascadeDelete } from '../hooks/cascadeDelete'
import { enforceOrderTransitions } from '../hooks/orderTransitions'
import { queueOrderEmails } from '../hooks/queueOrderEmails'

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
 * **Transitions are enforced in `hooks/orderTransitions.ts`, not in this config.** Phase 6 defined the
 * vocabulary and said so; Phase 18 wrote §18.1b's machine against it and hung it on `beforeChange`,
 * which is the one place every write path passes through. Nothing here restates those rules — a
 * second copy in a field validator is a copy that eventually disagrees.
 *
 * ---
 *
 * ### What Phase 28 added, and what it deliberately did not
 *
 * §28.1b is *"search order, view order, view payment status, update fulfillment status, add tracking,
 * refund according to a controlled workflow"*, and most of it was already true — the two axes are
 * here, `paymentStatus` has been closed to the browser since Phase 17, the refund columns have only
 * ever been written by a signed `charge.refunded`. What Phase 28 changed is almost entirely **what the
 * panel says**, on the grounds that a guardrail nobody can see is indistinguishable from a bug:
 *
 * - `listSearchableFields`, so one box finds an order by number, email, tracking or Stripe id.
 * - Tab-level descriptions on Fulfilment, Money and Stripe, because the rule an editor needs arrives
 *   at the top of the tab rather than as a refusal after they have already chosen wrong.
 * - `disableBulkEdit` on the four fulfilment fields — see the note on `fulfillmentStatus`.
 * - The money columns closed to the browser, which had been an editable financial record. See the
 *   Money tab.
 *
 * It added **no refund action**, no custom dashboard and no new column. The reasoning for the first is
 * on the Stripe tab and is the load-bearing one: only a signature-verified webhook may say an order
 * was refunded, so a control that appeared to refund would be lying about the one fact this
 * application is least allowed to be wrong about.
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
      'Durable purchase records. Item names, prices and addresses are frozen at purchase. ' +
      'Search by order number, customer email, tracking number, or a Stripe id copied out of the ' +
      'Stripe dashboard.',

    /**
     * **§28.1b's *"search order"*, which has to be one box or it is not a support tool.**
     *
     * Payload's list search is not full-text and does not search everything: `mergeListSearchAndWhere`
     * builds `{ or: [...] }` from `admin.listSearchableFields`, and **falls back to `useAsTitle` alone**
     * when the key is absent. So until this phase the box matched `orderNumber` and nothing else — a
     * support agent holding a customer's email address, or a Stripe id, or a carrier reference, got an
     * empty list and no hint that they were searching the wrong column.
     *
     * The five below are the five handles this shop's orders are actually found by, and each is here
     * for a call that really happens:
     *
     * | Field | The call it answers |
     * |---|---|
     * | `orderNumber` | *"My order is N01-7K4QX2M9."* The reference on the confirmation email. |
     * | `email` | *"I can't find the number."* Also the **only** handle a guest order has — `customer` is null for one, so the customer list cannot reach it. |
     * | `trackingNumber` | *"Where is my parcel?"*, arriving from the carrier's side rather than ours. |
     * | `stripePaymentIntentId` | The refund direction. A refund starts in the Stripe dashboard (see the Stripe tab), and the operator comes back holding `pi_…` needing the order it belongs to. |
     * | `stripeCheckoutSessionId` | The one handle that exists **before** payment, so it is the only way to find an order that never produced a payment intent — the *"I was charged and you have no record of me"* call, which is exactly the abandoned or failed checkout. |
     *
     * **Five is a deliberate ceiling, not a shrug.** Each entry becomes another `ILIKE '%term%'` in the
     * same `OR`, and a leading wildcard means no btree index can serve any of them however well indexed
     * the columns are. Five OR'd sequential scans on an orders table is fine and twelve is not, so the
     * list stays at the fields a person types rather than every field a person might.
     *
     * Deliberately absent: `discountCode` and `shippingMethodLabel` (low-cardinality — searching
     * "Express" returns half the table, which is a filter's job and the list view already has filters)
     * and the address fields (they are a `group`, so the dotted path is not what the search builder
     * emits, and a name search that quietly matched nothing would be worse than no name search).
     */
    listSearchableFields: [
      'orderNumber',
      'email',
      'trackingNumber',
      'stripePaymentIntentId',
      'stripeCheckoutSessionId',
    ],
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
                  /*
                   * **Not editable from a browser, by anyone.**
                   *
                   * `AGENTS.md` states it without qualification: *"Only a signature-verified Stripe
                   * webhook marks an order paid."* Phase 17 made that structural in three places —
                   * the state machine refuses `draft → paid`, the success page has no write path,
                   * and `fulfil.ts` is the only code that writes the value — and Phase 17's second
                   * sweep found the fourth door still open: a staff member could type it here.
                   *
                   * `nobodyField` is what closes it, and `readOnly` is only how the panel says so.
                   * Field access is skipped for `overrideAccess: true`, so the webhook's own write
                   * is unaffected — which is the whole point: the server path stays open and the
                   * browser path does not exist.
                   *
                   * Administrative transitions that are *not* payment facts — cancelling an order,
                   * recording a refund — belong to §18.1c as deliberate actions with their own
                   * reasons and audit, not as a free-text edit of the field the webhook owns.
                   */
                  name: 'paymentStatus',
                  type: 'select',
                  required: true,
                  defaultValue: 'draft',
                  index: true,
                  access: { update: nobodyField },
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
                    readOnly: true,
                    width: '50%',
                    description:
                      'Set by a signature-verified Stripe webhook, and by nothing else. Not editable here — reaching the success page is not payment, and neither is typing in this box. A refund is started in Stripe and lands here as "Refunded" once Stripe has confirmed the money went back; see the Stripe tab.',
                  },
                },
                {
                  /*
                   * **The one status a person sets by hand, and the one §28.1d is about.**
                   *
                   * `hooks/orderTransitions.ts` decides every change against §18.1b's machine, on every
                   * write path — the panel, the REST API, and Payload's bulk edit, which routes through
                   * `updateDocument` and therefore runs collection `beforeChange` hooks per document
                   * exactly as a single save does. So bulk edit was never a **bypass**.
                   *
                   * `disableBulkEdit` is here for a different reason: bulk edit is Payload's *"set one
                   * value on N documents"* tool, and there is no fulfilment value that is correct for N
                   * orders at once.
                   *
                   * - `processing` is, in this shop's own words (`lib/orders/rules.ts`), *"where a human
                   *   picked the order"*. Asserting thirty picks with one click asserts thirty things
                   *   nobody did, and it is the state that then gates dispatch.
                   * - `shipped` sends a dispatch email per order (§18.1c) carrying that order's tracking
                   *   number. A mixed selection — some orders with tracking, some without — half-applies:
                   *   the ones that pass are mailed and cannot be unmailed, the ones that fail are not,
                   *   and the operator is told only *"Unable to update 18 out of 30 Orders"*.
                   *
                   * That last sentence is literal. Payload's bulk endpoint collects a per-document
                   * `error.message` and the admin toasts the **summary** instead (`Form/index.js` returns
                   * early on `json.message`), so the reasons this hook produces never reach the screen on
                   * that path. Closing the affordance is the fix; the field-level message below is what an
                   * ordinary single-order save gets, and it is legible there.
                   *
                   * A REST client can still `PATCH /api/orders?where=…`. That is staff-authenticated and
                   * still fully governed by the machine — it is simply not the admin UI, which is what
                   * §28.1d scopes.
                   */
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
                    disableBulkEdit: true,
                    width: '50%',
                    description:
                      'The only status you set by hand, one order at a time. Move it one step: Unfulfilled to Processing once someone has picked the order, Processing to Shipped once the carrier and tracking number are saved in the Fulfilment tab — that sends the customer a dispatch email — then Shipped to Delivered. Delivered and Cancelled are ends: nothing follows them, so do not use them to park an order. Cancel before dispatch, not after. Anything else is refused and tells you why.',
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
              /* Plan §34.1d: re-pointing this hands the order to another account. Server-written only. */
              access: { update: nobodyField },
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
              /* Plan §34.1d: re-pointing this hands the order to another account. Server-written only. */
              access: { update: nobodyField },
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
              /* Plan §34.1d: changing it redirects every later email about the order. Server-written only. */
              access: { update: nobodyField },
              admin: {
                description:
                  'Where the confirmation was sent, as given at checkout. A snapshot — not read from the customer record.',
              },
            },
          ],
        },
        {
          label: 'Money',

          /*
           * **Phase 28 closed the last door on this tab, and it was standing wide open.**
           *
           * Every amount here was an ordinary editable number. `Orders.access.update` is `isStaff`, so
           * a staff member could retype the total of a paid order — and the field's own description
           * already claimed the opposite, *"what was charged… never silently recomputed"*, which made
           * it precisely the fake control §0.1.17 forbids: a box that says it is a record and behaves
           * like a draft.
           *
           * It is also §28.1d read at its widest. The phase asks that *"invalid commerce states cannot
           * be created accidentally"*, and the cheapest invalid state in this whole schema was an order
           * whose `totalMinor` disagrees with the Stripe charge it is supposed to reconcile against.
           * Nobody would do it on purpose; the panel let a mis-keyed digit do it by accident, silently,
           * on a financial record with no version history.
           *
           * So the same treatment `paymentStatus` already has: `nobodyField` closes the browser path,
           * `readOnly` is only how the panel says so. Every writer of these columns —
           * `checkout/preflight.ts`, `checkout/session.ts`, `checkout/fulfil.ts` — goes through the
           * Local API with `overrideAccess: true`, which skips field access, so the server path is
           * untouched. That asymmetry is the whole design: the browser is never authoritative for a
           * total (`docs/ARCHITECTURE.md` §2), and *neither is the admin panel*.
           *
           * **What to do instead**, and it is the honest answer rather than a smaller box: money that
           * needs to move after checkout moves at Stripe. Overcharged is a partial refund; undercharged
           * is a second payment. Both are decisions with money attached, both leave a signed webhook
           * behind, and neither is a number typed into a form.
           *
           * `readOnly` also removes them from bulk edit for free — `reduceFieldOptions` skips `readOnly`,
           * `unique` and hidden fields when building the bulk-edit field picker.
           */
          admin: {
            description:
              'A copy of what Stripe charged, kept so the two can be compared. None of it can be typed here, by anyone. If an amount is wrong, the correction is a refund or a second payment in Stripe — changing the number here would only make our record disagree with the money.',
          },

          fields: [
            {
              name: 'currency',
              type: 'select',
              required: true,
              defaultValue: DEFAULT_CURRENCY,
              options: [...CURRENCY_OPTIONS],
              access: { update: nobodyField },
              admin: {
                readOnly: true,
                description:
                  'Fixed at checkout. Every amount below is in this currency — changing it later would not convert anything, it would just relabel the numbers.',
              },
            },
            {
              type: 'row',
              fields: [
                minorUnits({
                  name: 'subtotalMinor',
                  label: 'Subtotal',
                  required: true,
                  defaultValue: 0,
                  access: { update: nobodyField },
                  admin: {
                    readOnly: true,
                    width: '50%',
                    description: 'The sum of the line totals, before anything else.',
                  },
                }),
                minorUnits({
                  name: 'discountMinor',
                  label: 'Discount',
                  required: true,
                  defaultValue: 0,
                  access: { update: nobodyField },
                  admin: {
                    readOnly: true,
                    width: '50%',
                    description:
                      'What the promotion took off, as the server recalculated it at checkout — plan §15.1a. Never what the customer said it should be.',
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
                  access: { update: nobodyField },
                  admin: {
                    readOnly: true,
                    width: '50%',
                    description: 'What was charged for delivery, from the rate quoted at checkout.',
                  },
                }),
                minorUnits({
                  name: 'taxMinor',
                  label: 'Tax',
                  required: true,
                  defaultValue: 0,
                  access: { update: nobodyField },
                  admin: {
                    readOnly: true,
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
              access: { update: nobodyField },
              admin: {
                readOnly: true,
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
                  access: { update: nobodyField },
                  admin: {
                    width: '50%',
                    readOnly: true,
                    description:
                      'Snapshot of the code used, exactly as the customer typed it. Survives the promotion being renamed or deleted.',
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
              /* Plan §34.1d: correcting where a parcel goes is an admin's call, not an editor's. */
              access: { update: isAdminField },
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
              /* Plan §34.1d: correcting where a parcel goes is an admin's call, not an editor's. */
              access: { update: isAdminField },
              admin: {
                description: 'Frozen at purchase. Defaults to the shipping address at checkout.',
              },
              fields: addressFields({ required: false }),
            },
          ],
        },
        {
          label: 'Fulfilment',

          /*
           * **§28.1b's *"add tracking"*, made legible at the point of use.**
           *
           * `planFulfillmentChange` refuses `→ shipped` unless a carrier **and** a tracking number are
           * both present and non-blank, and until this phase the only place that requirement appeared
           * was in the refusal itself — the editor picked Shipped, saved, and learned the rule from a
           * server error, having already committed to the wrong order of operations.
           *
           * A tab description is the cheapest correct fix: Payload renders it at the top of the active
           * tab, above the two fields it is about, before anything is typed. Considered and rejected:
           * `admin.condition` to reveal the fields only when Shipped is selected, which is backwards —
           * these are exactly the fields that must be filled in **before** the status moves, and hiding
           * them until after would guarantee the failure it was meant to prevent.
           */
          admin: {
            description:
              'Fill in the carrier and the tracking number here first and save. Then set Fulfilment status to Shipped on the Order tab — in that order, because Shipped is refused while either is empty. Marking an order shipped emails the customer whatever is in these boxes at that moment, and an email cannot be recalled.',
          },

          fields: [
            {
              type: 'row',
              fields: [
                {
                  /*
                   * Both of these are per-parcel by definition, so both are out of bulk edit for the
                   * same reason `fulfillmentStatus` is: one tracking number applied to thirty orders is
                   * not a shortcut, it is thirty customers sent someone else's parcel reference in a
                   * dispatch email (`emails/messages.tsx`, `orderShipped`). There is no version of that
                   * operation that is right, so the panel should not offer it.
                   */
                  name: 'carrier',
                  type: 'text',
                  admin: {
                    disableBulkEdit: true,
                    width: '50%',
                    description:
                      'Who is carrying it, spelled as the customer should read it — "DHL", "Royal Mail". Required together with the tracking number before this order can be marked Shipped, and it appears in the dispatch email.',
                  },
                },
                {
                  name: 'trackingNumber',
                  type: 'text',
                  index: true,
                  admin: {
                    disableBulkEdit: true,
                    width: '50%',
                    description:
                      "The carrier's reference for this parcel. Required with the carrier before Shipped. It goes into the dispatch email exactly as typed, so check it against the label — a wrong number here is a wrong number in the customer's inbox. One order, one reference; do not reuse another order's.",
                  },
                },
              ],
            },
            {
              name: 'trackingUrl',
              type: 'text',
              admin: {
                disableBulkEdit: true,
                description:
                  'The carrier\'s tracking page for this parcel — it becomes the "Track this parcel" button in the dispatch email. Optional: leave it empty and the email simply shows the carrier and the number instead. Manually managed for the demo, which structure §18 allows.',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  /*
                   * Written by the transition, not typed beside it — see `hooks/orderTransitions.ts`.
                   * A dispatch date a person can set independently of the status is a date that will
                   * eventually disagree with it, and §18.1c hangs a shipment email off the transition
                   * rather than off the timestamp.
                   */
                  name: 'shippedAt',
                  type: 'date',
                  access: { update: nobodyField },
                  admin: {
                    width: '50%',
                    readOnly: true,
                    date: { pickerAppearance: 'dayAndTime' },
                    description:
                      'Stamped automatically the moment the status became Shipped. Empty means it has not been dispatched — it never means the date is unknown.',
                  },
                },
                {
                  name: 'deliveredAt',
                  type: 'date',
                  access: { update: nobodyField },
                  admin: {
                    width: '50%',
                    readOnly: true,
                    date: { pickerAppearance: 'dayAndTime' },
                    description:
                      'Stamped automatically when the status became Delivered. Empty until someone records the arrival.',
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Stripe',

          /**
           * **§28.1b's *"refund according to a controlled workflow"* — and the controlled workflow is
           * that this panel does not issue refunds.**
           *
           * Every field in this tab is written by a signature-verified webhook and by nothing else, and
           * that was already true before Phase 28. What was missing was that anyone could **tell**: a
           * tab of greyed-out boxes named `refundedAt` and `refundedMinor` reads, to the person whose
           * job this is, like a refund form that is broken. So the tab now says where a refund is
           * actually started, what these fields are, and what is deliberately not here.
           *
           * ### Why there is no "Refund" button, and why adding one would be a defect
           *
           * A control here could do one of two things and both are wrong:
           *
           * 1. **Write the fields.** It would record a refund that never happened. The customer's money
           *    would not move, the shop's own record would say it had, and Stripe — the payment
           *    authority — would disagree with us. This is `AGENTS.md`'s *"never build UI that looks
           *    functional but does nothing"* in its most expensive form.
           * 2. **Call the Stripe API.** Then the panel becomes a second thing that can move money, on a
           *    single click, with no confirmation step Stripe's own dashboard does not already provide,
           *    no partial-amount validation of its own, and no protection against a double submit. And
           *    it would *still* not be what marks the order refunded: `charge.refunded` arriving signed
           *    is, because `AGENTS.md` allows nothing else to. A button that starts a refund and then
           *    waits for a webhook to tell it what happened is a worse version of opening Stripe.
           *
           * So the workflow is: refund the payment in the Stripe dashboard, which is where refunds are
           * reviewed, amounts are chosen and reasons are recorded; `charge.refunded` arrives; `fulfil.ts`
           * writes `refundedAt`, `refundedMinor` and `paymentStatus`. One authority, one direction, and
           * the panel is an honest mirror of it. Recorded under `schemaChangesNeeded` rather than built.
           */
          admin: {
            description:
              'Nothing in this tab is typed by hand — it is what Stripe has told us, arriving signed. To refund an order, open the payment in the Stripe dashboard and refund it there; Stripe moves the money and then reports back, and these fields fill in on their own within seconds. There is no refund button here on purpose: one that marked an order refunded without moving any money would be worse than none at all.',
          },

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
              access: { update: nobodyField },
              admin: {
                readOnly: true,
                description:
                  'Stripe\'s id for the checkout attempt ("cs_…"), set when the session is created. It exists even when payment never completed, so it is the handle to search on when a customer believes they were charged and there is no payment against the order.',
              },
            },
            {
              name: 'stripePaymentIntentId',
              type: 'text',
              unique: true,
              index: true,
              access: { update: nobodyField },
              admin: {
                readOnly: true,
                description:
                  'Stripe\'s id for the payment itself ("pi_…"), set from the verified webhook. Paste it into Stripe to find this order\'s payment — or paste it into the search box above to come back the other way.',
              },
            },
            {
              name: 'paidAt',
              type: 'date',
              access: { update: nobodyField },
              admin: {
                readOnly: true,
                date: { pickerAppearance: 'dayAndTime' },
                description:
                  'When the verified webhook confirmed payment. Distinct from createdAt, which is when the draft was made.',
              },
            },
            {
              /*
               * §18.1b's `PAID → REFUNDED`, recorded rather than implied. A refund with no amount and
               * no date is a status, and a status is not a financial record — a partial refund and a
               * full one both land on the same word, and only the number tells them apart.
               *
               * Written from Stripe's `charge.refunded` event and from nowhere else, for the same
               * reason `paidAt` is: money moved somewhere this application does not control, and the
               * only trustworthy account of it is the one that arrives signed.
               */
              type: 'row',
              fields: [
                {
                  name: 'refundedAt',
                  type: 'date',
                  access: { update: nobodyField },
                  admin: {
                    width: '50%',
                    readOnly: true,
                    date: { pickerAppearance: 'dayAndTime' },
                    description:
                      'When Stripe confirmed the refund, from the signed event. Empty means no refund has been reported — it does not mean a refund was refused, and it does not mean one is not in progress at Stripe.',
                  },
                },
                minorUnits({
                  name: 'refundedMinor',
                  label: 'Refunded',
                  access: { update: nobodyField },
                  admin: {
                    width: '50%',
                    readOnly: true,
                    /*
                     * The spine, on the one field where getting it wrong costs money: **null means
                     * UNKNOWN, 0 means NONE.** Empty here is "Stripe has not reported a refund"; a
                     * literal 0 would be "a refund of nothing was reported", which is a different and
                     * much stranger fact. The copy has to make that difference readable to someone
                     * deciding whether to refund again.
                     */
                    description:
                      'How much came back, in minor units, as Stripe reported it — 1999 is 19.99. Partial refunds are ordinary, so this is often less than the total. Empty means no refund has been reported at all; check Stripe before assuming nothing was sent back.',
                  },
                }),
              ],
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
     * §18.1b: *"Do not let arbitrary transitions happen from the admin UI."* The rules are in
     * `lib/orders/rules.ts`; this is what makes every write obey them, including one that never goes
     * near the panel.
     */
    beforeChange: [enforceOrderTransitions],

    /**
     * §18.1c's shipment email, and its delivered counterpart. It **queues**; it does not send —
     * `afterChange` runs inside the open transaction, so a send here would announce a dispatch that
     * could still roll back. See `hooks/queueOrderEmails.ts`.
     */
    afterChange: [queueOrderEmails],

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
