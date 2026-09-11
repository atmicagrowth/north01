'use client'

import { Heart, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { DesktopNav } from '@/components/layout/desktop-nav'
import { MobileNav } from '@/components/layout/mobile-nav'
import { MediaImage } from '@/components/media/media-image'
import { CartTrigger } from '@/components/shell/cart-drawer'
import { SearchTrigger } from '@/components/shell/search-overlay'
import { IconButton } from '@/components/ui/icon-button'
import { Link } from '@/components/ui/link'
import { cn } from '@/lib/cn'
import type { ShellNavItem, ShellSettings } from '@/lib/navigation/resolve'
import { utilityNav } from '@/lib/navigation/utility'

/**
 * HeaderBar — the sticky bar itself. Structure document §3.
 *
 * Desktop: wordmark and primary navigation on the left, utilities on the right. Mobile: menu,
 * wordmark, then search and bag — the three actions §21 names. Account and wishlist move into the
 * drawer rather than crowding a 390px bar, which is §3's own instruction.
 *
 * *"Dark/monochrome. Never visually overpower content."* A single hairline under the bar, no fill
 * beyond the page's own Obsidian, no shadow, no blur.
 *
 * ### Compact on scroll, measured rather than listened for
 *
 * §3's *"sticky when appropriate, compact on scroll"* is implemented with an `IntersectionObserver`
 * watching a one-pixel sentinel in normal flow above the bar, not with a scroll handler. A scroll
 * listener fires on every frame of every scroll on every page and has to be throttled to be
 * survivable; the observer fires **twice in a session** — once when the sentinel leaves the
 * viewport, once when it comes back — and costs nothing in between.
 *
 * The compaction itself is 72px to 56px and nothing else: no colour change, no shadow appearing, no
 * shrinking type — and, since Phase 30, **no movement of the page beneath it**: the bar's margin grows
 * by what its height loses, so the document never reflows (see the `<header>` below). Visual guide §11 lists *"excessive animation"* under Avoid, and the transition
 * runs on the `--duration-base` token, which the one reduced-motion block in `globals.css` collapses
 * to 1ms — so a customer who asked for less motion gets the compact bar with no animation rather
 * than a bar that never compacts.
 *
 * The header is `sticky`, so it is a positioned element and the panel from `DesktopNav` measures
 * itself against the inner container's `relative` box. That is why the container keeps `relative`
 * even though nothing inside it is absolutely positioned here.
 */
export function HeaderBar({
  cartCount,
  items,
  settings,
}: {
  cartCount: number
  items: ShellNavItem[]
  settings: ShellSettings
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    const target = sentinel.current

    // Server-rendered markup is the tall bar, so an environment without the observer simply keeps it.
    if (!target || typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver(([entry]) => setCompact(!entry.isIntersecting), {
      threshold: 0,
    })

    observer.observe(target)

    return () => observer.disconnect()
  }, [])

  return (
    <>
      <div ref={sentinel} aria-hidden className="h-px w-full" />

      <header
        data-slot="site-header"
        data-compact={compact || undefined}
        className={cn(
          'sticky top-0 z-40 w-full border-b border-border bg-canvas',
          /*
           * **Flow-neutral.** The bar shrinks 16px and its bottom margin grows 16px, on the same
           * token and the same curve, so its footprint in the document is 72px at every frame. Phase
           * 30 measured the old version — height only — moving `<main>` on every return to the top
           * (0.010 CLS a time at 375) and making scroll anchoring snap any scroll of 1–16px back to
           * 0. The margin is empty space under a stuck bar; nothing is drawn there.
           */
          'transition-[margin] duration-(--duration-base) ease-entrance',
          compact && 'mb-4',
        )}
      >
        <div
          className={cn(
            'relative mx-auto flex w-full max-w-page items-center gap-m',
            'px-[clamp(1.25rem,4vw,4rem)]',
            'h-18 transition-[height] duration-(--duration-base) ease-entrance',
            compact && 'h-14',
          )}
        >
          <div className="flex items-center gap-m lg:hidden">
            <MobileNav items={items} />
          </div>

          <Brand settings={settings} />

          <DesktopNav items={items} className="ml-l hidden lg:block" />

          <div className="ml-auto flex items-center gap-1">
            {/*
              44px on a touch screen, like the bag beside it — except below 360px. At 320-345px a
              44px Search, a 44px bag and the centred wordmark do not fit: Search slides under the
              wordmark and a tap on its edge goes home. Measured by sweep 2; 36px still passes
              WCAG 2.5.8 with room to spare there.
            */}
            <SearchTrigger className="min-[360px]:pointer-coarse:size-11" />

            <IconButton
              label={utilityNav.wishlist.label}
              size="sm"
              asChild
              className="hidden pointer-coarse:size-11 lg:inline-flex"
            >
              <Link href={utilityNav.wishlist.href} variant="unstyled">
                <Heart aria-hidden />
              </Link>
            </IconButton>

            <IconButton
              label={utilityNav.account.label}
              size="sm"
              asChild
              className="hidden pointer-coarse:size-11 lg:inline-flex"
            >
              <Link href={utilityNav.account.href} variant="unstyled">
                <User aria-hidden />
              </Link>
            </IconButton>

            {/*
              `max-lg:-mr-2` mirrors the menu button's `-ml-2`. Sweep 1 made this 44px on phones,
              which pushed Search 8px left — under the absolutely centred wordmark at 320-329px, where a
              tap on Search's left edge went to the home link. The offset puts it back, and gives the
              bag the same 12px inset from the edge the menu has.
            */}
            <CartTrigger className="max-lg:-mr-2" count={cartCount} />
          </div>
        </div>
      </header>
    </>
  )
}

/**
 * The mark.
 *
 * Set in the display serif with wide tracking and rendered as **type** rather than an image, so it
 * inherits the type system and stays crisp at every density — guide §03 lists "NORTH / 01" itself as
 * a display use. Site Settings can override it with an uploaded logo, which is what its own field
 * description promises: *"Falls back to the wordmark when empty."*
 *
 * The uploaded case goes through `MediaImage` like every other asset in the application (**D-29**).
 * `h-6 w-auto` against the reserved aspect ratio is what turns a component built for fluid editorial
 * imagery into a fixed-height mark: the ratio is known, the height is fixed, so the width follows —
 * and the bar cannot be pushed around by whatever an editor uploads. `object-contain`, because a
 * logo that has been cropped to fill is a logo with its ends cut off.
 */
function Brand({ settings }: { settings: ShellSettings }) {
  return (
    <Link
      href="/"
      variant="quiet"
      aria-label={`${settings.siteName} — home`}
      className={cn(
        'font-display text-heading-s uppercase tracking-[0.18em] text-foreground',
        'hover:no-underline',
        // Centred on mobile between the menu button and the two utilities.
        'absolute left-1/2 -translate-x-1/2 lg:static lg:left-auto lg:translate-x-0',
      )}
    >
      {settings.logo ? (
        <MediaImage
          media={settings.logo}
          context="editorial"
          sizes="200px"
          alt={settings.siteName}
          className="h-6 w-auto"
          imageClassName="object-contain"
        />
      ) : (
        settings.siteName
      )}
    </Link>
  )
}
