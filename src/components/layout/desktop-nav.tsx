'use client'

import { ArrowRight } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { NavigationMenu } from 'radix-ui'
import { useState } from 'react'

import { useShellOverlay } from '@/components/shell/overlay-context'
import { MediaImage } from '@/components/media/media-image'
import { Link, NewTabHint } from '@/components/ui/link'
import { cn } from '@/lib/cn'
import type { ShellNavItem } from '@/lib/navigation/resolve'

/**
 * DesktopNav — the primary row, and plan §9.1b's mega menu.
 *
 * Guide §03: uppercase, tracked, sans, quiet. Guide §06 for the panel: *"solid charcoal surfaces,
 * strong alignment, clear hierarchy, restrained motion, minimal shadowing."* §9.1b's own instruction
 * is the shortest one in the phase and the easiest to fail — **"Do not make it visually
 * overwhelming"** — so the panel is a row of text columns on one charcoal plane, with at most one
 * image, and nothing else.
 *
 * ### Built on Radix NavigationMenu, and why that specifically
 *
 * A mega menu is the one navigation pattern that has to answer to both a pointer and a keyboard at
 * once, and the two want opposite things: hover-to-open with a forgiving close delay, versus
 * roving-tabindex, Escape, and focus that stays where the user put it. Radix's NavigationMenu is the
 * primitive that already resolves that, and it also gives the `data-state` this design system
 * animates from (**D-13**: overlay motion is CSS driven by Radix's attributes, no animation
 * library).
 *
 * **The trigger is a button, not a link, and that is the §9.1c rule applied to the pointer.** The
 * mobile drawer's *"no accidental navigation while expanding"* is a statement about the
 * relationship between a group and its landing page, and it does not stop being true on a desktop.
 * SHOP opens the panel; **All Shop**, the first row inside it, is the way to `/shop`. One control,
 * one meaning.
 *
 * ### Current-page marking
 *
 * The **G-14** rule in its simplest form: the active item goes from Stone to Bone and gains a 1px
 * Bone rule beneath it — contrast and a hairline, no colour and no fill. `aria-current="page"`
 * carries the same information to assistive technology, so the state is never conveyed by appearance
 * alone. A section counts as current when the path is inside it, so `/shop/clothing` still marks
 * SHOP; exact matching would leave the customer with no indication of where they are anywhere below
 * a landing page.
 */

function isCurrentPath(pathname: string, href: string): boolean {
  if (href === '/') {
    return pathname === '/'
  }

  return pathname === href || pathname.startsWith(`${href}/`)
}

/*
 * The row is centred on the bar rather than stretched to its full height, and the current-page rule
 * is a hairline directly under the label.
 *
 * Stretching was the first version and it was wrong in a way only a browser showed: Radix's
 * NavigationMenu.Root renders `<nav>` → `<div style="position:relative">` → `<ul>`, and that
 * intermediate div has no height, so `h-full` on the list resolved against `auto` and the labels sat
 * against the top of a 72px bar while the wordmark sat on its centre line. Centring needs no height
 * chain to survive, and it puts the active rule under the word instead of at the bottom of the bar,
 * which reads as type rather than as a tab.
 */
const triggerClasses = [
  'flex items-center border-b border-transparent py-1',
  'font-sans text-meta uppercase text-foreground-muted no-underline',
  'rounded-sm transition-colors duration-(--duration-fast) ease-entrance',
  'hover:text-foreground data-[state=open]:text-foreground',
]

