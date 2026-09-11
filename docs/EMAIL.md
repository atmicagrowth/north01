# Transactional email

Plan §19 and §38. How the shop sends email, what records each message, what retries it, and what
stops mail from reaching a real customer by accident. Written from the code (2026-09-11). Variables are
defined in [`ENVIRONMENT.md`](ENVIRONMENT.md); the Resend domain and DNS procedure is in
[`DEPLOYMENT.md`](DEPLOYMENT.md) §11.3; what the outbox holds about people is in
[`SECURITY.md`](SECURITY.md). Decisions: **DEV-64** to **DEV-67** in
`NORTH01_Implementation_Notes_and_Deviations.md` (notes §1.24).

## 1. The pieces

| File | Role |
|---|---|
| `src/emails/messages.tsx` | The eight React Email templates, the `EmailData` type for each, and `renderEmail()`, which renders HTML **and** a plain-text part from the same component |
| `src/emails/shell.tsx`, `src/emails/theme.ts` | The shared layout and tokens |
| `src/lib/email/rules.ts` | Pure decisions: the message kinds, statuses, dedupe keys, retry ceiling, the dev allowlist, subject lines. No I/O |
| `src/lib/email/send.ts` | The one sending service: `enqueueEmail`, `deliverEmail`, `sendEmail`, `drainEmails`. **Nothing in it throws** (§19.1d) |
| `src/lib/email/orders.ts` | Builds order confirmation, shipped, delivered and refund messages from an order. Enqueues only; never delivers |
| `src/lib/email/resend.ts` | **The only file that imports `resend`** (§19.1a). `createEmailTransport`, `buildCourier` |
| `src/lib/email/courier.ts` | Reads the environment (`server-only`), builds a courier, applies the reply-to rule |
| `src/payload/collections/EmailMessages.ts` | The outbox, `email-messages` |
| `src/payload/email/serviceEmailAdapter.ts` | Payload's email adapter. Routes Payload's own password-reset mail through `sendEmail` |
| `src/payload/hooks/queueOrderEmails.ts` | `afterChange` on `orders`: queues shipped and delivered messages |
| `src/app/(frontend)/api/email/drain/route.ts` | The staff `POST` drain and the cron `GET` drain |
| `scripts/drain-email.ts` | `pnpm email:drain` |

## 2. Templates — the plan's eight (DEV-65)

| Kind | Subject (`subjectFor`) | Sent by | Dedupe key |
|---|---|---|---|
| `orderConfirmation` | `Order <number> confirmed` | Stripe webhook, once the order is paid | `order-confirmation:<orderId>` |
| `orderShipped` | `Order <number> is on its way` | Admin: fulfilment status changed to `shipped` | `order-shipped:<orderId>` |
| `orderDelivered` | `Order <number> delivered` | Admin: fulfilment status changed to `delivered` | `order-delivered:<orderId>` |
| `refund` | `Order <number> refunded` | Stripe webhook, `charge.refunded` | `refund:<orderId>:<amountMinor>` — a second partial refund is a second message |
| `welcome` | `Welcome to NORTH / 01` | `register` in `src/lib/auth/actions.ts`, after the account and session exist | `welcome:<customerId>` |
| `passwordReset` | `Reset your NORTH / 01 password` | Payload `forgotPassword`, through `serviceEmailAdapter` | `password-reset:<sha-256 digest of the address>:<issued at>` — a new request is a new message |
| `verification` | `Confirm your email address` | **nothing** — `Customers.auth.verify` is off (DEV-66) | `verification:<customerId>` |
| `contactConfirmation` | `We have your message` | **nothing** — there is no contact form (DEV-66, gap G-08) | `contact-confirmation:<submission>` |

Features §24's *Order cancelled* and *back-in-stock* are not built (DEV-65). `EMAIL_KINDS` keys the
template map exhaustively, so adding a kind without a template is a type error.

Preview templates locally: `pnpm email:preview` (React Email dev server on port 3030, `src/emails`).

## 3. The outbox — `email-messages`

One row per message the shop **intended** to send, written `pending` **before** any delivery attempt
(`enqueueEmail`). Admin group *System*.

