import type { Metadata } from 'next'

import { CartLineRow } from '@/components/cart/cart-lines'
import { CartSummary } from '@/components/cart/cart-summary'
import { ProductCard } from '@/components/catalog/product-card'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section, SectionHeading } from '@/components/layout/section'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'
import { getCustomer } from '@/lib/auth/session'
import { getCart, hasSignedOutBag } from '@/lib/cart/cart'
import { CART_COPY } from '@/lib/cart/rules'
import { CATALOG_IMAGE_SIZES } from '@/lib/catalog/sizes'
import { privateMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = privateMetadata('Your bag')

/**
 * **`/cart` — the full bag page**, which the Phase 14 prompt asks for beside the drawer.
 *
 * The drawer is for *"did that go in?"* and this is for *"what am I actually buying?"* — same lines,
 * same server-computed totals, more room. Both render `CartLineRow` and `CartSummary`, so there is
 * exactly one implementation of a bag line and one of a subtotal; a second copy is how a drawer and a
 * page come to disagree about the same cart, which is the bug §14.1e's *"multiple tabs"* edge case is
 * really about.
 *
 * **Dynamic, and unavoidably so.** The bag is per-session: it reads the cart cookie and the customer
 * session, both of which make the route dynamic by construction. There is no `export const dynamic`
 * because a directive restating what the code already forces is one more thing that can fall out of
 * step with it — the same reasoning `/shop` records.
 *
 * **No Checkout button.** Checkout is Phase 17. See **DEV-57**: the bag page states what happens next
 * in a sentence rather than offering a control that leads nowhere.
 *
 * **`noindex`, from Phase 24.** §24.1c excludes the cart by name, and a crawler that indexed this
 * page would index an empty bag, forever, under a title promising otherwise.
 */
export default async function CartPage() {
  const customer = await getCustomer()
  const cart = await getCart(customer?.id ?? null)
  const lines = cart?.lines ?? []
  /* Plan §31.1f: the bag is saved, the session is not — see `hasSignedOutBag`. */
  const signedOutBag = !customer && !cart ? await hasSignedOutBag() : false

  return (
    <>
      <Section spacing="tight">
        <PageContainer>
          <PageTitle eyebrow="Bag">
            {lines.length === 0 ? 'Your bag' : `Your bag (${cart?.totals.itemCount ?? 0})`}
          </PageTitle>
        </PageContainer>
      </Section>

      <Section spacing="tight">
        <PageContainer>
          {signedOutBag ? (
            <div className="flex flex-col items-start gap-m">
              <p className="font-display text-heading-m text-foreground">Your session has ended.</p>

              <p className="max-w-measure font-sans text-body text-foreground-muted">
                Sign in to see your bag — everything in it is saved.
              </p>

              <Button asChild className="mt-m">
                <Link href="/login?next=%2Fcart" variant="unstyled">
                  Sign in
                </Link>
              </Button>
            </div>
          ) : lines.length === 0 || !cart ? (
            <div className="flex flex-col items-start gap-m">
              <p className="font-display text-heading-m text-foreground">{CART_COPY.empty}</p>

              <p className="max-w-measure font-sans text-body text-foreground-muted">
                {CART_COPY.emptyDetail}
              </p>

              <Button asChild className="mt-m">
                <Link href="/shop" variant="unstyled">
                  Start shopping
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-l lg:grid-cols-12">
              {/*
                `grid-cols-1` is `minmax(0, 1fr)`, and that is the fix. An implicit single track sizes
                to its items' min-content, so at 320px the summary's discount row (315px) widened a
                280px container and the whole bag scrolled sideways — a phone renders that page
                zoomed out.
              */}
              <div className="lg:col-span-7">
                {cart.drifted ? (
                  <p
                    className="mb-m rounded-sm border border-border bg-surface px-m py-3 font-sans text-body-sm text-foreground-muted"
                    role="status"
                  >
                    {CART_COPY.revalidated}
                  </p>
                ) : null}

                {lines.some((line) => line.priceChangedFromLabel) ? (
                  <p
                    className="mb-m rounded-sm border border-border bg-surface px-m py-3 font-sans text-body-sm text-foreground-muted"
                    role="status"
                  >
                    {CART_COPY.priceChanged}
                  </p>
                ) : null}

                <ul className="divide-y divide-border border-y border-border">
                  {lines.map((line) => (
                    <CartLineRow currency={cart.currency} key={line.id} line={line} />
                  ))}
                </ul>
              </div>

              <div className="lg:col-span-5 lg:pl-l">
                <div className="flex flex-col gap-m lg:sticky lg:top-24">
                  <CartSummary
                    currency={cart.currency}
                    discount={cart.discount}
                    locale={cart.locale}
                    shipping={cart.shipping}
                    shippingQuote={cart.shippingQuote}
                    showDiscountForm
                    tax={cart.tax}
                    totals={cart.totals}
                  />

                  {/*
                    **DEV-57 paid.** Phase 14 put a sentence here because `/checkout` did not exist;
                    it does now. The button is a link rather than a form because checkout is a page,
                    not a mutation — the mutation is on that page, after the customer has told us
                    where the parcel is going.
                  */}
                  <Button asChild size="lg">
                    <Link href="/checkout" variant="unstyled">
                      Checkout
                    </Link>
                  </Button>

                  <Link href="/shop" variant="meta">
                    Continue shopping
                  </Link>
                </div>
              </div>
            </div>
          )}
        </PageContainer>
      </Section>

      {cart && cart.recommendations.length > 0 ? (
        <Section divider="top" spacing="tight">
          <PageContainer>
            <SectionHeading className="mb-l">
              {lines.length === 0 ? 'Start here' : 'You may also like'}
            </SectionHeading>

            <ul className="grid grid-cols-2 gap-x-m gap-y-l lg:grid-cols-4">
              {cart.recommendations.map((card) => (
                <li key={card.id}>
                  <ProductCard card={card} sizes={CATALOG_IMAGE_SIZES.productCardGrid} />
                </li>
              ))}
            </ul>
          </PageContainer>
        </Section>
      ) : null}
    </>
  )
}
