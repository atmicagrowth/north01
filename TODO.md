# TODO — things only the project owner can do

## 1. ~~Send a development Neon connection string~~ — DONE, and redone

**Moved 2026-09-10.** The original `development` branch, `ep-green-boat-axabhusu`, stopped accepting
its password after production moved to a new Neon account, and its data could not be read. `.env` now
points at **`ep-wandering-surf-ax7ia116`** on the new account, and `DATABASE_PUSH_TARGET` names the
same database, so decision **D-10** is satisfied. It was rebuilt to the Phase 29 demo state with the
project's own scripts (`seed`, `generate:media`, `import:media`, `reindex`) — see Notes §1.35.8.

**Production's endpoint needs confirming.** This file said production was `ep-delicate-waterfall-axjoiwvz`;
if production now lives on the new account, update this line with its endpoint so nothing local is ever
pointed at it by mistake.

### What is still owed against it

Nothing technical. Every `verify:*` harness now runs against this database at each phase, and the
57 Playwright tests first ran in Phase 35 (43 passed, 0 failed, 14 skipped — `docs/TESTING.md`).

### Rotate the role anyway

`neondb_owner`'s password has now appeared in a chat transcript **four times** — most recently with
the new development branch on 2026-09-10 — and should be treated as exposed. Neon → **Roles** →
`neondb_owner` → **Reset password** on the new account, then update `.env` and Vercel's
`DATABASE_URL`. Put the new value in those two places only, never in a chat.

---

## 2. Resend — needed before any email actually sends

Phase 19 is complete and has never delivered a message, which is deliberate and recorded as
**DEV-62**'s shape a second time in `NORTH01_Implementation_Notes_and_Deviations.md` §1.24.8.

Three values, all documented in `docs/ENVIRONMENT.md`:

| Variable | Where it comes from |
| --- | --- |
| `RESEND_API_KEY` | Resend → API Keys |
| `EMAIL_FROM` | Resend → Domains, **after the sending domain is verified** |
| `EMAIL_DEV_ALLOWLIST` | Your own address. Outside production nothing is delivered to anyone else, and an empty value delivers to nobody at all |

Until these exist the queue still records every message correctly; `pnpm email:drain` sends the
backlog the moment they appear. Nothing is lost in the meantime.

**A verified sending domain is required before any production send** — Resend rejects unverified
ones, and a shop that cannot send a password reset is a shop nobody can get back into.

---

## 3. ~~Cloudinary~~ — DONE for Production; Preview still needs it

Production has `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`
(`vercel env ls`, 2026-09-11), so uploads through `/admin` survive a redeploy. Preview has none, like
every other Preview variable — see §8. The cloud is **shared** with development: never run
`generate:media --clean` (docs/DEPLOYMENT.md §5).

---

## 4. Stripe — checkout is built and has never taken a payment

`DEV-62`. The checkout page says so rather than showing a form that can only fail. Signature
verification is verified offline; what has never run is one live `checkout.sessions.create`.

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, plus a webhook
endpoint pointed at `/api/stripe/webhook`.

**Enable Stripe Tax in the Stripe Dashboard** (Phase 36, audit R1-02). Checkout calculates tax with
`stripe.tax.calculations.create` as soon as the keys exist, and that needs, under *Tax* in the
Dashboard: the business **origin address**, and a **registration** for every place the shop must
collect tax. **Without registrations every calculation returns zero tax** — checkout will work and
charge no tax anywhere, which looks like success. Check one calculation against a registered address
before taking real orders.

---

## 5. Larger product photography — optional, and the most visible gap

The sixteen supplied photographs are 224–467 px wide. They are used where that size is honest —
category tiles, editorial surfaces — and the product galleries kept the generated fabric studies,
because a product page renders an image at up to 1400 px and an upscaled 264 px photograph reads as a
mistake.

Export the garment shots larger and the placement map in `scripts/import-brand-media.ts` is the one
file to change.

---

