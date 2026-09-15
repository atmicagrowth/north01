import { sql } from '@payloadcms/db-postgres'
import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  Payload,
  PayloadRequest,
} from 'payload'
import { createLocalReq } from 'payload'

import { transactionOf } from './lockRowsForWrite'
import { revalidateCollection } from './revalidateTags'
import { syncSearchIndexAfterChange } from './syncSearchIndex'

/**
 * Keeps `products.derived` in step with the variants beneath it.
 *
 * The reasoning for the cache existing at all is in `Products.ts`; this file is the mechanism, and
 * it has five properties worth stating because each one is a bug that was designed out rather than
 * discovered:
 *
 * 1. **It recomputes rather than adjusts.** The hook does not add the new price to a running minimum
 *    — it re-reads every active variant and rebuilds all four values. An incremental update has to
 *    be right about the *previous* state as well as the new one, and a single missed path (a
 *    variant deactivated, a variant restored from the trash, a bulk edit) leaves a cache that is
 *    subtly wrong forever with nothing to notice it. A full recompute is idempotent, so running it
 *    twice, or running it after a failure, produces the same answer.
 *
 * 2. **It runs inside the caller's transaction.** `req` carries the transaction ID that the Postgres
 *    adapter uses to route the query. Passing it means a variant save and the product update it
 *    causes commit or roll back together; omitting it would open a second connection that cannot see
 *    the uncommitted variant, and would happily cache the state from *before* the save. The one
 *    caller that omits it on purpose is `refreshDerivedStock` in `lib/checkout/fulfil.ts` (sweep 1,
 *    S01), which runs after the payment transaction has **committed** its raw-SQL stock decrement, so
 *    there is nothing uncommitted left to miss.
 *
 * 3. **It writes the four `derived` columns and nothing else** — the concurrency review of
 *    2026-09-15. It used to write through `payload.update('products')`, and a Payload update rewrites
 *    *every* column of the row from the operation's own read. So a refresh after a sale whose read
 *    preceded an editor's unpublish or move to the trash, and whose write followed it, put back
 *    `status: published` and `deletedAt: null` — re-publishing or un-trashing a product somebody had
 *    just withdrawn, from a background job nobody was watching. The write is now one raw `UPDATE` of
 *    those four columns and `updated_at` (on the caller's transaction when there is one), so it cannot
 *    carry any other column, stale or not. `pnpm verify:concurrency` section D holds the race open.
 *
 *    It also no longer runs the product's validation and hooks to store a cache: a product that a later
 *    rule would refuse, or one in the trash, still gets its figure refreshed, where before the refresh
 *    failed — and inside a variant save, took the save down with it.
 *
 * 4. **It does what the product's `afterChange` hooks did, explicitly.** Those were the reason a
 *    variant change reached the search index and the storefront caches: `syncSearchIndexAfterChange`
 *    and `revalidateCollection('catalog', 'home')`. Both are called here after the write, with the
 *    product's id and the request. Without a caller's transaction the `UPDATE` has already committed,
 *    so **no row lock is held across the Algolia call** — the Payload update this replaced held the
 *    product row for the length of that network round trip. Inside a variant save it runs in that
 *    save's transaction, exactly as the hooks did: that transaction holds the variant and product rows
 *    until the save commits, and the index read has to see the uncommitted variant. (The index half is
 *    skipped outside Next — `NEXT_RUNTIME` — as for every CLI write; `pnpm reindex` rebuilds it.)
 *
 * 5. **It rethrows, and the first version of it did not.** The intent was that a variant save which
 *    succeeded should not be reported as failed because a cache refresh did not — the variants are
 *    the source of truth and the cache is reconstructible. That reasoning is sound and the mechanism
 *    made it false: inside a transaction a failed statement aborts the transaction, and the caller's
 *    Payload operation then ends `catch (error) { await killTransaction(req); throw }`. Swallowing the
 *    error here would report success for a save that did not happen — silent data loss, which is
 *    strictly worse than a failed request. The error is logged for the product ID and then rethrown.
 *
 * **What counts as active.** `active === true` and not in the trash. Payload's `find` already
 * excludes trashed documents unless asked, so soft-deleting a variant removes it from the aggregate
 * exactly as deactivating it does — which is the intent in both cases.
 */

