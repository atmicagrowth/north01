import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCheckoutSession } from '@/lib/checkout/session'
import type { PreflightResult } from '@/lib/checkout/preflight'

/**
 * **What `createCheckoutSession` asks Stripe for** — sweep 1, S15, and the test gap its recheck found.
 *
 * `stripeLineItemDescription` is pinned in `checkout-confirmation.test.ts`, but nothing checked that
 * session creation used it: putting back the old *"Includes delivery and tax. Order 57"* template in
 * `session.ts` passed every unit test and harness, because none of them built the
 * `checkout.sessions.create` parameters. Here they are captured at the Stripe client boundary.
 *
 * What is pinned:
 *
 * 1. **The customer-facing order number is on Stripe's page and receipt** — the one the confirmation
 *    email, the success page and the account show — followed by what the total really includes. The
 *    database id is not in the description.
 * 2. **Nothing else moved**: one line item priced at the order's own total (DEV-63), the database id
 *    in both metadata blocks and the return URLs, and the claim made with preflight's `preparedAt`.
 *
 * The Stripe client, the Payload client, the claim and the environment are mocked at the module
 * boundaries `session.ts` imports; the function under test is the real one.
 */

const stripe = vi.hoisted(() => ({
  create: vi.fn(),
  expire: vi.fn(),
}))

const claimOrderForSession = vi.hoisted(() => vi.fn())

vi.mock('@/lib/checkout/stripe', () => ({
  stripeClient: () => ({
    checkout: { sessions: { create: stripe.create, expire: stripe.expire } },
  }),
}))

vi.mock('@/lib/checkout/pending-order', () => ({ claimOrderForSession }))

vi.mock('@/lib/payload', () => ({
  getPayloadClient: () => Promise.resolve({ logger: { error: vi.fn() } }),
}))

vi.mock('@/lib/env.server', () => ({ siteUrl: 'https://north01.example' }))

vi.mock('@/lib/observability/report', () => ({ reportFailure: vi.fn() }))

type Preflight = Extract<PreflightResult, { ok: true }>

/** A preflight result carrying only what session creation reads. */
const preflightWith = (totals: {
  discountMinor: number
  shippingMinor: number
  taxMinor: number
}): Preflight =>
  ({
    cart: { currency: 'USD', totals: { itemCount: 2 } },
    contact: { email: 'shopper@example.test' },
    ok: true,
    orderId: 4817,
    orderNumber: 'N1-2609-7K4QX2',
    preparedAt: '2026-09-14T12:00:00.000Z',
    totals: {
      ...totals,
      subtotalMinor: 20_000,
      totalMinor: 20_000 - totals.discountMinor + totals.shippingMinor + totals.taxMinor,
    },
  }) as unknown as Preflight

type SessionParams = {
  cancel_url: string
  line_items: {
    price_data: {
      currency: string
      product_data: { description?: string; name: string }
      unit_amount: number
    }
    quantity: number
  }[]
  metadata: Record<string, string>
  payment_intent_data: { metadata: Record<string, string> }
  success_url: string
}

const sentParams = (): SessionParams => stripe.create.mock.calls.at(-1)?.[0] as SessionParams

beforeEach(() => {
  stripe.create.mockReset().mockResolvedValue({ id: 'cs_test_s15', url: 'https://stripe.test/pay' })
  stripe.expire.mockReset().mockResolvedValue({})
  claimOrderForSession.mockReset().mockResolvedValue(true)
})

describe('createCheckoutSession — the order number on Stripe’s page and receipt (sweep 1, S15)', () => {
  it('starts the description with the customer-facing order number, then says what the total includes', async () => {
    const result = await createCheckoutSession(
      preflightWith({ discountMinor: 2_000, shippingMinor: 1_200, taxMinor: 840 }),
    )

    expect(result).toEqual({ ok: true, url: 'https://stripe.test/pay' })
    expect(sentParams().line_items[0]?.price_data.product_data.description).toBe(
      'Order N1-2609-7K4QX2. Includes delivery and tax. Discount applied.',
    )
  })

  it('still names the order when the total is the goods alone — every session carries its reference', async () => {
    await createCheckoutSession(preflightWith({ discountMinor: 0, shippingMinor: 0, taxMinor: 0 }))

    expect(sentParams().line_items[0]?.price_data.product_data.description).toBe(
      'Order N1-2609-7K4QX2.',
    )
  })

  it('never shows the database id to the customer, and never claims delivery or tax that is not charged', async () => {
    await createCheckoutSession(
      preflightWith({ discountMinor: 2_000, shippingMinor: 0, taxMinor: 0 }),
    )

    const description = sentParams().line_items[0]?.price_data.product_data.description ?? ''

    expect(description).not.toContain('4817')
    expect(description).not.toMatch(/delivery|tax/i)
  })
})

describe('createCheckoutSession — amounts, metadata and the claim are unchanged', () => {
  it('sends one line item priced at the order’s own total (DEV-63)', async () => {
    const preflight = preflightWith({ discountMinor: 2_000, shippingMinor: 1_200, taxMinor: 840 })

    await createCheckoutSession(preflight)

    const { line_items: lines } = sentParams()

    expect(lines).toHaveLength(1)
    expect(lines[0]?.quantity).toBe(1)
    expect(lines[0]?.price_data.unit_amount).toBe(preflight.totals.totalMinor)
    expect(lines[0]?.price_data.currency).toBe('usd')
    expect(lines[0]?.price_data.product_data.name).toBe('NORTH / 01 — 2 items')
  })

  it('keeps the database id as the webhook’s and the return pages’ reference', async () => {
    await createCheckoutSession(preflightWith({ discountMinor: 0, shippingMinor: 0, taxMinor: 0 }))

    const params = sentParams()

    expect(params.metadata).toEqual({ orderId: '4817' })
    expect(params.payment_intent_data.metadata).toEqual({ orderId: '4817' })
    expect(params.success_url).toBe('https://north01.example/checkout/success?order=4817')
    expect(params.cancel_url).toBe('https://north01.example/checkout/cancelled?order=4817')
  })

  it('records the session by the claim, against the preparation preflight returned', async () => {
    await createCheckoutSession(preflightWith({ discountMinor: 0, shippingMinor: 0, taxMinor: 0 }))

    expect(claimOrderForSession).toHaveBeenCalledWith(expect.anything(), {
      orderId: 4817,
      preparedAt: '2026-09-14T12:00:00.000Z',
      sessionId: 'cs_test_s15',
    })
    expect(stripe.expire).not.toHaveBeenCalled()
  })
})
