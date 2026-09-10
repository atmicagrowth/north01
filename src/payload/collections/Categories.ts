import type { CollectionConfig, RelationshipFieldSingleValidation } from 'payload'

import { isAdmin, isStaff, publishedOnly } from '../access'
import { seoField } from '../fields/seo'
import { slugField } from '../fields/slug'
import { revalidateCollection, revalidateCollectionDelete } from '../hooks/revalidateTags'
import { syncCategoryRename } from '../hooks/syncTaxonomyRename'

/**
 * A relationship value, as an id — `4`, `"4"`, `{ id: 4, … }` (a populated document, which the Local
 * API will happily hand a validator) or `{ relationTo, value }` (the polymorphic shape). All four
 * reach this field, and comparing the raw values would silently miss three of them.
 */
function toCategoryId(value: unknown): null | number {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    const parsed = Number(trimmed)

    // `Number('')` is 0, which is a plausible-looking id that no row ever has.
    return trimmed !== '' && Number.isInteger(parsed) ? parsed : null
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as { id?: unknown; value?: unknown }

    return toCategoryId(record.value ?? record.id)
  }

  return null
}

const SELF_PARENT = 'A category cannot be its own parent.'

const SELF_ANCESTOR =
  'That category sits below this one, so this would make the category its own ancestor. Move the child out first.'

/**
 * **A category may not be its own ancestor — checked the whole way up, not one hop.**
 *
 * Three things are worth knowing about the shape of this:
 *
 * **One query, not one per level.** The obvious implementation walks `findByID` up the chain, which
 * is a round trip per generation. The taxonomy is a bounded set — plan §6.1d's own rule is *"avoid
 * creating categories that are not actually used"* — so reading all of them once and walking a
 * `Map` in memory is both cheaper and the pattern `syncCategoryRename` already uses for the mirror
 * problem (walking *down*).
 *
 * **It skips the read while the editor is still typing.** Payload re-runs every field's validator on
 * each form-state request, tagged `event: 'onChange'`; the real save is tagged `'submit'` (see
 * `fields/hooks/beforeChange/promise.js`). Without the guard, one keystroke anywhere on the form —
 * in the name, in the description — costs a full read of the taxonomy. The cheap self-parent test
 * still runs on every change, so the mistake an editor actually makes is flagged live; the ancestry
 * walk waits for the save it would refuse.
 *
 * **It reports only the cycle this edit would create.** Walking up from the *proposed parent* and
 * stopping on any repeat means a cycle that already exists elsewhere in the tree terminates the loop
 * without blaming this save for it. A validator that refused an unrelated edit because the data was
 * already broken would leave an editor with no way to fix anything.
 *
 * On create there is nothing to check: a row with no id yet cannot be anyone's ancestor.
 */
const validateParent: RelationshipFieldSingleValidation = async (value, { event, id, req }) => {
  const parentId = toCategoryId(value)
  const selfId = toCategoryId(id)

  if (parentId === null || selfId === null) {
    return true
  }

  if (parentId === selfId) {
    return SELF_PARENT
  }

  if (event === 'onChange') {
    return true
  }

  const { docs } = await req.payload.find({
    collection: 'categories',
    depth: 0,
    limit: 0,
    overrideAccess: true,
    pagination: false,
    req,
    select: { parent: true },
  })

  const parentOf = new Map<number, number>()

  for (const doc of docs) {
    const parent = toCategoryId(doc.parent)

    if (parent !== null) {
      parentOf.set(doc.id, parent)
    }
  }

  const seen = new Set<number>()
  let cursor: number | undefined = parentId

  while (cursor !== undefined && !seen.has(cursor)) {
    if (cursor === selfId) {
      return SELF_ANCESTOR
    }

    seen.add(cursor)
    cursor = parentOf.get(cursor)
  }

  return true
}

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
 * self-referencing foreign key, and a validator that counted levels would be policing tidiness
 * rather than correctness — a four-level taxonomy renders perfectly well, it is merely deeper than
 * the plan's example.
 *
 * **A cycle is a different matter, and Phase 28 closes it.** Phase 6 enforced only the one-hop case
 * — a category as its own *parent* — and deliberately left `A → B → A`, which is reachable through
 * two separate saves, to the traversals that would otherwise loop on it. Those guards were built and
 * they hold: `expandCategory`, `withAncestors` and `syncCategoryRename`'s subtree walk each carry a
 * `seen` set, so a cycle hangs nothing today. What it still does is produce a taxonomy that is
 * nonsense in both directions — file Clothing under Tops and `/shop/tops` starts listing every pair
 * of trousers in the shop, because "every descendant of Tops" now includes Tops' own parent.
 *
 * Plan §28.1d is the instruction that changes the trade-off: the admin *"must not permit"* an
 * invalid state to be created accidentally, and a self-ancestor is exactly that. `validateParent`
 * above refuses it at the point of the save, at a cost of one bounded query on the save of a
 * category that has a parent — not on every keystroke, and not on a category with no parent at all.
 * The downstream `seen` guards stay where they are: they defend against a cycle that already exists
 * in the data, which this validator cannot retroactively undo.
 */
