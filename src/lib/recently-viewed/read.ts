import type { Payload } from 'payload'

import type { CatalogSettings } from '@/lib/catalog/catalog'
import type { ProductCard } from '@/lib/catalog/resolve'

import { publishedProductWhere } from '@/lib/catalog/query'
import { resolveProductCards } from '@/lib/catalog/resolve'
import { orderByRecency, RECENTLY_VIEWED_LIMIT } from './rules'

/**
 * **§20.1c's *"validate products before rendering"*.**
 *
 * The browser holds a list of ids and is trusted with none of them. Every id goes through the same
 * `publishedProductWhere` the shop grid uses, under `overrideAccess: false, user: null` — so a
 * withdrawn product, a scheduled one, or an id somebody typed into devtools resolves to nothing and
 * simply is not in the rail.
 *
 * That is also why this cannot be a client-side render from a cached model: the *only* thing the
 * client is allowed to contribute is which ids, and in what order.
 *
 * No `server-only` guard — it takes its `Payload` and settings as arguments, so the harness can drive
 * it.
 */

const STOREFRONT_ACCESS = { overrideAccess: false, user: null } as const

export async function readRecentlyViewedCards(
  payload: Payload,
  ids: readonly number[],
  settings: CatalogSettings,
  now: string,
  excludeId?: null | number,
): Promise<ProductCard[]> {
  /*
   * Bounded before it reaches the database. The cap is the same one the client applies, so a hostile
   * or corrupted store costs one query over at most twelve ids rather than an unbounded `IN`.
   */
  const wanted = ids
    .filter((id) => Number.isSafeInteger(id) && id > 0 && id !== excludeId)
    .slice(0, RECENTLY_VIEWED_LIMIT)

  if (wanted.length === 0) {
    return []
  }

  const { docs } = await payload.find({
    collection: 'products',
    depth: 1,
    limit: wanted.length,
    ...STOREFRONT_ACCESS,
    where: { and: [...publishedProductWhere(now), { id: { in: [...wanted] } }] },
  })

  const resolved = resolveProductCards(
    docs,
    settings.currency,
    settings.locale,
    settings.lowStockThreshold,
  )

  /* The customer's order, not the database's — the list means nothing in any other sequence. */
  return orderByRecency(wanted, resolved)
}
