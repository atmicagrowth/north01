/**
 * **A device-local list of ids, as an external store.**
 *
 * Two features need the same thing — the guest wishlist (§20.1a) and recently-viewed (§20.1c) — and
 * `search-panel.tsx` already needed it for recent searches. This is that pattern factored out, so the
 * third instance is a call rather than a third copy of the same forty lines.
 *
 * ---
 *
 * ### `useSyncExternalStore`, not an effect
 *
 * Two reasons, and the second is the one that decides it:
 *
 * 1. Reading storage in an effect and calling `setState` is `setState`-in-effect, which this
 *    repository lints as an error.
 * 2. It lets React be given an explicit **server snapshot** — the empty list — so the server-rendered
 *    markup and the first client render agree *by construction*, instead of rendering one thing and
 *    then flashing another. `AnnouncementBar` recorded the same rule from the other direction when it
 *    declined a dismiss button: *"a `localStorage` read that makes a server-rendered bar flicker on
 *    every page load."*
 *
 * `getSnapshot` must return a **stable reference** or React re-renders forever, which is why the
 * parsed array is memoised against the raw string and only re-parsed when that string changes.
 *
 * ### Every access is inside try/catch
 *
 * Private browsing, disabled site data, and a storage quota all throw rather than returning null.
 * These lists are conveniences; not one of them is allowed to be the reason a page fails to render.
 *
 * ### It listens for `storage`
 *
 * Another tab saving a product updates this one. Without it, a customer with two tabs open sees two
 * different wishlists and neither is wrong.
 */

export type LocalList = {
  /** Read the current value. Safe on the server, where it answers with the empty list. */
  getSnapshot: () => number[]
  getServerSnapshot: () => number[]
  /** Replace the stored value and notify every subscriber in this tab. */
  set: (next: number[]) => void
  subscribe: (onChange: () => void) => () => void
}

/** One shared empty array, so an empty list is reference-stable across every snapshot. */
const EMPTY: number[] = []

export function createLocalList(key: string, parse: (raw: unknown) => number[]): LocalList {
  const listeners = new Set<() => void>()

  let cachedRaw: null | string = null
  let cachedValue: number[] = EMPTY

  const read = (): null | string => {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  }

  const getSnapshot = (): number[] => {
    const raw = read()

    if (raw === null) {
      cachedRaw = null
      cachedValue = EMPTY

      return EMPTY
    }

    if (raw !== cachedRaw) {
      cachedRaw = raw
      cachedValue = parse(raw)
    }

    return cachedValue
  }

  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    getServerSnapshot: () => EMPTY,
    getSnapshot,

    set: (next) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /*
         * Storage refused — quota, or a browser configured to block it. The list is a convenience, so
         * the write is dropped and the page carries on. Notifying anyway would be worse than useless:
         * subscribers would re-read and see the unchanged value.
         */
        return
      }

      cachedRaw = null
      notify()
    },

    subscribe: (onChange) => {
      listeners.add(onChange)

      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) {
          cachedRaw = null
          onChange()
        }
      }

      window.addEventListener('storage', onStorage)

      return () => {
        listeners.delete(onChange)
        window.removeEventListener('storage', onStorage)
      }
    },
  }
}
