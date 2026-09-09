import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

import type { EmailData } from '@/emails/messages'
import type { DeliveryEnv, EmailKind, EmailStatus, Transport } from './rules'

import { renderEmail } from '@/emails/messages'
import {
  isRetryable,
  MAX_DELIVERY_ATTEMPTS,
  resolveRecipient,
  subjectFor,
  SUPPRESSION_COPY,
  toAttemptCount,
} from './rules'

/**
 * **§19.1a's centralized email service** — the one way anything in this application sends a message.
 *
 * > *"Build a centralized email service wrapper… Do not call Resend directly from random
 * > components."*
 *
 * **No `server-only` guard, deliberately, and for the third phase running.** This module takes a
 * `Payload` instance and a `Courier` as arguments rather than reaching for either, so `pnpm
 * verify:email` can drive the whole thing — the dedupe barrier, the retry ceiling, the dev safeguard,
 * the failure recording — with a transport that opens no socket and an environment it chooses. The
 * key lives next door in `resend.ts`, behind the guard, which is where a secret can actually leak.
 *
 * ---
 *
 * ### Two steps, because one of the callers is inside a transaction
 *
 * Sending is split into **claiming** and **delivering**, and the split is not ceremony:
 *
 * - `enqueueEmail` writes a `pending` row and nothing else. It is safe to call inside a database
 *   transaction, and it is *correct* to: if the order never reaches `shipped`, the intention to say
 *   so rolls back with it.
 * - `deliverEmail` renders and hands the message to the provider. It must never run inside a
 *   transaction, because a mail provider taking four seconds would hold a row lock for four seconds,
 *   and because a rollback afterwards would leave a dispatch notice sent for a dispatch that never
 *   happened.
 *
 * Payload 3 gives no post-commit collection hook — `afterChange` and `afterOperation` both run before
 * `commitTransaction` — so for the admin-panel transitions there is no third option. The queue is not
 * an optimisation; it is the only correct shape.
 *
 * `sendEmail` is the two together, for callers that are demonstrably outside a transaction.
 *
 * ### Nothing here throws
 *
 * §19.1d: *"A failed email should not roll back a successful payment/order."* Every function returns
 * an outcome. The webhook route is the reason this is absolute rather than tidy: it wraps its body in
 * a catch that turns any throw into a 500, Stripe retries, the retry hits the unique event id and
 * returns 200 without reprocessing — so a single thrown error from a mail call would leave the order
 * paid and the customer permanently without a confirmation nothing would ever resend.
 */

/**
 * Everything a send needs that this module refuses to look up for itself.
 *
 * `appEnv` and `allowlist` are arguments rather than imports because `env.core` is fenced by ESLint
 * outside four paths and `env.server` carries the guard this module must not have. Passing them also
 * makes the dev safeguard testable from both sides: the harness asks what happens in `production` and
 * what happens on a laptop, without setting environment variables.
 */
/**
 * How long a failed message waits before the drain looks at it again. Five minutes: long enough that
 * the condition which caused the failure could plausibly have changed, short enough that a transient
 * blip clears without anybody being asked to do anything.
 */
const RETRY_BACKOFF_MS = 5 * 60 * 1000

export type Courier = {
  allowlist: readonly string[]
  appEnv: DeliveryEnv
  from: string
  replyTo: null | string
  transport: Transport
}

export type EnqueueInput<K extends EmailKind = EmailKind> = {
  customerId?: null | number
  data: EmailData[K]
  dedupeKey: string
  kind: K
  orderId?: null | number
  orderNumber?: null | string
  /**
   * A body this module did not render.
   *
   * Exactly one caller uses it: Payload's own password-reset mail, whose HTML is produced by
   * `Customers.auth.forgotPassword.generateEmailHTML` before any of this is reached. It is held in
   * memory and never written to the row — see `retainData` — so it exists for the immediate delivery
   * and no retry can resurrect it.
   */
  prerendered?: { html: string; subject: string; text: string }
  /**
   * Whether the template data may be written to the database.
   *
   * `false` for anything carrying a single-use credential — a password-reset link, a verification
   * link. Storing those would put a working password-reset token at rest in a table staff can read,
   * which is a worse outcome than the one the queue exists to prevent. Such a message is delivered
   * on the spot and is **not retryable**, which is correct: a customer who did not receive a reset
   * link asks for another one, and that issues a fresh token.
   */
  retainData?: boolean
  to: string
}

