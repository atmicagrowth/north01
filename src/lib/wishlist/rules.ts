/**
 * **Plan §20's decisions, as pure functions.**
 *
 * The phase prompt names its own tests — *"add tests for cross-account access prevention and merge
 * behavior"* — and the merge half is only testable without a database if the merge is a decision
 * rather than a query. So it is one: `planWishlistMerge` takes two lists and returns what to write,
 * and `lib/wishlist/wishlist.ts` next door does the writing.
 *
 * The device-local half lives here too, for the same reason `lib/catalog/search.ts` keeps the recent
 * searches rules: a store a customer can edit by hand is an untrusted input, and the parser that
 * tolerates it should be testable on its own.
 */

/* -------------------------------------------------------------------------------------------------
 * The guest list — plan §20.1a's "optional local wishlist"
 * ---------------------------------------------------------------------------------------------- */

/**
 * Namespaced so it cannot collide with anything else on the origin — the same rule
 * `RECENT_SEARCH_KEY` follows, and the same reason: this is one origin among many a browser holds.
 */
export const GUEST_WISHLIST_KEY = 'north01:wishlist'

/**
 * How many products a guest may keep before the oldest falls off.
 *
 * §20.1a does not give a number, so this is a decision. Fifty: high enough that nobody meets it in
 * ordinary use, low enough that a corrupted or hostile store cannot grow without bound in a place the
 * customer's own browser has to parse on every render. The list is dropped into an account on
 * sign-in, so the ceiling also bounds what one merge can write.
 */
export const GUEST_WISHLIST_LIMIT = 50

/**
 * **Read a device-local list from whatever is actually in storage.**
 *
 * Never throws, and never trusts. The value is a string a customer can edit in devtools, that
 * survives deployments, and that may have been written by an older version of this code. Every
 * unusable entry is dropped rather than defended against later — a corrupted store degrades to a
 * shorter wishlist, not to a broken page.
 *
 * Product ids are positive safe integers. Anything else — a string id, a float, a negative, an
 * object, `null` — is not one, and is discarded here rather than reaching a database query.
 */
export function readGuestWishlist(raw: unknown): number[] {
  if (typeof raw !== 'string' || raw.length === 0) {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) {
    return []
  }

  const seen = new Set<number>()
  const list: number[] = []

  for (const entry of parsed) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry <= 0) {
      continue
    }

    if (seen.has(entry)) {
      continue
    }

    seen.add(entry)
    list.push(entry)

    if (list.length >= GUEST_WISHLIST_LIMIT) {
      break
    }
  }

  return list
}

/**
 * Add a product to the front of the device-local list.
 *
 * Most-recent-first, deduped, capped. **Idempotent**: adding a product already on the list moves it
 * to the front and changes nothing else, so a double-tap cannot produce two entries — which matters
 * because the database's compound unique index would refuse the second one anyway and the two halves
 * should agree.
 */
export function addToGuestWishlist(list: readonly number[], productId: number): number[] {
  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return [...list]
  }

  return [productId, ...list.filter((id) => id !== productId)].slice(0, GUEST_WISHLIST_LIMIT)
}

export function removeFromGuestWishlist(list: readonly number[], productId: number): number[] {
  return list.filter((id) => id !== productId)
}

/* -------------------------------------------------------------------------------------------------
 * The merge — plan §20.1b
 * ---------------------------------------------------------------------------------------------- */

export type WishlistMergePlan = {
  /** Guest entries that name a product the account already has. Nothing is written for these. */
  alreadySaved: number[]
  /** Guest entries naming a product that no longer exists or is not published. Dropped. */
  invalid: number[]
  /** What to insert, in the order it should be inserted. */
  toAdd: number[]
}

/**
 * **§20.1b, complete.**
 *
 * > *"Existing customer wishlist wins duplicates. Invalid/deleted products removed. Preserve order
 * > where useful."*
 *
 * Three rules and no more — note what the plan does **not** ask for, in contrast with §14.1b's
 * seven-step cart merge: there is no quantity to sum, no variant to reconcile, and no report to
 * render. A wishlist entry is a fact about interest, and two facts about the same interest are one
 * fact.
 *
 * ### "Existing wins" is enforced twice, and that is deliberate
 *
 * `wishlist-items` carries a compound unique index on `(customer, product)` with both columns
 * required, so a duplicate insert is refused by Postgres rather than by whichever code path happened
 * to run first. This function filters duplicates out anyway — not because the constraint might fail,
 * but so the caller can *report* what happened instead of counting exceptions. The constraint is the
 * guarantee; this is the explanation.
 *
 * ### "Preserve order where useful"
 *
 * The guest list is most-recent-first, and rows are read back by `createdAt`. Inserting in reverse —
 * oldest guest entry first — is what makes the merged list read in the same order the guest built it,
 * rather than inverted. That is the only sense in which order is useful here, and it costs nothing.
 */
export function planWishlistMerge(input: {
  /** Product ids the account already has. */
  existing: readonly number[]
  /** The device-local list, most-recent-first. */
  guest: readonly number[]
  /** Product ids from the guest list that resolved to a published product. */
  valid: readonly number[]
}): WishlistMergePlan {
  const existing = new Set(input.existing)
  const valid = new Set(input.valid)

  const alreadySaved: number[] = []
  const invalid: number[] = []
  const toAdd: number[] = []

  for (const id of input.guest) {
    if (!valid.has(id)) {
      invalid.push(id)
      continue
    }

    if (existing.has(id)) {
      alreadySaved.push(id)
      continue
    }

    toAdd.push(id)
  }

  /* Oldest first, so the merged list reads in the order the guest built it. */
  return { alreadySaved, invalid, toAdd: toAdd.reverse() }
}

/* -------------------------------------------------------------------------------------------------
 * Copy
 * ---------------------------------------------------------------------------------------------- */

/**
 * What the wishlist control says.
 *
 * `saved` and `save` are the two states of one button, so they are the same length and the same
 * grammatical shape — a control whose label changes width when pressed makes the layout move under
 * the cursor that pressed it.
 */
export const WISHLIST_COPY = {
  /** The signed-out state. Saving still works; it is kept on the device until they sign in. */
  guestNotice: 'Saved on this device. Sign in to keep your list.',
  merged: (count: number) =>
    count === 1
      ? '1 saved item moved to your account.'
      : `${count} saved items moved to your account.`,
  removed: 'Removed from your list.',
  save: 'Save for later',
  saved: 'Saved',
  /** §20.1a's "move to cart", which cannot pick a size — see WishlistItems on why. */
  sizeNeeded: 'Choose a size to add this to your bag.',
  unavailable: 'This is no longer available.',
} as const

export const WISHLIST_EMPTY_COPY = {
  body: 'Anything you save is kept here, so you can come back to it.',
  cta: 'Browse the shop',
  title: 'Nothing saved yet.',
} as const
