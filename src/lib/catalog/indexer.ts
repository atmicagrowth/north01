import type { Payload, PayloadRequest, Where } from 'payload'

import {
  buildProductRecord,
  withAncestors,
  type IndexableVariant,
  type ProductIndexRecord,
} from './record'

/**
 * **Postgres rows → index records.** The write half of the search integration.
 *
 * Plan §12.1b's resilience list, and where each item is answered:
 *
 * | §12.1b asks for | Here |
 * |---|---|
 * | Update the index when product data changes | `syncProductToIndex`, called from the collection hooks |
 * | Remove unpublished/deleted products | the same call — `buildProductRecord` returns `null` and the id is deleted |
 * | Reindex on structural changes | `collectProductRecords` + `replaceAllProducts`, via `pnpm reindex` |
 * | *"Do not make Algolia the only place a product change exists"* | nothing here writes to Postgres |
 * | A server-only manual reindex script | `scripts/reindex.ts` |
 * | Rebuild the full index from Postgres/Payload | the same script — a full rebuild is all it does, and it takes no flags |
 *
 * ### No `server-only`, for the reason `algolia.ts` gives
 *
 * This module is imported by a Payload collection hook, and collection hooks are loaded by the
 * `payload` CLI outside Next, where `server-only` cannot resolve. Credentials therefore arrive as
 * arguments and this file reads no environment at all.
 *
 * ### The unit of work is a product, never a variant
 *
 * A variant save changes the parent product's `sizes`, `colorFamilies` and `inStock` facets, so the
 * thing that has to be re-indexed is always the *product*. `syncProductDerived` already funnels
 * every variant write into a `payload.update` on its product, so the product's own `afterChange` is
 * the single place the index is kept in step — one path, not two that can disagree.
 */

/** How many products one `find` pulls while rebuilding. Bounded so a large catalogue cannot exhaust memory. */
const REBUILD_PAGE_SIZE = 200

/**
 * Variants are read in one query for the whole batch rather than one query per product.
 *
 * A `join` field would have populated them automatically, but at a fixed `defaultLimit` of 50 per
 * product and with no control over which columns come back. Four columns for a page of products is
 * one indexed query on `product`.
 */
const VARIANT_BATCH_LIMIT = 5000

type Credentials = {
  /** Already-created Algolia client. Kept opaque so this module never imports the SDK. */
  deleteRecord: (productId: number) => Promise<void>
  saveRecord: (record: ProductIndexRecord) => Promise<void>
}

/**
 * The parent-of map every category slug needs, so `withAncestors` can widen `hoodies` to
 * `hoodies, tops, clothing`.
 *
 * Read once per batch. There are tens of categories, not thousands — `Categories.ts` is explicit
 * that the taxonomy is a *shallow tree* and that a category which no filter uses should not exist.
 */
export async function readCategoryParents(
  payload: Payload,
  req?: PayloadRequest,
): Promise<{ names: Map<string, string>; parents: Map<string, null | string> }> {
  const { docs } = await payload.find({
    collection: 'categories',
    depth: 0,
    limit: 0,
    overrideAccess: true,
    pagination: false,
    req,
    select: { name: true, parent: true, slug: true },
  })

  const bySlug = new Map<number, string>()

  for (const doc of docs) {
    if (doc.slug) {
      bySlug.set(doc.id, doc.slug)
    }
  }

  const parents = new Map<string, null | string>()
  /*
   * Slug -> display name, built in the same pass.
   *
   * `withAncestors` widens a product's categories to their ancestor SLUGS, so turning that widened
   * set into the NAMES §12.1a wants searchable needs this second map. Without it the record would
   * carry `undefined` for every ancestor, `clean()` would silently drop them, and the phase would
   * ship a searchable attribute that matches nothing — a settings-shaped fake control.
   */
  const names = new Map<string, string>()

  for (const doc of docs) {
    if (!doc.slug) {
      continue
    }

    const parentId = typeof doc.parent === 'object' && doc.parent ? doc.parent.id : doc.parent

    parents.set(doc.slug, typeof parentId === 'number' ? (bySlug.get(parentId) ?? null) : null)

    if (doc.name?.trim()) {
      names.set(doc.slug, doc.name.trim())
    }
  }

  return { names, parents }
}

