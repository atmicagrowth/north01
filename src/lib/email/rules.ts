/**
 * **Plan §19's decisions, as pure functions.**
 *
 * §19.1c asks for idempotency and §19.1d for failure isolation, and the phase prompt asks for a
 * *"local/dev safeguard so emails are not accidentally sent to arbitrary recipients using production
 * credentials"*. All three are decisions rather than plumbing, so all three live here, where
 * `pnpm verify:email` can drive them without a network, a database or an API key.
 *
 * `lib/email/send.ts` next door does the reads, the writes and the delivery. `lib/email/resend.ts`
 * holds the key. Neither decides anything.
 *
 * ---
 *
 * ### The rule this module exists to make structural
 *
 * §19.1d: *"A failed email should not roll back a successful payment/order."* Nothing here throws,
 * and nothing here awaits anything. A caller that asks whether to send, and to whom, gets an answer —
 * never an exception. The one place that *can* fail is the provider call, and `send.ts` catches it.
 */

/* -------------------------------------------------------------------------------------------------
 * The message kinds — plan §19.1b
 * ---------------------------------------------------------------------------------------------- */

/**
 * **§19.1b's eight templates, and only those eight.**
 *
 * > *"Build branded React Email templates: Welcome. Verification. Password reset. Order confirmation.
 * > Order shipped. Order delivered. Refund. Contact confirmation."*
 *
 * The features document (§24) lists ten, adding *"Order cancelled"* and *"Optional back-in-stock"*.
 * `AGENTS.md` ranks the plan above the features matrix, so the plan's eight are the requirement and
 * the extra two are recorded as a deviation rather than silently adopted — see **DEV-65**.
 *
 * §19.1a's *"example conceptual API"* names five functions, three of which have no template and two
 * of which do. The plan hedges that list with the word *example*; this list is not hedged, so this is
 * the one the code follows.
 */
export const EMAIL_KINDS = [
  'contactConfirmation',
  'orderConfirmation',
  'orderDelivered',
  'orderShipped',
  'passwordReset',
  'refund',
  'verification',
  'welcome',
] as const

export type EmailKind = (typeof EMAIL_KINDS)[number]

export function isEmailKind(value: string): value is EmailKind {
  return (EMAIL_KINDS as readonly string[]).includes(value)
}

/**
 * The delivery lifecycle of one message.
 *
 * `pending` is written **before** anything is attempted, and is deliberately *not* treated as
 * "in progress, do not retry" — the reasoning `StripeEvents` recorded in Phase 17 applies here
 * unchanged: a crashed sender and a slow one are indistinguishable from outside, and a lock nobody
 * can release is worse than a duplicate. A stuck `pending` row is retried, and the provider's own
 * idempotency is what makes that safe.
 *
 * `suppressed` is a *success* for the caller and a non-delivery for the customer: the dev safeguard
 * refused the address. It is separate from `failed` because it is not a fault and must never be
 * retried into a real send.
 */
export const EMAIL_STATUSES = ['failed', 'pending', 'sent', 'suppressed'] as const

export type EmailStatus = (typeof EMAIL_STATUSES)[number]

/* -------------------------------------------------------------------------------------------------
 * §19.1c — duplicate protection
 * ---------------------------------------------------------------------------------------------- */

/**
 * **The idempotency key. §19.1c: *"A webhook retry must not send two confirmation emails."***
 *
 * The plan leaves the strategy open — *"an application-side event/message record or another
 * idempotency strategy"* — and closes only the outcome. This project already has the answer in the
 * shape of Phase 17's `stripe-events`: a **unique column, and an insert that violates it**. Not a
 * read-then-write, because two concurrent retries would both find nothing and both proceed, and the
 * window between the read and the write is exactly where a duplicate send lives.
 *
 * So the key is a string, it is unique in the database, and claiming it *is* the check.
 *
 * ### What each key is keyed on, and why it is not the Stripe event id
 *
 * An event id would only cover the messages that originate from Stripe, and it would cover them
 * *wrongly*: Stripe sends `checkout.session.completed` **and** `payment_intent.succeeded` for one
 * payment, with two different ids. Keying on the event would send two confirmations for one order.
 *
 * Keying on **the thing that happened** rather than on the message that reported it fixes both:
 *
 * - `order-confirmation:42` — one per order, forever. Whichever event finalises it, and however many
 *   times Stripe replays them.
 * - `order-shipped:42` / `order-delivered:42` — one per order per transition. These have no Stripe
 *   event at all; they originate in the admin panel, where the panel posts the whole document on
 *   every save, so an unkeyed send would re-mail the customer every time a staff member corrected a
 *   tracking URL.
 * - `refund:42:1500` — one per order **per refunded amount**. Partial refunds are ordinary
 *   (`Orders.refundedMinor` says so), a second one sends a second `charge.refunded`, and the customer
 *   is owed a second notice. Keying on the order alone would swallow it.
 * - `welcome:7`, `verification:7` — one per customer.
 * - `password-reset:7:<issued at>` — deliberately **not** one per customer. A reset link can be
 *   requested again, and the whole point of requesting it again is to receive it again.
 * - `contact-confirmation:<submission>` — one per submission.
 */
