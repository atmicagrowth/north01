/**
 * **Report drift between Postgres and the search index. Writes nothing.**
 *
 * ```
 * pnpm reindex:check
 * ```
 *
 * Plan §12.1b asks to *"record synchronization intent/status in application-side data where
 * useful"*. This answers it as a **report** rather than as a stored column, and the distinction is
 * deliberate: a `syncedAt` field is one more thing to keep in step, it can itself go stale, and it
 * records what the application *believed* rather than what is true. A diff computed on demand is
 * true at the moment it is printed.
 *
 * It covers everything the targeted hooks cannot — a structural edit nobody wrote a hook for, a CLI
 * write (`pnpm seed`, a migration backfill), a sync that failed and only warned, or an index somebody
 * edited in the Algolia dashboard. Exit code 1 on drift, so it can gate a deploy.
 *
 * ### A separate file, not a `--check` flag
 *
 * The Payload CLI does not forward extra arguments to the script it runs: inside `payload run`,
 * `process.argv` contains node's path and the CLI's own path and nothing else — measured. A
 * `--check` flag would therefore have been silently ignored, and the command that was supposed to
 * *check* the index would have *rebuilt* it instead. That is the worst possible failure for a
 * read-only tool, so the two are separate entry points.
 *
 * ### It reads with the SEARCH key
 *
 * A tool that must not write should not hold a credential that can. `browse` is on the public search
 * key's ACL, which is what makes a full read possible without the write key.
 *
 * `browseObjects` pages the entire index rather than searching it: an ordinary search is capped by
 * `paginationLimitedTo` (1000 by default), which would silently under-report drift the moment the
 * catalogue outgrew it.
 */

import config from '../src/payload.config'

import { appEnv, integrationStatus, requireIntegration } from '../src/lib/env.core'
import { catalogIndexName, createSearchClient } from '../src/lib/catalog/algolia'
import { collectProductRecords } from '../src/lib/catalog/indexer'

if (integrationStatus('algolia') !== 'configured') {
  throw new Error(
    'reindex:check refuses to run: the algolia integration is not configured. See docs/ENVIRONMENT.md.',
  )
}

const { getPayload } = await import('payload')

const credentials = requireIntegration('algolia')
const indexBase = catalogIndexName(appEnv)

const payload = await getPayload({ config })

try {
  const reader = createSearchClient({
    apiKey: credentials.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY,
    appId: credentials.NEXT_PUBLIC_ALGOLIA_APP_ID,
  })

  const { records } = await collectProductRecords(payload)
  const expected = new Map(records.map((record) => [record.objectID, record]))

  const live = new Map<string, Record<string, unknown>>()

  await reader.browseObjects<Record<string, unknown>>({
    aggregator: (response) => {
      for (const hit of response.hits) {
        live.set(String((hit as { objectID: unknown }).objectID), hit)
      }
    },
    browseParams: {
      /*
       * **Ask for everything, or this check compares every field against `undefined`.**
       *
       * The index sets `attributesToRetrieve: ['objectID']` as its DEFAULT (D-37), and `browse`
       * honours it like any other read — so the first version of this script reported every field of
       * every product as stale immediately after a clean rebuild. The check caught its own bug,
       * which is the argument for it existing.
       */
      attributesToRetrieve: ['*'],
    },
    indexName: indexBase,
  })

  const missing = [...expected.keys()].filter((id) => !live.has(id))
  const orphaned = [...live.keys()].filter((id) => !expected.has(id))

  /*
   * Field-level drift, not merely presence.
   *
   * A record that exists but whose `searchTerms` predate a category rename is exactly the failure
   * `syncTaxonomyRename` exists to prevent — and it is invisible to a count of ids. Comparing the
   * fields is what makes this a check of the *contents* rather than of the *population*.
   */
  const stale: string[] = []

  for (const [id, record] of expected) {
    const current = live.get(id)

    if (!current) {
      continue
    }

    for (const key of Object.keys(record)) {
      /*
       * `unretrievableAttributes` means the index will never hand this back, to any key. Comparing
       * it would report permanent drift for a field that is deliberately write-only.
       */
      if (key === 'inventoryTotal') {
        continue
      }

      if (
        JSON.stringify((record as unknown as Record<string, unknown>)[key]) !==
        JSON.stringify(current[key])
      ) {
        stale.push(`${id}.${key}`)
        break
      }
    }
  }

  const drift = missing.length + orphaned.length + stale.length

  const report = [
    `${drift === 0 ? 'No drift' : `${drift} difference(s)`} between Postgres and ${indexBase}.`,
    `  Postgres expects ${expected.size} record(s); the index holds ${live.size}.`,
    missing.length > 0 ? `  MISSING from the index: ${missing.join(', ')}` : '',
    orphaned.length > 0 ? `  ORPHANED in the index:  ${orphaned.join(', ')}` : '',
    stale.length > 0 ? `  STALE fields:           ${stale.join(', ')}` : '',
    drift > 0 ? '  Run `pnpm reindex` to rebuild.' : '',
  ]
    .filter(Boolean)
    .join('\n')

  /*
   * One awaited write, verdict first — `verify-home.ts` records why: `payload.destroy()` tears the
   * logger's transport down, and `process.exit` does not drain an asynchronous stdout write to a
   * pipe or a file.
   */
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${report}\n`, (error) => (error ? reject(error) : resolve()))
  })

  if (drift > 0) {
    await payload.destroy()
    throw new Error(`${drift} index difference(s). Run \`pnpm reindex\`.`)
  }
} finally {
  await payload.destroy().catch(() => undefined)
}
