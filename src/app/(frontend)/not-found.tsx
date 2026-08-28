import type { Metadata } from 'next'

import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'

export const metadata: Metadata = {
  title: 'Not found',
  robots: { index: false, follow: false },
}

/**
 * **The answer to feature matrix §1's *"broken internal route"*.**
 *
 * Phase 9 mounts a header on every page, and the plan's build order puts that header several phases
 * ahead of the pages it points at: `/shop` is Phase 11, the product route is Phase 13, `/lookbook` is
 * Phase 22, `/about` and the support surface are Phase 23 (**G-08**). Until then the navigation is
 * complete and most of its destinations are not.
 *
 * Without this file those clicks land on Next's built-in 404 — no header, no footer, no way back,
 * and none of the type system. That is a worse outcome than the missing page itself, and it is
 * caused *by* mounting the shell, so the phase that mounts it owns the fix.
 *
 * It is deliberately the smallest honest version: what happened, and the navigation the customer
 * already has. **Phase 31** owns error, empty and loading states as a system — including whatever
 * this becomes once there is a catalogue to suggest from — and it should replace this rather than
 * work around it.
 *
 * `robots: noindex` because a 404 rendered at a real URL is still a document a crawler can reach.
 * Next serves it with a 404 status regardless; the meta tag is belt and braces for the case where a
 * proxy rewrites the status.
 */
export default function NotFound() {
  return (
    <PageContainer width="narrow">
      <Section spacing="loose" className="flex flex-col items-start gap-l">
        <PageTitle eyebrow="404" size="display-l">
          This page does not exist.
        </PageTitle>

        <p className="max-w-measure font-sans text-body text-foreground-muted">
          The address may be mistyped, or the page may have been moved. Everything in the shop is
          reachable from the navigation above.
        </p>

        <Button asChild variant="primary">
          <Link href="/" variant="unstyled">
            Home
          </Link>
        </Button>
      </Section>
    </PageContainer>
  )
}
