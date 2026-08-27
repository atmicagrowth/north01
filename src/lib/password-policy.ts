/**
 * **The password rule, stated once.**
 *
 * Two places need it and they must not drift: the registration and reset *forms*, which owe the
 * customer an inline message before they submit, and the `customers` collection, which owes the same
 * rule to every other path into the table — the REST API, the admin panel, a seed script.
 *
 * So this module is deliberately plain: no imports, no environment, no Payload. The collection
 * reaches it by a relative path (it is loaded by tsx outside Next) and `lib/auth/schemas.ts` reaches
 * it by the alias.
 *
 * ### Why length and nothing else
 *
 * Payload's own floor is **three characters** — `fields/validations.password` defaults `minLength` to
 * 3 — which is not a policy, and it applies to the shopper accounts this project is about to start
 * creating. Twelve is this project's floor.
 *
 * There are no composition rules — no required digit, no required symbol, no mixed case — and that
 * is a decision rather than an omission. NIST SP 800-63B stopped recommending them because they
 * measurably push people towards `Password1!` and away from length, which is the property that
 * actually resists guessing. A twelve-character floor with no character classes is both stronger and
 * easier to satisfy honestly.
 *
 * The upper bound is not a security rule but a denial-of-service one: hashing is deliberately slow
 * (PBKDF2, 25 000 iterations), so an unbounded password field is an unbounded amount of server CPU
 * that anybody can spend. 128 is far past any real passphrase.
 *
 * Rejecting a password that *is* the email address is the one content rule kept. It is the single
 * most predictable choice a person makes, it is the one an attacker tries first because they already
 * have the email, and refusing it costs a legitimate customer nothing.
 */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

export const PASSWORD_RULE_TEXT = `At least ${PASSWORD_MIN_LENGTH} characters. Longer is better than more complicated — a phrase you will remember beats a word with symbols in it.`

/**
 * Returns a message when the password is unacceptable, `null` when it is fine.
 *
 * The email is optional because the collection hook does not always have one to compare against —
 * an update that changes only the password carries no email — and a rule that cannot be checked is
 * skipped rather than guessed at.
 */
export function checkPassword(password: unknown, email?: null | string): null | string {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Enter a password.'
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`
  }

  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return 'Your password cannot be your email address.'
  }

  return null
}
