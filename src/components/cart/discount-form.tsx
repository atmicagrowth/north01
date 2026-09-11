'use client'

import { X } from 'lucide-react'
import { useActionState, useId } from 'react'

import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import type { ResolvedPromotion } from '@/lib/promotions/promotions'
import { PROMOTION_ACTION_IDLE } from '@/lib/promotions/action-state'
import { applyCodeAction, removeCodeAction } from '@/lib/promotions/actions'
import { discountLabel, PROMOTION_COPY } from '@/lib/promotions/rules'
import { cn } from '@/lib/cn'

/**
 * **The discount-code field** — plan §14.1c's *"apply promotion / remove promotion"*, with Phase 15's
 * engine behind it.
 *
 * A `<form>` posting to a Server Action, like every other cart control, so it works without
 * JavaScript. The field sends a string and nothing else: the server decides whether the code exists,
 * whether it is live, whether this customer may use it and what it is worth against this bag.
 *
 * ### A code that stopped working stays visible, and says why
 *
 * §15.1c's first two edge cases are *"expired code during checkout"* and *"code reaches usage limit
 * between cart and checkout"*. Both mean a code that was applied is no longer valid, and the bag must
 * **not** silently charge full price: the row stays, the reason is shown, and the customer can remove
 * it. The discount is re-decided on every read, so this cannot go stale in the other direction
 * either.
 *
 * ### `autoCapitalize` and `spellCheck`, and why they are not decoration
 *
 * Codes are stored upper-case and compared after trimming, so a phone helpfully capitalising the
 * first letter and nothing else, or a spell-checker underlining `WELCOME10`, are both friction on a
 * field whose input is not a word. `autoComplete="off"` for the same reason — a browser offering a
 * previous customer's code on a shared machine is the wrong kind of helpful.
 */
export function DiscountForm({ discount }: { discount: null | ResolvedPromotion }) {
  const [state, action, pending] = useActionState(applyCodeAction, PROMOTION_ACTION_IDLE)
  const fieldId = useId()

  const applied = discount !== null && discount.result.reason === null
  const failing = discount !== null && discount.result.reason !== null

  if (discount !== null) {
    return (
      <div className="flex flex-col gap-2 border-t border-border pt-m" data-slot="discount-applied">
        <div className="flex items-center justify-between gap-s">
          <div className="min-w-0">
            <p className="font-sans text-body-sm text-foreground">
              {discount.code}
              <span className="text-foreground-muted">{` — ${discountLabel(discount.promotion)}`}</span>
            </p>

            {failing ? (
              <p className="font-sans text-meta text-error" role="status">
                {PROMOTION_COPY[discount.result.reason as keyof typeof PROMOTION_COPY]}
              </p>
            ) : null}
          </div>

          <form action={removeCodeAction}>
            <IconButton
              label={`Remove code ${discount.code}`}
              size="sm"
              type="submit"
              variant="ghost"
            >
              <X aria-hidden />
            </IconButton>
          </form>
        </div>

        {applied && discount.result.freeShipping ? (
          <p className="font-sans text-meta text-foreground-muted">
            {/*
              A free-shipping code is validated and recorded here, and it takes effect where shipping
              is calculated — which is Phase 16. Saying so is better than showing a discount row of
              zero, which is what the amount actually is. DEV-60.
            */}
            Applies to delivery, which is calculated at checkout.
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-2 border-t border-border pt-m"
      data-slot="discount-form"
    >
      <label className="font-sans text-meta uppercase text-foreground-muted" htmlFor={fieldId}>
        Discount code
      </label>

      <div className="flex gap-s">
        <input
          autoCapitalize="characters"
          autoComplete="off"
          className={cn(
            'h-11 min-w-0 flex-1 rounded-sm border border-border-control bg-transparent px-3',
            /* 16px, not 14: iOS Safari zooms the whole page on focus of any smaller input. */
            'font-sans text-body uppercase text-foreground placeholder:text-foreground-disabled',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong',
          )}
          id={fieldId}
          maxLength={32}
          name="code"
          placeholder="Enter a code"
          spellCheck={false}
          type="text"
        />

        <Button type="submit" variant="secondary">
          {pending ? 'Checking…' : 'Apply'}
        </Button>
      </div>

      <p
        aria-live="polite"
        className={cn(
          'min-h-[1.25rem] font-sans text-meta',
          state.ok ? 'text-foreground-muted' : 'text-error',
        )}
      >
        {state.notice ?? ''}
      </p>
    </form>
  )
}
