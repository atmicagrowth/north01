'use client'

import { ShoppingBag } from 'lucide-react'

import { CartLineRow } from '@/components/cart/cart-lines'
import { CartSummary } from '@/components/cart/cart-summary'
import { ProductCard } from '@/components/catalog/product-card'
import {
  OVERLAY_PANEL_ID,
  overlayTriggerProps,
  useShellOverlay,
} from '@/components/shell/overlay-context'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'
import type { CartView } from '@/lib/cart/cart'
import { cn } from '@/lib/cn'
import { CART_COPY } from '@/lib/cart/rules'
import { DEFAULT_CURRENCY } from '@/payload/fields/money'
import type { ShellNavItem } from '@/lib/navigation/resolve'

/**
 * **The global bag drawer** — plan §9.1d: *"Global cart drawer must work from every page."*
 *
 * It is mounted once, in the root layout, so it does work from every page; and it is the second half
 * of the acceptance criterion, which asks that search, the mobile menu and the cart all open and
 * close from any major route without conflicting. Its `open` state is the shell's one state machine,
 * so opening the bag closes the menu and vice versa, by construction rather than by coordination.
 *
 * ### What Phase 14 filled in, and what is still missing on purpose
 *
 * Phase 9 shipped this as an empty-state panel and said so plainly: *"nothing in this application can
 * put a line in a bag yet."* Now it can. §14.1e's list is here — items, variant labels, quantity
 * controls, remove, the shipping-progress message, recommendations — with one exception.
 *
 * **There is no Checkout button.** Checkout is **Phase 17**, and a control labelled *Checkout* that
 * leads to a route which does not exist is the same fake UI Phase 13 refused to draw for Add to Bag.
 * The pinned action is **View bag**, which goes to `/cart` — a page this phase builds and which is
 * where checkout will be reached from. Recorded as **DEV-57**.
 *
 * ### The bag is passed in, not fetched here
 *
 * `CartView` is read on the server, in the layout, and handed down. A client component fetching its
 * own bag would need a route handler, which is a second door onto the cart that
 * `lib/cart/cart.ts` exists to avoid — and it would render an empty drawer on first paint on every
 * page load. The trade is that the drawer's contents are as fresh as the last server render, which is
 * exactly what `revalidatePath` in the actions guarantees after every mutation.
 */
export function CartDrawer({ cart, items }: { cart: CartView | null; items: ShellNavItem[] }) {
  const { close, isOpen, setOpen, handleCloseAutoFocus } = useShellOverlay()

  /*
   * Where "keep shopping" goes. The first primary destination the editor arranged is the shop's own
   * front door far more often than not, and deriving it beats hard-coding `/shop` into a component
   * that is otherwise entirely CMS-driven. With an empty navigation the button is simply absent.
   */
  const browse = items[0] ?? null
  const lines = cart?.lines ?? []

  /* The bag's own currency where there is a bag, and the shop's default where there is not. */
  const currency = cart?.currency ?? DEFAULT_CURRENCY

  return (
    <Drawer open={isOpen('cart')} onOpenChange={(next) => setOpen('cart', next)}>
      <DrawerContent
        id={OVERLAY_PANEL_ID.cart}
        side="right"
        title="Bag"
        onCloseAutoFocus={handleCloseAutoFocus}
        footer={
          lines.length > 0 && cart ? (
            <div className="flex flex-col gap-m">
              {/*
                **DEV-57 paid.** Phase 14 pinned "View bag" because `/checkout` did not exist. Both
                are here now, with Checkout as the primary action — a drawer that can only send you
                to another page to find the button is a drawer with one job it does not do.
              */}
              <div className="flex flex-col gap-s">
                <Button asChild size="lg" onClick={close}>
                  <Link href="/checkout" variant="unstyled">
                    Checkout
                  </Link>
                </Button>

                <Button asChild onClick={close} variant="secondary">
                  <Link href="/cart" variant="unstyled">
                    View bag
                  </Link>
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        {lines.length === 0 ? (
          <div className="flex flex-col items-start gap-m px-m py-xl">
            <p className="font-display text-heading-m text-foreground">{CART_COPY.empty}</p>

            <p className="max-w-measure font-sans text-body-sm text-foreground-muted">
              {CART_COPY.emptyDetail}
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

            {cart && cart.recommendations.length > 0 ? (
              <div className="mt-l w-full">
                <p className="mb-m font-sans text-meta uppercase text-foreground-muted">
                  Popular right now
                </p>

                <ul className="grid grid-cols-2 gap-m">
                  {cart.recommendations.slice(0, 2).map((card) => (
                    <li key={card.id} onClick={close}>
                      <ProductCard card={card} sizes="150px" />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="px-m py-m">
            {cart?.drifted ? (
              <p
                className="mb-m rounded-sm border border-border bg-surface px-m py-2 font-sans text-body-sm text-foreground-muted"
                role="status"
              >
                {CART_COPY.revalidated}
              </p>
            ) : null}

            <ul className="divide-y divide-border">
              {lines.map((line) => (
                <CartLineRow compact currency={currency} key={line.id} line={line} />
              ))}
            </ul>

            {/*
              **The summary scrolls with the lines; only the two actions are pinned.** It sat in the
              pinned footer, which measured 332px — at 320x568 that left 157px for the lines (one and a
              bit), and in landscape on a phone it left **none**, with Checkout pushed below the fold.
              A drawer that shows the total and hides the bag is the wrong way round. Now the footer is
              the two buttons, and the total is the last thing in the list it totals.
            */}
            {cart ? (
              <div className="mt-m">
                <CartSummary
                  currency={cart.currency}
                  discount={cart.discount}
                  locale={cart.locale}
                  shipping={cart.shipping}
                  shippingQuote={cart.shippingQuote}
                  tax={cart.tax}
                  totals={cart.totals}
                />
              </div>
            ) : null}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  )
}

/** The header control. Separate so the bar can place it without knowing what it opens. */
export function CartTrigger({ className, count }: { className?: string; count: number }) {
  const { isOpen, registerTrigger, setOpen } = useShellOverlay()

  return (
    <IconButton
      label={count === 0 ? 'Bag' : `Bag, ${count} ${count === 1 ? 'item' : 'items'}`}
      size="sm"
      /*
       * `relative` is load-bearing, not decoration. `IconButton` does not position itself, so the
       * badge's `absolute` resolved against an ancestor far up the tree and rendered against the
       * DOCUMENT's right edge — two pixels past the viewport, producing a horizontal scrollbar on
       * every page of the site. Found by measuring the bag page at seven widths; invisible in a
       * screenshot, because two pixels of white look like nothing at all.
       */
      className={cn('relative max-lg:size-11', className)}
      {...overlayTriggerProps('cart', isOpen('cart'))}
      onClick={(event) => {
        registerTrigger(event.currentTarget)
        setOpen('cart', true)
      }}
    >
      <ShoppingBag aria-hidden />

      {/*
        Phase 9 declined a badge because it could only ever have read "0". It can be a number now.
        It is `aria-hidden` because the count is already in the button's accessible name, and a
        screen reader announcing "Bag, 3 items — 3" is the same fact twice.
      */}
      {count > 0 ? (
        <span
          aria-hidden
          className="absolute right-0 top-0 min-w-4 rounded-full bg-foreground px-1 text-center font-sans text-[0.625rem] leading-4 text-canvas"
          data-slot="cart-count"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </IconButton>
  )
}
