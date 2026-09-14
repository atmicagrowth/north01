/**
 * **The daily retention sweep — the owner's decision of 2026-09-11, as a predicate.**
 *
 * The module under test is `src/lib/cart/sweep.ts`: expired bags (plan §34.1c, audit R1-27) and
 * unpaid orders, both deleted on a clock by one Vercel Cron request.
 *
 * `scripts/verify-orders.ts` section M proves the same rules against the **real database** — that an
 * unpaid order and its lines actually disappear, that a paid or held one of the same age does not.
 * This file is the half that needs no database: it drives the sweep against a fake `Payload` and
 * asserts the **query it issues**, which is where every expensive mistake in a retention job lives.
 *
 * ### The failure modes these tests exist for
 *
 * 1. **Sweeping a paid order.** An order that was paid for is a financial record kept for tax, and
 *    deleting one is unrecoverable and possibly unlawful. `paid` and `refunded` must never appear in
 *    the status filter, whatever else changes.
 * 2. **Sweeping a held order.** A `paymentMismatch` hold means money may have been taken while the
 *    status stayed unpaid — the retention review's highest finding. The hold column is nullable, so
 *    "no hold" must be `none` **or** empty, spelled positively so a new hold value is kept by default.
 * 3. **A window measured from the wrong column, the wrong clock or the wrong direction.** On
 *    `createdAt` the sweep would delete an order a customer is paying for *right now*; on
 *    `greater_than` it would delete everything recent.
 * 4. **A delete that trusts its own earlier read.** An order paid between the read and the delete
 *    must not be deleted, so the delete re-applies the whole predicate under a row lock.
 * 5. **A soft delete masquerading as a retention promise.** Payload's `trash: true` means
 *    *permanently delete, trashed rows included*; `trash: false` would silently exempt every unpaid
 *    order somebody had moved to the admin trash, which still holds the name, email and address.
 * 6. **An unbounded run**, one that claims a backlog it does not have, or one that over-reports what
 *    it deleted, so a cron either times out, stops early forever, or lies in its own log line.
 * 7. **One rule taking the other down with it**, or a failure that reaches the log and not Sentry.
 */

import type { Payload } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/observability/report', () => ({ reportFailure: vi.fn() }))

import {
  CART_SWEEP_BATCH,
  NEVER_PAID_STATUSES,
  sweepExpiredCarts,
  sweepRetention,
  sweepUnpaidOrders,
  UNPAID_ORDER_RETENTION_DAYS,
  UNPAID_ORDER_SWEEP_BATCH,
  unpaidOrderRetentionWhere,
} from '@/lib/cart/sweep'
import { reportFailure } from '@/lib/observability/report'

const reported = vi.mocked(reportFailure)

beforeEach(() => {
  reported.mockClear()
})

/* ------------------------------------------------------------------------------------------------
 * A tiny evaluator for the `where` shapes the sweep builds — with SQL's NULL semantics
 * --------------------------------------------------------------------------------------------- */

type Row = { id: number } & Record<string, unknown>

/**
 * Evaluates a Payload `where` against one row the way Postgres would, for the operators the sweep
 * uses. The NULL rules are the point: `equals`, `in` and `less_than` are **false** against a null
 * column (SQL's `NULL = 'x'` is NULL, not true), and only `exists: false` matches one. An operator the
 * evaluator does not know — `not_equals`, `greater_than`, `not_in` — throws, so a mutated query fails
 * loudly rather than matching.
 */
function matches(row: Row, where: unknown): boolean {
  const clause = where as Record<string, unknown>

  return Object.entries(clause).every(([key, value]) => {
    if (key === 'and') return (value as unknown[]).every((part) => matches(row, part))
    if (key === 'or') return (value as unknown[]).some((part) => matches(row, part))

    const column = row[key] ?? null

    return Object.entries(value as Record<string, unknown>).every(([operator, operand]) => {
      switch (operator) {
        case 'equals':
          return column !== null && column === operand
        case 'exists':
          return operand ? column !== null : column === null
        case 'in':
          return column !== null && (operand as unknown[]).includes(column)
        case 'less_than':
          return column !== null && String(column) < String(operand)
        default:
          throw new Error(`The fake database does not understand \`${operator}\`.`)
      }
    })
  })
}

