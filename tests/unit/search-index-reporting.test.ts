/**
 * **A search index write that fails is reported, not only logged** — the lost-side-effect review.
 *
 * The modules under test are the three places a product change reaches Algolia: `syncProductToIndex`
 * (`src/lib/catalog/indexer.ts`), the save hooks' own `sync` behind `syncProductSearchIndex`
 * (`src/payload/hooks/syncSearchIndex.ts`), and the rename re-index (`syncTaxonomyRename.ts`). Each
 * catches its failure so a derived store can never fail a committed edit — and each used to stop at a
 * log line (the writer's at debug), so a product missing from search, or a sold-out one still
 * filterable as in stock, was nobody's alert. None of them may start throwing either.
 *
 * Algolia and the server environment are mocked; `NEXT_RUNTIME` is set per test, because the hooks
 * refuse to write outside Next.
 */

import type { Payload, PayloadRequest } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/observability/report', () => ({ reportFailure: vi.fn() }))
vi.mock('@/lib/env.server', () => ({
  appEnv: 'local',
  integrationStatus: () => 'configured',
  serverEnv: { ALGOLIA_WRITE_API_KEY: 'write-key', NEXT_PUBLIC_ALGOLIA_APP_ID: 'app' },
}))
vi.mock('@/lib/catalog/algolia', () => ({
  catalogIndexName: () => 'north01_local_products',
  createWriteClient: vi.fn(() => ({})),
  deleteProductRecord: vi.fn(() => Promise.resolve()),
  saveProductRecord: vi.fn(() => Promise.resolve()),
  saveProductRecords: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/catalog/indexer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catalog/indexer')>()

  return { ...actual, collectProductRecords: vi.fn(actual.collectProductRecords) }
})

import { createWriteClient } from '@/lib/catalog/algolia'
import { collectProductRecords, syncProductToIndex } from '@/lib/catalog/indexer'
import { reportFailure } from '@/lib/observability/report'
import { syncProductSearchIndex } from '@/payload/hooks/syncSearchIndex'
import { syncCategoryRename } from '@/payload/hooks/syncTaxonomyRename'

const reported = vi.mocked(reportFailure)

const fakePayload = (find: () => Promise<unknown>) =>
  ({
    find: vi.fn(find),
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  }) as unknown as Payload & { logger: { warn: ReturnType<typeof vi.fn> } }

const emptyFind = () => Promise.resolve({ docs: [], hasNextPage: false })

const credentials = () => ({
  deleteRecord: vi.fn(() => Promise.resolve()),
  saveRecord: vi.fn(() => Promise.resolve()),
})

beforeEach(() => {
  reported.mockClear()
  process.env.NEXT_RUNTIME = 'nodejs'
})

afterEach(() => {
  delete process.env.NEXT_RUNTIME
})

describe('syncProductToIndex', () => {
  it('**reports a failed index write as `search.indexWrite`**, answers false, and does not throw', async () => {
    const payload = fakePayload(() => Promise.reject(new Error('Algolia timed out')))

    await expect(syncProductToIndex(payload, credentials(), 9)).resolves.toBe(false)
    expect(payload.logger.warn).toHaveBeenCalledTimes(1)
    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'search.indexWrite', { productId: 9 })
  })

  it('answers true, and reports nothing, when the index was brought into line', async () => {
    const payload = fakePayload(emptyFind)
    const writer = credentials()

    await expect(syncProductToIndex(payload, writer, 9)).resolves.toBe(true)
    expect(writer.deleteRecord).toHaveBeenCalledWith(9)
    expect(reported).not.toHaveBeenCalled()
  })
})

describe('syncProductSearchIndex — the save hooks’ sync, as the cron calls it', () => {
  it('writes under Next', async () => {
    await expect(syncProductSearchIndex(fakePayload(emptyFind), 9)).resolves.toBe('written')
  })

  it('**reports a writer that cannot be built as `search.indexWriter`** — under Next that is a real fault', async () => {
    vi.mocked(createWriteClient).mockImplementationOnce(() => {
      throw new Error('Invalid credentials')
    })

    const payload = fakePayload(emptyFind)

    await expect(syncProductSearchIndex(payload, 9)).resolves.toBe('failed')
    expect(payload.logger.warn).toHaveBeenCalledTimes(1)
    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'search.indexWriter', { productId: 9 })
  })

  it('answers failed when the write itself failed', async () => {
    await expect(
      syncProductSearchIndex(
        fakePayload(() => Promise.reject(new Error('down'))),
        9,
      ),
    ).resolves.toBe('failed')
    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'search.indexWrite', { productId: 9 })
  })

  it('skips outside Next, reporting nothing — a CLI write never reaches the index', async () => {
    delete process.env.NEXT_RUNTIME

    const payload = fakePayload(emptyFind)

    await expect(syncProductSearchIndex(payload, 9)).resolves.toBe('skipped')
    expect(payload.find).not.toHaveBeenCalled()
    expect(reported).not.toHaveBeenCalled()
  })
})

describe('syncCategoryRename', () => {
  it('**reports a rename that never reached the index as `search.taxonomyReindex`**, and still returns the doc', async () => {
    vi.mocked(collectProductRecords).mockRejectedValueOnce(new Error('Algolia timed out'))

    const payload = fakePayload(emptyFind)
    const doc = { id: 4, name: 'Outerwear', slug: 'outerwear' }

    await expect(
      syncCategoryRename({
        collection: {} as never,
        context: {},
        data: doc,
        doc,
        operation: 'update',
        previousDoc: { ...doc, name: 'Outer layers' },
        req: { payload } as unknown as PayloadRequest,
      }),
    ).resolves.toBe(doc)
    expect(payload.logger.warn).toHaveBeenCalledTimes(1)
    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'search.taxonomyReindex')
  })
})
