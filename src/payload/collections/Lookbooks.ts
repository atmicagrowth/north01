import type { CollectionConfig } from 'payload'

import { hotspotFields } from '../fields/hotspot'
import { publishingFields, seoField } from '../fields/seo'
import { slugField } from '../fields/slug'
import { validateRequiredUpload } from '../fields/required'

/**
 * The lookbook. Plan §6.1h defines it in two levels — a lookbook of chapters, each chapter a title,
 * a hero image, editorial text, a gallery and product hotspots — and the visual guide gives the
 * rhythm:
 *
 * > "Magazine rhythm. Large images. Asymmetric whitespace. Short text blocks. Strong chapter titles.
 * > Occasional full-bleed moments." (§09)
 *
 * **Chapters are an array, not the editorial block set.** Every other editorial page here composes
 * from blocks; this one does not, because §6.1h prescribes the chapter's fields rather than leaving
 * the composition open, and because a lookbook's structure *is* its chapters — flattening them into
 * a block list would lose the level that structure document §11's flow depends on
 * (*LOOKBOOK → Chapter → Full-screen content → Shop a look → Product*).
 *
 * **Hotspots are the commerce path, and Phase 22 owns their behaviour.** What lives here is only
 * their data, which plan §22.1a insists on: *"Do not hard-code hotspot coordinates in React."* The
 * fields, and why they are percentages and why a hotspot requires a product, are in
 * `fields/hotspot.ts`.
 *
 * Note the nesting depth: `lookbooks → chapters → hotspots` produces the Postgres table
 * `lookbooks_chapters_hotspots`, and `→ gallery` produces `lookbooks_chapters_gallery`. Both are
 * comfortably inside Postgres's 63-character identifier limit, which is worth checking whenever a
 * level is added — the adapter truncates and de-duplicates rather than failing, so an overflow
 * shows up as a table with a surprising name rather than an error.
 */
export const Lookbooks: CollectionConfig = {
  slug: 'lookbooks',

  labels: { singular: 'Lookbook', plural: 'Lookbooks' },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'season', 'status', 'publishedAt'],
    group: 'Editorial',
    description: 'Chaptered editorial with shoppable hotspots.',
  },

  defaultSort: '-publishedAt',

  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Lookbook',
          fields: [
            { name: 'title', type: 'text', required: true },
            {
              name: 'season',
              type: 'text',
              index: true,
              admin: {
                description: 'Free text — "AW26". Groups lookbooks; does not drive layout.',
              },
            },
            {
              name: 'coverImage',
              type: 'upload',
              relationTo: 'media',
              admin: { description: 'The index-page cover.' },
            },
            {
              name: 'intro',
              type: 'richText',
              admin: { description: 'Optional. A short standfirst before the first chapter.' },
            },
          ],
        },
        {
          label: 'Chapters',
          fields: [
            {
              name: 'chapters',
              type: 'array',
              labels: { singular: 'Chapter', plural: 'Chapters' },
              admin: {
                description: 'In reading order. Each chapter is a full-screen editorial moment.',
              },
              fields: [
                {
                  name: 'title',
                  type: 'text',
                  required: true,
                  admin: { description: 'Strong chapter titles — visual guide §09.' },
                },
                {
                  name: 'heroImage',
                  type: 'upload',
                  relationTo: 'media',
                  admin: { description: 'The chapter opener. Usually full-bleed.' },
                },
                {
                  name: 'editorialText',
                  type: 'richText',
                  admin: { description: 'Short. "Short text blocks", per the guide.' },
                },
                {
                  name: 'gallery',
                  type: 'array',
                  labels: { singular: 'Image', plural: 'Images' },
                  maxRows: 12,
                  fields: [
                    {
                      name: 'image',
                      type: 'upload',
                      relationTo: 'media',
                      validate: validateRequiredUpload,
                    },
                    { name: 'caption', type: 'text' },
                  ],
                },
                {
                  name: 'hotspots',
                  type: 'array',
                  maxRows: 8,
                  labels: { singular: 'Hotspot', plural: 'Hotspots' },
                  admin: {
                    description:
                      'Shoppable points on the chapter hero image. Positions are percentages, so they survive every crop and breakpoint.',
                  },
                  fields: hotspotFields(),
                },
              ],
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
