'use client'

import { Menu } from 'lucide-react'
import { useState } from 'react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from '@/components/ui/drawer'
import { IconButton } from '@/components/ui/icon-button'
import { Link } from '@/components/ui/link'
import { Separator } from '@/components/ui/separator'
import type { NavItem } from '@/components/layout/navigation'
import { utilityNav } from '@/components/layout/navigation'
import { cn } from '@/lib/cn'

/**
 * MobileNav — plan §9.1c: "a drawer with hierarchical expansion".
 *
 * Its requirement list is met as follows, and most of it is Radix's rather than ours:
 *
 *   - **No accidental navigation while expanding** — the group header is an accordion
 *     trigger, not a link. Tapping "SHOP" opens the group; it never navigates. The
 *     landing page for the group is an explicit "All Shop" item inside it.
 *   - **Back button for nested groups** — the accordion is self-collapsing, so there is
 *     no stack to go back through. One level, always visible, nothing to get lost in.
 *   - **Close control** — the drawer's own, plus Escape.
 *   - **Escape · focus trap · focus restoration · scroll containment** — Radix Dialog,
 *     via `Drawer`.
 *   - **`aria-expanded`** — Radix Accordion, on each group trigger.
 *
 * The drawer closes on navigation: `open` is controlled, and every link inside is
 * wrapped in `DrawerClose asChild` so a tap dismisses the panel and returns focus to the
 * trigger rather than leaving it open over the new page.
 *
 * Guide §10: "quiet, monochrome, highly legible, minimal visual clutter."
 */
export function MobileNav({ items, className }: { items: NavItem[]; className?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <IconButton label="Open menu" className={cn('-ml-2', className)}>
          <Menu aria-hidden />
        </IconButton>
      </DrawerTrigger>

      <DrawerContent side="left" title="Menu" className="max-w-sm">
        <Accordion type="single" collapsible className="px-m">
          {items.map((item) =>
            item.children ? (
              <AccordionItem key={item.href} value={item.href}>
                <AccordionTrigger>{item.label}</AccordionTrigger>
                <AccordionContent className="pb-m">
                  <ul className="flex flex-col gap-s pl-3">
                    {item.children.map((child) => (
                      <li key={child.href}>
                        <DrawerClose asChild>
                          <Link href={child.href} variant="quiet" className="text-body-sm">
                            {child.label}
                          </Link>
                        </DrawerClose>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ) : (
              // A group with no children is a destination, so here the row *is* a link.
              <div key={item.href} className="border-b border-border">
                <DrawerClose asChild>
                  <Link
                    href={item.href}
                    variant="meta"
                    className="flex items-center py-m hover:no-underline"
                  >
                    {item.label}
                  </Link>
                </DrawerClose>
              </div>
            ),
          )}
        </Accordion>

        <Separator className="my-m" />

        {/* Structure doc §3: "Account and wishlist remain accessible from the mobile
            navigation" — they are not in the mobile header bar, so they live here. */}
        <ul className="flex flex-col gap-s px-m pb-l">
          {[utilityNav.account, utilityNav.wishlist].map((entry) => (
            <li key={entry.href}>
              <DrawerClose asChild>
                <Link href={entry.href} variant="quiet" className="text-body-sm">
                  {entry.label}
                </Link>
              </DrawerClose>
            </li>
          ))}
        </ul>
      </DrawerContent>
    </Drawer>
  )
}
