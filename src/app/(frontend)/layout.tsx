import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Analytics } from '@/components/analytics/analytics'
import { SpeedInsights } from '@/components/analytics/speed-insights'
import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { NewsletterSignup } from '@/components/newsletter/newsletter-signup'
import { CartDrawer } from '@/components/shell/cart-drawer'
import { WishlistSync } from '@/components/wishlist/wishlist-sync'
import { ShellOverlayProvider } from '@/components/shell/overlay-context'
import { SearchOverlay } from '@/components/shell/search-overlay'
import { getShell } from '@/lib/navigation/shell'
import { getShellSession } from '@/lib/navigation/shell-session'
import { getSeoDefaults, getSiteUrl } from '@/lib/seo/site'

import { fontVariables } from './fonts'
import './globals.css'

/**
 * **The document defaults every route inherits** — plan §24.1a.
 *
 * Three things, and each one is here rather than on a page because it is the same on every page:
 *
 * 1. **`metadataBase`.** Next resolves relative URLs in `openGraph` and `alternates` against it, and
 *    warns on every build without one. Everything this project emits is already absolute; the base
 *    is the backstop for anything that later is not, and it comes from configuration rather than
 *    from a request header — see `siteUrl` for why that distinction is load-bearing.
 * 2. **The title template.** `%s · NORTH / 01`, with the site's own name read from `site-settings`
 *    rather than hard-coded, so renaming the shop in the CMS renames every tab in it. The homepage
 *    opts out with `title: { absolute }` — it is the one page whose title *is* the site name.
 * 3. **The default description**, for any page that supplies none of its own.
 *
 * It is `generateMetadata` rather than a `metadata` constant because it reads the CMS. The read is
 * cached under the `site-settings` tag the global already revalidates, and memoised per render.
 */
export async function generateMetadata(): Promise<Metadata> {
  const defaults = await getSeoDefaults()

  return {
    description:
      defaults.description ?? 'An online-only direct-to-consumer premium apparel storefront.',
    metadataBase: new URL(getSiteUrl()),
    title: {
      default: defaults.title ?? defaults.siteName,
      template: `%s · ${defaults.siteName}`,
    },
  }
}

/**
 * Root layout for the storefront route group — and, from Phase 9, the global shell.
 *
 * The Payload admin lives in a sibling route group with its own root layout, so the two document
 * shells — and their stylesheets and typefaces — stay completely independent. That separation is
 * what keeps Tailwind's Preflight and these fonts out of `/admin`, and it is load-bearing: see D-08.
 *
 * The font custom properties go on `<html>` rather than `<body>` so they are also in scope for
 * Radix's portalled overlays, which mount into `document.body`.
 *
 * ### What plan §9.1a mounts here, and what that fixes
 *
 * Phase 3 built the header and footer and deliberately left them unmounted, because their controls
 * pointed at overlays that did not exist. They exist now, so the shell is mounted once, here, and
 * three things follow that are worth stating because they are contracts other files depend on:
 *
 * 1. **`<main id="main-content">` is declared exactly once, by this layout.** Every page renders
 *    inside it and no page declares its own. That is what makes the header's skip link — WCAG 2.4.1,
 *    Level A — work on every route rather than on the routes someone remembered.
 * 2. **`ShellOverlayProvider` wraps everything**, because it has to enclose both the triggers in the
 *    header and the overlays below the footer. It is a client component with server-rendered
 *    children, so nothing in the page tree is pulled across the boundary by it.
 * 3. **The cart drawer and search overlay are siblings of the page, not of the header.** §9.1d's
 *    *"must work from every page"* is a statement about mounting: they are outside every route's
 *    subtree, so no navigation can unmount them and no page can forget them.
 *
 * `getShell()` is called here as well as inside the header and footer. It is React-memoised for the
 * render, so this is the same single read — it is invoked at this level because the overlays need
 * the primary navigation and passing it down is cheaper than three components each discovering it.
 */
export default async function FrontendLayout({ children }: { children: ReactNode }) {
  const { navigation } = await getShell()

  /*
   * The bag, read once for the drawer. `getCart` is memoised per render, so `SiteHeader`'s read of
   * the same thing for its badge is free — the two must agree, and sharing the read is what makes
   * that structural rather than coincidental.
   */
  const { cart, customer, failed: bagUnavailable } = await getShellSession()

  return (
    <html lang="en" className={fontVariables}>
      <body>
        <ShellOverlayProvider>
          <SiteHeader />

          {/* `tabIndex={-1}` so the skip link moves focus here, not only the scroll position. */}
          <main className="focus:outline-none" id="main-content" tabIndex={-1}>
            {children}
          </main>

          <SiteFooter newsletter={<NewsletterSignup />} />

          <SearchOverlay />
          <CartDrawer cart={cart} items={navigation.primary} unavailable={bagUnavailable} />

          {/*
            §20.1a's *"on login, merge into customer wishlist"*. Renders nothing and does nothing
            until a session exists and the device has a saved list — see `wishlist-sync.tsx` and
            **DEV-68** for why this cannot happen inside `login()` the way the cart's merge does.
          */}
          <WishlistSync signedIn={customer !== null} />

          {/*
            **Plan §25 — analytics and observability, mounted once.**

            Here rather than in a page because §25.1a's taxonomy is emitted from every surface in the
            shop, and a provider that is not above all of them is a provider some events do not
            reach. Both render `null` when their integration is unconfigured, so a local checkout
            loads neither SDK — see `analytics.tsx`.

            Sentry is not here: it initialises from `instrumentation-client.ts`, which Next runs
            before hydration, so it is already watching by the time this tree exists.
          */}
          <Analytics />
          <SpeedInsights />
        </ShellOverlayProvider>
      </body>
    </html>
  )
}
