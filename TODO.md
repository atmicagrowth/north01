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
Playwright suite first ran in Phase 35 (43 passed, 0 failed, 14 skipped; 44 passed as of 2026-09-15 —
`docs/TESTING.md`).

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

**Refunds and Stripe Tax.** Each paid order is recorded as a Stripe Tax transaction, but a refund does
**not** yet reverse it (Phase 36, `src/lib/tax/transactions.ts`). Until that is built, reverse a
refunded order's tax transaction by hand in the Stripe Dashboard (*Tax → Transactions*), or your tax
reports will include sales you gave back.

**Two order holds to watch** (Admin → Orders, filter by *Fulfilment hold*): *Stock shortfall* — paid,
but the stock was gone; *Payment mismatch* — Stripe took money that did not match the order's current
checkout. Both are yours to resolve in Stripe (refund, or back-order); neither clears itself.

---

## 5. Larger product photography — optional, and the most visible gap

The sixteen supplied photographs are 217–467 px wide (224–467 for the garment shots). They are used where that size is honest —
category tiles, editorial surfaces — and the product galleries kept the generated fabric studies,
because a product page renders an image at up to 1400 px and an upscaled 264 px photograph reads as a
mistake.

Export the garment shots larger and the placement map in `scripts/import-brand-media.ts` is the one
file to change.

---

## 6. Analytics and error reporting — keys are set in Production; three dashboard settings to change

Production has `NEXT_PUBLIC_GA_MEASUREMENT_ID`, the PostHog key and host, and `NEXT_PUBLIC_SENTRY_DSN`
(`vercel env ls`, 2026-09-11). Preview and local have none, which is the intended local state.

**Switch off one GA4 setting.** GA4 → Admin → Data streams → the web stream → Enhanced measurement →
**Page views → Advanced → uncheck "Page changes based on browser history events"**. The storefront
sends every page view itself, with sensitive query values redacted (Phase 31 hotfix); with this
setting on, every client-side navigation is counted twice.

