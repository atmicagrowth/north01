import type { Metadata } from 'next'

import { redirect } from 'next/navigation'

import { TrackOnMount } from '@/components/analytics/trackers'
import { variantLabel } from '@/lib/analytics/items'
import { CartSummary } from '@/components/cart/cart-summary'
import { CheckoutForm } from '@/components/checkout/checkout-form'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { Link } from '@/components/ui/link'
import { getCustomer } from '@/lib/auth/session'
import { getCart } from '@/lib/cart/cart'
import { isStripeConfigured } from '@/lib/checkout/stripe'
import { getCatalogSettings } from '@/lib/catalog/catalog'
import { shippingProvider } from '@/lib/shipping/provider'
import { privateMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = privateMetadata('Checkout')

/**
 * **`/checkout`** — structure §14's *"Customer information → Shipping → Shipping method"*, before the
 * handoff to Stripe for payment.
 *
 * ### An empty bag cannot check out, and says so by going back
 *
 * A redirect rather than an empty-state page: there is nothing to decide here without a bag, and a
 * checkout form for nothing is a form whose submit button can only fail.
 *
 * ### Stripe unconfigured is a visible, honest state
 *
 * `docs/ARCHITECTURE.md` §2 requires the store to work when an integration is missing, and this
 * repository has no Stripe keys. So the page renders the bag and says payment is unavailable, rather
 * than showing a form whose only outcome is a refusal at the last step. That is the same decision
 * Phase 13 made about Add to Bag and Phase 14 about Checkout — **DEV-62**.
 *
 * **`noindex`, from Phase 24.** §24.1c excludes checkout by name; it is application state, not a
 * document.
 */
export default async function CheckoutPage() {
  const customer = await getCustomer()
  const cart = await getCart(customer?.id ?? null)

  if (!cart || cart.lines.length === 0) {
    redirect('/cart')
  }

  const settings = await getCatalogSettings()

  /*
   * Quoted without a destination — nobody has typed one. The prices are right and the eligibility is
   * unknown, which is exactly what `destinationKnown: false` means and why preflight re-quotes with
   * the real address before anything is charged.
   */
  const quote = await shippingProvider.quote({
    currency: cart.currency,
    destination: null,
    discountMinor: cart.totals.discountMinor ?? 0,
    freeShippingPromotion:
      cart.discount?.result.reason === null && cart.discount.result.freeShipping,
    freeShippingThresholdMinor: settings.freeShippingThresholdMinor,
    subtotalMinor: cart.totals.subtotalMinor,
  })

  const configured = isStripeConfigured()

  return (
    <>
      {/*
        **§25.1a's `begin_checkout`.** Reaching this page **is** the beginning of checkout, which is
        why it is a mount rather than a click: the customer arrives here from the bag, the drawer or
        a direct link, and all three are the same event.

        The value is the bag's `totalMinor` — the sum of what is *known*. Shipping and tax are
        quoted without a destination at this point, so they are deliberately not sent: a shipping
        figure that has not been quoted against an address is a guess, and §25.1a's payloads treat
        unknown as absent rather than as zero.
      */}
      <TrackOnMount
        event="begin_checkout"
        payload={{
          currency: cart.currency,
          items: cart.lines.map((line) => ({
            itemId: String(line.productId),
            itemName: line.productName,
            priceMinor: line.unitPriceMinor,
            quantity: line.effectiveQuantity,
            variant: variantLabel(line.color, line.size),
          })),
          valueMinor: cart.totals.totalMinor,
        }}
      />

      <Section spacing="tight">
        <PageContainer>
          <PageTitle eyebrow="Checkout">Checkout</PageTitle>
        </PageContainer>
      </Section>

      <Section spacing="tight">
        <PageContainer>
          <div className="grid gap-l lg:grid-cols-12">
            <div className="lg:col-span-7">
              {configured ? (
                <CheckoutForm
                  currency={cart.currency}
                  defaultEmail={customer?.email ?? ''}
                  locale={cart.locale}
                  rates={quote.rates.filter((rate) => rate.eligible)}
                />
              ) : (
                <div className="flex flex-col gap-m" data-slot="checkout-unavailable">
                  <p className="font-display text-heading-s text-foreground">
                    Payment is not connected yet.
                  </p>

                  <p className="max-w-measure font-sans text-body text-foreground-muted">
                    Everything in your bag is real — the prices, the sizes and the stock are live.
                    Card payment is the last piece and it is not switched on for this environment.
                  </p>

                  <Link href="/cart" variant="meta">
                    Back to your bag
                  </Link>
                </div>
              )}
            </div>

            <div className="lg:col-span-5 lg:pl-l">
              <div className="lg:sticky lg:top-24">
                <CartSummary
                  currency={cart.currency}
                  discount={cart.discount}
                  locale={cart.locale}
                  shipping={cart.shipping}
                  shippingQuote={cart.shippingQuote}
                  tax={cart.tax}
                  totals={cart.totals}
                />
              </div>
            </div>
          </div>
        </PageContainer>
      </Section>
    </>
  )
}
