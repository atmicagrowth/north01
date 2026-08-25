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
  const year = new Date().getFullYear()

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
          {footerNav.map((column) => (
            <nav key={column.heading} aria-labelledby={`footer-${column.heading}`}>
              <h2
                id={`footer-${column.heading}`}
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
            <p className="font-sans text-micro uppercase text-foreground-muted">
              © {year} NORTH / 01
            </p>
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