**Switch on one PostHog setting.** PostHog → Project settings → **enable "Discard client IP data"**.
Code cannot do it (`posthog-js`'s own `ip` option has no effect), so until it is on PostHog keeps every
visitor's IP address. The privacy notice says those services *may* keep it, which stays true either
way; this setting is what stops PostHog keeping it.

**Keep two GA4 settings as they are.** GA4 → Admin → Data collection → **Google signals stays off**,
and Admin → Product links → **do not link Google Ads**. The privacy notice says Google Analytics runs
*with Google signals and ad personalisation switched off* and that personal information is not used for
advertising. The code sends both flags off; the property must not say otherwise.

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
against. The taxonomy and the GA4 reshaping are covered by `pnpm verify:analytics` (125 checks); what
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
- **`CRON_SECRET`** in Production, for both daily crons: the email drain and the retention sweep
  (bags, and unpaid orders after 30 days), which the privacy notice promises.
- **Function region `cle1`**, once the production Neon endpoint is confirmed to be `us-east-2`.
- **Queued production builds**, so two deployments never migrate at once.
- **CI repository secrets** — `DATABASE_URL` (non-production, read-only role), `PAYLOAD_SECRET`,
  and the variable `SITE_URL`.
- **When a custom domain is bought** — follow [`docs/DEPLOYMENT.md` §11](docs/DEPLOYMENT.md) in order:
  Vercel domains with the `www` redirect, unproxied Cloudflare records, then `SITE_URL`, Turnstile's
  hostnames, the Stripe webhook endpoint, and Resend's DNS (Phase 33).

## 9. ~~A privacy policy and terms~~ — written; what is still yours

**Supplied 2026-09-11.** You gave a contact address (`admin@micagrowth.com`) and asked for the text,
so it exists: a privacy notice and terms of sale, drafted from what the code actually does — the
cookies and device storage it uses, the services it calls, the retention windows it enforces — and
revised on 2026-09-13 after a review found sentences the code did not back. The words are in
`scripts/seed/legal.ts`. They render at `/legal/privacy` and `/legal/terms`, and both live in
**Admin → Settings → Site Settings → Policies** (the *Privacy Policy* and *Terms Of Sale* fields), so
you can edit them without a developer. Each page — and its link in the footer, the help pages'
Support nav, checkout and the sitemap — exists only while its field has text; an empty field is a 404
and no link. **Production shows neither until you paste them in (§12).**

What is still owed, and none of it is something a developer can invent:

- **Company details.** The last paragraph of the terms says the registered company name, its address
  and the governing law are to be confirmed, and the privacy notice's *Contact* paragraph says the
  company name and address will be added. Fill those in, in both documents, before live orders.
- **A review by somebody qualified.** This is a plain-English starting draft written from the
  implementation ([`docs/SECURITY.md`](docs/SECURITY.md) is the same facts in detail). It is not legal
  advice, and a lawyer should read both pages before the shop sells to the public. Change the *Last
  updated* date in the first paragraph whenever you change either text.
- **`CRON_SECRET` in Production (§8).** The notice promises that bags are deleted thirty days after
  they are created and unpaid orders thirty days after their last change. The daily sweep that does
  it refuses to run until that secret is set, so those promises are only kept from then on.
- **The staff procedures the notice promises** — a permanent (not trash) delete for an account
  deletion request, removing a review on request, recording a newsletter unsubscribe — are in
  [`docs/CMS.md`](docs/CMS.md) §10. Whoever answers `admin@micagrowth.com` needs to follow them.

One more thing the text does not claim: there is **no cookie-consent banner** (gap G-17). The privacy
notice says plainly what measurement records — a random identifier per browser, the pages and shopping
events, the order number of a purchase — and never says analytics is anonymous, but selling into the EU
or California generally needs consent before measurement cookies are set at all.


## 10. How long personal data is kept — five decisions

[`docs/SECURITY.md` §4](docs/SECURITY.md) lists them with the reasoning. In short: ~~how long an
**unpaid** order keeps its email and address~~ — **DONE**: 30 days after its last change, decided
2026-09-11 and built (Notes §1.43.3); how long the email outbox is kept; what an erasure
request does to orders; a self-service newsletter unsubscribe before the first marketing email; and
whether editors, not only admins, should read the subscriber list and the outbox. Each is a small
change once the answer exists.

~~A sixth, about staff rather than customers (Phase 36, audit R1-17): **editors can update an order's
fulfilment and tracking, and create and edit discount codes.**~~ — **DONE**: editors should, recorded
as intended in **DEV-85**. Credentials and order ownership stay admin-only.

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

## 12. Wording to update in the live admin — Phase 36, revised Phase 37

The seed now writes all of this, but production's content was entered separately and still carries the
old wording, which promises an online returns flow that does not exist and names an address that cannot
receive mail (audit DOC-01, DOC-02). **Do not run the seed against production to get it there**: the
seed refuses any database but the development one `DATABASE_PUSH_TARGET` names (D-10), and it would
overwrite production's settings, navigation and homepage and add demo customers, orders and reviews.
Enter it by hand, in **Admin → Settings → Site Settings**, **Admin → FAQs** and **Admin → Size guides**:

- **Site Settings → Contact → Contact Email** → `admin@micagrowth.com`.
- **Site Settings → Policies → Returns Policy**, second paragraph → *Returns are arranged with our team
  rather than started online — email admin@micagrowth.com and we will send you what to do.*
- **Site Settings → Policies → Privacy Policy** and **→ Terms Of Sale** → set `CRON_SECRET` first
  (§8), then paste the paragraphs of `PRIVACY_PARAGRAPHS` and `TERMS_PARAGRAPHS` from
  `scripts/seed/legal.ts`, one paragraph per string, in order (the privacy notice dated *Last updated 15 September
  2026*, the terms *13 September 2026*). The terms' *Delivery* paragraph builds its country list in code, so paste it as: *Delivery.
  We deliver to the United States, Canada, the United Kingdom, Ireland, France, Germany, the
  Netherlands and Australia, and checkout will not accept an address anywhere else. Standard and
  Express delivery are available to all of them; Overnight is available in the United States only.
  Standard delivery is free when your order reaches the free-delivery threshold shown in your bag
  ($150 when these terms were last updated), counted after any discount, or with a free-delivery code;
  otherwise it is charged. Express and Overnight are always charged. Delivery times are estimates, and
  they run from dispatch rather than from your order.* If production's **Commerce → Free shipping
  threshold** is not $150, change that figure. Until a field has text, production has no page for that
  document and no link to it.
- **FAQ — "Can I return something?"** → *Anything unworn, with its tags on, can be returned within 30
  days of delivery. Email admin@micagrowth.com to arrange one — returns are arranged with our team
  rather than started online.*
- **FAQ — "Can I change or cancel an order after placing it?"** → *Email admin@micagrowth.com as soon
  as you can and we will try. Once an order is packed we cannot alter it, and after that the answer is
  a return.*
- **FAQ — "Do you ship outside the United States?"**, if production has it → *Yes, to Canada, the
  United Kingdom, Ireland, France, Germany, the Netherlands and Australia, by Standard or Express.
  Overnight is United States only, because next-day delivery is only realistic within one country.
  Checkout will not accept an address anywhere else yet.* It said *worldwide*, which checkout refuses.
- **FAQ — "When will my order ship?"** → *When your order leaves us, we email you the carrier and a
  tracking number. The delivery estimate shown at checkout counts from then, not from the day you
  ordered.* It promised same-working-day dispatch before 2pm, with no timezone, and nothing in the
  shop backs a cut-off: an order ships when somebody marks it shipped. If you will commit to a dispatch
  time, add it here — with a timezone — only once it is how orders are actually handled.
- **FAQ — "How do I choose a size?"** → *Every piece of clothing has a size guide on its product page,
  in centimetres. Accessories have none — a belt is sized to the trouser rather than the body, as its
  description says. Between sizes, take the larger.* It said every product page has one.
- **FAQ — "How should I wash wool?"** → *Knitted wool, such as merino and lambswool, can be hand washed
  cool and dried flat — never hang wet knitwear. Woven wool, such as melton, twill and suiting cloth, is
  dry clean only. The care notes on each product page come first.* It told customers to hand wash wool
  that the product pages label dry clean only. Keep the question as it is.
- **FAQ — "Where is my tracking number?"**, if production has it → *It is in the dispatch email, and
  on the order in your account if you placed it while signed in. Nothing moves on the tracking page
  until the carrier scans the parcel.* It promised an evening scan, and a guest order is never in an
  account.
- **FAQ — "How long does delivery take?"**, if production has it, second paragraph → *The time shown at
  checkout is an estimate rather than a guarantee, and it counts from dispatch rather than from the
  order.* It said the estimate was "the one we hold ourselves to"; the terms call it an estimate.
- **FAQ — "When will I see the refund?"**, if production has it → *We refund to the original payment
  method once the return has reached us and been checked, and email you when we do. A refund usually
  takes five to ten business days to show on your statement, depending on the bank.* It promised a
  refund the day the return is checked in, and three to five days where the refund email says five to
  ten.
- **Size guides → Tops → Fit notes** → *How each piece fits — slim, regular, relaxed or oversized — is
  listed in its details. Between sizes, take the larger.* It said every top is a regular fit.
- **Size guides → Trousers and shorts → Fit notes** → *Waist sizes run true. Between sizes, take the
  larger.* It said the waists are measured flat, and they are the size on the label in centimetres.

## 13. The demonstration notice — two sentences to make true, and when to remove it

Added 2026-09-15 at your request (**DEV-86**). Every visitor's browser sees it once, on the first
page it loads, and **Continue** is the only way past it:

> This website is a demonstration. Please do not submit any real information. All features work, and
> if you enter your card information at checkout, you will be charged.

Two things to know:

- **Neither sentence about charging is true yet.** Production has no Stripe keys (§4), so checkout
  tells the customer payments are unavailable; search is off (§8) and no email is sent (§2). The
  notice warns about the shop you will have once those keys exist, which is the safe direction to be
  wrong in. It needs no change when you add them.
- **Removing it** when the shop stops being a demonstration is four deletions, and the build fails if
  you stop after the first: `<DemoNotice />` **and its import** in `src/app/(frontend)/layout.tsx` and
  in `src/app/global-not-found.tsx`, the `DEV-86` test block at the end of
  `tests/e2e/accessibility.spec.ts` with `tests/components/demo-notice.test.tsx`, and the
  `storageState` block in `playwright.config.ts` — each **with the import it leaves behind**, or
  `pnpm typecheck` fails on the unused one. The sentence about it in the privacy notice goes at the
  same time, in two places: the production admin (Site Settings → Policies, *Cookies and device
  storage*) and `scripts/seed/legal.ts`, which is where the text you paste comes from. The storage key
  is also listed in `docs/SECURITY.md` §1.

The words are yours: change them in `src/lib/demo-notice.ts`.
