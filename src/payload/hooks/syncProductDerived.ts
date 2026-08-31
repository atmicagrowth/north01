import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  Payload,
  PayloadRequest,
} from 'payload'

/**
 * Keeps `products.derived` in step with the variants beneath it.
 *
 * The reasoning for the cache existing at all is in `Products.ts`; this file is the mechanism, and
 * it has four properties worth stating because each one is a bug that was designed out rather than
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
 *    the uncommitted variant, and would happily cache the state from *before* the save.
 *
 * 3. **It cannot recurse, and it must not try to prove that with a `context` flag.** Updating a
 *    product fires the *product's* hooks, and products have no `afterChange` — so there is no cycle.
 *    A defensive flag would be worse than useless: Payload's `createLocalReq` mutates the request it
 *    is handed rather than cloning it, so any `context` passed to a nested call is latched onto the
 *    caller's request permanently. See the note at the `payload.update` below.
 *
 * 4. **It rethrows, and the first version of it did not.** The intent was that a variant save which
 *    succeeded should not be reported as failed because a cache refresh did not — the variants are
 *    the source of truth and the cache is reconstructible. That reasoning is sound and the mechanism
 *    made it false: every Payload operation ends `catch (error) { await killTransaction(req); throw }`,
 *    and `killTransaction` rolls the *caller's* transaction back and deletes `req.transactionID`. By
 *    the time this catch block runs the variant's own write is already gone, so swallowing the error
 *    reported success for a save that did not happen — silent data loss, which is strictly worse than
 *    a failed request. The error is logged for the product ID and then rethrown.
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

    /**
     * **No `context` flag here, deliberately.** Passing one would be the obvious defensive move and
     * it is the bug: `createLocalReq` does not build an isolated request, it *mutates* the one it is
     * given — `req.context = { ...req.context, ...context }` on the same object, verified by running
     * it. A flag set here would therefore latch onto the caller's request for the rest of the
     * operation, and a bulk variant edit shares one request across every matched row: the first
     * variant would refresh its product and every later one would skip.
     *
     * Nothing needs suppressing anyway. Updating a product fires the *product's* hooks, and neither
     * of them writes: Phase 11 added `afterChange` to `products`, and it does two things — push a
     * record to Algolia and expire a cache tag. Neither touches Postgres, so there is still no cycle
     * to break.
     *
     * (This paragraph said products had *no* `afterChange` until Phase 11 gave them one. The
     * conclusion held; the premise did not, and a docblock nothing executes is exactly the artefact
     * Phase 10's audit found wrong nine times.)
     */
    await payload.update({
      collection: 'products',
      id: productId,
      data: { derived },
      depth: 0,
      req,
    })
  } catch (error) {
    payload.logger.error({
      err: error,
      msg: `Could not refresh derived price/stock for product ${String(productId)}. Payload has already rolled the enclosing transaction back, so the write that triggered this did not happen either.`,
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