export type EnqueueOutcome =
  | { id: number; outcome: 'claimed' }
  | { outcome: 'duplicate' }
  | { outcome: 'error'; reason: string }

/**
 * **Claim the right to send this message.**
 *
 * The insert *is* the check. A unique violation on `dedupeKey` means somebody else already owns this
 * message, which is §19.1c satisfied by a database constraint rather than by a read-then-write with a
 * race in the middle.
 *
 * Pass `req` when calling from inside a Payload hook so the row joins that transaction.
 */
export async function enqueueEmail<K extends EmailKind>(
  payload: Payload,
  input: EnqueueInput<K>,
  req?: PayloadRequest,
): Promise<EnqueueOutcome> {
  try {
    const row = await payload.create({
      collection: 'email-messages',
      data: {
        attempts: 0,
        customer: input.customerId ?? null,
        data: input.retainData === false ? null : (input.data as never),
        dedupeKey: input.dedupeKey,
        kind: input.kind,
        order: input.orderId ?? null,
        status: 'pending',
        subject:
          input.prerendered?.subject ??
          subjectFor(input.kind, { orderNumber: input.orderNumber ?? null }),
        to: input.to,
      },
      overrideAccess: true,
      req,
    })

    return { id: row.id, outcome: 'claimed' }
  } catch (error) {
    /*
     * A unique violation is the ordinary case, not the exceptional one — it is what a Stripe retry
     * looks like from here. Anything else is a real fault, and is reported rather than swallowed, so
     * a caller can log it without being able to fail because of it.
     */
    if (isDuplicateKey(error)) {
      return { outcome: 'duplicate' }
    }

    const message = error instanceof Error ? error.message : String(error)

    return { outcome: 'error', reason: message.slice(0, 400) }
  }
}

/**
 * **Did this insert lose the race for the key?**
 *
 * Two shapes, and both have to be recognised, because which one arrives depends on timing.
 *
 * 1. **A Payload `ValidationError` naming `dedupeKey`.** Payload checks uniqueness before it inserts,
 *    so a *sequential* duplicate — the ordinary Stripe retry, arriving after the first is committed —
 *    is caught there and arrives pre-wrapped: `{ message: 'Value must be unique', path: 'dedupeKey' }`.
 * 2. **A raw Postgres unique violation.** That pre-check is a read followed by a write, so it cannot
 *    see a row a concurrent transaction has not committed yet. Two retries arriving at the same
 *    instant both pass validation and both insert, and the *database* refuses the second —
 *    `duplicate key value violates unique constraint`, SQLSTATE 23505.
 *
 * The second shape is the one §19.1c actually depends on, and it is why the unique index matters
 * rather than the validator. Matching only the first would classify the real race as an unexpected
 * error and log a fault every time the barrier did its job.
 *
 * The check is narrow on purpose: a `ValidationError` about some *other* field is a genuine defect
 * and must not be swallowed as "already sent".
 */
function isDuplicateKey(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  if (/duplicate key value|23505/i.test(error.message)) {
    return true
  }

  const data = (error as { data?: { errors?: { path?: string }[] } }).data

  return (
    error.name === 'ValidationError' &&
    Array.isArray(data?.errors) &&
    data.errors.some((entry) => entry?.path === 'dedupeKey')
  )
}

export type DeliverOutcome =
  | { outcome: 'failed'; reason: string }
  | { outcome: 'notClaimable' }
  | { outcome: 'sent' }
  | { outcome: 'suppressed'; reason: string }

/**
 * **Deliver one claimed message.**
 *
 * The attempt is *claimed* with a conditional `UPDATE` rather than checked and then written — the
 * shape Phase 17's sweeps arrived at. Two drains running at once would otherwise both read
 * `attempts: 0`, both pass the ceiling test, and both send. Postgres serialises the statement; the
 * loser sees zero rows and stops.
 *
 * The same statement also enforces `MAX_DELIVERY_ATTEMPTS`, so the ceiling cannot be raced past.
 */
