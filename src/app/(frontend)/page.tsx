import type { Metadata } from 'next'

import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { Link } from '@/components/ui/link'

export const metadata: Metadata = {
  title: 'Foundation',
}

/**
 * Phase 3 baseline page.
 *
 * Still not the homepage — Phase 10 builds that. It exists to prove the storefront route
 * group renders as a server component with the design system applied, and it says plainly
 * that no storefront feature has been built yet, because the plan forbids UI that implies
 * functionality which does not exist.
 *
 * The global header and footer are not mounted here: Phase 3 builds those components and
 * proves them on the design-system route; plan §9.1a mounts them once the search overlay,
 * mega menu and cart drawer behind their controls exist.
 */
export default function FoundationPage() {
  return (
    <main>
      <PageContainer width="narrow">
        <Section spacing="loose">
          <PageTitle eyebrow="Foundation" size="display-xl">
            NORTH / 01
          </PageTitle>

          <p className="mt-m max-w-prose font-sans text-body text-foreground-muted">
            The application shell is running. Next.js renders this route as a server component,
            Payload is mounted in the same deployable, and the Phase 3 design system — tokens,
            typography, primitives and the global shell — is in place. No storefront feature has
            been built yet.
          </p>

          <dl className="mt-xl grid gap-px border-t border-border text-body-sm sm:grid-cols-3">
            <div className="flex flex-col gap-1 border-b border-border py-5">
              <dt className="font-sans text-micro uppercase text-foreground-muted">Storefront</dt>
              <dd>Phase 3 baseline — replaced in Phase 10</dd>
            </div>

            <div className="flex flex-col gap-1 border-b border-border py-5">
              <dt className="font-sans text-micro uppercase text-foreground-muted">
                Design system
              </dt>
              <dd>
                <Link href="/design-system">Specimen sheet</Link>
              </dd>
            </div>

            <div className="flex flex-col gap-1 border-b border-border py-5">
              <dt className="font-sans text-micro uppercase text-foreground-muted">Content</dt>
              <dd>
                {/*
                  Intentionally an anchor, not next/link. /admin lives in the (payload) route
                  group under a different root layout, so crossing into it must be a full
                  document load — and prefetching the admin bundle from the storefront would
                  be pure waste.
                */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  className="rounded-sm text-foreground underline decoration-border-control decoration-1 underline-offset-4 transition-colors duration-(--duration-fast) hover:decoration-foreground"
                  href="/admin"
                >
                  Payload admin
                </a>
              </dd>
            </div>
          </dl>
        </Section>
      </PageContainer>
    </main>
  )
}
