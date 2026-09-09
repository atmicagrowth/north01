'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
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
