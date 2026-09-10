/**
 * **The four header affordances that are not content.**
 *
 * Structure document §3 fixes them — *"Right: Search. Wishlist. Account. Bag."* — and the
 * `Navigation` global deliberately does not model them, for the reason written in its own docblock:
 * *"modelling them as content would let an editor delete the bag."*
 *
 * Two of the four are destinations and two are overlays, and the distinction is the honest one
 * rather than a stylistic preference:
 *
 * - **Account** and **Wishlist** are links, to routes that exist (`/account`, built in Phase 7) or
 *   that Phase 20 builds. C-09 settled wishlist as *"a global header affordance routing to
 *   `/account/wishlist`"*.
 * - **Search** and **Bag** are buttons that open the overlays plan §9.1b and §9.1d put in this
 *   phase. They are not links, because there is nothing to link to: `/search` is Phase 12's and
 *   `/cart` is Phase 14's, and an anchor pointing at a route that does not exist is the broken
 *   internal route the feature matrix asks us to avoid.
 *
 * `/account/wishlist` does not exist yet either — Phase 20 owns it — which is why it is the one
 * entry here that will 404 until then. It is kept because structure §3 puts it in the header, and
 * because `(frontend)/not-found.tsx` gives it an answer inside the shell rather than a dead end.
 */
export const utilityNav = {
  wishlist: { label: 'Wishlist', href: '/account/wishlist' },
  account: { label: 'Account', href: '/account' },
} as const

/**
 * The legal row in the footer. Structure §20: *"Social/legal."* Not editable content.
 *
 * **Empty, and deliberately — Phase 28's audit.** These two entries pointed at `/legal/privacy` and
 * `/legal/terms`, and neither route exists: the footer shipped two 404s on every page of the shop.
 *
 * They are not built here because a privacy policy and a set of terms are **legal text somebody has
 * to write and be accountable for**, not a page anyone should generate. Inventing plausible-sounding
 * privacy copy would be worse than the broken link — it would be a false statement about what this
 * shop does with personal data, on the page a regulator reads first.
 *
 * So the row renders nothing until the copy exists. `SiteFooter` already handles an empty list.
 * Recorded as gap **G-19**: the pages, the copy, and whether they belong in the CMS or in the repo.
 */
export const legalNav: readonly { href: string; label: string }[] = []
