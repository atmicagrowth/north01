'use server'

import { revalidatePath } from 'next/cache'

import { getCustomer } from '@/lib/auth/session'
import { getCart } from '@/lib/cart/cart'
import { applyPromotion, clearPromotion } from '@/lib/promotions/promotions'
import { PROMOTION_COPY } from '@/lib/promotions/rules'

import type { PromotionActionState } from './action-state'

/**
 * **Apply and remove a discount code** — plan §14.1c's last two mutations, which Phase 14 deferred
 * here because the engine that decides them is this phase's.
 *
 * The browser sends a string. Everything else — whether the code exists, whether it is live, whether
 * this customer has used it, what it is worth against *this* bag — is decided on the server from the
 * database, which is §15.1a's opening two words: **"Server-side only."**
 *
 * Nothing about the promotion comes back except the outcome. A failure returns one of nine reasons
 * mapped through `PROMOTION_COPY`, two of which deliberately produce the identical sentence so that
 * a form field cannot be used to discover unreleased codes.
 *
 * `'use server'` files may export only async functions, which is why the idle state lives beside this
 * one rather than in it — the runtime 500 that taught Phase 14 that lesson is recorded in
 * `lib/cart/action-state.ts`.
 */

function refreshBagSurfaces(): void {
  revalidatePath('/', 'layout')
}

export async function applyCodeAction(
  _previous: PromotionActionState,
  formData: FormData,
): Promise<PromotionActionState> {
  const code = formData.get('code')?.toString() ?? ''

  if (code.trim().length === 0) {
    return { notice: 'Enter a code.', ok: false }
  }

  const customer = await getCustomer()
  const customerId = customer?.id ?? null
  const cart = await getCart(customerId)

  if (!cart) {
    return { notice: 'Your bag is empty.', ok: false }
  }

  const outcome = await applyPromotion(
    cart.id,
    code,
    cart.lines
      .filter((line) => line.unitPriceMinor !== null && line.maxQuantity > 0)
      .map((line) => ({
        collectionIds: [],
        productId: line.productId,
        quantity: line.effectiveQuantity,
        unitPriceMinor: line.unitPriceMinor as number,
      })),
    cart.currency,
    customerId,
  )

  if ('reason' in outcome) {
    return { notice: PROMOTION_COPY.unknownCode, ok: false }
  }

  const reason = outcome.result.reason

  if (reason !== null) {
    return { notice: PROMOTION_COPY[reason], ok: false }
  }

  refreshBagSurfaces()

  return { notice: `${outcome.code} applied.`, ok: true }
}

export async function removeCodeAction(): Promise<void> {
  const customer = await getCustomer()
  const cart = await getCart(customer?.id ?? null)

  if (cart) {
    await clearPromotion(cart.id)
    refreshBagSurfaces()
  }
}
