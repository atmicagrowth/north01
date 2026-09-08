import 'server-only'

import { getCustomer } from '@/lib/auth/session'
import { getCatalogSettings } from '@/lib/catalog/catalog'
import { getPayloadClient } from '@/lib/payload'
import type { CurrencyCode } from '@/payload/fields/money'

import type { PaymentStatus } from './rules'

/**
 * **Reading an order for the confirmation page** — plan §17.1g's *"fetch the order by a safe
 * identifier and show only authoritative order information."*
 *
 * ### What makes the identifier safe
 *
 * Not the id itself: a small integer in a URL is guessable, and §17.1g knows it, which is why it says
 * *"safe identifier"* rather than *"the id"*. Safety comes from the **check beside it**:
 *
 * - A **signed-in customer** may read an order that carries their customer id.
 * - A **guest** may read an order **only in the session that placed it** — the order's `cart` still
 *   points at the bag whose token is in their cookie. That link survives exactly as long as it should:
 *   the cart is marked `converted` at payment, not deleted, so the confirmation works on a refresh
 *   and stops working on a different machine.
 *
 * Everything else gets `null`, and the page renders one message for *not found*, *not yours* and
 * *never existed*. Distinguishing them would turn the URL into a way to enumerate other people's
 * orders, and the id is the only thing an attacker would need.
 *
 * ### Only authoritative information
 *
 * The status shown is `paymentStatus` as the **webhook** left it. This module writes nothing and has
 * no path that could: it is a read, and arriving at a URL is not a payment.
 */

export type ConfirmationLine = {
  id: number
  lineTotalMinor: number
  productName: string
  quantity: number
  variantLabel: string
}

export type ConfirmationView = {
  currency: CurrencyCode
  lines: ConfirmationLine[]
  locale: string
  orderNumber: string
  paymentStatus: PaymentStatus
  shippingMethodLabel: null | string
  totalMinor: number
}

const relatedId = (value: unknown): null | number =>
  typeof value === 'number'
    ? value
    : typeof value === 'object' && value && 'id' in value
      ? ((value as { id: number }).id ?? null)
      : null

export async function readOrderForConfirmation(
  rawId: string | string[] | undefined,
  customerId: null | number,
): Promise<ConfirmationView | null> {
  const id = Number(Array.isArray(rawId) ? rawId[0] : rawId)

  if (!Number.isSafeInteger(id) || id <= 0) {
    return null
  }

  const payload = await getPayloadClient()

  const order = await payload
    .findByID({ collection: 'orders', depth: 0, id, overrideAccess: true })
    .catch(() => null)

  if (!order) {
    return null
  }

  const owned = await isViewable(order, customerId)

  if (!owned) {
    return null
  }

  const settings = await getCatalogSettings()

  const { docs: items } = await payload.find({
    collection: 'order-items',
    depth: 0,
    limit: 500,
    overrideAccess: true,
    pagination: false,
    sort: 'createdAt',
    where: { order: { equals: order.id } },
  })

  return {
    currency: order.currency,
    lines: items.map((item) => ({
      id: item.id,
      lineTotalMinor: item.lineTotalMinor,
      productName: item.productName,
      quantity: item.quantity,
      variantLabel: item.variantLabel,
    })),
    locale: settings.locale,
    orderNumber: order.orderNumber,
    paymentStatus: order.paymentStatus as PaymentStatus,
    shippingMethodLabel: order.shippingMethodLabel ?? null,
    totalMinor: order.totalMinor,
  }
}

/**
 * The ownership check, and the only thing standing between a guessed id and somebody else's order.
 *
 * A guest's claim rests on holding the cookie for the cart the order was raised from. `getCart` is
 * not used, because it deliberately refuses a **converted** cart — which is what every paid order's
 * cart becomes — so the token is compared directly.
 */
async function isViewable(
  order: { cart?: unknown; customer?: unknown },
  customerId: null | number,
): Promise<boolean> {
  const orderCustomerId = relatedId(order.customer)

  if (orderCustomerId !== null) {
    return customerId !== null && orderCustomerId === customerId
  }

  const cartId = relatedId(order.cart)

  if (cartId === null) {
    return false
  }

  const { cookies } = await import('next/headers')
  const token = (await cookies()).get('north01_cart')?.value ?? null

  if (!token) {
    return false
  }

  const payload = await getPayloadClient()

  const cart = await payload
    .findByID({ collection: 'carts', depth: 0, id: cartId, overrideAccess: true })
    .catch(() => null)

  return cart?.token === token
}

/** Re-exported so a page need not import the session module separately. */
export { getCustomer }
