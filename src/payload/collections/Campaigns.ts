import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff, publishedOnly } from '../access'
import { linkGroup } from '../fields/link'
import { revalidateCollection, revalidateCollectionDelete } from '../hooks/revalidateTags'
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

    /**
     * **This is the one collection where `publishedAt` really is an embargo**, and saying so is
     * worth more than saying it anywhere else.
     *
     * A campaign has no route of its own (**DEV-39** removed `campaigns` from `LINKABLE_COLLECTIONS`
     * and from the route map), so the only place it ever appears is the homepage `hero` block — and
     * `home/resolve.ts` gates that block on `isPublicDocument`, which checks `status` **and**
     * `publishedAt`. A future-dated campaign is therefore genuinely held back: the hero block
     * resolves to `null` and the homepage falls through to whatever comes next.
     *
     * That fall-through is the part an editor has to be told. Scheduling a campaign for Monday does
     * not leave last season's hero up; it leaves the homepage opening on its second block until
     * Monday. The homepage global has to keep pointing at the campaign that should be live.
     */
    description:
      'Seasonal statements — the homepage hero, and nothing else. A future date really does hold this one back, and until it passes the homepage opens on whatever block comes after the hero.',

    /** Season is how a campaign is named out loud. Both fields are indexed. */
    listSearchableFields: ['title', 'season', 'slug'],
  },

  defaultSort: '-publishedAt',

  /**
   * **The campaign is the homepage hero**, so a save here changes the largest statement on the site
   * and must not wait out the storefront's five-minute cache floor. Deleting one changes the page
   * too — the hero is dropped — and no `afterChange` fires for that, hence both hooks.
   *
   * This is the only collection that revalidates the homepage. Product saves deliberately do not:
   * they fire on every variant change through `syncProductDerived`, and the rails are a
   * 300-second-stale merchandising surface by design. See `hooks/revalidateTags.ts`.
   */
  hooks: {
    afterChange: [revalidateCollection('home')],
    afterDelete: [revalidateCollectionDelete('home')],
  },

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
            /**
             * Plan §10.1b lists both a *"Primary CTA"* and a *"Secondary CTA"* on the hero, and
             * Phase 6 shipped only the primary. It is added here rather than to the homepage's
             * `hero` block for the reason that block has one field: the campaign is the single
             * source of the campaign statement, and a second call to action living somewhere else
             * would leave an editor updating a campaign and watching half of it stay behind.
             *
             * Purely additive — one enum and three columns, and the reference half is polymorphic
             * so it lands in `campaigns_rels` rather than adding a foreign key column.
             */
            linkGroup({ name: 'secondaryCta', label: 'Secondary call to action' }),
          ],
        },
        /**
         * ### Both fields in this tab are read by nothing, and the descriptions now say so
         *
         * Phase 28's audit (§28.1c) traced every campaign field to a renderer. Seven of them arrive
         * somewhere — `title`, `season`, `story`, `hero`, `mobileHero`, `cta` and `secondaryCta` are
         * all read by `home/resolve.ts`'s `hero` case. `collection` and `products` are read by
         * **nothing**: `grep -rn campaigns src/lib src/components src/app` finds only comments, and
         * `scripts/seed.ts` populates both, so a client opening a seeded campaign sees a filled-in
         * Merchandise tab that has never rendered a pixel.
         *
         * That is §0.1.17's fake control — *"never build UI that looks functional but does nothing"* —
         * and it exists because **DEV-39** took the campaign's own route away. Plan §6.1g listed
         * these fields for a campaign *page*; without that page, `cta` is the whole editorial-to-
         * commerce path §10.1c asks for, and `collection` is a second, silent way to say the same
         * thing.
         *
         * **They are described rather than hidden or removed**, and the difference matters:
         *
         * - Removing them is a migration (two columns' worth of `campaigns_rels` rows), which this
         *   phase is explicitly not allowed to author. It is filed as a schema change instead.
         * - `admin.hidden` would take the fields off the screen without a migration, but the seed
         *   writes them, so hiding would leave a client with data they can neither see nor correct —
         *   trading a misleading field for an invisible one.
         *
         * An honest label is the fix that is both available and reversible. When a phase gives
         * campaigns a page, the descriptions come off with the same commit that renders them.
         */
        {
          label: 'Merchandise',
          fields: [
            {
              name: 'collection',
              type: 'relationship',
              relationTo: 'collections',
              admin: {
                description:
                  'Not shown anywhere on the site today — a campaign appears only as the homepage hero, which has no room for a merchandise link. Use the Call to action on the Campaign tab to send readers to this collection; that button is the one that renders.',
              },
            },
            {
              name: 'products',
              type: 'relationship',
              relationTo: 'products',
              hasMany: true,
              admin: {
                description:
                  'Not shown anywhere on the site today — there is no campaign rail to fill. To put products on the homepage, add a Product rail block to the Homepage instead; anything entered here is stored and never rendered.',
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
