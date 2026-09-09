'use client'

import { usePathname } from 'next/navigation'

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

  return (
    <nav aria-label="Account" className="border-b border-border">
      <ul className="-mb-px flex gap-l overflow-x-auto">
        {ACCOUNT_ROUTES.map((route) => {
          const current = isCurrentAccountRoute(route.href, pathname)

          return (
            <li key={route.href}>
              <Link
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'block whitespace-nowrap border-b-2 pb-3 font-sans text-meta uppercase transition-colors',
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
