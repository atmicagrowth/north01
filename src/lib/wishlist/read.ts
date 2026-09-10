import type { Payload } from 'payload'

import type { CatalogSettings } from '@/lib/catalog/catalog'
import type { ProductCard } from '@/lib/catalog/resolve'

import { publishedProductWhere } from '@/lib/catalog/query'
import { resolveProductCards } from '@/lib/catalog/resolve'
import { planWishlistMerge, type WishlistMergePlan } from './rules'

/**
 * **The wishlist against the database** — plan §20.1a and §20.1b.
 *
 * **No `server-only` guard**, and by now that is a rule rather than a choice: every function here
 * takes a `Payload` instance and its settings as arguments instead of reaching for them, so
 * `pnpm verify:account` can drive the merge and the ownership boundary against a real database. The
 * guarded tier is `wishlist.ts` next door, which is what the pages and actions import.
 *
 * ---
 *
 * ### Ownership is enforced by the read, not checked after it
 *
 * Every query here is scoped by `customer` id. That is belt as well as braces: `WishlistItems`
 * already carries `read/update/delete: ownedByCustomer('customer')`, and `enforceCustomerOwnership`
 * *forces* the customer id on create — so even a call that got the scoping wrong could not reach
 * another account's rows through the access layer.
 *
 * The reason to scope anyway is that these run with `overrideAccess: true`. Phase 7 recorded why
 * ownership rules return a `Where` rather than `false` — a cross-account read comes back **empty**
 * rather than **forbidden**, which confirms nothing about whether the row exists — and a service that
 * bypassed access control would lose that property silently. Passing the id explicitly keeps the
 * boundary visible in the code that would violate it.
 *
 * ### A saved product that has since been withdrawn is dropped, not hidden
 *
 * The phase prompt: *"remove invalid/deleted products gracefully."* Every read runs the same
 * `publishedProductWhere` the shop's own grids use, so an unpublished, scheduled or deleted product
 * simply is not in the result. The row stays in the database — deleting somebody's saved item because
 * a merchandiser unpublished a product for an afternoon would be worse — and reappears if the product
 * does.
 */

const STOREFRONT_ACCESS = { overrideAccess: false, user: null } as const

/** The product ids on an account's list, most recently saved first. */
export async function readWishlistProductIds(
  payload: Payload,
  customerId: number,
): Promise<number[]> {
  const { docs } = await payload.find({
    collection: 'wishlist-items',
    depth: 0,
    limit: 200,
    overrideAccess: true,
    sort: '-createdAt',
    where: { customer: { equals: customerId } },
  })

  return docs
    .map((row) => (typeof row.product === 'number' ? row.product : (row.product?.id ?? null)))
    .filter((id): id is number => typeof id === 'number')
}

/**
 * The account's list, resolved to renderable cards.
 *
 * Two reads rather than one join: the rows say what is saved, and the catalogue says what may be
 * shown. Keeping them separate is what makes *"validate before rendering"* the same code path the
 * shop grid uses, rather than a second opinion that could drift from it.
 */
export async function readWishlist(
  payload: Payload,
  customerId: number,
  settings: CatalogSettings,
  now: string,
): Promise<{ cards: ProductCard[]; savedIds: number[] }> {
  const savedIds = await readWishlistProductIds(payload, customerId)

  if (savedIds.length === 0) {
    return { cards: [], savedIds }
  }

  const { docs } = await payload.find({
    collection: 'products',
    depth: 1,
    // Neither join field is read — see `PRODUCT_CARD_POPULATE` in `lib/catalog/resolve.ts`.
    joins: false,
    limit: savedIds.length,
    ...STOREFRONT_ACCESS,
    where: { and: [...publishedProductWhere(now), { id: { in: savedIds } }] },
  })

  const resolved = resolveProductCards(
    docs,
    settings.currency,
    settings.locale,
    settings.lowStockThreshold,
  )

  /* Saved order, not database order — the list is the customer's, so it reads in their order. */
  const byId = new Map(resolved.map((card) => [card.id, card]))

  return {
    cards: savedIds
      .map((id) => byId.get(id))
      .filter((card): card is ProductCard => card !== undefined),
    savedIds,
  }
}

/**
 * Save one product.
 *
 * Idempotent by the database rather than by a check: `(customer, product)` is uniquely indexed with
 * both columns required, so the second save of the same product is refused by Postgres. That is the
 * same mechanism as Phase 19's `dedupeKey` and Phase 17's event id, and it is here for the same
 * reason — a read-then-write has a window, and two taps on a phone are exactly the concurrency this
 * would meet in the wild.
 */
