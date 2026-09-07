import { DiscountForm } from '@/components/cart/discount-form'
import type { ResolvedPromotion } from '@/lib/promotions/promotions'
import { formatMinorUnits } from '@/lib/money'
import type { CartTotals } from '@/lib/cart/rules'
import type { ShippingProgress } from '@/lib/cart/rules'
import type { CurrencyCode } from '@/payload/fields/money'
import { cn } from '@/lib/cn'

/**
 * **Plan §14.1d's totals, and the two thirds of them this phase cannot honestly produce.**
 *
 * Subtotal, discount, shipping estimate, tax estimate, total. The subtotal is real: it is the sum of
 * live prices for lines that can actually be bought, computed on the server from the database.
 *
 * **Discount is real as of Phase 15**; shipping and tax are still **Phase 16**, and `cartTotals`
 * returns `null` for those two. `null` is not zero: a `£0.00` beside *Shipping* would be a number the
 * customer has every reason to believe and no way to check, which is plan §0.1.17's fake UI in its
 * most persuasive form. So those rows are not rendered at all, and the figure at the bottom is
 * labelled **Subtotal** rather than **Total**, with one sentence saying where the rest arrives.
 *
 * A discount of `null` means *no code applied* and draws no row; a discount of `0` means *a code is
 * applied and currently takes nothing off*, which draws one — because that is surprising and the
 * customer needs to see it.
 *
 * The Discount row appearing when Phase 15 landed is the first half of a claim Phase 14 made and
 * Phase 14's second sweep tested: when Phase 16 assigns the remaining two, `totals.isFinal` becomes
 * true and this component starts rendering their rows and the word *Total* — **without being
 * edited**. Half of it has now happened for real.
 *
 * ### The shipping-progress message is the exception, and it is legitimate
 *
 * §14.1e asks for it by name and `site-settings.freeShippingThresholdMinor` exists to drive it. It is
 * a comparison between the subtotal and an editor's number — not a rate for a destination — so it can
 * be true today. A threshold of zero means everything ships free, which is a shop's decision to make
 * and the bag simply says so.
 */
export function CartSummary({
  currency,
  discount,
  locale,
  shipping,
  showDiscountForm = false,
  totals,
}: {
  currency: CurrencyCode
  /** The applied code, decided against this bag on this read — Phase 15. */
  discount?: null | ResolvedPromotion
  locale: string
  shipping: null | ShippingProgress
  /**
   * Whether to offer the code field.
   *
   * The bag **page** offers it; the drawer does not. A drawer is a glance at what went in, and a text
   * field in it is a second place to type a code, a second place for it to fail, and a second
   * `aria-live` region competing with the first. An applied code is still *shown* in both, because
   * that is information rather than a control.
   */
  showDiscountForm?: boolean
  totals: CartTotals
}) {
  const money = (minor: number) => formatMinorUnits(minor, currency, locale) ?? '—'

  return (
    <div className="flex flex-col gap-s" data-slot="cart-summary">
      {shipping ? <ShippingProgressBar money={money} shipping={shipping} /> : null}

      <dl className="flex flex-col gap-2 border-t border-border pt-m font-sans text-body-sm">
        <div className="flex items-baseline justify-between">
          <dt className="text-foreground-muted">Subtotal</dt>
          <dd className="text-foreground" data-slot="cart-subtotal">
            {money(totals.subtotalMinor)}
          </dd>
        </div>

        {totals.discountMinor === null ? null : (
          <div className="flex items-baseline justify-between">
            <dt className="text-foreground-muted">Discount</dt>
            <dd className="text-foreground">{`−${money(totals.discountMinor)}`}</dd>
          </div>
        )}

        {totals.shippingMinor === null ? null : (
          <div className="flex items-baseline justify-between">
            <dt className="text-foreground-muted">Shipping</dt>
            <dd className="text-foreground">{money(totals.shippingMinor)}</dd>
          </div>
        )}

        {totals.taxMinor === null ? null : (
          <div className="flex items-baseline justify-between">
            <dt className="text-foreground-muted">Tax</dt>
            <dd className="text-foreground">{money(totals.taxMinor)}</dd>
          </div>
        )}

        {totals.isFinal ? (
          <div className="flex items-baseline justify-between border-t border-border pt-2">
            <dt className="text-foreground">Total</dt>
            <dd className="text-foreground">{money(totals.totalMinor)}</dd>
          </div>
        ) : null}
      </dl>

      {showDiscountForm || discount ? <DiscountForm discount={discount ?? null} /> : null}

      {totals.isFinal ? null : (
        <p className="font-sans text-meta text-foreground-muted">
          Delivery and any taxes are calculated at checkout.
        </p>
      )}
    </div>
  )
}

/**
 * *"You are £45 from free delivery."*
 *
 * The bar is `aria-hidden` and the sentence is not: a progress element announcing a percentage tells a
 * screen-reader user nothing they can act on, while the sentence contains the whole message. One
 * fact, rendered twice, in the register each audience reads.
 */
function ShippingProgressBar({
  money,
  shipping,
}: {
  money: (minor: number) => string
  shipping: ShippingProgress
}) {
  return (
    <div className="flex flex-col gap-2" data-slot="shipping-progress">
      <p
        className={cn(
          'font-sans text-body-sm',
          shipping.qualified ? 'text-foreground' : 'text-foreground-muted',
        )}
      >
        {shipping.qualified
          ? 'Standard delivery is free on this order.'
          : `${money(shipping.remainingMinor)} away from free standard delivery.`}
      </p>

      <div aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-surface">
        <div
          className="h-full bg-border-strong transition-[width] duration-(--duration-base) ease-editorial"
          style={{ width: `${Math.round(shipping.fraction * 100)}%` }}
        />
      </div>
    </div>
  )
}
