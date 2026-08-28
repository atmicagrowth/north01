import type { Metadata } from 'next'

import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { Link } from '@/components/ui/link'

export const metadata: Metadata = {
  title: 'Foundation',
}

/**
 * Phase 3 baseline page, still standing in for the homepage — **Phase 10** builds that.
 *
 * It exists to prove the storefront route group renders as a server component with the design system
 * applied, and it says plainly which parts of the store have been built, because the plan forbids UI
 * that implies functionality which does not exist.
 *
 * The global header and footer are no longer this page's problem: Phase 9 mounts them in the root
 * layout, along with the single `<main id="main-content">` that this page — and every other — now
 * renders inside. Nothing here declares a landmark of its own.
 */
export default function FoundationPage() {
  return (
    <PageContainer width="narrow">
      <Section spacing="loose">
        <PageTitle eyebrow="Foundation" size="display-xl">
          NORTH / 01
        </PageTitle>

        <p className="mt-m max-w-measure font-sans text-body text-foreground-muted">
          The application shell is running. Next.js renders this route as a server component,
          Payload is mounted in the same deployable, and the global storefront shell above and below
          this page — navigation, mega menu, search and bag overlays, footer — is driven by the CMS.
          The catalogue itself has not been built yet, so the destinations in that navigation do not
          resolve to pages.
        </p>

        <dl className="mt-xl grid gap-px border-t border-border text-body-sm sm:grid-cols-3">
          <div className="flex flex-col gap-1 border-b border-border py-5">
            <dt className="font-sans text-micro uppercase text-foreground-muted">Storefront</dt>
            <dd>Phase 9 shell — the homepage arrives in Phase 10</dd>
          </div>

          <div className="flex flex-col gap-1 border-b border-border py-5">
            <dt className="font-sans text-micro uppercase text-foreground-muted">Design system</dt>
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
  )
}
