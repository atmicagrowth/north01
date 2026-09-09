import type { Payload } from 'payload'

import type { FulfillmentStatus } from '@/lib/orders/rules'
import type { PaymentStatus } from '@/lib/checkout/rules'
import type { Order } from '@/payload-types'

import { formatMinorUnits } from '@/lib/money'
import { DISPLAY_STATUS_COPY, displayStatus, type DisplayStatus } from '@/lib/orders/rules'

/**
 * **A customer's own order history** — plan §20.1d's `/account/orders` and `/account/orders/[order]`.
 *
 * No `server-only` guard: it takes a `Payload` instance and a customer id, so `pnpm verify:account`
 * can drive the ownership boundary against the real database. That boundary is the whole point of
 * this module, and a boundary nothing can test is a boundary nobody should trust.
 *
 * ---
 *
 * ### Every read is scoped by customer id, and a miss is *absent* rather than *forbidden*
 *
 * Phase 7 recorded why `ownedByCustomer` returns a `Where` rather than `false`: *"a cross-account
 * read of somebody else's order is not a 403 that confirms the order exists — it is an empty result,
 * which confirms nothing."* This module keeps that property by scoping the query rather than by
 * fetching and then comparing. `readCustomerOrder` returns `null` for an order that does not exist
 * **and** for one belonging to somebody else, and the page renders the same not-found for both.
 *
 * A 403 would be a disclosure: it tells an attacker which order numbers are real.
 *
 * ### What the customer is shown is derived, never stored
 *
 * `displayStatus` collapses the two axes — **DEV-03**'s payment status and fulfilment status — into
 * the single line §18.1b draws. Storing that would be a third column able to disagree with the two
 * that are true.
 */

export type AccountOrderSummary = {
  id: number
  orderNumber: string
  placedAt: null | string
  status: DisplayStatus
  statusLabel: string
  total: null | string
}

export type AccountOrderLine = {
  lineTotal: null | string
  productName: string
  quantity: number
  sku: string
  variantLabel: string
}

export type AccountOrderDetail = AccountOrderSummary & {
  carrier: null | string
  discount: null | string
  lines: AccountOrderLine[]
  shipping: null | string
  shippingAddress: null | Record<string, unknown>
  shippingMethodLabel: null | string
  statusDetail: string
  subtotal: null | string
  tax: null | string
  trackingNumber: null | string
  trackingUrl: null | string
}

/**
 * The list.
 *
 * **Draft orders are excluded.** A `draft` order is a row Phase 17's preflight created and never got
 * a payment for — it is scaffolding, not a purchase, and showing a customer an "order" they never
 * placed would be alarming and untrue. Everything from `checkout_started` onward is a real attempt
 * and is shown with whatever status it actually reached.
 */
export async function readCustomerOrders(
  payload: Payload,
  customerId: number,
  locale: string,
): Promise<AccountOrderSummary[]> {
  const { docs } = await payload.find({
    collection: 'orders',
    depth: 0,
    limit: 50,
    overrideAccess: true,
    sort: '-createdAt',
    where: {
      and: [{ customer: { equals: customerId } }, { paymentStatus: { not_equals: 'draft' } }],
    },
  })

  return docs.map((order) => toSummary(order, locale))
}

/**
 * One order, by its **customer-facing order number** rather than by its database id.
 *
 * `/account/orders/[order]` takes the number the customer can actually see — `N1-2609-ABC123`. The
 * database id is a count of every order the shop has ever taken, and putting it in a URL both invites
 * enumeration and tells a customer how many orders came before theirs.
 *
 * The `customer` scope in the same query is what makes enumeration pointless anyway: guessing another
 * customer's order number returns nothing.
 */
export async function readCustomerOrder(
  payload: Payload,
  customerId: number,
  orderNumber: string,
  locale: string,
): Promise<AccountOrderDetail | null> {
  const { docs } = await payload.find({
    collection: 'orders',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      and: [
        { customer: { equals: customerId } },
        { orderNumber: { equals: orderNumber } },
        { paymentStatus: { not_equals: 'draft' } },
      ],
    },
  })

  const order = docs[0]

  if (!order) {
    return null
  }

  const items = await payload.find({
    collection: 'order-items',
    depth: 0,
    limit: 200,
    overrideAccess: true,
    where: { order: { equals: order.id } },
  })

  const currency = String(order.currency)
  const summary = toSummary(order, locale)

  return {
    ...summary,
    carrier: text(order.carrier),
    discount: order.discountMinor
      ? formatMinorUnits(order.discountMinor, currency as never, locale)
      : null,
    lines: items.docs.map((item) => ({
      lineTotal: formatMinorUnits(item.lineTotalMinor, currency as never, locale),
      productName: String(item.productName),
      quantity: Number(item.quantity),
      sku: String(item.sku),
      variantLabel: String(item.variantLabel),
    })),
    shipping: formatMinorUnits(order.shippingMinor, currency as never, locale),
    shippingAddress:
      order.shippingAddress && typeof order.shippingAddress === 'object'
        ? (order.shippingAddress as Record<string, unknown>)
        : null,
    shippingMethodLabel: text(order.shippingMethodLabel),
    statusDetail: DISPLAY_STATUS_COPY[summary.status].detail,
    subtotal: formatMinorUnits(order.subtotalMinor, currency as never, locale),
    tax: order.taxMinor ? formatMinorUnits(order.taxMinor, currency as never, locale) : null,
    trackingNumber: text(order.trackingNumber),
    trackingUrl: text(order.trackingUrl),
  }
}

function toSummary(order: Order, locale: string): AccountOrderSummary {
  const status = displayStatus(
    order.paymentStatus as PaymentStatus,
    order.fulfillmentStatus as FulfillmentStatus,
  )

  return {
    id: Number(order.id),
    orderNumber: String(order.orderNumber),
    /* `paidAt` when there is one — the day money moved is the day a customer means by "when". */
    placedAt: text(order.paidAt) ?? text(order.createdAt),
    status,
    statusLabel: DISPLAY_STATUS_COPY[status].label,
    total: formatMinorUnits(
      typeof order.totalMinor === 'number' ? order.totalMinor : null,
      String(order.currency) as never,
      locale,
    ),
  }
}

const text = (value: unknown): null | string =>
  typeof value === 'string' && value.length > 0 ? value : null
