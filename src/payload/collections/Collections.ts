import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff, publishedOnly } from '../access'
import { editorialBlocks } from '../blocks/editorial'
import { publishingFields, seoField } from '../fields/seo'
import { slugField } from '../fields/slug'
import { revalidateCollection, revalidateCollectionDelete } from '../hooks/revalidateTags'
import { syncSearchIndexForCollection } from '../hooks/syncSearchIndex'
import { syncCollectionRename } from '../hooks/syncTaxonomyRename'

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

    /**
     * **The description is where the list view stops lying about scheduling** — Phase 28, §28.1c.
     *
     * `publishingFields()` describes `publishedAt` as *"a future date schedules the page"*, and for a
     * collection that is not what happens. `access.read` is `publishedOnly`, which checks `status`
     * and deliberately not `publishedAt` (see `access/index.ts`), and `getCollectionPage` adds no
     * date clause of its own — so a collection dated next month is **already at its URL** the moment
     * it is published. What the date really controls is the two places that *do* apply it:
     * `navigation/resolve.ts` drops a menu item pointing at a future-dated document, and
     * `home/resolve.ts`'s `isPublicDocument` keeps it out of the homepage rails.
     *
     * An editor who reads "scheduled" and treats the date as an embargo would publish a collection
     * early and never know. Two columns and an accurate sentence beside them is the whole fix; the
     * inaccurate field-level wording lives in `fields/seo.ts`, which this phase does not own.
     */
    description:
      'Campaign-led merchandising pages at /collections/… Published is live the moment you save it — a future date does not hold the page back, it only keeps the collection out of navigation menus and the homepage until the date passes.',

    /**
     * The list search box searches `useAsTitle` alone unless told otherwise, and the question an
     * editor actually arrives with is a URL — *"the /collections/winter-layers page is wrong"* — not
     * a title. `slug` is `unique` and indexed (`fields/slug.ts`), so this is an index lookup rather
     * than a scan, and `listSearchableFields` is a query option rather than a column: no migration.
     */
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

  /**
   * **Membership lives here, so the index has to be told from here.**
   *
   * `Products.ts` puts collection membership on the collection — *"an order is a property of the
   * list, not of its members"* — which means adding a product to "Essentials" changes *that
   * product's* `collectionSlugs` facet and fires no product hook at all. Without
   * `syncSearchIndexForCollection`, a curated set would only become filterable after the next
   * unrelated save on each of its members.
   *
   * `catalog` is the filter vocabulary: publishing, renaming or unpublishing a collection changes
   * the options the shop's filter panel offers.
   */
  hooks: {
    afterChange: [
      syncSearchIndexForCollection,
      syncCollectionRename,
      revalidateCollection('catalog'),
    ],
    afterDelete: [revalidateCollectionDelete('catalog')],
  },

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
            /**
             * **No `filterOptions` on this field, and that is a decision rather than an omission.**
             *
             * §28.1d asks the admin to refuse invalid commerce states, and "a draft product featured
             * on a published collection" looks like one. It is not, and `filterOptions` is the wrong
             * instrument for it twice over — Payload applies the filter to the *picker* **and**
             * re-runs it as a `find` on every save, rejecting any id the query does not return
             * (`payload/dist/fields/validations.js` → `validateFilterOptions`). So:
             *
             * - **A `status: published` filter would forbid the normal way a drop is built.** A
             *   collection and its garments are drafted together and published on the same morning.
             *   Requiring every member to be live first inverts that order, and the editor meets it
             *   as *"The following field is invalid: products"* with no clue which row is at fault.
             * - **Any filter at all would break saves that have nothing to do with it.** `products`
             *   carries `trash: true`, and Payload's `find` excludes trashed rows by default — so the
             *   morning a merchandiser soft-deletes one garment, every collection still referencing
             *   it refuses to save, on a field nobody touched.
             *
             * The rule belongs where it already is: `lib/editorial/read.ts` re-queries membership
             * through `publishedProductWhere(now)` and drops anything not sellable. What the admin
             * owes the editor is not a block but an explanation, which the description gives.
             */
            {
              name: 'products',
              type: 'relationship',
              relationTo: 'products',
              hasMany: true,
              index: true,
              admin: {
                description:
                  'Every product in this collection, in the order the customer sees. Dragging a row is the curation — feature matrix §12. A product that is still a draft, dated in the future, or has no variant left in stock is dropped from the live page without warning, so a page shorter than this list means a product is not ready — not that a row was lost.',
              },
            },
            {
              name: 'relatedCollections',
              type: 'relationship',
              relationTo: 'collections',
              hasMany: true,
              admin: {
                description:
                  'Shown at the foot of the page — plan §23.1a. Keeps an editorial page from being a dead end. A draft collection listed here shows nothing rather than a broken link, so publish both before you rely on the pairing.',
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
