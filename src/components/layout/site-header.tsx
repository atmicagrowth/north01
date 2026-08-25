import { Heart, Search, ShoppingBag, User } from 'lucide-react'

import { DesktopNav } from '@/components/layout/desktop-nav'
import { MobileNav } from '@/components/layout/mobile-nav'
import { primaryNav, utilityNav } from '@/components/layout/navigation'
import { IconButton } from '@/components/ui/icon-button'
import { Link } from '@/components/ui/link'
import { cn } from '@/lib/cn'

/**
 * SiteHeader — structure doc §3.
 *
 * Desktop: wordmark and primary navigation on the left, utilities on the right.
 * Mobile: menu, wordmark, then search and bag — the three actions §21 names. Account and
 * wishlist move into the mobile drawer rather than crowding a 390px bar.
 *
 * "Dark/monochrome. Never visually overpower content." A single hairline under a 72px
 * bar, no fill, no shadow, no blur.
 *
 * ---
 *
 * **Two things Phase 9 owns and this deliberately does not have.** The mega menu
 * (§9.1b) and the cart drawer (§9.1d) are that phase's, as is the "compact on scroll"
 * behaviour, which needs a scroll listener and therefore a client boundary this
 * component does not currently need. The utility actions are links to their eventual
 * routes; Phase 9 converts Search and Bag into overlays. They are links rather than
 * buttons on purpose — see the note in `navigation.ts`.
 */
export function SiteHeader({
  className,
  sticky = false,
}: {
  className?: string
  sticky?: boolean
}) {
  return (
    <>
      {/*
        WCAG 2.4.1 Bypass Blocks, Level A. The primary navigation repeats on every page,
        so a keyboard user needs a way past it; automated checking cannot detect its
        absence, which is why it is easy to reach Phase 9 without one.

        Hidden until focused, then a real control at the top of the page. The contract it
        creates: **every page must give its <main> `id="main-content"`.**
      */}
      <a
        href="#main-content"
        className={cn(
          'sr-only',
          'focus-visible:not-sr-only focus-visible:absolute focus-visible:left-4 focus-visible:top-4',
          'focus-visible:z-50 focus-visible:rounded-sm focus-visible:border focus-visible:border-border-strong',
          'focus-visible:bg-surface-raised focus-visible:px-4 focus-visible:py-3',
          'focus-visible:font-sans focus-visible:text-meta focus-visible:uppercase',
          'focus-visible:text-foreground',
        )}
      >
        Skip to content
      </a>

      <header
        data-slot="site-header"
        className={cn(
          'z-40 w-full border-b border-border bg-canvas',
          sticky && 'sticky top-0',
          className,
        )}
      >
        <div
          className={cn(
            'relative mx-auto flex h-18 w-full max-w-page items-center gap-m',
            'px-[clamp(1.25rem,4vw,4rem)]',
          )}
        >
          <div className="flex items-center gap-m lg:hidden">
            <MobileNav items={primaryNav} />
          </div>

          {/*
          The wordmark. Set in the display serif with wide tracking, and rendered as
          type rather than an image so it inherits the type system and stays crisp at
          every density. Guide §03 lists "NORTH / 01" itself as a display use.
        */}
          <Link
            href="/"
            variant="quiet"
            aria-label="NORTH / 01 — home"
            className={cn(
              'font-display text-heading-s uppercase tracking-[0.18em] text-foreground',
              'hover:no-underline',
              // Centred on mobile between the menu button and the two utilities.
              'absolute left-1/2 -translate-x-1/2 lg:static lg:left-auto lg:translate-x-0',
            )}
          >
            NORTH / 01
          </Link>

          <DesktopNav items={primaryNav} className="ml-l hidden lg:block" />

          <div className="ml-auto flex items-center gap-1">
            <IconButton label={utilityNav.search.label} size="sm" asChild>
              <Link href={utilityNav.search.href} variant="unstyled">
                <Search aria-hidden />
              </Link>
            </IconButton>

            <IconButton
              label={utilityNav.wishlist.label}
              size="sm"
              asChild
              className="hidden lg:inline-flex"
            >
              <Link href={utilityNav.wishlist.href} variant="unstyled">
                <Heart aria-hidden />
              </Link>
            </IconButton>

            <IconButton
              label={utilityNav.account.label}
              size="sm"
              asChild
              className="hidden lg:inline-flex"
            >
              <Link href={utilityNav.account.href} variant="unstyled">
                <User aria-hidden />
              </Link>
            </IconButton>

            <IconButton label={utilityNav.bag.label} size="sm" asChild>
              <Link href={utilityNav.bag.href} variant="unstyled">
                <ShoppingBag aria-hidden />
              </Link>
            </IconButton>
          </div>
        </div>
      </header>
    </>
  )
}
