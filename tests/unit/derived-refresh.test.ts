import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * **The derived-stock refresh writes four columns and then does what the product's hooks did** — the
 * concurrency review of 2026-09-15.
 *
 * `pnpm verify:concurrency` section D holds the race against Postgres. Two things it cannot see run
 * here: the statement's shape (that nothing but `derived` and `updated_at` is in it), and the search
 * index half, which skips outside Next (`NEXT_RUNTIME`) and so never runs under a harness. The index
 * client, the environment and Next's cache are stubbed; the real `syncSearchIndex` and
 * `revalidateTags` hooks run.
 */

type Query = { strings: string[]; values: unknown[] }

vi.mock('@payloadcms/db-postgres', () => {
  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]): Query => ({
      strings: [...strings],
      values,
    }),
    {
      identifier: (name: string) => name,
      join: (parts: unknown[]) => parts,
      raw: (text: string) => text,
    },
  )

  return { sql }
})

vi.mock('payload', () => ({
  combineQueries: vi.fn(),
  createLocalReq: vi.fn(async ({ req }: { req?: Record<string, unknown> }, payload: unknown) =>
    Object.assign(req ?? { context: {} }, { payload }),
  ),
  executeAccess: vi.fn(),
  validateQueryPaths: vi.fn(),
}))

vi.mock('@/lib/env.server', () => ({
  appEnv: 'local',
  integrationStatus: () => 'configured',
  serverEnv: { ALGOLIA_WRITE_API_KEY: 'key', NEXT_PUBLIC_ALGOLIA_APP_ID: 'app' },
}))

vi.mock('@/lib/catalog/algolia', () => ({
  catalogIndexName: () => 'north01_local',
  createWriteClient: () => ({}),
  deleteProductRecord: vi.fn(),
  saveProductRecord: vi.fn(),
}))

vi.mock('@/lib/catalog/indexer', () => ({ syncProductToIndex: vi.fn(async () => true) }))

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

const { syncProductToIndex } = await import('@/lib/catalog/indexer')
const { revalidateTag } = await import('next/cache')
const { recalculateProductDerived } = await import('@/payload/hooks/syncProductDerived')

const indexed = vi.mocked(syncProductToIndex)
const revalidated = vi.mocked(revalidateTag)

function fakePayload(rowCount = 1) {
  const pool = vi.fn(async (_query: Query) => ({ rowCount }))
  const session = vi.fn(async (_query: Query) => ({ rowCount }))

  const payload = {
    collections: { products: { config: { slug: 'products' } } },
    db: { drizzle: { execute: pool }, sessions: { 'tx-1': { db: { execute: session } } } },
    find: vi.fn(async () => ({
      docs: [
        { compareAtPriceMinor: 6_000, inventoryQuantity: 2, priceMinor: 5_000 },
        { compareAtPriceMinor: null, inventoryQuantity: 3, priceMinor: 7_000 },
      ],
    })),
    logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
  }

  return { payload, pool, session }
}

const statementOf = (query: Query) => query.strings.join('?').replace(/\s+/g, ' ').trim()

const previousRuntime = process.env.NEXT_RUNTIME

beforeEach(() => {
  indexed.mockClear()
  revalidated.mockClear()
  process.env.NEXT_RUNTIME = 'nodejs'
})

afterEach(() => {
  if (previousRuntime === undefined) {
    delete process.env.NEXT_RUNTIME
  } else {
    process.env.NEXT_RUNTIME = previousRuntime
  }
})

describe('recalculateProductDerived — the write', () => {
  it('updates the four derived columns and updated_at of one product, and nothing else', async () => {
    const { payload, pool } = fakePayload()

    await recalculateProductDerived({ payload: payload as never, productId: 42 })

    expect(pool).toHaveBeenCalledTimes(1)

    const query = pool.mock.calls[0][0]

    expect(statementOf(query)).toBe(
      'UPDATE "products" SET "derived_price_from_minor" = ?, "derived_price_to_minor" = ?, "derived_compare_at_from_minor" = ?, "derived_inventory_total" = ?, "updated_at" = now() WHERE "id" = ?',
    )
    expect(query.values).toEqual([5_000, 7_000, 6_000, 5, 42])
  })

  it("runs on the caller's transaction when the request carries one", async () => {
    const { payload, pool, session } = fakePayload()
    const req = { context: {}, transactionID: 'tx-1' }

    await recalculateProductDerived({ payload: payload as never, productId: 42, req: req as never })

    expect(session).toHaveBeenCalledTimes(1)
    expect(pool).not.toHaveBeenCalled()
  })
})

describe('recalculateProductDerived — what the product hooks did', () => {
  it('syncs the search index for that product under Next, with the same request', async () => {
    const { payload } = fakePayload()
    const req = { context: {}, transactionID: 'tx-1' }

    await recalculateProductDerived({ payload: payload as never, productId: 42, req: req as never })

    expect(indexed).toHaveBeenCalledTimes(1)
    expect(indexed.mock.calls[0][0]).toBe(payload)
    expect(indexed.mock.calls[0][2]).toBe(42)
    expect(indexed.mock.calls[0][3]).toBe(req)
  })

  it('syncs after a post-payment refresh too, on a request of its own with no transaction', async () => {
    const { payload } = fakePayload()

    await recalculateProductDerived({ payload: payload as never, productId: 42 })

    expect(indexed).toHaveBeenCalledTimes(1)
    expect((indexed.mock.calls[0][3] as { transactionID?: unknown }).transactionID).toBeUndefined()
  })

  it('expires the catalog and home caches', async () => {
    const { payload } = fakePayload()

    await recalculateProductDerived({ payload: payload as never, productId: 42 })

    expect(revalidated.mock.calls).toEqual([
      ['catalog', 'max'],
      ['home', 'max'],
    ])
  })

  it('leaves the index alone outside Next, as every CLI write does', async () => {
    delete process.env.NEXT_RUNTIME

    const { payload } = fakePayload()

    await recalculateProductDerived({ payload: payload as never, productId: 42 })

    expect(indexed).not.toHaveBeenCalled()
  })

  it('does neither when no product row was written — a product already gone', async () => {
    const { payload } = fakePayload(0)

    await recalculateProductDerived({ payload: payload as never, productId: 42 })

    expect(indexed).not.toHaveBeenCalled()
    expect(revalidated).not.toHaveBeenCalled()
  })
})
