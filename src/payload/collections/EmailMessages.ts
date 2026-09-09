import type { CollectionConfig } from 'payload'

import { EMAIL_KINDS, EMAIL_STATUSES, MAX_DELIVERY_ATTEMPTS } from '@/lib/email/rules'

import { isAdmin, isStaff } from '../access'

/**
 * **One row per message this shop intended to send** — plan §19.1c and §19.1d.
 *
 * §2.2 lists *"Email delivery event / idempotency record where needed"* among the required
 * conceptual entities, so this table is in the domain model rather than invented at Phase 19. The
 * plan then asks it to do two jobs at once, and it is worth separating them:
 *
 * 1. **§19.1c — stop the duplicate.** *"A webhook retry must not send two confirmation emails. Use
 *    an application-side event/message record or another idempotency strategy."*
 * 2. **§19.1d — survive the failure.** *"A failed email should not roll back a successful
 *    payment/order. Instead: log error, record failure, provide admin visibility, allow retry where
 *    appropriate."*
 *
 * Both are the same row read two ways: the row's **existence** is the duplicate guard, and the row's
 * **status** is the failure record.
 *
 * ---
 *
 * ### `dedupeKey` is a constraint, not a check — the Phase 17 lesson, applied
 *
 * `stripe-events.eventId` taught this the expensive way. A guard that *reads* to see whether a
 * message was already sent has a window between the read and the write, and two concurrent webhook
 * retries both find nothing and both send. A unique index has no window: the second insert raises,
 * and the raise **is** the answer.
 *
 * So `send.ts` never asks "did we send this?". It claims the key by inserting, and a constraint
 * violation means somebody else already owns this message.
 *
 * ### Intent is recorded before delivery is attempted, and that ordering is the whole design
 *
 * A row is written `pending` first, and only then is anything sent. The reverse — send, then record —
 * loses the record exactly when it matters, because the process that dies mid-send is the one whose
 * outcome nobody knows.
 *
 * This ordering is also what makes the **admin-panel** emails possible at all. Payload 3 runs
 * `afterChange` *inside* the open transaction (verified in
 * `payload/dist/collections/operations/updateByID.js` — `commitTransaction` comes after both
 * `afterChange` and `afterOperation`, so there is no post-commit collection hook). A dispatch email
 * sent from there would be a dispatch email sent for a dispatch that could still roll back. Writing
 * the *intent* inside the transaction is correct precisely because it rolls back with it: if the
 * order never reached `shipped`, the intention to say so never existed either.
 *
 * ### `pending` is not a lock
 *
 * A row left at `pending` by a crashed sender is retried, and this is deliberate — the same reasoning
 * `StripeEvents` records. A crashed sender and a slow one look identical from outside, and a customer
 * who never gets their confirmation because a lock nobody can release is stuck at `pending` is a
 * worse outcome than a rare duplicate. The ceiling on retries is `MAX_DELIVERY_ATTEMPTS`, after which
 * the row stays `failed` for a human to look at, which is §19.1d's *"admin visibility"*.
 */
