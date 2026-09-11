import { describe, expect, it } from 'vitest'

import {
  canTransition,
  classifyUnclaimedSessionEvent,
  decideDuplicateDelivery,
  decidePriorSession,
  describeSessionMismatch,
  HANDLED_EVENT_TYPES,
  isFullRefund,
  isSessionEvent,
  planStripeEvent,
  REUSABLE_ORDER_STATUSES,
  STALE_RECEIVED_SECONDS,
} from '@/lib/checkout/rules'
import { isPartiallyRefunded } from '@/lib/orders/rules'

/**
 * **Phase 36's webhook decisions, without Stripe or a database** — audits R1-01, R1-03, R1-04,
 * R1-05, R1-06 and R1-09.
 *
 * `scripts/verify-webhook.ts` proves the SQL does what these say, against real rows. These prove the
 * decisions themselves, for every input, which the harness cannot afford to enumerate.
 */

const ORDER = { currency: 'USD', sessionId: 'cs_current', totalMinor: 12_000 }
const SESSION = { amountTotal: 12_000, currency: 'usd', id: 'cs_current' }

describe('what an event asks of the order (R1-05)', () => {
  it('finalises a completed session only when Stripe says it is paid', () => {
    expect(planStripeEvent('checkout.session.completed', 'paid')).toEqual({ kind: 'finalise' })
  })

  it('waits, taking nothing, when a completed session is still unpaid — a delayed method', () => {
    expect(planStripeEvent('checkout.session.completed', 'unpaid')).toEqual({
      kind: 'awaitPayment',
    })
  })

  it('treats a session that needed no payment as a mismatch, because there are no free orders', () => {
    expect(planStripeEvent('checkout.session.completed', 'no_payment_required').kind).toBe(
      'mismatch',
    )
  })

  it('treats a missing or unknown payment status as a mismatch, never as paid', () => {
    expect(planStripeEvent('checkout.session.completed', null).kind).toBe('mismatch')
    expect(planStripeEvent('checkout.session.completed', 'something_new').kind).toBe('mismatch')
  })

  it('finalises on the async success, and fails on the async failure', () => {
    expect(planStripeEvent('checkout.session.async_payment_succeeded', null)).toEqual({
      kind: 'finalise',
    })
    expect(planStripeEvent('checkout.session.async_payment_failed', null)).toEqual({
      kind: 'transition',
      to: 'payment_failed',
    })
  })

  it('cancels on expiry', () => {
    expect(planStripeEvent('checkout.session.expired', null)).toEqual({
      kind: 'transition',
      to: 'cancelled',
    })
  })

  it('only records a declined card, because the Checkout session can still be paid', () => {
    expect(planStripeEvent('payment_intent.payment_failed', null)).toEqual({ kind: 'record' })
  })

  it('routes a refund to the amount-based path, and ignores what it does not handle', () => {
    expect(planStripeEvent('charge.refunded', null)).toEqual({ kind: 'refund' })
    expect(planStripeEvent('payment_intent.succeeded', 'paid')).toEqual({ kind: 'ignore' })
    expect(planStripeEvent('', null)).toEqual({ kind: 'ignore' })
  })

  it('has a plan for every handled type', () => {
    for (const type of HANDLED_EVENT_TYPES) {
      expect(planStripeEvent(type, 'paid').kind).not.toBe('ignore')
    }
  })

  it('knows which events carry a Checkout Session', () => {
    expect(isSessionEvent('checkout.session.expired')).toBe(true)
    expect(isSessionEvent('charge.refunded')).toBe(false)
    expect(isSessionEvent('payment_intent.payment_failed')).toBe(false)
  })
})

describe('checking a session against its order (R1-01)', () => {
  it('finds nothing to object to in the current session at the current amount', () => {
    expect(describeSessionMismatch(ORDER, SESSION)).toEqual([])
  })

  it('compares currency without regard to case — Stripe sends it lower-case', () => {
    expect(describeSessionMismatch(ORDER, { ...SESSION, currency: 'USD' })).toEqual([])
  })

  it('names each difference: an older session, a different amount, another currency', () => {
    const differences = describeSessionMismatch(ORDER, {
      amountTotal: 9_000,
      currency: 'eur',
      id: 'cs_older',
    })

    expect(differences).toHaveLength(3)
    expect(differences.join(' ')).toMatch(/cs_older/)
    expect(differences.join(' ')).toMatch(/9000/)
    expect(differences.join(' ')).toMatch(/eur/)
  })

  it('treats a missing amount as a difference, never as a match', () => {
    expect(describeSessionMismatch(ORDER, { ...SESSION, amountTotal: null })).toHaveLength(1)
  })
})

describe('why a claim matched nothing', () => {
  it('calls a redelivery for a paid order its own session paid alreadyFinal', () => {
    expect(
      classifyUnclaimedSessionEvent({
        kind: 'finalise',
        order: { ...ORDER, status: 'paid' },
        session: SESSION,
      }),
    ).toEqual({ outcome: 'alreadyFinal' })
  })

  it('calls a payment from a superseded session a mismatch — money moved for the wrong bag', () => {
    const verdict = classifyUnclaimedSessionEvent({
      kind: 'finalise',
      order: { ...ORDER, status: 'pending_payment' },
      session: { ...SESSION, id: 'cs_older' },
    })

    expect(verdict.outcome).toBe('mismatch')
  })

  it('calls a payment for the right session at the wrong amount a mismatch', () => {
    expect(
      classifyUnclaimedSessionEvent({
        kind: 'finalise',
        order: { ...ORDER, status: 'pending_payment' },
        session: { ...SESSION, amountTotal: 11_999 },
      }).outcome,
    ).toBe('mismatch')
  })

  it('calls a second session paying an already-paid order a mismatch, not a duplicate', () => {
    expect(
      classifyUnclaimedSessionEvent({
        kind: 'finalise',
        order: { ...ORDER, status: 'paid' },
        session: { ...SESSION, id: 'cs_other' },
      }).outcome,
    ).toBe('mismatch')
  })

  it('calls an expiry for a replaced session superseded, and one for the current session final', () => {
    expect(
      classifyUnclaimedSessionEvent({
        kind: 'transition',
        order: { ...ORDER, status: 'pending_payment' },
        session: { ...SESSION, id: 'cs_older' },
      }),
    ).toEqual({ outcome: 'superseded' })

    expect(
      classifyUnclaimedSessionEvent({
        kind: 'transition',
        order: { ...ORDER, status: 'paid' },
        session: SESSION,
      }),
    ).toEqual({ outcome: 'alreadyFinal' })
  })
})

