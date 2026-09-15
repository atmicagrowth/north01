'use client'

import { Dialog as DialogPrimitive } from 'radix-ui'
import { useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import {
  DEMO_NOTICE_COPY,
  DEMO_NOTICE_KEY,
  DEMO_NOTICE_SEEN,
  hasSeenDemoNotice,
} from '@/lib/demo-notice'

/**
 * **The demonstration notice** — a modal warning on a browser's first visit (**DEV-86**).
 *
 * Mounted once, in the storefront layout, so it covers whichever page a visit starts on. It closes
 * only through **Continue**: Escape and a click on the scrim are refused, because a warning that can
 * be dismissed without being read has not been given. That refusal is structural first — `open` is
 * controlled and no `onOpenChange` is passed, so Radix's own dismiss path ends in a no-op — and the
 * two handlers below are the belt to that pair of braces, for the day someone gives this dialog an
 * `onOpenChange` (sweep 2, which found the regression test could not fail without them). Radix supplies the rest — focus moves to
 * Continue, focus is trapped, the page behind is `aria-hidden` and does not scroll.
 *
 * ### Why it appears after hydration, not in the server HTML
 *
 * Remembering *Continue* is a device-local fact the server cannot read without a cookie, and reading
 * a cookie in the layout would make every page's HTML depend on it. So the server snapshot is
 * "already seen" — nothing is rendered — and the client snapshot reads `localStorage`. On a first
 * visit the dialog opens as soon as the page hydrates; afterwards it never renders at all. It is a
 * fixed overlay, so opening it moves nothing on the page. With scripting off it never appears, which
 * is the right failure: a dialog that cannot be closed would make the shop unusable.
 *
 * ### Storage that throws
 *
 * Private browsing or blocked site data make `localStorage` throw. Continue then closes the notice for
 * the rest of this page's life (`seenThisPage`), and it returns on the next full page load — shown too
 * often rather than not at all.
 */

let seenThisPage = false

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  /* Continue pressed in another tab closes it here too. */
  window.addEventListener('storage', listener)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

function readSeen(): boolean {
  if (seenThisPage) {
    return true
  }

  try {
    return hasSeenDemoNotice(window.localStorage.getItem(DEMO_NOTICE_KEY))
  } catch {
    return false
  }
}

/** The server has no storage. Answering "seen" keeps the dialog out of the server HTML. */
function serverSeen(): boolean {
  return true
}

function markSeen(): void {
  seenThisPage = true

  try {
    window.localStorage.setItem(DEMO_NOTICE_KEY, DEMO_NOTICE_SEEN)
  } catch {
    /* Remembered for this page only — see above. */
  }

  listeners.forEach((listener) => listener())
}

/**
 * **Where focus goes when the notice closes**, which Radix cannot decide for this dialog.
 *
 * `DialogContentModal`'s own `onCloseAutoFocus` prevents the default restore and then focuses
 * `Dialog.Trigger` — and there is no trigger here, so focus would land on `<body>`, the WCAG 2.4.3
 * defect `shell/overlay-context.tsx` records finding in a browser. The shell's overlays restore to
 * the control that opened them; nothing opened this one, so it hands focus to the page: `<main>`,
 * which the layout already makes focusable for the skip link.
 */
function closeFocus(event: Event): void {
  event.preventDefault()
  document.getElementById('main-content')?.focus()
}

export function DemoNotice() {
  const seen = useSyncExternalStore(subscribe, readSeen, serverSeen)

  return (
    <Dialog open={!seen}>
      <DialogContent
        hideCloseButton
        onCloseAutoFocus={closeFocus}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        role="alertdialog"
        title={DEMO_NOTICE_COPY.title}
      >
        <DialogPrimitive.Description asChild>
          <div className="flex flex-col gap-s font-sans text-body text-foreground">
            {DEMO_NOTICE_COPY.body.map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>
        </DialogPrimitive.Description>

        <Button block onClick={markSeen} size="lg" variant="primary">
          {DEMO_NOTICE_COPY.continue}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
