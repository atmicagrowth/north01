import { describe, expect, it } from 'vitest'

import {
  PRIVATE_PATHS,
  isPrivatePath,
  reportableReferrer,
  speedInsightsBeforeSend,
  withoutQuery,
} from '@/lib/analytics/private-paths'
import {
  redactPageUrl,
  redactReferrer,
  scrubUrlProperties,
} from '@/lib/analytics/redact-for-vendors'
import { PERSONAL_SEARCH } from '@/lib/analytics/search-term'
import { REDACTED, redactUrl } from '@/lib/observability/redact'

/**
 * Phase 37 — what the privacy notice says about measurement, pinned to the code that makes it true.
 *
 * The notice's *Measurement* paragraph (`scripts/seed/legal.ts`) makes three promises about URLs, and
 * each `describe` below is one of them for the vendor that receives it:
 *
 * 1. *"Pages that carry a password-reset link are not reported to Google Analytics, PostHog or Speed
 *    Insights."* — `PRIVATE_PATHS` and `isPrivatePath`, which `analytics.tsx` checks before GA4 or
 *    PostHog reports a page and `speedInsightsBeforeSend` checks for Speed Insights. A referrer on
 *    that page is reported as the bare origin (`reportableReferrer`, `redactReferrer`), so the page
 *    is not reported by the next one either.
 * 2. *"Speed Insights receives the address of each page it measures with everything after the path
 *    removed."* — `speedInsightsBeforeSend`, through `withoutQuery`.
 * 3. *"Before a web address is reported, values in it that we recognise as sensitive, such as
 *    password-reset links, email addresses, order references and long numbers, are replaced; the page
 *    path itself is sent as it is."* — `redactUrl` (sensitive parameter names, and every value scrubbed
 *    decoded), `redactPageUrl` (the same, plus a search term `PERSONAL_SEARCH` withholds) for GA4's
 *    `page_location` and PostHog's page URLs, and `scrubUrlProperties` for every URL-valued PostHog
 *    property. *"Replaced"*, not removed: a redacted value reads `[redacted]`. And *"the page path
 *    itself is sent as it is"* is pinned too, so the notice cannot quietly start over-promising.
 *
 * The notice's other measurement settings — Google signals and ad personalisation off, PostHog without
 * session recording or click tracking — are SDK options passed in `analytics.tsx`, not URL rules, and
 * are not asserted in this file.
 */

const TOKEN = 'resettoken123456'
const RESET = `https://north01.test/reset-password?token=${TOKEN}`

describe('isPrivatePath — the pages no vendor is told about', () => {
  it('is exactly the reset-password page', () => {
    expect(PRIVATE_PATHS).toEqual(['/reset-password'])
  })

  it('matches the page and anything beneath it, and nothing that merely starts with its name', () => {
    expect(isPrivatePath('/reset-password')).toBe(true)
    expect(isPrivatePath('/reset-password/')).toBe(true)
    expect(isPrivatePath('/reset-password/x')).toBe(true)
    expect(isPrivatePath('/reset-passwords')).toBe(false)
    expect(isPrivatePath('/forgot-password')).toBe(false)
    expect(isPrivatePath('/')).toBe(false)
  })
})

describe('speedInsightsBeforeSend — Vercel Speed Insights', () => {
  it('drops every event for the reset page, token or not', () => {
    expect(speedInsightsBeforeSend({ type: 'vital', url: RESET })).toBeNull()
    expect(
      speedInsightsBeforeSend({ type: 'vital', url: 'https://north01.test/reset-password' }),
    ).toBeNull()
  })

  it('drops an event whose route template is the reset page', () => {
    expect(
      speedInsightsBeforeSend({
        route: '/reset-password',
        type: 'vital',
        url: 'https://north01.test/elsewhere',
      }),
    ).toBeNull()
  })

  it('reports every other page as origin and path, with no query string or fragment', () => {
    expect(
      speedInsightsBeforeSend({
        route: '/checkout/success',
        type: 'vital',
        url: 'https://north01.test/checkout/success?order=42&session_id=cs_test_1#top',
      }),
    ).toEqual({
      route: '/checkout/success',
      type: 'vital',
      url: 'https://north01.test/checkout/success',
    })

    expect(
      speedInsightsBeforeSend({ type: 'vital', url: 'https://north01.test/search?q=jacket' })?.url,
    ).toBe('https://north01.test/search')
  })

  it('drops an event whose url is not a URL rather than passing it through', () => {
    expect(speedInsightsBeforeSend({ type: 'vital', url: `not a url ${TOKEN}` })).toBeNull()
  })
})

describe('withoutQuery and reportableReferrer — the rules that load before the redaction does', () => {
  it('keeps origin and path only', () => {
    expect(withoutQuery('https://north01.test/shop?size=m#grid')).toBe('https://north01.test/shop')
    expect(withoutQuery('nonsense')).toBeNull()
  })

  it('reports no referrer as empty, and a reset-page referrer as the bare origin', () => {
    expect(reportableReferrer('')).toBe('')
    expect(reportableReferrer('not a url')).toBe('')
    expect(reportableReferrer(RESET)).toBe('https://north01.test/')
  })

  it('drops the query from any other referrer by default', () => {
    expect(reportableReferrer('https://north01.test/checkout/success?order=42')).toBe(
      'https://north01.test/checkout/success',
    )
  })
})