## 6. Analytics and error reporting — keys are set in Production; two settings remain

Production has `NEXT_PUBLIC_GA_MEASUREMENT_ID`, the PostHog key and host, and `NEXT_PUBLIC_SENTRY_DSN`
(`vercel env ls`, 2026-09-11). Preview and local have none, which is the intended local state.

**Switch off one GA4 setting.** GA4 → Admin → Data streams → the web stream → Enhanced measurement →
**Page views → Advanced → uncheck "Page changes based on browser history events"**. The storefront
sends every page view itself, with sensitive query values redacted (Phase 31 hotfix); with this
setting on, every client-side navigation is counted twice.


Every integration is behind a key check, so with none of these set the SDKs are **never loaded** —
`posthog-js` is not even fetched. That is the intended local state, not a broken one.

| Variable | Where it comes from | What it turns on |
| --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_KEY` + `NEXT_PUBLIC_POSTHOG_HOST` | PostHog → Project settings | §25.1b behavioural analytics |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | GA4 → Admin → Data streams (`G-…`) | §25.1c ecommerce events |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry → Project → Client keys | §25.1d error reporting, browser and server |

### Two things a variable cannot do

1. **Vercel Speed Insights must be enabled in the dashboard** — Vercel → your project → **Speed
   Insights** → Enable. The component is mounted and renders in production only (§25.1e), and it
   reports nothing at all until that toggle is on. Do not look for data before flipping it.

2. **Production stack traces will be minified.** Source-map upload needs `SENTRY_AUTH_TOKEN` and is
   deliberately off: `pnpm-workspace.yaml` denies `@sentry/cli`'s postinstall so its ~20 MB binary is
   never fetched, in CI either. Turning it on is three coordinated changes — the token, the
   `allowBuilds` entry, and `sourcemaps` in `next.config.mjs` — and it belongs to whoever owns the
   Sentry organisation.

### Verify before trusting a number

The Phase 25 prompt asks for it in as many words: *"verify events in local/preview environments
before enabling production measurement."* That has **not** been done — no account exists to do it
against. The taxonomy and the GA4 reshaping are covered by `pnpm verify:analytics` (115 checks); what
is unverified is that events arrive, which only a network tab against a real property can show.

---

## 7. Cloudflare Turnstile — set in Production (2026-09-11); Preview and local have none

Phase 26 wired verification into the newsletter, review submission, registration and login forms. With
no keys, **the widget is not rendered and nothing is verified** — by design, and stated here rather
than implied to be protection that exists.

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare → Turnstile → your site |
| `TURNSTILE_SECRET_KEY` | same page, the secret half |

Both are needed. A site key with no secret is treated as **unconfigured**, deliberately: a widget
nothing can verify is decoration, which is exactly what §26.1a warns against.

### One consequence to know before you set them

**If Cloudflare is unreachable, those four forms stop accepting submissions.** That is the one control
in this application that fails closed, and it is the correct trade for a control whose whole purpose
is to refuse — the alternative is no bot protection at all, on exactly the forms an attacker is
hammering, at a moment the attacker can cause. Deviation **DEV-75** records it.

Use the **Managed** widget type unless you have a reason not to; it is the one that challenges only
when it needs to.

---

## 8. Deployment settings — Phase 32

The full list, with the reason for each, is **[`docs/DEPLOYMENT.md` §9](docs/DEPLOYMENT.md)**. In
short, all in the Vercel, Neon, Algolia or GitHub dashboards:

- **Production `SITE_URL` → `https://north01apparel.vercel.app`.** It is the team alias today, so
  canonicals, the sitemap, reset links and Stripe return URLs name a host customers do not use.
  `pnpm smoke` warns about it.
- **Populate the Preview environment** — a Neon branch of its own, a new `PAYLOAD_SECRET`, test keys.
  No preview can build until then.
- **Build the production search index** — production Algolia keys in Vercel, then `pnpm reindex` once
  under the production environment (DEPLOYMENT.md §6). Search and three filters are off until then.