| Field | Meaning |
|---|---|
| `dedupeKey` | Unique index. Claiming the key **is** the duplicate check: a second insert fails and is reported as `duplicate`, not an error. Both Payload's `ValidationError` and a raw Postgres 23505 are recognised (`isDuplicateKey` in `send.ts`) |
| `kind`, `subject`, `to` | What, and the address it was, or would have been, sent to |
| `status` | `pending` → `sent` \| `failed` \| `suppressed` |
| `attempts`, `lastAttemptAt`, `sentAt` | Retry bookkeeping |
| `order`, `customer` | Nullable links. `to` is the record, not the link |
| `providerId` | Resend's message id, to reconcile against the Resend dashboard |
| `data` | Template data, stored so a queued message renders exactly what was decided. **Null** for password resets (`retainData: false`): the body holds a live token |
| `error` | Why the last attempt failed, or why the message was suppressed |

**Access:** `create` and `update` are closed to everyone, staff included; staff read; admins delete
(`EmailMessages.ts`). Server code writes with `overrideAccess`. Every field is read-only in the admin.

### Statuses and retries (`rules.ts`)

- `pending` is **not a lock**. A row a crashed sender left `pending` is retried.
- `failed` is retried up to `MAX_DELIVERY_ATTEMPTS` = **3**, then left for a person.
- A drain skips a row attempted in the last **5 minutes** (`RETRY_BACKOFF_MS`, `send.ts`), so one
  request cannot spend the whole retry budget.
- `sent` and `suppressed` are terminal. **Suppression cannot be undone**, and nothing in the
  application resets it.
- A password reset that fails cannot be retried (no stored data); it is marked `failed` with
  *"Ask for a new one"*. The customer requests another link.

### How one delivery is claimed

`deliverEmail` claims an attempt with one conditional `UPDATE … SET attempts = attempts + 1 WHERE
status IN ('pending','failed') AND attempts = <observed>`. A concurrent drain matches zero rows and
stops. The row's `dedupeKey` is sent to Resend as the `Idempotency-Key`, so a re-send after a crash
between Resend accepting and the row being marked `sent` collapses at Resend.

## 4. When messages are queued and delivered

| Trigger | Queued | Delivered |
|---|---|---|
| Stripe webhook finalises a payment (`sendOrderEmails` in `src/app/(frontend)/api/stripe/webhook/route.ts`) | after the payment transaction commits | immediately, in the same request, when Resend is configured |
| Stripe `charge.refunded` | same | immediately |
| Registration | after the account is created | immediately; a failure never blocks the redirect |
| Password reset | inside `forgotPassword` | immediately; a failure is logged, never thrown |
| Admin sets an order to `shipped` / `delivered` (`queueOrderEmails`) | **inside** the order's update transaction, with `req` | **later, by a drain** — §5 |

The shipped and delivered messages are only queued in the hook, because Payload 3 runs `afterChange`
inside the open transaction and has no post-commit collection hook. Queued there, the row rolls back
with a transition that rolls back. The hook fires only when `fulfillmentStatus` actually changes
(`previousDoc` comparison), and the dedupe key backs that up. `shipped` needs a carrier and a tracking
number first (`planFulfillmentChange`, `src/lib/orders/rules.ts`).

**An email never undoes what it reports** (§19.1d). The webhook catches email errors, logs them and
reports them (`reportFailure(error, 'stripe.webhook.email')`); the order hook catches, so a queue
error cannot roll back a dispatch.

## 5. The drain — four ways the queue is emptied

`drainEmails(payload, courier, { limit })` delivers `pending`/`failed` rows under the ceiling and
outside the backoff window, oldest first.

| Path | Limit | Authorisation | Where |
|---|---|---|---|
| Opportunistic, after every processed Stripe webhook | 5 | Stripe signature on the webhook | `webhook/route.ts` |
| `pnpm email:drain [-- --limit N]` | 50 by default | a shell with the database | `scripts/drain-email.ts` |
| `POST /api/email/drain` | 50 | a signed-in **staff** session (`users`, role `admin` or `editor`); customers get 403 | `api/email/drain/route.ts` |
| `GET /api/email/drain` (Vercel Cron, daily `0 7 * * *`) | 50 | `Authorization: Bearer <CRON_SECRET>`, constant-time compare; 401 otherwise, including when unset | `vercel.json`, `lib/security/cron-auth.ts` (DEV-67) |

Both routes return `503` with the queue untouched when Resend is not configured, and a JSON tally
`{ attempted, sent, suppressed, failed }` otherwise. The daily `GET` has drained on a schedule since
Phase 32.

