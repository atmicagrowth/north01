'use client'

import { useActionState, useId } from 'react'

import { Button } from '@/components/ui/button'
import { CHECKOUT_ACTION_IDLE } from '@/lib/checkout/action-state'
import { startCheckoutAction } from '@/lib/checkout/actions'
import type { ShippingRate } from '@/lib/shipping/rules'
import { cn } from '@/lib/cn'
import { formatMinorUnits } from '@/lib/money'
import type { CurrencyCode } from '@/payload/fields/money'

/**
 * **Structure §14's checkout form**: customer information, shipping, shipping method — then Stripe.
 *
 * > Cart → Checkout preflight → Customer information → Shipping → Shipping method → Payment → Stripe
 *
 * One page rather than a wizard, because §... the structure document lists steps, not screens, and a
 * four-screen flow for six fields is the *"unnecessary steps before checkout"* §13 warns against.
 *
 * ### The delivery options shown are real, and the server still decides
 *
 * A rate's **price** comes from the cart and its **eligibility** from the destination, which nobody
 * has typed yet — the distinction Phase 16 was built around. So the options here are the ones that
 * exist, priced correctly, and a customer in a country where one of them cannot run is told at
 * preflight rather than being shown three options that silently become two.
 *
 * That is a deliberate trade and the alternative is worse: re-quoting on every keystroke of a country
 * field would either flicker the options as somebody types "United Kingdom", or require a country
 * `<select>` and a round trip before the form is usable. The server re-quotes with the real address
 * and refuses with a reason — `validateSelectedRate` exists for exactly this call.
 *
 * ### No card fields, and none coming
 *
 * Payment happens on Stripe's page. Nothing in this form touches a card number, which is why this
 * integration has no PCI surface at all and why `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is unused.
 */
export function CheckoutForm({
  currency,
  defaultEmail,
  locale,
  rates,
}: {
  currency: CurrencyCode
  /** Pre-filled for a signed-in customer. A guest types it. */
  defaultEmail: string
  locale: string
  rates: ShippingRate[]
}) {
  const [state, action, pending] = useActionState(startCheckoutAction, CHECKOUT_ACTION_IDLE)
  const id = useId()

  const money = (minor: number) =>
    minor === 0 ? 'Free' : (formatMinorUnits(minor, currency, locale) ?? '—')

  const field = cn(
    'h-11 w-full rounded-sm border border-border-control bg-transparent px-3',
    /* 16px, not 14: iOS Safari zooms the whole page on focus of any smaller input. */
    'font-sans text-body text-foreground placeholder:text-foreground-disabled',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong',
  )

  const label = 'font-sans text-meta uppercase text-foreground-muted'

  return (
    <form action={action} className="flex flex-col gap-l" data-slot="checkout-form">
      <section className="flex flex-col gap-s">
        <h2 className="font-display text-heading-s text-foreground">Contact</h2>

        <div className="flex flex-col gap-2">
          <label className={label} htmlFor={`${id}-email`}>
            Email
          </label>
          <input
            autoComplete="email"
            className={field}
            defaultValue={defaultEmail}
            id={`${id}-email`}
            name="email"
            required
            type="email"
          />
        </div>
      </section>

      <section className="flex flex-col gap-s">
        <h2 className="font-display text-heading-s text-foreground">Delivery address</h2>

        <div className="grid gap-s sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className={label} htmlFor={`${id}-first`}>
              First name
            </label>
            <input
              autoComplete="given-name"
              className={field}
              id={`${id}-first`}
              name="firstName"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className={label} htmlFor={`${id}-last`}>
              Last name
            </label>
            <input
              autoComplete="family-name"
              className={field}
              id={`${id}-last`}
              name="lastName"
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={label} htmlFor={`${id}-line1`}>
            Address
          </label>
          <input
            autoComplete="address-line1"
            className={field}
            id={`${id}-line1`}
            name="line1"
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className={label} htmlFor={`${id}-line2`}>
            Apartment, suite, etc. <span className="normal-case">(optional)</span>
          </label>
          <input autoComplete="address-line2" className={field} id={`${id}-line2`} name="line2" />
        </div>

        <div className="grid gap-s sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <label className={label} htmlFor={`${id}-city`}>
              City
            </label>
            <input
              autoComplete="address-level2"
              className={field}
              id={`${id}-city`}
              name="city"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className={label} htmlFor={`${id}-region`}>
              State / county
            </label>
            <input
              autoComplete="address-level1"
              className={field}
              id={`${id}-region`}
              name="region"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className={label} htmlFor={`${id}-postal`}>
              Postcode
            </label>
            <input
              autoComplete="postal-code"
              className={field}
              id={`${id}-postal`}
              name="postalCode"
              required
            />
          </div>
        </div>

        <div className="grid gap-s sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className={label} htmlFor={`${id}-country`}>
              Country
            </label>
            {/*
              Two letters, uppercased by the server. A free-text country name would need a mapping
              from every spelling of "United Kingdom" to `GB`, and getting it wrong means quoting
              delivery for the wrong place. The placeholder says what is wanted.
            */}
            <input
              autoComplete="country"
              className={cn(field, 'uppercase')}
              id={`${id}-country`}
              maxLength={2}
              name="country"
              placeholder="US"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className={label} htmlFor={`${id}-phone`}>
              Phone <span className="normal-case">(optional)</span>
            </label>
            <input
              autoComplete="tel"
              className={field}
              id={`${id}-phone`}
              name="phone"
              type="tel"
            />
          </div>
        </div>
      </section>

      <fieldset className="flex flex-col gap-s">
        <legend className="mb-s font-display text-heading-s text-foreground">Delivery</legend>

        <div className="flex flex-col gap-2">
          {rates.map((rate, index) => (
            <label
              className={cn(
                'flex cursor-pointer items-center justify-between gap-s rounded-sm border px-3 py-3',
                'border-border-control font-sans text-body-sm text-foreground',
                'has-[:checked]:border-border-strong',
              )}
              key={rate.id}
            >
              <span className="flex items-center gap-s">
                <input
                  defaultChecked={index === 0}
                  name="shippingMethod"
                  type="radio"
                  value={rate.id}
                />
                <span>
                  {rate.name}
                  <span className="block text-meta text-foreground-muted">{rate.estimate}</span>
                </span>
              </span>

              <span>{money(rate.amountMinor)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.error ? (
        <p className="font-sans text-body-sm text-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button size="lg" type="submit">
        {pending ? 'Taking you to payment…' : 'Continue to payment'}
      </Button>

      <p className="font-sans text-meta text-foreground-muted">
        Payment is handled by Stripe. Card details are never sent to this site.
      </p>
    </form>
  )
}
