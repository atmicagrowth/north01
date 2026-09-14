# Security, privacy and personal data

Plan §34. What the shop collects about people, where it goes, who can see it, how long it is kept,
and what is kept out of logs. Written from a trace of the code (2026-09-11), not from intent: every
row here names the file that makes it true. When one of those files changes, this document should
change with it.

Also the factual source for the **privacy notice** at `/legal/privacy`, seeded from
`scripts/seed/legal.ts` and edited in the admin under Site Settings → Policies (`privacyPolicy`).
The notice is a plain-English draft of these facts, not a separate account of them: **when a row here
changes, change the notice too** — in `legal.ts` and in the production admin (TODO.md §12).

## 1. What is collected

| Data | Where it is stored | Why |
|---|---|---|
| Customer name, email, password (hashed and salted by Payload), optional phone | `customers` | The account |
| Saved addresses (name, company, lines, city, region, postcode, country, phone) | `addresses` | The address book |
| Order email and shipping/billing address **snapshots**, the lines bought, the discount code | `orders`, `order-items` | The record of a sale. Snapshots on purpose: editing a saved address must not change where a past parcel went |
| A random bag token (256 bits), the customer if signed in | `carts`, `cart-items` | The bag |
| Saved products | `wishlist-items` | The wishlist |
| Review title and body, the name it is published under, the rating | `reviews` | Reviews |
| Newsletter email, consent time, source, status | `newsletter-subscribers` | Consent record |
| Recipient, subject, template data, provider error | `email-messages` | The outbox. Reset emails store no data (`retainData: false`) |
| Stripe event id, type, error text. **No payload.** | `stripe-events` | Webhook idempotency |
| Staff email, password, role | `users` | The admin |

Not stored by the shop: IP addresses and user agents (no column in the schema holds one, and no log
call in `src/` writes one), card data (Stripe Checkout is hosted; the shop never sees a card number), dates of birth, gender,
or any field the forms do not show. Every free-text address line is length-bounded
(`lib/address-limits.ts`).

**Not stored by the shop is not the same as not collected.** The visitor's IP address reaches every
service the browser connects to — Vercel as the host (its request logs keep it), Cloudinary for
images, Cloudflare for the Turnstile widget, Stripe's hosted page, and GA4 and PostHog where they are
configured — and the server forwards it to Cloudflare as `remoteip` when it verifies a Turnstile
token (`lib/security/guard.ts`, `turnstile.ts`). PostHog stores it as `$ip`, with GeoIP enrichment,
and receives the full user agent (`$raw_user_agent`) on every event, **unless the project setting
*Discard client IP data* is on**: `posthog-js` 1.418's own `ip` option has no effect, so code cannot
turn it off. The privacy notice is worded to stay true either way (*"may keep it"*).

### 1.1 On the visitor's device

| What | Where | Lifetime | Set by |
|---|---|---|---|
| `payload-token` — the customer session | cookie, `httpOnly` | 7 days (`Customers.ts` `tokenExpiration`) | sign-in |
| `north01_cart` — the bag token | cookie, `httpOnly`, `sameSite: lax` | 30 days (`lib/cart/cart.ts`) | the first bag mutation |
| `north01:wishlist` — guest saved products, up to 50 ids | `localStorage` | until cleared; merged into the account and cleared at sign-in (`wishlist-sync.tsx`) | `lib/wishlist/rules.ts` |
| `north01:recently-viewed` — up to 12 product ids | `localStorage` | until cleared | `lib/recently-viewed/rules.ts` |
| `north01:recent-searches` — up to 6 terms | `localStorage` | until cleared | `lib/catalog/search.ts` |
| `north01:purchase:<order number>` | `sessionStorage` | the tab | `track-purchase.tsx` |
| `ph_<key>_posthog` — `distinct_id`, `$device_id`, session id, first URL and referrer | cookie (365 days from last write) **and** `localStorage`; window ids in `sessionStorage` | as stated | PostHog, where configured (`analytics.tsx`) |
| `_ga`, `_ga_<id>` — the GA client id | cookies | Google's default, up to 2 years (no `cookie_*` option is set) | gtag.js, where configured |

Speed Insights stores nothing on the device. The bag, recently-viewed and recent-search lists hold
product ids and terms only; the recently-viewed ids are sent to `resolveRecentlyViewedAction` to render
the rail and are not stored.

## 2. Who can see it — `src/payload/access`

