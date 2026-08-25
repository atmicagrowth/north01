import type { ReactNode } from 'react'

import { footerNav } from '@/components/layout/navigation'
import { PageContainer } from '@/components/layout/page-container'
import { Link } from '@/components/ui/link'
import { cn } from '@/lib/cn'

/**
 * SiteFooter — structure doc §20: "Columns: Shop. Help. About/editorial. Newsletter.
 * Social/legal. Keep the footer visually quiet."
 *
 * Quiet means Meta-sized column heads in Stone, Body-sm links, hairline rules, and no
 * fill — the footer is the calmest surface on the site, not a second navigation.
 *
 * **The newsletter column is a slot, and Phase 3 leaves it empty.** A signup field here
 * would post nowhere: the subscriber collection arrives in Phase 6 and the mail in
 * Phase 19. Rendering the input now would be UI that looks functional and does nothing,
 * which the plan forbids outright. The column exists in the layout so the phase that can
 * make it work has somewhere to put it.
 */
export function SiteFooter({
  className,
  newsletter,
}: {
  className?: string
  /** Filled by the phase that can make a signup actually subscribe someone. */
  newsletter?: ReactNode
}) {
  return (
    <footer data-slot="site-footer" className={cn('border-t border-border', className)}>
      <PageContainer className="py-xl">
        <div
          className={cn(
            'grid gap-l',
            'sm:grid-cols-2',
            newsletter ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
          )}
        >
          {/*
            The id is derived from the index, not the heading text. `aria-labelledby` is a
            space-separated list of idrefs and HTML forbids whitespace in an id, so
            `footer-${heading}` would break the moment a column is called "Customer care" —
            silently, producing two dangling references and an unnamed landmark. It only
            worked because every current heading happens to be one word.
          */}
          {footerNav.map((column, index) => (
            <nav key={column.heading} aria-labelledby={`footer-column-${index}`}>
              <h2
                id={`footer-column-${index}`}
                className="font-sans text-meta uppercase text-foreground-muted"
              >
                {column.heading}
              </h2>
              <ul className="mt-m flex flex-col gap-s">
                {column.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} variant="quiet" className="text-body-sm">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          {newsletter ? <div>{newsletter}</div> : null}
        </div>

        <div
          className={cn(
            'mt-xl flex flex-col gap-m border-t border-border pt-m',
            'sm:flex-row sm:items-center sm:justify-between',
          )}
        >
          <p className="font-display text-heading-s uppercase tracking-[0.18em]">NORTH / 01</p>

          <div className="flex flex-col gap-s sm:flex-row sm:items-center sm:gap-m">
            {/*
              No year. This footer renders inside statically prerendered pages, so
              `new Date().getFullYear()` is evaluated at BUILD time and then frozen — a
              site built in December shows the wrong year every January until someone
              redeploys it. A yearless notice is equally valid and cannot rot.
            */}
            <p className="font-sans text-micro uppercase text-foreground-muted">© NORTH / 01</p>
            <ul className="flex items-center gap-m">
              <li>
                <Link href="/legal/privacy" variant="meta" className="text-micro">
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/legal/terms" variant="meta" className="text-micro">
                  Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </PageContainer>
    </footer>
  )
}
