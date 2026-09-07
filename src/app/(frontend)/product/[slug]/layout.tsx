import { NuqsAdapter } from 'nuqs/adapters/next/app'
import type { ReactNode } from 'react'

/**
 * **The nuqs adapter, scoped to the product page** — the third such layout, matching `shop/` and
 * `search/` and existing for the identical reason.
 *
 * `NuqsAdapter` is a client component, so mounting it at the frontend root would wrap **every**
 * storefront route in a client boundary, including `/`, whose performance argument rests on shipping
 * almost no client JavaScript. Three small layouts cost less than one provider on the LCP route.
 *
 * The variant selector needs it because colour and size live in the URL — feature matrix §7 lists
 * *"invalid variant query"* as an edge case, which is only an edge case if the variant is in the
 * query.
 */
export default function ProductLayout({ children }: { children: ReactNode }) {
  return <NuqsAdapter>{children}</NuqsAdapter>
}
