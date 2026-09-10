import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff, publishedOnly } from '../access'
import { editorialBlocks } from '../blocks/editorial'
import { publishingFields, seoField } from '../fields/seo'
import { slugField } from '../fields/slug'

/**
 * Intent-based shopping pages — Weekend, Travel, Everyday, Gifts (structure document §2, and
 * **DEV-01** for why Essentials is not among them). Plan §6.1f calls them "curated shopping pages"
 * and lists the fields; plan §23.1b gives the editorial brief, which is a useful shape test for the
 * schema:
 *
 * > "Each should answer: What is this edit? Why should I care? What products belong here? Where do
 * > I shop?"
 *
 * `intro` answers the first two, `productGroups` the third, and every product in a group is its own
 * answer to the fourth.
 *
 * **Product *groups*, not a flat list.** This is the one structural difference from a Collection,
 * and it is the plan's (§6.1f, "product groups"). A Weekend edit is *"Friday night"* and
 * *"Saturday morning"* — captioned sets with their own headings — where a Collection is one ordered
 * body of merchandise. Groups are an array rather than blocks because the grouping is the page's
 * spine and should not be interleavable with arbitrary editorial; the `body` blocks below are for
 * everything around them.
 *
 * Feature matrix §13 adds the constraint that keeps this honest: *"The Edit category should remain
 * curated and finite. It should not become a second complicated navigation system."* Nothing in the
 * schema enforces a count — a limit column would be a rule about editing, not about data — but the
 * navigation is fixed at the structure document's four (**DEV-01**), so a fifth Edit is reachable
 * only from within the section.
 */
export const Edits: CollectionConfig = {
  slug: 'edits',

  labels: { singular: 'Edit', plural: 'Edits' },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'publishedAt', 'updatedAt'],
    group: 'Editorial',

    /**
     * The scheduling sentence is the same correction made on `Collections.ts`, and made for the same
     * reason: `access.read` narrows on `status` alone, `getEditPage` adds no date clause, and only
     * `navigation/resolve.ts` and `home/resolve.ts` actually consult `publishedAt`. The field-level
     * wording in `fields/seo.ts` says "schedules the page", which for an Edit it does not.
     */
    description:
      'Intent-based shopping pages at /edit/… Keep the set small and obvious. Published is live the moment you save it — a future date only keeps the edit out of navigation menus and the homepage, not off its own URL.',

    /** An editor is given a URL, not a title. See the note on `Collections.admin`. */
    listSearchableFields: ['title', 'slug'],
  },

  defaultSort: '-publishedAt',

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
      type: 'tabs',
      tabs: [
        {
          label: 'Page',
          fields: [
            { name: 'title', type: 'text', required: true },
            {
              name: 'intro',
              type: 'richText',
              admin: {
                description:
                  'What this edit is, and why it exists. Plan §23.1b — answer it in two sentences.',
              },
            },
            {
              name: 'hero',
              type: 'upload',
              relationTo: 'media',
              admin: { description: 'The opening image.' },
            },
          ],
        },
        {
          label: 'Merchandise',
          fields: [
            {
              name: 'productGroups',
              type: 'array',
              labels: { singular: 'Group', plural: 'Groups' },
              admin: {
                description:
                  'Captioned sets of products. The order of groups is the order of the page.',
              },
              fields: [
                { name: 'title', type: 'text', required: true },
                {
                  name: 'intro',
                  type: 'textarea',
                  admin: { description: 'Optional. One line of context for the group.' },
                },
                /*
                 * No `filterOptions` restricting this to published products, for the two reasons
                 * spelled out on `Collections.products` — the filter is re-validated on save, so it
                 * would forbid drafting an edit ahead of its drop, and it would break the save of
                 * every edit referencing a product that is later soft-deleted. A group whose
                 * products are all unpublished is dropped whole by `lib/editorial/read.ts` rather
                 * than rendered as an empty heading, which is the honest outcome.
                 */
                {
                  name: 'products',
                  type: 'relationship',
                  relationTo: 'products',
                  hasMany: true,
                  required: true,
                  admin: {
                    description:
                      'Drag to set the order the customer sees. Drafts, future-dated products and anything out of stock are dropped from the live page — and if none of a group survives, the whole group disappears rather than showing an empty heading.',
                  },
                },
              ],
            },
            {
              name: 'lookbooks',
              type: 'relationship',
              relationTo: 'lookbooks',
              hasMany: true,
              admin: {
                description:
                  'Optional — plan §6.1f. Links the edit to the editorial story behind it, and gives the reader somewhere to go next. A draft lookbook listed here renders as nothing at all, so publish it first or the section quietly shrinks.',
              },
            },
          ],
        },
        {
          label: 'Editorial',
          fields: [
            {
              name: 'body',
              type: 'blocks',
              blocks: editorialBlocks,
              admin: {
                description:
                  'Editorial around the groups — an opening image, a quote, a shop-the-look.',
              },
            },
          ],
        },
        {
          label: 'SEO',
          fields: [seoField()],
        },
      ],
    },

    slugField(),
    ...publishingFields(),
  ],
}
