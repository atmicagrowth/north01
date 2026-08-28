'use client'

import { usePathname } from 'next/navigation'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * **One state machine for every overlay the shell owns.**
 *
 * Plan §9's acceptance criterion is a statement about *state*, not about appearance:
 *
 * > A user can open/close search, mobile menu, and cart from any major route without navigation
 * > state conflicts.
 *
 * and its prompt asks us to *"verify that opening one overlay closes conflicting overlays and
 * restores focus correctly."* The way to make that true is not to verify it afterwards — it is to
 * make a second open overlay unrepresentable. There is one variable, it holds at most one name, and
 * "open the cart" is the same operation as "close whatever else was open."
 *
 * ### The three things this owns
 *
 * **1. Mutual exclusion.** By construction, above.
 *
 * **2. Focus restoration, which this has to do itself.** `handleCloseAutoFocus` is what every
 * overlay in the shell passes to `onCloseAutoFocus`, and it exists because of a real defect found by
 * driving a browser rather than by reading the code.
 *
 * **Radix's modal dialog restores focus to `DialogTrigger`, and these overlays do not have one.** The
 * search and bag controls live in the header; their dialogs are mounted beside the footer, outside
 * every route's subtree, because §9.1d requires them to work from every page. So there is no
 * `Dialog.Trigger` in the tree, `context.triggerRef` is `null`, and `DialogContentModal`'s own
 * `onCloseAutoFocus` — which unconditionally calls `preventDefault()` and then focuses that null ref
 * — dropped focus to `document.body` every time. Silent, invisible in the markup, and a WCAG 2.4.3
 * failure: a keyboard user who pressed Escape was returned to the top of the document.
 *
 * The fix is to own the restore rather than to reshape the component tree around Radix's assumption.
 * Each trigger registers the element it was clicked on, and this handler always `preventDefault()`s —
 * which, through Radix's `composeEventHandlers`, also stops the internal handler that caused the
 * problem — and then focuses the registered control itself.
 *
 * The one case where it deliberately does **not** restore is a handoff: if another overlay is open by
 * the time this one finishes closing, the restore would land inside a fresh focus trap and fight it,
 * so focus is left where the new overlay put it.
 *
 * **3. Navigation.** Every overlay contains links. A drawer left open over the page it just
 * navigated to is the "navigation state conflict" the acceptance criterion names, so a change of
 * pathname closes everything. The individual `DrawerClose` wrappers do this too on the common path;
 * this is the one that also covers a link inside the search panel, a browser back button, and a
 * `redirect()` from a server action.
 *
 * The mega menu is not in this enum — it is Radix's own uncontrolled state inside `DesktopNav` — but
 * it *reads* this context and collapses when anything here opens. It is the one overlay that can be
 * open without a focus trap, so it is the one that could otherwise sit behind a drawer.
 */

export type ShellOverlay = 'cart' | 'menu' | 'search'

/**
 * The id each overlay's panel carries, so a trigger outside it can name it with `aria-controls`.
 *
 * Radix generates these itself and wires them up — but only between a `Dialog.Trigger` and a
 * `Dialog.Content` in the same subtree, which is precisely the arrangement these overlays cannot
 * have. Fixed strings are safe here because each overlay is mounted exactly once, in the root layout.
 */
export const OVERLAY_PANEL_ID: Record<ShellOverlay, string> = {
  cart: 'shell-cart-panel',
  menu: 'shell-menu-panel',
  search: 'shell-search-panel',
}

/**
 * The ARIA a `Dialog.Trigger` would have supplied, for the two triggers that cannot be one.
 *
 * Found by the Phase 9 audit, and it is the *same* defect as the focus restoration in this file's
 * main docblock — one root cause with two symptoms, of which only the first was fixed at the time.
 * A screen-reader user tabbing the header heard "Search, button" and "Bag, button": no indication
 * that either opens a dialog, and no indication of whether it is open. The mega menu announced both
 * correctly throughout, because it uses Radix's own `NavigationMenu.Trigger` — so the two broken
 * controls sat beside a working one, which is what made it invisible.
 *
 * **axe-core reports nothing here.** `aria-haspopup` is an enhancement rather than a violation, and
 * `aria-expanded` is not required on a plain button. Two clean automated sweeps had already passed
 * over this markup.
 *
 * `aria-controls` is emitted **only while the panel is open**, because Radix unmounts the content on
 * close and an `aria-controls` pointing at an id that is not in the document is an invalid attribute
 * value — a real axe violation, and a worse outcome than the omission it would be fixing.
 */
