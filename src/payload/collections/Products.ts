import type { CollectionConfig } from 'payload'

import { minorUnits } from '../fields/money'
import { publishingFields, seoField } from '../fields/seo'
import { slugField } from '../fields/slug'
import { cascadeDelete } from '../hooks/cascadeDelete'

/**
 * The merchandising entity. Plan §2.1 is explicit about what that means: *"A product is the
 * merchandising entity. A variant is the purchasable unit."* Nothing here can be bought — no price,
 * no SKU, no stock. Those live on `product-variants`, one row per purchasable combination, and plan
 * §2.1 forbids the shortcut that would avoid them: *"Do not store a single global inventory number
 * when variants have independent size/color stock."*
 *
 * Fields follow plan §6.1b in order, plus three the corpus requires and that section omits:
 * `gender` (**G-03** — an Algolia filterable attribute in plan §12.1a with no field to index),
 * `sizeGuide` (**G-02** — §6.1b names a "size guide reference" pointing at a collection no document
 * defines), and the `derived` group below (**G-04**). All three are recorded in **DEV-10**.
 *
 * ---
 *
 * ### The `derived` group, and why a data-model phase contains a cache
 *
 * **G-04**, assigned to this phase: *"Price is owned by the variant, yet listings and the PDP must
 * show a product-level price. No document says how it is derived."* Every product card in the
 * corpus shows a price (feature matrix §4), and plan §11.1a requires sorting a grid by price
 * low-to-high and high-to-low.
 *
 * A product-level price is therefore an aggregate over its active variants, and there are only three
 * places to compute it:
 *
 * - **At render.** A query per card. A twenty-four product grid is twenty-four extra round trips,
 *   and the sort is impossible — Postgres cannot order by a value the application computes after the
 *   rows come back.
 * - **In Payload's `virtual` fields.** Same aggregate, moved into an `afterRead` hook. Still not
 *   sortable and still not filterable, because a virtual field has no column.
 * - **Denormalised here**, recomputed whenever a variant changes. Sortable, filterable, one column.
 *
 * The third, then. It is a genuine denormalisation and the §6 prompt asks for exactly this to be
 * declared rather than discovered: **these four values duplicate nothing and derive everything.**
 * The variant remains the sole owner of price and stock; this group is a materialised view of them
 * that Postgres cannot maintain for us, and `syncProductDerived` is what maintains it. If it is ever
 * wrong, the variants are right.
 *
 * Its members are not a wish list — each one is the only way to render a state the plan requires:
 *
 * | Field | Required by |
 * |---|---|
 * | `priceFromMinor` / `priceToMinor` | the price on every card (feature matrix §4); price sorting (plan §11.1a) |
 * | `compareAtFromMinor` | the **Sale** card state (plan §11.1b.5) |
 * | `inStock` | the **Sold out** card state (plan §11.1b.7) |
 *
 * **What is deliberately *not* cached here: review aggregates.** Feature matrix §5 offers a rating
 * sort "where enough real review data exists" and plan §13.1f wants an average and a distribution —
 * the same argument as above would apply. It is not made here because nothing assigns it to this
 * phase: reviews are **Phase 21**, and a column that no phase yet writes is a column that quietly
 * reads zero on every product card in the meantime. Phase 21 adds it with the migration that adds
 * the behaviour.
 */