describe('a refund is decided by amount (R1-09)', () => {
  it('is full only when it covers the total', () => {
    expect(isFullRefund(12_000, 12_000)).toBe(true)
    expect(isFullRefund(12_001, 12_000)).toBe(true)
    expect(isFullRefund(11_999, 12_000)).toBe(false)
  })

  it('reads a paid order with part of its total refunded as partially refunded', () => {
    expect(isPartiallyRefunded('paid', 1_500, 12_000)).toBe(true)
    expect(isPartiallyRefunded('paid', 12_000, 12_000)).toBe(false)
    expect(isPartiallyRefunded('paid', 0, 12_000)).toBe(false)
    expect(isPartiallyRefunded('paid', null, 12_000)).toBe(false)
    expect(isPartiallyRefunded('refunded', 12_000, 12_000)).toBe(false)
  })
})

describe('a redelivered event id (R1-04)', () => {
  const now = new Date('2026-09-11T12:00:00.000Z')
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString()

  it('acknowledges an event whose work is done, or had none', () => {
    expect(decideDuplicateDelivery({ now, receivedAt: ago(5), status: 'processed' })).toBe(
      'acknowledge',
    )
    expect(decideDuplicateDelivery({ now, receivedAt: ago(5), status: 'ignored' })).toBe(
      'acknowledge',
    )
  })

  it('reprocesses an event whose earlier delivery failed, however recent', () => {
    expect(decideDuplicateDelivery({ now, receivedAt: ago(1), status: 'failed' })).toBe('reprocess')
  })

  it('asks Stripe to retry later while another delivery is probably still working', () => {
    expect(
      decideDuplicateDelivery({
        now,
        receivedAt: ago(STALE_RECEIVED_SECONDS - 1),
        status: 'received',
      }),
    ).toBe('retryLater')
  })

  it('reprocesses a delivery that died mid-flight, once it is old enough to be sure', () => {
    expect(
      decideDuplicateDelivery({
        now,
        receivedAt: ago(STALE_RECEIVED_SECONDS + 1),
        status: 'received',
      }),
    ).toBe('reprocess')
  })

  it('reprocesses a row whose timestamp cannot be read, rather than acknowledging unknown work', () => {
    expect(decideDuplicateDelivery({ now, receivedAt: null, status: 'received' })).toBe('reprocess')
    expect(decideDuplicateDelivery({ now, receivedAt: 'not a date', status: 'received' })).toBe(
      'reprocess',
    )
  })
})

describe('reusing an order for a new checkout attempt (R1-01, R1-03, R1-06)', () => {
  it('reuses a pending order and never a cancelled one', () => {
    expect(REUSABLE_ORDER_STATUSES).toContain('pending_payment')
    expect(REUSABLE_ORDER_STATUSES).not.toContain('cancelled')
    expect(REUSABLE_ORDER_STATUSES).not.toContain('paid')
    expect(REUSABLE_ORDER_STATUSES).not.toContain('refunded')
  })

  it('lets the machine take a reused pending order back to checkout_started', () => {
    expect(canTransition('pending_payment', 'checkout_started')).toBe(true)
  })

  it('refuses to rewrite an order whose previous session was paid', () => {
    for (const sessionStatus of ['complete', 'open', 'expired', null]) {
      expect(
        decidePriorSession({
          orderStatus: 'pending_payment',
          sessionPaymentStatus: 'paid',
          sessionStatus,
        }),
      ).toBe('refuse')
    }
  })

  it('expires an open session first, and proceeds over an expired one', () => {
    expect(
      decidePriorSession({
        orderStatus: 'pending_payment',
        sessionPaymentStatus: 'unpaid',
        sessionStatus: 'open',
      }),
    ).toBe('expire')
    expect(
      decidePriorSession({
        orderStatus: 'pending_payment',
        sessionPaymentStatus: 'unpaid',
        sessionStatus: 'expired',
      }),
    ).toBe('proceed')
  })

  it('refuses while a delayed payment is clearing, and proceeds once it has definitively failed', () => {
    expect(
      decidePriorSession({
        orderStatus: 'pending_payment',
        sessionPaymentStatus: 'unpaid',
        sessionStatus: 'complete',
      }),
    ).toBe('refuse')
    expect(
      decidePriorSession({
        orderStatus: 'payment_failed',
        sessionPaymentStatus: 'unpaid',
        sessionStatus: 'complete',
      }),
    ).toBe('proceed')
  })

  it('refuses a session state it does not know', () => {
    expect(
      decidePriorSession({
        orderStatus: 'pending_payment',
        sessionPaymentStatus: 'unpaid',
        sessionStatus: null,
      }),
    ).toBe('refuse')
  })
})
