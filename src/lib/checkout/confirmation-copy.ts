import type { PaymentStatus } from '@/lib/checkout/rules'
import { STOCK_SHORTFALL_COPY } from '@/lib/orders/rules'

/**
 * **Plan §31.1f — what the success page says, by what actually happened.**
 *
 * The page had one branch: paid, or *"Confirming your payment… we will email you either way"*. That
 * sentence was meant for exactly one status, `pending_payment`, where Stripe has the payment and the
 * webhook has not landed yet. It was also shown for an order whose card was declined, one whose
 * checkout was abandoned, and one never sent to Stripe at all — telling each of those customers that
 * money was being confirmed and an email was coming, when neither was true. Sweep 1 (S07) then found
 * it untrue even there: *either way* promised an email for a payment that goes on to fail, and none is
 * sent. The pending copy now promises the confirmation only.
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
  /**
   * Whether the body mentions an email. Only a pending payment's may: the order confirmation, queued
   * when the webhook marks the order paid, is the one message that can still follow. Even there it is
   * promised **only once the payment is confirmed** — a payment that later fails, or a session that
   * expires, sends nothing, because `EMAIL_KINDS` has no such message (DEV-65).
   */
  promisesEmail: boolean
  statusLabel: string
  title: string
}

/**
 * `onHold` is the order's `fulfilmentHold` (Phase 36, R3-19): paid, but the stock was not there. The
 * payment is still confirmed — it happened — and the body stops short of implying the parcel is
 * being prepared.
 */
export function confirmationCopy(
  status: PaymentStatus,
  options: { onHold?: boolean } = {},
): ConfirmationCopy {
  switch (status) {
    case 'paid':
      return {
        body: options.onHold
          ? `Your payment has been confirmed. ${STOCK_SHORTFALL_COPY.detail.replace(/^Paid\. /, '')}`
          : 'Your payment has been confirmed and your order is with us.',
        eyebrow: 'Order confirmed',
        offerBag: false,
        promisesEmail: false,
        statusLabel: 'Paid',
        title: 'Thank you',
      }

    case 'pending_payment':
      return {
        /*
         * Sweep 1, S07: this said "we will email you either way", and no email exists for a payment
         * that fails or a session that expires. The session sets no `payment_method_types`, so a bank
         * debit can sit in `pending_payment` for days — and then fail silently.
         */
        body: 'Your payment is being confirmed. A card payment usually takes a few seconds; some payment methods, such as bank debits, can take a few days. We will email you once it is confirmed. If it does not go through, no email is sent — refresh this page to see where it stands.',
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
        body: 'This order was refunded. The payment is on its way back to the original payment method.',
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
 * Nor may it say the confirmation is already on its way: a payment still clearing has not earned one
 * yet (sweep 1, S07).
 */
export const CONFIRMATION_UNREADABLE = {
  body: 'We can’t show your order right now. If you paid, your payment is safe, and we will email your confirmation once the payment is confirmed — refresh this page in a moment.',
  title: 'Your order can’t be shown right now',
} as const

/* -------------------------------------------------------------------------------------------------
 * What Stripe's payment page and receipt say — sweep 1, S15
 * ---------------------------------------------------------------------------------------------- */

/**
 * **The one line item's description**, which Stripe prints under the item on its payment page and on
 * the receipt it emails.
 *
 * DEV-63 keeps the whole bag as one line item priced at the order's own total, so this sentence is the
 * only place that page can say what the total is made of. It used to say *"Includes delivery and tax.
 * Order 57"* whenever the subtotal and the total differed — which a discount alone does, on an order
 * with free delivery and no tax — and it named the **database id**, a number the confirmation email,
 * the success page and the account never show, and one `formatOrderNumber` was chosen partly to keep
 * out of customers' hands.
 *
 * Now each part is named only when it is actually in the total: delivery when `shippingMinor` is
 * above zero, tax when `taxMinor` is, and a discount when `discountMinor` is. With none of them the
 * answer is `null`. The order reference is not this function's: `session.ts` puts the customer-facing
 * order number in front (`Order N1-YYMM-XXXXXX.`), so every session has a description
 * (`tests/unit/checkout-session.test.ts`).
 */
export function stripeLineItemDescription(totals: {
  discountMinor: number
  shippingMinor: number
  taxMinor: number
}): null | string {
  const included = [
    totals.shippingMinor > 0 ? 'delivery' : null,
    totals.taxMinor > 0 ? 'tax' : null,
  ].filter((part): part is string => part !== null)

  const sentences = [
    included.length > 0 ? `Includes ${included.join(' and ')}.` : null,
    totals.discountMinor > 0 ? 'Discount applied.' : null,
  ].filter((sentence): sentence is string => sentence !== null)

  return sentences.length > 0 ? sentences.join(' ') : null
}
