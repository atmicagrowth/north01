'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { publicEnv } from '@/lib/env.public'
import { registerPostHog } from '@/lib/analytics/track'

/**
 * **Plan §25.1b and §25.1c — the two client SDKs, behind an integration boundary.**
 *
 * > *"Add PostHog, GA4, Sentry, and Vercel Speed Insights behind integration boundaries."*
 *
 * The boundary is this file. Nothing else in the storefront imports `posthog-js` or touches
 * `window.gtag`; every call site goes through `trackEvent`, which knows about neither. Removing a
 * vendor is deleting a block here, and it costs the application nothing.
 *
 * ### Not configured means not loaded
 *
 * Neither key is required. Without `NEXT_PUBLIC_POSTHOG_KEY` the SDK is **never imported**, so its
 * bytes never reach a browser; without `NEXT_PUBLIC_GA_MEASUREMENT_ID` no `<Script>` is rendered.
 * That is what makes a local checkout run at full speed with no accounts configured, and it is the
 * shape §25.1b asks for from the other direction: a missing analytics vendor is a non-event.
 *
 * ### No URL leaves this file unredacted — and one route is never reported at all
 *
 * **Found live, the day the keys were first built.** The password-reset email links to
 * `/reset-password?token=…`, and the token is a one-hour credential. `gtag('config')` sent
 * `page_location = window.location.href` on every landing, and PostHog's pageview carries
 * `$current_url` — so every reset link a customer opened handed its token to two third parties. The
 * redaction Phase 25 built (`lib/observability/redact.ts`) was applied to Sentry and to nothing else.
 *
 * Now, for both vendors:
 *
 * - `/reset-password` is **not reported at all** — neither SDK loads when a session starts there,
 *   and no page view is sent for it when a session arrives there later.
 * - Every other URL passes through `redactUrl` first: `token`, `code`, `session`, `session_id`,
 *   `email` and the rest of `SENSITIVE_PARAM` become `[redacted]`, and the value patterns (emails,
 *   card-length digit runs, keys) are scrubbed from what is left.
 *
 * `redact.ts` is imported **dynamically**, with the SDKs, so a storefront with no analytics keys
 * ships none of it — the first-load budget Phase 30 measured stays where it is.
 *
 * ### One source of GA4 page views
 *
 * This read `gtag('config', id)`, which sends a page view, and then sent its own on every client
 * navigation — while GA4's default *enhanced measurement* also sends one on every history change.
 * Every navigation after the first was counted twice. Now `config` runs with `send_page_view: false`
 * and every page view, the landing included, is sent here with a redacted location. **Enhanced
 * measurement's "page changes based on browser history events" must be switched off** in the GA4
 * data stream (TODO.md §6) — code cannot turn it off. Until it is, `gtag('set', { page_location })`
 * at least means the duplicate carries the redacted URL rather than the raw one.
 *
 * ### Both load when the page is idle
 *
 * Analytics is not on the critical path, so neither is its loading: GA's library is
 * `lazyOnload`, and PostHog (roughly 60 KB gzipped) is imported after the `load` event, once the
 * browser is idle. Events sent before either is ready are queued — `dataLayer` for GA, and a
 * dropped `trackEvent` for PostHog, which is the documented cost of never blocking a render on it.
 *
 * ### A blocked vendor is a non-event too
 *
 * Content blockers routinely fail the dynamic imports and stub or break `gtag`. Every import here
 * ends in `.catch(() => {})` and every `gtag` call is wrapped, so a failed analytics script can
 * never throw into the page (Phase 36, audit R1-30). Nothing is reported: a blocked tracker is the
 * customer's choice, not a fault.
 */

/** Calls `window.gtag` if it exists, swallowing anything a broken or stubbed copy throws. */
function safeGtag(...args: unknown[]): void {
  try {
    ;(window.gtag as ((...rest: unknown[]) => void) | undefined)?.(...args)
  } catch {
    /* A tracker that throws is a tracker that is not running. */
  }
}

/** Routes whose URL carries a credential. Neither vendor is told about them. */
const PRIVATE_PATHS = ['/reset-password'] as const

function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

/** PostHog properties that hold a URL. `$set_once` carries the person's first-seen copies. */
const URL_PROPERTIES = ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer']

