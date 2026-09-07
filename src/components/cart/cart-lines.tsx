'use client'

import { Minus, Plus, X } from 'lucide-react'
import { useActionState } from 'react'

import { MediaImage } from '@/components/media/media-image'
import { IconButton } from '@/components/ui/icon-button'
import { Link } from '@/components/ui/link'
import { CART_ACTION_IDLE } from '@/lib/cart/action-state'
import { removeLineAction, setQuantityAction } from '@/lib/cart/actions'
import type { CartLineView } from '@/lib/cart/cart'
import { CART_COPY } from '@/lib/cart/rules'
import { cn } from '@/lib/cn'

/**
 * **One line in the bag** — plan §14.1e's *"items, variant labels, quantity controls, remove"*.
 *
 * ### Every control is a form
 *
 * The stepper is two submit buttons and the remove control is a third, each posting a `lineId` and,
 * where relevant, the quantity it wants. Not one button with an `onClick`, for the reason
 * `add-to-bag.tsx` gives at greater length: a bag that only works with JavaScript is a bag that
 * silently does nothing on the request where the bundle failed.
 *
 * The quantity itself is **not** an editable field here. In the bag, `−` and `+` are the whole
 * vocabulary and a free-text box is a way to type 40 and be told no; the product page, where the
 * customer is deciding how many they want, is where a number input belongs.
 *
 * ### A line that cannot be bought is shown, not hidden
 *
 * §14.1e lists *"product becomes unavailable"* and *"quantity becomes unavailable"* as things the bag
 * must handle, and hiding the line handles neither — it removes the evidence. An unavailable line
 * keeps its photograph and its name, loses its price and its stepper, and says why. The customer
 * removes it themselves, or the next mutation does.
 *
 * ### Prices are read live, and that is why none are stored
 *
 * `CartItems.ts` stores no price precisely so that §14.1e's *"product price changed"* is visible
 * rather than frozen. The number beside a line is today's number, every time the page renders.
 */
