/**
 * **The failure that uses a message's last delivery attempt is reported** — the lost-side-effect review.
 *
 * The module under test is `deliverEmail` in `src/lib/email/send.ts`. A message is retried by the drain
 * until it has had `MAX_DELIVERY_ATTEMPTS` attempts; the failure that uses the last one leaves it
 * `failed` for good. That used to happen with no alert at all — and beside a webhook log line promising
 * that "the drain will retry it" — so a customer who never received a confirmation was nobody's problem.
 *
 * `scripts/verify-email.ts` sections H and I drive the retry ceiling against the real database. This file
 * needs none: a fake `Payload` whose conditional claim always succeeds, and a stub courier whose
 * transport refuses, so the only variable is how many attempts the row had already used.
 */

import type { Payload } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/observability/report', () => ({ reportFailure: vi.fn() }))
vi.mock('@/emails/messages', () => ({
  renderEmail: vi.fn(() => Promise.resolve({ html: '<p>Hello</p>', text: 'Hello' })),
}))
/* The claim's SQL is built and handed to the fake `execute`; nothing reads it. */
vi.mock('@payloadcms/db-postgres', () => ({ sql: () => ({}) }))

import { renderEmail } from '@/emails/messages'
import { deliverEmail, type Courier } from '@/lib/email/send'
import { MAX_DELIVERY_ATTEMPTS } from '@/lib/email/rules'
import { reportFailure } from '@/lib/observability/report'

const reported = vi.mocked(reportFailure)

function fakePayload(row: { attempts: number; data?: unknown; status?: string }) {
  return {
    db: { drizzle: { execute: vi.fn(() => Promise.resolve({ rowCount: 1 })) } },
    findByID: vi.fn(() =>
      Promise.resolve({
        attempts: row.attempts,
        data: 'data' in row ? row.data : { firstName: 'Ada' },
        dedupeKey: 'welcome:7',
        id: 11,
        kind: 'welcome',
        status: row.status ?? 'failed',
        subject: 'Welcome to NORTH / 01',
        to: 'ada@example.test',
      }),
    ),
    logger: { error: vi.fn() },
    update: vi.fn(() => Promise.resolve({})),
  } as unknown as Payload & { logger: { error: ReturnType<typeof vi.fn> } }
}

const refusingCourier = (): Courier => ({
  allowlist: [],
  appEnv: 'production',
  from: 'NORTH / 01 <orders@north01.test>',
  replyTo: null,
  transport: () => Promise.resolve({ error: 'The sending domain is not verified.', ok: false }),
})

beforeEach(() => {
  reported.mockClear()
})

describe('deliverEmail — the last attempt', () => {
  it.each(Array.from({ length: MAX_DELIVERY_ATTEMPTS - 1 }, (_, used) => used))(
    'does not report a failure with attempts left (%i already used)',
    async (used) => {
      const payload = fakePayload({ attempts: used })

      await expect(deliverEmail(payload, 11, refusingCourier())).resolves.toMatchObject({
        outcome: 'failed',
      })
      expect(reported).not.toHaveBeenCalled()
    },
  )

  it('**reports the provider refusal that uses the last attempt** — the message is failed for good', async () => {
    const payload = fakePayload({ attempts: MAX_DELIVERY_ATTEMPTS - 1 })

    await expect(deliverEmail(payload, 11, refusingCourier())).resolves.toEqual({
      outcome: 'failed',
      reason: 'The sending domain is not verified.',
    })
    expect(reported).toHaveBeenCalledTimes(1)
    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'email.deliveryExhausted', {
      attempts: MAX_DELIVERY_ATTEMPTS,
      kind: 'welcome',
      messageId: 11,
    })
    expect(payload.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringMatching(/will not be retried/) }),
    )
  })

  it('…and still records the failure on the row, exactly as before', async () => {
    const payload = fakePayload({ attempts: MAX_DELIVERY_ATTEMPTS - 1 })

    await deliverEmail(payload, 11, refusingCourier())

    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'email-messages',
        data: { error: 'The sending domain is not verified.', status: 'failed' },
        id: 11,
      }),
    )
  })

  it('reports a template that cannot render on the last attempt', async () => {
    vi.mocked(renderEmail).mockRejectedValueOnce(new Error('A template threw.'))

    const payload = fakePayload({ attempts: MAX_DELIVERY_ATTEMPTS - 1 })

    await expect(deliverEmail(payload, 11, refusingCourier())).resolves.toEqual({
      outcome: 'failed',
      reason: 'A template threw.',
    })
    expect(reported).toHaveBeenCalledWith(
      expect.any(Error),
      'email.deliveryExhausted',
      expect.objectContaining({ messageId: 11 }),
    )
  })

  it('reports a message whose data was not retained on the last attempt', async () => {
    const payload = fakePayload({ attempts: MAX_DELIVERY_ATTEMPTS - 1, data: null })

    await expect(deliverEmail(payload, 11, refusingCourier())).resolves.toEqual({
      outcome: 'failed',
      reason: 'notRenderable',
    })
    expect(reported).toHaveBeenCalledTimes(1)
  })

  it('reports nothing when the last attempt succeeds', async () => {
    const payload = fakePayload({ attempts: MAX_DELIVERY_ATTEMPTS - 1 })
    const courier = {
      ...refusingCourier(),
      transport: () => Promise.resolve({ id: 'msg_1', ok: true as const }),
    }

    await expect(deliverEmail(payload, 11, courier)).resolves.toEqual({ outcome: 'sent' })
    expect(reported).not.toHaveBeenCalled()
  })
})
