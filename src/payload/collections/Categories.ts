import type { CollectionConfig } from 'payload'

import { seoField } from '../fields/seo'
import { slugField } from '../fields/slug'

/**
 * The product taxonomy. Plan §6.1d gives the shape by example — Clothing, Tops, Shirts, Hoodies,
 * Sweatshirts, Jackets, Pants, Shorts, Accessories — and then gives the rule that matters:
 *
 * > "Avoid creating categories that are not actually used in navigation or filters."
 *
 * That rule is why this is a *shallow tree* rather than a flat list or an arbitrary one. The example
 * set is two levels in places (Clothing → Tops → Shirts is three), the structure document's SHOP
 * node has exactly two children that are categories — Clothing and Accessories (§2) — and the mega
 * menu is "driven from Payload" (feature matrix §1). A `parent` self-relationship expresses all of
 * that with one nullable column.
 *
 * **New Arrivals and Best Sellers are not categories.** They appear beside Clothing and Accessories
 * under SHOP in structure §2, and modelling them as categories would mean an editor maintaining
 * membership by hand for something the data already knows. They are the `isNew` and `isBestSeller`
 * flags on the product (plan §6.1b), rendered as navigation entries by Phase 9.
 *
 * **Depth is not enforced in the schema.** Postgres cannot express "at most three levels" through a
 * self-referencing foreign key, and a validator that walked the ancestry on every save would be a
 * query per write to prevent a mistake an editor makes once. The constraint that *is* enforced is
 * the one that corrupts data rather than merely looking untidy: a category cannot be its own parent.
 * A longer cycle (A → B → A) is still reachable through two separate saves; Phase 9, which renders
 * the tree, is where a traversal guard belongs, because it is the code that would otherwise loop.
 */
export const Categories: CollectionConfig = {
  slug: 'categories',

  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'parent', 'status', 'sortOrder', 'updatedAt'],
    group: 'Catalogue',
    description: 'The shop taxonomy. Only create a category that navigation or a filter uses.',
  },

  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'As it appears in navigation. Title case — "Field Jackets".' },
    },
    slugField(),
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'categories',
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Leave empty for a top-level category.',
      },
      /**
       * Self-parenting is the one cycle a single save can create, and the one that makes a
       * breadth-first render loop immediately. `filterOptions` also removes the document from its
       * own picker, so the admin panel does not offer the mistake in the first place — but the
       * validator is what a REST client meets.
       */
      filterOptions: ({ id }) => (id ? { id: { not_equals: id } } : true),
      validate: (value: unknown, { id }: { id?: number | string }) =>
        value !== undefined && value !== null && id !== undefined && String(value) === String(id)
          ? 'A category cannot be its own parent.'
          : true,
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Optional. Rendered as the introduction on the category page.',
      },
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      admin: {
        position: 'sidebar',
        description: 'Optional. Used by the featured-category tiles and the mega menu.',
      },
    },
    {
      /**
       * Editorial order, not alphabetical. Tops before Jackets is a merchandising decision, and a
       * category list sorted by name is the tell of a system that could not express one. Indexed
       * because every navigation query sorts by it.
       */
      name: 'sortOrder',
      type: 'number',
      required: true,
      defaultValue: 0,
      index: true,
      admin: {
        position: 'sidebar',
        step: 1,
        description: 'Lower sorts first, within the same parent.',
      },
    },
    {
      /**
       * Feature matrix §1 lists "unpublished collection" among the global-shell edge cases; the same
       * applies to a category that is being prepared. `draft` here is the whole mechanism — see
       * `publishingFields` for why this project does not use Payload's versions/drafts subsystem.
       * A category has no `publishedAt`: nothing schedules a taxonomy.
       */
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      index: true,
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
      admin: {
        position: 'sidebar',
        description: 'Drafts are hidden from navigation, filters and the sitemap.',
      },
    },
    seoField(),
  ],
}
