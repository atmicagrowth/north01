import { sweepRetention } from '@/lib/cart/sweep'
import { getPayloadClient } from '@/lib/payload'
import { cronRefusal, isCronRequest } from '@/lib/security/cron-auth'

/**
 * **Vercel Cron's daily retention sweep** — plan §34.1c, audit R1-27, and the owner's unpaid-order
 * decision of 2026-09-11. See `lib/cart/sweep.ts`, which holds both rules and the reasoning.
 *
 * It deletes expired bags **and** unheld unpaid orders past their window, from one request, because
 * Vercel Hobby allows two cron entries and the email drain is the other. The path stays
 * `/api/carts/sweep` because the `vercel.json` cron entry calls it (and `docs/DEPLOYMENT.md` §7 and
 * `docs/COMMERCE.md` §3 document it); a rename would change that entry and buy nothing a docblock
 * cannot say. No customer-facing text names the path.
 *
 * GET because that is what Vercel Cron sends; it answers only a request carrying `CRON_SECRET`, and
 * 401 otherwise — including when no secret is configured.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  if (!isCronRequest(request)) return cronRefusal()

  return Response.json(await sweepRetention(await getPayloadClient()))
}