/* ------------------------------------------------------------------------------------------------
 * A fake Payload — it records the query, and answers it the way the real adapter would
 * --------------------------------------------------------------------------------------------- */

type Args = {
  collection: string
  depth?: number
  limit?: number
  req?: { transactionID?: unknown }
  sort?: string
  trash?: boolean
  where?: unknown
}

/** The text of a drizzle `sql` template, parameters shown as `?`. */
function sqlText(query: unknown): string {
  const walk = (chunk: unknown): string => {
    const node = chunk as { queryChunks?: unknown[]; value?: unknown[] }

    if (Array.isArray(node?.queryChunks)) return node.queryChunks.map(walk).join('')
    if (Array.isArray(node?.value)) return node.value.join('')

    return '?'
  }

  return walk(query).replace(/\s+/g, ' ')
}

/**
 * - `rows` is what each collection holds. A bare number is a row the database is taken to match; a
 *   `Row` is evaluated against the `where` with {@link matches}, so a mutated query changes which rows
 *   come back.
 * - `find` slices to `limit`, which is what makes `more` mean "the batch was full".
 * - `delete` answers from the rows **as they are at delete time** (`changedBeforeDelete` edits them
 *   between the read and the write) and from the `where` it was actually given — so `deleted` can
 *   only be right if it is read from the delete's answer.
 * - `partialDelete` makes the last selected row fail, as a `beforeDelete` cascade error would.
 */
function fakePayload(
  options: {
    changedBeforeDelete?: Record<number, Record<string, unknown>>
    failOn?: string
    failOnDelete?: string
    partialDelete?: string
    rows?: Record<string, (number | Row)[]>
  } = {},
) {
  const finds: Args[] = []
  const deletes: Args[] = []
  const executed: string[] = []
  const events: string[] = []
  const logged: Record<string, unknown>[] = []

  const rowsOf = (collection: string) =>
    (options.rows?.[collection] ?? []).map((row) => (typeof row === 'number' ? row : { ...row }))

  const select = (rows: (number | Row)[], where: unknown) =>
    rows.filter((row) => typeof row === 'number' || matches(row, where))

  const idOf = (row: number | Row) => (typeof row === 'number' ? row : row.id)

  const payload = {
    db: {
      beginTransaction: async () => {
        events.push('begin')

        return 'tx-1'
      },
      commitTransaction: async (id: unknown) => {
        events.push(`commit:${String(id)}`)
      },
      rollbackTransaction: async (id: unknown) => {
        events.push(`rollback:${String(id)}`)
      },
      sessions: {
        'tx-1': {
          db: {
            execute: async (query: unknown) => {
              events.push('lock')
              executed.push(sqlText(query))

              return { rows: [] }
            },
          },
        },
      },
    },
    delete: async (args: Args) => {
      deletes.push(args)
      events.push(`delete:${String(args.req?.transactionID ?? 'none')}`)

      if (options.failOnDelete === args.collection) {
        throw new Error(`${args.collection} could not be deleted`)
      }

      const now = rowsOf(args.collection).map((row) =>
        typeof row === 'number' ? row : { ...row, ...options.changedBeforeDelete?.[row.id] },
      )

      /* The ids clause is honoured for bare-number rows too, which have nothing else to match on. */
      const idClause = args.where as { and?: { id?: { in?: number[] } }[]; id?: { in?: number[] } }
      const ids = idClause.id?.in ?? idClause.and?.find((part) => part.id)?.id?.in ?? []

      const hit = select(now, args.where).filter((row) => ids.includes(idOf(row)))
      const failing = options.partialDelete === args.collection ? hit.slice(-1) : []
      const removed = hit.filter((row) => !failing.includes(row))

      return {
        docs: removed.map((row) => ({ id: idOf(row) })),
        errors: failing.map((row) => ({ id: idOf(row), message: 'cascade failed' })),
      }
    },
    find: async (args: Args) => {
      finds.push(args)

      if (options.failOn === args.collection) {
        throw new Error(`${args.collection} is unreachable`)
      }

      const hit = select(rowsOf(args.collection), args.where)

      return { docs: hit.slice(0, args.limit ?? hit.length).map((row) => ({ id: idOf(row) })) }
    },
    logger: {
      error: (entry: Record<string, unknown>) => logged.push({ level: 'error', ...entry }),
      info: (entry: Record<string, unknown>) => logged.push({ level: 'info', ...entry }),
    },
  }

  return { deletes, events, executed, finds, logged, payload: payload as unknown as Payload }
}