type Derived = {
  priceFromMinor: number | null
  priceToMinor: number | null
  compareAtFromMinor: number | null
  inventoryTotal: number
}

/** A product with no active variants has no price and nothing to sell. Both states are true. */
const DERIVED_EMPTY: Derived = {
  priceFromMinor: null,
  priceToMinor: null,
  compareAtFromMinor: null,
  inventoryTotal: 0,
}

type VariantRow = {
  priceMinor?: number | null
  compareAtPriceMinor?: number | null
  inventoryQuantity?: number | null
}

/** What `Products.hooks.afterChange` runs; see point 4 above. */
const revalidateProductCaches = revalidateCollection('catalog', 'home')

export const recalculateProductDerived = async ({
  payload,
  productId,
  req,
}: {
  payload: Payload
  productId: number | string
  req?: PayloadRequest
}): Promise<void> => {
  try {
    const { docs } = await payload.find({
      collection: 'product-variants',
      where: {
        and: [{ product: { equals: productId } }, { active: { equals: true } }],
      },
      /**
       * Every active variant, not a page of them. A product with more than a few dozen variants is
       * a data-entry mistake rather than a merchandising decision, and the aggregate has to see all
       * of them to be an aggregate. `depth: 0` keeps the relationships as IDs — this query needs
       * three numbers per row and nothing else.
       */
      limit: 0,
      depth: 0,
      pagination: false,
      req,
    })

    const rows = (docs as VariantRow[]).filter(
      (row): row is VariantRow & { priceMinor: number } => typeof row.priceMinor === 'number',
    )

    let derived: Derived = { ...DERIVED_EMPTY }

    if (rows.length > 0) {
      /**
       * `cheapest` rather than `min(compareAtPrice)`: the compare-at that renders on a card is the
       * one belonging to the variant whose price is being shown, not the largest saving anywhere in
       * the product. Showing "£240 was £400" when the £240 variant was never £400 is a false price
       * claim, which plan §24.1b forbids in structured data and which is worse than useless on the
       * card itself.
       */
      let cheapest = rows[0]
      let highest = rows[0].priceMinor

      for (const row of rows) {
        if (row.priceMinor < cheapest.priceMinor) {
          cheapest = row
        }

        if (row.priceMinor > highest) {
          highest = row.priceMinor
        }
      }

      derived = {
        priceFromMinor: cheapest.priceMinor,
        priceToMinor: highest,
        compareAtFromMinor: cheapest.compareAtPriceMinor ?? null,
        inventoryTotal: rows.reduce((total, row) => total + (row.inventoryQuantity ?? 0), 0),
      }
    }

    /*
     * The caller's transaction when it has one (point 2), otherwise a pool connection, where the
     * statement commits on its own and releases the row at once (point 4). `updated_at` moves as it
     * did under `payload.update`, because the sitemap's `lastModified` and the admin list's order read
     * it and a sold-out size is a change to the product page. Zero rows means the product is gone — a
     * permanent delete — and there is nothing to index or revalidate.
     */
    const connection =
      (await transactionOf(req, payload)) ??
      (payload.db.drizzle as unknown as NonNullable<Awaited<ReturnType<typeof transactionOf>>>)

    const written = await connection.execute(
      sql`UPDATE "products"
          SET "derived_price_from_minor" = ${derived.priceFromMinor},
              "derived_price_to_minor" = ${derived.priceToMinor},
              "derived_compare_at_from_minor" = ${derived.compareAtFromMinor},
              "derived_inventory_total" = ${derived.inventoryTotal},
              "updated_at" = now()
          WHERE "id" = ${Number(productId)}`,
    )

    if ((written.rowCount ?? 0) === 0) {
      return
    }

    /**
     * The hooks read `req.payload` and the logger from the request, and a caller may pass the bare
     * `{ transactionID }` the checkout code builds, so the request is completed the way every Local
     * API call completes it — `payload.find` above already did this to the same object.
     *
     * **No `context` flag on this request, deliberately.** `createLocalReq` does not build an isolated
     * request, it *mutates* the one it is given — `req.context = { ...req.context, ...context }` on
     * the same object, verified by running it — and a bulk variant edit shares one request across
     * every matched row. A flag set here would latch for the rest of the operation. Nothing needs
     * suppressing anyway: neither hook below writes to Postgres, so there is no cycle to break.
     */
    const hookReq = await createLocalReq(req ? { req } : {}, payload)
    const hookArgs = {
      collection: payload.collections.products.config,
      context: hookReq.context,
      data: { derived },
      doc: { derived, id: Number(productId) },
      operation: 'update',
      previousDoc: { id: Number(productId) },
      req: hookReq,
    } as unknown as Parameters<CollectionAfterChangeHook>[0]

    await syncSearchIndexAfterChange(hookArgs)
    await revalidateProductCaches(hookArgs)
  } catch (error) {
    /*
     * The second sentence is true only inside a transaction. Called without one (after a payment has
     * committed — see point 2) nothing was rolled back, and saying otherwise would send whoever reads
     * the log looking for a payment that did in fact happen.
     */
    payload.logger.error({
      err: error,
      msg: req?.transactionID
        ? `Could not refresh derived price/stock for product ${String(productId)}. The enclosing transaction is rolled back with it, so the write that triggered this did not happen either.`
        : `Could not refresh derived price/stock for product ${String(productId)}. Nothing was rolled back; the cached figure stays as it was until the product or one of its variants is next saved.`,
    })

    throw error
  }
}

