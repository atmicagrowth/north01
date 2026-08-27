import type { ReactNode } from 'react'

import { PageContainer } from '@/components/layout/page-container'
import { Section } from '@/components/layout/section'
import { Link } from '@/components/ui/link'

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
 * The global header and footer are still not mounted — plan §9.1a mounts them once the search
 * overlay, mega menu and cart drawer behind their controls exist, and Phase 3 recorded that as the
 * condition. Until then the wordmark below is the way back to the store, and it is a real link
 * rather than a decorative one.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content">
      <PageContainer width="measure">
        <Section spacing="tight" className="flex min-h-svh flex-col justify-center gap-xl">
          {/* The same wordmark treatment as the global header, so the two never drift apart. */}
          <Link
            href="/"
            variant="quiet"
            aria-label="NORTH / 01 — home"
            className="self-start font-display text-heading-s uppercase tracking-[0.18em] text-foreground hover:no-underline"
          >
            NORTH / 01
          </Link>

          {children}
        </Section>
      </PageContainer>
    </main>
  )
}
