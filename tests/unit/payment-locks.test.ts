import { beforeEach, describe, expect, it, vi } from 'vitest'

import { planStockDecrements } from '@/lib/checkout/rules'

/**
 * **Owner follow-up sweep 2 — two ways a payment could stall or deadlock on its own locks.**
 *
 * Both are about what happens while the payment transaction holds rows, which no sequential harness
 * run can show; so each is pinned at the point that decides it.
 */

vi.mock('@/lib/email/send', () => ({
  enqueueEmail: vi.fn(async () => ({ outcome: 'queued', id: 1 })),
}))

const { queueOrderConfirmation, queueRefundMessage } = await import('@/lib/email/orders')

describe('planStockDecrements — variant rows are locked in one global order', () => {
  it('orders decrements by ascending variant id, whatever order the bag lines are in', () => {
    const plan = planStockDecrements([
      { quantity: 1, stock: 5, variantId: 9 },
      { quantity: 1, stock: 5, variantId: 2 },
      { quantity: 1, stock: 5, variantId: 7 },
    ])

    expect(plan.decrements.map((d) => d.variantId)).toEqual([2, 7, 9])
  })

  it('gives two payments for the same variants the same lock order', () => {
    const first = planStockDecrements([
      { quantity: 1, stock: 5, variantId: 4 },
      { quantity: 1, stock: 5, variantId: 3 },
    ])
    const second = planStockDecrements([
      { quantity: 1, stock: 5, variantId: 3 },
      { quantity: 1, stock: 5, variantId: 4 },
    ])

    expect(first.decrements.map((d) => d.variantId)).toEqual(
      second.decrements.map((d) => d.variantId),
    )
  })

  it('still sums two lines for one variant before deciding', () => {
    const plan = planStockDecrements([
      { quantity: 2, stock: 3, variantId: 5 },
      { quantity: 2, stock: 3, variantId: 5 },
    ])

    expect(plan.ok).toBe(false)
    expect(plan.decrements).toEqual([])
    expect(plan.short).toEqual([{ available: 3, quantity: 4, variantId: 5 }])
  })
})

describe('order emails read the shop locale on the payment transaction, not a second connection', () => {
  const req = { transactionID: 'tx-held' } as never
  const findGlobal = vi.fn(async (_args: { req?: unknown }) => ({ defaultLocale: 'en-GB' }))

  const payload = {
    find: vi.fn(async () => ({ docs: [] })),
    findByID: vi.fn(async () => ({
      currency: 'USD',
      customer: null,
      discountMinor: 0,
      email: 'shopper@example.test',
      id: 1,
      orderNumber: 'N1-2609-ABCDEF',
      shippingMinor: 0,
      subtotalMinor: 1000,
      taxMinor: 0,
      totalMinor: 1000,
    })),
    findGlobal,
  } as never

  beforeEach(() => {
    findGlobal.mockClear()
  })

  it('passes the transaction req when queuing an order confirmation', async () => {
    await queueOrderConfirmation(payload, 1, req)

    expect(findGlobal).toHaveBeenCalled()
    expect(findGlobal.mock.calls.every(([args]) => args.req === req)).toBe(true)
  })

  it('passes the transaction req when queuing a refund message', async () => {
    await queueRefundMessage(payload, 1, 500, req)

    expect(findGlobal).toHaveBeenCalled()
    expect(findGlobal.mock.calls.every(([args]) => args.req === req)).toBe(true)
  })
})
