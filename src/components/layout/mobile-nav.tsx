'use client'

import { Menu } from 'lucide-react'
import { usePathname } from 'next/navigation'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { OVERLAY_PANEL_ID, useShellOverlay } from '@/components/shell/overlay-context'
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from '@/components/ui/drawer'
import { IconButton } from '@/components/ui/icon-button'
import { Link, NewTabHint } from '@/components/ui/link'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/cn'
import type { ShellNavItem } from '@/lib/navigation/resolve'
import { utilityNav } from '@/lib/navigation/utility'

/**
 * MobileNav — plan §9.1c: *"a drawer with hierarchical expansion."*
 *
 * Its requirement list is met as follows, and most of it is Radix's rather than ours:
 *
 *   - **No accidental navigation while expanding** — the group header is an accordion trigger, not
 *     a link. Tapping SHOP opens the group; it never navigates. The landing page for the group is
 *     an explicit **All Shop** row inside it, which is also what the desktop panel does.
 *   - **Back button for nested groups** — see below. There are no nested groups.
 *   - **Close control** — the drawer's own, plus Escape.
 *   - **Escape · focus trap · focus restoration · scroll containment** — Radix Dialog, via `Drawer`.
 *   - **`aria-expanded`** — Radix Accordion, on each group trigger.
 *
 * ### The back button, and why there is none
 *
 * §9.1c asks for *"a back button for nested groups"*, and this drawer has no back button because it
 * has no nested groups: the accordion is one level deep and self-collapsing, so there is no stack to
 * pop and nowhere to be lost. A panel-sliding drawer would satisfy the letter of that bullet by
 * first manufacturing the problem it solves — the customer would lose sight of the other five
 * destinations to read four category links.
 *
 * The CMS shape settles it rather than taste: a primary item holds *columns of links*, and a column
 * is a heading, not a destination. There is no third level in the schema to nest. If a later phase
 * adds one, the back control comes with it. Recorded as **DEV-36**.
 *
 * The drawer closes on navigation — `open` is owned by the shell's overlay state machine, and every
 * link inside is wrapped in `DrawerClose` so a tap dismisses the panel and returns focus to the
 * trigger rather than leaving it open over the new page.
 *
 * Guide §10: *"quiet, monochrome, highly legible, minimal visual clutter."*
 */
export function MobileNav({ items, className }: { items: ShellNavItem[]; className?: string }) {
  const pathname = usePathname()
  const { isOpen, registerTrigger, setOpen, handleCloseAutoFocus } = useShellOverlay()

  return (
    <Drawer open={isOpen('menu')} onOpenChange={(next) => setOpen('menu', next)}>
      <DrawerTrigger asChild>
        <IconButton
          label="Open menu"
          className={cn('-ml-2', className)}
          onClick={(event) => registerTrigger(event.currentTarget)}
        >
          <Menu aria-hidden />
        </IconButton>
      </DrawerTrigger>

      <DrawerContent
        id={OVERLAY_PANEL_ID.menu}
        side="left"
        title="Menu"
        className="max-w-panel"
        onCloseAutoFocus={handleCloseAutoFocus}
      >
        {/* Not "Primary" — the desktop row already claims that name, and two navigation landmarks
            called the same thing are indistinguishable in a landmark list. */}
        <nav aria-label="Site" className="px-m">
          {items.length === 0 ? (
            <p className="py-m font-sans text-body-sm text-foreground-muted">
              Navigation is unavailable.
            </p>
          ) : (
            <Accordion type="single" collapsible>
              {items.map((item, index) => {
                const current = pathname === item.href || pathname.startsWith(`${item.href}/`)

                return item.columns.length > 0 ? (
                  // Position, not href — see the note in `desktop-nav.tsx`. Two items sharing a
                  // URL shared one accordion value, so opening either expanded both.
                  <AccordionItem key={index} value={String(index)}>
                    <AccordionTrigger
                      aria-current={current ? 'page' : undefined}
                      className={cn(current && 'text-foreground')}
                    >
                      {item.label}
                    </AccordionTrigger>

                    <AccordionContent className="pb-m">
                      {/* Links are 44px tall (WCAG 2.5.8 comfortably); the gaps shrank to match. */}
                      <ul className="flex flex-col pl-3">
                        <li>
                          <DrawerClose asChild>
                            <Link
                              href={item.href}
                              variant="quiet"
                              className="flex min-h-11 items-center text-body-sm"
                            >
                              All {item.label}
                            </Link>
                          </DrawerClose>
                        </li>

                        {item.columns.map((column, columnIndex) => (
                          <li key={columnIndex}>
                            {column.heading ? (
                              <p className="mt-m font-sans text-micro uppercase text-foreground-muted">
                                {column.heading}
                              </p>
                            ) : null}

                            <ul className="flex flex-col">
                              {column.links.map((link, linkIndex) => (
                                <li key={linkIndex}>
                                  <DrawerClose asChild>
                                    <Link
                                      href={link.href}
                                      variant="quiet"
                                      external={link.external}
                                      className="flex min-h-11 items-center text-body-sm"
                                    >
                                      {link.label}
                                      {link.external ? <NewTabHint /> : null}
                                    </Link>
                                  </DrawerClose>
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                ) : (
                  // A group with no columns is a destination, so here the row *is* a link.
                  <div key={index} className="border-b border-border">
                    <DrawerClose asChild>
                      <Link
                        href={item.href}
                        variant="meta"
                        external={item.external}
                        aria-current={current ? 'page' : undefined}
                        className={cn(
                          'flex items-center py-m hover:no-underline',
                          current && 'text-foreground',
                        )}
                      >
                        {item.label}
                        {item.external ? <NewTabHint /> : null}
                      </Link>
                    </DrawerClose>
                  </div>
                )
              })}
            </Accordion>
          )}
        </nav>

        <Separator className="my-m" />

        {/* Structure doc §3: "Account and wishlist remain accessible from the mobile navigation" —
            they are not in the mobile header bar, so they live here. */}
        <ul className="flex flex-col px-m pb-l">
          {[utilityNav.account, utilityNav.wishlist].map((entry) => (
            <li key={entry.href}>
              <DrawerClose asChild>
                <Link
                  href={entry.href}
                  variant="quiet"
                  className="flex min-h-11 items-center text-body-sm"
                >
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
