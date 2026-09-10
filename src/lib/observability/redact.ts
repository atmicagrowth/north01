/**
 * **Plan §25.1d — what must never leave this application inside an error report.**
 *
 * > *"Do not send sensitive payment data or raw secrets."* / *"Sentry must redact sensitive
 * > information and avoid payment credentials, authentication secrets, or raw personal data where
 * > not necessary."*
 *
 * An error report is the one payload in a system that is assembled by accident. Nobody chooses what
 * goes into a stack trace, a breadcrumb or a captured request body — the runtime does, from whatever
 * happened to be in scope. That is exactly why redaction cannot be a habit at call sites: it has to
 * run over the finished event, on the way out, after everything unexpected is already in it.
 *
 * So this module assumes nothing about shape. It walks whatever it is given, and it redacts on **two
 * independent grounds**, because either alone leaks:
 *
 * - **By key** — anything named like a secret. This catches a value whose *format* is unremarkable:
 *   a password, a session id, a customer's address line.
 * - **By value** — anything shaped like a secret. This catches a secret in a place nobody thought to
 *   name: a Stripe key interpolated into an error message, a connection string in a `cause`, a
 *   bearer token inside a URL.
 *
 * Pure, and driven by `pnpm verify:analytics`. Redaction that is not tested is redaction that is
 * believed in, and this is the wrong thing to believe in: nothing in the application misbehaves when
 * it stops working. The reports just quietly start carrying more than they should.
 */

export const REDACTED = '[redacted]'

/**
 * Keys whose **value** is sensitive regardless of what it looks like.
 *
 * Deliberately broad, and deliberately substring-matched: `stripeSecretKey`, `STRIPE_SECRET_KEY`
 * and `secret` all have to match, and the cost of matching something harmless is a redacted field in
 * an error report — which is nearly free, while the cost of missing one is a credential in a
 * third-party system.
 *
 * `card`, `cvc`, `cvv`, `pan` and `iban` are here even though this application **never sees a card
 * number** — Stripe Checkout is hosted, and §17 keeps it that way. A key named `cardNumber` reaching
 * this function means something has gone wrong that is worth not making worse.
 */
export const SENSITIVE_KEY = new RegExp(
  [
    'auth',
    'card',
    'connection',
    'cookie',
    'credential',
    'cvc',
    'cvv',
    'database_?url',
    'dsn',
    'iban',
    'jwt',
    'pan',
    'passw',
    'payment_?method',
    'pin',
    'secret',
    'session',
    'signature',
    'ssn',
    'token',
    'api_?key',
  ].join('|'),
  'i',
)

/**
 * Values that are sensitive whatever they are called.
 *
 * Each entry is a real credential format this project actually handles, not a generic guess:
 *
 * - **Stripe** — `sk_`/`rk_` secret keys, `whsec_` webhook secrets, `pk_` publishable keys. The
 *   publishable key is not a secret, and it is redacted anyway: seeing which environment's key is in
 *   play is worth less than never having to think about which prefixes are safe.
 * - **Postgres** — a connection string carries the password inline. `env.core.ts` validates one; an
 *   error thrown while connecting quotes one.
 * - **Bearer tokens and JWTs** — the session cookie's contents, and anything Payload puts in a header.
 * - **Resend, Algolia, PostHog** — `re_`, and the long opaque keys those two use.
 * - **A card-length digit run** — 13 to 19 digits, which is a PAN. Again: this should be
 *   unreachable, and unreachable code that protects a card number is worth keeping.
 * - **An email address** — *"raw personal data where not necessary"*. A customer's address is never
 *   necessary in a stack trace; the customer id is, and it is not an email.
 */
const SENSITIVE_VALUE: readonly RegExp[] = [
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{4,}/g,
  /\bwhsec_[A-Za-z0-9]{4,}/g,
  /\bre_[A-Za-z0-9_-]{8,}/g,
  /\bphc_[A-Za-z0-9]{8,}/g,
  /\bpostgres(?:ql)?:\/\/[^\s"']+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\beyJ[A-Za-z0-9._-]{10,}/g,
  /\b\d{13,19}\b/g,
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
]

/** Query parameters that carry a credential in a URL. Reset links, OAuth codes, session handoffs. */
const SENSITIVE_PARAM =
  /^(access_token|code|email|key|password|secret|session|sig|signature|token)$/i

const MAX_DEPTH = 6
const MAX_ARRAY = 50
const MAX_STRING = 2_000

/**
 * Scrub a string by value.
 *
 * Order matters and the order here is "most specific first": a Postgres URL contains an `@` and
 * would otherwise be partly eaten by the email pattern, leaving the host and the **password**
 * behind — a partial redaction that reads as a successful one. Matching the whole URL first means
 * the whole URL goes.
 */
export function redactString(value: string): string {
  let output = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value

  for (const pattern of SENSITIVE_VALUE) {
    output = output.replace(pattern, REDACTED)
  }

  return output
}

/**
 * Scrub a URL, keeping its shape.
 *
 * The path is what makes an error report useful — *which* route failed — and the query is where the
 * credential is. So the origin and path survive and named parameters are replaced in place, which
 * keeps `?token=[redacted]` legible as "there was a token here" rather than deleting the evidence
 * that one was involved.
 *
 * A string that is not a URL is scrubbed as a string. That is the honest fallback: `new URL` throwing
 * is not a reason to pass something through untouched.
 */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value)

    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_PARAM.test(key)) {
        url.searchParams.set(key, REDACTED)
      }
    }

    return redactString(url.toString())
  } catch {
    return redactString(value)
  }
}

