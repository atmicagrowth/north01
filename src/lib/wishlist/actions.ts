'use server'

import { revalidatePath } from 'next/cache'

import { getCustomer } from '@/lib/auth/session'
import { getPayloadClient } from '@/lib/payload'

import type { WishlistActionState } from './action-state'
import { mergeGuestWishlist, removeFromWishlist, saveToWishlist } from './read'
import { WISHLIST_COPY } from './rules'

/**
 * **The wishlist's three mutations, as server actions** — plan §20.1a.
 *
 * The whole surface the browser may touch is a product id. No customer id crosses this boundary in
 * either direction: it comes from the session, every time, and a request that names somebody else's
 * account has nowhere to put that name. That is the phase prompt's *"enforce ownership on the
 * server"* satisfied by there being nothing to enforce against.
 *
 * Server actions rather than route handlers, for the reason Phase 14 recorded: an action carries
 * Next's own origin check, is bound to the same session cookie the page was, and cannot be called
 * cross-site with the browser's credentials.
 *
 * ### A signed-out customer is not an error
 *
 * §20.1a offers guests an *"optional local wishlist"*, and this project has one — on the device,
 * because `WishlistItems` says outright that **there is no guest wishlist table**. So a signed-out
 * save never reaches these actions at all: the control writes to `localStorage` and says so. What
 * comes back from here when there is no session is a refusal with a sentence, which the control shows
 * only if it somehow got that far.
 */

/**
 * Re-render every surface that shows saved state.
 *
 * `layout` because the heart appears on product cards in four different routes and in the header's
 * own affordance — one call covers all of them, and covers whichever page the customer was on.
 */
function revalidateWishlist(): void {
  revalidatePath('/', 'layout')
}

export async function saveToWishlistAction(
  _previous: WishlistActionState,
  formData: FormData,
): Promise<WishlistActionState> {
  const productId = Number(formData.get('productId'))

  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return { notice: null, ok: false, saved: false }
  }

  const customer = await getCustomer()

  if (!customer) {
    return { notice: WISHLIST_COPY.guestNotice, ok: false, saved: false }
  }

  const payload = await getPayloadClient()
  const outcome = await saveToWishlist(payload, customer.id, productId)

  if (outcome === 'unavailable') {
    return { notice: WISHLIST_COPY.unavailable, ok: false, saved: false }
  }

  revalidateWishlist()

  /* `alreadySaved` is a success: the customer wanted it on the list, and it is on the list. */
  return { notice: null, ok: true, saved: true }
}

export async function removeFromWishlistAction(
  _previous: WishlistActionState,
  formData: FormData,
): Promise<WishlistActionState> {
  const productId = Number(formData.get('productId'))

  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return { notice: null, ok: false, saved: true }
  }

  const customer = await getCustomer()

  if (!customer) {
    return { notice: WISHLIST_COPY.guestNotice, ok: false, saved: false }
  }

  const payload = await getPayloadClient()

  await removeFromWishlist(payload, customer.id, productId)

  revalidateWishlist()

  return { notice: WISHLIST_COPY.removed, ok: true, saved: false }
}

/**
 * **§20.1a's *"on login, merge into customer wishlist"*.**
 *
 * Called by the client, not by the sign-in flow, and that is forced rather than chosen —
 * see **DEV-68**. The guest list lives in `localStorage`, which a server action cannot read; the cart
 * merge does not have this problem because a guest cart is a database row named by a cookie. So the
 * browser hands its list over once, after the session exists.
 *
 * That makes the input **untrusted in a way the cart's merge input is not**, and the consequences are
 * contained rather than assumed:
 *
 * - It can only ever write rows owned by the session's own customer. There is no parameter for whose.
 * - Every id is checked against the published catalogue before anything is written, so a hostile list
 *   of ten thousand integers writes nothing and costs one query.
 * - The list is capped at `GUEST_WISHLIST_LIMIT` on the way in, so the work is bounded whatever
 *   arrives.
 *
 * The worst a forged call can do is add a product to *the caller's own* wishlist, which is what the
 * button next to it does anyway.
 */
export async function mergeGuestWishlistAction(
  ids: number[],
): Promise<{ added: number; ok: boolean }> {
  const customer = await getCustomer()

  if (!customer) {
    return { added: 0, ok: false }
  }

  const clean = Array.isArray(ids)
    ? ids.filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 50)
    : []

  if (clean.length === 0) {
    return { added: 0, ok: true }
  }

  const payload = await getPayloadClient()

  const result = await mergeGuestWishlist(
    payload,
    customer.id,
    clean,
    new Date().toISOString(),
  ).catch(() => null)

  if (!result) {
    /*
     * A failed merge must not cost the customer their list. Reporting failure leaves the device copy
     * in place, so the next page load tries again — the same posture Phase 19 took with a queued
     * message.
     */
    return { added: 0, ok: false }
  }

  revalidateWishlist()

  return { added: result.added, ok: true }
}