/** Runs `task` once the page has loaded and the browser is idle. Returns a cancel function. */
function whenIdle(task: () => void): () => void {
  let idle: number | undefined
  let timer: number | undefined

  const schedule = () => {
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(task, { timeout: 4000 })
    } else {
      timer = window.setTimeout(task, 1500)
    }
  }

  if (document.readyState === 'complete') {
    schedule()
  } else {
    window.addEventListener('load', schedule, { once: true })
  }

  return () => {
    window.removeEventListener('load', schedule)
    if (idle !== undefined) window.cancelIdleCallback(idle)
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

/** Whether `gtag('config')` has run in this document. It must run exactly once. */
let gaConfigured = false

export function Analytics() {
  const pathname = usePathname()

  const measurementId = publicEnv.NEXT_PUBLIC_GA_MEASUREMENT_ID
  const posthogKey = publicEnv.NEXT_PUBLIC_POSTHOG_KEY
  const posthogHost = publicEnv.NEXT_PUBLIC_POSTHOG_HOST

  useEffect(() => {
    /*
     * A session that starts on a private route never loads PostHog. Deliberately read once, at
     * mount: the SDK is initialised once per document, and `before_send` below drops anything a
     * later private route would have sent.
     */
    if (!posthogKey || !posthogHost || isPrivatePath(window.location.pathname)) {
      return
    }

    let cancelled = false

    const cancelIdle = whenIdle(() => {
      void Promise.all([import('posthog-js'), import('@/lib/observability/redact')])
        .then(([{ default: posthog }, { redactUrl }]) => {
          if (cancelled) {
            return
          }

          const scrub = (properties: Record<string, unknown> | undefined) => {
            if (!properties) return

            for (const key of URL_PROPERTIES) {
              const value = properties[key]

              if (typeof value === 'string') properties[key] = redactUrl(value)
            }
          }

          posthog.init(posthogKey, {
            api_host: posthogHost,
            /*
             * PostHog watches `history` itself, which is what an App Router navigation actually is.
             * Its own listener is more accurate than one written here, because it fires after the
             * URL has settled rather than after React has re-rendered.
             */
            capture_pageview: 'history_change',

            /*
             * **Autocapture off, and this is a §25.1a decision as much as a §25.1d one.**
             *
             * PostHog's autocapture records every click and input interaction on the page, along
             * with element text. §25.1a asks for *"a single internal naming convention"*, which
             * autocapture replaces with one invented from the DOM; §25.1d says avoid *"raw personal
             * data where not necessary"*, and this shop has a checkout, an address book and an
             * account settings form. Session recording is disabled explicitly for the same reason:
             * a dashboard toggle should not be able to start recording this storefront's forms.
             */
            autocapture: false,
            disable_session_recording: true,
            person_profiles: 'identified_only',

            before_send: (event) => {
              if (!event) return event

              const properties = event.properties as Record<string, unknown>

              if (typeof properties.$pathname === 'string' && isPrivatePath(properties.$pathname)) {
                return null
              }

              scrub(properties)
              scrub(properties.$set_once as Record<string, unknown> | undefined)
              scrub(event.$set_once as Record<string, unknown> | undefined)

              return event
            },
          })

          registerPostHog((event, properties) => {
            try {
              posthog.capture(event, properties)
            } catch {
              /* See "A blocked vendor is a non-event too". */
            }
          })
        })
        .catch(() => {})
    })

    return () => {
      cancelled = true
      cancelIdle()
      registerPostHog(null)
    }
  }, [posthogHost, posthogKey])

  /*
   * Every GA4 page view, the landing included. The query string is read from `window.location`
   * rather than from `useSearchParams`, deliberately: that hook opts a route into client-side
   * rendering unless it sits inside a `<Suspense>`, and this component is mounted in the root
   * layout, where that would wrap the whole storefront.
   */
  useEffect(() => {
    if (!measurementId || isPrivatePath(pathname)) {
      return
    }

    let cancelled = false

    /*
     * The standard `gtag` stub. It must push the `arguments` object itself — gtag.js ignores an
     * array — which is the one place this codebase needs `arguments`.
     */
    window.dataLayer = window.dataLayer ?? []
    window.gtag =
      window.gtag ??
      function gtag() {
        // eslint-disable-next-line prefer-rest-params
        window.dataLayer?.push(arguments)
      }

    if (!gaConfigured) {
      gaConfigured = true
      safeGtag('js', new Date())
      safeGtag('config', measurementId, { send_page_view: false })
    }

    void import('@/lib/observability/redact')
      .then(({ redactUrl }) => {
        if (cancelled) {
          return
        }

        const location = redactUrl(window.location.href)

        /* `set`, so anything GA sends on its own from this page carries the redacted URL too. */
        safeGtag('set', { page_location: location })
        safeGtag('event', 'page_view', { page_location: location })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [measurementId, pathname])

  if (!measurementId || isPrivatePath(pathname)) {
    return null
  }

  return (
    <Script
      src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
      strategy="lazyOnload"
    />
  )
}
