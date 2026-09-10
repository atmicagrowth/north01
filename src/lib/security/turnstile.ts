/**
 * **Plan §26.1a — Cloudflare Turnstile, verified on the server.**
 *
 * > *"Server must verify Turnstile response. Client-side widget alone is not security."*
 *
 * That sentence is the whole design. A widget renders a token; a token means nothing until Cloudflare
 * is asked about it, and the asking happens here, in a Server Action, with a secret the browser never
 * sees. A form that renders the widget and does not verify is **decoration** — worse than nothing,
 * because it looks like a control.
 *
 * ### Which forms, and why those
 *
 * §26.1a names four: newsletter, contact, review submission, and *"registration/login where abuse
 * warrants it"*. Three of the four exist in this application, and each is a real abuse surface
 * rather than a form that happens to be public:
 *
 * - **Newsletter** — the classic list-poisoning target. It writes a row per address with no
 *   authentication at all.
 * - **Review submission** — §21.1c's abuse cases, and the one form whose output is **published**.
 * - **Registration** — account-farming, and the door to everything behind it.
 * - **Login** — credential stuffing. Included, because *"where abuse warrants it"* is answered by
 *   what the form is rather than by whether abuse has been observed yet, and a login form is the
 *   single most attacked endpoint any shop has.
 *
 * **Contact does not exist.** Gap **G-08** has recorded that since Phase 19, which is also still
 * waiting on it for its contact-confirmation template. The moment it is built it gets this.
 *
 * ### Unconfigured means the widget is not rendered and nothing is verified
 *
 * The alternative — failing closed with no keys — would make an unconfigured deployment a shop
 * nobody can register with or subscribe to, which is not more secure, it is broken. This project has
 * settled that trade three times already (**DEV-62**: the checkout page says payment is unavailable
 * rather than showing a form that can only fail), and the rule is the same here: **the decision is
 * made server-side, from the server environment**, and never from whether a token happened to arrive
 * in the request body.
 *
 * That distinction is the security-relevant one. `verifyTurnstile` is not handed a "skip if absent"
 * flag by the caller; it reads the configured state itself, so a client cannot reach the skip path by
 * omitting a field.
 *
 * `TODO.md` carries the keys as an owner action, and every form that would have been protected says
 * so in the notes rather than implying protection it does not have.
 */

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** The field name the widget writes and the action reads. Cloudflare's own, not ours. */
export const TURNSTILE_FIELD = 'cf-turnstile-response'

export type TurnstileOutcome =
  /** Verified, or not required because the integration is unconfigured. */
  | { ok: true; skipped: boolean }
  /** Refused. `reason` is for the log; the customer gets one sentence. */
  | { ok: false; reason: string }

/**
 * The sentence a customer sees when verification fails.
 *
 * Deliberately identical for every failure — an expired token, a duplicated token, a missing one, a
 * network error reaching Cloudflare. Telling somebody *which* check they failed is telling an
 * attacker which knob to turn, and none of the distinctions is actionable by an honest customer,
 * whose fix is the same in every case: try again.
 */
export const TURNSTILE_FAILURE_MESSAGE = 'We could not verify that request. Please try again.'

export type TurnstileVerifier = (input: {
  remoteIp: null | string
  secretKey: string
  token: string
}) => Promise<{ errorCodes: string[]; success: boolean }>

/**
 * The live verifier — one POST to Cloudflare.
 *
 * `idempotency_key` is deliberately **not** sent. Cloudflare treats a token as single-use, and
 * re-verifying the same token must fail: that is the replay protection, and an idempotency key would
 * turn a replayed token into a second success.
 *
 * A network failure resolves to `success: false` rather than throwing, so the caller has one shape to
 * handle. Which way that falls is decided by `verifyTurnstile`, not here — see its docblock.
 */
export const cloudflareVerifier: TurnstileVerifier = async ({ remoteIp, secretKey, token }) => {
  const body = new URLSearchParams({ response: token, secret: secretKey })

  if (remoteIp) {
    body.set('remoteip', remoteIp)
  }

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      body,
      cache: 'no-store',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      /*
       * Bounded, because a Server Action awaiting this is a customer waiting on a form. Cloudflare
       * answers in tens of milliseconds; ten seconds is generous and still finite.
       */
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      return { errorCodes: [`http-${response.status}`], success: false }
    }

    const payload = (await response.json()) as {
      'error-codes'?: unknown
      success?: unknown
    }

    return {
      errorCodes: Array.isArray(payload['error-codes'])
        ? payload['error-codes'].map((code) => String(code))
        : [],
      success: payload.success === true,
    }
  } catch (error) {
    return { errorCodes: [error instanceof Error ? error.name : 'unknown'], success: false }
  }
}

/**
 * **The decision.** Pure with respect to its inputs, so `pnpm verify:security` can drive every branch
 * without a network or an environment.
 *
 * ### Unconfigured skips; configured is mandatory
 *
 * `secretKey` and `siteKey` are both read from the environment by the caller and passed in. When
 * either is missing the integration is not configured, the widget was never rendered, and there is no
 * token to verify — so this returns `ok` with `skipped: true`. When both are present the form
 * rendered a widget, a token is required, and its absence is a refusal.
 *
 * **`partial` is treated as unconfigured**, matching `integrationStatus`: a site key with no secret
 * renders a widget nothing can verify, which is the decoration §26.1a warns about.
 *
 * ### A failure to reach Cloudflare is a refusal, not a pass
 *
 * This is the one place in the project where an outage fails **closed**, and it is deliberate. The
 * rest of the shop degrades — a search index that is down still shows a catalogue — because the cost
 * of degrading is a worse page. Here the cost of degrading is *no bot protection at all* on exactly
 * the forms an attacker is hammering, and an attacker can cause the outage they benefit from.
 *
 * The consequence is stated rather than hidden: if Cloudflare is unreachable, these four forms stop
 * accepting submissions. That is the correct trade for a control whose whole purpose is to refuse.
 */
export async function verifyTurnstile(input: {
  remoteIp?: null | string
  secretKey: null | string | undefined
  siteKey: null | string | undefined
  token: unknown
  verifier?: TurnstileVerifier
}): Promise<TurnstileOutcome> {
  const secretKey = typeof input.secretKey === 'string' ? input.secretKey.trim() : ''
  const siteKey = typeof input.siteKey === 'string' ? input.siteKey.trim() : ''

  if (secretKey.length === 0 || siteKey.length === 0) {
    return { ok: true, skipped: true }
  }

  const token = typeof input.token === 'string' ? input.token.trim() : ''

  if (token.length === 0) {
    return { ok: false, reason: 'missing-token' }
  }

  /*
   * Cloudflare's documented ceiling is 2 048 characters. Refusing a longer one here means an
   * oversized body is never forwarded — a small thing, and the kind of small thing that stops a
   * public form being a free proxy to somebody else's API.
   */
  if (token.length > 2_048) {
    return { ok: false, reason: 'oversized-token' }
  }

  const verifier = input.verifier ?? cloudflareVerifier

  const result = await verifier({ remoteIp: input.remoteIp ?? null, secretKey, token })

  return result.success
    ? { ok: true, skipped: false }
    : { ok: false, reason: result.errorCodes.join(',') || 'rejected' }
}
