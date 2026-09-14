# Analytics and error reporting

Plan §25 and §38. What GA4, PostHog, Vercel Speed Insights and Sentry receive, from where, how they
load, and what is kept out of them. Written from the code (2026-09-11; the vendor privacy rules
revised in Phase 37, 2026-09-13). Variables are defined in
[`ENVIRONMENT.md`](ENVIRONMENT.md) ("Per provider — optional until the phase lands"); what leaves the
shop about people, service by service, is in [`SECURITY.md`](SECURITY.md) §3. Decisions: notes §1.30
(Phase 25), §1.36.1 (the Phase 30 hotfix), **DEV-73**, **DEV-74**, **G-17**. The privacy notice
(`scripts/seed/legal.ts`, rendered at `/legal/privacy`) has a *Measurement* and a *Cookies and device
storage* paragraph written from this document — **change them together**.

## 1. The pieces

| File | Role |
|---|---|
| `src/components/analytics/analytics.tsx` | Client component, mounted once in `src/app/(frontend)/layout.tsx`. Loads GA4 and PostHog, sends page views. Also exports `SpeedInsightsReporter` |
| `src/lib/analytics/events.ts` | The event catalogue (17 events), `AnalyticsItem`, `toGa4Params`, `LIST_ITEM_CAP` |
| `src/lib/analytics/track.ts` | `trackEvent(name, payload)`. Client-only, returns nothing, never throws; warns in development only |
| `src/lib/analytics/items.ts` | Card and variant → `AnalyticsItem` helpers |
| `src/components/analytics/trackers.tsx` | `TrackOnMount`, `TrackList` |
| `src/components/analytics/track-purchase.tsx` | The `purchase` event on the success page |
| `src/components/analytics/use-action-result.ts` | Fires once per new Server Action result, never for the initial state |
| `src/components/analytics/speed-insights.tsx` | Vercel Speed Insights, production on Vercel only; renders `SpeedInsightsReporter` |
| `src/lib/analytics/private-paths.ts` | `PRIVATE_PATHS`, `isPrivatePath`, `withoutQuery`, `reportableReferrer`, `speedInsightsBeforeSend` — imports nothing, so it adds no pattern table to the first-load bundle |
| `src/lib/analytics/search-term.ts` | `PERSONAL_SEARCH` — the one rule (`@`, or six or more digits) shared by the search panel and URL redaction; imports nothing |
| `src/lib/analytics/redact-for-vendors.ts` | `redactPageUrl`, `redactReferrer`, `scrubUrlProperties` — loaded only by dynamic `import()` from `analytics.tsx` |
| `src/lib/observability/redact.ts` | `redactUrl`, `redactString`, `redactEvent`, `maskEmail` |
| `src/lib/observability/sentry-options.ts` | Sentry options shared by browser, Node and edge |
| `src/lib/observability/report.ts` | `reportFailure` |
| `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/sentry.server.config.ts`, `src/sentry.edge.config.ts` | Sentry start-up |

## 2. What turns each one on

| Service | Variables | Unset means |
|---|---|---|
| GA4 | `NEXT_PUBLIC_GA_MEASUREMENT_ID` | no `<Script>` rendered, nothing sent |
| PostHog | `NEXT_PUBLIC_POSTHOG_KEY` **and** `NEXT_PUBLIC_POSTHOG_HOST` | `posthog-js` is never imported. `POSTHOG_API_KEY` (server) is not used by this code |
| Sentry | `NEXT_PUBLIC_SENTRY_DSN` (one value for browser, server, edge); environment from `NEXT_PUBLIC_VERCEL_ENV` | the SDK is not loaded; `reportFailure` is a no-op |
| Sentry source maps | `SENTRY_AUTH_TOKEN` (build only) | **off**: `next.config.mjs` sets `sourcemaps: { disable: true }`, so production stack traces are minified (notes §1.30.10) |
| Speed Insights | none — `appEnv === 'production'` and `VERCEL`, plus enabling it in the Vercel dashboard | renders nothing |

All three are `NEXT_PUBLIC_`, so a change takes effect at the **next build** (DEPLOYMENT.md §10). Every
SDK import is dynamic and ends in `.catch(() => {})`: a keyless build ships none of them, and a blocked
vendor script is neither retried nor reported (Phase 36, audit R1-30). Every client-side Sentry import is dynamic
(Phase 30: the SDK had been downloaded on every route); ESLint enforces it in `instrumentation-client.ts`,
`global-error.tsx` and `env.public.ts`.

## 3. Loading

