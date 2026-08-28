'use client'

import { ShoppingBag } from 'lucide-react'

import { useShellOverlay } from '@/components/shell/overlay-context'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'
import type { ShellNavItem } from '@/lib/navigation/resolve'

/**
 * **The global bag drawer** — plan §9.1d: *"Global cart drawer must work from every page."*
 *
 * It is mounted once, in the root layout, so it does work from every page; and it is the second half
 * of the acceptance criterion, which asks that search, the mobile menu and the cart all open and
 * close from any major route without conflicting. Its `open` state is the shell's one state machine,
 * so opening the bag closes the menu and vice versa, by construction rather than by coordination.
 *
 * ### What it shows today, and why that is not a stub
 *
 * The bag is empty, and it says so. That is a true statement rather than a placeholder: **nothing in
 * this application can put a line in a bag yet.** There is no product page (Phase 13), no add-to-bag
 * control, and no cart service (Phase 14) — so every visitor's bag is empty, and an empty-state
 * panel is the complete and correct rendering of that.
 *
 * What is deliberately **not** here is the rest of §14.1e's list — line items, quantity steppers,
 * remove controls, the shipping-progress message, recommendations, a checkout call to action.
 * Drawing any of them now would be plan §0.1.17's fake UI: a quantity control that changes nothing,
 * a subtotal that is not a subtotal, and a **Checkout** button leading to a route Phase 17 has not
 * built. The `Drawer` primitive already carries a pinned `footer` slot for exactly those, and it is
 * left empty until there is something true to put in it.
 *
 * There is no count badge on the trigger for the same reason. A badge reading "0" on every page of
 * the site is noise; a badge is added by the phase that can make it a number.
 */
export function CartDrawer({ items }: { items: ShellNavItem[] }) {
  const { close, isOpen, setOpen, handleCloseAutoFocus } = useShellOverlay()

  /*
   * Where "keep shopping" goes. The first primary destination the editor arranged is the shop's own
   * front door far more often than not, and deriving it beats hard-coding `/shop` into a component
   * that is otherwise entirely CMS-driven. With an empty navigation the button is simply absent.
   */
  const browse = items[0] ?? null

  return (
    <Drawer open={isOpen('cart')} onOpenChange={(next) => setOpen('cart', next)}>
      <DrawerContent side="right" title="Bag" onCloseAutoFocus={handleCloseAutoFocus}>
        <div className="flex h-full flex-col items-start justify-center gap-m px-m py-xl">
          <p className="font-display text-heading-m text-foreground">Your bag is empty.</p>

          <p className="max-w-measure font-sans text-body-sm text-foreground-muted">
            Nothing has been added yet.
          </p>

          {browse ? (
            /*
             * `close()` rather than a `DrawerClose` wrapper. `DrawerClose asChild` around
             * `Button asChild` around `Link` is three Radix Slots deep, and Phase 3's audit found
             * that stack is where `asChild` breaks quietly. A click handler does the same job in
             * one line — and it is also the case a route change would *not* cover, because
             * navigating to the page you are already on does not change the pathname.
             */
            <Button asChild variant="secondary" className="mt-m" onClick={close}>
              <Link href={browse.href} variant="unstyled">
                Continue shopping
              </Link>
            </Button>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

/** The header control. Separate so the bar can place it without knowing what it opens. */
export function CartTrigger({ className }: { className?: string }) {
  const { registerTrigger, setOpen } = useShellOverlay()

  return (
    <IconButton
      label="Bag"
      size="sm"
      className={className}
      onClick={(event) => {
        registerTrigger(event.currentTarget)
        setOpen('cart', true)
      }}
    >
      <ShoppingBag aria-hidden />
    </IconButton>
  )
}
