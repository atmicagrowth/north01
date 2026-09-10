import type { Metadata } from 'next'

import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'
import { getCustomer } from '@/lib/auth/session'
import { readOrderForConfirmation } from '@/lib/checkout/confirmation'
import { formatMinorUnits } from '@/lib/money'
import { privateMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = privateMetadata('Order confirmed')

/**
 * **Plan §17.1g — the success URL, which is not evidence of anything.**
 *
 * > *"If the user closes the Stripe page, returns without paying, refreshes the success URL, opens
 * > the success URL directly, or pays successfully but the browser never reaches the success page —
 * > the order state must still come from webhook/payment state, not the browser."*
 *
 * And structure §15: *"The page should not be the only evidence that an order exists; the
 * webhook-backed order record is authoritative."*
 *
 * This page **reads the order and reports what it says**. It writes nothing, marks nothing paid, and
 * treats arriving here as meaning precisely nothing about whether money moved. All six of §17.1g's
 * cases collapse into one behaviour: look the order up, show its real state.
 *
 * ### Three outcomes, and the middle one is the interesting one
 *
 * - **Paid** — the webhook has been and gone. Order number, summary, total.
 * - **Not yet paid** — the customer arrived before the webhook did, which is common and not an error.
 *   Stripe redirects the browser immediately and delivers the event separately; a few seconds apart
 *   is normal. The page says the payment is being confirmed rather than claiming either outcome.
 * - **Not found, not theirs, or never existed** — one message for all three, because distinguishing
 *   them would turn the URL into a way to enumerate other people's orders.
 *
 * There is deliberately no polling. A pending confirmation resolves in seconds and a refresh is one
 * keystroke; an auto-refresher is a loop that never stops if the webhook never arrives.
 *
 * **`force-dynamic`.** Two customers must not share a cached confirmation, and an order that is now
 * paid must not keep saying pending.
 */
export const dynamic = 'force-dynamic'

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const customer = await getCustomer()
  const order = await readOrderForConfirmation(params.order, customer?.id ?? null)

  if (!order) {
    return (
      <Section spacing="tight">
        <PageContainer>
          <PageTitle eyebrow="Order">We could not find that order</PageTitle>

          <p className="mt-m max-w-measure font-sans text-body text-foreground-muted">
            The link may be old, or the order may belong to a different account. If you have just
            paid, your confirmation email is the record.
          </p>

          <Button asChild className="mt-l">
            <Link href="/shop" variant="unstyled">
              Continue shopping
            </Link>
          </Button>
        </PageContainer>
      </Section>
    )
  }

  const money = (minor: number) => formatMinorUnits(minor, order.currency, order.locale) ?? '—'
  const paid = order.paymentStatus === 'paid'

  return (
    <>
      <Section spacing="tight">
        <PageContainer>
          <PageTitle eyebrow={paid ? 'Order confirmed' : 'Order received'}>
            {paid ? 'Thank you' : 'Confirming your payment'}
          </PageTitle>

          <p className="mt-m max-w-measure font-sans text-body text-foreground-muted">
            {paid
              ? 'Your payment has been confirmed and your order is with us.'
              : 'Your payment is being confirmed. This usually takes a few seconds — refresh this page, and we will email you either way.'}
          </p>
        </PageContainer>
      </Section>

      <Section spacing="tight">
        <PageContainer>
          <dl
            className="flex flex-col gap-2 border-y border-border py-m font-sans text-body-sm"
            data-slot="order-summary"
          >
            <div className="flex items-baseline justify-between">
              <dt className="text-foreground-muted">Order number</dt>
              <dd className="text-foreground" data-slot="order-number">
                {order.orderNumber}
              </dd>
            </div>

            <div className="flex items-baseline justify-between">
              <dt className="text-foreground-muted">Status</dt>
              <dd className="text-foreground" data-slot="order-status">
                {paid ? 'Paid' : 'Awaiting confirmation'}
              </dd>
            </div>

            {order.lines.map((line) => (
              <div className="flex items-baseline justify-between" key={line.id}>
                <dt className="text-foreground-muted">
                  {line.productName}
                  <span className="text-foreground-disabled">
                    {` · ${line.variantLabel} · x${line.quantity}`}
                  </span>
                </dt>
                <dd className="text-foreground">{money(line.lineTotalMinor)}</dd>
              </div>
            ))}

            <div className="flex items-baseline justify-between border-t border-border pt-2">
              <dt className="text-foreground">Total</dt>
              <dd className="text-foreground" data-slot="order-total">
                {money(order.totalMinor)}
              </dd>
            </div>

            {order.shippingMethodLabel ? (
              <div className="flex items-baseline justify-between">
                <dt className="text-foreground-muted">Delivery</dt>
                <dd className="text-foreground">{order.shippingMethodLabel}</dd>
              </div>
            ) : null}
          </dl>

          <Button asChild className="mt-l">
            <Link href="/shop" variant="unstyled">
              Continue shopping
            </Link>
          </Button>
        </PageContainer>
      </Section>
    </>
  )
}
