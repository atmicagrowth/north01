import 'server-only'

import { timingSafeEqual } from 'node:crypto'

import { serverEnv } from '@/lib/env.server'

/**
 * **Is this request Vercel Cron?** — shared by every scheduled route (plan §32, §34).
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` when the variable is set on the project. The
 * comparison is constant-time, and an unset secret means *nobody* is authorised — never "open".
 * Moved here from the email drain when the cart sweep became the second route to need it, so the two
 * cannot disagree about what counts.
 */
export function isCronRequest(request: Request): boolean {
  const secret = serverEnv.CRON_SECRET

  if (secret === undefined) return false

  const sent = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)

  return sent.length === expected.length && timingSafeEqual(sent, expected)
}

export function cronRefusal(): Response {
  return Response.json({ error: 'Unauthorized.' }, { status: 401 })
}