export function CartLineRow({ compact = false, line }: { compact?: boolean; line: CartLineView }) {
  const buyable = line.maxQuantity > 0 && line.unitPriceMinor !== null

  /*
   * The EFFECTIVE quantity everywhere, not the stored one. They differ when stock fell under an open
   * bag, and rendering the stored number beside a subtotal computed from the effective one is a page
   * that contradicts itself — the defect Phase 14's first sweep found by dropping stock to 1 under a
   * line holding 2.
   */
  const shown = line.effectiveQuantity
  const reduced = line.effectiveQuantity < line.quantity
  const atCeiling = shown >= line.maxQuantity

  /*
   * **Only link to a product that can still be opened.**
   *
   * A line survives its product being unpublished — §14.1e wants the customer to see what happened —
   * but `/product/<slug>` 404s the moment `publishedProductWhere` stops matching it, because that
   * predicate is the single definition of *listable* and the route honours it. Linking anyway puts a
   * dead link inside the bag, which is the one place a shopper is least willing to be sent nowhere.
   *
   * Found in Phase 14's first sweep by unpublishing a product with an open bag holding it. The same
   * class of defect Phase 12's sweep found in the search panel, in a different component.
   */
  const linkable = line.productSlug !== '' && line.availability?.productPublished === true

  return (
    <li className="flex gap-m py-m" data-slot="cart-line" data-variant={line.variantId}>
      <div className={cn('shrink-0', compact ? 'w-20' : 'w-24')}>
        <MediaImage
          alt=""
          context="thumbnail"
          media={line.image}
          sizes={compact ? '80px' : '96px'}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-s">
          <div className="min-w-0">
            {linkable ? (
              <Link
                className="font-sans text-body-sm text-foreground"
                href={`/product/${line.productSlug}`}
                variant="unstyled"
              >
                {line.productName}
              </Link>
            ) : (
              <span className="font-sans text-body-sm text-foreground">{line.productName}</span>
            )}

            <p className="font-sans text-meta uppercase text-foreground-muted">
              {[line.color, line.size].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>

          <RemoveButton lineId={line.id} productName={line.productName} />
        </div>

        <div className="flex items-center justify-between gap-s">
          {buyable ? (
            <Stepper atCeiling={atCeiling} line={line} shown={shown} />
          ) : (
            <span className="font-sans text-body-sm text-error">{CART_COPY.lineUnavailable}</span>
          )}

          <span className="font-sans text-body-sm text-foreground">
            {line.unitPriceLabel ?? '—'}
          </span>
        </div>

        {buyable && reduced ? (
          <p className="font-sans text-meta text-foreground-muted">
            {`You asked for ${line.quantity}. Only ${line.maxQuantity} left, so that is what this line is for.`}
          </p>
        ) : buyable && atCeiling ? (
          <p className="font-sans text-meta text-foreground-muted">
            {`That is all we have — ${line.maxQuantity} in stock.`}
          </p>
        ) : null}
      </div>
    </li>
  )
}

/**
 * `−` and `+`, each a form of its own.
 *
 * Two forms rather than one with two submit buttons carrying different values: a `<button value>`
 * inside a shared form is only submitted when *that* button is the one that submitted, which is true
 * in every browser and not true of a keyboard `Enter` in a form with one text field. Two forms have
 * no ambiguity to get wrong.
 *
 * `−` at a quantity of one submits `0`, which the server treats as a removal. That is the behaviour a
 * stepper should have and it is the reason the action accepts zero at all.
 */
function Stepper({
  atCeiling,
  line,
  shown,
}: {
  atCeiling: boolean
  line: CartLineView
  /** The effective quantity — what the steppers move away from, so a reduced line steps from what it is. */
  shown: number
}) {
  const [state, action, pending] = useActionState(setQuantityAction, CART_ACTION_IDLE)

  return (
    <div className="flex items-center gap-1" data-slot="cart-stepper">
      <form action={action}>
        <input name="lineId" type="hidden" value={line.id} />
        <input name="quantity" type="hidden" value={shown - 1} />

        <IconButton
          label={shown === 1 ? `Remove ${line.productName}` : `One fewer ${line.productName}`}
          size="sm"
          type="submit"
          variant="ghost"
        >
          <Minus aria-hidden />
        </IconButton>
      </form>

      <span
        aria-live="polite"
        className="min-w-8 text-center font-sans text-body-sm text-foreground"
      >
        {pending ? '…' : shown}
      </span>

      <form action={action}>
        <input name="lineId" type="hidden" value={line.id} />
        <input name="quantity" type="hidden" value={shown + 1} />

        <IconButton
          /*
           * Genuinely `disabled`, unlike the size selector's `aria-disabled`. The reasoning does not
           * transfer: disabling a size would hide that the garment is made in it, whereas a `+` that
           * cannot go higher has no information to withhold — the reason is written beside it in
           * words. `aria-disabled` alone would leave a control that looks inert and still posts, and
           * the round trip would be spent only to be clamped back to where it started.
           */
          disabled={atCeiling}
          label={`One more ${line.productName}`}
          size="sm"
          type="submit"
          variant="ghost"
        >
          <Plus aria-hidden />
        </IconButton>
      </form>

      {state.notice ? (
        <span
          className={cn('font-sans text-meta', state.ok ? 'text-foreground-muted' : 'text-error')}
        >
          {state.notice}
        </span>
      ) : null}
    </div>
  )
}

function RemoveButton({ lineId, productName }: { lineId: number; productName: string }) {
  const [, action] = useActionState(removeLineAction, CART_ACTION_IDLE)

  return (
    <form action={action}>
      <input name="lineId" type="hidden" value={lineId} />

      <IconButton label={`Remove ${productName}`} size="sm" type="submit" variant="ghost">
        <X aria-hidden />
      </IconButton>
    </form>
  )
}
