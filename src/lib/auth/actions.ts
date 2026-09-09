'use server'

import { cookies, headers as nextHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import type { CollectionSlug, Payload, SanitizedCollectionConfig, TypedUser } from 'payload'
import {
  APIError,
  AuthenticationError,
  LockedAuth,
  createLocalReq,
  generateExpiredPayloadCookie,
  generatePayloadCookie,
  logoutOperation,
} from 'payload'
import type { ZodType } from 'zod'

import { forgetCartCookie, mergeGuestCart } from '@/lib/cart/cart'
import { getPayloadClient } from '@/lib/payload'
import { courierFor } from '@/lib/email/courier'
import { dedupeKeyFor } from '@/lib/email/rules'
import { deliverEmail, enqueueEmail } from '@/lib/email/send'
import { siteUrl } from '@/lib/env.server'
import { checkPassword } from '@/lib/password-policy'

import type { AuthFormState } from './form-state'
import { ForgotPasswordSchema, LoginSchema, RegisterSchema, ResetPasswordSchema } from './schemas'
import { safeReturnPath } from './session'

/**
 * **Every authentication mutation in the storefront.** Plan §7.1e's list — registration, login,
 * logout, forgot password, reset password, session handling — and nothing else.
 *
 * ### Why Server Actions rather than route handlers
 *
 * Two reasons. Next gives every Server Action an Origin/Host check, which is CSRF protection a
 * hand-written `POST /api/login` would have to implement itself and get right. And the action can
 * set the session cookie and `redirect()` in one round trip, where a route handler would need the
 * client to follow up.
 *
 * The cost is stated in Next's own proxy documentation: a Server Action is a POST to *the route it
 * is used on*, so a proxy matcher can silently stop covering it. Nothing here relies on the proxy;
 * every action re-derives the caller from the cookie.
 *
 * ### The uniform error posture
 *
 * Wrong password, unknown email, disabled account, locked account — from the outside these are one
 * message: *"That email and password do not match an account."* Distinguishing them turns the login
 * form into an oracle that answers "does this person shop here", which is worth money to a
 * competitor and worth more to whoever is credential-stuffing. The two places that deliberately
 * break the pattern are registration, which has to tell you the address is taken or you cannot
 * proceed, and the lockout, which is explained further down.
 */

/* -------------------------------------------------------------------------------------------------
 * Form state
 * ---------------------------------------------------------------------------------------------- */

/**
 * The fields a form may safely be refilled with — everything the customer typed except the password.
 *
 * Named explicitly rather than derived from the FormData, because FormData also carries React's own
 * action bookkeeping (`$ACTION_*`) and the `next` hidden input, and a blanket echo would put all of
 * it back into the rendered HTML.
 */
const ECHOED_FIELDS = ['email', 'firstName', 'lastName'] as const

function echo(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {}

  for (const field of ECHOED_FIELDS) {
    const value = formData.get(field)

    if (typeof value === 'string' && value !== '') {
      values[field] = value
    }
  }

  return values
}

const failure = (
  previous: AuthFormState,
  formData: FormData,
  message: null | string,
  fieldErrors: Record<string, string> = {},
): AuthFormState => ({
  status: 'error',
  message,
  fieldErrors,
  values: echo(formData),
  submissionCount: previous.submissionCount + 1,
})

const success = (previous: AuthFormState, message: string): AuthFormState => ({
  status: 'success',
  message,
  fieldErrors: {},
  values: {},
  submissionCount: previous.submissionCount + 1,
})

/**
 * Zod's flattened field errors, first message per field. A control can only point at one.
 */
function parse<T>(
  schema: ZodType<T>,
  formData: FormData,
): { data: T; ok: true } | { fieldErrors: Record<string, string>; ok: false } {
  const result = schema.safeParse(Object.fromEntries(formData))

  if (result.success) {
    return { ok: true, data: result.data }
  }

  const fieldErrors: Record<string, string> = {}

  for (const issue of result.error.issues) {
    const field = issue.path[0]

    if (typeof field === 'string' && !fieldErrors[field]) {
      fieldErrors[field] = issue.message
    }
  }

  return { ok: false, fieldErrors }
}

const GENERIC_LOGIN_FAILURE = 'That email and password do not match an account.'

const UNEXPECTED_FAILURE =
  'Something went wrong on our side. Please try again in a moment — nothing has been changed.'

/* -------------------------------------------------------------------------------------------------
 * The session cookie
 * ---------------------------------------------------------------------------------------------- */

/**
 * Write Payload's session cookie through Next's cookie store.
 *
 * **The policy is Payload's, the plumbing is ours.** `generatePayloadCookie` decides the name, the
 * `Secure` and `SameSite` flags, the path and the expiry from the collection's own auth config — so
 * the seven-day customer session and the `Secure` flag set in `payload.config.ts` are honoured here
 * without being restated. Restating them is how a cookie ends up non-`Secure` in production because
 * two files disagreed.
 *
 * The translation is only of *shape*: Payload emits `expires` as a UTC string, Next wants a `Date`,
 * and Payload's `SameSite` is capitalised where Next's type is lower case.
 */
async function setSessionCookie(
  payload: Payload,
  collection: SanitizedCollectionConfig,
  token: string,
) {
  const cookie = generatePayloadCookie({
    collectionAuthConfig: collection.auth,
    cookiePrefix: payload.config.cookiePrefix,
    returnCookieAsObject: true,
    token,
  })

  const store = await cookies()

  store.set({
    name: cookie.name,
    value: cookie.value ?? '',
    httpOnly: cookie.httpOnly,
    path: cookie.path,
    domain: cookie.domain,
    secure: cookie.secure,
    sameSite: cookie.sameSite?.toLowerCase() as 'lax' | 'none' | 'strict' | undefined,
    expires: cookie.expires ? new Date(cookie.expires) : undefined,
  })
}

async function clearSessionCookie(payload: Payload, collection: SanitizedCollectionConfig) {
  const cookie = generateExpiredPayloadCookie({
    collectionAuthConfig: collection.auth,
    cookiePrefix: payload.config.cookiePrefix,
    returnCookieAsObject: true,
  })

  const store = await cookies()

  /*
   * Set an expired cookie rather than `store.delete(name)`. Deleting emits a `Set-Cookie` with no
   * attributes, which a browser matches against the stored cookie by name *and* path/domain — so a
   * cookie written with a `domain` would survive the delete and the customer would stay signed in.
   * Expiring it with the same attributes Payload wrote cannot miss.
   */
  store.set({
    name: cookie.name,
    value: '',
    httpOnly: cookie.httpOnly,
    path: cookie.path,
    domain: cookie.domain,
    secure: cookie.secure,
    sameSite: cookie.sameSite?.toLowerCase() as 'lax' | 'none' | 'strict' | undefined,
    expires: cookie.expires ? new Date(cookie.expires) : new Date(0),
  })
}

/* -------------------------------------------------------------------------------------------------
 * Registration
 * ---------------------------------------------------------------------------------------------- */

/**
 * Create an account and sign the customer straight in.
 *
 * **On the duplicate-email question.** Every other message in this file refuses to confirm whether
 * an address has an account. Registration cannot: telling somebody "that did not work" without
 * telling them why leaves them stuck on a form with no way forward, and the address is one they
 * typed themselves. The privacy-preserving alternative — accept the registration silently and send
 * an email explaining an account already exists — needs an email transport, which is **Phase 19**.
 *
 * The exposure is also smaller than it looks: a registration form leaks membership one address at a
 * time, at the cost of a full round trip, and Turnstile in **Phase 26** is what puts a price on
 * doing that at scale. The forgot-password flow, which is the one an attacker would actually script,
 * stays silent — see below.
 *
 * `overrideAccess: false` deliberately. The `customers` collection says `create: anyone`, so this
 * runs through exactly the same gate as `POST /api/customers`, and the storefront gets no privilege
 * the REST API does not have. That is the property worth having: one rule, auditable in one file.
 */
export async function register(
  previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = parse(RegisterSchema, formData)

  if (!parsed.ok) {
    return failure(previous, formData, 'Check the highlighted fields.', parsed.fieldErrors)
  }

  const next = safeReturnPath(formData.get('next')?.toString())
  const payload = await getPayloadClient()

  let created: { id: number } | null = null

  try {
    created = await payload.create({
      collection: 'customers',
      overrideAccess: false,
      data: {
        email: parsed.data.email,
        password: parsed.data.password,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        /*
         * Named because the generated `Customer` type requires it — `accountStatus` is a `required`
         * select, so TypeScript asks for it even though the column has a default. It is not the
         * client deciding: the field's `create` access is staff-only, so this value is stripped from
         * an anonymous request before it reaches the database and the column default supplies the
         * same answer. Writing the default here keeps the two in agreement rather than asserting the
         * type away.
         */
        accountStatus: 'active',
      },
    })
  } catch (error) {
    if (isDuplicateEmail(error)) {
      return failure(previous, formData, null, {
        email:
          'An account already uses that email address. Sign in instead, or reset your password.',
      })
    }

    const validation = firstValidationMessage(error)

    if (validation) {
      return failure(previous, formData, null, { [validation.path]: validation.message })
    }

    payload.logger.error({ err: error, msg: 'Customer registration failed unexpectedly.' })

    return failure(previous, formData, UNEXPECTED_FAILURE)
  }

  /*
   * Registration signs you in. Doing it as a real `login` rather than by minting a token from the
   * created document means the new account goes through `beforeLogin` and gets a real session row,
   * so there is exactly one code path that can produce a signed-in customer.
   */
  const signedIn = await startSession(payload, parsed.data.email, parsed.data.password)

  if (!signedIn) {
    /*
     * The account exists and the sign-in did not. Sending them to the login form is honest and
     * recoverable; pretending the registration failed would be a lie about a row that is now there.
     */
    redirect('/login?registered=1')
  }

  await claimGuestCart(signedIn.user?.id)

  /*
   * **§19.1a's welcome message.**
   *
   * After the account exists and after the session does, and deliberately not before either: a
   * welcome for an account that failed to be created is a lie, and this is the last thing before the
   * redirect so nothing a mail provider does can delay a customer reaching their account.
   *
   * `.catch` and a `null` courier are both non-events. Plan §A.5 puts email on the non-critical side
   * of the line, and a registration that failed because a message could not be sent would be exactly
   * the coupling §19.1d forbids. The row is written either way, so an unconfigured shop still has a
   * record of the welcome it owes and `pnpm email:drain` sends it when a key appears.
   */
  if (created) {
    const queued = await enqueueEmail(payload, {
      customerId: created.id,
      data: { accountHref: `${siteUrl}/account`, firstName: parsed.data.firstName },
      dedupeKey: dedupeKeyFor('welcome', { id: created.id }),
      kind: 'welcome',
      to: parsed.data.email,
    }).catch(() => ({ outcome: 'error' as const, reason: 'enqueue threw' }))

    const courier = await courierFor(payload)

    if (queued.outcome === 'claimed' && courier) {
      await deliverEmail(payload, queued.id, courier).catch(() => undefined)
    }
  }

  redirect(next ?? '/account')
}

/* -------------------------------------------------------------------------------------------------
 * Login
 * ---------------------------------------------------------------------------------------------- */

export async function login(previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = parse(LoginSchema, formData)

  if (!parsed.ok) {
    return failure(previous, formData, 'Check the highlighted fields.', parsed.fieldErrors)
  }

  const next = safeReturnPath(formData.get('next')?.toString())
  const payload = await getPayloadClient()

  let locked = false

  let signedInCustomerId: number | undefined

  try {
    const signedIn = await startSession(payload, parsed.data.email, parsed.data.password)

    if (!signedIn) {
      return failure(previous, formData, GENERIC_LOGIN_FAILURE)
    }

    signedInCustomerId = signedIn.user?.id
  } catch (error) {
    /*
     * **The lockout is the one failure that gets its own message**, and the reasoning runs the other
     * way from everywhere else. §7.1e wants the brute-force case handled; a lockout is reached only
     * after five failures against one address, at which point the attacker already knows the address
     * exists — telling them nothing new — while the legitimate customer who mistyped five times
     * needs to know that waiting is the answer and trying again is not.
     */
    if (isLockedAccount(error)) {
      locked = true
    } else {
      payload.logger.error({ err: error, msg: 'Customer login failed unexpectedly.' })

      return failure(previous, formData, UNEXPECTED_FAILURE)
    }
  }

  if (locked) {
    return failure(
      previous,
      formData,
      'Too many sign-in attempts. This account is locked for a few minutes — try again shortly, or reset your password.',
    )
  }

  await claimGuestCart(signedInCustomerId)

  redirect(next ?? '/account')
}

/**
 * **Plan §14.1b, hung off the two moments a guest becomes a customer.**
 *
 * Sign-in and registration are the only transitions where a guest bag and a customer bag can both
 * exist, so this is the only place the merge belongs. It runs **after** the session cookie is set and
 * **before** the redirect, so the page the customer lands on already renders the merged bag — a merge
 * that happened one navigation later would show them an empty header badge and then change it.
 *
 * `mergeGuestCart` swallows its own failures and logs them: a bag that would not merge must never
 * turn a successful sign-in into a failed one. See that function for what is lost in that case, which
 * is at worst the guest additions and never the customer's own bag.
 */
async function claimGuestCart(customerId: number | undefined): Promise<void> {
  if (typeof customerId === 'number') {
    await mergeGuestCart(customerId)
  }
}

/**
 * `payload.login` plus the cookie, or `null` when the credentials are refused.
 *
 * Only `AuthenticationError` becomes `null`; anything else — a locked account, a database failure —
 * is rethrown, because "wrong password" and "the database is down" must not look the same to the
 * customer or to the log.
 */
async function startSession(payload: Payload, email: string, password: string) {
  try {
    const result = await payload.login({
      collection: 'customers',
      data: { email, password },
    })

    if (!result.token) {
      return null
    }

    await setSessionCookie(payload, payload.collections.customers.config, result.token)

    return result
  } catch (error) {
    if (isAuthenticationFailure(error)) {
      return null
    }

    throw error
  }
}

/* -------------------------------------------------------------------------------------------------
 * Logout
 * ---------------------------------------------------------------------------------------------- */

/**
 * End the session — **on the server, not merely in the browser**.
 *
 * Clearing the cookie alone would leave the session row alive, so anyone holding a copy of the token
 * (a shared machine's browser cache, a proxy log) could keep using it for up to seven days.
 * `logoutOperation` removes this session's id from the customer's `sessions` array, and the JWT
 * strategy checks that array on every request — so the token is dead everywhere the instant this
 * returns.
 *
 * That is also what makes §7.1e's *"user logs out from another tab"* behave: the other tab is the
 * same browser and the same cookie, which is now both gone and revoked. Its next request — a
 * navigation, or any action — resolves to no viewer and the account layout redirects to `/login`.
 *
 * `allSessions` is deliberately not set. Signing out on a laptop should not sign you out on a phone;
 * the operation that ends *every* session is disabling the account, and that has its own trigger.
 */
export async function logout(): Promise<void> {
  const payload = await getPayloadClient()
  const { user } = await payload.auth({ headers: await nextHeaders() })

  if (user) {
    const collectionSlug = (user as { collection?: CollectionSlug }).collection
    const collection = collectionSlug ? payload.collections[collectionSlug] : undefined

    if (collection) {
      try {
        await logoutOperation({
          collection,
          req: await createLocalReq({ user: user as TypedUser }, payload),
        })
      } catch (error) {
        /*
         * Swallowed on purpose, and only here. If the session row cannot be cleared we still want
         * the cookie gone: a customer who pressed "sign out" must end up signed out of the browser
         * in front of them, and a failure to tidy the server-side row is ours to fix from the log,
         * not theirs to be blocked by.
         */
        payload.logger.error({ err: error, msg: 'Could not revoke the session row during logout.' })
      }
    }
  }

  await clearSessionCookie(payload, payload.collections.customers.config)

  /*
   * The bag cookie is a guest identity, and this session is over. `resolveCart` refuses an owned
   * cart by token anyway — Phase 14's second sweep made sure of that after measuring the previous
   * account holder's bag surviving a sign-out — so this is the tidy half of a two-part fix.
   */
  await forgetCartCookie()

  redirect('/login?signedOut=1')
}

/* -------------------------------------------------------------------------------------------------
 * Forgot password
 * ---------------------------------------------------------------------------------------------- */

/**
 * Issue a reset token and mail the link.
 *
 * **This one never says whether the address is registered**, and Payload agrees — its
 * `forgotPassword` operation returns silently when no user matches, with the comment *"we prefer to
 * fail silently"*. So the answer is the same either way, and it is phrased so that it is not a lie
 * in the negative case: *if* there is an account, a link is on its way.
 *
 * Until **Phase 19** "mailed" means "written to the server log" — there is no transport, and
 * `payload/email/logEmailAdapter.ts` explains why logging the whole message is the honest stand-in
 * rather than Payload's default, which would discard the token. The flow itself is real: a real
 * single-use token, a real one-hour expiry, a real reset page.
 */
export async function forgotPassword(
  previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = parse(ForgotPasswordSchema, formData)

  if (!parsed.ok) {
    return failure(previous, formData, null, parsed.fieldErrors)
  }

  const payload = await getPayloadClient()

  try {
    await payload.forgotPassword({
      collection: 'customers',
      data: { email: parsed.data.email },
      /*
       * The forgot-password operation builds the link from `config.serverURL`, not from this
       * request — see `payload/email/resetPasswordEmail.ts` for why a `Host` header must never
       * decide where a reset link points.
       */
    })
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Could not start a password reset.' })

    return failure(previous, formData, UNEXPECTED_FAILURE)
  }

  return success(
    previous,
    'If an account exists for that address, a link to choose a new password is on its way. It can be used once and expires in an hour.',
  )
}

/* -------------------------------------------------------------------------------------------------
 * Reset password
 * ---------------------------------------------------------------------------------------------- */

/**
 * Trade a token for a new password.
 *
 * §7.1e names two edge cases and they arrive as the same error, which is correct: an **expired** link
 * and a **reused** one are both "this token is no longer valid", and Payload cannot tell them apart
 * either — `resetPassword` clears `resetPasswordToken` on success, so the second use finds nothing,
 * exactly as the sixty-first minute does. The message says both.
 *
 * **The password policy is checked here, not by a hook**, because `resetPassword` writes through
 * `payload.db.updateOne` and never runs a collection hook — so the `customers` `beforeValidate` rule
 * that governs every other path does not see this one. Same function, so the rules cannot diverge;
 * `lib/password-policy.ts` says why it is shared rather than duplicated.
 *
 * Resetting does **not** sign the customer in. A password reset is the one moment where the person
 * holding the link might not be the account holder, and handing out a seven-day session on the
 * strength of an emailed token is how a mailbox compromise becomes an account compromise. They land
 * on the sign-in form and use the password they just chose — which also confirms it works.
 */
export async function resetPassword(
  previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = parse(ResetPasswordSchema, formData)

  if (!parsed.ok) {
    return failure(previous, formData, null, parsed.fieldErrors)
  }

  const payload = await getPayloadClient()

  const problem = checkPassword(parsed.data.password)

  if (problem) {
    return failure(previous, formData, null, { password: problem })
  }

  try {
    await payload.resetPassword({
      collection: 'customers',
      data: { password: parsed.data.password, token: parsed.data.token },
      /*
       * `overrideAccess` is a required argument on this operation rather than an optional one, and
       * `true` is the only correct answer: the caller is by definition not signed in, and the token
       * is the authorisation.
       */
      overrideAccess: true,
    })
  } catch (error) {
    if (error instanceof APIError && error.status === 403) {
      return failure(
        previous,
        formData,
        'This link is no longer valid — it may have expired, or it may already have been used. Ask for a new one.',
      )
    }

    const validation = firstValidationMessage(error)

    if (validation) {
      return failure(previous, formData, null, { [validation.path]: validation.message })
    }

    payload.logger.error({ err: error, msg: 'Password reset failed unexpectedly.' })

    return failure(previous, formData, UNEXPECTED_FAILURE)
  }

  redirect('/login?reset=1')
}

/* -------------------------------------------------------------------------------------------------
 * Error shapes
 * ---------------------------------------------------------------------------------------------- */

/**
 * Payload's errors are `APIError` subclasses carrying a status and, for validation, a `data.errors`
 * array. These read that shape in one place so no call site has to guess at it.
 *
 * The tests are on the error's own class rather than on message text or status: the messages come
 * from `@payloadcms/translations` and would change with a locale or a version bump, and the statuses
 * are not distinguishing — `AuthenticationError` and `LockedAuth` are **both** 401, so a status test
 * would quietly fold "wrong password" and "account locked" into one, which is the exact distinction
 * the login flow needs to keep.
 */
function isAuthenticationFailure(error: unknown): boolean {
  return error instanceof AuthenticationError
}

function isLockedAccount(error: unknown): boolean {
  return error instanceof LockedAuth
}

type ValidationIssue = { message: string; path: string }

function validationIssues(error: unknown): ValidationIssue[] {
  if (!(error instanceof APIError) || !error.data || !('errors' in error.data)) {
    return []
  }

  const { errors } = error.data as { errors?: unknown }

  if (!Array.isArray(errors)) {
    return []
  }

  return errors.filter(
    (issue): issue is ValidationIssue =>
      typeof issue === 'object' &&
      issue !== null &&
      typeof (issue as ValidationIssue).path === 'string' &&
      typeof (issue as ValidationIssue).message === 'string',
  )
}

function isDuplicateEmail(error: unknown): boolean {
  return validationIssues(error).some((issue) => issue.path === 'email')
}

function firstValidationMessage(error: unknown): null | ValidationIssue {
  return validationIssues(error)[0] ?? null
}