describe('redactUrl — parameter values are scrubbed decoded, not as percent-encoding', () => {
  it('scrubs an email address that the URL spells with %40', () => {
    const out = redactUrl('https://north01.test/search?q=jane%40example.com&size=m')

    expect(decodeURIComponent(out)).not.toContain('jane')
    expect(decodeURIComponent(out)).not.toContain('example.com')
    expect(out).toContain('size=m')
  })

  it('leaves a URL with nothing sensitive in it spelled exactly as it was', () => {
    const url = 'https://north01.test/shop?colour=bone%20white&size=m'

    expect(redactUrl(url)).toBe(url)
  })

  it('still replaces a sensitive parameter by name', () => {
    expect(redactUrl(RESET)).not.toContain(TOKEN)
    expect(decodeURIComponent(redactUrl(RESET))).toContain(`token=${REDACTED}`)
  })
})

describe('redactPageUrl — GA4 page_location and PostHog page URLs', () => {
  it('redacts the checkout return parameters', () => {
    const out = redactPageUrl('https://north01.test/checkout/success?order=42&session_id=cs_live_1')

    expect(out).not.toMatch(/order=42/)
    expect(out).not.toContain('cs_live_1')
  })

  it('withholds a search term that looks like an email or an order number, as search_submitted does', () => {
    expect(decodeURIComponent(redactPageUrl('https://north01.test/search?q=1234567'))).toBe(
      `https://north01.test/search?q=${REDACTED}`,
    )
    expect(redactPageUrl('https://north01.test/search?q=a%40b')).not.toContain('a%40b')
  })

  it('leaves an ordinary search alone', () => {
    expect(redactPageUrl('https://north01.test/search?q=field+jacket')).toBe(
      'https://north01.test/search?q=field+jacket',
    )
  })

  it('sends the page path as it is, as the notice says — an order page reports its order number', () => {
    expect(redactPageUrl('https://north01.test/account/orders/N1-2609-ABC123')).toBe(
      'https://north01.test/account/orders/N1-2609-ABC123',
    )
  })
})

describe('PERSONAL_SEARCH — the one search-term rule the event and the page URL share', () => {
  it('matches an @ or a run of six or more digits, and nothing else', () => {
    expect(PERSONAL_SEARCH.test('jane@example.com')).toBe(true)
    expect(PERSONAL_SEARCH.test('@')).toBe(true)
    expect(PERSONAL_SEARCH.test('order 123456')).toBe(true)
    expect(PERSONAL_SEARCH.test('12345')).toBe(false)
    expect(PERSONAL_SEARCH.test('12 34 56')).toBe(false)
    expect(PERSONAL_SEARCH.test('field jacket')).toBe(false)
  })

  it('answers the same for the same term every time — it carries no lastIndex between calls', () => {
    expect(PERSONAL_SEARCH.global).toBe(false)
    expect([1, 2, 3].map(() => PERSONAL_SEARCH.test('1234567'))).toEqual([true, true, true])
  })
})

describe('redactReferrer — GA4 page_referrer and PostHog referrers', () => {
  it('reports a reset-page referrer as the bare origin, token and path both gone', () => {
    expect(redactReferrer(RESET)).toBe('https://north01.test/')
  })

  it('redacts rather than strips any other referrer', () => {
    const out = redactReferrer('https://north01.test/checkout/success?order=42&utm_source=mail')

    expect(out).not.toMatch(/order=42/)
    expect(out).toContain('utm_source=mail')
  })

  it('reports no referrer as empty', () => {
    expect(redactReferrer('')).toBe('')
  })
})

describe('scrubUrlProperties — every URL in a PostHog event, whatever it is called', () => {
  it('redacts the session-entry properties the old fixed list missed', () => {
    const properties: Record<string, unknown> = {
      $current_url: 'https://north01.test/search?q=jane%40example.com',
      $pathname: '/search',
      $referrer: '$direct',
      $session_entry_referrer: RESET,
      $session_entry_url: 'https://north01.test/checkout/success?order=42',
      transactionId: 'N1-2609-ABC123',
    }

    scrubUrlProperties(properties)

    expect(JSON.stringify(properties)).not.toContain(TOKEN)
    expect(JSON.stringify(properties)).not.toContain('order=42')
    expect(decodeURIComponent(String(properties.$current_url))).not.toContain('jane')
    expect(properties.$session_entry_referrer).toBe('https://north01.test/')
  })

  it('leaves values that are not URLs untouched', () => {
    const properties: Record<string, unknown> = {
      $pathname: '/reset-password',
      $referrer: '$direct',
      count: 3,
      transactionId: 'N1-2609-ABC123',
    }

    scrubUrlProperties(properties)

    expect(properties).toEqual({
      $pathname: '/reset-password',
      $referrer: '$direct',
      count: 3,
      transactionId: 'N1-2609-ABC123',
    })
  })

  it('accepts an absent property bag', () => {
    expect(() => scrubUrlProperties(undefined)).not.toThrow()
    expect(() => scrubUrlProperties(null)).not.toThrow()
  })
})
