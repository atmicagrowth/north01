import type { ReactNode } from 'react'

import { PageContainer } from '@/components/layout/page-container'
import { Section } from '@/components/layout/section'

/**
 * The shell the four authentication routes share.
 *
 * `(auth)` is a route group, so it adds no URL segment — `/login`, `/register`,
 * `/forgot-password` and `/reset-password` are all top-level paths. Grouping them buys one layout
 * and one place to state what they have in common, which is decision **DEV-16**'s reasoning applied
 * one level down.
 *
 * Visual guide §09 on the utility pages: *"simpler and calmer"* than the editorial surfaces. So a
 * single narrow column, one measure wide, with the page's own heading supplied by each route — no
 * hero, no imagery, nothing to read past. `measure` rather than `narrow`: a form is read like a
 * paragraph, and a 1024px-wide login form puts its label a long way from its input.
 *
 * **Phase 9 removed two things from this file.** The `<main>` landmark and the standalone wordmark
 * were both here because the global shell was not mounted; it is now, so the layout supplies exactly
 * one `<main id="main-content">` and one header for every route, and repeating either here would
 * produce a duplicate landmark and a second link to the same place.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <PageContainer width="measure">
      <Section spacing="loose" className="flex flex-col gap-xl">
        {children}
      </Section>
    </PageContainer>
  )
}