Staff means `editor` or `admin` (`users.role`). Customers see only their own rows.

| Collection | Public | Customer | Editor | Admin |
|---|---|---|---|---|
| customers | — | own row; may change name and phone, **not email or password** (§34, `Customers.ts`) | read all; update, but not email or password | everything |
| addresses, wishlist-items | — | own | all | all |
| orders, order-items | — | own (read) | read; update fulfilment and tracking. **Not** the customer, email or cart (nobody may); addresses admin-only | as editor, plus delete |
| carts, cart-items | — | own (read) | read, create, update (`isStaff`); the **token** is admin-only | all |
| reviews | approved ones, **without the account id** | own, including unmoderated | moderate (status only) | delete |
| newsletter-subscribers | — | — | read, create, update (how an unsubscribe request is recorded) | as editor, plus delete |
| email-messages, stripe-events | — | — | read | read, delete |
| promotions | — | — | read, create, update | as editor, plus delete |
| payload-locked-documents, payload-preferences | — | — (§34, `access/internal-collections.ts`) | yes | yes |

**Editors changing orders' fulfilment and tracking, and creating and editing discount codes, is
intended** — the owner decided on 2026-09-11 that editors may do both (DEV-85), answering the question
TODO.md §10 raised (audit R1-17).

Customer sign-in, forgot-password and reset go through Server Actions (Turnstile, the password policy,
the reset cooldown). Payload's own REST routes for those three refuse anything that is not the Local
API (`Customers.ts` `beforeOperation`), and a review or an account can only be created through the
action's guard (`verifiedPublicWrite` and the review rule). GraphQL is not exposed (DEV-04).

## 3. Where it goes outside the shop

| Service | What it receives | What it never receives |
|---|---|---|
| **Stripe** | the order email (`customer_email`), the internal order id in metadata and the return URLs, one line item at the server's total. **Stripe Tax** receives the delivery address — line 1, city, region, postcode, country — with the discounted goods and delivery amounts (`lib/tax/rules.ts` `stripeTaxCalculationParams`). Stripe reports back the payment intent id, `amount_total` and cumulative `amount_refunded`, which the order records | name or phone from the shop. Stripe Checkout collects what it needs for the card itself |
| **Resend** | recipient, subject and the rendered email: first name (welcome), order number, products, amounts, tracking, the reset link | anything else. Reset idempotency keys are a digest, not the address (§34) |
| **GA4, PostHog** | page views and commerce events: product, variant, price, quantity, currency, search terms and filters, and **the order number on purchase** (GA4 `transaction_id`, PostHog `transactionId`), which joins an event to a named order for anyone with both the analytics and the admin. A **persistent device identifier** each (PostHog `distinct_id`/`$device_id`, GA4 `_ga`), so the data is pseudonymous rather than anonymous. PostHog also gets `$raw_user_agent`, screen and viewport size, timezone, language, and utm/click-id values from the landing URL; both get the IP (§1) | a name, email or postal address (no `identify` call; `person_profiles: 'identified_only'`, so no person profiles). Autocapture, session recording, heatmaps, dead clicks, exception capture, web vitals, surveys and feature flags are all off in code; GA4 runs with `allow_google_signals: false` and `allow_ad_personalization_signals: false`. **URLs:** the page and the referrer pass `redactPageUrl` (`lib/analytics/redact-for-vendors.ts`) — `SENSITIVE_PARAM` values (`token`, `code`, `email`, `order`, `session_id`, …) become `[redacted]`, every other value is scrubbed for emails, card-length digit runs and keys, and a `q` that looks like an email or order number is `[redacted]`. PostHog's `before_send` applies it to every absolute-URL property. **Path segments are not redacted**: `/account/orders/<order number>` is reported as it is. `/reset-password` is never reported (`lib/analytics/private-paths.ts`), and a referrer on it is sent as the bare origin |
| **Vercel** | as host, every request with its IP (§1). **Speed Insights**, production on Vercel only: each vital's page URL cut to origin and path, and the route pattern | query strings and fragments (`speedInsightsBeforeSend`); anything for `/reset-password`, whose events are dropped |
| **Sentry** | errors, with `sendDefaultPii: false`; cookies and headers dropped; keys naming a password, token, address, phone, postcode or name redacted; email-shaped values redacted | the user beyond an id; no replay |
| **Algolia** | the product index, and the search terms and filters of each query — sent by the server, so without the visitor's IP | who searched |
| **Cloudinary** | staff-uploaded media; the browser fetches every image from it, so it sees the visitor's IP (§1) | customer uploads (there are none) |
| **Cloudflare Turnstile** | the challenge token, and the visitor's IP — from the browser loading the widget, and from the server as `remoteip` when it verifies — on the five public forms: sign-in, registration, forgot password, review, newsletter | — |

