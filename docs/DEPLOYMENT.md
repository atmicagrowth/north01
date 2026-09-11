# Deployment

How NORTH / 01 is built, configured and released on Vercel — plan §32. Every environment variable
is defined in [`ENVIRONMENT.md`](ENVIRONMENT.md); the migration workflow and its rules are in
[`DATABASE.md`](DATABASE.md). This document is the procedure that ties them together, and the list of
what only the project owner can do.

## 1. The project

| Setting | Value | Where it is set |
|---|---|---|
| Framework | Next.js | `vercel.json` |
| Build command | `pnpm build:deploy` — `payload migrate && next build` | `vercel.json` (**D-16**: migrations are applied by the build, never by a running server) |
| Install command | `pnpm install --frozen-lockfile` (Vercel's default for a pnpm lockfile) | platform default |
| Node.js | **22.x** | `package.json` `engines` — matches `.nvmrc`, CI and `STACK_VERSIONS.md`. Until Phase 32 the range was open (`>=20.9.0`) and Vercel ran 24.x, a major no gate had exercised |
| Function region | **`cle1`** (Ohio), once the production Neon endpoint is confirmed to be `us-east-2` | Project Settings → Functions — **owner**, §9 |
| Scheduled jobs | the email drain, daily | `vercel.json` `crons` — §7 |
| Production branch | `main` — every push to `main` is a production deployment | Git integration |

## 2. Environments

Plan §32.1b–c and §4.1c. `appEnv` is derived from `VERCEL_ENV` (ENVIRONMENT.md, "The three
environments"), and **live Stripe keys outside production are a startup error**, not a warning.

| | Local | Preview | Production |
|---|---|---|---|
| Database | Neon development branch, direct endpoint | a Neon branch of its own — never production | production branch, **pooled** endpoint |
| `SITE_URL` | `http://localhost:3000` | unset: resolves to the preview's branch alias (Phase 32) | `https://north01apparel.vercel.app` (§9) |
| Stripe | test mode | test mode only — enforced | test mode until real payments are switched on |
| Algolia index | `north01_products_local` | `north01_products_preview` | `north01_products` |
| Cloudinary | shared cloud — **see §5** | shared cloud | shared cloud |
| Email | allowlist only (`EMAIL_DEV_ALLOWLIST`) | allowlist only | verified sending domain (Phase 33) |
| Analytics, Sentry, Turnstile | unset | test or non-production keys | production keys |

**Preview must never carry production customer data or production payment credentials.** The first
is a database decision (a Neon branch made for previews, not the production branch); the second is
enforced in code.

**What is set today** (`vercel env ls`, 2026-09-11): Production has `DATABASE_URL`, `PAYLOAD_SECRET`,
`SITE_URL`, Cloudinary (3), Turnstile (2), GA4, PostHog (2) and the Sentry DSN. **Preview and
Development have nothing**, so no preview deployment can build (audit R3-03). Production has no Algolia,
Stripe, Resend or `CRON_SECRET` variables.

## 3. Setting up Preview

1. Neon → create a branch for previews from the development branch (not from production). Use its
   **pooled** endpoint.
2. Vercel → Settings → Environment Variables → **Preview**: `DATABASE_URL` (that branch),
   `PAYLOAD_SECRET` (a new value), and test/non-production keys for any integration a preview should
   exercise. Leave `SITE_URL` unset — a preview names itself.
3. Open a pull request. The preview builds with `pnpm build:deploy`, which migrates **the preview
   branch** — the reason it must be a branch of its own.

## 4. Releasing — the migration procedure (plan §32.1d)

A deployment with no pending migration is a push to `main`. One **with** a pending migration
(`src/payload/migrations/` changed) follows all six steps, in order:

1. **Backup.** Neon → the production branch → *Branches* → create a branch from it named
   `pre-deploy-<short sha>`. That is a restorable copy at this instant, and it costs nothing until it
   diverges.
2. **Apply migrations in controlled order.** The build does it: `payload migrate` runs before
   `next build`, in filename order, as one batch. Migrations are written *expand, then contract* —
   add a column in one release, stop using the old one in a later one — so the previous deployment
   keeps working against the new schema while the new one builds. Production builds must be
   **queued, never concurrent** (§9), or two builds migrate at once.
3. **Deploy.** Push to `main`. Watch the build log for `payload migrate`'s output.
4. **Verify the schema.** `pnpm migrate:status` against production lists every migration as run.
   It needs production's `DATABASE_URL` in the shell for that one command — never in `.env`.
5. **Smoke-test.** `pnpm smoke https://north01apparel.vercel.app` (§8). No `FAIL`; read every `WARN`.
6. **Monitor.** Sentry for new issues, `vercel logs` for 5xx, for at least the next hour.

**Rolling back.** The application: Vercel → Deployments → the previous one → *Promote to Production*
(`vercel rollback`). Expand/contract means the previous build runs against the new schema. The
database, only if a migration destroyed data: restore from the `pre-deploy-<sha>` branch.

## 5. Cloudinary is shared between environments

Development and production use the **same Cloudinary cloud**, and a media record's public id is derived
from its filename — so the same object is addressed from both. **Never run `pnpm generate:media --clean`
or delete media documents in bulk against any database**: deleting a Payload upload tells the storage
adapter to delete the object, and production renders it too (notes §1.34.3). Both media scripts are
incremental and safe to repeat.

## 6. The production search index

Search, the typeahead's products and the colour, size and collection filters all read Algolia. Without
it they degrade to a stated *"isn't available"* — which is production's state today (audit R3-01).
Adding keys is not enough: the `north01_products` index does not exist until it is built.

1. Algolia → create a production application, or production-scoped keys: a **search-only** key and a
   **write** key (not the admin key).
2. Vercel → Production: `NEXT_PUBLIC_ALGOLIA_APP_ID`, `NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY`,
   `ALGOLIA_WRITE_API_KEY`.
3. Build the index once, from a shell holding **production's** `DATABASE_URL`, the write key, and
   `VERCEL_ENV=production` (which selects the `north01_products` index): `pnpm reindex`, then
   `pnpm reindex:check`. Nothing in that shell may be written into `.env`.
4. Redeploy, then `pnpm smoke` — the search line should pass.

From then on the index follows the catalogue by itself: every product write from the admin reaches it
through `syncSearchIndex`.

## 7. The scheduled email drain (DEV-67)

Queued emails are delivered on the next webhook, by staff from the admin, and — since Phase 32 — by a
**daily** Vercel Cron request to `GET /api/email/drain` (`vercel.json`). Vercel sends
`Authorization: Bearer <CRON_SECRET>`; the route compares it in constant time and answers 401 to
anything else, including when no secret is set. Daily is the one schedule every Vercel plan accepts —
a more frequent expression fails the deployment on Hobby. On Pro, tighten it (`*/15 * * * *`).

Owner: set `CRON_SECRET` in Production (§9). Crons run on production deployments only.

## 8. CI and the smoke test

**CI** (`.github/workflows/ci.yml`) runs typecheck, lint, format, unit and component tests, the pure
harnesses and the secret scan on every push. Its **build** step needs repository secrets it has never
had (audit R3-05): `DATABASE_URL` — a non-production branch, ideally a read-only role, since
`next build` only reads — and `PAYLOAD_SECRET`, plus the variable `SITE_URL`. The **E2E** job also
needs a disposable Neon branch as `E2E_DATABASE_URL` and `E2E_DATABASE_IS_DISPOSABLE=true`.

**The smoke test** — `pnpm smoke <url>` — is read-only and safe against production: every request is
a GET except one unsigned POST the Stripe webhook must refuse. It checks the homepage (and that its
canonical names the host being tested), the shop, a product page and its JSON-LD, search, the bag,
checkout's empty-bag redirect, the admin, the webhook's refusal, `robots.txt`, the sitemap's host, a
404, and that `/reset-password` loads no analytics script. `FAIL` exits non-zero; `WARN` is a working
deployment configured in a way worth knowing about.

First run against production, 2026-09-11: **9 passed, 3 warnings, 0 failed** — the warnings are the
canonical and sitemap host (§9, `SITE_URL`) and search (§6).

## 9. What only the owner can do

| Action | Why |
|---|---|
| Set Production `SITE_URL` to `https://north01apparel.vercel.app` (or the custom domain, Phase 33) | It is the team alias `north01apparel-mi-ca-growth.vercel.app`, so every canonical, the sitemap, reset links and Stripe return URLs name a host customers do not use. The smoke test warns about it |
| Populate Preview (§3) | No preview can build (R3-03), so no change is rehearsed before production |
| Build the production search index (§6) | Search and three filters are unavailable in production |
| Set `CRON_SECRET` in Production (§7) | The daily drain refuses the cron without it |
| Confirm the production Neon region; if `us-east-2`, set the Function region to `cle1` | Functions run in `iad1`, so every query crosses regions (R3-08) |
| Project Settings → Git → enable **queued** production builds (no concurrent builds) | Two concurrent builds would migrate at once (R3-12) |
| Add the CI repository secrets (§8) | CI has never built the application (R3-05) |
| Switch off GA4's "page changes based on browser history events" | The storefront sends every page view itself (TODO.md §6) |
| Take a Neon branch before any deploy that carries a migration (§4) | There is no automatic backup |
| When a custom domain is bought, follow §11 in order | Every integration below names the host; changing it is one variable and five dashboards |

## 10. Platform behaviour worth knowing

- **A malformed percent-encoding** (`/product/%E0%A4%A`) is answered **400 by Vercel's edge**, before the
  application sees it. `src/proxy.ts` turns the same URL into the branded 404 under `next start`.
- **`NEXT_PUBLIC_` variables are fixed at build time.** Adding GA4, PostHog, Sentry or Turnstile keys in
  the dashboard changes nothing until the next build — which is how Phase 30's deploy switched on six
  integrations at once (notes §1.36.1).

## 11. A custom domain and its DNS — plan §33

**Today there is no custom domain.** The shop is served on Vercel's hosts — `north01apparel.vercel.app`
and the team alias — which plan §33.1a says is sufficient during development. HTTPS is Vercel's, with
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` on every response (measured,
2026-09-11). The team's Vercel account holds one unrelated domain, `dippedncolorsplatstudio.com`; nothing
here touches it.

This section is the procedure for the day a domain is bought, written so nothing is changed blind:
**inspect the domain's existing records first, export them, and change only the ones named here** —
a domain that already receives mail has MX and SPF records that must survive.

### 11.1 Point the domain at Vercel

1. Vercel → Project → Settings → **Domains** → add both `example.com` and `www.example.com`. Choose one
   as the canonical host and set the other to **redirect** to it (308). That is the canonical-host
   redirect plan §33.1b asks for; Vercel serves it at the edge, so the application needs no code for it.
2. In **Cloudflare DNS**, add exactly the records Vercel's Domains page shows for the project. For most
   projects they are:

   | Type | Name | Value | Proxy status |
   |---|---|---|---|
   | `A` | `@` | `76.76.21.21` | **DNS only** (grey cloud) |
   | `CNAME` | `www` | `cname.vercel-dns.com` | **DNS only** (grey cloud) |

   Vercel may show project-specific values instead; **the Domains page is the source of truth**, and
   these are only what to expect. Leave the records **unproxied**: Vercel issues and renews the
   certificate itself, and Cloudflare's proxy in front of it breaks that issuance and double-caches
   pages whose freshness this application manages. If the domain must be proxied, Cloudflare's SSL mode
   has to be **Full (strict)** — never Flexible, which serves the shop over HTTP between the two.
3. Wait for Vercel to show both domains **Valid Configuration** and a certificate issued.

### 11.2 Tell the application, and every service that names the host

| Where | Change | Why |
|---|---|---|
| Vercel → Production `SITE_URL` | `https://example.com` (the canonical host) | canonicals, sitemap, `robots.txt`, reset links, Stripe return URLs, Payload `serverURL` and the CSRF allowlist all follow it |
| Cloudflare Turnstile → the widget → hostnames | add `example.com` and `www.example.com` | a widget refuses a host it does not list — sign-in and registration would stop |
| Stripe → Webhooks | an endpoint at `https://example.com/api/stripe/webhook`, and its new signing secret as `STRIPE_WEBHOOK_SECRET` | the signature is per endpoint |
| Google Search Console | add the property, submit `https://example.com/sitemap.xml` | the sitemap names the new host once `SITE_URL` does |
| Resend | §11.3 | email from the domain |

Then redeploy (a `NEXT_PUBLIC_` or build-time value changes nothing until a build), and run
`pnpm smoke https://example.com` — the canonical and sitemap lines must pass, not warn.

### 11.3 Email from the domain — Resend (plan §33.1c)

Resend → Domains → add a **sending subdomain** such as `send.example.com` (keeps the apex's own mail
records untouched), then add in Cloudflare **exactly the records Resend displays** — they are
region-specific, so none are reproduced here as values. Their shape is:

| Type | Name | What it is |
|---|---|---|
| `TXT` | `resend._domainkey.send` | **DKIM** — the public key Resend signs with |
| `MX` | `send` | the bounce/feedback route Resend's sending service uses (priority as shown) |
| `TXT` | `send` | **SPF** — `v=spf1 include:…` naming Resend's sending service |
| `TXT` | `_dmarc` | **DMARC** — start with `v=DMARC1; p=none; rua=mailto:…`, tighten to `quarantine` once reports are clean |

All **DNS only**. When Resend shows the domain **Verified**, set `EMAIL_FROM` to an address on it (for
example `NORTH / 01 <orders@send.example.com>`) and `RESEND_API_KEY` in Production.

**Do not call email production-ready until Resend says Verified** (§33.1c), and until one message has
reached a real inbox through `EMAIL_DEV_ALLOWLIST` on a preview. An unverified domain sends nothing, and
a verified one without DMARC lands in spam.

### 11.4 Verification

- `curl -I https://example.com` → `200`, with `Strict-Transport-Security`.
- `curl -I https://www.example.com` → `308` to `https://example.com/`.
- `curl -I http://example.com` → a redirect to `https://`.
- `pnpm smoke https://example.com` → no `FAIL`, and no `WARN` on the canonical or the sitemap.
- Sign in and save an address on the new host — a Server Action carries the new `Origin`, which the CSRF
  allowlist accepts because it follows `SITE_URL` (Phase 33, `lib/trusted-origins.ts`).
- Resend shows **Verified**; a password-reset email sent to an allowlisted address arrives, and its link
  names the new host.
