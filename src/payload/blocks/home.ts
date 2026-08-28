import type { Block } from 'payload'

import { linkGroup } from '../fields/link'
import { validateRequiredRelationship, validateRequiredUpload } from '../fields/required'
import {
  editorialBlock,
  figureBlock,
  productGroupBlock,
  shopTheLookBlock,
  splitFeatureBlock,
} from './editorial'

/**
 * **The homepage vocabulary — plan §10.1a's "reorderable, typed blocks".**
 *
 * §10.1a lists ten of them *"such as"* — the hedge matters, because two of the ten are not data
 * shapes at all and one is not a homepage section. What is built here is eleven block types: six
 * defined below, and five imported unchanged from `./editorial`.
 *
 * ### The mapping, and why five of the ten are reuse
 *
 * | §10.1a names | Delivered as | New? |
 * |---|---|---|
 * | Hero | `hero` | new |
 * | Promotional strip | `promoStrip` | new |
 * | Category tiles | `categoryTiles` | new |
 * | Product rail/grid | `productRail` **and** `productGroup` | new + reused |
 * | Editorial split | `splitFeature` | **reused** |
 * | Shop-the-look | `shopTheLook` | **reused** |
 * | Collection feature | `collectionFeature` | new |
 * | Brand story | `splitFeature` | **reused** — see **DEV-43** |
 * | Social gallery | `socialGallery` | new |
 * | Newsletter | *not a block* | see **DEV-42** |
 *
 * **"Editorial split" and "Brand story" are the same shape.** Both are an image beside a heading, a
 * short body and a call to action; the only thing separating them is what the editor writes in them.
 * `blocks/editorial.ts` already ships exactly that as `splitFeature`, and defining a second identical
 * schema so the picker can say "Brand story" would be the duplicate abstraction §A.1.6 forbids —
 * two tables, two interfaces and two renderers for one composition. Recorded as **DEV-43**.
 *
 * **The newsletter is not here.** Structure §4's step 8 is one item — *"Newsletter/footer"* — and
 * structure §20 lists Newsletter among the footer's columns. `SiteFooter` has taken a `newsletter`
 * slot since Phase 3 for precisely this. A homepage block *and* a footer column would put two signup
 * forms on one page. **DEV-42**, which also discharges **DEV-25**.
 *
 * ### Two blocks in `editorial.ts` are deliberately not offered here
 *
 * `gallery` — `socialGallery` is this page's multi-image grid, and two grid blocks is a duplicate
 * surface an editor has to choose between for no reason. `pullQuote` — guide §09's Home direction
 * names image-led and typography-led sections, and `editorial` is the typography-led one. Each
 * would also cost a `homepage_blocks_*` table for nothing.
 *
 * ### No presentation options, same as `editorial.ts`
 *
 * Nothing here offers a colour, a spacing step or a type size. Guide §11 forbids CMS-driven styling
 * and decision **D-11** puts the design system behind the compiler. The options that exist —
 * `layout`, `source`, `limit` — are compositional or editorial, never visual.
 *
 * ### Identifier lengths are computed, not hoped for
 *
 * Postgres truncates any identifier over 63 bytes, silently, with a NOTICE. Two blocks below breach
 * it under a global called `homepage` and both carry a `dbName` **function** to shorten one segment:
 *
 * | Block | Longest generated name | Bytes |
 * |---|---|---|
 * | `collectionFeature`, default | `homepage_blocks_collection_feature_collection_id_collections_id_fk` | **66** |
 * | `collectionFeature`, with `dbName` | `homepage_blocks_collection_collection_id_collections_id_fk` | 58 |
 * | `categoryTiles`, default | `homepage_blocks_category_tiles_items_category_id_categories_id_fk` | **65** |
 * | `categoryTiles`, with `dbName` | `homepage_blocks_tiles_items_category_id_categories_id_fk` | 56 |
 *
 * **The function form, never a string** — a string `dbName` replaces the *whole* table name rather
 * than a segment of it, which for a block used by more than one parent collapses them into one table
 * whose `_parent_id` foreign key names only the first. `editorial.ts`'s `shopTheLook` docblock has
 * the full measurement; this is the same trap, avoided the same way.
 *
 * Note what a breach would *not* do: fail. `ADD CONSTRAINT "<66 chars>"` succeeds, the matching
 * `DROP CONSTRAINT` truncates identically, and a roll forward/back/forward passes while the Drizzle
 * snapshot keeps a name the database has never held. It breaks only when two long names truncate to
 * the same 63 bytes. Arithmetic before the schema reaches the database is the only defence.
 */