## 4. How long it is kept

| Data | Kept | Mechanism |
|---|---|---|
| Active bags, including a deleted customer's | until 30 days after creation (`expiresAt`, which the shop never extends), then deleted by the daily sweep — at most 200 per run, so a backlog clears over days | `lib/cart/sweep.ts` `sweepExpiredCarts`, cron `/api/carts/sweep` |
| Converted bags (a bag becomes `converted` only when its order is paid) | indefinitely, like the paid order. The sweep takes only `active` bags, and deleting the order does not delete its bag | `lib/checkout/fulfil.ts`; `sweepExpiredCarts` filters on `status: active` |
| Paid (and refunded) orders | indefinitely — tax and accounting records | — |
| **Unpaid orders** (`draft`, `checkout_started`, `pending_payment`, `payment_failed`, `cancelled`) with **no fulfilment hold**, their lines and the name, email and addresses on them | **30 days after the order's `updatedAt`**, then deleted by the daily sweep, at most 200 per run. Decided by the owner 2026-09-11 | `lib/cart/sweep.ts` `sweepUnpaidOrders` / `unpaidOrderRetentionWhere`, same cron |
| Unpaid orders **under a fulfilment hold** (`paymentMismatch`: a signed payment that did not match the order) | **indefinitely.** The sweep never deletes an order under any hold, however old, and nobody can clear a hold (`fulfilmentHold` is `update: nobodyField`), so the order stays until an admin permanently deletes it after resolving the payment mismatch in Stripe. An ordinary admin delete only moves it to the trash, where it still holds everything | `unpaidOrderRetentionWhere`; `Orders.ts` `fulfilmentHold` |
| Email outbox rows — `to`, subject, template data (first name, order number, products, amounts, tracking) | **indefinitely — owner decision pending.** Reset emails keep `to` and subject but no data (`retainData: false`) | none yet |
| Newsletter rows, including unsubscribes | indefinitely, on purpose: an unsubscribe is the record that stops a re-add. There is no self-service unsubscribe: staff set `status: unsubscribed` on request | — |
| Reviews | until an admin deletes one — on request by email, or with the account. Customers cannot delete their own | `Reviews.ts` `delete: isAdmin` |
| A deleted account | see §4.1. A **trash** delete keeps everything, recoverable, and the account's approved reviews stay public (`lib/reviews/read.ts` does not check the author). A **permanent** delete removes the account, addresses, wishlist and reviews. Orders keep their own email, name and address snapshots, and email outbox rows their own `to`, subject and template data; bags have no email or address fields and keep only their token and lines. The account link on each is cleared (`ON DELETE SET NULL`). The newsletter row is keyed by email, not the account, and is untouched | `Customers.ts` `beforeDelete`, `hooks/cascadeDelete.ts` |
| Everything deleted above | may survive for the database provider's point-in-time recovery window (Neon's history retention — an account setting, not recorded here) | — |

**None of the sweep rows run until `CRON_SECRET` is set in production**: the route answers 401 to
every request without it (DEPLOYMENT.md §7, TODO.md §8). The privacy notice's retention paragraph is
a promise from that moment, not before.

**The unpaid-order clock is the last write that changed the order.** It runs from `updatedAt`, not
`createdAt`, and the difference is deliberate: an order is **reused** by a second checkout attempt,
so a row created months ago can have a live Stripe session opened against it a minute ago. Every
Local API write sets `updatedAt`, and since Phase 37 so does every raw `UPDATE "orders"` — the reuse
claim, the session claim, and each webhook claim that moves the order (`pending_payment`, paid,
`payment_failed`, `cancelled`, refunded, a hold). A claim that matches no row changes nothing. A
Checkout Session lives 31 minutes (`CHECKOUT_SESSION_LIFETIME_SECONDS`), and a delayed bank payment
settles in up to about three weeks from its `completed` event, which restarts the clock; thirty days
clears both. **A payment method that stays payable longer than 30 days is the residual risk** —
DEPLOYMENT.md §7 says to revisit the window before enabling one.

