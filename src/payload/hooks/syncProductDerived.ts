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
 * 3. **It cannot recurse.** Updating a product fires the product's own hooks, not the variant's, and
 *    products have no hook that writes variants. The `context` flag is still set, because it costs
 *    nothing and the day someone adds a product hook that touches variants is the day this matters.
 *
 * 4. **It never fails the write that triggered it.** A variant save that succeeded must not be
 *    reported as failed because a cache refresh did not — the variants are the source of truth and
 *    the cache is reconstructible. The error is logged with the product ID so it can be rebuilt.
 *    (`payload.logger` rather than `console`, which this project's ESLint config restricts.)
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

    await payload.update({
      collection: 'products',
      id: productId,
      data: { derived },
      depth: 0,
      context: { skipDerivedSync: true },
      req,
    })
  } catch (error) {
    payload.logger.error({
      err: error,
      msg: `Could not refresh derived price/stock for product ${String(productId)}. The variants are unaffected and remain authoritative; re-save any variant to rebuild.`,
    })
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

export const syncProductDerivedAfterChange: CollectionAfterChangeHook = async ({
  context,
  doc,
  previousDoc,
  req,
}) => {
  if (context?.skipDerivedSync) {
    return doc
  }

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
    await recalculateProductDerived({ payload: req.payload, productId: id, req })
  }

  return doc
}

export const syncProductDerivedAfterDelete: CollectionAfterDeleteHook = async ({
  context,
  doc,
  req,
}) => {
  /**
   * Set by `cascadeDelete` when the product itself is being deleted. Refreshing the cache of a row
   * that is about to disappear is wasted work at best.
   */
  if (context?.skipDerivedSync) {
    return doc
  }

  const id = relationshipId((doc as { product?: unknown }).product)

  if (id !== undefined) {
    await recalculateProductDerived({ payload: req.payload, productId: id, req })
  }

  return doc
}