/** Shared by three blocks. A short label above a heading — a season, a chapter, a promise. */
const eyebrow: Block['fields'][number] = {
  name: 'eyebrow',
  type: 'text',
  admin: { description: 'Optional. A short label above the heading.' },
}

/**
 * **The hero is one field, and that is the design.**
 *
 * Feature matrix §3 calls it *"Campaign hero"*, structure §4 step 1 calls it *"Hero campaign"*, and
 * **DEV-39** — written while removing campaigns from the linkable set — says a campaign *"is still
 * what Phase 10 renders as the homepage hero."*
 *
 * `Campaigns` (plan §6.1g) already carries every field plan §10.1b asks a hero for: `title` is the
 * headline, `season` the season label, `story` the body, `hero` and `mobileHero` the desktop and
 * mobile media, `cta` the primary call to action, and `collection`/`products` the merchandise it
 * sells. Copying those onto this block would create two sources of truth for the largest statement
 * on the site, and an editor who updated the campaign would watch the homepage keep the old words.
 *
 * §10.1b's *"Secondary CTA"* is the one thing the campaign did not have; Phase 10 adds it **to
 * `Campaigns`**, beside the primary, rather than here — see that collection.
 *
 * §10.1b's *"Optional video"* is deliberately absent, from this block and from `Campaigns`. See
 * **DEV-41**: §30.1c forbids autoplaying video on exactly this route, Payload probes no dimensions
 * from a video container so the box could not be reserved, and an unrendered field an editor can
 * fill is §0.1.17's fake control wearing an upload button.
 */
export const heroBlock: Block = {
  slug: 'hero',
  interfaceName: 'HeroBlock',
  labels: { singular: 'Campaign hero', plural: 'Campaign heroes' },
  fields: [
    {
      name: 'campaign',
      type: 'relationship',
      relationTo: 'campaigns',
      /*
       * `validate`, not `required: true`. A `required` relationship is `NOT NULL` *and*
       * `ON DELETE SET NULL` at once, which makes the referenced campaign permanently undeletable —
       * the defect Phase 6's audit found in eleven places. Required to author, nullable in storage.
       */
      validate: validateRequiredRelationship,
      admin: {
        description:
          'The season’s campaign. Its title, season, story, imagery and calls to action are the hero — edit them on the campaign itself. A draft or future-dated campaign leaves the homepage without a hero rather than showing an unfinished one.',
      },
    },
  ],
}

/**
 * The quiet band of promises under the hero — *"Promotional strip"*, plan §10.1a.
 *
 * **This is not the announcement bar, and the description says so to the editor.** The announcement
 * bar is one site-wide line above the header on every route, driven by `site-settings`; this is two
 * to four statements inside the homepage composition. Different surfaces, different editing jobs,
 * and neither substitutes for the other — which is why §10.1a can name this while Phase 9 already
 * shipped that.
 *
 * The free-shipping threshold is deliberately *not* offered as a token here. It lives in Site
 * Settings as minor units and is quoted by the bag and at checkout; a second hand-typed copy of it
 * in editorial prose is a number that goes stale the day it changes.
 */
export const promoStripBlock: Block = {
  slug: 'promoStrip',
  interfaceName: 'PromoStripBlock',
  labels: { singular: 'Promise strip', plural: 'Promise strips' },
  fields: [
    {
      name: 'items',
      type: 'array',
      minRows: 2,
      maxRows: 4,
      required: true,
      labels: { singular: 'Statement', plural: 'Statements' },
      admin: {
        description:
          'Two to four short statements — "Made in small runs", "Thirty-day returns". Not the announcement bar, which is one line above the header on every page. Do not restate the free-shipping threshold; that number lives in Site Settings and is quoted in the bag.',
      },
      fields: [
        { name: 'text', type: 'text', required: true },
        linkGroup({ name: 'link', label: 'Optional link' }),
      ],
    },
  ],
}

