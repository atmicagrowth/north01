'use client'

import { Heart } from 'lucide-react'
import { useActionState, useSyncExternalStore } from 'react'

import { IconButton } from '@/components/ui/icon-button'
import { createLocalList } from '@/components/local-list'
import { WISHLIST_ACTION_IDLE } from '@/lib/wishlist/action-state'
import { removeFromWishlistAction, saveToWishlistAction } from '@/lib/wishlist/actions'
import {
  addToGuestWishlist,
  GUEST_WISHLIST_KEY,
  readGuestWishlist,
  removeFromGuestWishlist,
  WISHLIST_COPY,
} from '@/lib/wishlist/rules'

/**
 * **The heart** — plan §20.1a, and **DEV-45** discharged.
 *
 * Phase 11 deferred it with a reason that has now been met: *"wishlist-items, guest identity and the
 * merge on sign-in — Phase 20."*
 *
 * ---
 *
 * ### One control, two entirely different mechanisms
 *
 * Signed in, this is a server action against `wishlist-items`. Signed out, it is a write to
 * `localStorage`. That is not a fallback — it is what `WishlistItems` decided when it declined to
 * build a guest wishlist table: *"a guest's wishlist lives on the guest's own device, merging into
 * the account on sign-in."*
 *
 * The customer is told which one they are getting. A guest who saves something sees *"saved on this
 * device"*, because a heart that looks identical in both states would be a promise the shop cannot
 * keep when they open their phone.
 *
 * ### Why the signed-out path is not a form
 *
 * `AddToBag` is a real `<form>` with hidden inputs so it works before hydration, and that is right for
 * the bag. It cannot be right here: the guest branch has no server to post to, and a form that
 * degraded to posting a wishlist add for a signed-out visitor would be §0.1.17's fake control — a
 * button that submits and achieves nothing. So the signed-out heart is honestly a client control, and
 * the signed-in one uses an action.
 *
 * ### `aria-pressed`, not a changed label
 *
 * The state lives on the control rather than in its accessible name, so a screen reader announces
 * *"Save for later, pressed"* rather than a name that changes under the cursor. `IconButton` requires
 * a `label` precisely because an icon is not a name.
 */

const guestList = createLocalList(GUEST_WISHLIST_KEY, readGuestWishlist)

export function WishlistButton({
  className,
  productId,
  savedForCustomer,
  signedIn,
}: {
  className?: string
  productId: number
  /** Whether this product is on the signed-in customer's list, resolved on the server. */
  savedForCustomer: boolean
  signedIn: boolean
}) {
  const guestIds = useSyncExternalStore(
    guestList.subscribe,
    guestList.getSnapshot,
    guestList.getServerSnapshot,
  )

  const [saveState, save, savePending] = useActionState(saveToWishlistAction, {
    ...WISHLIST_ACTION_IDLE,
    saved: savedForCustomer,
  })

  const [removeState, remove, removePending] = useActionState(removeFromWishlistAction, {
    ...WISHLIST_ACTION_IDLE,
    saved: savedForCustomer,
  })

  /*
   * The server's answer is the truth for a signed-in customer, and the two actions each carry their
   * own state, so the most recent one wins. `savedForCustomer` is the baseline the page rendered
   * with, which is what makes the control correct before anything has been pressed.
   */
  const saved = signedIn
    ? removePending
      ? false
      : savePending
        ? true
        : (removeState.notice !== null ? removeState.saved : saveState.saved) || savedForCustomer
    : guestIds.includes(productId)

  const onGuestToggle = () => {
    guestList.set(
      saved
        ? removeFromGuestWishlist(guestIds, productId)
        : addToGuestWishlist(guestIds, productId),
    )
  }

  if (!signedIn) {
    return (
      <IconButton
        aria-pressed={saved}
        className={className}
        label={saved ? WISHLIST_COPY.saved : WISHLIST_COPY.save}
        onClick={onGuestToggle}
        type="button"
        variant="ghost"
      >
        <Heart aria-hidden="true" fill={saved ? 'currentColor' : 'none'} />
      </IconButton>
    )
  }

  return (
    <form action={saved ? remove : save}>
      <input name="productId" type="hidden" value={productId} />
      <IconButton
        aria-pressed={saved}
        className={className}
        disabled={savePending || removePending}
        label={saved ? WISHLIST_COPY.saved : WISHLIST_COPY.save}
        type="submit"
        variant="ghost"
      >
        <Heart aria-hidden="true" fill={saved ? 'currentColor' : 'none'} />
      </IconButton>
    </form>
  )
}

/**
 * The same control with the guest explanation attached, for the product page — where there is room
 * for a sentence and where a customer deciding whether to save something deserves to know where it
 * is being saved.
 */
export function WishlistControl({
  productId,
  savedForCustomer,
  signedIn,
}: {
  productId: number
  savedForCustomer: boolean
  signedIn: boolean
}) {
  const guestIds = useSyncExternalStore(
    guestList.subscribe,
    guestList.getSnapshot,
    guestList.getServerSnapshot,
  )

  const savedLocally = !signedIn && guestIds.includes(productId)

  return (
    <div className="flex flex-col gap-xs">
      <div className="flex items-center gap-s">
        <WishlistButton
          productId={productId}
          savedForCustomer={savedForCustomer}
          signedIn={signedIn}
        />
        <span className="font-sans text-body-sm text-foreground-muted">
          {signedIn || savedLocally ? WISHLIST_COPY.saved : WISHLIST_COPY.save}
        </span>
      </div>

      {/*
        Only once they have actually saved something. Explaining the device caveat to somebody who has
        not saved anything is noise; explaining it after they have is the moment it matters.
      */}
      {savedLocally ? (
        <p aria-live="polite" className="font-sans text-body-sm text-foreground-muted">
          {WISHLIST_COPY.guestNotice}
        </p>
      ) : null}
    </div>
  )
}
