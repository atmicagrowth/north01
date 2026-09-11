import type { CollectionAfterChangeHook, Payload } from 'payload'
import type { PayloadRequest, Where } from 'payload'

import { catalogIndexName, createWriteClient, saveProductRecords } from '@/lib/catalog/algolia'
import { collectProductRecords } from '@/lib/catalog/indexer'

/**
 * **Plan §12.1b's "reindex on structural changes", closed.**
 *
 * A product's index record carries the **names** of its categories and the **titles** of its
 * collections, because §12.1a makes both searchable. So renaming a category is not a change to that
 * category — it is a change to every product filed beneath it, and none of those products is saved.
 * Without this hook a rename would become searchable only after each member happened to be edited
 * for some unrelated reason.
 *
 * ### It fires on a rename, not on every save
 *
 * A collection is saved whenever an editor reorders its products or edits its copy, and almost none
 * of those touch the index. The guard compares the previous document's slug and display name with
 * the new one and returns immediately when neither moved — so the expensive path runs on the rare
 * change that actually needs it.
 *
 * ### Two round trips, whatever the subtree size
 *
 * `collectProductRecords` already accepts a `where`, so the whole affected set is rebuilt in one
 * pass and written with one batched `saveProductRecords`. The obvious alternative — calling the
 * per-product sync in a loop — is one Algolia write per product, inside a request, and a category
 * near the root of the tree can hold the entire catalogue.
 *
 * It deliberately does **not** try to be complete. A slug change also rewrites `categorySlugs` for
 * every descendant category's products, which this covers, but there are structural edits it cannot
 * see — and `pnpm reindex:check` is the honest answer to those rather than an ever-growing set of
 * hooks. The index is derived; it is always reconstructible.
 *
 * The environment arrives through a dynamic import for the reason `syncSearchIndex.ts` documents at
 * length: a collection hook is loaded by the Payload CLI, outside Next. That import no longer fails
 * there — Phase 29's tsconfig stub made `server-only` resolve — which is why `reindexWhere` now refuses
 * CLI writes explicitly rather than relying on the import to fail.
 */

type Renameable = {
  id: number
  name?: null | string
  slug?: null | string
  title?: null | string
}

/** The display label, whichever field this collection calls it. */
const labelOf = (doc: Renameable): null | string => doc.name?.trim() ?? doc.title?.trim() ?? null

async function reindexWhere(payload: Payload, where: Where, req?: PayloadRequest): Promise<void> {
  /*
   * **A CLI write does not reach the index — the same guard `syncSearchIndex.ts` carries, and the one
   * this hook was missing.**
   *
   * Phase 29 made `server-only` resolvable under the Payload CLI (a tsconfig stub), which meant the
   * dynamic import below stopped failing there — and a harness renaming a fixture category started
   * writing that fixture's products to the index from the CLI. The product hook was guarded then; this
   * one was not. So the CLI could ADD a record and never REMOVE it: `verify:search` renames its
   * fixture taxonomy, the rename indexed its fixture product, and its cleanup's delete went through the
   * guarded product hook and did nothing. One orphaned "Verify Parka" per run — three by Phase 30,
   * found when `verify:catalog` saw the index return three products Postgres did not have.
   *
   * Symmetry is the point: every index write happens in the server or through `pnpm reindex`, so what
   * the CLI adds and what it deletes can never disagree.
   */
  if (!process.env.NEXT_RUNTIME) {
    payload.logger.debug(
      'Search index not updated — a CLI write does not sync. `pnpm reindex` rebuilds it.',
    )
    return
  }

  try {
    const { appEnv, integrationStatus, serverEnv } = await import('@/lib/env.server')

    if (integrationStatus('algolia') !== 'configured') {
      return
    }

    const { records } = await collectProductRecords(payload, { req, where })

    if (records.length === 0) {
      return
    }

    await saveProductRecords(
      createWriteClient({
        apiKey: serverEnv.ALGOLIA_WRITE_API_KEY as string,
        appId: serverEnv.NEXT_PUBLIC_ALGOLIA_APP_ID as string,
      }),
      catalogIndexName(appEnv),
      records,
    )

    payload.logger.info(`Re-indexed ${records.length} product(s) after a taxonomy rename.`)
  } catch (error) {
    /*
     * Warn and return. The write has already committed, so failing here would report failure for a
     * change that happened — the same argument `revalidateTags.ts` and `syncSearchIndex.ts` both
     * make. `pnpm reindex` is the documented recovery, and `pnpm reindex:check` finds the drift.
     */
    payload.logger.warn(
      { err: error },
      'Renamed, but the search index was not updated for the affected products. Run `pnpm reindex`.',
    )
  }
}

