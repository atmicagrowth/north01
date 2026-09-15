import { describe, expect, it } from 'vitest'

import {
  CONFIRMATION_UNREADABLE,
  confirmationCopy,
  stripeLineItemDescription,
} from '@/lib/checkout/confirmation-copy'
import type { PaymentStatus } from '@/lib/checkout/rules'

/**
 * **Plan §31.1f — the success page says what actually happened.**
 *
 * The page used to have one branch: paid, or "Confirming your payment … we will email you either
 * way" — which a declined, abandoned or never-sent order also received. These are business-critical
 * sentences: the one wrong answer tells a customer money was taken, or that an email is coming, when
 * neither is true.
 */
const ALL: PaymentStatus[] = [
  'cancelled',
  'checkout_started',
  'draft',
  'paid',
  'payment_failed',
  'pending_payment',
  'refunded',
]

describe('confirmationCopy — one sentence per payment status', () => {
  it('thanks the customer only when the webhook has marked the order paid', () => {
    expect(confirmationCopy('paid').title).toBe('Thank you')

    for (const status of ALL.filter((s) => s !== 'paid')) {
      expect(confirmationCopy(status).title).not.toBe('Thank you')
    }
  })

  it('promises an email only for a payment Stripe is still confirming, because no other status sends one', () => {
    expect(confirmationCopy('pending_payment').promisesEmail).toBe(true)

    for (const status of ALL.filter((s) => s !== 'pending_payment')) {
      expect(confirmationCopy(status).promisesEmail).toBe(false)
      expect(confirmationCopy(status).body).not.toMatch(/email/i)
    }
  })

  it('promises the pending customer an email only once the payment is confirmed, never "either way"', () => {
    const { body } = confirmationCopy('pending_payment')

    /*
     * Sweep 1, S07: a bank debit can stay pending for days and then fail, and a failed payment or an
     * expired session sends no email at all. The copy may promise the confirmation and nothing else.
     */
    expect(body).not.toMatch(/either way/i)
    expect(body).toMatch(/email you once it is confirmed/i)
    expect(body).toMatch(/if it does not go through, no email is sent/i)
    expect(body).toMatch(/can take a few days/i)
  })

  it('says a refund is on its way back rather than already returned — the bank decides when it lands', () => {
    const { body } = confirmationCopy('refunded')

    expect(body).toMatch(/on its way back/i)
    expect(body).not.toMatch(/has been returned/i)
  })

  it('tells a customer whose card was declined that nothing was charged, and offers the bag back', () => {
    const copy = confirmationCopy('payment_failed')

    expect(copy.body).toMatch(/nothing was charged/i)
    expect(copy.offerBag).toBe(true)
    expect(copy.statusLabel).toBe('Payment failed')
  })

  it('calls an abandoned, cancelled or never-sent checkout "not completed", with no payment taken', () => {
    for (const status of ['cancelled', 'checkout_started', 'draft'] as const) {
      const copy = confirmationCopy(status)

      expect(copy.title).toBe('This order was not completed')
      expect(copy.body).toMatch(/no payment was taken/i)
      expect(copy.offerBag).toBe(true)
    }
  })

  it('never says "confirming" about anything but a pending payment', () => {
    for (const status of ALL.filter((s) => s !== 'pending_payment')) {
      expect(`${confirmationCopy(status).title} ${confirmationCopy(status).body}`).not.toMatch(
        /confirming|being confirmed/i,
      )
    }
  })

  it('confirms the payment of an order held for a stock shortfall without promising it is on its way', () => {
    const held = confirmationCopy('paid', { onHold: true })

    expect(held.title).toBe('Thank you')
    expect(held.body).toMatch(/payment has been confirmed/i)
    expect(held.body).toMatch(/sold out/i)
    expect(held.body).not.toMatch(/is with us|on its way/i)
    expect(confirmationCopy('paid').body).toBe(
      'Your payment has been confirmed and your order is with us.',
    )
  })

  it('gives every status its own label, so the summary row cannot contradict the heading', () => {
    const labels = new Set(ALL.map((status) => confirmationCopy(status).statusLabel))

    /* draft and checkout_started share "Not completed"; every other status is distinct. */
    expect(labels.size).toBe(ALL.length - 1)
  })
})

describe('stripeLineItemDescription — what Stripe prints under the one line item', () => {
  const totals = (discountMinor: number, shippingMinor: number, taxMinor: number) => ({
    discountMinor,
    shippingMinor,
    taxMinor,
  })

  it('names delivery and tax only when each is actually in the total', () => {
    expect(stripeLineItemDescription(totals(0, 1_200, 840))).toBe('Includes delivery and tax.')
    expect(stripeLineItemDescription(totals(0, 1_200, 0))).toBe('Includes delivery.')
    expect(stripeLineItemDescription(totals(0, 0, 840))).toBe('Includes tax.')
  })

  it('does not claim delivery and tax for a discount alone — sweep 1, S15', () => {
    /* A $200 bag with a 10% code, free Standard delivery and no tax: the total differs from the subtotal. */
    expect(stripeLineItemDescription(totals(2_000, 0, 0))).toBe('Discount applied.')
    expect(stripeLineItemDescription(totals(2_000, 1_200, 840))).toBe(
      'Includes delivery and tax. Discount applied.',
    )
  })

  it('says nothing at all when the total is the goods alone, so no empty description reaches Stripe', () => {
    expect(stripeLineItemDescription(totals(0, 0, 0))).toBeNull()
  })

  /*
   * The reference is `session.ts`'s to add, and it adds the customer-facing order number in front of
   * this sentence (`checkout-session.test.ts`). This sentence carries none, so it can never leak the
   * database id — a number the customer cannot match to anything.
   */
  it('carries no order reference of its own — session.ts puts the customer-facing order number in front', () => {
    for (const [d, s, t] of [
      [0, 0, 0],
      [1, 1, 1],
      [0, 1_200, 0],
      [2_000, 0, 840],
    ] as const) {
      expect(stripeLineItemDescription(totals(d, s, t)) ?? '').not.toMatch(/order|\d/i)
    }
  })
})

describe('CONFIRMATION_UNREADABLE — the database, not the order, is missing', () => {
  it('does not tell a customer who may have paid that their order could not be found', () => {
    expect(`${CONFIRMATION_UNREADABLE.title} ${CONFIRMATION_UNREADABLE.body}`).not.toMatch(
      /could not find|not found|different account/i,
    )
  })
})
