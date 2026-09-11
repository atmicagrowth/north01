# Testing

Plan §27 and §38. The test layers, what each one proves, how to run it, and where it must never be
pointed. Written from the code (2026-09-11). Day-to-day commands are also in
[`DEVELOPMENT.md`](DEVELOPMENT.md) ("Scripts", "Tests", "Phase completion gate"). This document adds
the gate as one sequence, a matrix of what each harness touches, and the inventory of E2E skips.

## 1. The layers

| Layer | Where | Command | Needs |
|---|---|---|---|
| Unit | `tests/unit/*.test.ts` (18 files) | `pnpm test:unit` | nothing: Node environment, no DOM |
| Component | `tests/components/*.test.tsx` (8 files) | `pnpm test:components` | nothing: jsdom, `tests/setup/components.ts` |
| Both | — | `pnpm test:run` (CI), `pnpm test` (watch) | — |
| Harnesses | `scripts/verify-*.ts` (22) | `pnpm verify:<name>` | most need the **development** database (§3) |
| Secret scan | `scripts/scan-secrets.ts` | `pnpm scan:secrets` | git |
| Smoke | `scripts/smoke.mjs` | `pnpm smoke <url>` | a running deployment |
| End-to-end | `tests/e2e/*.spec.ts` (5 specs) | `pnpm exec playwright test` | a running production build on a database it may write to (§5) |

`vitest.config.ts` defines the two Vitest projects and aliases `server-only` to an empty stub
(`tests/stubs/server-only.ts`), so a component that imports a guarded module still resolves. A unit
test that reaches for `window` fails.

The harnesses predate Vitest (Phase 7 onwards, when plan §2.1b forbade installing Phase 27's framework
early) and are **not** replaced by it: they drive the real Payload access layer, hooks and Postgres
constraints, which Vitest cannot reach. Each runs as `payload run scripts/<name>.ts`, prints one line
per named check, and exits non-zero on any failure.

## 2. The verification gate — before every commit

`AGENTS.md` and DEVELOPMENT.md "Phase completion gate". In order, cheapest first, the same as
`.github/workflows/ci.yml`:

```bash
pnpm typecheck
pnpm lint            # --max-warnings 0
pnpm format:check
pnpm test:run
pnpm verify:seo && pnpm verify:analytics && pnpm verify:security && pnpm scan:secrets
pnpm build
# plus every verify:* harness the change touches, against the development database
```

CI runs the first five steps on every push and pull request, the build only when the repository has a
`DATABASE_URL` secret (it has never had one — DEPLOYMENT.md §8, audit R3-05), and E2E only when
`vars.E2E_DATABASE_IS_DISPOSABLE == 'true'`.

## 3. The harnesses, and D-10

**D-10** is the guard that makes a destructive run against anything but the development database
impossible rather than unlikely. Every harness that writes starts with
`if (!developmentDatabase.ok) throw new Error('… refuses to run …')`. `developmentDatabase`
(`src/lib/env.core.ts`, `resolveDevelopmentDatabase`) is true only when `DATABASE_URL` names the same
`host[:port]/database` as `DATABASE_PUSH_TARGET`; unset, unparseable or different all mean no. It
deliberately does not trust `appEnv`, which reads `local` on a laptop pointed at production. See
[`ENVIRONMENT.md`](ENVIRONMENT.md), "The schema-push guard — D-10".

**Never point a writing harness, the seed, the media scripts or the E2E suite at production.** They
create and delete customers, orders, products and message rows. Do not work around the guard by
setting `DATABASE_PUSH_TARGET` to production.