export async function deliverEmail(
  payload: Payload,
  messageId: number,
  courier: Courier,
  prerendered?: { html: string; subject: string; text: string },
): Promise<DeliverOutcome> {
  const row = await payload
    .findByID({ collection: 'email-messages', depth: 0, id: messageId, overrideAccess: true })
    .catch(() => null)

  if (!row) {
    return { outcome: 'notClaimable' }
  }

  const observed = toAttemptCount(row.attempts)

  if (!isRetryable(row.status as EmailStatus, observed)) {
    return { outcome: 'notClaimable' }
  }

  /*
   * **A compare-and-set, not a counted increment.** Phase 19's first sweep found the difference, and
   * it is subtle enough to be worth stating.
   *
   * The first version incremented under `WHERE attempts < 3`. Postgres serialises the two statements,
   * but that is not the same as excluding the second: the loser re-evaluates its predicate against
   * the row the winner just wrote, `status` is still `pending` because nothing has recorded an
   * outcome yet, and `1 < 3` is still true. Both matched, both rendered, and the customer received
   * the message twice. The docblock claimed the loser sees zero rows; the harness only ever tested
   * the sequential case, where the status has already moved to `sent` — which is precisely the blind
   * spot Phase 17's sweeps named.
   *
   * `AND "attempts" = ${observed}` fixes it, because the winner changes the value the loser matched
   * on. Same shape as the order claim in `checkout/fulfil.ts`: the condition and the write are one
   * statement, and the write invalidates the condition.
   */
  const claim = await payload.db.drizzle.execute(
    sql`UPDATE "email_messages"
        SET "attempts" = "attempts" + 1, "last_attempt_at" = ${new Date().toISOString()}
        WHERE "id" = ${messageId}
          AND "status" IN ('pending', 'failed')
          AND "attempts" = ${observed}`,
  )

  if ((claim.rowCount ?? 0) === 0) {
    return { outcome: 'notClaimable' }
  }

  /*
   * The dev safeguard, applied at the last possible moment rather than at enqueue time. Deciding here
   * means the *record* of what the shop meant to send is identical in every environment, and only the
   * delivery differs — so a suppressed row on a developer's machine and a sent row in production are
   * the same row with a different outcome, which is what makes the queue readable.
   */
  const recipient = resolveRecipient({
    allowlist: courier.allowlist,
    appEnv: courier.appEnv,
    intended: String(row.to),
  })

  if (recipient.status === 'suppressed') {
    await record(payload, messageId, {
      error: SUPPRESSION_COPY[recipient.reason],
      status: 'suppressed',
    })

    return { outcome: 'suppressed', reason: recipient.reason }
  }

  let body: { html: string; text: string }

  if (prerendered) {
    body = prerendered
  } else if (row.data === null || row.data === undefined) {
    /*
     * A message whose payload was deliberately not retained — a reset link. It cannot be rendered a
     * second time, and that is the intended behaviour rather than a defect, so it is recorded as
     * failed with the reason instead of being retried into nothing.
     */
    await record(payload, messageId, {
      error:
        'The template data was not retained, so this message cannot be re-rendered. Ask for a new one.',
      status: 'failed',
    })

    return { outcome: 'failed', reason: 'notRenderable' }
  } else {
    try {
      body = await renderEmail(row.kind as EmailKind, row.data as never)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The template could not be rendered.'

      await record(payload, messageId, { error: reason.slice(0, 900), status: 'failed' })

      return { outcome: 'failed', reason }
    }
  }

  const result = await courier
    .transport({
      from: courier.from,
      html: body.html,
      /*
       * **The provider's own barrier, and what makes "pending is not a lock" safe.**
       *
       * There is an unavoidable window between the provider accepting a message and this process
       * recording that it did. A deploy, an OOM kill, or a failed `record()` inside that window
       * leaves the row `pending`, and the next drain re-sends. Handing Resend the same key both
       * times collapses the replay on their side, which turns a crash from a duplicate into a no-op.
       */
      idempotencyKey: String(row.dedupeKey),
      replyTo: courier.replyTo,
      subject: String(row.subject),
      text: body.text,
      to: recipient.to,
    })
    .catch((error: unknown) => ({
      error: error instanceof Error ? error.message : 'The transport threw.',
      ok: false as const,
    }))

  if (!result.ok) {
    await record(payload, messageId, { error: result.error.slice(0, 900), status: 'failed' })

    return { outcome: 'failed', reason: result.error }
  }

  await record(payload, messageId, {
    error: null,
    providerId: result.id,
    sentAt: new Date().toISOString(),
    status: 'sent',
  })

  return { outcome: 'sent' }
}