export const Products: CollectionConfig = {
  slug: 'products',

  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'status', 'gender', 'featured', 'updatedAt'],
    group: 'Catalogue',
    description:
      'Merchandising records. Price, SKU and stock live on the variants beneath each one.',
  },

  /**
   * `docs/DATABASE.md` §8: soft delete where a delete must be recoverable. A product is referenced
   * by carts, wishlists, order items, editorial blocks and hotspots; a hard delete would null every
   * one of those references (`ON DELETE SET NULL`) with nothing to undo it from. Note that this is
   * *not* how a product is taken off sale — `status: 'draft'` is, and the two are deliberately
   * different columns.
   */
  trash: true,

  defaultSort: '-updatedAt',

  hooks: {
    /**
     * Four dependants carry a **required** reference to a product, which Postgres stores as
     * `NOT NULL` with `ON DELETE SET NULL` — a combination that makes the delete fail rather than
     * cascade. They are removed first, deepest first: variants go before bag lines because deleting
     * a variant cascades to bag lines of its own. See `hooks/cascadeDelete.ts`.
     *
     * Reached only by a permanent delete from the trash view; `trash: true` above means the ordinary
     * admin delete is an update.
     */
    beforeDelete: [
      cascadeDelete([
        { collection: 'cart-items', on: 'product' },
        { collection: 'product-variants', on: 'product', includeTrashed: true },
        { collection: 'wishlist-items', on: 'product' },
        { collection: 'reviews', on: 'product', includeTrashed: true },
      ]),
    ],
  },

  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Product',
          fields: [
            {
              name: 'name',
              type: 'text',
              required: true,
              index: true,
              admin: { description: 'The product name as the customer reads it.' },
            },
            {
              name: 'shortDescription',
              type: 'textarea',
              maxLength: 240,
              admin: {
                description:
                  'One or two lines. Used on cards, in search results and as the SEO description fallback.',
              },
            },
            {
              name: 'description',
              type: 'richText',
              admin: { description: 'The full description, shown in the PDP accordion.' },
            },
            {
              name: 'editorialCopy',
              type: 'richText',
              admin: {
                description:
                  'Optional. The voice-led paragraph beside the gallery — plan §6.1b. Distinct from the description, which is factual.',
              },
            },
          ],
        },
        {
          label: 'Variants',
          fields: [
            {
              /**
               * Virtual. The rows live in `product-variants` and this is the window onto them, so an
               * editor works on a product and its sizes in one place without the schema storing the
               * relationship twice. Sorted the way the size selector will render it.
               */
              name: 'variants',
              type: 'join',
              collection: 'product-variants',
              on: 'product',
              defaultSort: 'sizeSortOrder',
              defaultLimit: 50,
              admin: {
                description:
                  'The purchasable rows. Price, SKU and stock live here — a product with no active variant cannot be bought.',
              },
            },
          ],
        },
        {
          label: 'Media',
          fields: [
            {
              /**
               * An array rather than a `hasMany` upload. Both preserve order and both cost one
               * table; the array is where Phase 8's per-image metadata (role, focal point, an alt
               * override for this context) lands without changing the shape of what is already
               * stored. Plan §13.1a's gallery — thumbnails, full-screen viewer, zoom — is going to
               * want it.
               */
              name: 'gallery',
              type: 'array',
              maxRows: 12,
              labels: { singular: 'Image', plural: 'Images' },
              admin: {
                description:
                  'The first image is the card image. Media handling is completed in Phase 8; missing images render a neutral placeholder rather than breaking the layout.',
              },
              fields: [
                {
                  name: 'image',
                  type: 'upload',
                  relationTo: 'media',
                  required: true,
                },
              ],
            },
            {
              name: 'video',
              type: 'upload',
              relationTo: 'media',
              admin: {
                description:
                  'Optional — plan §6.1b. Plan §13.1a treats it as an addition to the gallery, never a replacement.',
              },
            },
          ],
        },
        {
          label: 'Details',
          fields: [
            {
              /**
               * Indexed as a searchable attribute in plan §12.1a. `hasMany` text stores these in a
               * `products_texts` table; `index: true` indexes that table, which is what makes
               * "everything in linen" a lookup rather than a scan.
               */
              name: 'materials',
              type: 'text',
              hasMany: true,
              index: true,
              admin: {
                description: 'One per entry — "100% Japanese cotton", "Horn buttons".',
              },
            },
            {
              name: 'care',
              type: 'richText',
              admin: { description: 'The Care accordion on the PDP — plan §13.1e.' },
            },
            {
              name: 'fit',
              type: 'select',
              index: true,
              options: [
                { label: 'Slim', value: 'slim' },
                { label: 'Regular', value: 'regular' },
                { label: 'Relaxed', value: 'relaxed' },
                { label: 'Oversized', value: 'oversized' },
              ],
              admin: { description: 'A searchable attribute — plan §12.1a.' },
            },
            {
              name: 'fitNotes',
              type: 'textarea',
              admin: {
                description:
                  'Optional. "Model is 6\'1\" and wears a medium." Rendered in the Size & Fit accordion.',
              },
            },
            {
              name: 'sizeGuide',
              type: 'relationship',
              relationTo: 'size-guides',
              admin: {
                description:
                  'Opens from the PDP beside the size selector — feature matrix §8. Gap G-02: §6.1b names this reference and no document defined what it points at.',
              },
            },
          ],
        },
        {
          label: 'Taxonomy',
          fields: [
            {
              name: 'categories',
              type: 'relationship',
              relationTo: 'categories',
              hasMany: true,
              index: true,
              admin: { description: 'Where this product appears in shop navigation and filters.' },
            },
            {
              /**
               * **Membership is owned by the collection, not by the product**, and this is the read
               * side of it — a `join`, which is virtual and adds no column.
               *
               * The direction is forced by ordering. Feature matrix §12 requires *"curated product
               * ordering"* on a collection page, and an order is a property of the list, not of its
               * members: `collections.products` is an ordered `hasMany`, and dragging a row there is
               * the curation. Storing the membership on both sides would be the duplication the §6
               * prompt warns against, and the two copies would disagree within a week.
               *
               * Categories go the other way for the same reason inverted — a category page has no
               * hand-curated order (products sort by `sortOrder`, price or newness), so the product
               * owns `categories` and the category needs no list.
               */
              name: 'collections',
              type: 'join',
              collection: 'collections',
              on: 'products',
              admin: {
                description:
                  'Merchandising sets this product appears in. Add or remove it from the collection itself.',
              },
            },
            {
              name: 'gender',
              type: 'select',
              index: true,
              options: [
                { label: 'Women', value: 'women' },
                { label: 'Men', value: 'men' },
                { label: 'Unisex', value: 'unisex' },
              ],
              admin: {
                description:
                  'A filterable attribute in plan §12.1a. Gap G-03: the attribute was required and no field stored it.',
              },
            },
            {
              name: 'tags',
              type: 'text',
              hasMany: true,
              index: true,
              admin: {
                description:
                  'Free-form, lowercase. A filterable attribute in plan §12.1a; keep the vocabulary small or the facet becomes noise.',
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

    // ---- Sidebar ----

    slugField(),
    /**
     * The same `status` + `publishedAt` pair every publishable collection here carries. `publishedAt`
     * is what feature matrix §5's **Newest** sort orders by: `createdAt` would sort by when the
     * record was typed, which for a catalogue seeded in one afternoon is not an order at all, and
     * which an editor cannot correct. Drafts are re-checked server-side before anything is added to
     * a bag or paid for (plan §13.1d, §17.1a).
     */
    ...publishingFields(),
    {
      /**
       * Plan §6.1b's four flags. They are separate booleans rather than one "badge" select because
       * they are not mutually exclusive — a limited edition can also be new — and because each
       * drives a different surface: `featured` a homepage rail, `isNew` the NEW navigation entry,
       * `isBestSeller` a sort and a SHOP child, `isLimitedEdition` a card treatment and a homepage
       * section (feature matrix §3).
       *
       * All four are indexed: every one of those surfaces is a `where` clause.
       */
      type: 'collapsible',
      label: 'Merchandising flags',
      admin: { position: 'sidebar', initCollapsed: false },
      fields: [
        {
          name: 'featured',
          type: 'checkbox',
          defaultValue: false,
          index: true,
          admin: { description: 'Eligible for the homepage and for the Featured sort.' },
        },
        {
          name: 'isNew',
          type: 'checkbox',
          defaultValue: false,
          index: true,
          label: 'New',
          admin: {
            description:
              'Drives the NEW navigation entry. Set and cleared by hand — nothing expires it.',
          },
        },
        {
          name: 'isBestSeller',
          type: 'checkbox',
          defaultValue: false,
          index: true,
          label: 'Best seller',
        },
        {
          name: 'isLimitedEdition',
          type: 'checkbox',
          defaultValue: false,
          index: true,
          label: 'Limited edition',
        },
      ],
    },
    {
      /**
       * Plan §6.1b's "sort order if curated". The Featured sort (feature matrix §5) needs a
       * deliberate order, and alphabetical is not one.
       */
      name: 'sortOrder',
      type: 'number',
      required: true,
      defaultValue: 0,
      index: true,
      admin: {
        position: 'sidebar',
        step: 1,
        description: 'Lower sorts first in curated listings.',
      },
    },
    {
      name: 'derived',
      type: 'group',
      label: 'Derived from variants',
      admin: {
        position: 'sidebar',
        description:
          'Maintained automatically whenever a variant changes. Read-only: the variants are the source of truth, and if these disagree the variants are right.',
      },
      fields: [
        minorUnits({
          name: 'priceFromMinor',
          label: 'Lowest active price',
          // The column plan §11.1a's price sort orders by.
          index: true,
          admin: { readOnly: true },
        }),
        minorUnits({
          name: 'priceToMinor',
          label: 'Highest active price',
          index: true,
          admin: { readOnly: true },
        }),
        minorUnits({
          name: 'compareAtFromMinor',
          label: 'Compare-at of the lowest price',
          admin: { readOnly: true },
        }),
        {
          /**
           * The sum of stock across active variants — a *number*, not an `inStock` flag, and not a
           * `lowStock` flag either. Both booleans were considered and both are worse:
           *
           * - `inStock` throws away the information the low-stock state needs, so the card would
           *   need a second column to say "only a few left".
           * - `lowStock` would have to be computed against `siteSettings.lowStockThreshold` at write
           *   time, which means every product in the catalogue silently holds a stale answer the
           *   moment an editor changes that threshold.
           *
           * One count avoids both. **Sold out** is `= 0`, **low stock** is `<= threshold` compared
           * at render, and **in stock** is anything above — plan §11.1b's card states 6 and 7, and
           * §13.1b's inventory messaging, from a single column that cannot drift.
           */
          name: 'inventoryTotal',
          type: 'number',
          required: true,
          defaultValue: 0,
          min: 0,
          index: true,
          label: 'Units in stock across active variants',
          admin: { readOnly: true, step: 1 },
        },
      ],
    },
  ],
}