- **`CRON_SECRET`** in Production, for the daily email drain.
- **Function region `cle1`**, once the production Neon endpoint is confirmed to be `us-east-2`.
- **Queued production builds**, so two deployments never migrate at once.
- **CI repository secrets** — `DATABASE_URL` (non-production, read-only role), `PAYLOAD_SECRET`,
  and the variable `SITE_URL`.
- **When a custom domain is bought** — follow [`docs/DEPLOYMENT.md` §11](docs/DEPLOYMENT.md) in order:
  Vercel domains with the `www` redirect, unproxied Cloudflare records, then `SITE_URL`, Turnstile's
  hostnames, the Stripe webhook endpoint, and Resend's DNS (Phase 33).

## 9. A privacy policy and terms — the site collects personal data with no notice

Gap G-19, audit DOC-08. The shop takes names, email addresses, postal addresses and phone numbers,
and it keeps order history, and there is no privacy notice and no terms of sale. The footer's legal row
is empty on purpose (`src/lib/navigation/utility.ts`): these are legal texts somebody has to write and
answer for, so no page with made-up wording was built.

- **Supply the two texts** — a lawyer's, or a reviewed template's. [`docs/SECURITY.md`](docs/SECURITY.md)
  lists what the shop actually collects, where it goes (Stripe, Resend, analytics, logs) and how long
  it is kept. That is the factual input a privacy policy needs.
- **Say where they should live** — pages in the admin, or files in the repository. When the text
  exists, adding the two routes and the footer links is a small change.

## 10. How long personal data is kept — five decisions

[`docs/SECURITY.md` §4](docs/SECURITY.md) lists them with the reasoning. In short: how long an
**unpaid** order keeps its email and address; how long the email outbox is kept; what an erasure
request does to orders; a self-service newsletter unsubscribe before the first marketing email; and
whether editors, not only admins, should read the subscriber list and the outbox. Each is a small
change once the answer exists.

A sixth, about staff rather than customers (Phase 36, audit R1-17): **editors can update an order's
fulfilment and tracking, and create and edit discount codes.** Credentials and order ownership are
already admin-only. If only admins should touch orders or promotions, say so and it is a one-line
access change each; if editors should, it is recorded as intended.

## 11. Production content — Phase 35

The storefront hides what is missing rather than showing it broken, but only you can fill it in:

- **Navigation (admin → Navigation):** delete the About and Contact entries and point FAQ at
  `/help/faq`. Links to pages that do not exist are now dropped automatically, so the header is not
  broken meanwhile — just shorter.
- **Phase 29's editorial content never reached production:** the homepage Shop the Look, the journal
  articles and the second lookbook. Either run the seed against production deliberately (see
  `docs/DATABASE.md`) or author them in the admin.
- **Social handles:** the footer shows none until real accounts are added in Navigation → Social.
- **Photography (§5):** the supplied photographs are 217–467 pixels wide and have white borders, so
  every full-width image is visibly soft. Larger, borderless exports are the fix.

## 12. Wording to update in the live admin — Phase 36

The seed now writes these, but production's content was entered separately and still carries the old
wording, which promises an online returns flow that does not exist and names an address that cannot
receive mail (audit DOC-01, DOC-02):

- **FAQ — "Can I return something?"** → *Anything unworn, with its tags on, can be returned within 30
  days of delivery. Returns are arranged with our team rather than started online.*
- **Site settings → Returns policy**, second paragraph → *Returns are arranged with our team rather
  than started online. Contact details for returns will be published here.*
- **FAQ — "Can I change or cancel an order after placing it?"** → remove the `help@north01.example`
  address: *Contact us as soon as you can and we will try. Once an order is packed we cannot alter it,
  and after that the answer is a return. Contact details will be published here.*
- **Site settings → Contact email** → clear it until a real support mailbox exists. Emails already
  ignore the placeholder as a reply-to.
- **Then supply a real support address** (gap G-08), and the three sentences above can name it.
