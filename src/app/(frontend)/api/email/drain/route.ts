import { headers as nextHeaders } from 'next/headers'

import { courierFor } from '@/lib/email/courier'
import { drainEmails } from '@/lib/email/send'
import { getPayloadClient } from '@/lib/payload'

/**
 * **§19.1d's *"allow retry where appropriate"*, as something a person can press.**
 *
 * `pnpm email:drain` is the operator's path and covers a machine somebody can log into. This is the
 * one that works from a deployed environment, where there is no shell — a staff member looking at a
 * `failed` row in the admin panel needs a way to say "try again" that does not involve a terminal.
 *
 * ### Staff authentication, and no shared secret
 *
 * It authenticates with Payload's own session rather than a bearer token, which is a deliberate
 * choice over the more usual `CRON_SECRET` shape. A new secret is a new thing to leak, to rotate and
 * to document, and this endpoint needs exactly the audience that already exists: the people who can
 * see `email-messages` in the first place. `isStaff` and this route now agree by construction.
 *
 * The consequence worth naming is that **nothing drains on a schedule**. A shipped notice queued in
 * the admin panel is delivered by the next Stripe webhook's bounded opportunistic drain, by an
 * operator running the script, or by a staff member calling this. On a busy shop the first covers it;
 * on a quiet one a message can wait. Wiring a scheduled call is deployment work rather than
 * application work — it belongs with the rest of the cron surface, and is recorded as owed rather
 * than pretended at here.
 *
 * ### It cannot be used to send anything new
 *
 * The drain delivers rows that already exist. There is no body, no recipient parameter and no
 * template selection — the worst a caller can do is cause the shop to send mail it had already
 * decided to send, sooner. That is why a `POST` with no payload is the whole interface.
 */
export const dynamic = 'force-dynamic'

export async function POST(): Promise<Response> {
  const payload = await getPayloadClient()

  const { user } = await payload.auth({ headers: await nextHeaders() })

  /*
   * `users` is the staff collection; `customers` is the shopper one. Checking the collection as well
   * as the role matters — a customer is a real authenticated user and must not reach this.
   */
  const isStaff = user?.collection === 'users' && (user.role === 'admin' || user.role === 'editor')

  if (!isStaff) {
    return Response.json({ error: 'Staff only.' }, { status: 403 })
  }

  const courier = await courierFor(payload)

  if (!courier) {
    return Response.json(
      {
        error:
          'Resend is not configured, so nothing could be delivered. The queued messages are unharmed.',
      },
      { status: 503 },
    )
  }

  const tally = await drainEmails(payload, courier, { limit: 50 })

  return Response.json(tally)
}
