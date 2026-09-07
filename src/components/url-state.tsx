'use client'

import { useQueryStates, type UseQueryStatesKeysMap } from 'nuqs'
import { useTransition } from 'react'

/**
 * **The shared contract for every control whose state is the URL.**
 *
 * Three controls write URL state — the shop's sort, the shop's filter panel and the product page's
 * variant selector — and all three want the same three options and the same rule about history. The
 * options were already duplicated; the rule was discovered in Phase 13's first sweep, and it is the
 * reason this file exists rather than a fourth copy of `WRITE_OPTIONS`.
 *
 * ---
 *
 * ### The options
 *
 * - **`shallow: false`.** The server renders from these exact parameters. A shallow write would
 *   change the address bar and nothing else — the fake control plan §0.1.17 forbids.
 * - **`history: 'push'`.** Feature matrix §5 requires that *"browser back/forward restores state"*.
 *   The default `replace` makes Back leave the shop entirely after four filters have been ticked.
 * - **`scroll: false`.** The default jumps to the top of the document, throwing a customer who
 *   ticked a facet three sections down back to the page title.
 *
 * ### The rule: a state nobody saw is not a history entry
 *
 * `history: 'push'` and `shallow: false` together have a failure mode that no gate in this project
 * could see, and it was measured against a **production build** rather than reasoned about:
 *
 * > Click one size, then another before the server has answered the first. The URL ends on the
 * > second, correctly. Press Back. The address bar says `?size=XS` and the page shows **no size
 * > selected**.
 *
 * The push happens synchronously; the render that belongs to it arrives later. When a second push
 * supersedes the first before its render commits, the intermediate entry is left holding the tree
 * that was on screen when it was created — so Back restores content describing a *different* URL.
 * Measured on `/product/<slug>`, where the page is three queries deep, at **400 ms between clicks**;
 * and on `/shop/<category>` at 150 ms. It is not specific to this project's code — it is what the
 * App Router's client cache does with an entry that never received a render.
 *
 * The fix is to stop creating that entry. While a navigation is still in flight the customer has not
 * yet **seen** the state they are leaving, so it is not a place to come back to: the write becomes a
 * `replace` and the burst collapses into the one entry they actually looked at. As soon as the
 * server answers, `push` resumes and deliberate selections get their own entries, which is exactly
 * what feature matrix §5 asks for.
 *
 * Measured with a probe that walks the whole history in both directions and asserts that every entry
 * renders what its URL claims: **2/5 before, 5/5 after.**
 *
 * `startTransition` is what makes `pending` mean *"the server has not answered yet"* rather than
 * *"the URL has not changed yet"*; nuqs documents it for exactly this purpose. It is per-component,
 * so a burst spread across two different controls — the sort select and then a checkbox — is not
 * covered. That case is left alone deliberately: the realistic burst is repeated use of one control,
 * and a module-scoped flag shared between components would have no correct way to reset itself if a
 * transition were abandoned.
 */
const WRITE_OPTIONS = { history: 'push', scroll: false, shallow: false } as const

export function useUrlState<KeyMap extends UseQueryStatesKeysMap>(parsers: KeyMap) {
  const [pending, startTransition] = useTransition()

  const [values, write] = useQueryStates(parsers, { ...WRITE_OPTIONS, startTransition })

  const commit: typeof write = (next, options) =>
    write(next, { ...(pending ? { history: 'replace' as const } : {}), ...options })

  return [values, commit, pending] as const
}
