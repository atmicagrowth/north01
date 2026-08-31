/**
 * **Rebuild the Algolia catalogue index from Postgres.**
 *
 * ```
 * pnpm reindex
 * ```
 *
 * Plan §12.1b asks for two things by name — *"provide a server-only manual reindex script"* and
 * *"provide a way to rebuild the full index from Postgres/Payload"* — and this is both, brought
 * forward with the index itself because §11.1d makes the shop's colour, size and collection filters
 * depend on it.
 *
 * ### When it is needed, and it is not "as a matter of routine"
 *
 * `payload/hooks/syncSearchIndex.ts` keeps the index in step with every write that happens **inside
 * Next** — the admin panel, a Server Action, a route handler. Three cases fall outside that and this
 * script is the answer to all three:
 *
 * 1. **CLI writes.** `pnpm seed`, a migration backfill, any `payload run` script. The hook's
 *    environment import cannot resolve outside Next, so those writes reach Postgres and not Algolia.
 *    That is a deliberate trade, not a defect — see the hook's docblock.
 * 2. **Structural changes.** Renaming a category slug alters the `categorySlugs` of every product
 *    filed beneath it. That is a bulk rewrite, not one product's `afterChange`.
 * 3. **Recovery.** An index that has drifted for any reason. The index is *derived*, so it is always
 *    reconstructible — which is the property that makes a stale record a nuisance rather than data
 *    loss.
 *
 * ### It is safe to run at any time
 *
 * `replaceAllObjects` builds a temporary index, copies the settings across and moves it over the live
 * one atomically. There is no window in which the storefront sees a half-populated catalogue, and a
 * run that fails part-way leaves the existing index untouched. Running it twice produces the same
 * index as running it once.
 *
 * ### The environment decides the index, and nothing else can
 *
 * `catalogIndexName(appEnv)` is the only source of the name — there is no `ALGOLIA_INDEX_NAME`
 * variable to point a laptop at production. `.env.example` states the rule (*"use a DEVELOPMENT
 * index locally, never the production one"*) and this is what enforces it rather than trusting it.
 *
 * The name is printed before anything is written, so an operator sees which index is about to be
 * replaced.
 */

import config from '../src/payload.config'

import { appEnv, integrationStatus, requireIntegration } from '../src/lib/env.core'
import {
  catalogIndexName,
  configureCatalogIndex,
  createWriteClient,
  replaceAllProducts,
} from '../src/lib/catalog/algolia'
import { collectProductRecords } from '../src/lib/catalog/indexer'
import { allIndexNames } from '../src/lib/catalog/record'

if (integrationStatus('algolia') !== 'configured') {
  throw new Error(
    'reindex refuses to run: the algolia integration is not configured. Set ' +
      'NEXT_PUBLIC_ALGOLIA_APP_ID, NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY and ALGOLIA_WRITE_API_KEY — ' +
      'see docs/ENVIRONMENT.md. The storefront runs without them; only the colour, size and ' +
      'collection filters need the index.',
  )
}

const { getPayload } = await import('payload')

const credentials = requireIntegration('algolia')
const indexBase = catalogIndexName(appEnv)

const payload = await getPayload({ config })

try {
  /*
   * The write key, not the search key. `.env.example` is explicit that these are different
   * credentials with different powers, and that the write key is deliberately NOT the admin key.
   */
  const client = createWriteClient({
    apiKey: credentials.ALGOLIA_WRITE_API_KEY,
    appId: credentials.NEXT_PUBLIC_ALGOLIA_APP_ID,
  })

  payload.logger.info(
    `Rebuilding ${indexBase} (${appEnv}) — ${allIndexNames(indexBase).length} indices including sort replicas.`,
  )

  /*
   * Settings first. An index is created by its first write, so configuring before populating means
   * the records land in an index that already knows which attributes are filterable — and, more
   * importantly, that the four sort replicas exist before anything expects them to answer.
   */
  await configureCatalogIndex(client, indexBase)

  const { excludedIds, records } = await collectProductRecords(payload)

  await replaceAllProducts(client, indexBase, records)

  payload.logger.info(
    `Indexed ${records.length} product(s). Skipped ${excludedIds.length} that do not belong in a ` +
      'listing — draft, scheduled, or with no active variant.',
  )

  /*
   * The verdict is one awaited `process.stdout.write` rather than a logger call, for the reason
   * `verify-home.ts` records: `payload.destroy()` tears the logger's transport down, and
   * `process.exit` does not drain an asynchronous stdout write to a pipe or a file. A rebuild that
   * reports nothing while exiting `0` is the failure mode this avoids.
   */
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${records.length} product(s) indexed into ${indexBase}.\n`, (error) =>
      error ? reject(error) : resolve(),
    )
  })
} finally {
  await payload.destroy()
}
