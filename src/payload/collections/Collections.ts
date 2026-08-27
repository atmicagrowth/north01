import type { CollectionConfig } from 'payload'

import { editorialBlocks } from '../blocks/editorial'
import { publishingFields, seoField } from '../fields/seo'
import { slugField } from '../fields/slug'

/**
 * Merchandising sets — Current Season, Essentials, Limited, Archive (structure document §2).
 * Plan §6.1e gives the fields; the visual guide gives the shape:
 *
 * > "Campaign-led composition. Large opening image or colour field. Restrained introduction.
 * > Merchandise broken into visual chapters. Strong separation between chapters without unnecessary
 * > boxes." (§09)
 *
 * That last sentence is why a collection is a `body` of editorial blocks rather than a hero plus a
 * product grid. Plan §23.1a spells the same page out in order — hero, intro, editorial blocks,
 * featured products, the full grid, related collections — and the reference image's flat filterable
 * grid is explicitly *not* what is built (**DEV-09**).
 *
 * **Essentials lives here and not in Edit.** The feature matrix and plan §23.1b both list it as an
 * Edit; the structure document lists it as a Collection. The structure document owns user-facing
 * information architecture and the same merchandising page cannot occupy two URL namespaces, so
 * `/collections/essentials` it is — **DEV-01**, resolving **C-03** and **C-04**.
 *
 * **`products` is the ordered, authoritative membership list.** See the note on `products.collections`
 * for why the relationship is stored on this side and not on both.
 */
export const Collections: CollectionConfig = {
  slug: 'collections',

  labels: { singular: 'Collection', plural: 'Collections' },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'publishedAt', 'updatedAt'],
    group: 'Editorial',
    description: 'Campaign-led merchandising pages at /collections/…',
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
              name: 'description',
              type: 'richText',
              admin: {
                description:
                  'The restrained introduction beneath the hero. Two or three sentences — the guide is emphatic about this.',
              },
            },
            {
              name: 'heroMedia',
              type: 'upload',
              relationTo: 'media',
              admin: { description: 'The large opening image — plan §6.1e, visual guide §09.' },
            },
            {
              name: 'introMedia',
              type: 'upload',
              relationTo: 'media',
              admin: {
                description:
                  'Optional second image, beside the introduction — plan §6.1e lists hero and intro media separately.',
              },
            },
          ],
        },
        {
          label: 'Merchandise',
          fields: [
            {
              name: 'products',
              type: 'relationship',
              relationTo: 'products',
              hasMany: true,
              index: true,
              admin: {
                description:
                  'Every product in this collection, in the order the customer sees. Dragging a row is the curation — feature matrix §12.',
              },
            },
            {
              name: 'relatedCollections',
              type: 'relationship',
              relationTo: 'collections',
              hasMany: true,
              admin: {
                description:
                  'Shown at the foot of the page — plan §23.1a. Keeps an editorial page from being a dead end.',
              },
              // A collection related to itself is a link back to the page the reader is on.
              filterOptions: ({ id }) => (id ? { id: { not_equals: id } } : true),
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
                  'The visual chapters. Alternate image-led and typography-led sections rather than stacking one kind.',
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
