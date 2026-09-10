'use client'

import { useState, useTransition } from 'react'

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
 * `aria-live="polite"` because the outcome arrives after the press and is the only feedback — the bag
 * itself updates elsewhere on the page.
 */
export function AddEntireLook({ productIds }: { productIds: number[] }) {
  const [notice, setNotice] = useState<null | string>(null)
  const [pending, start] = useTransition()

  if (productIds.length === 0) {
    return null
  }

  return (
    <div className="mt-m flex flex-wrap items-center gap-m">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await addLookToBagAction(productIds)

            /*
             * **§25.1a's `shop_the_look_add_item`, once per look and only for what was added.**
             * `addLookToBagAction` adds what it can and reports how many — a look whose jacket is
             * sold out adds two of three. `result.added` is that number, and reporting
             * `productIds.length` instead would claim adds the bag does not contain.
             *
             * The items are the ids, with no names: this component is given ids and nothing else,
             * and inventing names from them would need a read the button does not do.
             */
            if (result.ok && result.added > 0) {
              trackEvent('shop_the_look_add_item', {
                items: productIds.slice(0, result.added).map((id) => ({
                  itemId: String(id),
                  itemName: String(id),
                  quantity: 1,
                })),
                lookId: productIds.join('-'),
              })
            }

            setNotice(result.notice)
          })
        }
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
