import type { Metadata } from 'next'

import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { NewsletterSignup } from '@/components/newsletter/newsletter-signup'
import { CartDrawer } from '@/components/shell/cart-drawer'
import { ShellOverlayProvider } from '@/components/shell/overlay-context'
import { SearchOverlay } from '@/components/shell/search-overlay'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'
import { getCustomer } from '@/lib/auth/session'
import { getCart } from '@/lib/cart/cart'
import { getShell } from '@/lib/navigation/shell'

import { fontVariables } from './(frontend)/fonts'
import './(frontend)/globals.css'

export const metadata: Metadata = {
  title: 'Not found · NORTH / 01',
  description: 'The page you are looking for does not exist.',
}

/**
 * **The 404 for a URL that matches no route at all.**
 *
 * Phase 9 mounts a header on every page, and the plan's build order puts that header several phases
 * ahead of the pages it points at: `/shop` is Phase 11, the product route Phase 13, `/lookbook`
 * Phase 22, `/about` and the support surface Phase 23 (**G-08**). So for the next several phases
 * most of the navigation leads here, and "here" had better be inside the shop.
 *
 * ### Why this file exists rather than `app/not-found.tsx`
 *
 * Because this application has **two root layouts** — decision **D-08**, the route-group topology
 * that keeps Tailwind's Preflight out of the Payload admin — and Next's own documentation names
 * that as the case a root `not-found.js` cannot serve:
 *
 * > `global-not-found.js` is useful when you can't build a 404 page using a combination of
 * > `layout.js` and `not-found.js`. This can happen [when] your app has multiple root layouts…
 * > so there's no single layout to compose a global 404 from.
 *
 * The alternative was a catch-all route inside `(frontend)`, and it was rejected: a top-level
 * `[...slug]` in one route group competes for every path with the *other* group's `/admin` and
 * `/api`, which is a routing hazard aimed squarely at the CMS.
 *
 * It is gated behind `experimental.globalNotFound` — see `next.config.mjs` and **D-31** for what
 * that costs and how it is unwound if the flag changes shape.
 *
 * ### It renders the whole document, because it is bypassing the layout
 *
 * Next skips layout rendering for this file, so the `<html>` element, the font variables and the
 * stylesheet are all imported here — the same three things `(frontend)/layout.tsx` supplies, from
 * the same files, so the two cannot drift into different typography. `(frontend)/not-found.tsx` is
 * the other half of the pair and handles `notFound()` thrown *inside* a route that does exist; both
 * exist, and Phase 31 owns making them one system with the rest of the error states.
 */
export default async function GlobalNotFound() {
  const { navigation } = await getShell()

  /* The 404 renders its own <html> outside the route group, so it reads the bag for itself. */
  const customer = await getCustomer()
  const cart = await getCart(customer?.id ?? null)

  return (
    <html lang="en" className={fontVariables}>
      <body>
        <ShellOverlayProvider>
          <SiteHeader />

          <main id="main-content">
            <PageContainer width="narrow">
              <Section spacing="loose" className="flex flex-col items-start gap-l">
                <PageTitle eyebrow="404" size="display-l">
                  This page does not exist.
                </PageTitle>

                <p className="max-w-measure font-sans text-body text-foreground-muted">
                  The address may be mistyped, or the page may have been moved. Everything in the
                  shop is reachable from the navigation above.
                </p>

                <Button asChild variant="primary">
                  <Link href="/" variant="unstyled">
                    Home
                  </Link>
                </Button>
              </Section>
            </PageContainer>
          </main>

          <SiteFooter newsletter={<NewsletterSignup />} />

          <SearchOverlay />
          <CartDrawer cart={cart} items={navigation.primary} />
        </ShellOverlayProvider>
      </body>
    </html>
  )
}
