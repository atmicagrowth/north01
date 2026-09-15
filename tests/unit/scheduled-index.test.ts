/**
 * **A scheduled drop reaches search when its time comes** — the lost-side-effect review.
 *
 * The module under test is `src/lib/catalog/scheduled-index.ts`, the daily cron's third step. A product
 * saved with a future `publishedAt` is left out of the index at the save, and nothing saved it again, so
 * the drop appeared in `/shop` and never in search. The step selects every published product whose time
 * passed since the previous run and syncs each through the save hook's own sync.
 *
 * `scripts/verify-search.ts` section O proves the selection against the **real database**. This file is
 * the half that needs none: the window and the predicate, the `where` Postgres is given, and the step's
 * isolation — it never throws, and a failure is reported rather than logged alone.
 */

import type { Payload } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/observability/report', () => ({ reportFailure: vi.fn() }))

import {
  isScheduledDropDue,
  SCHEDULED_DROP_BATCH,
  SCHEDULED_DROP_LOOKBACK_HOURS,
  scheduledDropWhere,
  scheduledDropWindow,
  syncScheduledDrops,
} from '@/lib/catalog/scheduled-index'
import { reportFailure } from '@/lib/observability/report'

const reported = vi.mocked(reportFailure)

const NOW = new Date('2026-09-15T03:30:00.000Z')
const HOUR = 3_600_000

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

beforeEach(() => {
  reported.mockClear()
})

describe('the window', () => {
  it('looks back more than a day — a Hobby cron fires anywhere in its hour, so runs can be ~25 hours apart', () => {
    expect(SCHEDULED_DROP_LOOKBACK_HOURS).toBeGreaterThanOrEqual(26)

    const { from, to } = scheduledDropWindow(NOW)

    expect(to).toEqual(NOW)
    expect(NOW.getTime() - from.getTime()).toBe(SCHEDULED_DROP_LOOKBACK_HOURS * HOUR)
  })
})

describe('isScheduledDropDue', () => {
  it.each([
    ['an hour ago', at(-HOUR)],
    ['exactly now — live by the shop grid’s own `less_than_equal`', at(0)],
    ['25 hours ago — the latest the previous run can have been', at(-25 * HOUR)],
  ])('selects a published product whose time passed %s', (_label, publishedAt) => {
    expect(isScheduledDropDue({ publishedAt, status: 'published' }, NOW)).toBe(true)
  })

  it.each([
    ['still in the future', at(1)],
    ['at the very start of the window — the previous run covered it', at(-26 * HOUR)],
    ['two days ago — long since indexed', at(-48 * HOUR)],
  ])('does not select one whose time is %s', (_label, publishedAt) => {
    expect(isScheduledDropDue({ publishedAt, status: 'published' }, NOW)).toBe(false)
  })

  it('does not select a draft, whatever its date', () => {
    expect(isScheduledDropDue({ publishedAt: at(-HOUR), status: 'draft' }, NOW)).toBe(false)
  })

  it.each([null, undefined, '', 'not a date'])(
    'does not select a product with no usable date (%p) — it was never scheduled',
    (publishedAt) => {
      expect(isScheduledDropDue({ publishedAt, status: 'published' }, NOW)).toBe(false)
    },
  )
})

describe('scheduledDropWhere', () => {
  it('asks Postgres for the same rule — published, after the window start, at or before now', () => {
    const { from } = scheduledDropWindow(NOW)

    expect(scheduledDropWhere(NOW)).toEqual({
      and: [
        { status: { equals: 'published' } },
        { publishedAt: { greater_than: from.toISOString() } },
        { publishedAt: { less_than_equal: NOW.toISOString() } },
      ],
    })
  })
})

describe('syncScheduledDrops', () => {
  const fakePayload = (find: () => Promise<{ docs: { id: number }[] }>) =>
    ({
      find: vi.fn(find),
      logger: { error: vi.fn(), info: vi.fn() },
    }) as unknown as Payload & { find: ReturnType<typeof vi.fn> }

  it('syncs every selected product through the given sync, and counts what was written', async () => {
    const payload = fakePayload(() => Promise.resolve({ docs: [{ id: 3 }, { id: 5 }, { id: 8 }] }))
    const sync = vi.fn((_payload: Payload, id: number) =>
      Promise.resolve(id === 5 ? ('failed' as const) : ('written' as const)),
    )

    await expect(syncScheduledDrops(payload, sync, NOW)).resolves.toEqual({
      due: 3,
      failed: false,
      indexed: 2,
      more: false,
    })
    expect(sync.mock.calls.map(([, id]) => id)).toEqual([3, 5, 8])
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'products',
        limit: SCHEDULED_DROP_BATCH,
        where: scheduledDropWhere(NOW),
      }),
    )
  })

  it('reports a full batch as `more`', async () => {
    const docs = Array.from({ length: SCHEDULED_DROP_BATCH }, (_, index) => ({ id: index + 1 }))
    const payload = fakePayload(() => Promise.resolve({ docs }))

    const outcome = await syncScheduledDrops(payload, () => Promise.resolve('written'), NOW)

    expect(outcome.more).toBe(true)
  })

  it('**never throws** — a failed selection is reported and answered `failed`, so the cron carries on', async () => {
    const payload = fakePayload(() => Promise.reject(new Error('connection reset')))
    const sync = vi.fn()

    await expect(syncScheduledDrops(payload, sync, NOW)).resolves.toEqual({
      due: 0,
      failed: true,
      indexed: 0,
      more: true,
    })
    expect(sync).not.toHaveBeenCalled()
    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'search.scheduledDrops')
  })
})
