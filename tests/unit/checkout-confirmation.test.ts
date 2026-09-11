import { describe, expect, it } from 'vitest'

import { CONFIRMATION_UNREADABLE, confirmationCopy } from '@/lib/checkout/confirmation-copy'
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

  it('gives every status its own label, so the summary row cannot contradict the heading', () => {
    const labels = new Set(ALL.map((status) => confirmationCopy(status).statusLabel))

    /* draft and checkout_started share "Not completed"; every other status is distinct. */
    expect(labels.size).toBe(ALL.length - 1)
  })
})

describe('CONFIRMATION_UNREADABLE — the database, not the order, is missing', () => {
  it('does not tell a customer who may have paid that their order could not be found', () => {
    expect(`${CONFIRMATION_UNREADABLE.title} ${CONFIRMATION_UNREADABLE.body}`).not.toMatch(
      /could not find|not found|different account/i,
    )
  })
})
