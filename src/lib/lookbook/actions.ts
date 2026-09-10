'use server'

import { revalidatePath } from 'next/cache'

import type { LookProduct } from './rules'

import { getCustomer } from '@/lib/auth/session'
import { addToCart } from '@/lib/cart/cart'
import { getCatalogSettings } from '@/lib/catalog/catalog'
import { getPayloadClient } from '@/lib/payload'
import { readLookProduct, readLookProducts } from './read'
import { lookNotice, planLookAddition } from './rules'

/**
 * **The two things a shop-the-look surface asks the server** — plan §22.1c and §22.1d.
 *
 * Both take product ids and nothing else. No price, no variant choice made on the client, and no
 * quantity beyond one — the browser names *what* it is interested in and the server decides
 * everything about whether and how that can be bought. §13.1d's *"never trust a client-submitted
 * price"* is satisfied here the way it is in the bag: by there being nothing to trust.
 */

/**
 * **§22.1c's preview, resolved when a marker is opened rather than when a page is rendered.**
 *
 * A homepage can carry four shop-the-look blocks with eight hotspots each. Resolving every one of
 * their variant sets up front would be thirty-two products' worth of stock queries for a section
 * most visitors never touch. So the marker is cheap and the preview is paid for on demand.
 *
 * Returns `null` for a product that is no longer published, which is what a preview opened on a
 * page rendered ten minutes ago looks like when a merchandiser withdraws something in between. The
 * popover renders the absence rather than an empty frame.
 */
export async function previewLookProductAction(productId: number): Promise<LookProduct | null> {
  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return null
  }

  const [payload, settings] = await Promise.all([getPayloadClient(), getCatalogSettings()])

  return readLookProduct(payload, productId, settings)
}

export type LookAdditionResult = {
  added: number
  /**
   * **Which products actually went in.** Phase 25 needs it and Phase 22 did not have it.
   *
   * `added` is a count, and a count cannot say *which*. `shop_the_look_add_item` first reported the
   * first `added` ids of the requested list, which is wrong whenever the skipped product is not
   * last: a look whose jacket needs a size choice and whose scarf goes straight in would have
   * reported the jacket. This is the real answer, in the order they were added.
   */
  addedProductIds: number[]
  notice: null | string
  ok: boolean
}

/**
 * **§22.1d's six steps, in order.**
 *
 * 1. *Determine products* — the ids the caller sent, deduplicated and bounded.
 * 2. *Resolve purchasable variants* — `readLookProducts`, against live stock.
 * 3. *Do not guess sizes silently* — `planLookAddition` only proposes a variant where there is
 *    exactly one, so there is no branch in which a size is chosen for somebody.
 * 4. *If variant choice is required, ask for it* — those products come back in `needsChoice` and the
 *    notice names them.
 * 5. *Add only valid available items* — the loop writes only `plan.toAdd`.
 * 6. *Report skipped unavailable items* — `lookNotice` separates "needs a size" from "gone", because
 *    one is a ten-second fix and the other is a dead end, and "2 items skipped" is neither.
 *
 * ### Stock can change between the plan and the write
 *
 * `addToCart` re-checks and clamps against live inventory — Phase 14 built it that way — so a variant
 * that sold out in the last two hundred milliseconds is refused there rather than here. The count
 * reported to the customer is what **actually landed**, not what was planned, which is why `added` is
 * counted from the writes rather than from `plan.toAdd.length`.
 */
export async function addLookToBagAction(productIds: number[]): Promise<LookAdditionResult> {
  const ids = Array.isArray(productIds)
    ? productIds.filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 8)
    : []

  if (ids.length === 0) {
    return { added: 0, addedProductIds: [], notice: null, ok: false }
  }

  const [payload, settings, customer] = await Promise.all([
    getPayloadClient(),
    getCatalogSettings(),
    getCustomer(),
  ])

  const products = await readLookProducts(payload, ids, settings)
  const plan = planLookAddition(products)

  const addedProductIds: number[] = []

  for (const entry of plan.toAdd) {
    const result = await addToCart(customer?.id ?? null, entry.variant.id, 1).catch(() => null)

    if (result?.ok) {
      addedProductIds.push(entry.product.id)
    }
  }

  const added = addedProductIds.length

  if (added > 0) {
    /*
     * `layout`, because the bag lives in the root layout's drawer and the bag page is its own route.
     * One call covers both, and covers whichever page the look happened to be on.
     */
    revalidatePath('/', 'layout')
  }

  return { added, addedProductIds, notice: lookNotice(plan, added), ok: true }
}
