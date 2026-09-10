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
 * Key **segments** whose value is sensitive regardless of what it looks like.
 *
 * ### This was a raw substring match, and it was wrong in both directions
 *
 * The first version tested the whole key against `/auth|card|…|pin|…/i`. Measured, on this
 * project's own field names:
 *
 * | key | matched | why |
 * |---|---|---|
 * | `shipping` | **yes** | `shi-PP-IN-g` contains `pin` |
 * | `author` | **yes** | a journal byline contains `auth` |
 * | `company` | **yes** | contains `pan` |
 *
 * Every one of those is a field an operator needs in order to read a report, and losing them makes
 * the report worse without protecting anything. The docblock claimed the trade was "nearly free";
 * it was not, and the substring was doing the damage rather than the breadth.
 *
 * So the key is split into its **segments** — camelCase boundaries, then any non-alphanumeric — and
 * each segment is matched **whole**, or against a short list of prefixes where a prefix is genuinely
 * what identifies the family (`passw` covers `password` and `passwd`; `api_key` becomes the segments
 * `api` and `key`, so `key` is listed outright).
 *
 * That keeps `stripeSecretKey`, `STRIPE_SECRET_KEY`, `payment_method` and `sessionToken` all
 * matching, and stops `shippingMinor` from being one.
 *
 * `card`, `cvc`, `cvv`, `pan` and `iban` are here even though this application **never sees a card
 * number** — Stripe Checkout is hosted, and §17 keeps it that way. A key named `cardNumber` reaching
 * this function means something has gone wrong that is worth not making worse.
 */
const SENSITIVE_SEGMENTS: ReadonlySet<string> = new Set([
  'auth',
  'authorization',
  'card',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'cvc',
  'cvv',
  'dsn',
  'iban',
  'jwt',
  'key',
  'pan',
  'password',
  'passwd',
  'pin',
  'secret',
  'session',
  'signature',
  'ssn',
  'token',
])

/** Two-segment families that only mean something together. Compared against the joined key. */
const SENSITIVE_PHRASES: readonly string[] = ['connectionstring', 'databaseurl', 'paymentmethod']

/** Split `STRIPE_SECRET_KEY` and `stripeSecretKey` alike into `['stripe', 'secret', 'key']`. */
function segmentsOf(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 0)
}

export function isSensitiveKey(key: string): boolean {
  const segments = segmentsOf(key)

  if (segments.some((segment) => SENSITIVE_SEGMENTS.has(segment))) {
    return true
  }

  /* `passw` is a prefix rather than a segment: `password`, `passwd`, `passwordHash`. */
  if (segments.some((segment) => segment.startsWith('passw'))) {
    return true
  }

  const joined = segments.join('')

  return SENSITIVE_PHRASES.some((phrase) => joined.includes(phrase))
}

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
  let output = value

  for (const pattern of SENSITIVE_VALUE) {
    output = output.replace(pattern, REDACTED)
  }

  /*
   * **Truncated after replacing, not before.** The first version cut at 2 000 characters first,
   * which meant a secret straddling that boundary was left as a fragment too short to match — a
   * partial credential kept, by the very step meant to bound the payload.
   */
  return output.length > MAX_STRING ? `${output.slice(0, MAX_STRING)}…` : output
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
    output[key] = isSensitiveKey(key) ? REDACTED : redact(entry, depth + 1)
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
  /**
   * **Where a thrown error's text actually is**, and the field the first version missed.
   *
   * `event.message` is set for `captureMessage` and for a few synthetic events. Everything thrown —
   * every `new Error(...)`, every rejection, every Stripe or Postgres failure — arrives as
   * `exception.values[].value` instead. Scrubbing `message` alone therefore covered the rarer half:
   * `Error: Invalid API Key provided: sk_live_…` went out untouched, which is the single most
   * likely way a real credential reaches an error report.
   *
   * It is walked with `redact` rather than picked apart, because the frames beneath it can carry
   * local variables too, and the shape is the SDK's rather than ours.
   */
  exception?: unknown
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
    ...(event.exception === undefined ? {} : { exception: redact(event.exception) }),
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
