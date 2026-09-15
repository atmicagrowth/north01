import type { ReactNode } from 'react'

import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Prose } from '@/components/editorial/prose'
import { Section } from '@/components/layout/section'
import { Link } from '@/components/ui/link'
import {
  hasPublishedText,
  publishedLegalNav,
  type LegalPublication,
} from '@/lib/navigation/utility'

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
 * ### An unwritten policy says so — or, for a legal document, is not a page at all
 *
 * `null` is a real state — nobody has written the policy yet, or an editor emptied the field.
 * Rendering a title over nothing would tell a customer the page is broken; saying the policy is not
 * published yet, and offering somewhere to go instead, is the honest answer and the one §0.1.17 asks
 * for. A settings global that **could not be read** never reaches this component: `getSupportPolicies`
 * throws, and the error boundary answers instead, because "not published" is a claim a failed read
 * cannot make (sweep 1, S18). *Written* means **has text** (`hasPublishedText`): an emptied
 * Lexical field is a truthy object holding one blank paragraph, and branching on truthiness rendered
 * exactly the title-over-nothing this section exists to prevent.
 *
 * That message is for Shipping and Returns. `/legal/privacy` and `/legal/terms` call `notFound()`
 * before they reach this component, because a legal page that says it has no text is still a legal
 * page a footer can link to and a crawler can index — see `publishedLegalNav`.
 *
 * ### The support pages link to each other, and the published legal pages are among them
 *
 * `HelpNav` sits under the title here and on `/help/faq`, so a customer reading the returns window
 * reaches the shipping one without going back to the footer. The current page is marked by matching
 * `title` against the nav's labels, and a title matching none of them marks nothing at all.
 *
 * That last property is why Phase 37 put `/legal/privacy` and `/legal/terms` **in** the list rather
 * than leaving them out of it. `PolicyPage` renders this nav for every page built on it, so a legal
 * page taking the three-entry version would have shown a row in which nothing was current — the
 * reader's own position missing from the only orientation the page offers, on the one page where
 * knowing which document you are reading matters most.
 *
 * The two legal entries are **`publishedLegalNav`**, not a second copy of the hrefs: a document with
 * no text is absent here exactly as it is absent from the footer, so this row never offers a page that
 * answers 404. The caller passes `legal` — `getLegalPublication()` for the links, and a legal page
 * marks its own document published, since it has just rendered it.
 *
 * The nav is labelled *Support* rather than *Help* because a privacy notice is not help. Every href
 * is a route that exists — `PAGE_ROUTE_PATTERNS`, and `verify:shell` resolves `legalNav` against the
 * route tree on every run.
 */
const HELP_LINKS = [
  { href: '/help/faq', label: 'FAQ' },
  { href: '/help/shipping', label: 'Shipping' },
  { href: '/help/returns', label: 'Returns' },
] as const

export function HelpNav({
  current,
  legal,
}: {
  current?: string
  /** Which legal documents have text. Only those are linked. */
  legal: LegalPublication
}) {
  const links = [...HELP_LINKS, ...publishedLegalNav(legal)]

  return (
    <nav aria-label="Support" className="mt-m">
      <ul className="flex flex-wrap gap-x-m gap-y-s">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              aria-current={link.label === current ? 'page' : undefined}
              className="aria-[current=page]:text-foreground"
              href={link.href}
              variant="meta"
            >
              {link.label}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/shop" variant="meta">
            Continue shopping
          </Link>
        </li>
      </ul>
    </nav>
  )
}

export function PolicyPage({
  body,
  eyebrow = 'Help',
  legal,
  title,
}: {
  /** A Lexical document from `site-settings`, or `null`. */
  body: unknown
  eyebrow?: string
  /** Passed to `HelpNav`: which legal documents have text. */
  legal: LegalPublication
  title: ReactNode
}) {
  return (
    <Section spacing="tight">
      <PageContainer width="narrow">
        <PageTitle eyebrow={eyebrow} size="display-l">
          {title}
        </PageTitle>

        <HelpNav current={typeof title === 'string' ? title : undefined} legal={legal} />

        {hasPublishedText(body) ? (
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
