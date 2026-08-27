import type { CollectionBeforeDeleteHook, CollectionSlug } from 'payload'

/**
 * Removes the rows that cannot exist without the row being deleted.
 *
 * **This is not tidiness. Without it the delete fails.** Payload compiles a single, non-polymorphic
 * `relationship` to a real foreign key with `ON DELETE SET NULL` — there is no configuration option
 * for anything else (`docs/DATABASE.md` §8, proved in Phase 5). A `required` relationship is also
 * `NOT NULL`, verified in this phase's migration:
 *
 * ```sql
 * "variant_id" integer NOT NULL,
 * ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk"
 *   FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null
 * ```
 *
 * The two together are a contradiction that only appears at delete time: Postgres tries to null a
 * column that may not be null, and raises `null value in column "variant_id" violates not-null
 * constraint`. The *parent* delete fails. So every required back-reference in this schema needs its
 * children removed first — which is what the corpus wants anyway. Plan §14.1e's *"product becomes
 * unavailable"* and plan §20.1b's *"invalid/deleted products removed"* both describe a bag and a
 * wishlist that shed what no longer exists.
 *
 * **`beforeDelete`, not `afterDelete`.** The violation happens *during* the parent's delete
 * statement, so a cleanup that runs afterwards never runs at all — the transaction has already
 * rolled back. This was the first version of these hooks and it was wrong.
 *
 * **What is deliberately not cascaded.** A *nullable* reference is left to `ON DELETE SET NULL`,
 * because nulling it is the correct outcome and every consumer already treats "resolves to nothing"
 * as an ordinary state. That is why deleting a customer does not delete their orders — `orders.customer`
 * is nullable and the order keeps its own email and address snapshots — and why deleting a product
 * does not empty an editorial page, only the reference inside it.
 *
 * **Hard deletes are rare by design.** `products`, `product-variants`, `customers` and `orders` all
 * carry `trash: true`, so the admin panel's ordinary "delete" is an *update* that sets `deletedAt`
 * and never reaches this hook. What reaches it is a deliberate permanent delete from the trash view,
 * where cascading is what the person meant.
 */
type Dependent = {
  collection: CollectionSlug
  /** The required relationship field on the dependent collection that points back at the parent. */
  on: string
  /** Include already-trashed rows, for dependents that are themselves soft-deleted. */
  includeTrashed?: boolean
}

export const cascadeDelete =
  (dependents: Dependent[]): CollectionBeforeDeleteHook =>
  async ({ id, req }) => {
    for (const { collection, on, includeTrashed } of dependents) {
      try {
        await req.payload.delete({
          collection,
          where: { [on]: { equals: id } },
          depth: 0,
          ...(includeTrashed ? { trash: true } : {}),
          /**
           * Suppresses the derived-price refresh that a variant delete would otherwise trigger
           * against a product that is itself mid-delete. The work would be wasted at best and, on a
           * cascade from `products`, is a write to a row about to disappear.
           */
          context: { skipDerivedSync: true },
          req,
        })
      } catch (error) {
        /**
         * Rethrown, unlike the bookkeeping hooks elsewhere in this schema. A failure here is not a
         * stale cache — it means the dependent rows are still there and the parent delete is about
         * to fail on a foreign key anyway. Failing now names the real cause; failing later names a
         * constraint.
         */
        req.payload.logger.error({
          err: error,
          msg: `Could not remove dependent ${collection} rows (${on} = ${String(id)}) before deleting the parent.`,
        })

        throw error
      }
    }
  }
