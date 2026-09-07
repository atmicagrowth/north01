import { NuqsAdapter } from 'nuqs/adapters/next/app'
import type { ReactNode } from 'react'

/**
 * **The nuqs adapter, scoped to the results page** — the same file `shop/layout.tsx` is, for the
 * same reason, and deliberately not shared with it.
 *
 * `NuqsAdapter` is a client component, so mounting it at the frontend root would put a client
 * boundary around **every** storefront route, including `/`, whose entire performance argument rests
 * on shipping almost no client JavaScript. Two small layouts cost less than one provider on the LCP
 * route.
 *
 * The search **panel** is not covered by this and does not need to be: it lives in the shell, is
 * mounted on every route including `global-not-found`, and drives navigation with `router.push`
 * rather than with a nuqs hook — which is why it works from the 404 page too.
 */
export default function SearchLayout({ children }: { children: ReactNode }) {
  return <NuqsAdapter>{children}</NuqsAdapter>
}
