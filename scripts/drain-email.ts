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
import {
  appEnv,
  developmentDatabase,
  integrationStatus,
  requireIntegration,
  serverEnv,
} from '../src/lib/env.core'

/**
 * **The one refusal this script does need**, found by Phase 19's first sweep.
 *
 * Three separately reasonable decisions combined into a destructive one. This script deliberately has
 * no D-10 guard, because draining a production queue is a legitimate thing to do. `appEnv` cannot see
 * a connection string and reads `local` on a laptop (env.core.ts says so in as many words). And
 * suppression is **terminal** — a suppressed row is excluded from every future drain and nothing in
 * the application can reset it.
 *
 * So an operator investigating a missing confirmation, who exports the production `DATABASE_URL` and
 * runs this, would claim up to fifty real pending messages — confirmations for customers who have
 * been charged, dispatch notices for parcels in transit — and mark every one of them `suppressed`
 * forever. It would print "50 suppressed", which reads exactly like the safeguard working.
 *
 * The safeguard was right; consuming somebody else's queue to apply it was not. A laptop pointed at
 * production is refused outright, and the message says which of the two things to change.
 */
if (!developmentDatabase.ok && appEnv !== 'production') {
  throw new Error(
    'drain-email refuses to run: DATABASE_URL does not name the development database ' +
      `(${developmentDatabase.reason}), and this process is not production (appEnv=${appEnv}).\n` +
      'Delivering from here would suppress every queued message permanently, because suppression is ' +
      'terminal and nothing can reset it. Point DATABASE_URL at development, or run the drain from ' +
      'the deployed environment — POST /api/email/drain, signed in as staff.',
  )
}

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