**`pnpm email:drain` refuses** to run when `DATABASE_URL` is not the development database and the
process is not production. A laptop pointed at production would otherwise suppress every queued
production message permanently (the allowlist in §6 applies, and suppression is terminal). To drain
production, use the staff `POST` from the deployed site. The script has no D-10 guard otherwise: it
writes only `email_messages` and creates no fixtures.

## 6. Resend, the dev safeguard, and unconfigured behaviour

**Transport** (`resend.ts`). `createEmailTransport` sends `from`, `to`, `subject`, `html`, `text`,
`replyTo` and the idempotency key. It **resolves** on every failure: a Resend error, a thrown network
error, or no answer within **8 seconds** (`SEND_TIMEOUT_MS`, Phase 36, audit R1-21). The row then
records `failed` and stays retryable.

**The dev safeguard** (`resolveRecipient` in `rules.ts`) gates the **destination**, because Resend has
no test-mode key:

| `appEnv` | Delivered to |
|---|---|
| `production` | every address |
| `local`, `preview` | only addresses on `EMAIL_DEV_ALLOWLIST` (comma- or space-separated, case-insensitive). **Empty delivers to nobody** |

Everything else is recorded `suppressed`, with the reason in `error`. It is applied at delivery, so the
outbox row is identical in every environment and only the outcome differs.

**Resend unconfigured** (`RESEND_API_KEY` or `EMAIL_FROM` missing):

- Every message is still queued `pending`; `courierFromEnv` returns `null` and nothing is sent. The
  next drain after the keys exist delivers the backlog.
- Password resets have no row in that case: `serviceEmailAdapter` returns before `sendEmail`. **On a
  local machine** it logs the full body (`Email (not sent): <subject>`), which contains the reset link,
  so a reset can be completed without a key ([`DEVELOPMENT.md`](DEVELOPMENT.md), "Where the
  password-reset link goes"). **Deployed**, it logs the subject and a masked recipient
  (`maskEmail`, `src/lib/observability/redact.ts`) at `error`, and never the body (§34.1c).

## 7. Reply-to

Order and account messages built through `courierFor(payload)` set `Reply-To` to
`SiteSettings.contactEmail`, filtered by `usableReplyTo` (`courier.ts`, Phase 36, audit DOC-02):

- not a string, no `@`, or no domain → no reply-to;
- a reserved domain → no reply-to: `.example`, `.test`, `.invalid`, `.localhost`, and
  `example.com`/`.net`/`.org` and their subdomains;
- otherwise the trimmed address.

A failed settings read also gives no reply-to and never costs the message. Payload's password-reset
mail is built in `payload.config.ts` without a reply-to. Covered by `tests/unit/courier-reply-to.test.ts`.

## 8. Owner setup

TODO.md §2, and [`DEPLOYMENT.md`](DEPLOYMENT.md) §11.3 for the domain.

1. Resend → Domains → add a sending subdomain, add **exactly** the DKIM, MX, SPF and DMARC records
   Resend displays in Cloudflare (DNS only), wait for **Verified**. Resend rejects unverified domains.
2. Set in Vercel: `RESEND_API_KEY`, `EMAIL_FROM` (an address on the verified domain, for example
   `NORTH / 01 <orders@send.example.com>`), and `CRON_SECRET` for the scheduled drain. Preview: also
   `EMAIL_DEV_ALLOWLIST` with your own address.
3. Admin → Site settings → set `contactEmail` to a real mailbox, or messages carry no reply-to.
4. Redeploy, request a password reset for an allowlisted address on a preview, and confirm it arrives
   and its link names the right host (DEPLOYMENT.md §11.4).
5. Watch `email-messages` for `failed` rows. Fix the cause, then wait for the daily cron or send
   `POST /api/email/drain` from a browser tab signed in to the admin (there is no button for it). A
   row at 3 attempts is not retried again by any drain.

Today none of these values are set in any Vercel environment (DEPLOYMENT.md §2), so **no email has
ever been delivered** outside the harness's fake transport.

## 9. Verifying

`pnpm verify:email` (`scripts/verify-email.ts`) drives the whole service against the development
database with a fake transport that opens no socket. It covers the dedupe barrier, including the
concurrent case, the retry ceiling, the allowlist in both environments, failure recording and a
queued order confirmation drained end to end. It needs no Resend key. See [`TESTING.md`](TESTING.md).
