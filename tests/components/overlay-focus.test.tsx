/**
 * **Where focus goes when a shell overlay closes** — `components/shell/overlay-context.tsx`.
 *
 * The context exists because Radix's modal dialog restores focus to a `Dialog.Trigger` that these
 * overlays do not have, and focus fell to `<body>` — WCAG 2.4.3, found by driving a browser in
 * Phase 9. Each trigger registers itself instead, and the handler focuses it.
 *
 * Sweep 2 of the demonstration notice found the same failure one step further on: a trigger that is
 * **gone** by the time the overlay closes. `editorial/hotspot.tsx` registers its own *Add* button and
 * then opens the bag, and that button lives in a non-modal popover which dismisses itself as soon as
 * the drawer takes focus; the mobile menu's trigger is hidden above `lg` if the window is widened
 * while the menu is open. `focus()` on a detached or unrendered element is a silent no-op.
 *
 * So both halves are asserted here: a live trigger gets focus back, and a trigger that has left the
 * document hands it to `<main>` instead of dropping it.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { ShellOverlayProvider, useShellOverlay } from '@/components/shell/overlay-context'
import { Drawer, DrawerContent } from '@/components/ui/drawer'

/**
 * The bag drawer's own wiring, minus its data layer: `Drawer` + `DrawerContent` with the context's
 * `handleCloseAutoFocus`, which is exactly what `shell/cart-drawer.tsx`, `shell/search-overlay.tsx`
 * and `layout/mobile-nav.tsx` each pass. Mounting the real drawer here would drag the bag's
 * `'use server'` modules and the Payload client into jsdom without adding anything to assert.
 */
function Overlay() {
  const { handleCloseAutoFocus, isOpen, setOpen } = useShellOverlay()

  return (
    <Drawer onOpenChange={(next) => setOpen('cart', next)} open={isOpen('cart')}>
      <DrawerContent onCloseAutoFocus={handleCloseAutoFocus} side="right" title="Bag" />
    </Drawer>
  )
}

/** A trigger that opens the bag and can be taken out of the document, as the hotspot's is. */
function BagTrigger({ vanishes }: { vanishes: boolean }) {
  const { registerTrigger, setOpen } = useShellOverlay()
  const [gone, setGone] = useState(false)

  if (gone) {
    return null
  }

  return (
    <button
      onClick={(event) => {
        registerTrigger(event.currentTarget)
        setOpen('cart', true)

        if (vanishes) {
          setGone(true)
        }
      }}
      type="button"
    >
      Add M
    </button>
  )
}

function mount(vanishes: boolean) {
  return render(
    <ShellOverlayProvider>
      <main id="main-content" tabIndex={-1}>
        <BagTrigger vanishes={vanishes} />
      </main>

      <Overlay />
    </ShellOverlayProvider>,
  )
}

async function openThenClose(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add M' }))
  await screen.findByRole('dialog', { name: 'Bag' })

  await user.click(screen.getAllByRole('button', { name: 'Close' })[0])
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bag' })).not.toBeInTheDocument())
}

describe('the shell overlays’ focus restoration', () => {
  it('returns focus to the control that opened the overlay', async () => {
    const user = userEvent.setup()
    mount(false)

    await openThenClose(user)

    expect(screen.getByRole('button', { name: 'Add M' })).toHaveFocus()
  })

  it('hands focus to the page when that control has left the document, instead of dropping it', async () => {
    const user = userEvent.setup()
    mount(true)

    await openThenClose(user)

    expect(document.getElementById('main-content')).toHaveFocus()
    expect(document.body).not.toHaveFocus()
  })
})