export function dedupeKeyFor(
  kind: EmailKind,
  parts: { amountMinor?: null | number; id: number | string; issuedAt?: null | string },
): string {
  const base = `${KEY_PREFIX[kind]}:${parts.id}`

  if (kind === 'refund') {
    return `${base}:${typeof parts.amountMinor === 'number' ? parts.amountMinor : 'full'}`
  }

  if (kind === 'passwordReset') {
    return `${base}:${parts.issuedAt ?? 'unstamped'}`
  }

  return base
}

const KEY_PREFIX: Record<EmailKind, string> = {
  contactConfirmation: 'contact-confirmation',
  orderConfirmation: 'order-confirmation',
  orderDelivered: 'order-delivered',
  orderShipped: 'order-shipped',
  passwordReset: 'password-reset',
  refund: 'refund',
  verification: 'verification',
  welcome: 'welcome',
}

/* -------------------------------------------------------------------------------------------------
 * §19.1d — failure, retry, and the ceiling on both
 * ---------------------------------------------------------------------------------------------- */

/**
 * How many delivery attempts a message gets before it stops being retried automatically.
 *
 * Three, and then a human. §19.1d asks to *"allow retry where appropriate"*, not to retry forever: a
 * message failing on a malformed address or an unverified sending domain will fail identically on the
 * hundredth attempt, and a queue that never gives up hides the one failure somebody could fix.
 * `status: 'failed'` with `attempts` at the ceiling is the *"admin visibility"* the same section asks
 * for, and a staff member can still force a retry by hand.
 */
export const MAX_DELIVERY_ATTEMPTS = 3

export function isRetryable(status: EmailStatus, attempts: number): boolean {
  if (status === 'sent' || status === 'suppressed') {
    return false
  }

  return toAttemptCount(attempts) < MAX_DELIVERY_ATTEMPTS
}

/** Attempts is a count. `NaN`, `-1` and `1.5` are all "none so far" rather than a crash. */
export function toAttemptCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

/* -------------------------------------------------------------------------------------------------
 * The dev safeguard — the phase prompt's one sentence
 * ---------------------------------------------------------------------------------------------- */

/**
 * Why a message was not delivered to the address it was addressed to.
 *
 * `noAllowlist` is the default state of a developer's laptop and is not a fault. `notAllowlisted` is
 * the one that matters: a real customer's address, on a machine that is not production, with a key
 * that might be the live one.
 */
/**
 * Which environment a delivery is happening in.
 *
 * Structurally identical to `AppEnv`, and declared here rather than imported for a reason worth
 * keeping. `env.core` is fenced by ESLint outside four paths — a type-only import would be harmless
 * but the rule is a pattern, and weakening a fence that was added after a measured secret leak to
 * save one line is a poor trade.
 *
 * The duplication is also load-bearing in one direction: if a fourth environment is ever added to
 * `AppEnv`, passing it here stops compiling, and somebody has to decide whether mail may leave it.
 * A wider type would have silently answered "yes".
 */
export type DeliveryEnv = 'local' | 'preview' | 'production'

export type SuppressionReason = 'noAllowlist' | 'notAllowlisted'

export type RecipientDecision =
  { reason: SuppressionReason; status: 'suppressed'; to: string } | { status: 'send'; to: string }

