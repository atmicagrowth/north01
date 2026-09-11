import { Resend } from 'resend'

import type { Courier } from './send'
import type { DeliveryEnv, Transport } from './rules'

import { parseAllowlist } from './rules'

/**
 * **The only file in this project that constructs a Resend client** — the same shape
 * `lib/catalog/algolia.ts` uses, and for the same reason.
 *
 * ### There is no `server-only` import here, and no environment import either
 *
 * That is deliberate and it is the fourth time this project has had to learn it. The Payload CLI
 * loads `payload.config.ts` through tsx, **outside Next**, where the bare specifier `server-only`
 * does not resolve at all (`ERR_MODULE_NOT_FOUND`). The config transitively imports this module,
 * because Phase 19 routes Payload's own password-reset mail through the one service — so a guard here
 * would break `generate:types`, every migration, the seed and every `verify:*` harness at once.
 * Measured, on the first attempt at exactly that.
 *
 * The credentials are therefore **arguments**. Application code gets them from `env.server` via
 * `courier.ts`, which does carry the guard; `payload.config.ts` and `scripts/*` get them from
 * `env.core`, which they are exempt to import. The key never sits in module scope here, so there is
 * nothing for a client bundle to pick up even in principle.
 *
 * §19.1a — *"do not call Resend directly from random components"* — is satisfied structurally rather
 * than by convention: `resend` appears in exactly one import in this repository, and everything above
 * it deals in the `Transport` function type from `./rules`. That is also what lets `pnpm verify:email`
 * drive the entire service with a fake that opens no socket.
 */

/**
 * The provider, as a plain function.
 *
 * **It resolves on failure rather than rejecting**, which is the contract `Transport` states and the
 * mechanism behind §19.1d's *"a failed email should not roll back a successful payment/order"*.
 * Resend's SDK already reports provider errors in-band as `{ data, error }`, so the shape matches;
 * the `catch` is for the layer beneath it — DNS, TLS, a socket closing mid-request — which throws.
 */
/**
 * **How long one send may take** — Phase 36, audit R1-21.
 *
 * Resend's SDK sets no timeout of its own, so a provider that accepted the connection and never
 * answered held the caller for as long as the platform allowed — and the callers include the Stripe
 * webhook, whose slow answer Stripe treats as a failure and retries. Eight seconds is several times
 * a healthy send. The timeout is a failure like any other: the row stays retryable, and the
 * idempotency key below makes a retry of a send that did land after all a no-op at Resend.
 */
const SEND_TIMEOUT_MS = 8_000

export function createEmailTransport({ apiKey }: { apiKey: string }): Transport {
  const client = new Resend(apiKey)

  return async (message) => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const timedOut = new Promise<{ error: string; ok: false }>((resolve) => {
      timer = setTimeout(() => resolve({ error: 'timeout', ok: false }), SEND_TIMEOUT_MS)
    })

    try {
      return await Promise.race([send(message), timedOut])
    } finally {
      clearTimeout(timer)
    }
  }

  async function send(message: Parameters<Transport>[0]): ReturnType<Transport> {
    try {
      const { data, error } = await client.emails.send(
        {
          from: message.from,
          html: message.html,
          replyTo: message.replyTo ?? undefined,
          subject: message.subject,
          text: message.text,
          to: message.to,
        },
        /*
         * Resend's second argument becomes the `Idempotency-Key` header. Without it, the deliberate
         * decision that a stuck `pending` row is retried rather than locked would turn every crash
         * in the send-then-record window into a duplicate in a customer's inbox. Sweep 1 found the
         * claim that "the provider's own idempotency makes that safe" written down and not done.
         */
        { idempotencyKey: message.idempotencyKey },
      )

      if (error) {
        return { error: `${error.name}: ${error.message}`, ok: false }
      }

      return { id: data?.id ?? null, ok: true }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'The mail provider could not be reached.',
        ok: false,
      }
    }
  }
}

/**
 * Assemble a `Courier` from values somebody else read.
 *
 * Every caller supplies its own environment: `courier.ts` from the guarded tier, `payload.config.ts`
 * and the scripts from the core tier. Keeping the assembly here means all three build the *same*
 * courier — same allowlist parsing, same safeguard — rather than three subtly different ones.
 */
export function buildCourier(input: {
  allowlist: null | string | undefined
  apiKey: string
  appEnv: DeliveryEnv
  from: string
  replyTo?: null | string
}): Courier {
  return {
    allowlist: parseAllowlist(input.allowlist),
    appEnv: input.appEnv,
    from: input.from,
    replyTo: input.replyTo ?? null,
    transport: createEmailTransport({ apiKey: input.apiKey }),
  }
}
