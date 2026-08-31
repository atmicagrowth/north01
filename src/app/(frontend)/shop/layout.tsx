import { NuqsAdapter } from 'nuqs/adapters/next/app'
import type { ReactNode } from 'react'

/**
 * **The nuqs adapter, scoped to the shop.**
 *
 * nuqs needs one provider so its hooks know which router they are driving, and the obvious place to
 * put it is the frontend root layout. It is deliberately here instead, and the reason is the route
 * it would otherwise touch.
 *
 * `NuqsAdapter` is a client component, so mounting it at the root would put a client boundary around
 * **every** storefront page — including `/`, which Phase 10 measured as `"compute": "static"` with a
 * 300-second revalidate and whose entire performance argument rests on shipping no client JavaScript
 * beyond one `IntersectionObserver`. A provider at the root is not free: it is a runtime, a context
 * and a hydration pass on a page that currently needs none of them.
 *
 * Scoping it to `/shop` costs one file and means the adapter loads on exactly the routes whose URL
 * *is* their state. `/shop/<category>` nests under this layout and is covered by the same instance.
 *
 * There is no `loading.tsx` beside it, and that is also deliberate: the shop's suspense boundary is
 * around the **results**, not the page. A route-level `loading.tsx` would replace the title and the
 * filter panel with a skeleton on every filter change — see `components/catalog/catalog-page.tsx`.
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return <NuqsAdapter>{children}</NuqsAdapter>
}