export const EmailMessages: CollectionConfig = {
  slug: 'email-messages',

  labels: { plural: 'Email messages', singular: 'Email message' },

  admin: {
    defaultColumns: ['subject', 'to', 'kind', 'status', 'attempts', 'createdAt'],
    description:
      'Every transactional message this shop intended to send, why it was sent, and what happened. Written by the email service; not editable here.',
    group: 'System',
    useAsTitle: 'subject',
  },

  /**
   * Closed to everyone, staff included — the same shape as `stripe-events` and for the same reason.
   * A row here is an assertion that the shop decided to send something; a hand-made one is a forged
   * delivery record. Server code writes through the Local API with `overrideAccess: true`, which
   * skips these rules entirely, so closing them costs nothing operationally and forbids exactly one
   * thing: `POST /api/email-messages`.
   *
   * Retrying a failed message is an *action* rather than a field edit, so a closed `update` does not
   * stand in the way of §19.1d's *"allow retry where appropriate"* — `pnpm email:drain` and the
   * staff-authenticated drain route both write with `overrideAccess`.
   */
  access: {
    create: () => false,
    delete: isAdmin,
    read: isStaff,
    update: () => false,
  },

  fields: [
    {
      /**
       * **§19.1c's barrier.** Unique because the constraint is the mechanism — see the docblock
       * above. Indexed because `send.ts` looks a message up by it when the insert loses the race.
       *
       * The key names *the thing that happened*, never the message that reported it:
       * `order-confirmation:42`, `order-shipped:42`, `refund:42:1500`. `lib/email/rules.ts`
       * explains why an event id would be the wrong choice — Stripe sends two events for one
       * payment, and keying on either would send two confirmations.
       */
      name: 'dedupeKey',
      type: 'text',
      admin: {
        description:
          'Names the event this message reports — one message per event, enforced by a unique index.',
        readOnly: true,
      },
      index: true,
      required: true,
      unique: true,
    },
    {
      type: 'row',
      fields: [
        {
          name: 'kind',
          type: 'select',
          admin: { readOnly: true, width: '50%' },
          index: true,
          options: EMAIL_KINDS.map((kind) => ({ label: kind, value: kind })),
          required: true,
        },
        {
          /**
           * `pending` before anything is attempted; `sent` when the provider accepted it; `failed`
           * when it did not; `suppressed` when the dev safeguard refused the address, which is a
           * non-delivery rather than a fault and is never retried into a send.
           */
          name: 'status',
          type: 'select',
          admin: { readOnly: true, width: '50%' },
          defaultValue: 'pending',
          index: true,
          options: EMAIL_STATUSES.map((status) => ({ label: status, value: status })),
          required: true,
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          /**
           * The address as decided, which for a suppressed message is the address it *would* have
           * gone to. Recording the intended recipient rather than a placeholder is what makes a
           * suppressed row useful when somebody asks why a customer never heard anything.
           */
          name: 'to',
          type: 'email',
          admin: { readOnly: true, width: '50%' },
          index: true,
          required: true,
        },
        {
          name: 'subject',
          type: 'text',
          admin: { readOnly: true, width: '50%' },
          required: true,
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          /**
           * Counted, not inferred. §19.1d's retry allowance needs a ceiling or a message that fails
           * on a malformed address fails identically forever and buries the one somebody could fix.
           */
          name: 'attempts',
          type: 'number',
          admin: {
            description: `Delivery attempts. Retried automatically up to ${MAX_DELIVERY_ATTEMPTS}, then left for a human.`,
            readOnly: true,
            width: '33%',
          },
          defaultValue: 0,
          min: 0,
          required: true,
        },
        {
          name: 'lastAttemptAt',
          type: 'date',
          admin: { date: { pickerAppearance: 'dayAndTime' }, readOnly: true, width: '33%' },
        },
        {
          name: 'sentAt',
          type: 'date',
          admin: { date: { pickerAppearance: 'dayAndTime' }, readOnly: true, width: '33%' },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          /**
           * Nullable, and both of them are. A password reset has a customer and no order; a guest's
           * order confirmation has an order and no customer. Neither is the record — `to` is, because
           * `orders.email` is itself a snapshot taken at checkout and survives the customer being
           * deleted.
           */
          name: 'order',
          type: 'relationship',
          admin: { readOnly: true, width: '50%' },
          index: true,
          relationTo: 'orders',
        },
        {
          name: 'customer',
          type: 'relationship',
          admin: { readOnly: true, width: '50%' },
          index: true,
          relationTo: 'customers',
        },
      ],
    },
    {
      /**
       * Resend's own identifier for the accepted message. The one thing that lets somebody reconcile
       * this row against the provider's dashboard when a customer says nothing arrived.
       */
      name: 'providerId',
      type: 'text',
      admin: {
        description: "The provider's message id, once it has accepted the message.",
        readOnly: true,
      },
      index: true,
    },
    {
      /**
       * **What the template is handed at delivery time.**
       *
       * The queue exists because the shipped and delivered messages are enqueued inside a
       * transaction and delivered outside it, so the data has to survive the gap. Storing it — rather
       * than re-deriving it from the order at delivery — is also what makes the record *true*: a
       * receipt reprinted from today's catalogue is not the receipt the customer was sent.
       *
       * **Null on purpose for anything carrying a credential.** A password-reset link is a working
       * token; writing one here would put it at rest in a table staff can read. Those messages are
       * delivered on the spot and are not retryable, which is the correct behaviour — a customer who
       * did not get a reset link asks for another, and that issues a fresh token.
       */
      name: 'data',
      type: 'json',
      admin: {
        description:
          'The template data. Empty for messages carrying a single-use link, which are never re-rendered.',
        readOnly: true,
      },
    },
    {
      /**
       * §19.1d's *"log error, record failure"*. Truncated at the call site, the same way the webhook
       * truncates its own, because a provider stack trace is not worth a wide column.
       */
      name: 'error',
      type: 'textarea',
      admin: {
        description: 'Why the last attempt failed, or why a message was suppressed.',
        readOnly: true,
      },
    },
  ],
}
