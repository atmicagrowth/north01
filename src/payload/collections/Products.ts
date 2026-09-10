import type { CollectionBeforeValidateHook, CollectionConfig, PayloadRequest } from 'payload'

import { ValidationError } from 'payload'

import { isAdmin, isStaff, nobodyField, publishedOnly } from '../access'
import { minorUnits } from '../fields/money'
import { publishingFields, seoField } from '../fields/seo'
import { slugField } from '../fields/slug'
import { validateRequiredUpload } from '../fields/required'
import { cascadeDelete } from '../hooks/cascadeDelete'
import { revalidateCollection, revalidateCollectionDelete } from '../hooks/revalidateTags'
import { syncSearchIndexAfterChange, syncSearchIndexAfterDelete } from '../hooks/syncSearchIndex'

/**
 * Free-form tags are a *facet*, and a facet is only as good as its vocabulary.
 *
 * The field's description used to ask for "free-form, lowercase" and nothing made it so, which is
 * the kind of unkept promise this project treats as a defect rather than a style note: `Linen`, `linen `
 * and `linen` are one tag to the person typing and three entries in the filter panel plan §12.1a
 * indexes them into. Nothing downstream can repair that — `buildProductRecord` passes tags through
 * verbatim, because a normalisation applied at index time and not at write time is a second
 * vocabulary that disagrees with the one the editor sees.
 *
 * So it happens once, here, on the way in: trimmed, lowercased, empties dropped, duplicates removed,
 * order preserved. The same `beforeValidate` normalisation `slug`, `sku` and `size` already use, and
 * for the same reason — the value stored is the value compared.
 *
 * Non-strings pass through untouched so the field's own validator reports them, rather than being
 * silently swallowed by a hook that was only meant to lowercase.
 */
const normaliseTags = ({ value }: { value?: unknown }): unknown => {
  if (!Array.isArray(value)) {
    return value
  }

  const seen = new Set<unknown>()
  const tags: unknown[] = []

  for (const entry of value) {
    const tag = typeof entry === 'string' ? entry.trim().toLowerCase() : entry

    if (tag === '' || seen.has(tag)) {
      continue
    }

    seen.add(tag)
    tags.push(tag)
  }

  return tags
}

/**
 * Why a product that is about to be published cannot be sold — in the words of the person who has
 * to fix it, and only ever reached on the refusal path below.
 *
 * The decision is made from `derived.priceFromMinor` (see `refuseUnsellablePublish`); this reads the
 * variants afterwards purely to tell the three cases apart. *"Add a variant"*, *"switch one back
 * on"* and *"the summary is stale"* are three different actions, and a single message covering all
 * three would send an editor to look for a variant that is already there.
 *
 * `req` is passed to `find` so the read joins the caller's transaction and sees variants saved
 * moments earlier in the same operation; `payload.find` already excludes trashed rows, which is
 * correct — a variant in the trash is not for sale either.
 */
const explainUnsellable = async ({
  productId,
  req,
}: {
  productId: number | string | undefined
  req: PayloadRequest
}): Promise<string> => {
  const lead =
    'Publishing this would hide it rather than show it: a product with nothing purchasable on it is left out of the shop, of search and of the sitemap.'

  if (productId === undefined) {
    return `${lead} A brand-new product has no variants yet — save it as a draft, add at least one colour and size under Variants, then set it to Published.`
  }

  const { docs } = await req.payload.find({
    collection: 'product-variants',
    where: { product: { equals: productId } },
    limit: 0,
    depth: 0,
    pagination: false,
    req,
  })

  if (docs.length === 0) {
    return `${lead} This product has no variants. Add at least one colour and size under Variants, each with its own price and stock, then publish.`
  }

  const active = docs.filter((variant) => variant.active)

  if (active.length === 0) {
    return `${lead} All ${docs.length} of this product's variants are switched off. Tick Active on at least one of them, then publish.`
  }

  return `${lead} Its price summary has not caught up with its ${active.length} active variant${active.length === 1 ? '' : 's'} — open any one of them and save it again to rebuild it, then publish.`
}

