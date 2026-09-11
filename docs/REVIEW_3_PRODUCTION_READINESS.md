# Review Pass 3 — production readiness, performance and failure simulation

Plan §36.1c. Performed in Phase 36 (2026-09-11). Input: the Review Pass 3 findings R3-01…R3-26 of the
earlier audit (`docs/PHASE_35_36_AUDIT.md`, working input, not committed), re-checked against the code
and against the deployed project (`vercel ls`, `vercel env ls` — variable names only), then fixed or
recorded. The failure simulations of §36.1c are answered by the harness or check that exercises each.

**No High or Critical issue that code can fix is open.** The three Highs that remain are deployment
settings only the owner can change, and they are listed below with the exact action.

## Deployment state (2026-09-11)

- **Production** is the Vercel project `north01apparel`, built with `pnpm build:deploy` (migrations run
  on deploy — `docs/DEPLOYMENT.md` §4), Node 22, functions in `iad1`. It carries `DATABASE_URL`,
  `PAYLOAD_SECRET`, `SITE_URL`, Cloudinary, Turnstile, GA4, PostHog and Sentry. It has **no Stripe,
  Resend, Algolia or `CRON_SECRET`**.
- **Preview** has no variables, so no preview can build.
- The post-deploy smoke test (`pnpm smoke <url>`) is read-only and safe against production.

## Findings

| ID | Sev. | Status | Detail |
|---|---|---|---|
| R3-01 | High | **Owner** | Production search has no Algolia keys or index — search and three filters are unavailable (browse still works from Postgres). DEPLOYMENT.md §6 |
| R3-02 | High → Low | Fixed | Production was four commits behind; it now deploys from `main` at every push |
| R3-03 | High | **Owner** | Preview has no variables — a Neon branch, a new `PAYLOAD_SECRET`, test keys (DEPLOYMENT.md §3) |
| R3-04 | High | Fixed | The E2E suite ran for the first time in Phase 35 — 43 passed, 0 failed, 14 skipped — and again at the end of this phase (below) |
| R3-05 | Medium | **Owner** | CI has no repository secrets, so CI never builds (TODO.md §8) |
| R3-06 | Medium | Recorded | Every storefront page renders per request — the root layout reads the bag and account cookies. **DEV-83** records the cause, the cost and the fix owed |
| R3-07 | Medium | Fixed (Phase 31) | Turnstile loads only when a visitor starts filling a form |
| R3-08 | Medium | **Owner** | Functions in `iad1`, Neon in `us-east-2` — set the region to `cle1` once confirmed |
| R3-09 | Medium | **Owner** | Production `SITE_URL` is the team alias; canonicals and the sitemap name it |
| R3-10 | Medium | Fixed (Phase 34) | Security headers on every route; CSP report-only and measured clean |
| R3-11 | Medium | Fixed (Phase 31) + owner | GA4 page views are sent once, by the site; switch off GA4's history-event setting (TODO.md §6) |
| R3-12 | Medium | Documented + owner | Migration checklist in DEPLOYMENT.md §4; queued builds and a Neon branch before a migrating deploy are dashboard actions |
| R3-13 | Medium | **Fixed** | Handled failures now reach Sentry (`lib/observability/report.ts`) — checkout, webhook, tax, oversold orders, catalogue, header |
| R3-14 | Medium | Fixed (Phase 31) | A database outage on the success page no longer says "order not found" |
| R3-15 | Medium | Fixed (Phase 31) | A session expiring mid-checkout says so |
| R3-16 | Medium | **Fixed** | Uploads capped at 4 MB — Vercel rejects request bodies over about 4.5 MB and uploads stream through the function. Larger files need direct-to-Cloudinary uploads (owed) |
| R3-17 | Medium | Fixed (Phase 31) | A branded error boundary; the header survives a database outage |
| R3-18 | Medium | Fixed (Phase 31) | A price change between bag and payment is shown |
| R3-19 | Medium | **Fixed** | An oversold order is marked `fulfilmentHold`, told the truth, and reported (Review Pass 1) |
| R3-20 | Medium | Fixed | The local database moved to the new Neon account |
| R3-21 | Low | Fixed (Phase 31) | Analytics load on idle |
| R3-22 | Low | Fixed (Phase 32) | Node 22 everywhere |
| R3-23 | Low | **Fixed** | Sentry's inert `disableLogger` removed |
| R3-24 | Low | **Fixed** | robots.txt's non-standard `Host:` line removed |
| R3-25 | Low | Accepted | A streamed page that fails renders its error boundary with HTTP 200; the boundary is `noindex` and responses are `no-store` (notes §1.36) |
| R3-26 | Low | Fixed (Phase 31) | Undecodable paths are a 404 |

## Failure simulations (§36.1c)