/**
 * **The phase prompt: *"Add local/dev safeguards so emails are not accidentally sent to arbitrary
 * recipients using production credentials."***
 *
 * One sentence, and it names **two** hazards rather than one — *arbitrary recipients* and *production
 * credentials* — so a safeguard that only gates on whether a key is present does not satisfy it. A
 * developer running against a copy of the production database has real customers' addresses in front
 * of them and a `RESEND_API_KEY` in their `.env` that is, as far as any code can tell, the live one.
 * Resend issues no test-mode key that would make the mistake harmless.
 *
 * So the gate is on **destination**, not on credentials:
 *
 * - In `production`, every address is deliverable. That is what production is.
 * - Anywhere else, a message is delivered **only** to an address on `EMAIL_DEV_ALLOWLIST`, and every
 *   other message is recorded as `suppressed` — visible in the admin panel, never sent, never
 *   retried into a send.
 *
 * The default is the safe one: an empty allowlist suppresses everything. A developer who wants to see
 * a real message adds their own address, which is a deliberate act naming exactly one inbox.
 *
 * Comparison is case-insensitive and trimmed, because an allowlist that fails on `Ada@Example.com`
 * teaches people to widen it.
 */
export function resolveRecipient(input: {
  allowlist: readonly string[]
  appEnv: DeliveryEnv
  intended: string
}): RecipientDecision {
  const to = input.intended.trim()

  if (input.appEnv === 'production') {
    return { status: 'send', to }
  }

  if (input.allowlist.length === 0) {
    return { reason: 'noAllowlist', status: 'suppressed', to }
  }

  const permitted = input.allowlist.some((entry) => entry.toLowerCase() === to.toLowerCase())

  return permitted ? { status: 'send', to } : { reason: 'notAllowlisted', status: 'suppressed', to }
}

/** `EMAIL_DEV_ALLOWLIST` is one string; commas and whitespace both separate. Empties are dropped. */
export function parseAllowlist(raw: null | string | undefined): string[] {
  if (typeof raw !== 'string') {
    return []
  }

  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export const SUPPRESSION_COPY: Record<SuppressionReason, string> = {
  noAllowlist:
    'Not delivered: this is not production and EMAIL_DEV_ALLOWLIST is empty, so no address is deliverable.',
  notAllowlisted:
    'Not delivered: this is not production and the address is not on EMAIL_DEV_ALLOWLIST.',
}

/* -------------------------------------------------------------------------------------------------
 * The transport contract
 * ---------------------------------------------------------------------------------------------- */

/**
 * **What a provider has to be able to do, and nothing more.**
 *
 * One function. Not a Resend client, not an SDK type — a function from a message to an outcome, so
 * that `send.ts` can be driven by `pnpm verify:email` with a transport that records what it was asked
 * to send and never opens a socket. The guarded module that holds the API key returns one of these;
 * so does the harness's fake.
 *
 * It **resolves** on failure rather than rejecting. §19.1d says a failed email must not roll back a
 * successful order, and the surest way to honour that is for the failure path not to be an exception
 * in the first place. A transport that throws anyway is caught by `send.ts`, but that is the backstop
 * rather than the contract.
 */
export type TransportMessage = {
  from: string
  html: string
  /**
   * The message's own `dedupeKey`, handed to the provider as its idempotency key.
   *
   * This is the barrier that covers the one window the database cannot: between the provider
   * accepting a message and this application recording that it did. A crash there leaves the row
   * `pending` and the next drain re-sends — with the same key, so the provider collapses it.
   */
  idempotencyKey: string
  replyTo: null | string
  subject: string
  text: string
  to: string
}

export type TransportResult = { error: string; ok: false } | { id: null | string; ok: true }

export type Transport = (message: TransportMessage) => Promise<TransportResult>

/* -------------------------------------------------------------------------------------------------
 * Subjects
 * ---------------------------------------------------------------------------------------------- */

/**
 * Subject lines, written once and in the shop's voice.
 *
 * A subject line is read in a list of thirty others, so each one leads with the thing that happened
 * and carries the order number where there is one — that is what a customer searches their inbox for
 * three weeks later. No exclamation marks and no marketing: every one of these is transactional, and
 * a receipt that shouts reads as a phishing attempt.
 */
export function subjectFor(kind: EmailKind, context: { orderNumber?: null | string }): string {
  const reference = context.orderNumber ? ` ${context.orderNumber}` : ''

  switch (kind) {
    case 'contactConfirmation':
      return 'We have your message'
    case 'orderConfirmation':
      return `Order${reference} confirmed`
    case 'orderDelivered':
      return `Order${reference} delivered`
    case 'orderShipped':
      return `Order${reference} is on its way`
    case 'passwordReset':
      return 'Reset your NORTH / 01 password'
    case 'refund':
      return `Order${reference} refunded`
    case 'verification':
      return 'Confirm your email address'
    case 'welcome':
      return 'Welcome to NORTH / 01'
  }
}
