'use client'

import { Search } from 'lucide-react'

import {
  OVERLAY_PANEL_ID,
  overlayTriggerProps,
  useShellOverlay,
} from '@/components/shell/overlay-context'
import { SearchPanel } from '@/components/shell/search-panel'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'

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
 * **Phase 12 has now replaced that body**, and nothing else here changed: the trigger, the state
 * machine, the focus handling and the close behaviour are Phase 9's, untouched. **DEV-37 is closed.**
 *
 * Two corrections to what that deviation assumed, both worth recording:
 *
 * - The panel no longer takes `items`. It fetches on open, which keeps this component's signature
 *   unchanged — and the signature matters, because `SearchOverlay` is mounted **twice**: here and in
 *   `global-not-found.tsx`, which renders its own `<html>` outside the route group. A new prop would
 *   have to be supplied in both places or the 404 page's panel would silently lose a section.
 * - `overlay-context.tsx` closes on a **pathname** change, so a query-only navigation does not close
 *   it. The old panel hid that by wrapping every link in `<DialogClose>`; the new one navigates
 *   programmatically and calls `close()` itself.
 */
export function SearchOverlay() {
  const { isOpen, setOpen, handleCloseAutoFocus } = useShellOverlay()

  return (
    <Dialog open={isOpen('search')} onOpenChange={(next) => setOpen('search', next)}>
      <DialogContent
        id={OVERLAY_PANEL_ID.search}
        title="Search"
        onCloseAutoFocus={handleCloseAutoFocus}
        /*
         * **Focus the field, not Close.** Radix focuses the first tabbable element, and DialogContent
         * renders its Close before its children — so a customer who opened search and started typing
         * typed into nothing. Sweep 2 measured it at 320, 375 and 1440. The id is fixed in
         * `search-panel.tsx`, which is what keeps this component's signature unchanged for its
         * second mount in `global-not-found.tsx`.
         */
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          document.getElementById('site-search')?.focus()
        }}
        /*
         * Top-anchored rather than centred. A search surface belongs under the control that opened
         * it — the customer's eye is already at the top of the page — and a centred box would put
         * the panel where the page content was. `max-w-measure` keeps it to a reading width.
         */
        className="top-[12vh] max-w-measure translate-y-0"
      >
        <SearchPanel />
      </DialogContent>
    </Dialog>
  )
}

/** The header control. Separate so the bar can place it without knowing what it opens. */
export function SearchTrigger({ className }: { className?: string }) {
  const { isOpen, registerTrigger, setOpen } = useShellOverlay()

  return (
    <IconButton
      label="Search"
      size="sm"
      className={className}
      {...overlayTriggerProps('search', isOpen('search'))}
      onClick={(event) => {
        registerTrigger(event.currentTarget)
        setOpen('search', true)
      }}
    >
      <Search aria-hidden />
    </IconButton>
  )
}
