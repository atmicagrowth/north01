import { sweepRetention } from '@/lib/cart/sweep'
import { syncScheduledDrops } from '@/lib/catalog/scheduled-index'
import { getPayloadClient } from '@/lib/payload'
import { cronRefusal, isCronRequest } from '@/lib/security/cron-auth'
import { syncProductSearchIndex } from '@/payload/hooks/syncSearchIndex'

/**
 * **Vercel Cron's daily run** — the retention sweep of plan §34.1c, audit R1-27, and the owner's
 * unpaid-order decision of 2026-09-11 (see `lib/cart/sweep.ts`, which holds both rules and the
 * reasoning), and since the lost-side-effect review the scheduled-drop re-index
 * (`lib/catalog/scheduled-index.ts`).
 *
 * It deletes expired bags **and** unheld unpaid orders past their window, and then syncs to the search
 * index every product whose scheduled `publishedAt` passed since the previous run — from one request,
 * because Vercel Hobby allows two cron entries and the email drain is the other. The path stays
 * `/api/carts/sweep` because the `vercel.json` cron entry calls it (and `docs/DEPLOYMENT.md` §7 and
 * `docs/COMMERCE.md` §3 document it); a rename would change that entry and buy nothing a docblock
 * cannot say. No customer-facing text names the path.
 *
 * **The re-index runs after the sweep, and neither can stop the other.** Each of the three steps
 * catches, logs and reports its own failure and answers `failed` in the JSON; the re-index goes last
 * so that a slow index write can never hold a deletion back inside the function's duration limit. It
 * is called with the save hook's own sync, which writes only under Next — where this route runs.
 *
 * GET because that is what Vercel Cron sends; it answers only a request carrying `CRON_SECRET`, and
 * 401 otherwise — including when no secret is configured.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  if (!isCronRequest(request)) return cronRefusal()

  const payload = await getPayloadClient()
  const now = new Date()
  const retention = await sweepRetention(payload, now)
  const scheduledDrops = await syncScheduledDrops(payload, syncProductSearchIndex, now)

  return Response.json({ ...retention, scheduledDrops })
}
