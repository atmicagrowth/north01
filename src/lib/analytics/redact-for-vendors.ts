import { REDACTED, redactUrl } from '../observability/redact'
import { reportableReferrer } from './private-paths'
import { PERSONAL_SEARCH } from './search-term'

/**
 * **What a URL looks like by the time GA4 or PostHog sees it.**
 *
 * `analytics.tsx` imports this module **dynamically**, together with the vendor SDKs, so a
 * storefront with no analytics keys ships none of it and `redact.ts` stays out of the first-load
 * bundle. Anything that must be decided before that import resolves is in `private-paths.ts`.
 *
 * ### Three URLs went out unredacted, and a fixed list of property names was why
 *
 * The PostHog `before_send` hook scrubbed four named properties: `$current_url`, `$referrer`,
 * `$initial_current_url` and `$initial_referrer`. The SDK attaches more than that — every event also
 * carries `$session_entry_url` and `$session_entry_referrer`, the first page of the session and
 * where it came from — and those went out raw. GA4's `page_referrer` was never set at all, so gtag
 * reported `document.referrer` unredacted.
 *
 * So PostHog properties are scrubbed **by value**, not by name: any string that is an absolute
 * `http(s)` URL is redacted wherever it sits. A property the SDK adds next year is covered the day
 * it appears.
 *
 * Pure. Driven by `tests/unit/analytics-privacy.test.ts` and `pnpm verify:analytics`.
 */

/**
 * The storefront's search parameter, and the rule `search_submitted` already applies to the term.
 *
 * `search-panel.tsx` sends the term as `[redacted]` when it matches `PERSONAL_SEARCH` — an `@` or six
 * or more digits in a row, plan §34: *"a search box is where people paste an email address or an
 * order number"*. The search then navigates to `/search?q=<term>`, and the page view carried the term
 * the event had just withheld. Both import the one rule from `search-term.ts`, so the two cannot
 * disagree.
 */
const SEARCH_PARAM = 'q'

/** A page URL for GA4's `page_location` or PostHog's `$current_url`. */
export function redactPageUrl(value: string): string {
  const redacted = redactUrl(value)

  try {
    const url = new URL(redacted)
    const term = url.searchParams.get(SEARCH_PARAM)

    if (term !== null && PERSONAL_SEARCH.test(term)) {
      url.searchParams.set(SEARCH_PARAM, REDACTED)

      return url.toString()
    }

    return redacted
  } catch {
    return redacted
  }
}

/** A referrer for GA4's `page_referrer` or PostHog's referrer properties. See `reportableReferrer`. */
export function redactReferrer(referrer: string): string {
  return reportableReferrer(referrer, (url) => redactPageUrl(url.href))
}

const ABSOLUTE_URL = /^https?:\/\//i

/** Property names that hold where a visitor came from rather than where they are. */
const REFERRER_KEY = /referrer$/i

/**
 * **Every URL in a PostHog property bag, redacted in place.**
 *
 * In place because PostHog's `before_send` hands over the event it is about to send and sends
 * what it gets back; copying would be allocation on every event for nothing. Referrer-named
 * properties get the referrer rule (a private-path referrer becomes its origin); every other
 * absolute URL gets the page rule. Non-URL values — `$direct`, a pathname, a product name — are
 * left alone.
 */
export function scrubUrlProperties(properties: Record<string, unknown> | null | undefined): void {
  if (!properties || typeof properties !== 'object') {
    return
  }

  for (const [key, value] of Object.entries(properties)) {
    if (typeof value !== 'string' || !ABSOLUTE_URL.test(value)) {
      continue
    }

    properties[key] = REFERRER_KEY.test(key) ? redactReferrer(value) : redactPageUrl(value)
  }
}