- **No consent gate.** There is no banner and nothing waits for consent — gap **G-17** (notes
  §1.30.15), still open. The privacy notice now exists (`site-settings.privacyPolicy`, TODO.md §9) and
  describes measurement as it runs today, without consent.
- **GA4**: `gtag/js` via `next/script` with `strategy="lazyOnload"`. `gtag('config', id,
  { allow_ad_personalization_signals: false, allow_google_signals: false, send_page_view: false })`
  runs once per document. On the landing and on every pathname change the component first calls
  `gtag('set', { page_location, page_referrer })` with the query and fragment removed, so nothing
  sent before the redaction loads can carry one; once `redact-for-vendors.ts` arrives it sets them
  again as `redactPageUrl(location.href)` and `redactReferrer(document.referrer)` and sends
  `page_view` with the same two values. No `cookie_*` option is set, so gtag.js keeps its defaults
  (`_ga`, `_ga_<id>`, Google's documented two-year expiry).
- **PostHog**: imported after the window `load` event, in `requestIdleCallback` (4 s timeout; falls
  back to `setTimeout` 1.5 s), together with `redact-for-vendors.ts`. Options:
  `capture_pageview: 'history_change'`, `autocapture: false`, `disable_session_recording: true`,
  `person_profiles: 'identified_only'`, `advanced_disable_flags: true` (no `/flags` request, which
  used to send the stored first URL and referrer unredacted, outside `before_send`, and no remote
  config), `capture_dead_clicks: false`, `capture_exceptions: false`, `capture_heatmaps: false`,
  `capture_performance: false`, `disable_surveys: true`, and the SDK defaults written out because the
  privacy notice describes them: `persistence: 'localStorage+cookie'`, `cookie_expiration: 365`.
  `before_send` drops any event whose `$pathname` is private, then runs `scrubUrlProperties` over
  `properties`, `properties.$set`, `properties.$set_once`, `event.$set` and `event.$set_once`: every
  string that is an absolute http(s) URL is redacted whatever its key — `*referrer` keys by the
  referrer rule, the rest by `redactPageUrl` — which covers `$current_url`, `$referrer`,
  `$session_entry_url` and `$session_entry_referrer`. Events tracked before PostHog finishes loading
  are not sent to it.
- **Speed Insights**: `SpeedInsightsReporter` passes `beforeSend = speedInsightsBeforeSend`. Each
  event (`{ type: 'vital', url, route }`) is dropped when its `url` path or `route` is private or its
  `url` does not parse; otherwise `url` is cut to origin and path. `route` passes unchanged. What the
  hosted `/_vercel/speed-insights/script.js` adds to the payload is not in `node_modules` and has not
  been checked.
- **Private paths**: `PRIVATE_PATHS = ['/reset-password']` in `lib/analytics/private-paths.ts`, read
  by all three vendors. There, GA4 renders no script and sends no page view, PostHog is not loaded
  when the tab starts there and `before_send` drops anything later, and Speed Insights drops the
  event (its script still loads, so Vercel sees the request as the host). A referrer on a private
  path is reported as the bare origin. Added by the Phase 30 hotfix after the reset token was
  measured reaching GA (notes §1.36.1, audit R1-16), extended to Speed Insights and referrers in
  Phase 37. `pnpm smoke` checks that `/reset-password` serves no GA4 or PostHog script.

## 4. Events

`trackEvent` sends each event to PostHog with the camelCase payload and to GA4 through `toGa4Params`,
which converts minor units to decimals (a `null` price is left out, never sent as 0), turns zero-based
indices one-based, and caps item lists at `LIST_ITEM_CAP` = 50 (overflow adds `item_list_truncated`).

| Event | Fired from | When |
|---|---|---|
| `view_item_list` | `TrackList` via `src/components/catalog/product-grid.tsx`: shop/category (`catalog-page.tsx`), collection, curated search landing, edit, journal related, PDP "You may also like" | on mount, when the list has items |
| `select_item` | `TrackList` | click on a card (`[data-item-id]`) |
| `view_item` | `src/components/product/product-page.tsx` | on mount |
| `add_to_cart` | `src/components/cart/add-to-bag.tsx`; `src/components/editorial/hotspot.tsx` | after the Server Action succeeds |
| `remove_from_cart` | `src/components/cart/cart-lines.tsx` | after success |
| `add_to_wishlist`, `remove_from_wishlist` | `src/components/wishlist/wishlist-button.tsx` | after the signed-in action succeeds; immediately for a guest (device list) |
| `begin_checkout` | `src/app/(frontend)/checkout/page.tsx` | on mount; not when payment is unavailable |
| `purchase` | `src/app/(frontend)/checkout/success/page.tsx` → `track-purchase.tsx` | only when the order is **paid** (webhook-set). Deduplicated per order in `sessionStorage` (`north01:purchase:<transactionId>`) |
| `search_submitted` | `src/components/shell/search-panel.tsx` | on submit, normalised term, no result count |
| `filter_applied` | `src/components/catalog/filter-controls.tsx` | when a filter box is ticked (not unticked), and for in-stock |
| `sort_changed` | `filter-controls.tsx` | sort select changes |
| `shop_the_look_opened` | `hotspot.tsx` | every time a hotspot preview opens |
| `shop_the_look_add_item` | `hotspot.tsx`; `src/components/editorial/add-entire-look.tsx` | after success; for "add the entire look", only the items actually added |
| `newsletter_signup` | `src/components/newsletter/newsletter-signup.tsx` | on success, `source: 'footer'` |
| `add_payment_info` | — | **never**: payment details are entered on Stripe's hosted page (**DEV-73**) |
| `quick_view_opened` | — | **never**: there is no quick view (**DEV-74**) |

To add an event: declare it and its payload in `events.ts`, map it in `toGa4Params` if GA4 needs a
different name or unit, call `trackEvent` only after the thing it reports has succeeded, and extend
`scripts/verify-analytics.ts`.

## 5. What is never sent

| Rule | Where |
|---|---|
| No `identify` call and no Sentry `setUser` anywhere in `src/`; with `person_profiles: 'identified_only'`, PostHog creates no person profiles | `analytics.tsx`, `track.ts` (grep, 2026-09-11) |
| No autocapture, session recording, heatmaps, dead clicks, exception capture, web vitals, surveys or feature-flag requests (PostHog) — pinned in code, so a project-settings toggle cannot turn one on; Google signals and ad personalisation off (GA4); no Replay integration (Sentry) | `analytics.tsx`, `sentry-options.ts` |
| URL query values named `access_token`, `code`, `email`, `key`, `order`, `password`, `secret`, `session`, `session_id`, `sig`, `signature`, `token` → `[redacted]` (matched case-insensitively). `order` since the serial order id appeared on return URLs (**D-17**, notes §1.39.4). Applied to the page **and the referrer**, GA4 and PostHog | `redactUrl`, `SENSITIVE_PARAM`, `redactPageUrl` |
| Every other query value is decoded and scrubbed by value (so `?q=jane%40example.com` is caught), and a `q` containing `@` or six or more digits in a row becomes `[redacted]` — the same rule as `search_submitted` | `redactPageUrl` |
| Values that look like Stripe keys (`sk_`, `rk_`, `pk_`, `whsec_`), Resend (`re_`) or PostHog (`phc_`) keys, Postgres URLs, bearer tokens, JWTs, 13–19 digit runs or email addresses → redacted, then truncated at 2000 characters | `redactString` |
| A search term containing `@` or a run of six or more digits is sent as `[redacted]` | `search-term.ts` (`PERSONAL_SEARCH`), used by `search-panel.tsx` and `redact-for-vendors.ts` |
| Speed Insights: no query string or fragment at all | `speedInsightsBeforeSend` |
| Sentry: `sendDefaultPii: false`; request cookies and headers dropped; request body, extra, contexts, tags, breadcrumbs and exception text redacted; user reduced to `{ id }`; keys naming a password, token, secret, card, address, line1/2, postcode, phone, name and similar redacted (walk depth 6, 50 array entries) | `redactEvent`, `sentry-options.ts` |
| Sentry performance tracing off (`tracesSampleRate` 0) | `sentry-options.ts` |
| Ignored errors: `AbortError`, `Failed to fetch`, `Load failed`, `NetworkError`, `Non-Error promise rejection captured`, `The operation was aborted`, `ResizeObserver loop` | `sentry-options.ts` |

### 5.1 What *is* sent, and makes the data pseudonymous rather than anonymous

| Sent | Where |
|---|---|
| **The order number on `purchase`** — GA4 `transaction_id`, PostHog `transactionId` (`N1-YYMM-XXXXXX`), with value, currency, shipping, tax and items. Anyone with both the analytics and the admin can join it to a named order | `events.ts` `toGa4Params`, `track-purchase.tsx` |
| **Path segments, unredacted** — `/account/orders/<order number>` reaches GA4, PostHog and Speed Insights as it is | `redactUrl` redacts query values only |
| **A persistent device identifier** — PostHog `distinct_id` and `$device_id` (a UUIDv7 made on first load) in the `ph_<key>_posthog` cookie (365 days from its last write) and `localStorage`; GA4's `_ga` client id | `analytics.tsx` options; gtag.js defaults |
| **The IP address** — PostHog stores it as `$ip` with GeoIP enrichment unless the project setting *Discard client IP data* is on (`posthog-js` 1.418's `ip` option has no effect); Google and Vercel receive it with every request | PostHog project settings, not code |
| PostHog per event: `$raw_user_agent` and the derived browser, OS and device type, screen and viewport size, `$timezone`, `$browser_language`, `$host`, `$pathname`, the page title on page views, and utm and ad click-id values from the landing URL (not redacted) | the SDK |

## 6. Server-side error reporting — `reportFailure`

`reportFailure(error, area, context?)` in `src/lib/observability/report.ts`: a no-op without the DSN,
otherwise a dynamic import of `@sentry/nextjs` and `captureException` with `tags: { area }` and
`extra: context`. Never throws and is not awaited; it is called **next to** the existing log line, not
instead of it (Phase 36, audit R3-13).

| `area` | Where |
|---|---|
| `stripe.webhook.record`, `.mismatch`, `.orderMissing`, `.process`, `.email`, `.taxTransaction` | `src/app/(frontend)/api/stripe/webhook/route.ts` |
| `retention.carts`, `retention.orders` | `src/lib/cart/sweep.ts` — a sweep step that throws, or a delete that reports errors |
| `checkout.createSession`, `checkout.retirePriorSession`, `checkout.promotionOverRedeemed`, `checkout.oversold`, `checkout.action` | `src/lib/checkout/` (`session.ts`, `preflight.ts`, `fulfil.ts`, `actions.ts`) |
| `catalog`, `search` | `src/lib/catalog/catalog.ts` (site settings, vocabulary, category and curated reads; listings, suggestions, popular searches) |
| `tax.stripe` | `src/lib/tax/provider.ts` |
| `shell` | `src/lib/navigation/shell-session.ts` |
| `auth.resetPassword.sessions` | `src/lib/auth/actions.ts` |

Unhandled request errors reach Sentry through `onRequestError` in `src/instrumentation.ts`; render
errors through `src/app/(frontend)/error.tsx` and `src/app/global-error.tsx`.

## 7. Verifying

- `pnpm verify:analytics` (`scripts/verify-analytics.ts`, 125 checks, no database, runs in CI)
  asserts the failures that would be silent in production: the GA4 reshaping (a unit error reports
  revenue ×100, unrecoverably), the Sentry redaction, and — section J — the vendor privacy rules:
  private paths, Speed Insights' `beforeSend`, the referrer rule, percent-encoded emails, the `q`
  rule and PostHog scrubbing by value. It also checks the event catalogue, the list cap and the
  ignored-error list. `tests/unit/analytics-privacy.test.ts` covers the same modules. Neither proves
  events arrive.
- Arrival is a browser task: open a page with the network tab filtered to `google-analytics`,
  `posthog` and `sentry`, walk a product → bag → checkout, and check each payload, including that
  URLs carry `[redacted]` rather than tokens. TODO.md §6 records that this has **not** been done
  against the real properties.

## 8. Owner actions — TODO.md §6

| Action | Why |
|---|---|
| GA4 → Admin → Data streams → web stream → Enhanced measurement → Page views → Advanced → **uncheck "Page changes based on browser history events"** | The storefront sends every page view itself, redacted; with the setting on, each client-side navigation is counted twice and GA's own count is unredacted |
| Enable Speed Insights in the Vercel dashboard | The component renders, but Vercel collects nothing until it is on |
| Decide on source maps (`SENTRY_AUTH_TOKEN`, the `@sentry/cli` build permission, `sourcemaps` in `next.config.mjs`) | Without them production stack traces are minified |
| Verify events against the real properties (§7) before trusting any number | Not yet done |
| PostHog → Project settings → turn on **Discard client IP data** (not yet listed in TODO.md §6) | PostHog otherwise stores every visitor's IP; no client option can stop it. The privacy notice is worded to stay true either way |
| GA4: keep **Google signals** off, do not link Google Ads, and review **Admin → Account settings → Data sharing** (not yet listed in TODO.md §6) | `allow_google_signals: false` covers the tag; account-level data sharing is outside what the tag can control |
| A consent approach (G-17) | Nothing currently gates analytics |

`pnpm verify:analytics` runs 125 checks (notes §1.30.14; section J added in Phase 37).