export function DesktopNav({ items, className }: { items: ShellNavItem[]; className?: string }) {
  const pathname = usePathname()
  const { open: overlay } = useShellOverlay()

  /*
   * Controlled, for one reason: the panel has no focus trap, so it is the only overlay in the shell
   * that a drawer can be opened *over*. Clearing the value when anything in the shell's state
   * machine opens is what keeps "one overlay at a time" true for the one overlay that is not in it.
   *
   * The second trigger is navigation: Radix closes the panel when a link inside it is selected, but
   * not when the route changes for any other reason — a browser back button, a link elsewhere on the
   * page, a redirect from a server action.
   *
   * Both are the render-body comparison rather than an effect, for the reason written out in
   * `overlay-context.tsx`: an effect repaints with the stale panel first, and the compiler's
   * `set-state-in-effect` rule rejects it.
   */
  const [value, setValue] = useState('')
  const [seen, setSeen] = useState({ overlay, pathname })

  if (seen.overlay !== overlay || seen.pathname !== pathname) {
    setSeen({ overlay, pathname })
    setValue('')
  }

  if (items.length === 0) {
    return null
  }

  return (
    <NavigationMenu.Root
      value={value}
      onValueChange={setValue}
      /*
       * 120ms in, 400ms grace. The guide asks for restrained motion, and an instant open on
       * pointer-over turns a mouse crossing the header into a strobe; a long grace period is what
       * lets someone move diagonally from SHOP down into its own panel without it shutting.
       */
      delayDuration={120}
      skipDelayDuration={400}
      aria-label="Primary"
      className={className}
    >
      <NavigationMenu.List className="flex items-center gap-l">
        {items.map((item, index) => {
          const current = isCurrentPath(pathname, item.href)
          const hasPanel = item.columns.length > 0 || item.feature !== null

          return (
            /*
             * Keyed and valued by **position**, not by href.
             *
             * Nothing stops an editor pointing two primary items at the same URL — "Shop" and
             * "Store" both at `/shop` is a perfectly ordinary thing to do — and the href was doing
             * two jobs it could not guarantee: React's reconciliation key, and Radix's identity for
             * which panel is open. Duplicate hrefs meant duplicate keys *and* two items sharing one
             * open state, so hovering either opened both. The list is a fixed CMS array with no
             * client-side insertion or reordering, which is exactly the case an index key is correct
             * for.
             */
            <NavigationMenu.Item key={index} value={String(index)} className="flex">
              {hasPanel ? (
                <>
                  <NavigationMenu.Trigger
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      triggerClasses,
                      current && 'border-border-strong text-foreground',
                    )}
                  >
                    {item.label}
                  </NavigationMenu.Trigger>

                  <NavigationMenu.Content
                    className={cn(
                      'absolute left-0 top-0 w-full',
                      'data-[motion=from-start]:animate-fade-in data-[motion=from-end]:animate-fade-in',
                      'data-[motion=to-start]:animate-fade-out data-[motion=to-end]:animate-fade-out',
                    )}
                  >
                    <MegaMenu item={item} pathname={pathname} />
                  </NavigationMenu.Content>
                </>
              ) : (
                <NavigationMenu.Link asChild active={current}>
                  <Link
                    href={item.href}
                    variant="unstyled"
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      triggerClasses,
                      current && 'border-border-strong text-foreground',
                    )}
                  >
                    {item.label}
                  </Link>
                </NavigationMenu.Link>
              )}
            </NavigationMenu.Item>
          )
        })}
      </NavigationMenu.List>

      {/*
        The panel is positioned against the header's inner container — which is `relative` — so it
        starts at the bottom of the bar and aligns to the same page grid as everything else. Radix
        publishes the measured height as a custom property; the transition is on `height` alone, so
        one panel becoming another is a settle rather than a jump.
      */}
      <div className="absolute left-0 top-full w-full">
        <NavigationMenu.Viewport
          className={cn(
            'relative w-full overflow-hidden',
            'h-(--radix-navigation-menu-viewport-height)',
            'border-b border-border bg-surface shadow-overlay',
            'transition-[height] duration-(--duration-base) ease-entrance',
            'data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out',
          )}
        />
      </div>
    </NavigationMenu.Root>
  )
}

