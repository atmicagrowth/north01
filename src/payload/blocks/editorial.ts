import type { Block } from 'payload'

import { hotspotFields } from '../fields/hotspot'
import { validateRequiredUpload } from '../fields/required'
import { linkGroup } from '../fields/link'

/**
 * The editorial vocabulary — the reorderable blocks a collection page or an Edit is composed from.
 *
 * Plan §6.1e and §6.1f both list "Editorial blocks" as a field without saying what one is, and
 * §6.1o says to *"use structured content rather than hard-coded text when client editing is a
 * requirement"*. What a block may be is therefore settled by the visual guide, which is authoritative
 * for anything visual and which describes these pages precisely:
 *
 * > **Collection** — "Campaign-led composition. Large opening image or colour field. Restrained
 * > introduction. Merchandise broken into visual chapters. Strong separation between chapters
 * > without unnecessary boxes." (§09)
 * >
 * > **Lookbook / Editorial** — "Magazine rhythm. Large images. Asymmetric whitespace. Short text
 * > blocks. Strong chapter titles. Occasional full-bleed moments." (§09)
 * >
 * > **Home** — "Editorial blocks alternating between image-led and typography-led sections. Product
 * > areas should feel like interruptions in a fashion story, not the entire page." (§09)
 *
 * Seven blocks, and the count is the design. Every one maps onto a sentence above: image-led
 * (`figure`, `gallery`), typography-led (`editorial`, `pullQuote`), the alternation between them
 * (`splitFeature`), the merchandise interruption (`productGroup`), and the editorial-to-commerce
 * bridge (`shopTheLook`). Plan §10.1c requires the last two to exist in some form —
 * *"every commerce-driven editorial block should have an explicit CTA or linked product/collection
 * path"* — which is also why `editorial`, `figure` and `splitFeature` each carry an optional CTA.
 *
 * **What is deliberately absent.** Hero, promotional strip, category tiles, brand story, social
 * gallery and newsletter are all named in plan §10.1a and all belong to **Phase 10**, which owns the
 * homepage block system. Defining them here would be building a later phase's feature, and worse,
 * designing it without the page it is for. Phase 10 may reuse any of these seven.
 *
 * **No presentation is encoded beyond composition.** There is no colour, spacing or typography
 * option on any block. Visual guide §11 forbids exactly that kind of CMS-driven styling, and the
 * design system (Phase 3, decision **D-11**) is enforced by the compiler rather than by an editor's
 * choices. The options that do exist — `width`, `treatment`, `imageSide`, `layout` — are
 * *compositional*: they say what shape the section is, not what it looks like.
 */

const eyebrow: Block['fields'][number] = {
  name: 'eyebrow',
  type: 'text',
  admin: {
    description: 'Optional. A short label above the heading — a season, a chapter number.',
  },
}

export const editorialBlock: Block = {
  slug: 'editorial',
  interfaceName: 'EditorialBlock',
  labels: { singular: 'Editorial text', plural: 'Editorial text' },
  fields: [
    eyebrow,
    { name: 'heading', type: 'text' },
    {
      name: 'body',
      type: 'richText',
      admin: { description: 'Short. The guide asks for "short text blocks", not essays.' },
    },
    {
      name: 'width',
      type: 'select',
      defaultValue: 'narrow',
      options: [
        { label: 'Narrow measure', value: 'narrow' },
        { label: 'Full measure', value: 'wide' },
      ],
      admin: { description: 'Narrow keeps the line length readable. Wide is for a statement.' },
    },
    linkGroup({ name: 'cta', label: 'Call to action' }),
  ],
}

export const figureBlock: Block = {
  slug: 'figure',
  interfaceName: 'FigureBlock',
  labels: { singular: 'Image', plural: 'Images' },
  fields: [
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      validate: validateRequiredUpload,
    },
    {
      name: 'mobileImage',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description:
          'Optional. A portrait crop for narrow screens. Falls back to the image above when unset — visual guide §10, "image crops".',
      },
    },
    {
      name: 'treatment',
      type: 'select',
      defaultValue: 'contained',
      options: [
        { label: 'Contained', value: 'contained' },
        { label: 'Full bleed', value: 'fullBleed' },
      ],
      admin: { description: '"Occasional full-bleed moments" — sparingly, per visual guide §09.' },
    },
    { name: 'caption', type: 'text' },
    linkGroup({ name: 'cta', label: 'Call to action' }),
  ],
}

export const splitFeatureBlock: Block = {
  slug: 'splitFeature',
  interfaceName: 'SplitFeatureBlock',
  labels: { singular: 'Image and text', plural: 'Image and text' },
  fields: [
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      validate: validateRequiredUpload,
    },
    {
      name: 'imageSide',
      type: 'radio',
      defaultValue: 'left',
      options: [
        { label: 'Image left', value: 'left' },
        { label: 'Image right', value: 'right' },
      ],
      admin: { layout: 'horizontal' },
    },
    eyebrow,
    { name: 'heading', type: 'text' },
    { name: 'body', type: 'richText' },
    linkGroup({ name: 'cta', label: 'Call to action' }),
  ],
}