| Scenario | Behaviour | Evidence |
|---|---|---|
| Database unavailable | Header and footer render; the page shows the branded error; the success page says the order could not be read | notes §1.36; `(frontend)/error.tsx` |
| Search unavailable | Browse falls back to Postgres; search says it is unavailable, never "no results" | `verify:search`; E2E edge case 11 |
| Cloudinary asset unavailable | The reserved placeholder box, no broken icon, no layout shift | `media-frame.tsx`; E2E edge case "image failure" |
| Resend failure | Messages stay queued; an 8-second timeout; checkout and the webhook never wait on email | `verify:email` |
| Stripe webhook delayed | The success page says payment is being confirmed; only the webhook marks paid | `verify:webhook`; confirmation copy tests |
| Duplicate webhook | Processed once; a failed delivery is reprocessed exactly once | `verify:webhook` |
| Checkout cancelled / session expired | The bag is kept; the order can be checked out again | `verify:checkout`; E2E edge case |
| Payment rejected | Recorded; the session stays payable | `verify:webhook` |
| Product deleted / price changed / sold out during checkout | Refused or flagged in the bag and at preflight; an oversold payment is held | `verify:cart`, `verify:checkout`, `verify:webhook` |
| Expired discount | Refused at preflight and at payment | `verify:promotions` |
| Invalid URL parameters | Canonicalised or ignored; undecodable paths 404 | `tests/unit/proxy.test.ts` |
| Expired session | "Your session has ended" and the bag is kept | notes §1.36.4 |
| Unauthorized order access | "Not found", never "forbidden" | `verify:access`, `verify:account` |
| Missing CMS media / optional content | Sections omit themselves; placeholders keep their space | `verify:home`, `verify:editorial` |
| Large image upload | Refused above 4 MB with a clear message | `limits.ts`; `verify:media` |
| Empty database | Shell and pages render with no content; the homepage omits empty sections | `verify:shell` |

## Performance

Measured on 2026-09-11 against a local production build (`pnpm build && pnpm start`) of the
development database, with Playwright and the browser's own Performance APIs, no throttling. The server
runs on a laptop and the database is Neon in `us-east-2`, so every query crosses the internet — which is
the dominant cost below, and a different one from production's (functions in `iad1`, R3-08). JS, CSS and
image sizes are bytes as delivered to the page.

| Route | Viewport | TTFB ms | LCP ms | CLS | JS KB | CSS KB | Images KB |
|---|---|---|---|---|---|---|---|
| `/` | desktop | 91 | 428 | 0.000 | 686 | 64 | 101 |
| `/` | phone | 88 | 316 | 0.000 | 686 | 64 | 58 |
| `/shop` | desktop | 87 | 984 | 0.000 | 678 | 64 | 44 |
| `/shop` | phone | 88 | 860 | 0.000 | 678 | 64 | 44 |
| `/product/wool-overshirt` | desktop | 1028 | 2276 | 0.000 | 682 | 64 | 48 |
| `/product/wool-overshirt` | phone | 1023 | 2248 | 0.000 | 682 | 64 | 36 |
| `/collections/limited` | desktop | 1172 | 2452 | 0.000 | 687 | 64 | 16 |
| `/collections/limited` | phone | 1203 | 2556 | 0.000 | 687 | 64 | 16 |
| `/lookbook/aw26` | desktop | 441 | 1308 | 0.000 | 686 | 64 | 104 |
| `/lookbook/aw26` | phone | 433 | 1024 | 0.000 | 686 | 64 | 32 |
| `/journal/on-selvedge` | desktop | 1105 | 2404 | 0.000 | 643 | 64 | 7 |
| `/journal/on-selvedge` | phone | 1114 | 2952 | 0.000 | 643 | 64 | 13 |

What the numbers say:

- **Layout is stable everywhere** — CLS 0.000 on every route at both widths. Every image box is
  reserved before it loads (§8.1d), including the failure placeholder added in this pass.
- **The homepage and the shop are fast** (TTFB about 90 ms, LCP 0.3–1.0 s) because their reads are
  cached (`unstable_cache` with tag revalidation, notes §1.35).
- **Product, collection and journal pages spend about a second before the first byte.** They render
  per request (DEV-83) and each makes several uncached reads; from a laptop to `us-east-2` each one is
  a round trip across the internet. LCP follows TTFB by about 1.2 s. The two changes that move this are
  already recorded: caching those reads the way the homepage's are, and co-locating functions with the
  database (R3-08, an owner setting). Neither is a High: the pages are complete and stable, just slower
  to start than the cached ones.
- **JavaScript is about 640–690 KB per page**, almost all of it the framework and shared chunks — the
  spread between the lightest and heaviest route is 44 KB. 54 of the 96 components are client
  components; the large editorial and catalogue surfaces are server components, and the Sentry,
  PostHog and GA4 SDKs are loaded only when configured and only after the page is idle (Phase 30–31).
- **Images are small** — 7–104 KB per first view — because Cloudinary serves each at the size its slot
  needs (`sizes`), and the supplied photographs are themselves small (TODO.md §5).
- **Third-party scripts** are absent in this measurement (no keys locally); in production GA4 loads
  `lazyOnload` and PostHog on idle, so neither is on the critical path.

## Deployment checklist

| Item | State |
|---|---|
| Production build | Passes locally and on Vercel |
| Environment variables | Validated at startup (`env.core.ts`); production set listed above |
| Migration procedure | DEPLOYMENT.md §4; migrations run on deploy |
| Vercel deployment | Deploys from `main` |
| Stripe webhook endpoint | **Owner** — no keys yet (TODO.md §4) |
| Resend domain | **Owner** — TODO.md §2, DEPLOYMENT.md §11.3 |
| Cloudinary | Configured in production |
| Search index | **Owner** — R3-01 |
| Sentry | DSN set in production; handled failures now reported |
| Analytics | GA4 and PostHog set in production; GA4 history toggle owed |
