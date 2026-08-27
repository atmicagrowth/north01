import type { CollectionConfig } from 'payload'

import { linkGroup } from '../fields/link'
import { publishingFields, seoField } from '../fields/seo'
import { slugField } from '../fields/slug'

/**
 * A season's campaign — the hero of the homepage and the brand-first entry point in structure
 * document §22's Journey E (*Home → Campaign → Lookbook → Shop the Look → Product*). Plan §6.1g
 * gives the fields exactly: campaign title, season, hero media, story, products, collection, CTA,
 * publish status.
 *
 * **Why this is thinner than a Collection or an Edit.** A campaign is a *statement*, not a page of
 * merchandise — visual guide §09's *"large campaign statement"* — and everything it needs is a hero,
 * a paragraph and one obvious way through to shopping. Giving it the full editorial block set would
 * make it a third kind of page that overlaps the two that already exist, which is precisely the
 * "second complicated navigation system" the corpus keeps warning against. When a campaign needs
 * chapters it is a Lookbook, and when it needs merchandise it points at a Collection.
 *
 * `season` is free text rather than an enumeration: "AW26" and "Midwinter" are both legitimate, no
 * document lists the seasons, and a select that has to be extended before a campaign can be written
 * is a schema that gets in the way once a year.
 *
 * The `mobileHero` field is not decoration either — plan §10.1b lists *"mobile image omitted: use
 * safe fallback"* among the hero edge cases, which presupposes a mobile image can be supplied. A
 * campaign hero is a strong crop (visual guide §08) and a strong crop rarely survives being squeezed
 * to a phone.
 */
export const Campaigns: CollectionConfig = {
  slug: 'campaigns',

  labels: { singular: 'Campaign', plural: 'Campaigns' },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'season', 'status', 'publishedAt'],
    group: 'Editorial',
    description: 'Seasonal statements. One is usually the homepage hero.',
  },

  defaultSort: '-publishedAt',

  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Campaign',
          fields: [
            { name: 'title', type: 'text', required: true },
            {
              name: 'season',
              type: 'text',
              index: true,
              admin: {
                description:
                  'Free text — "AW26", "Resort". Used to group campaigns, not to drive layout.',
              },
            },
            {
              name: 'hero',
              type: 'upload',
              relationTo: 'media',
              admin: { description: 'The campaign image. Desktop crop.' },
            },
            {
              name: 'mobileHero',
              type: 'upload',
              relationTo: 'media',
              admin: {
                description:
                  'Optional portrait crop. Falls back to the desktop hero when empty — plan §10.1b.',
              },
            },
            {
              name: 'story',
              type: 'richText',
              admin: {
                description: 'The campaign copy. Short — it sits over or beside the image.',
              },
            },
            linkGroup({ name: 'cta', label: 'Call to action' }),
          ],
        },
        {
          label: 'Merchandise',
          fields: [
            {
              name: 'collection',
              type: 'relationship',
              relationTo: 'collections',
              admin: {
                description:
                  'The collection this campaign sells. The CTA usually points here — plan §10.1c requires an explicit path from editorial to commerce.',
              },
            },
            {
              name: 'products',
              type: 'relationship',
              relationTo: 'products',
              hasMany: true,
              admin: {
                description: 'Optional. A handful of hero pieces, in order, for the campaign rail.',
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