const AT = new Date('2026-09-11T00:00:00.000Z')
const CUTOFF = '2026-08-12T00:00:00.000Z'

/** The exact predicate the order sweep must send — every clause, every operator, every value. */
const EXPECTED_ORDER_WHERE = {
  and: [
    {
      paymentStatus: {
        in: ['cancelled', 'checkout_started', 'draft', 'payment_failed', 'pending_payment'],
      },
    },
    { updatedAt: { less_than: CUTOFF } },
    { or: [{ fulfilmentHold: { equals: 'none' } }, { fulfilmentHold: { exists: false } }] },
  ],
}

/** An order row, old and unpaid and unheld unless told otherwise. */
const order = (id: number, fields: Record<string, unknown> = {}): Row => ({
  fulfilmentHold: 'none',
  id,
  paymentStatus: 'checkout_started',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...fields,
})

/** Sorted, because `NEVER_PAID_STATUSES` is built from `Object.keys` and its order means nothing. */
function normalised(where: unknown) {
  const copy = structuredClone(where) as { and: { paymentStatus?: { in: string[] } }[] }

  for (const clause of copy.and) {
    clause.paymentStatus?.in.sort()
  }

  return copy
}

/* ------------------------------------------------------------------------------------------------
 * Which orders it may touch
 * --------------------------------------------------------------------------------------------- */

describe('the statuses an unpaid-order sweep may match', () => {
  it('never names paid or refunded — the two that mean money moved', () => {
    expect(NEVER_PAID_STATUSES).not.toContain('paid')
    expect(NEVER_PAID_STATUSES).not.toContain('refunded')
  })

  it('names the five never-paid states of §17.1c, and no others', () => {
    expect([...NEVER_PAID_STATUSES].sort()).toEqual([
      'cancelled',
      'checkout_started',
      'draft',
      'payment_failed',
      'pending_payment',
    ])
  })

  it('sends exactly the whole predicate to the database — status, window and hold', async () => {
    // Structural and exact: a flipped operator, a negated status filter (`not_in`), a dropped hold
    // clause or a `not_equals` hold spelling all fail here, whatever else they still contain.
    const { finds, payload } = fakePayload()

    await sweepUnpaidOrders(payload, AT)

    expect(normalised(finds[0].where)).toEqual(EXPECTED_ORDER_WHERE)
    expect(normalised(unpaidOrderRetentionWhere(AT))).toEqual(EXPECTED_ORDER_WHERE)
  })

  it('selects an old unpaid order in every never-paid status, and never a paid or refunded one', async () => {
    const rows = [
      ...NEVER_PAID_STATUSES.map((status, index) => order(index + 1, { paymentStatus: status })),
      order(50, { paymentStatus: 'paid' }),
      order(51, { paymentStatus: 'refunded' }),
    ]

    const { deletes, payload } = fakePayload({ rows: { orders: rows } })

    const result = await sweepUnpaidOrders(payload, AT)

    expect(result.deleted).toBe(NEVER_PAID_STATUSES.length)
    expect((deletes[0].where as { and: [{ id: { in: number[] } }] }).and[0].id.in).toEqual([
      1, 2, 3, 4, 5,
    ])
  })
})

describe('an order under a fulfilment hold', () => {
  it('is never selected, however old — a payment mismatch may be captured money', async () => {
    const { deletes, payload } = fakePayload({
      rows: {
        orders: [
          order(1, { fulfilmentHold: 'paymentMismatch', paymentStatus: 'pending_payment' }),
          order(2, { fulfilmentHold: 'paymentMismatch', updatedAt: '2000-01-01T00:00:00.000Z' }),
          order(3, { fulfilmentHold: 'stockShortfall' }),
        ],
      },
    })

    expect(await sweepUnpaidOrders(payload, AT)).toEqual({ deleted: 0, more: false })
    expect(deletes).toHaveLength(0)
  })

  it('does not exempt an order whose hold column is empty — NULL means no hold', async () => {
    // An empty hold is no hold. `equals: 'none'` alone is NULL — not true — for an empty column in
    // SQL, and would keep these rows forever; the `exists: false` half is what takes them.
    const { payload } = fakePayload({
      rows: { orders: [order(1, { fulfilmentHold: null }), order(2)] },
    })

    expect(await sweepUnpaidOrders(payload, AT)).toEqual({ deleted: 2, more: false })
  })
})