/**
 * **§28.1d: "the admin must not permit publishing malformed products."**
 *
 * A product is not a page, it is an offer, and an offer has preconditions. `publishedProductWhere`
 * in `lib/catalog/query.ts` is where they are written down — the single definition of *listable*,
 * shared by the shop grid, the search index, the sitemap, the wishlist and the PDP. It has three
 * clauses, and `buildProductRecord` adds a fourth requirement of its own (a non-empty name and
 * slug) for the index. All but one of them are already unreachable from the admin: `name` and `slug`
 * are `required` and Payload reports each on its own field, a draft is what this transition is
 * leaving, and a `publishedAt` in the future is a scheduled drop rather than a mistake.
 *
 * The exception — `derived.priceFromMinor` existing — had nothing guarding it, and its failure mode
 * is the worst kind. The save succeeds. The sidebar says **Published**. The product then appears
 * nowhere at all, and there is no message anywhere in the panel that explains it, because the rule
 * that removed it lives in a query an editor never sees. So the *transition* to published is
 * refused, and the refusal says exactly what is missing.
 *
 * **A missing image is deliberately not on that list.** It is the one "malformed product" case the
 * §28 prompt names that the storefront does not agree is one: plan §8.1d answers an absent image
 * with *"a deliberate neutral placeholder"*, `publishedProductWhere` does not look at the gallery,
 * and a product with no photograph is visible, buyable and merely ugly. Refusing that save would be
 * a second opinion — a rule the shop does not hold, invented in the admin panel.
 *
 * **It reads the column the listing reads, not a second opinion.** `derived.priceFromMinor` is
 * `null` exactly when a product has no active, priced variant, which is the merchandising rule
 * `publishedProductWhere` applies. A guard that recomputed its own answer from the variants could
 * pass while the shop's rule failed — a guardrail that certifies an invisible product is worse than
 * none. The variants are read only *after* the decision has been made, to explain it.
 *
 * That is also why the `derived` group below is closed to API writes: if the admin form could send a
 * stale copy of it back, this hook would be reading whatever the browser last saw.
 *
 * **Only the transition.** An already-published product losing its last active variant is a
 * *withdrawal*, and a legitimate one: the listing rule takes it out of the shop, the PDP keeps
 * rendering it for anyone holding the link, and a merchandiser can switch off the last colour of a
 * garment without unpublishing it first. Refusing that save would make the ordinary way to retire a
 * line impossible. It is also what keeps this hook off `syncProductDerived`'s path — that hook
 * writes `{ derived }` and never a status, so it can never look like a transition and can never
 * roll back a variant save.
 *
 * **Duplicate slips past it, and that is the better outcome.** Payload's duplicate is a `create`
 * that hands the hook the *source* document as `originalDoc` (`collections/operations/create.js`),
 * so copying a published product reads here as "already published" and the guard steps aside. The
 * copy is then a published product with no variants of its own — unsellable, filtered out of every
 * listing exactly as the rule intends, and one click away from being fixed. Refusing the button
 * would be worse: a duplicate saves immediately, so there is no form in which to set it to draft
 * first and the editor would be left with an error they cannot act on.
 *
 * **And only for a request that has a user on it.** The seed, an import and a migration build a
 * catalogue in an order they control — the product row first, its variants second — and are not a
 * person clicking Publish; `hooks/enforceCustomerOwnership.ts` draws the same line for the same
 * reason. Nothing is lost by exempting them, because this is an authoring guardrail and not a
 * security boundary: the authority remains `publishedProductWhere`, which filters an unsellable
 * product out of every listing however the row got written.
 */
