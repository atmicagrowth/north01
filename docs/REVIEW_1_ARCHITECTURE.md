# Review Pass 1 — architecture, data integrity, authorization, commerce and integrations

Plan §36.1a. Performed in Phase 36 (2026-09-11). Input: the Review Pass 1 findings R1-01…R1-31 of the
earlier audit (`docs/PHASE_35_36_AUDIT.md`, working input, not committed), each re-checked against the
code after Phases 31–35, then fixed or recorded. The purchase lifecycle was traced end to end: product
display → bag → preflight → Stripe Checkout → webhook → order, inventory, promotion and email.

**Every High and Critical issue is fixed.** Verification is the harness that proves each rule against
the development database (`pnpm verify:*`, see `docs/TESTING.md`), the unit suites, and the E2E run.

## The five Highs — the payment path

| ID | Issue | Root cause | Fix | Verification |
|---|---|---|---|---|
| R1-01 | An older Stripe session could pay for an order that had since been rewritten; the webhook checked no session, amount or currency | The order was found by its id in metadata alone, and preflight rewrote a reused order unconditionally | Paying is a conditional claim on the order's **current** session id, total and currency; anything else is a `mismatch` — recorded, reported to Sentry, answered 200, never applied. Preflight expires the prior session before reusing an order and refuses if it was paid. Sessions expire after 31 minutes | `verify:webhook` — wrong session, amount, currency, missing session; superseded expiry; second session paying a paid order |
| R1-02 | Every checkout was refused, with or without keys | The tax provider was still the Phase 16 placeholder (DEV-61) | Stripe Tax (`tax.calculations`) when Stripe is configured; our total stays authoritative (no `automatic_tax`, DEV-63). **Owner:** enable Stripe Tax in the Dashboard (TODO.md §4) — without registrations it returns zero tax | `tests/unit/tax-stripe.test.ts`; `verify:checkout` |
| R1-03 | After a session expired, that bag could never be checked out again | Preflight reused `cancelled` orders into a terminal fulfilment state | `cancelled` is never reused; `pending_payment` is, safely, because the old session is expired first. Checkout failures show a customer message instead of throwing | `verify:checkout` |
| R1-04 | A webhook that failed was acknowledged with 200 and never reprocessed; database errors became "ignored" | A bare `catch` treated every insert error as a duplicate; the order lookup swallowed every error | Only a unique violation is a duplicate. Failed or stale rows are reclaimed atomically and reprocessed; a fresh in-flight row gets 409 so Stripe retries; other errors are 500. Only a real "not found" is "no order" | `verify:webhook` (exactly-once reclaim, reprocessing takes stock once); `tests/unit/checkout-webhook.test.ts` |
| R1-05 | `checkout.session.completed` marked orders paid without checking `payment_status` | `completed` was mapped straight to `paid` | `paid` → paid; `unpaid` → waits at `pending_payment`; `no_payment_required` → mismatch; async success/failure handled | `verify:webhook`; unit tests |

## Mediums and Lows