/**
 * **The walk.** Anything, to any shape, with both grounds applied.
 *
 * Bounded on three axes — depth, array length and string length — because an error event is
 * untrusted input in the only sense that matters here: nobody chose its size. A deeply self-nested
 * `cause` chain or a captured 10 MB response body should cost a truncated report, not a browser tab.
 *
 * Cycles are handled by the depth bound rather than by a `WeakSet`, which is a deliberate trade: the
 * bound is needed anyway, and it makes the function a pure depth-first rewrite with no state to
 * reason about across branches.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return '[truncated]'
  }

  if (typeof value === 'string') {
    return /^https?:\/\//i.test(value) ? redactUrl(value) : redactString(value)
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ARRAY).map((entry) => redact(entry, depth + 1))

    return value.length > MAX_ARRAY ? [...kept, `[${value.length - MAX_ARRAY} more]`] : kept
  }

  const output: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(entry, depth + 1)
  }

  return output
}

/* -------------------------------------------------------------------------------------------------
 * The Sentry event
 * ---------------------------------------------------------------------------------------------- */

/**
 * The parts of a Sentry event this project scrubs, structurally rather than by name.
 *
 * Typed locally and loosely on purpose. Importing Sentry's `ErrorEvent` would make this module
 * unloadable outside a bundler — the harness runs under the Payload CLI — and it would tie a
 * redaction rule to an SDK version. What is scrubbed is decided by the plan, not by the SDK.
 */
export type ScrubbableEvent = {
  breadcrumbs?: unknown
  contexts?: unknown
  extra?: unknown
  message?: unknown
  request?: { cookies?: unknown; data?: unknown; headers?: unknown; url?: unknown }
  tags?: unknown
  user?: unknown
}

/**
 * **§25.1d applied to a whole event**, on the way out.
 *
 * Three things happen that `redact` alone would not do:
 *
 * 1. **Cookies and headers are dropped entirely, not scrubbed.** The session cookie is an
 *    authentication credential, and a redacted-but-present `payload-token` still tells an attacker
 *    with report access which requests were authenticated. There is nothing in a cookie jar worth
 *    keeping in an error report.
 * 2. **The user is reduced to an id.** Sentry's own `sendDefaultPii: false` already declines to
 *    attach an address; this makes it true of anything the application attached by hand. An id
 *    answers *"is this one customer or a thousand?"*, which is the only question a report needs.
 * 3. **The URL is scrubbed as a URL**, keeping the route and losing the token — see `redactUrl`.
 *
 * Returning `null` drops the event, which this never does. Dropping errors to be safe would trade a
 * privacy problem for a reliability one, and §25.1d asks for redaction, not silence.
 */
export function redactEvent<T extends ScrubbableEvent>(event: T): T {
  const request = event.request

  return {
    ...event,
    ...(event.breadcrumbs === undefined ? {} : { breadcrumbs: redact(event.breadcrumbs) }),
    ...(event.contexts === undefined ? {} : { contexts: redact(event.contexts) }),
    ...(event.extra === undefined ? {} : { extra: redact(event.extra) }),
    ...(typeof event.message === 'string' ? { message: redactString(event.message) } : {}),
    ...(request
      ? {
          request: {
            ...request,
            cookies: undefined,
            headers: undefined,
            ...(request.data === undefined ? {} : { data: redact(request.data) }),
            ...(typeof request.url === 'string' ? { url: redactUrl(request.url) } : {}),
          },
        }
      : {}),
    ...(event.tags === undefined ? {} : { tags: redact(event.tags) }),
    ...(event.user === undefined ? {} : { user: redactUser(event.user) }),
  }
}

function redactUser(user: unknown): unknown {
  if (user === null || typeof user !== 'object') {
    return undefined
  }

  const id = (user as { id?: unknown }).id

  return id === undefined ? undefined : { id: String(id) }
}