| Script | Proves | Writes | External keys |
|---|---|---|---|
| `verify:access` | Phase 7 access matrix: cross-customer reads, role escalation, ownership, disabled accounts, password policy, the Turnstile gate — through the Local API with `overrideAccess: false` | yes, D-10 | — |
| `verify:media` | §8.1b upload rules (mime allowlist, magic bytes, disguised executables, dimension cap), §8.1c URL grammar, §8.1d layout geometry | yes, D-10 | Cloudinary optional (live round trip) |
| `verify:shell` | Navigation route map, link validation and every nav edge case, against real documents in three publication states | yes, D-10 | — |
| `verify:home` | Homepage block resolution: drafts, scheduled and variant-less products dropped, rails, price formatting | yes, D-10 | — |
| `verify:catalog` | Filter edge cases and card states; draft, scheduled and withdrawn products never listed; Postgres and Algolia agree | yes, D-10 | Algolia optional |
| `verify:search` | Search rules and the overlay state machine | yes, D-10 | Algolia optional (skipped-and-passing without) |
| `verify:product` | The variant matrix (§13.1c), including impossible combinations | yes, D-10 | — |
| `verify:cart` | All seven §14.1b edge cases, merges and totals | yes, D-10 | — |
| `verify:promotions` | §15.1a's eight checks and §15.1c's eight edge cases, the unique code index, per-customer counts | yes, D-10 | — |
| `verify:shipping` | Shipping and tax provider boundaries (§16) | **no database** | — |
| `verify:checkout` | Payment state machine, preflight, both idempotency barriers; the Stripe signature checked offline with a fabricated secret | yes, D-10 | — |
| `verify:webhook` | Webhook effects on real rows: idempotency, the transaction, the inventory race, via `applyStripeEvent` | yes, D-10 | — |
| `verify:email` | Idempotent sends (including two concurrent enqueues), retry ceiling, the dev allowlist, failure recording — with a fake transport | yes, D-10 | — (see [`EMAIL.md`](EMAIL.md)) |
| `verify:account` | Cross-account access prevention; wishlist and recently-viewed merge | yes, D-10 | — |
| `verify:reviews` | Unauthorised submissions, duplicates, §21.1c abuse cases, rendering rules | yes, D-10 | — |
| `verify:lookbook` | Shop the look never guesses a size or a missing variant (§22) | yes, D-10 | — |
| `verify:editorial` | Unpublished content, missing hero media, empty or deleted related products (§23) | yes, D-10 | — |
| `verify:orders` | Legal and illegal status transitions; order lines immutable after product edits — as refused writes | yes, D-10 | — |
| `verify:seo` | §24.1b's structured-data prohibitions, canonicals, sitemap | **no database**; CI | — |
| `verify:analytics` | GA4 reshaping (minor units, indices) and Sentry redaction — 115 checks | **no database**; CI | — (see [`ANALYTICS.md`](ANALYTICS.md)) |
| `verify:security` | Every `verifyTurnstile` branch, the redirect validator, upload rules, secret patterns | **no database**; CI | — |
| `verify:admin` | §28.1d: no arbitrary status transitions, invalid refunds, negative stock, duplicate SKUs or malformed publishes — refused by access, validators, hooks or constraints | yes, D-10 | — |

Related scripts:

| Script | What it does |
|---|---|
| `pnpm reindex:check` | Reports drift between Postgres and the Algolia index; writes nothing; exit 1 on drift. Refuses to run without Algolia. See [`SEARCH.md`](SEARCH.md) |
| `pnpm scan:secrets` | Scans every `git ls-files` path for secret patterns (`src/lib/security/secret-patterns.ts`). CI |
| `pnpm smoke <url>` | Read-only post-deployment check; the one script **safe against production**. See [`DEPLOYMENT.md`](DEPLOYMENT.md) §8 |

`seed`, `generate:media`, `import:media` and `baseline-migrations` carry the same D-10 guard.
`email:drain` has its own refusal ([`EMAIL.md`](EMAIL.md) §5).

## 4. Unit and component tests

Unit tests cover pure rules: money, cart totals, merges and price changes, inventory, variants, size
order, promotions, shipping, tax, order state, checkout confirmation, navigation routes, search
mapping, the proxy, trusted origins, reply-to filtering and privacy redaction (`tests/unit/`).
Component tests cover the interactive controls a customer uses: bag line, checkout form, filters,
login form, quantity, search overlay, variant selector, wishlist button (`tests/components/`).

## 5. End-to-end — Playwright

`playwright.config.ts`: Chromium desktop for every spec except `mobile-navigation.spec.ts`, which runs
on a Pixel 7 profile. `baseURL` is `E2E_BASE_URL` (default `http://localhost:3000`). A server is
started only when `E2E_START_SERVER=1` (`pnpm build && pnpm start`); otherwise the suite expects one
already running. Retries 0 locally, 1 in CI. `tests/e2e/fixtures.ts` holds shared routes and
sequences (register, sign in, add the first available variant to the bag) and assumes Turnstile is
unconfigured or on Cloudflare's always-pass test keys.

