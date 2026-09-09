import type { PayloadEmailAdapter } from 'payload'

import type { Courier } from '@/lib/email/send'

import { dedupeKeyFor } from '@/lib/email/rules'
import { sendEmail } from '@/lib/email/send'

/**
 * **The transport Phase 19 replaces `logEmailAdapter` with.**
 *
 * Payload sends exactly one message of its own — the password reset — and it sends it by calling
 * `payload.sendEmail`, which goes to whatever adapter the config names. §19.1a says *"do not call
 * Resend directly from random components"*, and an adapter that constructed its own Resend client
 * would be precisely that: a second sending path, with its own from-address, its own idea of the dev
 * safeguard, and no row in `email-messages`.
 *
 * So this adapter sends **nothing itself**. It converts Payload's message into the service's own
 * vocabulary and hands it to `sendEmail`, which is the same path the order confirmations take. One
 * queue, one safeguard, one record.
 *
 * ---
 *
 * ### It keeps the old adapter's best property
 *
 * `logEmailAdapter` refused to be quiet: it logged at `error` on every send outside local development
 * so that an operator reading logs would know a customer was waiting for mail that was not coming.
 * That property is kept exactly, for the case that still exists — Resend unconfigured — and the
 * message is logged in full in local development so the reset flow remains completable end to end
 * with no key, which is what Phase 7 built it for.
 *
 * ### The reset link is never stored
 *
 * `retainData: false`. The body Payload hands over contains a **working single-use token**, and
 * writing it into `email_messages.data` would leave a live password-reset link at rest in a table
 * staff can read — a worse outcome than the duplicate-send this queue exists to prevent. The
 * consequence is that a reset message cannot be re-rendered and so is not retryable, which is the
 * right behaviour: a customer who did not receive one asks again, and asking again issues a fresh
 * token and invalidates this one.
 *
 * Because the body is already rendered by `Customers.auth.forgotPassword.generateEmailHTML`, this is
 * also the one path where the service is handed HTML rather than template data. `sendEmail` accepts
 * that through `prerendered`, and the row still records who it was for and what happened to it.
 *
 * ### The courier arrives as an argument
 *
 * This module cannot read the environment for itself. `payload.config.ts` loads under tsx, outside
 * Next, so nothing it imports may reach `server-only` — and `env.core` is ESLint-fenced to four paths,
 * of which the config is one and this is not. So the config, which may read both, builds the courier
 * and passes it down. That is the same shape `logEmailAdapter({ isLocal })` already used for the one
 * environment fact it needed.
 */
export const serviceEmailAdapter =
  ({
    courier: resolveCourier,
    isLocal,
  }: {
    courier: () => Courier | null
    isLocal: boolean
  }): PayloadEmailAdapter =>
  ({ payload }) => ({
    defaultFromAddress: 'no-reply@north01.example',
    defaultFromName: 'NORTH / 01',
    name: 'north01-service',

    sendEmail: async (message) => {
      const to = Array.isArray(message.to) ? String(message.to[0] ?? '') : String(message.to ?? '')
      const subject = String(message.subject ?? '')
      const html = typeof message.html === 'string' ? message.html : ''
      const text = typeof message.text === 'string' ? message.text : ''

      const courier = resolveCourier()

      if (!courier) {
        /*
         * Unchanged from `logEmailAdapter`, deliberately. An unconfigured mail provider must be loud
         * in a deployed environment and completable in a local one.
         */
        if (!isLocal) {
          payload.logger.error({
            msg:
              'Resend is not configured, so this message was not delivered. Set RESEND_API_KEY and ' +
              'EMAIL_FROM — see docs/ENVIRONMENT.md.',
            subject,
            to,
          })
        }

        payload.logger.info({ body: html || text, msg: `Email (not sent): ${subject}`, to })

        return
      }

      const outcome = await sendEmail(
        payload,
        {
          data: { resetHref: '' },
          dedupeKey: dedupeKeyFor('passwordReset', {
            id: to,
            issuedAt: new Date().toISOString(),
          }),
          kind: 'passwordReset',
          prerendered: { html, subject, text },
          retainData: false,
          to,
        },
        courier,
      )

      if ('outcome' in outcome && (outcome.outcome === 'failed' || outcome.outcome === 'error')) {
        /*
         * Logged, never thrown. Payload calls this from inside `forgotPassword`, and a throw here
         * would turn "we could not send the mail" into "the reset request failed" — which is §19.1d's
         * rule applied to the one flow where the customer is watching.
         */
        payload.logger.error({
          msg: 'A password reset email could not be delivered.',
          reason: 'reason' in outcome ? outcome.reason : 'unknown',
          to,
        })
      }
    },
  })