export const Categories: CollectionConfig = {
  slug: 'categories',

  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'parent', 'status', 'sortOrder', 'updatedAt'],
    group: 'Catalogue',
    description: 'The shop taxonomy. Only create a category that navigation or a filter uses.',
  },

  /**
   * The taxonomy *is* the shop's navigation and its category filter, so a save here changes both.
   *
   * `shell` and `navigation` are the mega menu and the mobile navigation, which Phase 9 already
   * drives from this collection; `catalog` is Phase 11's filter vocabulary. A category renamed in
   * the CMS should read the same in the header and in the filter panel, and without this hook the
   * two would disagree for up to five minutes.
   *
   * **It re-indexes on a rename.** Phase 12 made category NAMES searchable, so renaming a category
   * changes every descendant product's record while saving none of them. `syncCategoryRename`
   * resolves the whole subtree and rebuilds it in a bounded number of round trips, and only when the
   * slug or the display name actually moved. Verified end to end against the running application:
   * renaming a grandparent updates a product tagged with only its leaf category.
   */
  hooks: {
    afterChange: [syncCategoryRename, revalidateCollection('catalog', 'shell', 'navigation')],
    afterDelete: [revalidateCollectionDelete('catalog', 'shell', 'navigation')],
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
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description:
          'As it appears in navigation. Title case — "Field Jackets". Renaming it updates the header, the shop filters and search for every product beneath this category, including products filed under its children; you do not need to re-save any of them.',
      },
    },
    slugField(),
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'categories',
      index: true,
      admin: {
        position: 'sidebar',
        description:
          'The category this one sits beneath — Tops beneath Clothing. Leave it empty for a top-level category. The picker will not offer this category itself, and a save that would file it beneath one of its own children is refused: a category cannot end up inside itself.',
      },
      /**
       * `filterOptions` removes the document from its own picker, so the admin panel does not offer
       * the one-hop mistake at all. It cannot express the longer one — "not any of my descendants"
       * is a recursive question and a `Where` is not recursive — and it is not a control in the
       * first place: a REST or Local API write never sees the picker. `validateParent` is what both
       * of those meet, and it covers the whole chain.
       */
      filterOptions: ({ id }) => (id ? { id: { not_equals: id } } : true),
      validate: validateParent,
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
        description:
          'Lower sorts first, within the same parent. Ties fall back to alphabetical order. This is the order in the mega menu and in the shop filter panel — not the order of this list, which is sorted for the admin panel.',
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
        description:
          'A draft is hidden from the mega menu, the shop filters, the homepage category tiles and the sitemap, and its own page is not reachable. It does not cascade in either direction: publishing this does not publish its children, and putting it back to draft leaves its published children on the site, where they then read as top-level categories. To retire a whole branch, set every category in it to draft. Products are unaffected either way — they stay published and stay in search.',
      },
    },
    seoField(),
  ],
}
