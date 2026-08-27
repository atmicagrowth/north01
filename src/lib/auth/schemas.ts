import { z } from 'zod'

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, checkPassword } from '@/lib/password-policy'

/**
 * What each auth form is allowed to submit.
 *
 * **This is input shaping, not the security boundary.** Every rule here is enforced again underneath
 * — the password policy by a `customers` hook, ownership by `payload/access/`, the email format by
 * Payload's own field validation — because a server action is one door into the data and the REST
 * API is another. What these schemas buy is a *good error*: a named field, a sentence a customer can
 * act on, and a form that comes back filled in rather than blank.
 *
 * `.trim()` on email is not cosmetic. A pasted address routinely carries a leading space, and the
 * unique index does not consider `" ada@example.com"` and `"ada@example.com"` the same address —
 * which would let one person register twice and then fail to sign in as either.
 */

const email = z
  .email({ error: 'Enter a valid email address.' })
  .trim()
  .toLowerCase()
  .max(320, 'That email address is too long.')

/**
 * The password *policy* applies when a password is being chosen. It deliberately does **not** apply
 * to the login form: a customer whose existing password predates a policy change must still be able
 * to sign in, and telling an unauthenticated caller "that is not even a valid password" is a free
 * hint about what is. Login checks only that something was typed.
 */
const newPassword = z
  .string({ error: 'Choose a password.' })
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`)

const name = (label: string) =>
  z
    .string({ error: `Enter your ${label}.` })
    .trim()
    .min(1, `Enter your ${label}.`)
    .max(100, `That ${label} is too long.`)

export const LoginSchema = z.object({
  email,
  password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.'),
})

export const RegisterSchema = z
  .object({
    firstName: name('first name'),
    lastName: name('last name'),
    email,
    password: newPassword,
  })
  /*
   * The one content rule the policy keeps — password must not be the email — checked here so the
   * form can point at the password field. `checkPassword` is the same function the collection hook
   * calls, so the two cannot disagree.
   */
  .refine((value) => checkPassword(value.password, value.email) === null, {
    path: ['password'],
    error: 'Your password cannot be your email address.',
  })

export const ForgotPasswordSchema = z.object({ email })

export const ResetPasswordSchema = z.object({
  token: z
    .string({ error: 'This reset link is incomplete.' })
    .min(1, 'This reset link is incomplete.'),
  password: newPassword,
})

/*
 * There is no change-password schema, and that is a scope decision rather than an omission. §7.1e
 * lists the flows Phase 7 owns and a signed-in password change is not among them; §20.1d gives
 * `/account/settings` to Phase 20, which is where it belongs beside the rest of the profile. The
 * *permission* exists today — `customers` grants a customer `update` on their own row, and the
 * password policy hook applies to it — so Phase 20 adds a screen, not a rule.
 */
