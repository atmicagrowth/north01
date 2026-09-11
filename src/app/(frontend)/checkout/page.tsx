import type { Metadata } from 'next'

import { redirect } from 'next/navigation'

import { TrackOnMount } from '@/components/analytics/trackers'
import { variantLabel } from '@/lib/analytics/items'
import { CartSummary } from '@/components/cart/cart-summary'
import { CheckoutForm } from '@/components/checkout/checkout-form'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'
import { getCustomer } from '@/lib/auth/session'
import { CART_COPY } from '@/lib/cart/rules'
import { getCart, hasSignedOutBag } from '@/lib/cart/cart'
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
    /* Plan §31.1f: a session that ended mid-checkout is a sign-in, not an empty bag. */
    if (!cart && !customer && (await hasSignedOutBag())) {
      redirect('/login?next=%2Fcheckout&expired=1')
    }

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
      {/*
        Only where checkout can actually begin. With no Stripe keys this page is the
        payment-unavailable state, and a `begin_checkout` from it would fill the funnel with
        sessions that could never have paid.
      */}
      {configured ? (
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
      ) : null}

      <Section spacing="tight">
        <PageContainer>
          <PageTitle>Checkout</PageTitle>
        </PageContainer>
      </Section>

      <Section spacing="tight">
        <PageContainer>
          <div className="grid gap-l lg:grid-cols-12">
            <div className="lg:col-span-7">
              {/* Plan §31.1e, carried to the last page before payment: the price moved, and this is it. */}
              {cart.lines.some((line) => line.priceChangedFromLabel) ? (
                <p
                  className="mb-m rounded-sm border border-border bg-surface px-m py-3 font-sans text-body-sm text-foreground-muted"
                  role="status"
                >
                  {CART_COPY.priceChanged}
                </p>
              ) : null}

              {configured ? (
                <CheckoutForm
                  currency={cart.currency}
                  defaultEmail={customer?.email ?? ''}
                  locale={cart.locale}
                  rates={quote.rates.filter((rate) => rate.eligible)}
                />
              ) : (
                <div className="flex flex-col gap-m" data-slot="checkout-unavailable">
                  <p className="font-sans text-heading-s text-foreground">
                    Online checkout isn&rsquo;t open yet.
                  </p>

                  <p className="max-w-measure font-sans text-body text-foreground-muted">
                    We can&rsquo;t take payment right now. Your bag is saved, with its prices and
                    sizes.
                  </p>

                  {/*
                    A button, not a 17px text link: it is the only action on this screen, and a phone
                    user needs to be able to hit it. The same shape `checkout/cancelled` uses.
                  */}
                  <Button asChild className="self-start">
                    <Link href="/cart" variant="unstyled">
                      Back to your bag
                    </Link>
                  </Button>
                </div>
              )}

              {/*
                Beside the form in both states: the delivery and returns terms are what a customer
                checks last before paying, and leaving checkout to find them costs the bag its place.
              */}
              <div className="mt-l flex flex-wrap gap-m">
                <Link href="/help/shipping" variant="meta">
                  Shipping
                </Link>
                <Link href="/help/returns" variant="meta">
                  Returns
                </Link>
              </div>
            </div>

            <div className="lg:col-span-5 lg:pl-l">
              <div className="flex flex-col gap-m lg:sticky lg:top-24">
                {/*
                  What is being bought, read-only. The steppers stay on the bag: changing a quantity
                  here would re-quote under a form the customer is halfway through. Not
                  `data-slot="cart-line"` — that slot means an editable bag row to the e2e suite.
                */}
                <ul
                  aria-label="In your bag"
                  className="divide-y divide-border border-y border-border font-sans text-body-sm"
                  data-slot="checkout-lines"
                >
                  {cart.lines.map((line) => {
                    const variant = [line.color, line.size].filter(Boolean).join(' · ')

                    return (
                      <li className="flex items-start justify-between gap-s py-s" key={line.id}>
                        <div className="min-w-0">
                          <p className="text-foreground">{line.productName}</p>
                          <p className="text-meta uppercase text-foreground-muted">
                            {[variant, `× ${line.effectiveQuantity}`].filter(Boolean).join(' · ')}
                          </p>
                        </div>

                        <span className={line.unitPriceLabel ? 'text-foreground' : 'text-error'}>
                          {line.unitPriceLabel ?? CART_COPY.lineUnavailable}
                        </span>
                      </li>
                    )
                  })}
                </ul>

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
