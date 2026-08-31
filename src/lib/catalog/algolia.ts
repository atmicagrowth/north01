import { algoliasearch, type Algoliasearch } from 'algoliasearch'

import {
  CATALOG_INDEX_SETTINGS,
  CATALOG_REPLICA_CUSTOM_RANKING,
  CATALOG_SORT_REPLICAS,
  indexNameForSort,
  indexSearchParams,
  replicaIndexName,
  type ProductIndexRecord,
} from './record'
import type { CatalogQuery } from './query'

/**
 * **The Algolia boundary.** Everything provider-specific is in this file, and nothing outside it
 * imports `algoliasearch`.
 *
 * The plan's master directive asks for exactly this shape when a third-party service arrives:
 * *"build a small integration boundary, keep provider-specific code isolated, validate inputs and
 * outputs, make retry/idempotency behavior explicit, provide graceful failure behavior, never couple
 * UI components directly to provider SDK details."* The rest of the catalogue speaks in
 * `CatalogQuery` and product ids; only this module knows what a `facetFilters` is.
 *
 * ### It takes credentials as arguments, and that is not an accident
 *
 * There is **no `server-only` import here and no environment import either**, which is the same
 * shape `payload/storage/cloudinary.ts` uses: the config reads the environment and hands the adapter
 * its credentials.
 *
 * The reason is mechanical. This module is reachable from a Payload collection hook, and
 * `payload.config.ts` is loaded by the `payload` CLI through tsx — outside Next, where the bare
 * specifier `server-only` does not resolve at all (`ERR_MODULE_NOT_FOUND`, measured in Phase 4 and
 * recorded in `env.server.ts`). A `server-only` import here would break every migration, the seed,
 * and every verification harness in the repository.
 *
 * So callers supply credentials: `lib/catalog/catalog.ts` takes them from the guarded server
 * environment, `payload/hooks/syncSearchIndex.ts` reaches the same module through a dynamic import,
 * and `scripts/reindex.ts` takes them from `env.core` under the CLI's own eslint exemption. None of
 * those paths can reach a browser bundle, because nothing in a client component imports this file.
 */

export type AlgoliaCredentials = {
  apiKey: string
  appId: string
}

/**
 * The index name, per environment.
 *
 * `.env.example` states the rule plainly — *"Use a DEVELOPMENT index locally, never the production
 * one"* — and this is what enforces it, rather than trusting whoever fills in the variables. There
 * is deliberately **no `ALGOLIA_INDEX_NAME` environment variable**: a name that can be set by hand
 * is a name that can be set to the production index by hand, and the one thing this must guarantee
 * is that a laptop cannot write to the live catalogue.
 *
 * Production is the unsuffixed name so that the index an operator sees in the dashboard matches the
 * one the storefront reads.
 */
export function catalogIndexName(appEnv: 'local' | 'preview' | 'production'): string {
  return appEnv === 'production' ? 'north01_products' : `north01_products_${appEnv}`
}

/**
 * Timeouts, in **milliseconds**, and they exist because plan §12.1d names *"network timeout"* as an
 * edge case the storefront must survive.
 *
 * The unit is not a detail. This constant read `{ connect: 2, read: 3, write: 30 }` when it was
 * written, under a comment that said "in seconds" — so every request timed out after two
 * milliseconds and the client retried all four hosts before reporting *"Unreachable hosts - your
 * application id may be incorrect"*, which is a message about credentials for a fault that had
 * nothing to do with them. The units are confirmed in `@algolia/client-common`, which exports
 * `DEFAULT_CONNECT_TIMEOUT_NODE = 2000`, `DEFAULT_READ_TIMEOUT_NODE = 5000` and
 * `DEFAULT_WRITE_TIMEOUT_NODE = 30000`.
 *
 * The read timeout is deliberately shorter than Algolia's own default. This call sits in the
 * critical path of a page render: a customer waiting five seconds for a filter has already decided
 * the shop is broken, and the degraded state is a better answer than a spinner. The write timeout is
 * the default, because it runs in a rebuild or an editor's save where finishing matters more than
 * latency.
 */
const TIMEOUTS = { connect: 2_000, read: 3_000, write: 30_000 }

export function createSearchClient({ apiKey, appId }: AlgoliaCredentials): Algoliasearch {
  return algoliasearch(appId, apiKey, { timeouts: TIMEOUTS })
}

export const createWriteClient = createSearchClient

/* -------------------------------------------------------------------------------------------------
 * Reading
 * ---------------------------------------------------------------------------------------------- */

export type IndexSearchResult = {
  /** Product ids, in the index's ranking order. */
  ids: number[]
  totalPages: number
  totalProducts: number
}

