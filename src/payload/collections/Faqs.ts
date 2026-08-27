import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff, publishedOnly } from '../access'

/**
 * Plan §6.1o — *"FAQ / content blocks. Use structured content rather than hard-coded text when
 * client editing is a requirement."*
 *
 * Two halves, and this file is the first. The second — the reusable editorial block set — is
 * `blocks/editorial.ts`, and between them they are what stops support copy and editorial copy from
 * being typed into React components.
 *
 * Structure document §19 places these: FAQ, Contact, Shipping, Returns and the size guide are
 * reached from the footer and from relevant pages, and *"support content should not interrupt the
 * primary shopping flow"*. So this is a flat list of question-and-answer entries with a topic and an
 * order, not a page builder — the questions are the content, and grouping them by topic is the only
 * structure the page needs.
 *
 * **The About, Contact, Shipping and Returns *pages* are not here.** They are gap **G-08**, assigned
 * to **Phase 23**, which owns editorial pages. Building a generic page collection now would be
 * designing that phase's content model without its pages, and would leave a second, weaker way to
 * author editorial beside the block set that already exists.
 *
 * `topic` is a select rather than a relationship for the same reason `journal.category` is: the
 * `categories` collection is the product taxonomy, and plan §6.1d forbids categories that navigation
 * and filters do not use.
 */
export const Faqs: CollectionConfig = {
  slug: 'faqs',

  labels: { singular: 'FAQ', plural: 'FAQs' },

  admin: {
    useAsTitle: 'question',
    defaultColumns: ['question', 'topic', 'sortOrder', 'status'],
    group: 'Content',
    description:
      'Support answers, grouped by topic. Reached from the footer — never in the shopping flow.',
  },

  defaultSort: 'sortOrder',

  /**
   * Published documents are public; everything else is staff. See `access/index.ts` — `publishedOnly`
   * returns a `Where` rather than `false` for an anonymous reader, so a draft is *absent* rather than
   * forbidden, which is the right answer for a storefront route that has to decide between rendering
   * and a 404.
   *
   * Deletion is admin-only across every collection in this project: §7.1c withholds it from editors,
   * and an editor who no longer wants a document sets it back to draft.
   */
  access: {
    read: publishedOnly,
    create: isStaff,
    update: isStaff,
    delete: isAdmin,
  },

  fields: [
    {
      name: 'question',
      type: 'text',
      required: true,
      admin: { description: 'Phrased the way a customer would ask it.' },
    },
    {
      name: 'answer',
      type: 'richText',
      required: true,
      admin: { description: 'Short, and allowed to link out to a policy page or a product.' },
    },
    {
      name: 'topic',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: 'Orders', value: 'orders' },
        { label: 'Shipping', value: 'shipping' },
        { label: 'Returns', value: 'returns' },
        { label: 'Sizing', value: 'sizing' },
        { label: 'Product care', value: 'care' },
        { label: 'Account', value: 'account' },
      ],
      admin: { position: 'sidebar' },
    },
    {
      name: 'sortOrder',
      type: 'number',
      required: true,
      defaultValue: 0,
      index: true,
      admin: {
        position: 'sidebar',
        step: 1,
        description:
          'Lower sorts first within the topic. The most-asked question goes at the top, not the oldest.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      index: true,
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
      admin: { position: 'sidebar' },
    },
  ],
}
