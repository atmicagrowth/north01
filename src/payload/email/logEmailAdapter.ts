import type { PayloadEmailAdapter } from 'payload'

/**
 * **The email transport until Phase 19.**
 *
 * Plan §7.1e requires forgot-password and reset-password to exist. Plan §19 owns Resend. Between
 * them sits a real question: what does a password-reset flow do in a project that has no way to send
 * mail yet?
 *
 * Payload's own answer, when no adapter is configured, is `consoleEmailAdapter` — it logs
 * *"Email attempted without being configured. To: …, Subject: …"* and drops the body. That is the
 * wrong answer here, and not for a cosmetic reason: the reset **link is the body**. With Payload's
 * default the flow would issue a valid single-use token and then destroy the only copy of it, which
 * is plan §0.1.17's fake functionality wearing a very convincing costume — a form that submits,
 * confirms, and cannot be completed by anyone.
 *
 * So this adapter logs the whole message. The flow is genuinely end-to-end in development: submit
 * the form, read the link out of the server log, set a new password. Nothing about the token,
 * expiry, single use or session handling is stubbed — only the delivery is, and delivery is the one
 * part Phase 19 owns.
 *
 * **It refuses to be quiet about production.** A deployed storefront whose password resets land in a
 * log file is a broken storefront, so every send outside local development is logged at `error`
 * with what is missing. Phase 19 replaces this adapter with Resend and the message stops appearing.
 * That is deliberately noisy rather than a silent degradation: an operator reading logs should be
 * told that a customer is waiting for a mail that is not coming.
 *
 * The `from` identity is this project's rather than Payload's `info@payloadcms.com` default, because
 * that string ends up in the log line, in Phase 19's Resend configuration, and eventually in a
 * customer's inbox — and a default nobody chose is how the wrong one ships.
 */
export const logEmailAdapter =
  ({ isLocal }: { isLocal: boolean }): PayloadEmailAdapter =>
  ({ payload }) => ({
    name: 'log',
    defaultFromAddress: 'no-reply@north01.example',
    defaultFromName: 'NORTH / 01',

    sendEmail: (message) => {
      const to = Array.isArray(message.to) ? message.to.join(', ') : String(message.to ?? '')

      if (!isLocal) {
        payload.logger.error({
          msg:
            'No email transport is configured, so this message was not delivered. ' +
            'Phase 19 installs Resend; until then only local development can complete an email flow.',
          to,
          subject: message.subject,
        })
      }

      /*
       * `info`, not `debug`: Payload's default logger level is `info`, so a `debug` line would be
       * invisible in the terminal the developer is actually looking at — which would reproduce the
       * exact failure this adapter exists to avoid.
       */
      payload.logger.info({
        msg: `Email (not sent — no transport before Phase 19): ${message.subject}`,
        to,
        body: message.html ?? message.text,
      })

      return Promise.resolve()
    },
  })
