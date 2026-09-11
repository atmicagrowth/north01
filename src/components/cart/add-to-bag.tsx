'use client'

import { useActionState, useId, useRef, useState } from 'react'

import { useActionResult } from '@/components/analytics/use-action-result'
import { trackEvent } from '@/lib/analytics/track'
import type { AnalyticsItem } from '@/lib/analytics/events'

import { useShellOverlay } from '@/components/shell/overlay-context'
import { Button } from '@/components/ui/button'
import { CART_ACTION_IDLE } from '@/lib/cart/action-state'
import { addToBagAction } from '@/lib/cart/actions'
import { QUANTITY_HARD_CAP } from '@/lib/cart/rules'
import { cn } from '@/lib/cn'

/**
 * **Plan §13.1b's Quantity and Add to Bag**, which Phase 13 recorded as owed in **DEV-55** and this
 * phase pays.
 *
 * ### It is a `<form>`, and that is the load-bearing decision
 *
 * A button with an `onClick` that calls an action works, and it works only with JavaScript. A form
 * posting to a Server Action is submitted by the browser itself when the script has not arrived,
 * failed, or been switched off — so the one control on the site that turns browsing into buying keeps
 * working in the condition where every other approach quietly does nothing. `useActionState` upgrades
 * it in place once React is running: same markup, same action, no second code path.
 *
 * That is also why the quantity is an `<input type="number" name="quantity">` rather than component
 * state fed to a click handler. Without JavaScript it is still posted with the form.
 *
 * ### What the server is not told
 *
 * A variant id and a whole number. **No price, no product name, no availability.** Plan §13.1d's
 * *"never trust a client-submitted price"* is satisfied by there being nothing here to trust: the
 * server re-reads the variant, checks it is active, published and in stock, clamps the quantity
 * against live inventory and `maxQuantityPerLine`, and writes a line that stores no price at all.
 *
 * ### Disabled means *cannot be bought*, and only that
 *
 * The button is disabled when no size is chosen or the chosen combination is sold out, because in
 * both cases pressing it cannot succeed and saying so up front beats an error afterwards. It is
 * **not** disabled while the action is in flight, and `pending` changes the label instead.
 *
 * That is a deliberate trade rather than an oversight. Adding is **not idempotent** — an earlier
 * version of this comment claimed it was, and Phase 14's first sweep measured a double tap producing
 * a quantity of two, which is the correct reading of two clicks and not a bug. What a disabled
 * pending button would buy is protection against a *mis*-click; what it costs is the deliberate
 * second click landing on nothing, on a control whose whole job is to accept them. The sum is
 * clamped against live stock either way, so the worst outcome is one more of something the customer
 * chose twice, visible and removable in the bag.
 */
export function AddToBag({
  currency,
  disabledReason,
  item,
  maxQuantity,
  variantId,
}: {
  /** For §25.1a's `add_to_cart`. The bag's currency, which is the shop's. */
  currency: string
  /** Why this cannot be added, or `null` when it can. */
  disabledReason: null | string
  /** What was added, for the analytics event. Not used for anything the customer sees. */
  item: AnalyticsItem
  /** The live bound: stock, capped by policy. `0` when nothing can be added. */
  maxQuantity: number
  /** `null` until a size is chosen — §13.1c never picks one on the customer's behalf. */
  variantId: null | number
}) {
  const [state, action, pending] = useActionState(addToBagAction, CART_ACTION_IDLE)
  const [requested, setRequested] = useState(1)
  const quantityId = useId()
  const { registerTrigger, setOpen } = useShellOverlay()
  const submit = useRef<HTMLButtonElement>(null)

  const ceiling = Math.max(1, Math.min(maxQuantity || 1, QUANTITY_HARD_CAP))

  /*
   * **Derived, not stored.** Changing size can lower the ceiling under the number already chosen —
   * so can someone else buying the last two between renders. Clamping here means the field is right
   * for whatever props arrive, with no effect to fire and no render where it is briefly wrong. The
   * same correction Phase 12's audit forced on the search panel: an effect that calls `setState` to
   * reconcile props is a second copy of a value that already exists.
   */
  const quantity = Math.min(Math.max(1, requested), ceiling)

  /*
   * **§25.1a's `add_to_cart`, reported when the server said yes.**
   *
   * Not on click and not on submit. `addToBagAction` re-derives the price, re-checks live stock and
   * clamps the quantity, and it can refuse — a size that sold out between render and click is the
   * ordinary case, not the exotic one. An event fired on the click would report an add that never
   * happened, and the resulting funnel would show a cart-abandonment problem this shop does not
   * have.
   *
   * The quantity sent is the one that was **requested**, which is the honest thing this component
   * knows: the server's clamp is not reported back to it. Where the two differ the add was partial,
   * and that is a discrepancy worth having rather than a number invented to hide it.
   */
  useActionResult(state, (result) => {
    if (!result.ok) {
      return
    }

    trackEvent('add_to_cart', {
      currency,
      items: [{ ...item, quantity }],
      valueMinor: typeof item.priceMinor === 'number' ? item.priceMinor * quantity : null,
    })

    /*
     * Structure document §13: *"Add to Bag → Cart drawer."* The drawer opens on the server's yes —
     * never on the click, which could still be refused — so what it shows is the bag with the line
     * in it. Until sweep 2 nothing opened: the only feedback was a number on the header badge, about
     * four seconds later on a slow connection. Registering the submit button as the trigger means
     * closing the drawer returns focus to it, the contract the header's bag button already has.
     */
    registerTrigger(submit.current)
    setOpen('cart', true)
  })

  const blocked = variantId === null || maxQuantity <= 0

  return (
    <form action={action} className="flex flex-col gap-s" data-slot="add-to-bag">
      <input name="variantId" type="hidden" value={variantId ?? ''} />

      <div className="flex items-stretch gap-s">
        <div className="flex items-center gap-2">
          <label
            className="font-sans text-meta uppercase text-foreground-muted"
            htmlFor={quantityId}
          >
            Qty
          </label>

          <input
            aria-describedby={blocked ? undefined : `${quantityId}-max`}
            className={cn(
              'h-11 w-16 rounded-sm border border-border-control bg-transparent px-2',
              /* 16px, not 14: iOS Safari zooms the whole page on focus of any smaller input. */
              'text-center font-sans text-body text-foreground',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong',
              'disabled:text-foreground-disabled',
            )}
            disabled={blocked}
            id={quantityId}
            max={ceiling}
            min={1}
            name="quantity"
            onChange={(event) => {
              const next = Number(event.target.value)

              setRequested(Number.isFinite(next) ? next : 1)
            }}
            step={1}
            type="number"
            value={quantity}
          />

          {blocked ? null : (
            <span className="sr-only" id={`${quantityId}-max`}>
              {`Up to ${ceiling} available`}
            </span>
          )}
        </div>

        <Button className="flex-1" disabled={blocked} ref={submit} size="lg" type="submit">
          {pending ? 'Adding…' : 'Add to bag'}
        </Button>
      </div>

      {/*
        One live region for both the refusal and the clamp. A customer who asks for six and gets two
        must be told in a way a screen reader announces, not by the number silently changing.
      */}
      <p
        aria-live="polite"
        className={cn(
          /* One full line (22px), so the notice appearing or clearing moves nothing below it. */
          'min-h-[1.375rem] font-sans text-body-sm',
          state.ok ? 'text-foreground-muted' : 'text-error',
        )}
      >
        {disabledReason ?? state.notice ?? ''}
      </p>
    </form>
  )
}
