import type { CollectionConfig } from 'payload'

import { normaliseEmail } from '../fields/slug'

/**
 * Newsletter sign-ups. Plan §6.1n lists four fields — email, consent timestamp, source, status —
 * and then the instruction that shapes the whole collection:
 *
 * > **"Do not store more data than necessary."**
 *
 * So there is no name, no relationship to a customer account, no interest tags and no engagement
 * history. A subscriber is an address, a moment of consent, where the consent was given, and whether
 * it still stands. Every one of those four earns its place under that instruction: the address is
 * the point, `consentedAt` and `source` are the evidence that consent was given and where — the
 * thing a subscriber is entitled to ask about — and `status` is how it is withdrawn without
 * destroying the record that it was once given.
 *
 * **Unsubscribing is a status change, not a delete.** Deleting the row loses the proof of the
 * original consent *and* loses the fact that this address opted out — so the next import silently
 * re-subscribes them. `unsubscribed` is the honest state, and it is why there is no soft delete here
 * either: the status column already carries the meaning that `deletedAt` would blur.
 *
 * **No relationship to `customers`.** A subscriber is not an account, most are not, and joining the
 * two would mean an account deletion could take a marketing consent with it — or worse, that
 * consenting to email and creating an account become entangled. The address is the identifier here,
 * which is why it is unique and normalised: the same person signing up twice is one subscriber, and
 * `Person@Example.com ` must not become a second row.
 */
export const NewsletterSubscribers: CollectionConfig = {
  slug: 'newsletter-subscribers',

  labels: { singular: 'Subscriber', plural: 'Newsletter' },

  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'status', 'source', 'consentedAt'],
    group: 'Customers',
    description: 'Email, consent, source, status. Deliberately nothing else — plan §6.1n.',
  },

  defaultSort: '-consentedAt',

  fields: [
    {
      name: 'email',
      type: 'email',
      required: true,
      unique: true,
      index: true,
      hooks: { beforeValidate: [normaliseEmail] },
    },
    {
      name: 'consentedAt',
      type: 'date',
      required: true,
      index: true,
      defaultValue: () => new Date().toISOString(),
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description: 'When consent was given. The record that makes the sign-up defensible.',
      },
    },
    {
      name: 'source',
      type: 'select',
      required: true,
      defaultValue: 'footer',
      index: true,
      options: [
        { label: 'Footer form', value: 'footer' },
        { label: 'Checkout', value: 'checkout' },
        { label: 'Editorial page', value: 'editorial' },
        { label: 'Imported', value: 'import' },
      ],
      admin: {
        description: 'Where consent was given. A closed list, because "other" answers nothing.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'subscribed',
      index: true,
      options: [
        { label: 'Subscribed', value: 'subscribed' },
        { label: 'Unsubscribed', value: 'unsubscribed' },
      ],
      admin: {
        description:
          'Unsubscribing sets this. The row stays, so a later import cannot resurrect the address.',
      },
    },
  ],
}