/* ------------------------------------------------------------------------------------------------
 * The window
 * --------------------------------------------------------------------------------------------- */

describe('the thirty-day window', () => {
  it('is the thirty days the owner decided on 2026-09-11', () => {
    expect(UNPAID_ORDER_RETENTION_DAYS).toBe(30)
  })

  it('measures back from the clock it is given, not from the wall clock', async () => {
    const { finds, payload } = fakePayload()

    await sweepUnpaidOrders(payload, AT)

    expect((finds[0].where as typeof EXPECTED_ORDER_WHERE).and[1]).toEqual({
      updatedAt: { less_than: CUTOFF },
    })
  })

  it('takes an order last touched before the cutoff, and leaves one touched at or after it', async () => {
    const { payload } = fakePayload({
      rows: {
        orders: [
          order(1, { updatedAt: '2026-08-11T23:59:59.999Z' }),
          order(2, { updatedAt: CUTOFF }),
          order(3, { updatedAt: '2026-09-10T00:00:00.000Z' }),
        ],
      },
    })

    expect(await sweepUnpaidOrders(payload, AT)).toEqual({ deleted: 1, more: false })
  })

  it('filters on updatedAt, so an order being paid for right now is never deleted', async () => {
    /*
     * A row created months ago can have a Stripe session opened against it a minute ago, because
     * preflight reuses an order across checkout attempts. On `createdAt` this sweep would delete that
     * order mid-payment. `updatedAt` is every write to the order — the raw checkout claims included,
     * since the retention review — so the window means "nothing has happened to this order for
     * thirty days".
     */
    const { finds, payload } = fakePayload()

    await sweepUnpaidOrders(payload, AT)

    expect(JSON.stringify(finds[0].where)).not.toContain('createdAt')
  })

  it('clears the oldest backlog first', async () => {
    const { finds, payload } = fakePayload()

    await sweepUnpaidOrders(payload, AT)

    expect(finds[0].sort).toBe('updatedAt')
  })
})

/* ------------------------------------------------------------------------------------------------
 * The delete — re-checked, locked, permanent
 * --------------------------------------------------------------------------------------------- */

describe('the delete re-checks what it deletes', () => {
  it('deletes the selected ids AND the whole predicate again, not the ids alone', async () => {
    const { deletes, finds, payload } = fakePayload({ rows: { orders: [11, 12, 13] } })

    await sweepUnpaidOrders(payload, AT)

    expect(deletes[0].where).toEqual({
      and: [{ id: { in: [11, 12, 13] } }, ...(finds[0].where as { and: unknown[] }).and],
    })
    expect(normalised({ and: (deletes[0].where as { and: unknown[] }).and.slice(1) })).toEqual(
      EXPECTED_ORDER_WHERE,
    )
  })

  it('leaves an order that was paid, held or touched between the read and the delete', async () => {
    const { payload } = fakePayload({
      changedBeforeDelete: {
        2: { paymentStatus: 'paid' },
        3: { fulfilmentHold: 'paymentMismatch' },
        4: { updatedAt: '2026-09-10T12:00:00.000Z' },
      },
      rows: { orders: [order(1), order(2), order(3), order(4)] },
    })

    expect(await sweepUnpaidOrders(payload, AT)).toEqual({ deleted: 1, more: false })
  })

  it('locks the selected rows first, inside the transaction the delete runs in, then commits', async () => {
    const { deletes, events, executed, payload } = fakePayload({ rows: { orders: [5, 3] } })

    await sweepUnpaidOrders(payload, AT)

    expect(events).toEqual(['begin', 'lock', 'delete:tx-1', 'commit:tx-1'])
    expect(executed[0]).toMatch(
      /SELECT "id" FROM "orders" WHERE "id" IN \(\?, \?\) ORDER BY "id" FOR UPDATE/,
    )
    expect(deletes[0].req?.transactionID).toBe('tx-1')
  })

  it('rolls the transaction back when the delete throws, and the cron step reports it', async () => {
    const { events, logged, payload } = fakePayload({
      failOnDelete: 'orders',
      rows: { orders: [1] },
    })

    const result = await sweepRetention(payload, AT)

    expect(events).toContain('rollback:tx-1')
    expect(events).not.toContain('commit:tx-1')
    expect(result.orders).toEqual({ deleted: 0, failed: true, more: true })
    expect(logged).toContainEqual(expect.objectContaining({ level: 'error', step: 'orders' }))
    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'retention.orders')
  })
})

