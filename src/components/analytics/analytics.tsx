'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

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
 * ### PostHog is imported dynamically, and that is not a micro-optimisation
 *
 * `posthog-js` is roughly 60 KB gzipped. A static import would put it in the first-load bundle of
 * **every** page, including the homepage, whose entire performance argument is that it ships almost
 * no client JavaScript. `import()` inside the effect means it is fetched after hydration, off the
 * critical path, and only where it is configured.
 */
export function Analytics() {
  const pathname = usePathname()

  const measurementId = publicEnv.NEXT_PUBLIC_GA_MEASUREMENT_ID
  const posthogKey = publicEnv.NEXT_PUBLIC_POSTHOG_KEY
  const posthogHost = publicEnv.NEXT_PUBLIC_POSTHOG_HOST

  /*
   * The first `page_view` is sent by the `gtag('config', …)` call in the inline script below, so
   * this must not send it a second time. A duplicated landing pageview inflates sessions and entry
   * pages, which is the one GA4 number an operator is most likely to trust without checking.
   */
  const seenFirstPath = useRef(false)

  useEffect(() => {
    if (!posthogKey || !posthogHost) {
      return
    }

    let cancelled = false

    void import('posthog-js').then(({ default: posthog }) => {
      if (cancelled) {
        return
      }

      posthog.init(posthogKey, {
        api_host: posthogHost,
        /*
         * PostHog watches `history` itself, which is what an App Router navigation actually is. Its
         * own listener is more accurate than one written here, because it fires after the URL has
         * settled rather than after React has re-rendered.
         */
        capture_pageview: 'history_change',
        /* §25.1d's redaction rule applies to PostHog too — see `sentry.config.ts`. */
        mask_all_text: false,
        person_profiles: 'identified_only',
      })

      registerPostHog((event, properties) => posthog.capture(event, properties))
    })

    return () => {
      cancelled = true
      registerPostHog(null)
    }
  }, [posthogHost, posthogKey])

  /*
   * GA4 has no history listener of its own. `gtag('config')` sends one `page_view` when it runs and
   * then nothing, so every client navigation in the shop would be invisible — a customer moving from
   * the homepage to a product to the bag would appear as a single-page session.
   *
   * The query string is read from `window.location` rather than from `useSearchParams`, deliberately:
   * that hook opts a route into client-side rendering unless it sits inside a `<Suspense>`, and this
   * component is mounted in the root layout, where that would wrap the whole storefront.
   */
  useEffect(() => {
    if (!measurementId) {
      return
    }

    if (!seenFirstPath.current) {
      seenFirstPath.current = true

      return
    }

    window.gtag?.('event', 'page_view', {
      page_location: window.location.href,
      page_path: `${pathname}${window.location.search}`,
    })
  }, [measurementId, pathname])

  if (!measurementId) {
    return null
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-config" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${measurementId}');`}
      </Script>
    </>
  )
}