/**
 * Product id → the slugs of the collections it belongs to.
 *
 * The direction is forced by the schema and `Products.ts` explains why: membership is owned by the
 * collection, because *"an order is a property of the list, not of its members"*. So there is no
 * column on the product to read, and the only way to know is to read the lists.
 *
 * Reading *all* collections is correct rather than lazy. Structure §2 draws four of them and the
 * merchandising model is a handful of curated sets, so this is a single small query — where a
 * per-product `where: { products: { in: [id] } }` would be one query per product on a rebuild.
 */
export async function readCollectionMembership(
  payload: Payload,
  req?: PayloadRequest,
): Promise<{ membership: Map<number, string[]>; titles: Map<string, string> }> {
  const { docs } = await payload.find({
    collection: 'collections',
    depth: 0,
    limit: 0,
    overrideAccess: true,
    pagination: false,
    req,
    select: { products: true, slug: true, status: true, title: true },
  })

  const membership = new Map<number, string[]>()
  /** Slug -> title, so `searchTerms` can carry the words an editor named the set with. */
  const titles = new Map<string, string>()

  for (const doc of docs) {
    /*
     * A draft collection is not a filter a customer can use — `publishedOnly` hides it from the
     * facet vocabulary — so indexing membership of one would create a filter value that exists in
     * the index and nowhere in the UI.
     */
    if (doc.status !== 'published' || !doc.slug) {
      continue
    }

    if (doc.title?.trim()) {
      titles.set(doc.slug, doc.title.trim())
    }

    for (const entry of doc.products ?? []) {
      const productId = typeof entry === 'object' && entry ? entry.id : entry

      if (typeof productId !== 'number') {
        continue
      }

      membership.set(productId, [...(membership.get(productId) ?? []), doc.slug])
    }
  }

  return { membership, titles }
}

export type CollectedRecords = {
  /** Products that were read but do not belong in the index — drafts, scheduled, withdrawn. */
  excludedIds: number[]
  records: ProductIndexRecord[]
}

/**
 * Build index records for every product matching `where` (all of them, when omitted).
 *
 * Returns the excluded ids as well as the records, and that is the part that makes synchronisation
 * correct rather than merely eventually-correct. A product that has just been unpublished still
 * *matches* the query — it is only `buildProductRecord` that decides it does not belong — so the
 * caller needs to know it exists in order to delete it from the index. A version of this that
 * returned records alone would leave every unpublished product in the index for ever, which is plan
 * §12.1b's *"remove unpublished/deleted products from searchable results"* silently unimplemented.
 */