describe('deleting permanently, trashed rows included', () => {
  it('asks for trashed rows on the read and removes them on the write', async () => {
    /*
     * `trash: true` is Payload's *"permanently delete both normal and trashed documents"*, against
     * `trash: false`'s *"only normal (non-trashed) documents"*. Neither is a soft delete. Without it
     * an unpaid order sitting in the admin trash — name, email and address intact — would be exempt
     * from the promise forever, which is the one category a person most expected to be gone.
     */
    const { deletes, finds, payload } = fakePayload({ rows: { orders: [7] } })

    await sweepUnpaidOrders(payload, AT)

    expect(finds[0].trash).toBe(true)
    expect(deletes[0].trash).toBe(true)
  })

  it('issues no transaction and no delete at all when nothing has expired', async () => {
    // A `where` that matched everything would be catastrophic here, so the empty case returns early
    // rather than sending `{ id: { in: [] } }` and trusting the adapter.
    const { deletes, events, payload } = fakePayload({ rows: { orders: [] } })

    expect(await sweepUnpaidOrders(payload, AT)).toEqual({ deleted: 0, more: false })
    expect(deletes).toHaveLength(0)
    expect(events).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------------------------------------
 * What it says it did
 * --------------------------------------------------------------------------------------------- */

describe('reporting what was actually deleted', () => {
  it('counts what the delete removed, not what the read selected', async () => {
    const { payload } = fakePayload({
      changedBeforeDelete: { 12: { paymentStatus: 'paid' } },
      rows: { orders: [order(11), order(12), order(13)] },
    })

    expect((await sweepUnpaidOrders(payload, AT)).deleted).toBe(2)
  })

  it('reports a partially failed order batch to the log and to Sentry, and does not over-count', async () => {
    const { logged, payload } = fakePayload({
      partialDelete: 'orders',
      rows: { orders: [1, 2, 3] },
    })

    const result = await sweepUnpaidOrders(payload, AT)

    expect(result).toEqual({ deleted: 2, more: false })
    expect(logged).toContainEqual(expect.objectContaining({ errors: 1, level: 'error' }))
    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'retention.orders', {
      errors: 1,
      selected: 3,
    })
  })

  it('reports a partially failed bag batch the same way', async () => {
    const { logged, payload } = fakePayload({
      partialDelete: 'carts',
      rows: { carts: [1, 2, 3] },
    })

    const result = await sweepExpiredCarts(payload, AT)

    expect(result).toEqual({ deleted: 2, more: false })
    expect(logged).toContainEqual(expect.objectContaining({ errors: 1, level: 'error' }))
    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'retention.carts', {
      errors: 1,
      selected: 3,
    })
  })

  it('reports nothing when every selected row was deleted', async () => {
    const { payload } = fakePayload({ rows: { carts: [1], orders: [2] } })

    await sweepRetention(payload, AT)

    expect(reported).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------------------------------------
 * The bound
 * --------------------------------------------------------------------------------------------- */

describe('staying inside one invocation', () => {
  it('defaults to a bounded batch on both rules', () => {
    expect(UNPAID_ORDER_SWEEP_BATCH).toBe(200)
    expect(CART_SWEEP_BATCH).toBe(200)
  })

  it('asks for no more than the batch, and says a backlog remains when it fills it', async () => {
    const { finds, payload } = fakePayload({ rows: { orders: [1, 2, 3, 4, 5] } })

    const result = await sweepUnpaidOrders(payload, AT, 2)

    expect(finds[0].limit).toBe(2)
    expect(result).toEqual({ deleted: 2, more: true })
  })

  it('does not claim a backlog it does not have', async () => {
    const { payload } = fakePayload({ rows: { orders: [1, 2] } })

    expect(await sweepUnpaidOrders(payload, AT, 5)).toEqual({ deleted: 2, more: false })
  })

  it('bounds the bag sweep the same way, and only takes active bags past their expiry', async () => {
    // Exact, because a substring check passed `greater_than` (every live bag) and `not_equals:
    // 'active'` (every converted bag, which is order history).
    const { finds, payload } = fakePayload({ rows: { carts: [1, 2, 3] } })

    const result = await sweepExpiredCarts(payload, AT, 2)

    expect(finds[0].collection).toBe('carts')
    expect(finds[0].where).toEqual({
      and: [{ status: { equals: 'active' } }, { expiresAt: { less_than: AT.toISOString() } }],
    })
    expect(finds[0].sort).toBe('expiresAt')
    expect(finds[0].limit).toBe(2)
    expect(result).toEqual({ deleted: 2, more: true })
  })

  it('takes an expired active bag, and never a live or converted one', async () => {
    const { payload } = fakePayload({
      rows: {
        carts: [
          { expiresAt: '2026-09-10T00:00:00.000Z', id: 1, status: 'active' },
          { expiresAt: '2026-09-12T00:00:00.000Z', id: 2, status: 'active' },
          { expiresAt: '2026-09-10T00:00:00.000Z', id: 3, status: 'converted' },
        ],
      },
    })

    expect(await sweepExpiredCarts(payload, AT)).toEqual({ deleted: 1, more: false })
  })
})

/* ------------------------------------------------------------------------------------------------
 * The one run the cron makes
 * --------------------------------------------------------------------------------------------- */

describe('the cron entry point', () => {
  it('runs both rules from one request and reports each separately', async () => {
    const { payload } = fakePayload({ rows: { carts: [1, 2], orders: [3] } })

    expect(await sweepRetention(payload, AT)).toEqual({
      carts: { deleted: 2, failed: false, more: false },
      orders: { deleted: 1, failed: false, more: false },
    })
  })

  it('logs a count for each rule', async () => {
    const { logged, payload } = fakePayload({ rows: { carts: [1], orders: [2, 3] } })

    await sweepRetention(payload, AT)

    expect(logged).toContainEqual(
      expect.objectContaining({ deleted: 1, level: 'info', step: 'carts' }),
    )
    expect(logged).toContainEqual(
      expect.objectContaining({ deleted: 2, level: 'info', step: 'orders' }),
    )
  })

  it('does not let a failing rule stop the other, and never throws at the cron', async () => {
    // Two unrelated jobs behind one cron entry: a bag sweep that throws must not mean unpaid orders
    // are kept forever, and the cron must still get an answer saying which half ran.
    const { payload } = fakePayload({ failOn: 'carts', rows: { orders: [9] } })

    const result = await sweepRetention(payload, AT)

    expect(result.carts).toEqual({ deleted: 0, failed: true, more: true })
    expect(result.orders).toEqual({ deleted: 1, failed: false, more: false })
  })

  it('sends a failing order step to the log and to Sentry, under its own area', async () => {
    const { logged, payload } = fakePayload({ failOn: 'orders' })

    await sweepRetention(payload, AT)

    expect(logged).toContainEqual(expect.objectContaining({ level: 'error', step: 'orders' }))
    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'retention.orders')
    expect(reported).not.toHaveBeenCalledWith(expect.anything(), 'retention.carts')
  })

  it('sends a failing bag step to the log and to Sentry, under its own area', async () => {
    const { logged, payload } = fakePayload({ failOn: 'carts' })

    await sweepRetention(payload, AT)

    expect(logged).toContainEqual(expect.objectContaining({ level: 'error', step: 'carts' }))
    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'retention.carts')
    expect(reported).not.toHaveBeenCalledWith(expect.anything(), 'retention.orders')
  })
})