**The delete re-checks the rule.** It locks the selected rows (`SELECT … FOR UPDATE`) and deletes with
the whole predicate again, so an order paid, held or touched between the read and the delete is left
alone. It is permanent (`trash: true`, which in Payload means *permanently delete, trashed rows
included* — `docs/DATABASE.md` §8), so an unpaid order sitting in the admin trash is deleted too
rather than kept forever. A Stripe event that later names a deleted order is recorded as
`ORDER MISSING: …`, answered 200 and reported as `stripe.webhook.orderMissing` (COMMERCE.md §8.2).

### 4.1 Requests from a customer — what staff actually do

There is no self-service erasure, export or review removal. Requests arrive at `admin@micagrowth.com`
and the procedure is in [`CMS.md`](CMS.md) §10. The privacy notice promises what that procedure does:

- **Delete my account** — an admin deletes the customer **permanently** (the delete dialog's *Skip
  trash and delete permanently*, or *Permanently Delete* from the trash). That removes the profile,
  addresses, wishlist and reviews. It keeps orders with their snapshots (paid ones indefinitely,
  unpaid ones until the sweep), email outbox rows, the newsletter row, and a live bag — its lines, no
  address — until it expires. A trash-only delete does **not** meet the notice.
- **Remove my review** — an admin deletes the review. Rejecting it hides it but keeps it.
- **Leave the newsletter** — staff set the row to `unsubscribed`; the row stays.
- **A copy of my data, or a correction** — read from the admin (customer, addresses, wishlist,
  reviews, orders by email, email messages by `to`, newsletter by email). Only an admin can change a
  customer's sign-in email or an order's address snapshots; nobody can change a review's words
  (`nobodyField`) — a wrong review is deleted, not edited.

**Decisions the owner has to make** (legal, not technical — recorded, not guessed). Each open one
is described in the privacy notice as it behaves today, so a decision changes the notice too:

1. ~~How long an unpaid order keeps its email and address.~~ **Decided 2026-09-11: 30 days**, swept
   daily — see the table above. What it does **not** cover: an `email-messages` row about a deleted
   order keeps its own `to` address and subject, because the outbox is a separate record with its own
   retention question (next item). Deleting the order clears the link and nothing else.
2. How long `email-messages` rows are kept, and whether template data is cleared sooner.
3. What an erasure request does to orders — anonymise the snapshot, or keep it as a financial record.
4. A self-service unsubscribe link, required before the first marketing email is sent.
5. Whether editors should read the newsletter list and the email outbox, or admins only.

## 5. Logging

Never logged: passwords, card data, API keys, session tokens. Specifically:

- The email adapter writes an unsent email's **body** only on a local machine (it contains the reset
  link). Deployed, it logs the subject and a masked recipient, `j***@example.com` (§34).
- Webhook, checkout and cart logs carry internal ids (`orderId`, `cartId`, `evt_…`), never addresses.
- Turnstile failures log the reason code only.
- **Known residual:** error objects are logged whole. A Postgres uniqueness error can quote the email
  that collided, and a Stripe validation message can quote the email sent. Rare, server-side only, and
  readable only by people with access to the platform's logs.

## 6. Transport and headers

HTTPS and HSTS are Vercel's (`max-age=63072000; includeSubDomains; preload`). The application adds,
on every route (`next.config.mjs`): `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, a restrictive
`Permissions-Policy`, and no `X-Powered-By`.

The Content Security Policy ships as **Report-Only**. It lists every origin the site uses (Stripe,
Turnstile, GA4, PostHog, Sentry, Algolia, Cloudinary, Google Fonts). Measured locally on 2026-09-11:
nine storefront page types and four admin pages report nothing (after the admin's Gravatar avatar was
switched off). The next step is to run a release
with the browser console open on each page type and the admin, confirm it reports nothing, then rename
the header to `Content-Security-Policy`. `'unsafe-inline'` scripts stay allowed until Next's inline
bootstrap is served with nonces.

## 7. Secrets

Only in the environment: `.env` locally (git-ignored), Vercel's environment settings when deployed.
`pnpm scan:secrets` checks every tracked file and runs in CI. The two credential documents
(`docs/DEMO_ACCOUNTS.md`, `docs/LOCAL_ADMIN.md`) are git-ignored by name. Cron routes accept only
`CRON_SECRET`, compared in constant time; an unset secret refuses everything.
