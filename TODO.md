# TODO — things only the project owner can do

## 1. ~~Send a development Neon connection string~~ — DONE

**Resolved 2026-09-09.** The `development` branch exists on endpoint `ep-green-boat-axabhusu`,
`.env` points at it, and `DATABASE_PUSH_TARGET` names the same database — so decision **D-10** is
satisfied and every harness is free to run. Its migration chain matches production's twelve, batch
for batch.

Production remains `ep-delicate-waterfall-axjoiwvz` and is what Vercel's `DATABASE_URL` holds.
Nothing local points at it any more.

### What is still owed against it

The five harnesses blocked since Phase 19, and the 57 Playwright tests, have **not been run yet** —
deliberately deferred so the phase work could continue. In rough order of value:

| Harness | Checks | Why it matters most |
| --- | --- | --- |
| `pnpm verify:access` | 48 | **First.** Phase 26 changed `customers.create` and could not re-verify it |
| `pnpm verify:email` | 85 | |
| `pnpm verify:account` | 40 | |
| `pnpm verify:reviews` | 30 | |
| `pnpm verify:lookbook` | 20 | |
| `pnpm verify:editorial` | 24 | |
| `pnpm test:e2e` | 57 | Needs `pnpm exec playwright install --with-deps chromium` once, and `E2E_START_SERVER=1` |

### Rotate the role anyway

`neondb_owner`'s password has now appeared in a chat transcript **three times** and should be treated
as exposed. Neon → **Roles** → `neondb_owner` → **Reset password**, then update `.env` and Vercel's
`DATABASE_URL`. The branch above shares that role, so one reset covers both.

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

## 3. Cloudinary — images survive a redeploy only once this exists

Currently unset. Anything uploaded through `/admin` is written to the deployment's own filesystem,
which Vercel discards on the next deploy. The imported photography is already on Cloudinary and is
unaffected; this is about anything uploaded *from now on*.

`NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

---

## 4. Stripe — checkout is built and has never taken a payment

`DEV-62`. The checkout page says so rather than showing a form that can only fail. Signature
verification is verified offline; what has never run is one live `checkout.sessions.create`.

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, plus a webhook
endpoint pointed at `/api/stripe/webhook`.

---

## 5. Larger product photography — optional, and the most visible gap

The sixteen supplied photographs are 224–467 px wide. They are used where that size is honest —
category tiles, editorial surfaces — and the product galleries kept the generated fabric studies,
because a product page renders an image at up to 1400 px and an upscaled 264 px photograph reads as a
mistake.

Export the garment shots larger and the placement map in `scripts/import-brand-media.ts` is the one
file to change.

---

## 6. Analytics and error reporting — Phase 25 is built and is measuring nothing

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
against. The taxonomy and the GA4 reshaping are covered by `pnpm verify:analytics` (89 checks); what
is unverified is that events arrive, which only a network tab against a real property can show.

---

## 7. Cloudflare Turnstile — the four public forms are unprotected until these exist

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