export function overlayTriggerProps(overlay: ShellOverlay, open: boolean) {
  return {
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': open,
    'aria-controls': open ? OVERLAY_PANEL_ID[overlay] : undefined,
  }
}

type ShellOverlayContextValue = {
  /** The overlay currently open, or `null`. At most one, always. */
  open: ShellOverlay | null
  isOpen: (overlay: ShellOverlay) => boolean
  /** Radix's `onOpenChange` shape, bound to one overlay. */
  setOpen: (overlay: ShellOverlay, next: boolean) => void
  close: () => void
  /** Called by a trigger with the element it was activated on, so focus can be returned to it. */
  registerTrigger: (element: HTMLElement | null) => void
  /** Pass straight to an overlay's `onCloseAutoFocus`. See the note above. */
  handleCloseAutoFocus: (event: Event) => void
}

const ShellOverlayContext = createContext<ShellOverlayContextValue | null>(null)

export function ShellOverlayProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState<ShellOverlay | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const pathname = usePathname()

  /*
   * Closing on navigation rather than on link click.
   *
   * This is React's *"adjusting state when a prop changes"* pattern — a comparison against the last
   * value seen, in the render body — and not an effect, deliberately. An effect would run *after*
   * the browser had already painted the new route with the old drawer still over it, and the React
   * Compiler's `set-state-in-effect` rule rejects it for exactly that reason. Setting state during
   * render of the same component makes React discard the in-progress output and re-render before
   * anything reaches the screen, so the overlay is never visible on a page it does not belong to.
   */
  const [seenPathname, setSeenPathname] = useState(pathname)

  if (seenPathname !== pathname) {
    setSeenPathname(pathname)
    setOpenState(null)
  }

  const setOpen = useCallback((overlay: ShellOverlay, next: boolean) => {
    setOpenState((current) => {
      if (next) {
        return overlay
      }

      // Only the overlay that owns the state may clear it. A late `onOpenChange(false)` from the
      // one that just closed must not shut the one that replaced it.
      return current === overlay ? null : current
    })
  }, [])

  const registerTrigger = useCallback((element: HTMLElement | null) => {
    trigger.current = element
  }, [])

  const handleCloseAutoFocus = useCallback(
    (event: Event) => {
      /*
       * Always. Radix's modal handler is composed after this one and is skipped once the event is
       * default-prevented — which is the point: it would focus a `Dialog.Trigger` that these
       * overlays do not have.
       */
      event.preventDefault()

      // A handoff: something else is already open and owns focus. Leave it alone.
      if (open !== null) {
        return
      }

      trigger.current?.focus()
    },
    [open],
  )

  const value = useMemo<ShellOverlayContextValue>(
    () => ({
      open,
      isOpen: (overlay) => open === overlay,
      setOpen,
      close: () => setOpenState(null),
      registerTrigger,
      handleCloseAutoFocus,
    }),
    [open, setOpen, registerTrigger, handleCloseAutoFocus],
  )

  return <ShellOverlayContext.Provider value={value}>{children}</ShellOverlayContext.Provider>
}

/**
 * Throws rather than returning a default.
 *
 * A trigger rendered outside the provider would silently do nothing when clicked — a control that
 * looks functional and is not, which is the one thing the plan is most explicit about. Failing at
 * the first render is louder and cheaper.
 */
export function useShellOverlay(): ShellOverlayContextValue {
  const context = useContext(ShellOverlayContext)

  if (!context) {
    throw new Error('useShellOverlay must be used inside <ShellOverlayProvider>.')
  }

  return context
}