export const galleryBlock: Block = {
  slug: 'gallery',
  interfaceName: 'GalleryBlock',
  labels: { singular: 'Gallery', plural: 'Galleries' },
  fields: [
    {
      name: 'images',
      type: 'array',
      minRows: 2,
      maxRows: 12,
      required: true,
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
      name: 'layout',
      type: 'select',
      defaultValue: 'pair',
      options: [
        { label: 'Pair', value: 'pair' },
        { label: 'Triptych', value: 'triptych' },
        { label: 'Grid', value: 'grid' },
      ],
    },
  ],
}

export const pullQuoteBlock: Block = {
  slug: 'pullQuote',
  interfaceName: 'PullQuoteBlock',
  labels: { singular: 'Pull quote', plural: 'Pull quotes' },
  fields: [
    { name: 'quote', type: 'textarea', required: true },
    {
      name: 'attribution',
      type: 'text',
      admin: { description: 'Optional. Who said it.' },
    },
  ],
}

export const productGroupBlock: Block = {
  slug: 'productGroup',
  interfaceName: 'ProductGroupBlock',
  labels: { singular: 'Product group', plural: 'Product groups' },
  fields: [
    { name: 'heading', type: 'text' },
    {
      name: 'intro',
      type: 'textarea',
      admin: { description: 'Optional. One or two lines of context for the group.' },
    },
    {
      /**
       * The curation *is* the order of this list. Payload preserves the order of a `hasMany`
       * relationship, which is what plan §12's "curated product ordering" needs and why this is not
       * a query with a sort.
       */
      name: 'products',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      required: true,
      admin: { description: 'Drag to set the order the customer sees.' },
    },
    {
      name: 'layout',
      type: 'select',
      defaultValue: 'grid',
      options: [
        { label: 'Grid', value: 'grid' },
        { label: 'Horizontal rail', value: 'rail' },
      ],
    },
  ],
}

export const shopTheLookBlock: Block = {
  slug: 'shopTheLook',
  interfaceName: 'ShopTheLookBlock',
  /**
   * The storage name, shortened — and the only place in this schema where that is necessary.
   *
   * Postgres truncates any identifier over 63 bytes. The default naming produces the foreign key
   * `collections_blocks_shop_the_look_hotspots_product_id_products_id_fk`, which is 67, so the
   * database would hold a silently truncated name while the Drizzle snapshot held the full one. It
   * happens to work — Postgres truncates the name in a later `DROP CONSTRAINT` identically — but it
   * works by coincidence, and the coincidence fails the moment two long names truncate to the same
   * 63 characters. Payload validates *table* identifier lengths and not constraint names, so
   * nothing warns.
   *
   * **`dbName` must be the function form here, not a string.** A plain `dbName: 'look'` replaces the
   * whole table name rather than shortening a segment of it — verified in
   * `@payloadcms/drizzle/createTableName.js`, where a custom name is used *instead of* the
   * `${parentTable}_blocks_` prefix, not with it. Because this block is used by two collections,
   * that produced **one shared `look` table** whose `_parent_id` foreign key referenced `collections`
   * alone:
   *
   * ```sql
   * ALTER TABLE "look" ADD CONSTRAINT "look_parent_id_fk"
   *   FOREIGN KEY ("_parent_id") REFERENCES "public"."collections"("id")
   * ```
   *
   * — so saving a shop-the-look block on an *Edit* would have written a row pointing at an `edits`
   * id through a key that says `collections`. A silent cross-collection corruption, traded for four
   * characters. The function form receives the parent table name and keeps the tables separate:
   * `collections_blocks_look` and `edits_blocks_look`, longest generated name 58 characters.
   *
   * Either way the block stays `shopTheLook` in the API, in `payload-types.ts` and in the admin
   * panel — `dbName` is storage only.
   */
  dbName: ({ tableName }) => `${tableName}_blocks_look`,
  labels: { singular: 'Shop the look', plural: 'Shop the look' },
  fields: [
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      validate: validateRequiredUpload,
    },
    { name: 'heading', type: 'text' },
    {
      name: 'hotspots',
      type: 'array',
      minRows: 1,
      maxRows: 8,
      required: true,
      labels: { singular: 'Hotspot', plural: 'Hotspots' },
      fields: hotspotFields(),
    },
  ],
}

/**
 * The set, in the order the block picker offers them — image-led first, because that is the order
 * these pages are actually composed in.
 */
export const editorialBlocks: Block[] = [
  figureBlock,
  splitFeatureBlock,
  editorialBlock,
  galleryBlock,
  pullQuoteBlock,
  productGroupBlock,
  shopTheLookBlock,
]
