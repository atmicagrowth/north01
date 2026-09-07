import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { NewsletterSignup } from '@/components/newsletter/newsletter-signup'
import { CartDrawer } from '@/components/shell/cart-drawer'
import { ShellOverlayProvider } from '@/components/shell/overlay-context'
import { SearchOverlay } from '@/components/shell/search-overlay'
import { getShell } from '@/lib/navigation/shell'

import { fontVariables } from './fonts'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'NORTH / 01',
    template: '%s · NORTH / 01',
  },
  description: 'An online-only direct-to-consumer premium apparel storefront.',
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

  return (
    <html lang="en" className={fontVariables}>
      <body>
        <ShellOverlayProvider>
          <SiteHeader />

          <main id="main-content">{children}</main>

          <SiteFooter newsletter={<NewsletterSignup />} />

          <SearchOverlay />
          <CartDrawer items={navigation.primary} />
        </ShellOverlayProvider>
      </body>
    </html>
  )
}
