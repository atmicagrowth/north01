import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, Payload } from 'payload'
import type { PayloadRequest } from 'payload'

import {
  catalogIndexName,
  createWriteClient,
  deleteProductRecord,
  saveProductRecord,
} from '@/lib/catalog/algolia'
import { syncProductToIndex } from '@/lib/catalog/indexer'
import type { ProductIndexRecord } from '@/lib/catalog/record'

/**
 * **The line between "a merchandiser saved a product" and "a filter finds it."**
 *
 * `lib/catalog/indexer.ts` decides *what* the index should contain; this file decides *when*, and it
 * is the only place on a write path that reaches for the Algolia credentials.
 *
 * ### Why the environment arrives through a dynamic import
 *
 * The identical mechanism, and the identical reason, as `revalidateTags.ts`.
 *
 * A collection hook is part of `payload.config.ts`, which the `payload` CLI loads through tsx —
 * outside Next, where the bare specifier `server-only` does not resolve. A static
 * `import { serverEnv } from '@/lib/env.server'` at the top of this file would break every
 * migration, the seed and all five verification harnesses, none of which need a search index.
 *
 * So the import is dynamic and inside a `try`. Under Next it resolves and the credentials are the
 * guarded ones; under the CLI it throws, the `catch` logs at debug, and the write proceeds without
 * touching the index. That asymmetry is deliberate and is why `pnpm reindex` exists: a CLI write — a
 * seed, a backfill, a bulk script — leaves the index untouched, and the rebuild is how it catches up.
 *
 * **It can use neither the guarded module statically nor the unguarded one at all.** `env.server` is
 * unavailable under the CLI, and `env.core` is banned by `eslint.config.mjs` outside four named
 * files, because a client component importing it builds cleanly and ships a secret in prerendered
 * HTML. A dynamic import of the guarded module satisfies both: it is the guarded module, and it is
 * on no static import graph a bundler can follow into a browser.
 *
 * ### A missing integration is silence, not a warning
 *
 * `integrationStatus('algolia') !== 'configured'` returns immediately. This project ships with no
 * Algolia credentials in `.env.example`, and the storefront must run without them — plan §A.5:
 * *"Algolia unavailable → display a controlled search-unavailable state; catalog remains usable
 * through curated category navigation."* Warning on every product save in that state would train an
 * operator to ignore the channel; `reportEnvironment` says it once at startup, which is the right
 * place for it.
 */

type IndexWriter = {
  deleteRecord: (productId: number) => Promise<void>
  saveRecord: (record: ProductIndexRecord) => Promise<void>
}

/**
 * Resolve credentials into the two closures `indexer.ts` needs, or `null` when there are none.
 *
 * Closures rather than a client, so that `indexer.ts` never imports the Algolia SDK and stays a pure
 * translation of Postgres rows into records.
 */
async function resolveIndexWriter(): Promise<IndexWriter | null> {
  const { appEnv, integrationStatus, serverEnv } = await import('@/lib/env.server')

  if (integrationStatus('algolia') !== 'configured') {
    return null
  }

  const client = createWriteClient({
    apiKey: serverEnv.ALGOLIA_WRITE_API_KEY as string,
    appId: serverEnv.NEXT_PUBLIC_ALGOLIA_APP_ID as string,
  })

  const indexBase = catalogIndexName(appEnv)

  return {
    deleteRecord: (productId) => deleteProductRecord(client, indexBase, productId),
    saveRecord: (record) => saveProductRecord(client, indexBase, record),
  }
}

async function sync(payload: Payload, productId: number, req?: PayloadRequest): Promise<void> {
  try {
    const writer = await resolveIndexWriter()

    if (!writer) {
      return
    }

    await syncProductToIndex(payload, writer, productId, req)
  } catch (error) {
    /*
     * Reached under the CLI, where `@/lib/env.server` cannot resolve at all. Logged at debug rather
     * than warn: it is the expected state for `pnpm seed`, `pnpm migrate` and every harness, and a
     * warning there would be noise on a healthy run.
     */
    payload.logger.debug(
      { err: error, productId },
      'Search index not updated — no server environment in this process. `pnpm reindex` rebuilds it.',
    )
  }
}

/**
 * For `products.hooks.afterChange`.
 *
 * Fires on **every** product write, including the ones `syncProductDerived` makes on the product's
 * behalf when a variant changes — which is exactly the intent. A variant going out of stock changes
 * the product's `inStock` facet, and there is one path through the product for all of it rather than
 * two that can disagree.
 *
 * Note what this means for a rolled-back transaction: an `afterChange` runs *inside* the caller's
 * transaction, so a later failure can undo the database write while the index keeps the record. That
 * is a derived store being briefly ahead of the truth; it self-heals on the next write to the same
 * product, and `pnpm reindex` fixes it outright — the trade every index-on-write makes. Writing
 * after commit instead would need a queue this project has no reason to own yet.
 */
export const syncSearchIndexAfterChange: CollectionAfterChangeHook = async ({ doc, req }) => {
  await sync(req.payload, (doc as { id: number }).id, req)

  return doc
}

/**
 * For `products.hooks.afterDelete`.
 *
 * Only a *permanent* delete reaches this — `products` has `trash: true`, so the ordinary admin
 * delete is an update and goes through `afterChange` above, where `payload.find` no longer returns
 * the soft-deleted row and the record is removed just the same.
 */
export const syncSearchIndexAfterDelete: CollectionAfterDeleteHook = async ({ doc, id, req }) => {
  await sync(req.payload, typeof id === 'number' ? id : (doc as { id: number }).id, req)

  return doc
}

/**
 * For `collections.hooks.afterChange`.
 *
 * Membership lives on the collection, so adding a product to "Essentials" changes *the product's*
 * `collectionSlugs` facet and fires no product hook at all. Without this, a curated set would become
 * filterable only after the next unrelated save on each of its members.
 *
 * Every member is re-synced, from **before and after** the edit, because a product removed from the
 * set needs updating exactly as much as one added — and by `afterChange` the previous membership is
 * gone from the document. `previousDoc` is what still holds it.
 */
export const syncSearchIndexForCollection: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
}) => {
  const ids = new Set<number>()

  for (const source of [doc, previousDoc]) {
    for (const entry of (source as { products?: unknown[] } | null)?.products ?? []) {
      const productId = typeof entry === 'object' && entry ? (entry as { id: number }).id : entry

      if (typeof productId === 'number') {
        ids.add(productId)
      }
    }
  }

  for (const productId of ids) {
    await sync(req.payload, productId, req)
  }

  return doc
}
