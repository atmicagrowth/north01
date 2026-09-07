'use server'

import { revalidatePath } from 'next/cache'

import { getCustomer } from '@/lib/auth/session'

import type { CartActionState } from './action-state'
import { addToCart, removeCartLine, setCartLineQuantity } from './cart'
import { clampNotice, CART_COPY } from './rules'

/**
 * **The bag's four mutations, as server actions.**
 *
 * The whole surface the browser is allowed to touch, and it is deliberately narrow: a variant id and
 * a quantity, or a line id and a quantity. **No price crosses this boundary in either direction as an
 * input.** Plan §13.1d's *"never trust a client-submitted price"* is satisfied by there being nothing
 * to trust — the server reads the price from the variant at the moment it writes the line, and
 * `cart-items` stores none.
 *
 * ### Why these are actions and not a route handler
 *
 * A route handler would need its own CSRF story. A server action carries Next's own origin check on
 * every invocation, is bound to the session cookie the same way the page was, and cannot be called
 * cross-site with the browser's credentials. The newsletter form set the precedent in Phase 10.
 *
 * ### Every action returns a *notice*, never a total
 *
 * §14.1e's *"user opens multiple tabs and carts diverge"* and *"resolve stale state by re-fetching
 * authoritative cart data after mutation errors"* both say the same thing: the answer to "what is in
 * the bag" is a fresh read, not a diff applied to whatever the tab was holding. So a mutation returns
 * only what the customer needs *told* — "only two left, so that is what we added" — and
 * `revalidatePath` makes the server re-render the bag from the database. A tab that has been open for
 * an hour and a tab opened just now converge on the next mutation from either of them.
 */

/**
 * Re-render every surface that shows the bag.
 *
 * `layout` because the drawer is mounted in the root layout and the bag page is its own route — one
 * call covers both, and covers whichever page the customer happened to be on when they added
 * something.
 */
function refreshBagSurfaces(): void {
  revalidatePath('/', 'layout')
}

const integer = (value: FormDataEntryValue | null): null | number => {
  const parsed = Number(value)

  return Number.isSafeInteger(parsed) ? parsed : null
}

/** Plan §13.1d's add-to-cart. The PDP's form posts a variant id and a quantity, and nothing else. */
export async function addToBagAction(
  _previous: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const variantId = integer(formData.get('variantId'))
  const quantity = integer(formData.get('quantity')) ?? 1

  if (variantId === null || quantity < 1) {
    return { notice: 'Choose a size first.', ok: false }
  }

  const customer = await getCustomer()
  const result = await addToCart(customer?.id ?? null, variantId, quantity)

  if (!result.ok) {
    return {
      notice:
        result.reason === 'unavailable'
          ? (clampNotice(result.clamped ?? { clampedBy: 'soldOut', quantity: 0 }) ??
            CART_COPY.soldOut)
          : CART_COPY.mutationFailed,
      ok: false,
    }
  }

  refreshBagSurfaces()

  return { notice: result.clamped ? clampNotice(result.clamped) : null, ok: true }
}

/** The stepper. `0` removes the line, which is what a stepper stepping down from one should do. */
export async function setQuantityAction(
  _previous: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const lineId = integer(formData.get('lineId'))
  const quantity = integer(formData.get('quantity'))

  if (lineId === null || quantity === null || quantity < 0) {
    return { notice: CART_COPY.mutationFailed, ok: false }
  }

  const customer = await getCustomer()
  const result = await setCartLineQuantity(customer?.id ?? null, lineId, quantity)

  if (!result.ok) {
    return { notice: CART_COPY.mutationFailed, ok: false }
  }

  refreshBagSurfaces()

  return { notice: result.clamped ? clampNotice(result.clamped) : null, ok: true }
}

export async function removeLineAction(
  _previous: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const lineId = integer(formData.get('lineId'))

  if (lineId === null) {
    return { notice: CART_COPY.mutationFailed, ok: false }
  }

  const customer = await getCustomer()
  const result = await removeCartLine(customer?.id ?? null, lineId)

  if (!result.ok) {
    return { notice: CART_COPY.mutationFailed, ok: false }
  }

  refreshBagSurfaces()

  return { notice: null, ok: true }
}
