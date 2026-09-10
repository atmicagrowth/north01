import type { Metadata } from 'next'

import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'
import { privateMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = privateMetadata('Checkout cancelled')

/**
 * **Plan §17.1g — the cancel URL.**
 *
 * > *"Closes the Stripe page. Returns without paying. … Opens cancel URL directly."*
 *
 * Three cases, indistinguishable from here, and the honest response to all three is the same: nothing
 * has been charged, the bag is untouched, here is the way back.
 *
 * **It writes nothing** — not even marking the order cancelled. Arriving at this URL does not mean
 * the customer abandoned the payment: they may have it open in a second tab, or a link preview may
 * have fetched it. Stripe sends `checkout.session.expired` when the session actually dies, and the
 * order's state comes from the webhook in this direction exactly as much as in the other.
 *
 * The bag is deliberately left as it was. A cancelled payment is a customer who has not decided, and
 * emptying their bag would be deciding for them.
 */
export default function CheckoutCancelledPage() {
  return (
    <Section spacing="tight">
      <PageContainer>
        <PageTitle eyebrow="Checkout">Nothing has been charged</PageTitle>

        <p className="mt-m max-w-measure font-sans text-body text-foreground-muted">
          Your payment was not completed and your bag is exactly as you left it. You can pick up
          where you stopped whenever you like.
        </p>

        <div className="mt-l flex flex-wrap gap-s">
          <Button asChild>
            <Link href="/cart" variant="unstyled">
              Back to your bag
            </Link>
          </Button>

          <Button asChild variant="secondary">
            <Link href="/shop" variant="unstyled">
              Continue shopping
            </Link>
          </Button>
        </div>
      </PageContainer>
    </Section>
  )
}