/**
 * Run one catalogue query against the index and return **ids only**.
 *
 * `record.ts` explains why nothing else comes back. The short version: a search index is a copy, and
 * rendering a price from a copy is how a customer is shown a number that is not true. The ids are
 * read back from Postgres by `catalog.ts` through the ordinary access-controlled `find`.
 *
 * ### Two conversions and one validation
 *
 * - Algolia pages from `0`; the URL pages from `1`. `indexSearchParams` does that conversion.
 * - An `objectID` is a string in the index and a number in Postgres. Anything that is not a positive
 *   integer is **dropped rather than coerced**: `Number('')` is `0` and `Number('12abc')` is `NaN`,
 *   and both would go into an `id IN (…)` clause as garbage. The index is written only by this
 *   application, so a malformed id means the index has been touched by something else — which is
 *   precisely when silently coercing is the wrong response.
 *
 * It **throws** on failure rather than returning an empty result, and that distinction is the whole
 * of plan §11.1d's fallback policy. An empty result means *"no products match"*, which is a designed
 * state with its own copy; a thrown error means *"the search service is unavailable"*, which is a
 * different screen. A function that returned `[]` for both would render "No products match your
 * filters" during an Algolia outage — telling the customer their taste is the problem when the
 * service is.
 */
export async function searchProductIds(
  client: Algoliasearch,
  indexBase: string,
  query: CatalogQuery,
  hitsPerPage: number,
): Promise<IndexSearchResult> {
  const response = await client.searchSingleIndex<{ objectID: string }>({
    indexName: indexNameForSort(indexBase, query.sort),
    searchParams: indexSearchParams(query, hitsPerPage),
  })

  const ids: number[] = []

  for (const hit of response.hits ?? []) {
    const id = Number(hit.objectID)

    if (Number.isSafeInteger(id) && id > 0) {
      ids.push(id)
    }
  }

  return {
    ids,
    totalPages: response.nbPages ?? 0,
    totalProducts: response.nbHits ?? 0,
  }
}

/* -------------------------------------------------------------------------------------------------
 * Writing
 * ---------------------------------------------------------------------------------------------- */

/**
 * Create or update the primary index's settings and every sort replica.
 *
 * Idempotent, and it has to be: it runs at the top of every full rebuild, and Algolia creates an
 * index on first write, so there is no "does it exist" question to ask first.
 *
 * **The replica list is set on the primary before the replicas are configured**, because a replica
 * does not exist until its primary declares it. Setting `customRanking` on `north01_products_price_asc`
 * before that call would create a *plain index* of that name which never receives a record, and the
 * price sort would silently return nothing for ever.
 *
 * `forwardToReplicas` is **not** used for `customRanking` — forwarding is what makes every replica
 * identical to its primary, which would defeat the entire point of having four of them. It is
 * correct for `attributesForFaceting`, which must be the same everywhere or a filter that works
 * under "Featured" returns a 400 under "Price: low to high".
 */
export async function configureCatalogIndex(
  client: Algoliasearch,
  indexBase: string,
): Promise<void> {
  const replicas = Object.values(CATALOG_SORT_REPLICAS)
    .filter((suffix): suffix is string => suffix !== null)
    .map((suffix) => replicaIndexName(indexBase, suffix))

  await client.setSettings({
    indexName: indexBase,
    indexSettings: { ...CATALOG_INDEX_SETTINGS, replicas },
  })

  for (const [suffix, customRanking] of Object.entries(CATALOG_REPLICA_CUSTOM_RANKING)) {
    await client.setSettings({
      indexName: replicaIndexName(indexBase, suffix),
      indexSettings: {
        attributesForFaceting: [...CATALOG_INDEX_SETTINGS.attributesForFaceting],
        attributesToRetrieve: [...CATALOG_INDEX_SETTINGS.attributesToRetrieve],
        customRanking,
        numericAttributesForFiltering: [...CATALOG_INDEX_SETTINGS.numericAttributesForFiltering],
      },
    })
  }
}

/**
 * Replace the whole index atomically.
 *
 * `replaceAllObjects` builds a temporary index, copies the settings, and moves it over the live one
 * — so a rebuild never leaves the storefront looking at a half-populated catalogue, and a rebuild
 * that fails part-way leaves the old index untouched. Doing it as "delete everything, then add
 * everything" would give a window, however short, in which `/shop?color=black` correctly reports
 * that the shop has nothing in it.
 *
 * `scopes` keeps `settings` (and therefore the replica list), so the sorts survive the move.
 */
export async function replaceAllProducts(
  client: Algoliasearch,
  indexBase: string,
  records: ProductIndexRecord[],
): Promise<void> {
  await client.replaceAllObjects({
    indexName: indexBase,
    objects: records as unknown as Record<string, unknown>[],
    scopes: ['settings', 'rules', 'synonyms'],
  })
}

/** Upsert one product. Algolia's `saveObjects` is an upsert keyed on `objectID`, so this is idempotent. */
export async function saveProductRecord(
  client: Algoliasearch,
  indexBase: string,
  record: ProductIndexRecord,
): Promise<void> {
  await client.saveObjects({
    indexName: indexBase,
    objects: [record as unknown as Record<string, unknown>],
  })
}

/**
 * Remove one product.
 *
 * Deleting an `objectID` that is not there is a no-op rather than an error, which is what makes this
 * safe to call for *every* unpublish — including the ones where the product was never indexed
 * because it had no active variant. The alternative, reading first to decide, would be a round trip
 * to avoid a round trip.
 */
export async function deleteProductRecord(
  client: Algoliasearch,
  indexBase: string,
  productId: number,
): Promise<void> {
  await client.deleteObject({ indexName: indexBase, objectID: String(productId) })
}