/**
 * A variant's `product` may arrive as an ID or as a populated document depending on the operation's
 * depth, and on an update it may have *moved* — so both the new parent and the old one need
 * refreshing, or the product it left keeps a price that is no longer its own.
 */
const relationshipId = (value: unknown): number | string | undefined => {
  if (typeof value === 'number' || typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object' && 'id' in value) {
    const { id } = value as { id?: unknown }
    return typeof id === 'number' || typeof id === 'string' ? id : undefined
  }

  return undefined
}

/**
 * The key `Products.beforeDelete` sets while cascading, holding the id of the product being deleted.
 *
 * It is an **id rather than a boolean** because of the same `createLocalReq` mutation: whatever is
 * put on `context` stays on the shared request for the rest of the operation, so a boolean set while
 * deleting product 7 would go on to suppress the recompute for an unrelated product 9 later in the
 * same bulk delete. Comparing against the id makes the suppression say what it means — *skip the
 * refresh for the row that is disappearing* — and leaves every other product's refresh intact.
 */
export const DELETING_PRODUCT = 'deletingProductId'

export const syncProductDerivedAfterChange: CollectionAfterChangeHook = async ({
  context,
  doc,
  previousDoc,
  req,
}) => {
  const ids = new Set<number | string>()
  const current = relationshipId((doc as { product?: unknown }).product)
  const previous = relationshipId((previousDoc as { product?: unknown } | undefined)?.product)

  if (current !== undefined) {
    ids.add(current)
  }

  if (previous !== undefined) {
    ids.add(previous)
  }

  for (const id of ids) {
    // Same rule as the delete hook: a product that is itself being removed needs no refresh. This
    // path is reached when a cascade trashes a variant on the way to deleting its product.
    if (String(context?.[DELETING_PRODUCT] ?? '') === String(id)) {
      continue
    }

    await recalculateProductDerived({ payload: req.payload, productId: id, req })
  }

  return doc
}

export const syncProductDerivedAfterDelete: CollectionAfterDeleteHook = async ({
  context,
  doc,
  req,
}) => {
  const id = relationshipId((doc as { product?: unknown }).product)

  if (id === undefined) {
    return doc
  }

  // The product this variant belonged to is itself being deleted; refreshing a row that is about to
  // disappear is wasted work, and on a cascade it is a write to a row inside its own delete.
  if (String(context?.[DELETING_PRODUCT] ?? '') === String(id)) {
    return doc
  }

  await recalculateProductDerived({ payload: req.payload, productId: id, req })

  return doc
}