### How it was run

```bash
# once per machine
pnpm exec playwright install --with-deps chromium

# a production build against the development database
pnpm build && PORT=<port> pnpm start

# in a second shell
E2E_BASE_URL=http://localhost:<port> pnpm exec playwright test --workers=1
```

`--workers=1` because the flows share a database: two workers racing one guest bag or discount code
fail for reasons that belong to the harness. Confirm what the port serves before trusting a run
(DEVELOPMENT.md, "Accessibility").

**First run, Phase 35** (notes §1.40.7): 38 passed, 5 failed, 14 skipped. One failure was a shop defect
(the pending-review sentence disappeared), one a configuration defect (`next start` on a laptop
resolved as production, audit R1-19), three were the suite's own. After the fixes: **43 passed,
0 failed, 14 skipped.** The docblocks of `playwright.config.ts`, `fixtures.ts` and the specs still say
the suite has never run; this is the current record.

### The skips

Every skip is a `test.skip` in the spec with its reason. Unconditional skips cannot pass from a
browser by design. Conditional ones depend on the environment or on CMS content.

| Spec · test | Condition | Reason |
|---|---|---|
| `core-flows` · flow 4 — quick view → add to cart | always | No quick view exists (**DEV-74**) |
| `checkout` · a verified-purchase badge appears only on a review by someone who paid | always | Needs a paid order, which only a signed Stripe webhook can produce |
| `edge-cases` · a product unpublished after page load stops being reachable | always | Needs a server-side mutation mid-test (`products.status` → draft) |
| `edge-cases` · a price edited between the bag and checkout is refused | always | Needs a server-side mutation mid-test (`variants.priceMinor`) |
| `edge-cases` · a code that expired between the bag and checkout is shown as expired | always | Needs a promotion with a past `endsAt` — a database write (D-10). Covered by `verify:promotions` |
| `edge-cases` · a webhook delivered twice finalises the order once | always | Covered by `checkout` flow 7 and `verify:webhook` |
| `checkout` · checkout shows a payment form or says payment is unavailable | no form rendered | The deployment shows the **DEV-62** unavailable notice |
| `checkout` · the real Stripe test-mode path | Stripe unconfigured, or `STRIPE_SECRET_KEY` not a test key | Would open a real Checkout Session; a live key could take money |
| `checkout` · flow 7, all six webhook tests (unsigned, wrong secret, old timestamp, unknown type, duplicate, unknown order) | `STRIPE_WEBHOOK_SECRET` unset, or the route answers 503 | The harness cannot sign an event the route would accept |
| `checkout` · a signed-in customer may review once, held for moderation | a Turnstile widget is present | A headless browser cannot solve the challenge |
| `checkout` · four shop-the-look tests (preview, no size guessing, add entire look, no-JS link) | no published hotspot | CMS content, not code |
| `edge-cases` · a sold-out size is disabled and still readable | no zero-stock variant | Nothing sold out to inspect |
| `edge-cases` · an image whose bytes never arrive keeps its box | the page requested no images | Nothing to abort |
| `mobile-navigation` · tapping a group expands it and never navigates | no navigation item has columns | CMS content, not code |

The Phase 35 run's 14 skips are, by these conditions, the six unconditional skips plus the two Stripe
checkout tests and the six webhook tests (the development environment had no Stripe keys). The run
record gives only the count, so this breakdown is inferred.

To run the Stripe tests, set test-mode `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and
`STRIPE_WEBHOOK_SECRET` in the environment of the server under test and of the Playwright process.

### Accessibility

`tests/e2e/accessibility.spec.ts` runs axe over six routes at WCAG 2.0/2.1 A and AA and expects zero
violations. A manual pass is still required; see DEVELOPMENT.md, "Accessibility".

### Never against production

The suite registers customers, fills bags, submits reviews and, with Stripe keys, opens Checkout
Sessions. It must only point at a server whose database may be ruined: the development database
locally, or in CI a disposable Neon branch (`E2E_DATABASE_URL`, `E2E_DATABASE_IS_DISPOSABLE=true`,
DEPLOYMENT.md §8). **D-10**.
