import type { Payload, Where } from 'payload'

import { reportFailure } from '@/lib/observability/report'

/**
 * **A scheduled drop reaches search when its time comes** — the lost-side-effect review.
 *
 * A product can be `published` with a `publishedAt` in the future: that is how a drop is scheduled.
 * The shop grid honours it at query time (`publishedProductWhere` compares `publishedAt` with *now*), so
 * the product appears in `/shop` the moment its time passes. The search index cannot: a record is built
 * when the product is **saved**, and `buildProductRecord` (`record.ts`) leaves a future-dated product
 * out, correctly — so at the save the drop is excluded, and nothing ever saved it again. It stayed
 * missing from search and from the filters only Algolia answers until somebody happened to edit it or
 * ran `pnpm reindex`.
 *
 * So the daily cron (`GET /api/carts/sweep`, which Vercel calls with `CRON_SECRET`) has a third step:
 * find every published product whose `publishedAt` passed since the previous run, and sync each through
 * the indexer the save hook uses. Not a third cron — Vercel Hobby allows two, and both are taken.
 *
 * ### The window: the last 26 hours, and why syncing twice is harmless
 *
 * The cron is daily, but a Hobby cron may fire anywhere inside its scheduled hour, so two consecutive
 * runs can be up to about 25 hours apart. A window of exactly 24 hours would silently skip a drop that
 * fell in the gap; 26 hours covers the gap with an hour to spare. The cost is overlap — a product whose
 * time passed in the last hour or two before one run is selected again by the next — and that costs
 * nothing: a sync rebuilds the product's record from Postgres and upserts it by `objectID` (or deletes
 * it), so a second sync writes exactly what the first did.
 *
 * What the window cannot cover is a run that does not happen at all — an outage across a whole day, or
 * a failed invocation, which Vercel does not retry. A drop whose time passed then is not selected by
 * the next run; `pnpm reindex:check` finds it and `pnpm reindex` (or saving the product) fixes it.
 *
 * ### Isolated, and reported
 *
 * `syncScheduledDrops` never throws. A failure to select is logged, reported as `search.scheduledDrops`
 * and returned as `failed`; a failed index write is reported by the indexer itself (`search.indexWrite`)
 * and shows as `indexed` below `due`. The cron runs it after the retention sweep, so nothing here can
 * stop or delay a deletion.
 */

/** How far back a run looks for a `publishedAt` that has passed. See "The window". */
export const SCHEDULED_DROP_LOOKBACK_HOURS = 26

/**
 * The most products one run syncs. A drop is a handful of products; each sync is a few reads and one
 * index write, so this bounds the cron's duration rather than anything a real schedule reaches. A full
 * batch reports `more: true`, and the products beyond it need `pnpm reindex`.
 */
export const SCHEDULED_DROP_BATCH = 200

/** The instants a run covers: `publishedAt` after `from`, and not after `now`. */
export function scheduledDropWindow(now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - SCHEDULED_DROP_LOOKBACK_HOURS * 3_600_000), to: now }
}

/**
 * **The selection, as a predicate** — the same rule {@link scheduledDropWhere} gives Postgres.
 *
 * Published, and a `publishedAt` inside the window: strictly after its start, and at or before `now`,
 * which is the `less_than_equal` `publishedProductWhere` uses to decide the product is live. A product
 * with no date was never scheduled, and its save indexed it already.
 */
export function isScheduledDropDue(
  product: { publishedAt?: null | string; status?: null | string },
  now: Date,
): boolean {
  if (product.status !== 'published' || !product.publishedAt) {
    return false
  }

  const at = Date.parse(product.publishedAt)
  const { from, to } = scheduledDropWindow(now)

  return Number.isFinite(at) && at > from.getTime() && at <= to.getTime()
}

/** {@link isScheduledDropDue} as a Payload `where`. */
export function scheduledDropWhere(now: Date): Where {
  const { from, to } = scheduledDropWindow(now)

  return {
    and: [
      { status: { equals: 'published' } },
      { publishedAt: { greater_than: from.toISOString() } },
      { publishedAt: { less_than_equal: to.toISOString() } },
    ],
  }
}

/**
 * The ids of the products whose scheduled time passed in the window, oldest drop first. Trashed
 * products are not returned (`payload.find` excludes them), and need no record.
 */
export async function findScheduledDrops(
  payload: Payload,
  now: Date,
): Promise<{ ids: number[]; more: boolean }> {
  const { docs } = await payload.find({
    collection: 'products',
    depth: 0,
    limit: SCHEDULED_DROP_BATCH,
    overrideAccess: true,
    pagination: false,
    select: { publishedAt: true },
    sort: 'publishedAt',
    where: scheduledDropWhere(now),
  })

  return { ids: docs.map((doc) => doc.id), more: docs.length === SCHEDULED_DROP_BATCH }
}

export type ScheduledDropsOutcome = {
  /** Products selected — their `publishedAt` passed in the window. */
  due: number
  /** True when selecting them threw; nothing was synced. */
  failed: boolean
  /**
   * How many of them the index now matches. Below `due` when search is not configured in this
   * environment (nothing to write) or when a write failed — each one reported as `search.indexWrite`.
   */
  indexed: number
  /** True when the batch was full, or the step failed: products may still be missing from search. */
  more: boolean
}

/**
 * **The cron's step.** `syncProduct` is `syncProductSearchIndex` (`payload/hooks/syncSearchIndex.ts`)
 * in the route — the save hook's own sync, which writes only inside Next and never throws — and a stub
 * in a test.
 */
export async function syncScheduledDrops(
  payload: Payload,
  syncProduct: (payload: Payload, productId: number) => Promise<'failed' | 'skipped' | 'written'>,
  now: Date = new Date(),
): Promise<ScheduledDropsOutcome> {
  try {
    const { ids, more } = await findScheduledDrops(payload, now)
    let indexed = 0

    for (const productId of ids) {
      if ((await syncProduct(payload, productId)) === 'written') {
        indexed += 1
      }
    }

    payload.logger.info({ due: ids.length, indexed, more, msg: 'Scheduled drops re-indexed' })

    return { due: ids.length, failed: false, indexed, more }
  } catch (error) {
    payload.logger.error({
      err: error,
      msg: 'Re-indexing scheduled drops failed. A drop may be missing from search; run `pnpm reindex`.',
    })
    reportFailure(error, 'search.scheduledDrops')

    return { due: 0, failed: true, indexed: 0, more: true }
  }
}
