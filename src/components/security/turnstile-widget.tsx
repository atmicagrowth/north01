'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'

import { publicEnv } from '@/lib/env.public'
import { TURNSTILE_FIELD } from '@/lib/security/turnstile'

/**
 * **Cloudflare Turnstile, on the four public forms** — plan §26.1a, decision DEV-75.
 *
 * The server fails closed (`lib/security/turnstile.ts`): no valid token, no sign-in, no account, no
 * review, no newsletter address. This component is the browser half, and Phase 31 gave it the two
 * things it was missing.
 *
 * ### It says so when it cannot load
 *
 * A content blocker, a corporate filter or a Cloudflare outage stops `api.js`. Before, the reserved
 * box simply stayed empty, no token was ever written, and every submit came back *"We could not verify
 * that request. Please try again"* — which could never work, on sign-in included, with nothing saying
 * why. Now the script's `onError`, the widget's `error-callback`, and an eight-second check that
 * `window.turnstile` exists all put the same explanation in the box, in an alert the customer and a
 * screen reader both get.
 *
 * ### It can wait to be needed
 *
 * `active={false}` renders nothing and loads nothing. The footer newsletter renders on every page,
 * and mounted eagerly it ran a third-party challenge on every page view before anyone had touched
 * the form (§30.1c: *"avoid large third-party scripts before interaction"*). It now activates the
 * widget on the form's first focus. Sign-in, registration and reviews stay eager: their forms are
 * the page.
 *
 * ### Explicit rendering
 *
 * `api.js?render=explicit`, and each widget renders itself with `turnstile.render()` once the script
 * is ready. Implicit rendering scans the page once, when the script loads — so a widget mounted
 * afterwards (the newsletter's, after a focus; a form after a client navigation) was never rendered.
 * `onReady` fires on every mount, including when the script is already on the page.
 */

type Turnstile = {
  remove: (widgetId: string) => void
  render: (container: HTMLElement, options: Record<string, unknown>) => string | undefined
  reset: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

/** How long a working connection needs to fetch `api.js`, generously. */
const LOAD_TIMEOUT_MS = 8000

export function TurnstileWidget({
  active = true,
  submissionCount = 0,
}: {
  /** `false` loads nothing and renders nothing — see "It can wait to be needed". */
  active?: boolean
  /** Changes after every submission, so a spent token is replaced with a fresh challenge. */
  submissionCount?: number
}) {
  const siteKey = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<string | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!siteKey || !active) return

    const timer = window.setTimeout(() => {
      if (!window.turnstile) setFailed(true)
    }, LOAD_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [active, siteKey])

  useEffect(() => {
    const turnstile = window.turnstile

    if (!siteKey || !active || !ready || !turnstile || !container.current) return

    widget.current = turnstile.render(container.current, {
      'error-callback': () => {
        setFailed(true)
      },
      'response-field-name': TURNSTILE_FIELD,
      sitekey: siteKey,
      theme: 'light',
    })

    return () => {
      if (widget.current) {
        try {
          turnstile.remove(widget.current)
        } catch {
          /* Already gone with its container. */
        }
      }

      widget.current = undefined
    }
  }, [active, ready, siteKey])

  useEffect(() => {
    if (submissionCount === 0 || !widget.current) return

    try {
      window.turnstile?.reset(widget.current)
    } catch {
      /* A widget that will not reset is a widget the customer can simply solve again. */
    }
  }, [submissionCount])

  if (!siteKey || !active) {
    return null
  }

  return (
    <>
      <Script
        id="cf-turnstile"
        onError={() => setFailed(true)}
        /*
         * Clearing `failed` too: the eight-second check is a guess about a slow connection, and a
         * script that arrives at nine seconds should replace the explanation with the widget.
         */
        onReady={() => {
          setReady(true)
          setFailed(false)
        }}
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
      />

      {/*
        `min-h`: the widget's 73px is reserved before it renders, so the submit button does not move
        when it arrives (Phase 30). The explanation takes the same box.
      */}
      <div className="min-h-[73px]">
        {failed ? (
          <p className="font-sans text-body-sm text-error" role="alert">
            The security check couldn’t load, so this form can’t be sent. Allow
            challenges.cloudflare.com, or try another connection, then reload the page.
          </p>
        ) : (
          <div ref={container} />
        )}

        <noscript>
          <p className="font-sans text-body-sm text-foreground-muted">
            This form needs JavaScript for its security check.
          </p>
        </noscript>
      </div>
    </>
  )
}
