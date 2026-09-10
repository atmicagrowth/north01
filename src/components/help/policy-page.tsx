import type { ReactNode } from 'react'

import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Prose } from '@/components/editorial/prose'
import { Section } from '@/components/layout/section'
import { Link } from '@/components/ui/link'

/**
 * **A support page whose whole body is one rich-text field from `site-settings`.**
 *
 * Shipping and Returns are the same page with a different field, so they are one component. Writing
 * them twice would be two places for a layout to drift and two places to fix a heading level.
 *
 * ### The policy is read, never copied
 *
 * `SiteSettings.ts` says these are *"one policy with one source"*, and gap **G-08** already recorded
 * that a dedicated support page must render the same field the PDP accordion does rather than a
 * second copy. This is that page. An editor who corrects the returns window in Settings corrects it
 * on the product page and here, in one edit.
 *
 * ### An unwritten policy says so
 *
 * `null` is a real state — nobody has written the policy yet, or the settings global could not be
 * read. Rendering a title over nothing would tell a customer the page is broken; saying the policy
 * is not published yet, and offering somewhere to go instead, is the honest answer and the one
 * §0.1.17 asks for.
 */
export function PolicyPage({
  body,
  eyebrow = 'Help',
  title,
}: {
  /** A Lexical document from `site-settings`, or `null`. */
  body: unknown
  eyebrow?: string
  title: ReactNode
}) {
  return (
    <Section spacing="tight">
      <PageContainer width="narrow">
        <PageTitle eyebrow={eyebrow} size="display-l">
          {title}
        </PageTitle>

        {body ? (
          <div className="mt-l">
            <Prose tone="body" value={body} />
          </div>
        ) : (
          <div className="mt-l flex flex-col items-start gap-s">
            <p className="font-sans text-body text-foreground-muted">
              This policy has not been published yet.
            </p>
            <Link className="font-sans text-meta uppercase" href="/help/faq">
              Read the frequently asked questions
            </Link>
          </div>
        )}
      </PageContainer>
    </Section>
  )
}