| ID | Sev. | Status | Fix / reason |
|---|---|---|---|
| R1-06 | M | Fixed | Returning from Stripe and retrying reuses the pending order; history hides never-paid attempts |
| R1-07 | M | Fixed | Usage limit enforced in the increment itself; per-customer count includes pending orders. Over-redemption (payment already taken) is recorded and reported |
| R1-08 | M | Fixed | A reused order takes the bag's current promotion, or none |
| R1-09 | M | Fixed | Partial refunds accumulate; the order stays paid until fully refunded; "Partially refunded" shown to the customer |
| R1-10 | M | Fixed | Out-of-stock finalisation rolls back to a savepoint; bag, promotion and order stay consistent; the order carries `fulfilmentHold = stockShortfall` (also R3-19) |
| R1-11 | M | Fixed | Order snapshot, ownership, promotion and shipping-method fields are server-written only; addresses admin-only (Phase 34, completed here) |
| R1-12 | M | Fixed (Phase 34) | Customer email/password changes need an admin |
| R1-13 | M | Fixed | A password reset or admin password change ends every session |
| R1-14 | M | Fixed (Phase 33) | CSRF allowlist covers every host the deployment answers on |
| R1-15 | M | Fixed (Phase 34) | Payload's REST auth routes refuse non-local calls; forgot-password has Turnstile and a cooldown |
| R1-16 | M | Fixed (Phase 31 hotfix) | Reset tokens never reach analytics |
| R1-17 | M | Partly — owner | Credentials fixed. Editors can still update orders' fulfilment fields and manage promotions; whether that should be admin-only is the owner's staffing decision (TODO.md §10) |
| R1-18 | M | Fixed (Phase 34) | Payload's internal collections are staff-only |
| R1-19 | M | Fixed (Phase 35) | A local production build resolves to `local` |
| R1-20 | M | Fixed (Phase 31) | Degraded search says so, with no "No products" |
| R1-21 | M | Fixed | Resend calls time out after 8 s; the webhook sends email after responding (`after()`) |
| R1-22 | M | Fixed (Phase 31) | Turnstile failure explains itself |
| R1-23 | L | Open | Money arithmetic is repeated in six modules; each is unit-tested against the same rules. A single pricing module is refactoring, not a fix, this late |
| R1-24 | L | Fixed (Phase 34) | Length bounds on every free-text field |
| R1-25 | L | Open | No database constraint enforces one active bag per customer; the read path picks the newest. An advisory lock is recorded as owed |
| R1-26 | L | Open | Two order-number generators; the live one's collision space (32⁶ per month) makes a retry academic. Recorded |
| R1-27 | L | Partly — owner | Expired bags swept daily (Phase 34); unpaid orders' retention is the owner's decision (SECURITY.md §4) |
| R1-28 | L | Open | Sign-in timing can still hint at an account's existence; REST routes are closed and Turnstile guards the forms |
| R1-29 | L | Fixed | A failed image shows the reserved placeholder, not a broken icon |
| R1-30 | L | Fixed | Analytics imports and `gtag` calls cannot throw into the page |
| R1-31 | L | Fixed (Phase 31) | The success page's copy follows the payment status |

## Found by this pass's own review (sweep 1)

An adversarial review of the fixes above — assuming Stripe delivers late, twice and out of order, and
that a customer double-clicks — found seven more, all fixed (notes §1.41.6):

| Sev. | Issue | Fix | Verification |
|---|---|---|---|
| High | Two checkouts on one bag (double click, two tabs) could create two orders, or leave a second payable session — money taken for an unpaid order, or a double charge | Per-cart advisory lock around lookup and write; conditional claims on the order's status, session and last write | `verify:checkout` G2 races two preflights |
| Medium | A mismatched payment was invisible to staff | `fulfilmentHold = paymentMismatch` on the order; Sentry | `verify:webhook` |
| Medium | The confirmation email could be lost between acknowledging Stripe and queueing it | Queued inside the payment transaction | `verify:webhook` |
| Medium | A refund arriving before its payment was lost | Answered 500, so Stripe retries | `verify:orders` |
| Medium | No Stripe Tax transaction was recorded, so sales were missing from tax reports | Calculation id stored; `createFromCalculation` after payment (reversal on refund not built) | `tests/unit/tax-transaction.test.ts` |
| Low–Medium | A bag deleted during payment could silently roll the payment back | Raw update inside the same transaction | `verify:webhook` |
| Low | A zero taxable base called Stripe; shortfall detail inaccurate | Fixed; savepoint branch proven | `verify:webhook` |

## The audit questions (§36.1a), answered

- **Server-only secrets in client code?** No — `env.server` is import-guarded by ESLint (D-14); `scan:secrets` passes.
- **Core domain rules centralised?** Yes, in pure `rules.ts` modules with unit tests (checkout, cart, promotions, shipping, tax, orders). Arithmetic repetition is R1-23.
- **Unique constraints, foreign keys, indexes, reproducible migrations?** `docs/DATABASE.md`; push and the committed migrations were measured identical (Phase 5), and every schema change since is a generated migration.
- **Historical order snapshots preserved?** Yes — lines, prices, addresses, shipping method and estimate are snapshots, server-written only.
- **Client price data alter the charge?** No — preflight recomputes everything; the session total is ours.
- **Sold-out variant through a crafted request?** No — stock is checked in preflight and decremented conditionally at payment.
- **Another user's order by id?** No — reads are scoped to the session's customer; a foreign order is "not found".
- **Duplicate webhooks, duplicate orders?** No — the event row plus the conditional claim; reprocessing is exactly once.
- **Negative inventory?** No — a database check constraint, and conditional decrements.
- **Discount manipulation?** Validated server-side in preflight and again at payment (R1-07).
- **Role escalation / protected routes / ownership server-side?** `verify:access` 50/50; Phase 34's REST closures.
- **Analytics, search, email or media failing?** None blocks a purchase: analytics is fire-and-forget, browse falls back to Postgres, email is queued and time-limited, a missing image keeps its box.