/**
 * A category and every category beneath it, by id.
 *
 * Breadth-first with a `seen` guard, for the reason `expandCategory` and `withAncestors` both carry
 * one: `Categories.ts` stops a category being its *own* parent and deliberately does not stop a
 * longer `A -> B -> A` cycle, which is reachable through two saves. Walking one without a guard
 * hangs the save rather than the render.
 */
async function descendantIds(req: PayloadRequest, rootId: number): Promise<number[]> {
  const { docs } = await req.payload.find({
    collection: 'categories',
    depth: 0,
    limit: 0,
    overrideAccess: true,
    pagination: false,
    req,
    select: { parent: true },
  })

  const children = new Map<number, number[]>()

  for (const doc of docs) {
    const parent = typeof doc.parent === 'object' && doc.parent ? doc.parent.id : doc.parent

    if (typeof parent === 'number') {
      children.set(parent, [...(children.get(parent) ?? []), doc.id])
    }
  }

  const seen = new Set<number>()
  const queue = [rootId]

  while (queue.length > 0) {
    const current = queue.shift() as number

    if (seen.has(current)) {
      continue
    }

    seen.add(current)
    queue.push(...(children.get(current) ?? []))
  }

  return [...seen]
}

/** For `categories.hooks.afterChange`. */
export const syncCategoryRename: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  const next = doc as Renameable
  const previous = previousDoc as Renameable | undefined

  if (previous && previous.slug === next.slug && labelOf(previous) === labelOf(next)) {
    return doc
  }

  /*
   * **Every product under this category or any descendant, at any depth.**
   *
   * `withAncestors` puts a category's name into the record of every product beneath it, so a rename
   * changes all of them. The subtree is resolved explicitly rather than with a `categories.parent`
   * clause, and the reason is worth stating because the sweep found it by accident: renaming
   * *Clothing* correctly updated a hoodie two levels below it — but only because the seed tags each
   * product with its **full ancestor path** (`[hoodies, tops, clothing]`), so the direct clause
   * matched. A product tagged with only its leaf category would have been missed, and nothing in the
   * schema requires the seed's convention.
   *
   * One extra read of a collection `Categories.ts` describes as a *shallow tree* buys a claim that
   * does not depend on how somebody happened to tag a product.
   */
  await reindexWhere(req.payload, { categories: { in: await descendantIds(req, next.id) } }, req)

  return doc
}

/**
 * For `collections.hooks.afterChange`.
 *
 * Membership changes are already handled by `syncSearchIndexForCollection`, which re-syncs the
 * products that joined or left. This one covers the *other* edit: the set keeping its members and
 * changing its title, which changes every member's `searchTerms` and fires no product hook at all.
 */
export const syncCollectionRename: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
}) => {
  const next = doc as Renameable
  const previous = previousDoc as Renameable | undefined

  if (!previous || (previous.slug === next.slug && labelOf(previous) === labelOf(next))) {
    return doc
  }

  const ids = ((doc as { products?: unknown[] }).products ?? [])
    .map((entry) => (typeof entry === 'object' && entry ? (entry as { id: number }).id : entry))
    .filter((id): id is number => typeof id === 'number')

  if (ids.length > 0) {
    await reindexWhere(req.payload, { id: { in: ids } }, req)
  }

  return doc
}
