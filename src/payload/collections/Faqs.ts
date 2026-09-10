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
 *
 * ---
 *
 * ### Nothing renders these yet — recorded here in Phase 28 so it is not discovered a third time
 *
 * The note above says the support *pages* are gap **G-08** and assigned to Phase 23. Phase 23 built
 * the four editorial routes it owned — collection, edit, lookbook, journal — and did not build
 * `/help`. So as of §28.1c's audit, `grep -rni faq src/app src/components src/lib` returns exactly
 * one hit outside this file and the generated types: `lib/navigation/fallback.ts` puts a **FAQ**
 * item in the footer pointing at `/help/faq`, and that route does not exist.
 *
 * This collection is therefore fully authorable and entirely unread — the same class of defect
 * Phase 23 found in the `gallery` and `pullQuote` blocks, which had been authorable for seventeen
 * phases with no renderer. It is left in place rather than removed, and the reasoning is the
 * opposite of the one applied to `campaigns.collection`: an unrendered *field beside rendered ones*
 * is a trap, because the editor has no way to tell which of the fields in front of them works,
 * whereas an unrendered *collection* is simply content prepared ahead of its page. §6.1o asked for
 * the structured content and it exists; what is missing is the route that reads it.
 *
 * **G-08 is therefore still open**, and closing it is one page — `/help/faq`, grouping published
 * entries by `topic` in `sortOrder` — plus whatever the footer already promises. The admin side is
 * what this phase owes it, and the ordering below is shaped for exactly that page.
 */
export const Faqs: CollectionConfig = {
  slug: 'faqs',

  labels: { singular: 'FAQ', plural: 'FAQs' },

  admin: {
    useAsTitle: 'question',
    defaultColumns: ['question', 'topic', 'sortOrder', 'status'],
    group: 'Content',
    /**
     * The old wording — *"reached from the footer"* — described a page that was never built (see the
     * G-08 note at the top of this file). A client editing answers that never appear and being told
     * by the panel that they are in the footer is the worst version of this; the description says
     * what is true today and what it is for.
     */
    description:
      'Support answers, grouped by topic and ordered within each group. The help pages that read them are not built yet, so nothing here is on the site — write them now and they appear the day that page ships.',

    /*
     * No `listSearchableFields`: it defaults to `useAsTitle`, which is already `question`, and the
     * only other thing worth searching is `answer` — a rich-text `jsonb` column that `LIKE` cannot
     * be run against.
     */
  },

  /**
   * **Topic first, then order within the topic** — Phase 28, §28.1c.
   *
   * `sortOrder` was the whole sort until now, and it is a *within-topic* number: every topic starts
   * again at 0. Sorting on it alone interleaves them — Orders #0, Returns #0, Shipping #0, Orders #1
   * — so the list view showed a client six shuffled topics and no way to see one group's running
   * order, which is the single thing `sortOrder` exists to let them set. Leading with `topic`
   * restores the grouping the page will render in.
   *
   * The topics then sort in the order the enum declares them (Postgres orders an enum column by
   * declaration, not alphabetically), which is Orders → Shipping → Returns → Sizing → Product care →
   * Account. That is roughly the order a customer meets the questions in, and it beats an
   * alphabetical run that would open on Account.
   *
   * Admin-only in practice: nothing queries this collection yet (see the note above), and any page
   * that eventually does should pass its own sort rather than inherit one.
   */
  defaultSort: ['topic', 'sortOrder'],

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
      admin: {
        position: 'sidebar',
        description:
          'The heading this question sits under. Changing it moves the question to another group and leaves a gap in the order of the old one — renumber the group you took it from.',
      },
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
          'Lower sorts first within the topic. The most-asked question goes at the top, not the oldest. Numbers do not have to be consecutive — leaving gaps of ten makes inserting a question later a single edit.',
      },
    },
    /**
     * Not `publishingFields()`. A support answer is either offered or it is not; there is no
     * scheduling here, because `publishedAt` on the editorial collections turns out to mean
     * "hidden from navigation and the homepage" rather than "not yet live", and a date column
     * carrying that nuance would be worse than no column at all on a page that has neither.
     */
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
      admin: {
        position: 'sidebar',
        description:
          'Draft keeps the answer off the site entirely. There is no date on a FAQ — it goes live the moment you publish it.',
      },
    },
  ],
}