export async function collectProductRecords(
  payload: Payload,
  options: { req?: PayloadRequest; where?: Where } = {},
): Promise<CollectedRecords> {
  const { req, where } = options

  const [{ names: categoryNames, parents }, { membership, titles: collectionTitles }] =
    await Promise.all([readCategoryParents(payload, req), readCollectionMembership(payload, req)])

  const records: ProductIndexRecord[] = []
  const excludedIds: number[] = []
  const now = new Date()

  let page = 1
  let hasNextPage = true

  while (hasNextPage) {
    const result = await payload.find({
      collection: 'products',
      depth: 1,
      limit: REBUILD_PAGE_SIZE,
      overrideAccess: true,
      page,
      req,
      sort: 'id',
      where,
    })

    const ids = result.docs.map((doc) => doc.id)

    const variantsByProduct = new Map<number, IndexableVariant[]>()

    if (ids.length > 0) {
      const variants = await payload.find({
        collection: 'product-variants',
        depth: 0,
        limit: VARIANT_BATCH_LIMIT,
        overrideAccess: true,
        pagination: false,
        req,
        select: {
          active: true,
          color: true,
          colorFamily: true,
          inventoryQuantity: true,
          product: true,
          size: true,
        },
        where: { product: { in: ids } },
      })

      for (const variant of variants.docs) {
        const productId =
          typeof variant.product === 'object' && variant.product
            ? variant.product.id
            : variant.product

        if (typeof productId !== 'number') {
          continue
        }

        variantsByProduct.set(productId, [
          ...(variantsByProduct.get(productId) ?? []),
          {
            active: variant.active,
            color: variant.color,
            colorFamily: variant.colorFamily,
            inventoryQuantity: variant.inventoryQuantity,
            size: variant.size,
          },
        ])
      }
    }

    for (const doc of result.docs) {
      const categorySlugs = (doc.categories ?? [])
        .map((entry) => (typeof entry === 'object' && entry ? entry.slug : null))
        .filter((slug): slug is string => typeof slug === 'string')

      const widenedCategories = withAncestors(categorySlugs, parents)
      const collectionSlugs = membership.get(doc.id) ?? []

      const record = buildProductRecord(
        {
          /*
           * Names, not slugs, and they follow the WIDENED set — a hoodie filed only under `hoodies`
           * is searchable by "Tops" and "Clothing" too, which is the same subtree promise
           * `categorySlugs` already makes to the facet.
           */
          categoryNames: widenedCategories
            .map((slug) => categoryNames.get(slug))
            .filter((name): name is string => typeof name === 'string'),
          categorySlugs: widenedCategories,
          collectionSlugs,
          collectionTitles: collectionSlugs
            .map((slug) => collectionTitles.get(slug))
            .filter((title): title is string => typeof title === 'string'),
          derived: doc.derived ?? null,
          featured: doc.featured,
          fit: doc.fit,
          gender: doc.gender,
          id: doc.id,
          isBestSeller: doc.isBestSeller,
          isLimitedEdition: doc.isLimitedEdition,
          isNew: doc.isNew,
          materials: doc.materials,
          name: doc.name,
          publishedAt: doc.publishedAt,
          shortDescription: doc.shortDescription,
          slug: doc.slug,
          sortOrder: doc.sortOrder,
          status: doc.status,
          tags: doc.tags,
        },
        variantsByProduct.get(doc.id) ?? [],
        now,
      )

      if (record) {
        records.push(record)
      } else {
        excludedIds.push(doc.id)
      }
    }

    hasNextPage = result.hasNextPage === true
    page += 1
  }

  return { excludedIds, records }
}

/**
 * Bring the index into line for one product.
 *
 * Upsert when it belongs, delete when it does not — and the delete branch is the one that matters.
 * Unpublishing a product, deactivating its last variant or scheduling it into the future all produce
 * *the same* outcome here, without any of them needing their own hook.
 *
 * **It never throws.** The write it is reacting to has already committed by the time an `afterChange`
 * hook runs, so a failure here must not report failure for a change that happened — the identical
 * argument `revalidateTags.ts` makes, and the one `syncProductDerived` deliberately inverts because
 * *that* one runs inside the transaction and can lose the write itself. A search index is a derived
 * store; it is reconstructible with `pnpm reindex`, and the next save on the same product fixes it
 * anyway. The failure is logged with the product id so it is not merely swallowed.
 */
export async function syncProductToIndex(
  payload: Payload,
  credentials: Credentials,
  productId: number,
  req?: PayloadRequest,
): Promise<void> {
  try {
    const { excludedIds, records } = await collectProductRecords(payload, {
      req,
      where: { id: { equals: productId } },
    })

    if (records.length > 0) {
      await credentials.saveRecord(records[0] as ProductIndexRecord)

      return
    }

    /*
     * `excludedIds` empty means the product is gone entirely — deleted, or trashed, since
     * `payload.find` excludes soft-deleted rows. Either way the index must not keep it, so the
     * delete runs for both shapes.
     */
    void excludedIds
    await credentials.deleteRecord(productId)
  } catch (error) {
    payload.logger.warn(
      { err: error, productId },
      'Saved, but the search index was not updated. Filters may be briefly stale; `pnpm reindex` rebuilds it.',
    )
  }
}
