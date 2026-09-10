import type { ReactNode } from 'react'

import { PageContainer } from '@/components/layout/page-container'
import { Link, NewTabHint } from '@/components/ui/link'
import { cn } from '@/lib/cn'
import { legalNav } from '@/lib/navigation/utility'
import { getShell } from '@/lib/navigation/shell'

/**
 * SiteFooter — structure doc §20: *"Columns: Shop. Help. About/editorial. Newsletter. Social/legal.
 * Keep the footer visually quiet."*
 *
 * Quiet means Meta-sized column heads in Stone, Body-sm links, hairline rules, and no fill — the
 * footer is the calmest surface on the site, not a second navigation.
 *
 * The columns come from the `navigation` global, so they are the editor's; the legal row and the
 * wordmark do not, because they are not merchandising. `getShell()` is memoised for the render, so
 * this costs nothing beyond what the header already paid.
 *
 * ### Social links are words, not icons
 *
 * The `Navigation` global's field description used to promise icons. It cannot be kept:
 * **`lucide-react@1.x` ships no brand marks** — `Instagram`, `Youtube` and `Linkedin` were all
 * removed from the icon set, and the package is the only icon dependency the tech stack approves.
 * The alternatives were to add a second icon library for six glyphs, or to hand-draw six trademarked
 * logos into this repository. Both are worse than the guide's own §06 instruction for links —
 * *"text-first, precise"* — which is what this does instead. Recorded as **DEV-38**; the field
 * description in `Navigation.ts` now says what actually happens.
 *
 * ### The newsletter column is filled — **DEV-25 is discharged**
 *
 * Phase 3 left this slot empty because *"a signup field here would post nowhere"* — the subscriber
 * collection did not exist. Phase 6 built it, so **Phase 10 fills the slot** with a real signup that
 * records an address, a consent timestamp and a source (**DEV-42**). The grid widens from three
 * columns to four, exactly as this layout was built to do.
 *
 * What is still owed is the **mail**, not the column: Phase 19 sends, and Phase 26 adds Turnstile.
 */
export async function SiteFooter({
  className,
  newsletter,
}: {
  className?: string
  /** Filled by `NewsletterSignup` in the root layout since Phase 10. See the docblock. */
  newsletter?: ReactNode
}) {
  const { navigation, settings } = await getShell()
  const columns = navigation.footer

  return (
    <footer data-slot="site-footer" className={cn('border-t border-border', className)}>
      <PageContainer className="py-xl">
        {columns.length > 0 || newsletter ? (
          <div
            className={cn(
              'grid gap-l sm:grid-cols-2',
              newsletter ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
            )}
          >
            {/*
              The id is derived from the index, not the heading text. `aria-labelledby` is a
              space-separated list of idrefs and HTML forbids whitespace in an id, so
              `footer-${heading}` would break the moment a column is called "Customer care" —
              silently, producing two dangling references and an unnamed landmark.
            */}
            {columns.map((column, index) => (
              <nav key={`${column.heading}-${index}`} aria-labelledby={`footer-column-${index}`}>
                <h2
                  id={`footer-column-${index}`}
                  className="font-sans text-meta uppercase text-foreground-muted"
                >
                  {column.heading}
                </h2>
                <ul className="mt-m flex flex-col gap-s">
                  {column.links.map((item, linkIndex) => (
                    <li key={linkIndex}>
                      <Link
                        href={item.href}
                        variant="quiet"
                        external={item.external}
                        className="text-body-sm"
                      >
                        {item.label}
                        {item.external ? <NewTabHint /> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}

            {newsletter ? <div>{newsletter}</div> : null}
          </div>
        ) : null}

        <div
          className={cn(
            'flex flex-col gap-m border-t border-border pt-m',
            'sm:flex-row sm:items-end sm:justify-between',
            columns.length > 0 || newsletter ? 'mt-xl' : '',
          )}
        >
          <div className="flex flex-col gap-s">
            <p className="font-display text-heading-s uppercase tracking-[0.18em]">
              {settings.siteName}
            </p>
            {settings.tagline ? (
              <p className="max-w-measure font-sans text-body-sm text-foreground-muted">
                {settings.tagline}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-s sm:items-end">
            {navigation.social.length > 0 ? (
              <ul aria-label="Social" className="flex flex-wrap items-center gap-m">
                {navigation.social.map((entry, socialIndex) => (
                  <li key={socialIndex}>
                    <Link href={entry.url} variant="meta" external className="text-micro">
                      {entry.label}
                      <NewTabHint />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-col gap-s sm:flex-row sm:items-center sm:gap-m">
              {/*
                No year. This footer renders inside statically prerendered pages, so
                `new Date().getFullYear()` is evaluated at BUILD time and then frozen — a site
                built in December shows the wrong year every January until someone redeploys it.
                A yearless notice is equally valid and cannot rot.
              */}
              <p className="font-sans text-micro uppercase text-foreground-muted">
                © {settings.siteName}
              </p>
              {/*
                Nothing rather than an empty `<ul>`. `legalNav` is empty today — Phase 28's audit
                found both of its links 404ing, and a privacy policy is text somebody has to write
                rather than a page to generate. An empty list element is still an element, and a
                screen reader announces "list, 0 items" over a footer that has nothing to say.
              */}
              {legalNav.length > 0 ? (
                <ul className="flex items-center gap-m">
                  {legalNav.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} variant="meta" className="text-micro">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
      </PageContainer>
    </footer>
  )
}
