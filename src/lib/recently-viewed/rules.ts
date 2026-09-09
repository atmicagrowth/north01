/**
 * **Plan §20.1c, as pure functions.**
 *
 * > *"For the demo: store product IDs client-side. Limit to a small number, e.g. 10–20. Validate
 * > products before rendering. Do not store sensitive personal information."*
 *
 * Four constraints, and three of them are decided here. The fourth — *"validate products before
 * rendering"* — is `lib/recently-viewed/read.ts`, because it needs the catalogue.
 *
 * ### Why this is a separate module from the wishlist, when the shapes rhyme
 *
 * A wishlist is a **statement**: the customer said they want this, and it belongs to their account.
 * Recently-viewed is an **observation**: nobody asked for it, it is never sent to a server that
 * stores it, and it is deliberately confined to one device. Sharing an implementation would make the
 * second one look like the first, and the first is the one with a customer relationship, a unique
 * index and an ownership rule. They are kept apart on purpose.
 */

/** Namespaced against the origin, like `north01:wishlist` and `north01:recent-searches`. */
export const RECENTLY_VIEWED_KEY = 'north01:recently-viewed'

/**
 * §20.1c says *"e.g. 10–20"*, which is the only soft number in the section. Twelve.
 *
 * The rail renders four across at desktop and two on a phone, so twelve is three full rows or six —
 * a number that ends on a complete row at every breakpoint the grid uses, rather than leaving one
 * orphan tile. That is the whole of the reasoning; the plan left the choice open and this is a
 * layout-shaped answer to a layout-shaped question.
 */
export const RECENTLY_VIEWED_LIMIT = 12

/**
 * **Read the list from whatever is actually in storage.**
 *
 * Never throws, and discards anything that is not a positive safe integer. §20.1c's *"do not store
 * sensitive personal information"* is satisfied by construction — the only thing this module can
 * represent is a product id, and an entry that is not one never survives the parse. There is no shape
 * here that could hold a name, an address or an email even if something tried to write one.
 */
export function readRecentlyViewed(raw: unknown): number[] {
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
    if (
      typeof entry !== 'number' ||
      !Number.isSafeInteger(entry) ||
      entry <= 0 ||
      seen.has(entry)
    ) {
      continue
    }

    seen.add(entry)
    list.push(entry)

    if (list.length >= RECENTLY_VIEWED_LIMIT) {
      break
    }
  }

  return list
}

/**
 * Record a view. Most-recent-first, deduped, capped.
 *
 * **Idempotent**, and that matters more here than it looks: React strict mode mounts an effect twice
 * in development, and a customer refreshing a product page should not push it twice. Re-viewing a
 * product already in the list moves it to the front and changes nothing else.
 */
export function pushRecentlyViewed(list: readonly number[], productId: number): number[] {
  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return [...list]
  }

  return [productId, ...list.filter((id) => id !== productId)].slice(0, RECENTLY_VIEWED_LIMIT)
}

/**
 * Order a resolved set of products by the order the customer viewed them.
 *
 * The catalogue read returns whatever order the database found convenient, and it silently drops
 * anything unpublished — which is §20.1c's *"validate products before rendering"* working, and also
 * the reason this cannot be a simple sort: the resolved list is a **subset**, so it is rebuilt by
 * walking the id list rather than by sorting the results.
 */
export function orderByRecency<T extends { id: number }>(
  ids: readonly number[],
  resolved: readonly T[],
): T[] {
  const byId = new Map(resolved.map((item) => [item.id, item]))

  return ids.map((id) => byId.get(id)).filter((item): item is T => item !== undefined)
}

export const RECENTLY_VIEWED_COPY = {
  /** Not "for you" and not "because you viewed" — the shop is describing itself, not profiling. */
  title: 'Recently viewed',
} as const
