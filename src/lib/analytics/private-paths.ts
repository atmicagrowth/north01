/**
 * **Which pages no measurement vendor is told about, and the URL rules that need no redaction.**
 *
 * Three vendors measure this storefront — GA4, PostHog and Vercel Speed Insights — and until Phase
 * 37 the list of pages none of them may report lived inside `analytics.tsx`, where only the first
 * two could see it. Speed Insights reported `/reset-password?token=…` like any other page. The list
 * is here now, so all three read the same one.
 *
 * ### Why this file imports nothing
 *
 * `analytics.tsx` needs `isPrivatePath` before it has decided to load anything, and Speed Insights
 * needs its `beforeSend` on every page of a production build. Neither may pull `redact.ts` into the
 * first-load bundle — Phase 30 measured that budget, and `analytics.tsx` imports the redaction
 * dynamically for exactly that reason. So the rules that can be written without a pattern table
 * are written here, and the ones that cannot live in `redact-for-vendors.ts`.
 *
 * Pure. Driven by `tests/unit/analytics-privacy.test.ts` and `pnpm verify:analytics`.
 */

/** Routes whose URL carries a credential. No vendor is told about them — not even the path. */
export const PRIVATE_PATHS = ['/reset-password'] as const

export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

/** `https://shop.test/search?q=x#top` → `https://shop.test/search`. `null` when it is not a URL. */
export function withoutQuery(value: string): null | string {
  try {
    const url = new URL(value)

    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}

/**
 * **The referrer a vendor may see.**
 *
 * `next.config.mjs` sends `Referrer-Policy: strict-origin-when-cross-origin`, which gives a
 * same-origin page the **full** previous URL, query included. So a customer who opens the reset
 * link and then loads another storefront page with a full page load arrives with
 * `document.referrer` set to `/reset-password?token=…` — a live one-hour credential — and gtag
 * reports the referrer by default.
 *
 * - No referrer, or one that is not a URL, is `''`.
 * - A referrer on a private path is its **origin alone**: the page was never reported, so the
 *   referrer must not report it either.
 * - Anything else goes through `format`. The default drops the query and fragment, which is the
 *   rule that needs no redaction table; `redact-for-vendors.ts` passes `redactPageUrl` instead, which
 *   keeps harmless parameters and replaces the sensitive ones.
 */
export function reportableReferrer(
  referrer: string,
  format: (url: URL) => string = (url) => `${url.origin}${url.pathname}`,
): string {
  if (!referrer) {
    return ''
  }

  let url: URL

  try {
    url = new URL(referrer)
  } catch {
    return ''
  }

  return isPrivatePath(url.pathname) ? `${url.origin}/` : format(url)
}

/* -------------------------------------------------------------------------------------------------
 * Vercel Speed Insights
 * ---------------------------------------------------------------------------------------------- */

/**
 * The event `@vercel/speed-insights` 2.0.0 hands to `beforeSend` — `BeforeSendEvent` in its
 * `dist/next/index.d.ts`, which the package declares but does not export. Written out here so this
 * module stays free of the package, and so a change to the shape is a type error at the call site.
 */
export type SpeedInsightsEvent = {
  route?: string
  type: 'vital'
  url: string
}

/**
 * **Speed Insights' `beforeSend`.** A Core Web Vitals report needs a page and nothing else.
 *
 * - An event for a private path is dropped (`null`), whether the path is in `url` or in the route
 *   template `route`.
 * - Every other event is reported with `url` reduced to origin and path. Not `redactUrl`: a
 *   performance report has no use for any query parameter, harmless or not, and dropping all of them
 *   needs no pattern table in the first-load bundle.
 * - An event whose `url` is not a URL is dropped rather than passed through untouched.
 *
 * A module-level function, so its identity is stable: the component re-registers `beforeSend`
 * whenever the prop changes.
 */
export function speedInsightsBeforeSend(event: SpeedInsightsEvent): null | SpeedInsightsEvent {
  if (typeof event.route === 'string' && isPrivatePath(event.route)) {
    return null
  }

  const url = withoutQuery(event.url)

  if (url === null || isPrivatePath(new URL(url).pathname)) {
    return null
  }

  return { ...event, url }
}
