/**
 * **Deliver every message the shop owes** — plan §19.1d's *"allow retry where appropriate"*.
 *
 * ```
 * pnpm email:drain
 * pnpm email:drain -- --limit 100
 * ```
 *
 * ### Why a drain exists at all
 *
 * Most messages are delivered the instant they are queued, by the request that queued them. Two
 * cannot be:
 *
 * 1. **The shipped and delivered notices.** They originate in the admin panel, and Payload 3 runs
 *    `afterChange` *inside* the open transaction — there is no post-commit collection hook. So they
 *    are queued transactionally and delivered afterwards, by something else. This is that something,
 *    together with the bounded opportunistic drain the Stripe webhook performs.
 * 2. **Anything that failed.** A provider outage, an unverified sending domain, a transient network
 *    error. §19.1d asks for retry rather than loss, and `MAX_DELIVERY_ATTEMPTS` bounds it.
 *
 * ### It is safe to run at any time, and twice
 *
 * Each message is *claimed* with a conditional `UPDATE` before it is sent, so two drains running
 * together cannot both deliver the same row — the loser sees zero rows affected and moves on. A
 * message already `sent` or `suppressed` is never picked up again.
 *
 * ### It obeys the same dev safeguard as everything else
 *
 * Outside production nothing is delivered except to `EMAIL_DEV_ALLOWLIST`, and an empty allowlist
 * suppresses everything. Running this on a laptop pointed at a copy of the production database
 * therefore cannot mail real customers — which is the hazard the phase prompt names.
 *
 * **No D-10 guard.** It writes only to `email_messages`, and unlike the `verify:*` harnesses it
 * creates no fixtures and deletes nothing — draining the queue is a legitimate thing to do to a
 * deployed database, and refusing would make the one path that clears a production backlog unusable.
 */

import type { Payload } from 'payload'

import config from '../src/payload.config'

import { buildCourier } from '../src/lib/email/resend'
import { drainEmails } from '../src/lib/email/send'
import { appEnv, integrationStatus, requireIntegration, serverEnv } from '../src/lib/env.core'

const { getPayload } = await import('payload')

const limitIndex = process.argv.indexOf('--limit')
const limitArg = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : Number.NaN
const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.floor(limitArg) : 50

const payload: Payload = await getPayload({ config })

try {
  if (integrationStatus('resend') !== 'configured') {
    /*
     * Not an error, and not silent either. The queue is still accumulating correctly; there is simply
     * nothing to deliver with. An operator running this to clear a backlog needs to be told which of
     * the two variables is missing rather than left reading a zero.
     */
    process.stdout.write(
      'Resend is not configured, so nothing was delivered. Set RESEND_API_KEY and EMAIL_FROM — ' +
        'see docs/ENVIRONMENT.md. The queued messages are unharmed and will send once it is.\n',
    )
  } else {
    const { EMAIL_FROM, RESEND_API_KEY } = requireIntegration('resend')

    const tally = await drainEmails(
      payload,
      buildCourier({
        allowlist: serverEnv.EMAIL_DEV_ALLOWLIST,
        apiKey: RESEND_API_KEY,
        appEnv,
        from: EMAIL_FROM,
      }),
      { limit },
    )

    process.stdout.write(
      `${tally.attempted} attempted — ${tally.sent} sent, ${tally.suppressed} suppressed, ` +
        `${tally.failed} failed.\n`,
    )
  }
} finally {
  await payload.destroy()
}
