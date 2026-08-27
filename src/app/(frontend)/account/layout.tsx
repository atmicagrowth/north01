import type { ReactNode } from 'react'

import { PageContainer } from '@/components/layout/page-container'
import { Section } from '@/components/layout/section'
import { Link } from '@/components/ui/link'

/**
 * **The protected segment.** Everything under `/account` requires a signed-in customer.
 *
 * The guard is not here. It is in each page, through `requireCustomer()` — and that is deliberate,
 * not an oversight. A layout in the App Router does **not** re-render on every navigation within its
 * own segment: it renders once and children swap beneath it. A check placed here would run on the
 * first load of `/account` and then not run again when the customer moves to `/account/orders`,
 * which is the difference between a guard and a decoration.
 *
 * Next's authentication guide says the same thing outright: *"you should fetch the user data in the
 * layout and do the auth check in your Data Access Layer"*, because layouts are the one place the
 * check looks right and behaves wrong. So the layout owns the frame and `requireCustomer()` owns the
 * decision, on every route that needs it, every time it renders.
 *
 * `proxy.ts` is in front of both and redirects a visitor with no cookie at all before any of this
 * runs. It cannot verify the cookie, so it is a courtesy rather than a control.
 *
 * `width="narrow"` — the 1024px step the container reserves for *"account, checkout, support"*,
 * matching visual guide §09's calmer utility surfaces.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content">
      <PageContainer width="narrow">
        <Section spacing="tight" className="flex flex-col gap-xl">
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
