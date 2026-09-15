import { describe, expect, it } from 'vitest'

import {
  CONVERTED_BAG_COPY,
  decideStockEdit,
  PAID_CANCELLATION_COPY,
  readSubmittedNumber,
  refusesPaidCancellation,
  reopensConvertedBag,
  STOCK_WHEN_OPENED,
  stockChangedCopy,
} from '@/lib/concurrency/stale-writes'

/**
 * The concurrency review of 2026-09-15 — the form-window rules behind the stale-write locks.
 * `pnpm verify:concurrency` holds each race open against Postgres; this pins the decisions.
 */
describe('decideStockEdit — a variant save and the stock its page was opened with', () => {
  it('keeps the live stock when the editor left Stock as the page showed it', () => {
    expect(decideStockEdit({ live: 9, loaded: 10, submitted: 10 })).toEqual({ kind: 'keepLive' })
    expect(decideStockEdit({ live: 10, loaded: 10, submitted: 10 })).toEqual({ kind: 'keepLive' })
  })

  it('writes a changed count when the stock has not moved since the page was opened', () => {
    expect(decideStockEdit({ live: 10, loaded: 10, submitted: 25 })).toEqual({ kind: 'asSent' })
  })

  it('refuses a changed count over stock a sale has moved', () => {
    expect(decideStockEdit({ live: 9, loaded: 10, submitted: 25 })).toEqual({
      kind: 'conflict',
      live: 9,
      loaded: 10,
    })
  })

  it('refuses even when the new count happens to equal the live figure — it was typed over a stale one', () => {
    expect(decideStockEdit({ live: 9, loaded: 10, submitted: 9 }).kind).toBe('conflict')
  })

  it('takes a caller with no opened-with value at its word', () => {
    expect(decideStockEdit({ live: 9, loaded: null, submitted: 10 })).toEqual({ kind: 'asSent' })
    expect(decideStockEdit({ live: 9, loaded: null, submitted: null })).toEqual({ kind: 'asSent' })
  })

  it('has nothing to decide when the request carries no stock', () => {
    expect(decideStockEdit({ live: 9, loaded: 10, submitted: null })).toEqual({ kind: 'asSent' })
  })

  it('steps aside when the row was not found, and lets the operation say so', () => {
    expect(decideStockEdit({ live: null, loaded: 10, submitted: 25 })).toEqual({ kind: 'asSent' })
  })

  it('names both figures in the refusal', () => {
    const copy = stockChangedCopy({ live: 9, loaded: 10 })

    expect(copy).toContain('changed while you were editing')
    expect(copy).toContain('10')
    expect(copy).toContain('9')
    expect(copy).toContain('Reload')
  })

  it('is carried in a field named for what it holds', () => {
    expect(STOCK_WHEN_OPENED).toBe('stockWhenOpened')
  })
})

describe('readSubmittedNumber — a number as the field pass will read it', () => {
  it('reads finite numbers and numeric strings', () => {
    expect(readSubmittedNumber(7)).toBe(7)
    expect(readSubmittedNumber(0)).toBe(0)
    expect(readSubmittedNumber(' 12 ')).toBe(12)
  })

  it('reads anything else as not sent', () => {
    expect(readSubmittedNumber(undefined)).toBeNull()
    expect(readSubmittedNumber(null)).toBeNull()
    expect(readSubmittedNumber('')).toBeNull()
    expect(readSubmittedNumber('   ')).toBeNull()
    expect(readSubmittedNumber('many')).toBeNull()
    expect(readSubmittedNumber(Number.NaN)).toBeNull()
    expect(readSubmittedNumber(Number.POSITIVE_INFINITY)).toBeNull()
    expect(readSubmittedNumber({ value: 3 })).toBeNull()
  })
})

describe('refusesPaidCancellation — the panel does not cancel a paid order', () => {
  it('refuses a paid or refunded order moving to cancelled from REST or the admin panel', () => {
    expect(refusesPaidCancellation({ payment: 'paid', to: 'cancelled', viaLocalApi: false })).toBe(
      true,
    )
    expect(
      refusesPaidCancellation({ payment: 'refunded', to: 'cancelled', viaLocalApi: false }),
    ).toBe(true)
  })

  it('lets an unpaid order be cancelled — the ordinary case', () => {
    for (const payment of [
      'cancelled',
      'checkout_started',
      'draft',
      'payment_failed',
      'pending_payment',
    ]) {
      expect(refusesPaidCancellation({ payment, to: 'cancelled', viaLocalApi: false })).toBe(false)
    }
  })

  it('does not touch any other transition of a paid order', () => {
    for (const to of ['delivered', 'processing', 'shipped', 'unfulfilled']) {
      expect(refusesPaidCancellation({ payment: 'paid', to, viaLocalApi: false })).toBe(false)
    }
  })

  it('leaves the Local API alone', () => {
    expect(refusesPaidCancellation({ payment: 'paid', to: 'cancelled', viaLocalApi: true })).toBe(
      false,
    )
  })

  it('tells the editor where a refund starts', () => {
    expect(PAID_CANCELLATION_COPY).toContain('Stripe')
  })
})

describe('reopensConvertedBag — converted is history', () => {
  it('refuses any move off converted', () => {
    expect(reopensConvertedBag({ from: 'converted', to: 'active' })).toBe(true)
  })

  it('allows a write that leaves the status where it is', () => {
    expect(reopensConvertedBag({ from: 'converted', to: 'converted' })).toBe(false)
    expect(reopensConvertedBag({ from: 'converted', to: undefined })).toBe(false)
  })

  it('does not govern an active bag', () => {
    expect(reopensConvertedBag({ from: 'active', to: 'converted' })).toBe(false)
    expect(reopensConvertedBag({ from: 'active', to: 'active' })).toBe(false)
  })

  it('asks for a reload in its refusal', () => {
    expect(CONVERTED_BAG_COPY).toContain('reload')
  })
})
