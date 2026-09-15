import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

/**
 * **How long a password-reset link lives, and how often one may be sent** — plan §34, audit R1-15.
 *
 * `forgotPassword` had no challenge and no cooldown: five requests for one address in four seconds
 * each re-issued a token, and once Resend is configured anyone could make the shop mail a customer
 * without limit. The Server Action now refuses to issue a second link for an address within the
 * cooldown — answering with the same sentence as always, so the page still says nothing about whether
 * an account exists — and the form carries Turnstile like the other public forms.
 *
 * A token's issue time is not stored; its expiry is, and it is issued exactly `RESET_TOKEN_LIFETIME_MS`
 * before that. `Customers.ts` reads the lifetime from here, so the two cannot drift apart.
 *
 * The arithmetic is pure and tested without a database (`tests/unit/security-privacy.test.ts`);
 * `requestPasswordReset` is the one function here that touches one, and it asks its question with
 * the same bound the pure rule is defined by.
 */
export const RESET_TOKEN_LIFETIME_MS = 60 * 60 * 1000

/** One reset email per address per five minutes. Long enough to stop a flood, short enough not to trap a typo. */
export const RESET_COOLDOWN_MS = 5 * 60 * 1000

/**
 * **The latest expiry a live token may have and still be replaced.**
 *
 * A token expiring after this instant was issued less than the cooldown ago. This is the whole rule,
 * written as a bound a single SQL comparison can use — which is what lets the claim below make the
 * decision and the write in one statement.
 */
export function reissuableBefore(
  now: number,
  lifetimeMs: number = RESET_TOKEN_LIFETIME_MS,
  cooldownMs: number = RESET_COOLDOWN_MS,
): Date {
  return new Date(now + lifetimeMs - cooldownMs)
}

/** The same rule as a yes/no about one stored expiry: was a link issued within the cooldown? */
export function resetIssuedRecently(
  expiration: unknown,
  now: number,
  lifetimeMs: number = RESET_TOKEN_LIFETIME_MS,
  cooldownMs: number = RESET_COOLDOWN_MS,
): boolean {
  if (typeof expiration !== 'string' || expiration.length === 0) return false

  const expiresAt = Date.parse(expiration)

  if (Number.isNaN(expiresAt)) return false

  return expiresAt > reissuableBefore(now, lifetimeMs, cooldownMs).getTime()
}

/**
 * **Issue a reset link for this address — at most once per cooldown, however many requests arrive
 * at once.** Sweep 1, finding S05.
 *
 * The action used to *read* the stored expiry, decide, and then call `payload.forgotPassword`. Two
 * requests for one address in the same instant both read the old expiry before either wrote a new
 * one, both passed, and both mailed a link: the cooldown held for a patient abuser and not for a
 * parallel one. The mail queue did not catch it either, because a reset's dedupe key carries its
 * issue time.
 *
 * So the decision and the write are now **one statement**. The `UPDATE` claims the row only while
 * its expiry is at or before `reissuableBefore(now)`, and it sets the expiry a full lifetime ahead,
 * which is past every concurrent request's bound. Postgres serialises the competing updates on the
 * row lock, and each loser re-evaluates the condition against the row the winner wrote and finds it
 * false — the write invalidates the condition, the shape `email/send.ts` uses for its own claim.
 * Exactly one request goes on to `payload.forgotPassword`, which overwrites the expiry with its own.
 *
 * **The claim also clears the old token.** The link it replaces is about to stop working anyway, and
 * a claimed row with no token is what lets a failure hand the claim back safely: if
 * `forgotPassword` throws, nothing was issued, so the expiry is released and the customer's retry is
 * not silently swallowed by a cooldown nobody benefited from.
 *
 * **Nothing here says whether the address has an account.** An unknown address and one inside its
 * cooldown both come back `suppressed` after one indexed `UPDATE` that matched nothing, and the
 * action answers both, and `issued`, with the same sentence. Timing still separates `issued` from the
 * other two — it did before this change as well, because only that path renders and sends a mail.
 *
 * Trashed accounts are excluded, as `forgotPassword` excludes them.
 */
export async function requestPasswordReset(
  payload: Payload,
  email: string,
  now: number = Date.now(),
): Promise<'issued' | 'suppressed'> {
  const address = email.trim().toLowerCase()

  const claim = await payload.db.drizzle.execute(
    sql`UPDATE "customers"
        SET "reset_password_expiration" = ${new Date(now + RESET_TOKEN_LIFETIME_MS).toISOString()}::timestamptz,
            "reset_password_token" = NULL
        WHERE "email" = ${address}
          AND "deleted_at" IS NULL
          AND ("reset_password_expiration" IS NULL
               OR "reset_password_expiration" <= ${reissuableBefore(now).toISOString()}::timestamptz)
        RETURNING "id"`,
  )

  const claimed = (claim.rows?.[0] as { id?: number } | undefined)?.id

  if (typeof claimed !== 'number') {
    return 'suppressed'
  }

  try {
    await payload.forgotPassword({
      collection: 'customers',
      data: { email: address },
      /*
       * The forgot-password operation builds the link from `config.serverURL`, not from this
       * request — see `payload/email/resetPasswordEmail.ts` for why a `Host` header must never
       * decide where a reset link points.
       */
    })
  } catch (error) {
    /* Only while the row still holds no token: a link issued since belongs to somebody else's claim. */
    await payload.db.drizzle
      .execute(
        sql`UPDATE "customers"
            SET "reset_password_expiration" = NULL
            WHERE "id" = ${claimed} AND "reset_password_token" IS NULL`,
      )
      .catch(() => undefined)

    throw error
  }

  return 'issued'
}
