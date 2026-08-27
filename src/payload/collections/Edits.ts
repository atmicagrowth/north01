import type { CollectionConfig } from 'payload'

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
    description: 'Intent-based shopping pages at /edit/… Keep the set small and obvious.',
  },

  defaultSort: '-publishedAt',

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
                {
                  name: 'products',
                  type: 'relationship',
                  relationTo: 'products',
                  hasMany: true,
                  required: true,
                  admin: { description: 'Drag to set the order the customer sees.' },
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
                  'Optional — plan §6.1f. Links the edit to the editorial story behind it, and gives the reader somewhere to go next.',
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