const refuseUnsellablePublish: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const next = (data as { status?: unknown } | undefined)?.status
  const previous = (originalDoc as { status?: unknown } | undefined)?.status

  if (next !== 'published' || previous === 'published') {
    return data
  }

  if (!req.user) {
    return data
  }

  const derived = (originalDoc as { derived?: { priceFromMinor?: null | number } } | undefined)
    ?.derived

  if (typeof derived?.priceFromMinor === 'number') {
    return data
  }

  throw new ValidationError({
    collection: 'products',
    errors: [
      {
        /*
         * On `status`, so the message opens beside the control the editor just changed rather than
         * as a banner at the top of a six-tab form.
         */
        path: 'status',
        message: await explainUnsellable({
          productId: (originalDoc as { id?: number | string } | undefined)?.id,
          req,
        }),
      },
    ],
    req,
  })
}

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
 * | `inventoryTotal` | the **Sold out** and **Low stock** card states (plan §11.1b.6–7) |
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

    /**
     * **Price and stock are on the list, and they come from the `derived` group** — plan §28.1a asks
     * that a shop manager can *manage* products, and the first question anyone opens this list with
     * is "what does it cost and is there any left". Both are columns rather than a trip into each
     * product because both are indexed columns on `products`; nothing here is computed per row.
     *
     * The dotted names are not a guess. Payload flattens a group's members to the top level for the
     * table and gives each one an `accessor` of `<group>.<field>`, which is what a `defaultColumns`
     * entry is matched against (`@payloadcms/ui`'s `flattenTopLevelFields` and `sortFieldMap`).
     *
     * They read in minor units, like every money value in this schema — the column header says
     * *Lowest active price* and the field description says what 24000 means. A custom `Cell` would
     * format it, and that is exactly the *"unnecessary custom dashboard complexity"* the phase
     * prompt rules out for a cosmetic gain.
     */
    defaultColumns: [
      'name',
      'status',
      'derived.priceFromMinor',
      'derived.inventoryTotal',
      'gender',
      'featured',
      'updatedAt',
    ],

    /**
     * The list's search box searches `useAsTitle` alone unless this says otherwise — and it
     * *replaces* rather than extends, so `name` has to be repeated here (`mergeListSearchAndWhere`).
     *
     * `slug` is the second one because it is the half of a product a colleague pastes into chat: a
     * support question arrives as `/product/field-jacket`, not as "the Field Jacket". Both are
     * indexed text columns on this table.
     *
     * **SKU is deliberately not here, because it cannot be.** A SKU belongs to a variant, and this
     * list can only search its own columns. Searching by SKU is what the Variants list is for, and
     * it opens straight onto the variant's product — see `ProductVariants.listSearchableFields`.
     */
    listSearchableFields: ['name', 'slug'],

    group: 'Catalogue',

    /**
     * Read by a non-technical client, so it answers the question they actually arrive with — *how do
     * I take this off the site?* — rather than restating the collection's name. Plan §28.1a lists
     * "archive product" as a thing the admin must support, and it is supported by two different
     * controls that look interchangeable and are not.
     */
    description:
      'Merchandising records. Price, SKU and stock live on the variants beneath each one. To take a product off the site, set it to Draft — it keeps its variants, its history and its URL, ready to come back. Delete moves it to Trash instead: it can be restored from there, but while it sits in the trash it is also gone from every bag and wishlist that held it.',
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
     * The publish guardrail, §28.1d. `beforeValidate` rather than `beforeChange` so the refusal
     * arrives alongside Payload's own field errors in one response, and because it runs after the
     * field pass — the pass in which the `derived` group's access rule strips whatever the browser
     * sent. The guard reads `originalDoc` regardless, so what it checks is the database's answer and
     * never the form's.
     */
    beforeValidate: [refuseUnsellablePublish],

    /**
     * **Phase 11 gave products an `afterChange`, and two things depend on it.**
     *
     * `syncSearchIndexAfterChange` keeps the Algolia record in step, and `revalidateCollection`
     * expires the two caches a product save can invalidate.
     *
     * It fires on *every* product write, including the ones `syncProductDerived` performs on the
     * product's behalf whenever a variant changes — `recalculateProductDerived` always calls
     * `payload.update`, with no equality check to skip it. That is exactly what is wanted: a variant
     * going out of stock or changing colour changes the product's facets, and routing all of it
     * through the product means one synchronisation path rather than two that can disagree.
     *
     * **`home` is here now, and Phase 10 deliberately left it out.** `revalidateTags.ts` recorded the
     * reason — a product rail is *"a 300-second-stale merchandising surface by design"* — and named
     * this phase as the owner of a tighter guarantee. The listings this phase builds are where a
     * five-minute delay stops being acceptable: a merchandiser who unpublishes a product expects it
     * gone from the shop, not gone in five minutes. `catalog` is the filter vocabulary; `home` is the
     * rails. `revalidateTag(…, 'max')` is stale-while-revalidate, so this costs the *next* request a
     * background refresh rather than a database read in a customer's critical path.
     *
     * Neither hook can recurse. `syncSearchIndex` only reads from Payload and writes to Algolia, and
     * `revalidateCollection` writes nothing at all.
     */
    afterChange: [syncSearchIndexAfterChange, revalidateCollection('catalog', 'home')],

    /**
     * Reached only by a permanent delete from the trash view. The ordinary admin delete is an update
     * (`trash: true`), which goes through `afterChange` above — where `payload.find` no longer
     * returns the soft-deleted row, so the index entry is removed just the same.
     */
    afterDelete: [syncSearchIndexAfterDelete, revalidateCollectionDelete('catalog', 'home')],

    /**
     * Four dependants carry a **required** reference to a product, which Postgres stores as
     * `NOT NULL` with `ON DELETE SET NULL` — a combination that makes the delete fail rather than
     * cascade. All four are removed first. See `hooks/cascadeDelete.ts`.
     *
     * The order among them does not matter, and an earlier version of this comment wrongly said it
     * did: each is a direct dependant of this product and each is removed by its own `where` clause.
     * Deleting the variants does cascade to bag lines of its own, but by then every bag line pointing
     * at the product has already gone, so that nested cascade finds nothing either way.
     *
     * `marksProductDeleted` records *which* product is going, so the variant hooks skip refreshing a
     * cache that is about to be deleted — without suppressing the refresh for any other product that
     * happens to share the request.
     *
     * Reached only by a permanent delete from the trash view; `trash: true` above means the ordinary
     * admin delete is an update.
     */
    beforeDelete: [
      cascadeDelete(
        [
          { collection: 'cart-items', on: 'product' },
          { collection: 'product-variants', on: 'product', includeTrashed: true },
          { collection: 'wishlist-items', on: 'product' },
          { collection: 'reviews', on: 'product' },
        ],
        { marksProductDeleted: true },
      ),
    ],
  },

  /**
   * A draft product is not a hidden product; through the API it does not exist. `publishedOnly`
   * hands an anonymous or customer request a `Where` instead of a refusal, so the product page 404s
   * rather than 403s — and, more importantly, so a draft cannot be listed, searched or added to a
   * bag by anyone who guesses an id. Plan §13.1d and §17.1a both re-check this server-side before a
   * line is priced or paid for; this is the layer that means they rarely have to.
   *
   * `trash: true` is on this collection, so the admin panel's delete is an update. The admin-only
   * `delete` below therefore governs *permanent* deletion — the one that cascades into variants.
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
                  'The purchasable rows. Price, SKU and stock live here — a product with no active variant cannot be bought, and cannot be published: the shop, search and the sitemap all leave it out, so publishing it would hide it rather than show it.',
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
                  validate: validateRequiredUpload,
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
                  'One word or phrase per entry — these become filters customers can tick, so reuse the tags already in use rather than inventing a near-duplicate ("linen", not "Linen fabric"). Capitals and stray spaces are corrected on save. Keep the vocabulary small: a filter with forty options is a filter nobody uses.',
              },
              hooks: { beforeValidate: [normaliseTags] },
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

      /**
       * **`admin.readOnly` is a disabled input, not a rule, and this group needed the rule.**
       *
       * Payload's `readOnly` governs the widget alone. The value stays in the edit form's state and
       * goes back with the save — `Form`'s submit body is `reduceFieldsToValues(fields, true)`,
       * which drops only fields marked `disableFormData` and has never heard of `readOnly` — and
       * the REST API never saw the flag at all.
       *
       * That turns the ordinary authoring sequence into silent data loss. Open a product, add its
       * sizes through the Variants drawer (each of which refreshes this group *in the database*),
       * then save the product: the form writes back the copy it read before the variants existed,
       * `priceFromMinor` returns to `null`, and `publishedProductWhere` removes the product from the
       * shop — for a save the editor thought was a no-op, with the variants sitting right there.
       *
       * Field access is the answer because of *how* it denies: it deletes the key from the incoming
       * data and falls back to the stored value, rather than failing the request
       * (`fields/hooks/beforeValidate/promise.js`). So a product save simply leaves this group
       * alone, which is what "derived" was always supposed to mean.
       *
       * `syncProductDerived` is unaffected. Field access is evaluated only when `overrideAccess` is
       * false, and its `payload.update` is a Local API call with the default `overrideAccess: true`
       * — the same door `Media.cloudinaryVersion` uses. This is not a *lock*: it is a statement
       * about who owns the column, and the owner is the variant table.
       */
      access: { create: nobodyField, update: nobodyField },

      admin: {
        position: 'sidebar',
        description:
          'Maintained automatically whenever a variant changes, and not editable here or through the API. The variants are the source of truth — if these disagree with them, the variants are right; saving any variant rebuilds this.',
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