export async function saveToWishlist(
  payload: Payload,
  customerId: number,
  productId: number,
): Promise<'added' | 'alreadySaved' | 'unavailable'> {
  const published = await isPublishedProduct(payload, productId)

  if (!published) {
    return 'unavailable'
  }

  try {
    await payload.create({
      collection: 'wishlist-items',
      data: { customer: customerId, product: productId },
      overrideAccess: true,
    })

    return 'added'
  } catch (error) {
    /*
     * A unique violation is the ordinary outcome of a double-tap, not a fault. Anything else is
     * rethrown, because a wishlist that silently swallows a database error is a wishlist that
     * silently does not save.
     */
    if (isDuplicate(error)) {
      return 'alreadySaved'
    }

    throw error
  }
}

/**
 * Remove one product from one account's list.
 *
 * Scoped by customer as well as product, so the delete is unable to reach another account's row even
 * though it runs with `overrideAccess`. A miss is not an error: removing something already removed is
 * what a second tap means.
 */
export async function removeFromWishlist(
  payload: Payload,
  customerId: number,
  productId: number,
): Promise<'notSaved' | 'removed'> {
  const { docs } = await payload.find({
    collection: 'wishlist-items',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { and: [{ customer: { equals: customerId } }, { product: { equals: productId } }] },
  })

  const row = docs[0]

  if (!row) {
    return 'notSaved'
  }

  await payload.delete({ collection: 'wishlist-items', id: row.id, overrideAccess: true })

  return 'removed'
}

/**
 * **§20.1b's merge**, applied.
 *
 * The decision is `planWishlistMerge`, which is pure and tested on its own. This is the part that
 * needs a database: finding out which of the guest's ids still name a published product, and writing
 * the ones the account does not already have.
 *
 * Inserts run oldest-first so the merged list reads in the order the guest built it — the plan's
 * *"preserve order where useful"*, which is the only sense in which order is useful for a list with
 * no quantities.
 */
export async function mergeGuestWishlist(
  payload: Payload,
  customerId: number,
  guest: readonly number[],
  now: string,
): Promise<WishlistMergePlan & { added: number }> {
  if (guest.length === 0) {
    return { added: 0, alreadySaved: [], invalid: [], toAdd: [] }
  }

  const [existing, valid] = await Promise.all([
    readWishlistProductIds(payload, customerId),
    publishedSubset(payload, guest, now),
  ])

  const plan = planWishlistMerge({ existing, guest, valid })

  let added = 0

  for (const productId of plan.toAdd) {
    try {
      await payload.create({
        collection: 'wishlist-items',
        data: { customer: customerId, product: productId },
        overrideAccess: true,
      })

      added += 1
    } catch (error) {
      /*
       * The constraint is the guarantee; the plan is only the explanation. A row that appeared
       * between the read and the write — a second tab merging the same list — lands here and is
       * counted as already saved rather than failing the merge.
       */
      if (!isDuplicate(error)) {
        throw error
      }
    }
  }

  return { ...plan, added }
}

async function isPublishedProduct(payload: Payload, productId: number): Promise<boolean> {
  const { docs } = await payload.find({
    collection: 'products',
    depth: 0,
    limit: 1,
    ...STOREFRONT_ACCESS,
    where: {
      and: [...publishedProductWhere(new Date().toISOString()), { id: { equals: productId } }],
    },
  })

  return docs.length > 0
}

async function publishedSubset(
  payload: Payload,
  ids: readonly number[],
  now: string,
): Promise<number[]> {
  const { docs } = await payload.find({
    collection: 'products',
    depth: 0,
    limit: ids.length,
    ...STOREFRONT_ACCESS,
    where: { and: [...publishedProductWhere(now), { id: { in: [...ids] } }] },
  })

  return docs.map((doc) => doc.id)
}

/**
 * The two shapes a refused duplicate arrives in — the same pair Phase 19's `isDuplicateKey` handles,
 * and for the same reason. Payload validates uniqueness before inserting, so a sequential duplicate
 * comes back as a `ValidationError`; that pre-check is a read-then-write and cannot see an
 * uncommitted row, so a genuine race is refused by Postgres with SQLSTATE 23505 instead.
 */
function isDuplicate(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  if (/duplicate key value|23505/i.test(error.message)) {
    return true
  }

  const data = (error as { data?: { errors?: { path?: string }[] } }).data

  return error.name === 'ValidationError' && Array.isArray(data?.errors)
}
