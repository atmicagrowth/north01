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
 * Pure, so the arithmetic is tested without a database.
 */
export const RESET_TOKEN_LIFETIME_MS = 60 * 60 * 1000

/** One reset email per address per five minutes. Long enough to stop a flood, short enough not to trap a typo. */
export const RESET_COOLDOWN_MS = 5 * 60 * 1000

export function resetIssuedRecently(
  expiration: unknown,
  now: number,
  lifetimeMs: number = RESET_TOKEN_LIFETIME_MS,
  cooldownMs: number = RESET_COOLDOWN_MS,
): boolean {
  if (typeof expiration !== 'string' || expiration.length === 0) return false

  const expiresAt = Date.parse(expiration)

  if (Number.isNaN(expiresAt) || now >= expiresAt) return false

  return now - (expiresAt - lifetimeMs) < cooldownMs
}
