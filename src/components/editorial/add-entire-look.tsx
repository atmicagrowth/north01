'use client'

import { useState, useTransition } from 'react'

import { useShellOverlay } from '@/components/shell/overlay-context'
import { Button } from '@/components/ui/button'
import { trackEvent } from '@/lib/analytics/track'
import { addLookToBagAction } from '@/lib/lookbook/actions'
import { LOOK_COPY } from '@/lib/lookbook/rules'

/**
 * **§22.1d's "add the entire look".**
 *
 * The plan calls it *optional* in the prompt — *"optional Add Entire Look functionality"* — and it is
 * built, because the six numbered steps beside it are not optional and are only meaningful if
 * something performs them.
 *
 * ### The button does not decide anything
 *
 * It sends product ids. Every one of §22.1d's steps happens on the server, where live stock is:
 * which products resolve, which have exactly one purchasable variant, which need a size, which are
 * gone. A client that pre-computed any of that would be deciding from data that was true when the
 * page rendered.
 *
 * ### The notice is the point, not a courtesy
 *
 * Step 6 is *"report skipped unavailable items"*, and the notice separates the two reasons a product
 * was skipped, because they are not the same problem. *"Needs a size"* is a ten-second fix a customer
 * can act on; *"not available"* is a dead end. `2 items skipped` would be neither, and is exactly the
 * message this avoids.
 *
 * `aria-live="polite"` because the outcome arrives after the press and says what the bag cannot:
 * which products were skipped and why. Since Phase 35 the bag drawer also opens when anything was
 * added, and the notice is still here when it closes.
 */
export function AddEntireLook({ productIds }: { productIds: number[] }) {
  const [notice, setNotice] = useState<null | string>(null)
  const [pending, start] = useTransition()
  const { registerTrigger, setOpen } = useShellOverlay()

  if (productIds.length === 0) {
    return null
  }

  return (
    <div className="mt-m flex flex-wrap items-center gap-m">
      <Button
        disabled={pending}
        onClick={(event) => {
          const trigger = event.currentTarget

          start(async () => {
            const result = await addLookToBagAction(productIds)

            /*
             * **§25.1a's `shop_the_look_add_item`, once per look and only for what was added.**
             * `addLookToBagAction` adds what it can — a look whose jacket needs a size choice adds
             * two of three — and it now returns **which** ids went in rather than only how many.
             *
             * That distinction was a real defect: reporting the first `added` ids of the requested
             * list is only right when the skipped product happens to be last. A look whose jacket
             * needs a choice and whose scarf goes straight in would have reported the jacket.
             *
             * The items carry no names: this component is given ids and nothing else, and inventing
             * names from them would need a read the button does not do.
             */
            if (result.ok && result.addedProductIds.length > 0) {
              trackEvent('shop_the_look_add_item', {
                items: result.addedProductIds.map((id) => ({
                  itemId: String(id),
                  itemName: String(id),
                  quantity: 1,
                })),
                lookId: productIds.join('-'),
              })
            }

            setNotice(result.notice)

            /*
             * **Phase 35 (P35-15): the bag opens on the server's yes**, as it does for Add to bag.
             * Structure §13's *"Add to Bag → Cart drawer"* is not specific to one button, and the
             * header badge ticking over was the only other sign anything had happened. Nothing
             * added, nothing opened: a look that was entirely unavailable leaves the notice alone
             * to explain itself. The pressed button is the trigger, so closing the drawer returns
             * focus to it — and the notice is still there beside it.
             */
            if (result.ok && result.addedProductIds.length > 0) {
              registerTrigger(trigger)
              setOpen('cart', true)
            }
          })
        }}
        size="lg"
        type="button"
        variant="secondary"
      >
        {LOOK_COPY.addLook}
      </Button>

      <p aria-live="polite" className="font-sans text-body-sm text-foreground-muted">
        {notice}
      </p>
    </div>
  )
}
