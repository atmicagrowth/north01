'use client'

import Script from 'next/script'
import { useEffect, useId, useRef } from 'react'

import { publicEnv } from '@/lib/env.public'
import { TURNSTILE_FIELD } from '@/lib/security/turnstile'

/**
 * **Plan §26.1a's widget — and it is the half that is not security.**
 *
 * > *"Client-side widget alone is not security."*
 *
 * This renders a challenge and writes a token into the form. Whether that token means anything is
 * decided in `lib/security/guard.ts`, on the server, with a secret this file has never seen. If this
 * component were deleted, every guarded form would start **refusing** rather than start accepting —
 * which is the right way round, and worth stating because the opposite arrangement is the common one.
 *
 * ### Nothing renders without a site key
 *
 * No key, no `<Script>`, no widget, no token — and `verifyTurnstile` independently reaches the same
 * conclusion from the **server** environment and skips. The two halves agree because they read the
 * same pair of variables, not because one tells the other.
 *
 * ### Implicit rendering, deliberately
 *
 * Cloudflare's script scans for `.cf-turnstile` and renders into it. The explicit
 * `window.turnstile.render()` API would need this component to wait for the script, hold a widget
 * id, and re-render on navigation — three pieces of state to keep in step with a script that may not
 * have loaded. The implicit path is one `<div>` and a `data-` attribute.
 *
 * `data-response-field-name` is set explicitly rather than left to Cloudflare's default, so the field
 * name is a **constant shared with the server** rather than a string written out twice.
 *
 * ### It resets after a submission
 *
 * A Turnstile token is single-use, and Cloudflare's reply to a replayed one is
 * `timeout-or-duplicate`. A form the customer submits twice — a validation error, then a fix — would
 * fail the second time complaining about verification, on a form whose actual problem was an email
 * address. `submissionCount` changes on every attempt, so resetting on it hands the next attempt a
 * fresh token.
 */
export function TurnstileWidget({ submissionCount = 0 }: { submissionCount?: number }) {
  const siteKey = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const container = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!siteKey || submissionCount === 0) {
      return
    }

    /*
     * `window.turnstile` exists only once the script has loaded, and `reset` on a container that was
     * never rendered into throws. Both are ordinary states here, so both are guarded rather than
     * assumed — a third-party script must never be able to break a form.
     */
    try {
      const turnstile = (window as { turnstile?: { reset: (target: Element) => void } }).turnstile

      if (turnstile && container.current) {
        turnstile.reset(container.current)
      }
    } catch {
      /* A widget that will not reset is a widget the customer can simply solve again. */
    }
  }, [siteKey, submissionCount])

  if (!siteKey) {
    return null
  }

  return (
    <>
      <Script
        id="cf-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
      />

      <div
        className="cf-turnstile"
        data-response-field-name={TURNSTILE_FIELD}
        data-sitekey={siteKey}
        data-theme="light"
        id={id}
        ref={container}
      />
    </>
  )
}