/**
 * *"Featured categories"* (feature matrix §3), *"Category tiles"* (plan §10.1a), structure §4 step 2.
 *
 * The tile points at a **category document**, so its URL comes from `documentHref` at render time
 * and a renamed category cannot break the link — the same reasoning `fields/link.ts` gives for
 * modelling a navigation item as a reference. The image and label are overrides: leave them empty
 * and the category's own `image` and `name` are used, which is why `Categories` carries an `image`
 * field described as *"used by the featured-category tiles and the mega menu"*.
 */
export const categoryTilesBlock: Block = {
  slug: 'categoryTiles',
  interfaceName: 'CategoryTilesBlock',
  labels: { singular: 'Category tiles', plural: 'Category tiles' },
  /** 65 bytes at the default name. See the module docblock. */
  dbName: ({ tableName }) => `${tableName}_blocks_tiles`,
  fields: [
    { name: 'heading', type: 'text' },
    {
      name: 'items',
      type: 'array',
      minRows: 2,
      maxRows: 6,
      required: true,
      labels: { singular: 'Tile', plural: 'Tiles' },
      admin: {
        description:
          'The routes into the shop. A tile whose category is unpublished or deleted is dropped rather than rendered as a dead end.',
      },
      fields: [
        {
          name: 'category',
          type: 'relationship',
          relationTo: 'categories',
          validate: validateRequiredRelationship,
        },
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          admin: { description: 'Optional. Falls back to the category’s own image.' },
        },
        {
          name: 'label',
          type: 'text',
          admin: { description: 'Optional. Falls back to the category’s name.' },
        },
      ],
    },
  ],
}

/**
 * **A rail that is a query, beside `productGroup`, which is a curation.**
 *
 * Feature matrix §3 names three standing product sections — *"New arrivals"*, *"Limited edition"*,
 * *"Best sellers"* — and a standing section cannot be a hand-dragged list: an editor would have to
 * re-curate "New arrivals" every week or watch it become a lie. The four `source` values map
 * one-to-one onto boolean columns Phase 6 already shipped on `products`, one of which
 * (`featured`) its own schema describes as *"Eligible for the homepage and for the Featured sort."*
 *
 * `productGroup` — imported from `editorial.ts` and offered beside this — is the opposite job: a
 * `hasMany` relationship whose **order is the curation**. Neither expresses the other, a query
 * cannot be dragged and a list goes stale, and both render through one component with one tile.
 *
 * **There is no sort option.** Ordering is `sortOrder` then newest-first for every source. A sort
 * control is plan §11.1a's, on the shop page, where the customer chooses; a select here would be a
 * merchandiser silently changing what "Best sellers" means.
 */
