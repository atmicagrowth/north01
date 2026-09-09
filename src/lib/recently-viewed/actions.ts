'use server'

import type { ProductCard } from '@/lib/catalog/resolve'

import { getCatalogSettings } from '@/lib/catalog/catalog'
import { getPayloadClient } from '@/lib/payload'
import { readRecentlyViewedCards } from './read'

/**
 * **Resolve a device-local list of ids into renderable cards** — §20.1c's *"validate products before
 * rendering"*, as the one call the browser is allowed to make.
 *
 * The rail cannot be server-rendered: the ids live in `localStorage`, which the server cannot see, and
 * `AnnouncementBar` already recorded why pretending otherwise is wrong — *"a `localStorage` read that
 * makes a server-rendered bar flicker on every page load."* So the honest shape is that the rail
 * renders nothing until it knows, and then asks.
 *
 * **It returns products, never anything about a person.** There is no session read here and no
 * customer relationship anywhere in the feature. §20.1c's *"do not store sensitive personal
 * information"* is satisfied at the storage end by the parser only being able to represent product
 * ids, and at this end by the answer being public catalogue data — the same data the shop grid serves
 * to anybody.
 */
export async function resolveRecentlyViewedAction(ids: number[]): Promise<ProductCard[]> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return []
  }

  const [payload, settings] = await Promise.all([getPayloadClient(), getCatalogSettings()])

  return readRecentlyViewedCards(payload, ids, settings, new Date().toISOString())
}
