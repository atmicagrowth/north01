/**
 * **The demonstration notice** — `components/shell/demo-notice.tsx`, **DEV-86**.
 *
 * What is worth asserting, in the order it matters:
 *
 * 1. **A first visit sees the owner's words**, in a dialog that is named and described, with focus
 *    already on Continue.
 * 2. **Only Continue closes it.** Escape and a click outside are refused.
 * 3. **Continue is remembered**: the key is written, and a browser that already has it never renders
 *    the dialog.
 * 4. **Focus is handed to the page, not dropped.** Radix would restore it to a trigger this dialog
 *    does not have, which is how `shell/overlay-context.tsx` describes losing focus to `<body>`.
 * 5. **Storage that throws does not trap the visitor**: Continue still closes the notice.
 *
 * The module is re-imported for each test rather than reset through an exported seam: the component
 * keeps an in-memory flag for the storage-throws case, and `vi.resetModules()` forgets it without
 * `src/` carrying an export that means nothing in production.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEMO_NOTICE_COPY, DEMO_NOTICE_KEY, DEMO_NOTICE_SEEN } from '@/lib/demo-notice'

/** A stand-in for the layout's `<main id="main-content" tabIndex={-1}>`, which the notice focuses. */
function mainElement(): HTMLElement {
  const main = document.createElement('main')
  main.id = 'main-content'
  main.tabIndex = -1
  document.body.append(main)

  return main
}

async function loadNotice() {
  vi.resetModules()

  return (await import('@/components/shell/demo-notice')).DemoNotice
}

let DemoNotice: Awaited<ReturnType<typeof loadNotice>>

beforeEach(async () => {
  window.localStorage.clear()
  DemoNotice = await loadNotice()
})

describe('DemoNotice', () => {
  it('opens on a first visit with the owner’s words, named, described, and focused on Continue', async () => {
    render(<DemoNotice />)

    const dialog = await screen.findByRole('alertdialog', { name: DEMO_NOTICE_COPY.title })

    for (const sentence of DEMO_NOTICE_COPY.body) {
      expect(dialog).toHaveTextContent(sentence)
    }
    expect(dialog).toHaveAccessibleDescription(DEMO_NOTICE_COPY.body.join(' '))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: DEMO_NOTICE_COPY.continue })).toHaveFocus(),
    )
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('refuses Escape and a click outside — only Continue closes it', async () => {
    /* Radix sets `pointer-events: none` on the page behind a modal; the click is on its scrim. */
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<DemoNotice />)

    await screen.findByRole('alertdialog')

    await user.keyboard('{Escape}')
    const scrim = document.querySelector('[data-slot="dialog-overlay"]')
    expect(scrim).not.toBeNull()
    await user.click(scrim as Element)

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(window.localStorage.getItem(DEMO_NOTICE_KEY)).toBeNull()
  })

  it('closes on Continue and remembers it, so the next visit renders nothing', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<DemoNotice />)

    await user.click(await screen.findByRole('button', { name: DEMO_NOTICE_COPY.continue }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(DEMO_NOTICE_KEY)).toBe(DEMO_NOTICE_SEEN)

    unmount()
    DemoNotice = await loadNotice()
    render(<DemoNotice />)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('hands focus to the page when it closes, instead of dropping it on the body', async () => {
    const main = mainElement()
    const user = userEvent.setup()
    render(<DemoNotice />)

    await user.click(await screen.findByRole('button', { name: DEMO_NOTICE_COPY.continue }))

    await waitFor(() => expect(main).toHaveFocus())
  })

  it('shows the notice again for a stored value it did not write', async () => {
    window.localStorage.setItem(DEMO_NOTICE_KEY, 'yes')
    render(<DemoNotice />)

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  })

  it('still closes on Continue when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const user = userEvent.setup()
    render(<DemoNotice />)

    await user.click(await screen.findByRole('button', { name: DEMO_NOTICE_COPY.continue }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })
})