export const productRailBlock: Block = {
  slug: 'productRail',
  interfaceName: 'ProductRailBlock',
  labels: { singular: 'Product rail', plural: 'Product rails' },
  fields: [
    { name: 'heading', type: 'text' },
    {
      name: 'source',
      type: 'select',
      required: true,
      defaultValue: 'new',
      options: [
        { label: 'New arrivals', value: 'new' },
        { label: 'Best sellers', value: 'bestSellers' },
        { label: 'Limited edition', value: 'limited' },
        { label: 'Featured', value: 'featured' },
      ],
      admin: {
        description:
          'Which merchandising flag fills this rail. Set the flags on each product. Published products only — and a rail with nothing in it is not rendered.',
      },
    },
    {
      name: 'limit',
      type: 'number',
      defaultValue: 4,
      min: 2,
      max: 12,
      admin: { step: 1, description: 'How many products at most.' },
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
    linkGroup({ name: 'cta', label: 'View all' }),
  ],
}

/**
 * *"Collection feature"*, plan §10.1a — the homepage's bridge into a merchandising page.
 *
 * Plan §10.1c is the rule this block exists to satisfy structurally rather than by editor
 * discipline: *"every commerce-driven editorial block should have an explicit CTA or linked
 * product/collection path."* Because the subject is a **reference** to a collection, a path always
 * exists — `/collections/<slug>` — even when the editor writes no call to action at all. The `cta`
 * field is an override for the words, not the difference between linked and unlinked.
 *
 * The image and title fall back to the collection's own `heroMedia` and `title` for the same reason
 * the category tile falls back: one source of truth, and a renamed collection cannot go stale here.
 * `body` is a `textarea` rather than the collection's Lexical `description` deliberately — a
 * homepage teaser is one or two lines, and rendering a full page introduction here would duplicate
 * the collection page above the fold.
 */
export const collectionFeatureBlock: Block = {
  slug: 'collectionFeature',
  interfaceName: 'CollectionFeatureBlock',
  labels: { singular: 'Collection feature', plural: 'Collection features' },
  /** 66 bytes at the default name. See the module docblock. */
  dbName: ({ tableName }) => `${tableName}_blocks_collection`,
  fields: [
    {
      name: 'collection',
      type: 'relationship',
      relationTo: 'collections',
      validate: validateRequiredRelationship,
      admin: {
        description:
          'The collection this section sells. The link is derived from it, so this section always has a way into the shop.',
      },
    },
    eyebrow,
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      admin: { description: 'Optional. Falls back to the collection’s hero image.' },
    },
    {
      name: 'mobileImage',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description:
          'Optional portrait crop for narrow screens. Falls back to re-cropping the image above.',
      },
    },
    {
      name: 'body',
      type: 'textarea',
      admin: {
        description: 'One or two lines. The collection page carries the full introduction.',
      },
    },
    linkGroup({ name: 'cta', label: 'Call to action' }),
  ],
}

/**
 * *"Social gallery"* (plan §10.1a), *"Social/community gallery"* (feature matrix §3), structure §4
 * step 7.
 *
 * **This is a curated block, not a feed and not user-generated content**, and the two exclusions are
 * separate decisions with separate reasons.
 *
 * *Not a feed* — no document in the corpus approves a social API, the tech stack lists none, and a
 * component that renders nothing until an integration exists is §0.1.17's fake functionality. The
 * images are ones the team has cleared and uploaded.
 *
 * *Not user-generated* — the reference image draws a *"WORN BY THE COMMUNITY"* gallery and
 * `docs/ARCHITECTURE.md` §3.3 already ruled it out of scope, *"with no entity or moderation path"*
 * (**DEV-09**). Nothing here changes that: a `handle` is a credit an editor types, not an account.
 *
 * Why not reuse `gallery` from `editorial.ts`: that block has captions and no per-item link, and
 * §10.1c wants a path out of every commerce-driven section. This one links per image.
 */
export const socialGalleryBlock: Block = {
  slug: 'socialGallery',
  interfaceName: 'SocialGalleryBlock',
  labels: { singular: 'Community gallery', plural: 'Community galleries' },
  fields: [
    { name: 'heading', type: 'text' },
    {
      name: 'items',
      type: 'array',
      minRows: 3,
      maxRows: 8,
      required: true,
      labels: { singular: 'Post', plural: 'Posts' },
      admin: {
        description:
          'Images the team has cleared for use. This is not a live feed — nothing is fetched from a social network, and nothing here is submitted by a customer.',
      },
      fields: [
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          validate: validateRequiredUpload,
        },
        {
          name: 'handle',
          type: 'text',
          admin: { description: 'Optional credit — "@northslash01".' },
        },
        linkGroup({ name: 'link', label: 'Links to' }),
      ],
    },
  ],
}

/**
 * The set, in the order the block picker offers them — which is structure §4's composition order:
 * hero, categories, new arrivals, editorial, best sellers/limited, brand story, community.
 *
 * The five imported from `./editorial` are the *same objects* the `collections` and `edits`
 * collections use. Payload sanitises a block config once and keys storage off the parent table name,
 * so one object safely serves three parents and produces three separate tables — and one shared
 * interface in `payload-types.ts`, which is what `interfaceName` buys.
 */
export const homeBlocks: Block[] = [
  heroBlock,
  promoStripBlock,
  categoryTilesBlock,
  productRailBlock,
  splitFeatureBlock,
  figureBlock,
  editorialBlock,
  shopTheLookBlock,
  productGroupBlock,
  collectionFeatureBlock,
  socialGalleryBlock,
]
