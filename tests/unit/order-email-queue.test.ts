/**
 * **The dispatch email's queue write, and the transaction it can end** — the lost-side-effect review.
 *
 * The module under test is `src/payload/hooks/queueOrderEmails.ts`, the `afterChange` hook that queues
 * the shipped and delivered messages inside the order's own update transaction.
 *
 * Payload answers any failed Local API write by killing the transaction it joined, and `enqueueEmail`
 * turns that throw into `{ outcome: 'error' }`. The hook used to log it and return, so `updateByID`
 * "committed" a transaction that no longer existed: the admin saw the order saved as shipped while the
 * status, the tracking number and the email had all been rolled back. The hook must now fail the save
 * when that happens, and report — never swallow — a refusal that left the transaction standing.
 *
 * A fake `Payload` stands in for the adapter: the transaction is alive while `db.sessions` holds its id,
 * which is exactly what `killTransaction` removes, and the check `queueOnce` in `fulfil.ts` makes.
 */

import type { PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/observability/report', () => ({ reportFailure: vi.fn() }))
vi.mock('@/lib/email/orders', () => ({ queueFulfilmentMessage: vi.fn() }))

import { queueFulfilmentMessage } from '@/lib/email/orders'
import type { EnqueueOutcome } from '@/lib/email/send'
import { reportFailure } from '@/lib/observability/report'
import { queueOrderEmails } from '@/payload/hooks/queueOrderEmails'

const reported = vi.mocked(reportFailure)
const queue = vi.mocked(queueFulfilmentMessage)

const TRANSACTION = 7

function fakeRequest(existingMessages = 0) {
  const sessions: Record<string, unknown> = { [String(TRANSACTION)]: {} }

  const payload = {
    db: { sessions },
    find: vi.fn(() => Promise.resolve({ totalDocs: existingMessages })),
    logger: { error: vi.fn() },
  }

  const req = { payload, transactionID: TRANSACTION } as unknown as PayloadRequest

  /* What Payload's operation catch does when a write inside the transaction fails. */
  const killTransaction = () => {
    delete sessions[String(TRANSACTION)]
    delete (req as { transactionID?: unknown }).transactionID
  }

  return { killTransaction, payload, req }
}

const ORDER = {
  carrier: 'UPS',
  email: 'customer@example.test',
  fulfillmentStatus: 'shipped',
  id: 42,
  orderNumber: 'N1-0042',
  trackingNumber: '1Z999',
}

const run = (req: PayloadRequest, previous = 'processing', doc: Record<string, unknown> = ORDER) =>
  queueOrderEmails({
    collection: {} as never,
    context: {},
    data: doc,
    doc,
    operation: 'update',
    previousDoc: { ...doc, fulfillmentStatus: previous },
    req,
  })

beforeEach(() => {
  reported.mockClear()
  queue.mockReset()
})

describe('queueOrderEmails', () => {
  it('queues the shipped message inside the order’s transaction, and reports nothing', async () => {
    const { req } = fakeRequest()

    queue.mockResolvedValue({ id: 1, outcome: 'claimed' })

    await expect(run(req)).resolves.toBe(ORDER)
    expect(queue).toHaveBeenCalledWith(req.payload, ORDER, 'orderShipped', req)
    expect(reported).not.toHaveBeenCalled()
  })

  it('**fails the save when queueing ended the transaction** — nothing was saved, so saying so is the truth', async () => {
    const { killTransaction, req } = fakeRequest()

    queue.mockImplementation((): Promise<EnqueueOutcome> => {
      killTransaction()

      return Promise.resolve({ outcome: 'error', reason: 'connection reset' })
    })

    await expect(run(req)).rejects.toThrow(/not saved.*connection reset.*Save it again/)
    expect(reported).toHaveBeenCalledWith(
      expect.any(Error),
      'orders.fulfilmentEmail',
      expect.objectContaining({ orderId: 42, rolledBack: true }),
    )
  })

  it('…and the message it throws is public, so the admin shows it instead of a generic error', async () => {
    const { killTransaction, req } = fakeRequest()

    queue.mockImplementation(() => {
      killTransaction()

      return Promise.resolve({ outcome: 'error', reason: 'x' })
    })

    const error = await run(req).then(
      () => null,
      (thrown: unknown) => thrown,
    )

    expect(error).toMatchObject({ isPublic: true })
  })

  it('reports a refusal that left the transaction standing, and lets the transition stand', async () => {
    const { payload, req } = fakeRequest()

    queue.mockResolvedValue({ outcome: 'error', reason: 'The order has no address to send to.' })

    await expect(run(req)).resolves.toBe(ORDER)
    expect(payload.logger.error).toHaveBeenCalledTimes(1)
    expect(reported).toHaveBeenCalledWith(
      expect.any(Error),
      'orders.fulfilmentEmail',
      expect.objectContaining({ orderId: 42 }),
    )
  })

  it('reports a queue call that threw without ending the transaction', async () => {
    const { req } = fakeRequest()

    queue.mockRejectedValue(new Error('render failed'))

    await expect(run(req)).resolves.toBe(ORDER)
    expect(reported).toHaveBeenCalledTimes(1)
  })

  it('does not insert a message whose dedupe key is already queued — the refused insert would end the transaction', async () => {
    const { payload, req } = fakeRequest(1)

    await expect(run(req)).resolves.toBe(ORDER)
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'email-messages',
        req,
        where: { dedupeKey: { equals: 'order-shipped:42' } },
      }),
    )
    expect(queue).not.toHaveBeenCalled()
  })

  it('does nothing when the fulfilment status did not change', async () => {
    const { payload, req } = fakeRequest()

    await expect(run(req, 'shipped')).resolves.toBe(ORDER)
    expect(payload.find).not.toHaveBeenCalled()
    expect(queue).not.toHaveBeenCalled()
  })

  it('queues the delivered message for shipped → delivered', async () => {
    const { req } = fakeRequest()
    const delivered = { ...ORDER, fulfillmentStatus: 'delivered' }

    queue.mockResolvedValue({ id: 2, outcome: 'claimed' })

    await expect(run(req, 'shipped', delivered)).resolves.toBe(delivered)
    expect(queue).toHaveBeenCalledWith(req.payload, delivered, 'orderDelivered', req)
  })
})
