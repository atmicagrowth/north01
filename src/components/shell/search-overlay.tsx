'use client'

import { Search } from 'lucide-react'

import { useShellOverlay } from '@/components/shell/overlay-context'
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Link, NewTabHint } from '@/components/ui/link'
import { cn } from '@/lib/cn'
import type { ShellNavItem } from '@/lib/navigation/resolve'

/**
 * **The search overlay — its chrome, in the phase that owns the shell; its contents, in the phase
 * that owns search.**
 *
 * Plan §9's acceptance criterion names search among the three things a customer must be able to open
 * and close from any route, so the overlay is Phase 9's. What goes *inside* it is enumerated in
 * §12.1c — query input, suggested categories and collections, product suggestions, recent and
 * popular searches, view-all — and every one of those is an Algolia query. **Phase 12** builds them.
 *
 * ### Why there is no search box in here yet
 *
 * Because a search box that cannot search is precisely the thing plan §0.1.17 forbids: *"never
 * create fake UI for unsupported functionality."* A field that swallows a query, or one that submits
 * to a `/search` route no phase has built, is worse than no field — it costs the customer a typed
 * sentence and their attention before telling them nothing.
 *
 * So the panel states the situation in one line and spends the rest of its space on the thing it
 * *can* do, which is get the customer to the catalogue. That is the same instinct structure §12
 * applies to a genuine no-results state — *"offer category alternatives"* — and the same shape as
 * **DEV-25**, where the footer's newsletter column is a slot the phase that can post a form fills
 * in. Recorded as **DEV-37**.
 *
 * When Phase 12 arrives it replaces the body of `SearchPanel` and nothing else: the trigger, the
 * state machine, the focus handling and the close behaviour are already here and already verified.
 */
export function SearchOverlay({ items }: { items: ShellNavItem[] }) {
  const { isOpen, setOpen, handleCloseAutoFocus } = useShellOverlay()

  return (
    <Dialog open={isOpen('search')} onOpenChange={(next) => setOpen('search', next)}>
      <DialogContent
        title="Search"
        onCloseAutoFocus={handleCloseAutoFocus}
        /*
         * Top-anchored rather than centred. A search surface belongs under the control that opened
         * it — the customer's eye is already at the top of the page — and a centred box would put
         * the panel where the page content was. `max-w-measure` keeps it to a reading width.
         */
        className="top-[12vh] max-w-measure translate-y-0"
      >
        <SearchPanel items={items} />
      </DialogContent>
    </Dialog>
  )
}

function SearchPanel({ items }: { items: ShellNavItem[] }) {
  return (
    <div className="flex flex-col gap-l">
      <p className="max-w-measure font-sans text-body-sm text-foreground-muted">
        Search is not open yet — it arrives with the catalogue. Everything in the shop is reachable
        from here in the meantime.
      </p>

      {items.length > 0 ? (
        <nav aria-label="Browse">
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.href} className="border-t border-border last:border-b">
                <DialogClose asChild>
                  <Link
                    href={item.href}
                    variant="unstyled"
                    external={item.external}
                    className={cn(
                      'flex items-center justify-between gap-m py-m',
                      'font-sans text-meta uppercase text-foreground-muted',
                      'transition-colors duration-(--duration-fast) ease-entrance',
                      'hover:text-foreground',
                    )}
                  >
                    {item.label}
                    {item.external ? <NewTabHint /> : null}
                  </Link>
                </DialogClose>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  )
}

/** The header control. Separate so the bar can place it without knowing what it opens. */
export function SearchTrigger({ className }: { className?: string }) {
  const { registerTrigger, setOpen } = useShellOverlay()

  return (
    <IconButton
      label="Search"
      size="sm"
      className={className}
      onClick={(event) => {
        registerTrigger(event.currentTarget)
        setOpen('search', true)
      }}
    >
      <Search aria-hidden />
    </IconButton>
  )
}
