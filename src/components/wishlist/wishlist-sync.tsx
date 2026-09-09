'use client'

import { useEffect, useRef } from 'react'

import { createLocalList } from '@/components/local-list'
import { mergeGuestWishlistAction } from '@/lib/wishlist/actions'
import { GUEST_WISHLIST_KEY, readGuestWishlist } from '@/lib/wishlist/rules'

/**
 * **§20.1a's *"on login, merge into customer wishlist"*.**
 *
 * Mounted once in the storefront shell. It does nothing at all until a session exists and the device
 * has a list, and then it does one thing exactly once.
 *
 * ---
 *
 * ### Why this is a client component and not part of signing in — DEV-68
 *
 * The cart does not need this: a guest cart is a database row named by a cookie, so `mergeGuestCart`
 * runs inside `login()` on the server and the browser is not involved. A guest **wishlist** is
 * `localStorage`, which no server action can read. `WishlistItems` chose that deliberately — *"there
 * is no guest wishlist table"* — and this is the cost of the choice: the merge has to be offered by
 * the only party that can see the list.
 *
 * ### An effect, and why that is allowed here
 *
 * This repository lints `setState`-in-effect as an error, and every other device-local read in the
 * project goes through `useSyncExternalStore` to avoid it. This one sets no state. It is an effect in
 * the sense the rule exists for — *synchronising with an external system*, which is precisely the
 * documented legitimate use — and it renders nothing at all.
 *
 * `useRef` rather than a state flag for the same reason: strict mode mounts effects twice in
 * development, and a ref survives that without a re-render. The server side is idempotent regardless
 * — the compound unique index on `(customer, product)` refuses the second insert — so the worst a
 * double-fire could do is a wasted query.
 *
 * ### The device copy is cleared only on success
 *
 * A failed merge leaves the list where it is, so the next page load tries again. Clearing first would
 * be the one outcome that loses data the customer chose to keep.
 */

const guestList = createLocalList(GUEST_WISHLIST_KEY, readGuestWishlist)

export function WishlistSync({ signedIn }: { signedIn: boolean }) {
  const done = useRef(false)

  useEffect(() => {
    if (!signedIn || done.current) {
      return
    }

    const ids = guestList.getSnapshot()

    if (ids.length === 0) {
      return
    }

    done.current = true

    void mergeGuestWishlistAction(ids).then((result) => {
      if (result.ok) {
        guestList.set([])
      } else {
        /* Let a later navigation try again rather than losing the list. */
        done.current = false
      }
    })
  }, [signedIn])

  return null
}
