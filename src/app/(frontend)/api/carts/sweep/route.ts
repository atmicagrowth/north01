import { sweepExpiredCarts } from '@/lib/cart/sweep'
import { getPayloadClient } from '@/lib/payload'
import { cronRefusal, isCronRequest } from '@/lib/security/cron-auth'

/**
 * **Vercel Cron's daily cart sweep** — plan §34.1c, audit R1-27. See `lib/cart/sweep.ts`.
 *
 * GET because that is what Vercel Cron sends; it answers only a request carrying `CRON_SECRET`, and
 * 401 otherwise — including when no secret is configured.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  if (!isCronRequest(request)) return cronRefusal()

  return Response.json(await sweepExpiredCarts(await getPayloadClient()))
}