/** One item's panel: its landing page, its columns, and at most one merchandising image. */
function MegaMenu({ item, pathname }: { item: ShellNavItem; pathname: string }) {
  return (
    <div className="flex gap-xl px-[clamp(1.25rem,4vw,4rem)] py-l">
      <div className="flex min-w-0 flex-1 flex-col gap-m">
        <NavigationMenu.Link asChild>
          <Link
            href={item.href}
            variant="meta"
            className="group inline-flex items-center gap-2 self-start text-foreground"
          >
            All {item.label}
            <ArrowRight
              aria-hidden
              className="size-3.5 transition-transform duration-(--duration-fast) ease-entrance group-hover:translate-x-0.5"
            />
          </Link>
        </NavigationMenu.Link>

        {item.columns.length > 0 ? (
          /*
           * A wrapping row of fixed-measure columns, not a grid of equal fractions. An equal-fraction
           * grid put two columns of four links each at the far ends of a 1440px bar, which is
           * §9.1b's "visually overwhelming" arriving through emptiness rather than through clutter.
           * A fixed measure packs them from the left and keeps the alignment guide §06 asks for
           * whether an editor writes one column or four.
           */
          <div className="flex flex-wrap gap-l">
            {item.columns.map((column, columnIndex) => (
              <div key={columnIndex} className="flex w-48 shrink-0 flex-col gap-s">
                {column.heading ? (
                  <p className="font-sans text-micro uppercase text-foreground-muted">
                    {column.heading}
                  </p>
                ) : null}

                <ul className="flex flex-col gap-s">
                  {column.links.map((link, linkIndex) => (
                    <li key={linkIndex}>
                      <NavigationMenu.Link asChild active={isCurrentPath(pathname, link.href)}>
                        <Link
                          href={link.href}
                          variant="quiet"
                          external={link.external}
                          aria-current={isCurrentPath(pathname, link.href) ? 'page' : undefined}
                          className="text-body-sm aria-[current=page]:text-foreground"
                        >
                          {link.label}
                          {link.external ? <NewTabHint /> : null}
                        </Link>
                      </NavigationMenu.Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {item.feature ? <FeaturePanel feature={item.feature} /> : null}
    </div>
  )
}

/**
 * The featured panel. `Navigation.ts` is explicit about what it is for — *"the mega menu is a
 * merchandising surface, not a sitemap"* — so it is a picture and one line, never a fifth column of
 * links.
 *
 * `productCard` is the delivery context: the 4:5 fill this system already defines for a
 * merchandising tile, which is exactly what this is. The reserved box comes from that context rather
 * than from the asset, so the panel's height is the same before the image loads, while it loads, and
 * if the record has no Cloudinary asset at all — the placeholder path §8.1d specifies, and the only
 * path the seeded catalogue can take today.
 */
function FeaturePanel({ feature }: { feature: NonNullable<ShellNavItem['feature']> }) {
  const body = (
    <>
      {feature.image ? (
        <MediaImage
          media={feature.image}
          context="productCard"
          sizes="18rem"
          /*
           * Decorative only when the surrounding link already carries the name. Without a link the
           * record's own author-written alt is the only description of the picture, and dropping it
           * would leave a screen-reader user with a caption and no idea what it captions.
           */
          alt={feature.link ? '' : undefined}
          className="w-full"
        />
      ) : null}

      {feature.caption ? (
        <p className="font-sans text-body-sm text-foreground-muted">{feature.caption}</p>
      ) : null}
    </>
  )

  return (
    <div className="hidden w-72 shrink-0 flex-col gap-m xl:flex">
      {feature.link ? (
        <NavigationMenu.Link asChild>
          <Link
            href={feature.link.href}
            variant="unstyled"
            external={feature.link.external}
            aria-label={feature.link.label}
            className="flex flex-col gap-m text-foreground-muted hover:text-foreground"
          >
            {body}
          </Link>
        </NavigationMenu.Link>
      ) : (
        body
      )}
    </div>
  )
}
