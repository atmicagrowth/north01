# Security, privacy and personal data

Plan §34. What the shop collects about people, where it goes, who can see it, how long it is kept,
and what is kept out of logs. Written from a trace of the code (2026-09-11), not from intent: every
row here names the file that makes it true. When one of those files changes, this document should
change with it.

Also the factual input for the privacy policy the owner still has to supply (TODO.md §9).

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

Not collected: IP addresses or user agents (none stored anywhere), card data (Stripe Checkout is
hosted; the shop never sees a card number), dates of birth, gender, or any field the forms do not show.
Every free-text address line is length-bounded (`lib/address-limits.ts`).

## 2. Who can see it — `src/payload/access`

Staff means `editor` or `admin` (`users.role`). Customers see only their own rows.

| Collection | Public | Customer | Editor | Admin |
|---|---|---|---|---|
| customers | — | own row; may change name and phone, **not email or password** (§34, `Customers.ts`) | read all; update, but not email or password | everything |
| addresses, wishlist-items | — | own | all | all |
| orders, order-items | — | own (read) | read; update fulfilment and tracking. **Not** the customer, email or cart (nobody may); addresses admin-only | as editor, plus delete |
| carts, cart-items | — | own (read) | read; the **token** is admin-only | all |
| reviews | approved ones, **without the account id** | own, including unmoderated | moderate (status only) | delete |
| newsletter-subscribers, email-messages, stripe-events | — | — | read | read, delete |
| payload-locked-documents, payload-preferences | — | — (§34, `access/internal-collections.ts`) | yes | yes |

Customer sign-in, forgot-password and reset go through Server Actions (Turnstile, the password policy,
the reset cooldown). Payload's own REST routes for those three refuse anything that is not the Local
API (`Customers.ts` `beforeOperation`), and a review or an account can only be created through the
action's guard (`verifiedPublicWrite` and the review rule). GraphQL is not exposed (DEV-04).

## 3. Where it goes outside the shop

| Service | What it receives | What it never receives |
|---|---|---|
| **Stripe** | the order email (`customer_email`), the internal order id in metadata and the return URLs, line items and amounts | name, address or phone from the shop. Stripe Checkout collects what it needs itself |
| **Resend** | recipient, subject and the rendered email: first name (welcome), order number, products, amounts, tracking, the reset link | anything else. Reset idempotency keys are a digest, not the address (§34) |
| **GA4, PostHog** | anonymous page views and commerce events: product, variant, price, quantity, currency, the order number on purchase, search terms | an identity (no `identify`, profiles only when identified, which never happens), autocapture, session recording. URLs pass `redactUrl` (tokens, `email`, `session_id`, `order` stripped); `/reset-password` loads neither SDK; a search that looks like an email or a long number is sent as `[redacted]` |
| **Sentry** | errors, with `sendDefaultPii: false`; cookies and headers dropped; keys naming a password, token, address, phone, postcode or name redacted; email-shaped values redacted | the user beyond an id; no replay |
| **Algolia** | products only | anything about a person |
| **Cloudinary** | staff-uploaded media only | customer uploads (there are none) |
| **Cloudflare Turnstile** | the challenge token and the visitor's IP for that check | — |

## 4. How long it is kept

| Data | Kept | Mechanism |
|---|---|---|
| Active bags | until 30 days after creation, then deleted daily | `lib/cart/sweep.ts`, cron `/api/carts/sweep` |
| Converted bags | with the order | — |
| Paid orders | indefinitely — tax and accounting records | — |
| **Unpaid orders** (checkout started, never paid) | **indefinitely — owner decision pending** | none yet |
| Email outbox rows | **indefinitely — owner decision pending** | none yet |
| Newsletter rows, including unsubscribes | indefinitely, on purpose: an unsubscribe is the record that stops a re-add | — |
| Reviews | until deleted by an admin, or with the account | — |
| A deleted account | soft-deleted first (`trash`), recoverable by an admin. A permanent delete removes addresses, wishlist and reviews; orders and email rows keep their own email and address copies, with the account link cleared | `Customers.ts` `beforeDelete` |

**Decisions the owner has to make** (legal, not technical — recorded, not guessed):

1. How long an unpaid order keeps its email and address. A Stripe Checkout Session lives 24 hours, so
   anything past a few days serves no purpose; a sweep like the cart one is small once a period is set.
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
Turnstile, GA4, PostHog, Sentry, Algolia, Cloudinary, Google Fonts). The next step is to run a release
with the browser console open on each page type and the admin, confirm it reports nothing, then rename
the header to `Content-Security-Policy`. `'unsafe-inline'` scripts stay allowed until Next's inline
bootstrap is served with nonces.

## 7. Secrets

Only in the environment: `.env` locally (git-ignored), Vercel's environment settings when deployed.
`pnpm scan:secrets` checks every tracked file and runs in CI. The two credential documents
(`docs/DEMO_ACCOUNTS.md`, `docs/LOCAL_ADMIN.md`) are git-ignored by name. Cron routes accept only
`CRON_SECRET`, compared in constant time; an unset secret refuses everything.
