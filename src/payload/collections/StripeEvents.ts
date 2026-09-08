import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff } from '../access'

/**
 * **Plan §17.1d's webhook record**, and the first of its two idempotency barriers.
 *
 * > *"Persist a Stripe webhook/event record with at minimum: Stripe event ID (unique). Event type.
 * > Received timestamp. Processing status. Related order ID where known. Error/retry information
 * > where needed."*
 *
 * Six fields, all six here. The one that does the work is the first: **`eventId` is unique**, and that
 * uniqueness is a database constraint rather than a check in a handler. Stripe retries an event until
 * it is acknowledged, and it retries after network failures, timeouts and deploys — so the same event
 * arriving twice is the normal case, not the exceptional one. A handler that guarded against it with
 * a read-then-write would have a window between the two, and two concurrent retries would both find
 * nothing and both proceed.
 *
 * An insert that violates a unique index has no window. The second one fails, and the failure is the
 * answer.
 *
 * ---
 *
 * ### Why this is a barrier and not the whole defence
 *
 * §17.1d is explicit that it is the *first* barrier: *"Business-state guards are the second barrier:
 * even if the same logical transition is encountered through another event or retry, the order state
 * machine and inventory logic must reject duplicate finalization safely."*
 *
 * The two protect against different things. This row stops **the same event** being processed twice.
 * The order's own state stops **a different event** driving the same transition twice — a
 * `checkout.session.completed` and a `payment_intent.succeeded` both describing one payment, which
 * Stripe will happily send. Only the second barrier catches that, which is why marking an order paid
 * checks that it is not already paid rather than trusting that it got here only once.
 *
 * ### Status is a record of what happened, not a lock
 *
 * `received` is written before processing and updated afterwards. If the process dies in between, the
 * row is left at `received` — and that is deliberately *not* treated as "in progress, do not retry",
 * because a crashed handler and a slow one are indistinguishable from outside and a lock nobody can
 * release is worse than a retry. Stripe will send the event again; the order's own state decides
 * whether anything is still owed.
 *
 * `ignored` is a real outcome and a common one. §17.1h requires unknown event types to be *"safely
 * acknowledged/logged without crashing"*, and a Stripe account emits many events this application has
 * no opinion about. Recording them as ignored is how a later question — *"did we ever see that?"* —
 * has an answer.
 */
export const StripeEvents: CollectionConfig = {
  slug: 'stripe-events',

  labels: { singular: 'Stripe event', plural: 'Stripe events' },

  admin: {
    useAsTitle: 'eventId',
    defaultColumns: ['eventId', 'type', 'status', 'order', 'receivedAt'],
    group: 'System',
    description:
      'Every webhook Stripe has delivered. The unique event ID is what makes a retry safe to receive.',
  },

  /**
   * **Nobody may write this through the API, including staff.**
   *
   * A row here is an assertion that Stripe sent something, and the only thing entitled to make that
   * assertion is the route that verified Stripe's signature. It writes through the Local API, past
   * these rules; a hand-created row would be a forged receipt, and one that could be used to make a
   * genuine retry look already-processed.
   *
   * Read is staff-only for the ordinary reason: it is operational data with payment identifiers in
   * it, and no customer has a use for it.
   */
  access: {
    read: isStaff,
    create: () => false,
    update: () => false,
    delete: isAdmin,
  },

  fields: [
    {
      /**
       * Stripe's own `evt_...` identifier. **Unique**, and that constraint is the idempotency barrier
       * — see the collection docblock. It is indexed by being unique.
       */
      name: 'eventId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { readOnly: true, description: 'The `evt_...` id. Unique — this is the retry guard.' },
    },
    {
      name: 'type',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true, description: 'e.g. checkout.session.completed.' },
    },
    {
      name: 'receivedAt',
      type: 'date',
      required: true,
      admin: {
        readOnly: true,
        date: { pickerAppearance: 'dayAndTime' },
        description: 'When this application received it, not when Stripe created it.',
      },
    },
    {
      /**
       * §17.1d's *"processing status"*.
       *
       * `ignored` is not a failure: an account emits events no application has an opinion about, and
       * §17.1h requires them to be acknowledged rather than to crash the handler.
       */
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'received',
      index: true,
      options: [
        { label: 'Received', value: 'received' },
        { label: 'Processed', value: 'processed' },
        { label: 'Ignored — not a type we act on', value: 'ignored' },
        { label: 'Failed', value: 'failed' },
      ],
      admin: { readOnly: true },
    },
    {
      /**
       * §17.1d's *"related order ID where known"*. Nullable on purpose: an event may arrive before
       * its order can be identified, or may not be about an order at all.
       */
      name: 'order',
      type: 'relationship',
      relationTo: 'orders',
      index: true,
      admin: { readOnly: true, description: 'Empty when the event is not about an order we hold.' },
    },
    {
      /** §17.1d's *"error/retry information where needed"*. */
      name: 'error',
      type: 'textarea',
      admin: {
        readOnly: true,
        description:
          'Why processing failed, when it did. Stripe will retry; this says what to fix.',
      },
    },
    {
      name: 'attempts',
      type: 'number',
      required: true,
      defaultValue: 1,
      min: 1,
      admin: {
        readOnly: true,
        step: 1,
        description: 'How many times Stripe has delivered this event id.',
      },
    },
  ],
}
