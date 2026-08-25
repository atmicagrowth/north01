'use client'

import { usePathname } from 'next/navigation'
import type { NavItem } from '@/components/layout/navigation'
import { Link } from '@/components/ui/link'
import { cn } from '@/lib/cn'

/**
 * DesktopNav — the six primary items. Guide §03: uppercase, tracked, sans, quiet.
 *
 * **Current-page marking is the G-14 rule in its simplest form.** The active item goes
 * from Stone to Bone and gains a 1px Bone rule beneath it — contrast and a hairline, no
 * colour and no fill. `aria-current="page"` carries the same information to assistive
 * technology, so the state is never conveyed by appearance alone.
 *
 * A section counts as current when the path is inside it, so `/shop/clothing` still
 * marks SHOP. Exact matching would leave the customer with no indication of where they
 * are anywhere below a landing page.
 *
 * The mega menu (plan §9.1b) is not here. This renders the row; Phase 9 adds the panel.
 */
export function DesktopNav({ items, className }: { items: NavItem[]; className?: string }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Primary" className={cn('h-full', className)}>
      <ul className="flex h-full items-stretch gap-l">
        {items.map((item) => {
          const isCurrent = pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <li key={item.href} className="flex items-stretch">
              <Link
                href={item.href}
                variant="meta"
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'flex items-center border-b border-transparent pt-px',
                  'transition-colors duration-(--duration-fast) ease-entrance',
                  isCurrent && 'border-border-strong text-foreground',
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
