import type { PaymentStatus } from '@/lib/checkout/rules'

/**
 * **Plan §31.1f — what the success page says, by what actually happened.**
 *
 * The page had one branch: paid, or *"Confirming your payment… we will email you either way"*. That
 * sentence is right for exactly one status, `pending_payment`, where Stripe has the payment and the
 * webhook has not landed yet. It was also shown for an order whose card was declined, one whose
 * checkout was abandoned, and one never sent to Stripe at all — telling each of those customers that
 * money was being confirmed and an email was coming, when neither was true.
 *
 * Pure, so every status is asserted in `tests/unit/checkout-confirmation.test.ts` rather than by
 * reaching each one in a browser with a live Stripe account. Only a signature-verified webhook moves
 * an order to `paid` (plan §17.1d); this reads the status, it never decides it.
 */
export type ConfirmationCopy = {
  body: string
  eyebrow: string
  /** Offer the way back to the bag: the order did not complete and nothing was taken. */
  offerBag: boolean
  /** Only a pending payment is followed by an email — so only that copy may promise one. */
  promisesEmail: boolean
  statusLabel: string
  title: string
}

export function confirmationCopy(status: PaymentStatus): ConfirmationCopy {
  switch (status) {
    case 'paid':
      return {
        body: 'Your payment has been confirmed and your order is with us.',
        eyebrow: 'Order confirmed',
        offerBag: false,
        promisesEmail: false,
        statusLabel: 'Paid',
        title: 'Thank you',
      }

    case 'pending_payment':
      return {
        body: 'Your payment is being confirmed. This usually takes a few seconds — refresh this page, and we will email you either way.',
        eyebrow: 'Order received',
        offerBag: false,
        promisesEmail: true,
        statusLabel: 'Awaiting confirmation',
        title: 'Confirming your payment',
      }

    case 'payment_failed':
      return {
        body: 'Your payment did not go through, and nothing was charged. You can return to your bag and try again, or use a different card.',
        eyebrow: 'Payment not taken',
        offerBag: true,
        promisesEmail: false,
        statusLabel: 'Payment failed',
        title: 'Your payment did not go through',
      }

    case 'refunded':
      return {
        body: 'This order was refunded. The payment has been returned to the original payment method.',
        eyebrow: 'Order refunded',
        offerBag: false,
        promisesEmail: false,
        statusLabel: 'Refunded',
        title: 'This order was refunded',
      }

    case 'cancelled':
    case 'checkout_started':
    case 'draft':
      return {
        body: 'This order was not completed, and no payment was taken. You can return to your bag to try again.',
        eyebrow: 'Order not completed',
        offerBag: true,
        promisesEmail: false,
        statusLabel: status === 'cancelled' ? 'Cancelled' : 'Not completed',
        title: 'This order was not completed',
      }
  }
}

/**
 * The page's answer when the order cannot be READ — the database is unreachable, not the order
 * missing. It must not say "we could not find that order" to someone who may have just paid.
 */
export const CONFIRMATION_UNREADABLE = {
  body: 'We can’t show your order right now. If you paid, your payment is safe and your confirmation email is on its way — refresh this page in a moment.',
  title: 'Your order can’t be shown right now',
} as const