/**
 * Claim and deliver in one call, for callers that are demonstrably **outside** a transaction — the
 * Stripe webhook route after `applyStripeEvent` has committed, and the server actions behind
 * registration and password reset.
 *
 * A `duplicate` is a success from the caller's point of view: the message exists and somebody else is
 * responsible for it.
 */
export async function sendEmail<K extends EmailKind>(
  payload: Payload,
  input: EnqueueInput<K>,
  courier: Courier,
): Promise<DeliverOutcome | EnqueueOutcome> {
  const claimed = await enqueueEmail(payload, input)

  if (claimed.outcome !== 'claimed') {
    return claimed
  }

  return deliverEmail(payload, claimed.id, courier, input.prerendered)
}

/**
 * **Deliver whatever is owed** — §19.1d's *"allow retry where appropriate"*, and the only route by
 * which an admin-panel transition's queued message reaches a customer.
 *
 * Ordered oldest first, so a backlog drains in the order it accumulated rather than newest-first,
 * which would leave the oldest failure permanently at the back.
 */
export async function drainEmails(
  payload: Payload,
  courier: Courier,
  { limit = 25 }: { limit?: number } = {},
): Promise<{ attempted: number; failed: number; sent: number; suppressed: number }> {
  /*
   * **A message that just failed is not retried in the same breath.**
   *
   * Sweep 1's finding: the webhook route delivers a message and then, twenty lines later, drains — so
   * a provider refusal was re-attempted milliseconds later against the same provider that had just
   * refused it, and the whole retry budget was spent inside one request. `last_attempt_at` was
   * written by the claim and read by nothing.
   *
   * It is read now. A retry budget is only worth having if the attempts are far enough apart for the
   * condition to have changed — a domain being verified, an outage ending.
   */
  const cutoff = new Date(Date.now() - RETRY_BACKOFF_MS).toISOString()

  const { docs } = await payload.find({
    collection: 'email-messages',
    depth: 0,
    limit,
    overrideAccess: true,
    sort: 'createdAt',
    where: {
      and: [
        { status: { in: ['pending', 'failed'] } },
        { attempts: { less_than: MAX_DELIVERY_ATTEMPTS } },
        { or: [{ lastAttemptAt: { exists: false } }, { lastAttemptAt: { less_than: cutoff } }] },
      ],
    },
  })

  const tally = { attempted: 0, failed: 0, sent: 0, suppressed: 0 }

  for (const doc of docs) {
    if (!isRetryableRow(doc)) {
      continue
    }

    tally.attempted += 1

    const outcome = await deliverEmail(payload, doc.id, courier)

    if (outcome.outcome === 'sent') tally.sent += 1
    else if (outcome.outcome === 'suppressed') tally.suppressed += 1
    else if (outcome.outcome === 'failed') tally.failed += 1
  }

  return tally
}

function isRetryableRow(doc: { attempts?: null | number }): boolean {
  return toAttemptCount(doc.attempts) < MAX_DELIVERY_ATTEMPTS
}

/** Every terminal write goes through here, so no path can forget to stamp what happened. */
async function record(
  payload: Payload,
  id: number,
  data: {
    error?: null | string
    providerId?: null | string
    sentAt?: string
    status: 'failed' | 'sent' | 'suppressed'
  },
): Promise<void> {
  await payload
    .update({ collection: 'email-messages', data, id, overrideAccess: true })
    .catch((error: unknown) => {
      /*
       * Logged rather than discarded. A terminal write that fails after a successful send is the one
       * error that *creates* a duplicate — the row stays `pending`, the next drain re-sends it, and
       * without this line nothing anywhere would say why.
       */
      payload.logger.error({
        err: error,
        messageId: id,
        msg: 'An email outcome could not be recorded. The message may be re-attempted.',
      })
    })
}
