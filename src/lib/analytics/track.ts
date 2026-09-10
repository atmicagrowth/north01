import {
  capItems,
  toGa4Params,
  type AnalyticsEvent,
  type AnalyticsItem,
  type AnalyticsPayload,
} from './events'

/**
 * **The one way an event leaves this application** — plan §25.1b's *"do not block business
 * actions"*, made structural.
 *
 * > *"Analytics must be fire-and-forget and must never block commerce operations."*
 *
 * Three properties, and each is enforced here rather than asked of every call site:
 *
 * 1. **It never throws.** Every dispatch is inside `try`/`catch`. A vendor script that failed to
 *    load, a `gtag` that is not a function, a payload that will not serialise — none of them can
 *    reach the click handler that called this. `addToBagAction` is not allowed to fail because
 *    PostHog is down.
 * 2. **It never awaits.** `trackEvent` returns `void`, not a promise, so no `await` can be written
 *    against it by accident and no commerce path can end up sequenced behind a network call.
 * 3. **It never runs on the server.** The guard is a `typeof window` check rather than a
 *    `server-only` import, because this module is imported *by* client components — the guard is
 *    for prerendering, where a client component's module body still evaluates in Node.
 *
 * ### There is no vendor import in this file
 *
 * `posthog-js` is ~60 KB and is loaded by `analytics.tsx`, which registers its `capture` here. This
 * module therefore adds nothing to a bundle that does not already have the provider, and a page that
 * tracks one event does not pull in an SDK.
 */

type CaptureFn = (event: string, properties: Record<string, unknown>) => void

let posthogCapture: CaptureFn | null = null

/** Called by `analytics.tsx` once PostHog has loaded. Absent until then, and that is a valid state. */
export function registerPostHog(capture: CaptureFn | null): void {
  posthogCapture = capture
}

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

/**
 * **§25.1a's taxonomy, dispatched to both vendors.**
 *
 * PostHog receives the payload in the project's own terms — minor units, camelCase, zero-based
 * indices — because it is a behavioural product analytics tool and the project's own vocabulary is
 * the one worth querying there. GA4 receives `toGa4Params`, which is §25.1c's *"GA4-compatible
 * form"*. **One call, one taxonomy, two shapes**, and the reshaping lives in a pure function that a
 * harness can assert.
 *
 * A vendor that is not configured is simply not called. Neither is a fallback for the other: an
 * event is sent to whichever of the two exists, or to neither, and the caller cannot tell.
 */
export function trackEvent<E extends AnalyticsEvent>(event: E, payload: AnalyticsPayload<E>): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const properties = withCappedItems(payload as Record<string, unknown>)

    posthogCapture?.(event, properties)

    window.gtag?.('event', event, toGa4Params(event, properties))
  } catch (error) {
    /*
     * Warned in development and never rethrown. An analytics failure is worth seeing in a console
     * while building and is worth nothing at all to a customer, who is in the middle of buying
     * something. §25.1b: do not block business actions if PostHog fails.
     *
     * `console.warn` rather than `console.debug` because the repo's `no-console` rule allows only
     * `warn` and `error` — a deliberate narrowing, and this is not the place to argue with it.
     */
    if (process.env.NODE_ENV === 'development') {
      console.warn('[analytics] Event dropped.', event, error)
    }
  }
}

/**
 * GA4 rejects an event whose `items` array exceeds 200 entries, so a long grid has to be cut.
 *
 * Cutting silently is the defect this project keeps finding in read limits, so the count that was
 * dropped travels with the event. A dashboard showing `item_list_truncated: 60` is a dashboard whose
 * owner knows the list was longer; one showing fifty items and nothing else is not.
 */
function withCappedItems(payload: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(payload.items)) {
    return payload
  }

  const { dropped, items } = capItems(payload.items as AnalyticsItem[])

  return dropped === 0 ? payload : { ...payload, items, item_list_truncated: dropped }
}
