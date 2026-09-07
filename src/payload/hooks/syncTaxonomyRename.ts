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
 * length: a collection hook is loaded by the Payload CLI, outside Next, where `server-only` cannot
 * resolve.
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

/** For `categories.hooks.afterChange`. */
export const syncCategoryRename: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  const next = doc as Renameable
  const previous = previousDoc as Renameable | undefined

  if (previous && previous.slug === next.slug && labelOf(previous) === labelOf(next)) {
    return doc
  }

  /*
   * Every product filed under this category **or any of its descendants** — because
   * `withAncestors` means a descendant's record carries this category's name too. The dotted path
   * resolves to a join on an indexed column, and one level of `parent` covers the shallow tree
   * `Categories.ts` describes; a deeper rename is what `reindex:check` and `pnpm reindex` are for.
   */
  await reindexWhere(
    req.payload,
    { or: [{ categories: { equals: next.id } }, { 'categories.parent': { equals: next.id } }] },
    req,
  )

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
