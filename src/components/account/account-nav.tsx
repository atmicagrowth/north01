'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { Link } from '@/components/ui/link'
import { cn } from '@/lib/cn'
import { ACCOUNT_ROUTES, isCurrentAccountRoute } from '@/lib/account/navigation'

/**
 * **The account navigation** — plan §20.1d: *"mobile account navigation must remain simple."*
 *
 * Five text links. On a phone they scroll horizontally rather than wrapping into two ragged rows or
 * collapsing into a menu — a five-item menu costs a tap to reveal what fits on the screen anyway.
 *
 * A `<nav>` with an accessible name, because this is the second navigation landmark on the page and
 * an unnamed one is indistinguishable from the header's in a landmark list. `aria-current="page"` is
 * what carries the state to a screen reader; the underline is for everyone else.
 *
 * A client component for exactly one reason — `usePathname`. It renders no state of its own.
 */
export function AccountNav() {
  const pathname = usePathname()
  const list = useRef<HTMLUListElement>(null)

  /*
   * **The tab you are on is in view.** On a phone this row is ~500px of tabs in a 280px box, and it
   * always loaded at `scrollLeft` 0 — so on Addresses or Settings at 320px the only "you are here"
   * cue, the underline, was off-screen and nothing said the row scrolls. The row is moved, never the
   * window: `scrollIntoView` would also scroll the page vertically to reach it.
   */
  useEffect(() => {
    const row = list.current
    const current = row?.querySelector<HTMLElement>('[aria-current="page"]')

    if (!row || !current) return

    const offset = current.getBoundingClientRect().left - row.getBoundingClientRect().left

    if (offset < 0 || offset + current.offsetWidth > row.clientWidth) row.scrollLeft += offset
  }, [pathname])

  return (
    <nav aria-label="Account" className="border-b border-border">
      <ul className="-mb-px flex gap-l overflow-x-auto" ref={list}>
        {ACCOUNT_ROUTES.map((route) => {
          const current = isCurrentAccountRoute(route.href, pathname)

          return (
            <li key={route.href}>
              <Link
                aria-current={current ? 'page' : undefined}
                className={cn(
                  /* `min-h-11 items-end`: a 44px tab with the label still sitting on its underline. */
                  'flex min-h-11 items-end whitespace-nowrap border-b-2 pb-3 font-sans text-meta uppercase transition-colors',
                  current
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-foreground-muted hover:text-foreground',
                )}
                href={route.href}
                variant="unstyled"
              >
                {route.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
