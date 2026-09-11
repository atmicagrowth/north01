import type { Payload, Where } from 'payload'

import type { FulfillmentStatus } from '@/lib/orders/rules'
import type { PaymentStatus } from '@/lib/checkout/rules'
import type { Order } from '@/payload-types'

import { formatMinorUnits } from '@/lib/money'
import {
  DISPLAY_STATUS_COPY,
  displayStatus,
  isPartiallyRefunded,
  PARTIAL_REFUND_COPY,
  STOCK_SHORTFALL_COPY,
  type DisplayStatus,
} from '@/lib/orders/rules'

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
 * ### What the customer is shown is derived, never stored
 *
 * `displayStatus` collapses the two axes — **DEV-03**'s payment status and fulfilment status — into
 * the single line §18.1b draws. Two facts the axes do not carry are layered on top here: a partial
 * refund and a stock shortfall (see `PARTIAL_REFUND_COPY` and `STOCK_SHORTFALL_COPY`).
 */

export type AccountOrderSummary = {
  id: number
  orderNumber: string
  placedAt: null | string
  /** `placedAt` as the customer reads it, in the shop's locale. */
  placedOn: null | string
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
  /** The delivery address snapshot, one line per non-empty part. Empty when there is none. */
  addressLines: string[]
  carrier: null | string
  /** Already signed: "−$10.00". */
  discount: null | string
  lines: AccountOrderLine[]
  /** Already signed: "−$15.00", when any refund has been reported. */
  refunded: null | string
  shipping: null | string
  shippingAddress: null | Record<string, unknown>
  shippingMethodLabel: null | string
  shippingEstimate: null | string
  statusDetail: string
  subtotal: null | string
  tax: null | string
  trackingNumber: null | string
  trackingUrl: null | string
}

/**
 * **Which orders a customer's history shows.**
 *
 * - **Not `draft`**: a row nobody has been through checkout with.
 * - **Not `checkout_started`** (Phase 36, R1-06): an order preflight prepared and the customer never
 *   paid for — scaffolding, and a trail of them after every "back, and try again" read as orders.
 * - **Not a `cancelled` order that was never paid**: an expired Stripe session. Nothing was bought.
 *   A cancelled order that *was* paid (it has `paidAt`) is a real purchase and stays.
 *
 * `pending_payment` stays visible: the customer has been to Stripe, and a delayed bank payment is
 * genuinely in flight. `payment_failed` stays too, because a failed payment is something they did.
 */
const HISTORY_SCOPE: Where[] = [
  { paymentStatus: { not_in: ['draft', 'checkout_started'] } },
  { or: [{ paymentStatus: { not_equals: 'cancelled' } }, { paidAt: { exists: true } }] },
]

/** The list. Scoped to the customer and to `HISTORY_SCOPE`. */
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
    where: { and: [{ customer: { equals: customerId } }, ...HISTORY_SCOPE] },
  })

  return docs.map((order) => toSummary(order, locale))
}

/**
 * One order, by its **customer-facing order number** rather than by its database id.
 *
 * The `customer` scope in the same query is what makes enumeration pointless: guessing another
 * customer's order number returns nothing. The same `HISTORY_SCOPE` as the list, so a page cannot
 * show an order the list says does not exist.
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
        ...HISTORY_SCOPE,
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
  const money = (minor: null | number | undefined) =>
    formatMinorUnits(typeof minor === 'number' ? minor : null, currency as never, locale)

  const address =
    order.shippingAddress && typeof order.shippingAddress === 'object'
      ? (order.shippingAddress as Record<string, unknown>)
      : null

  const partial = isPartiallyRefunded(
    order.paymentStatus as PaymentStatus,
    order.refundedMinor,
    order.totalMinor,
  )

  return {
    ...summary,
    addressLines: addressLinesOf(address),
    carrier: text(order.carrier),
    discount: order.discountMinor ? signed(money(order.discountMinor)) : null,
    lines: items.docs.map((item) => ({
      lineTotal: money(item.lineTotalMinor),
      productName: String(item.productName),
      quantity: Number(item.quantity),
      sku: String(item.sku),
      variantLabel: String(item.variantLabel),
    })),
    refunded:
      typeof order.refundedMinor === 'number' && order.refundedMinor > 0
        ? signed(money(order.refundedMinor))
        : null,
    shipping: money(order.shippingMinor),
    shippingAddress: address,
    shippingMethodLabel: text(order.shippingMethodLabel),
    shippingEstimate: text(order.shippingEstimate),
    statusDetail:
      summary.status === 'paid' && order.fulfilmentHold === 'stockShortfall'
        ? STOCK_SHORTFALL_COPY.detail
        : summary.status === 'paid' && partial
          ? PARTIAL_REFUND_COPY.detail
          : DISPLAY_STATUS_COPY[summary.status].detail,
    subtotal: money(order.subtotalMinor),
    tax: order.taxMinor ? money(order.taxMinor) : null,
    trackingNumber: text(order.trackingNumber),
    trackingUrl: text(order.trackingUrl),
  }
}

function toSummary(order: Order, locale: string): AccountOrderSummary {
  const status = displayStatus(
    order.paymentStatus as PaymentStatus,
    order.fulfillmentStatus as FulfillmentStatus,
  )

  /* `paidAt` when there is one — the day money moved is the day a customer means by "when". */
  const placedAt = text(order.paidAt) ?? text(order.createdAt)

  /*
   * A partial refund on an order nobody has started picking reads as what it is. Once picking has
   * started, the fulfilment step is the newer news and keeps the label; the detail page still shows
   * the refunded amount.
   */
  const partial =
    status === 'paid' &&
    isPartiallyRefunded(order.paymentStatus as PaymentStatus, order.refundedMinor, order.totalMinor)

  return {
    id: Number(order.id),
    orderNumber: String(order.orderNumber),
    placedAt,
    placedOn: placedAt ? formatDate(placedAt, locale) : null,
    status,
    statusLabel: partial ? PARTIAL_REFUND_COPY.label : DISPLAY_STATUS_COPY[status].label,
    total: formatMinorUnits(
      typeof order.totalMinor === 'number' ? order.totalMinor : null,
      String(order.currency) as never,
      locale,
    ),
  }
}

/** A minus sign, not a hyphen, so a screen reader and a reader agree it is money coming off. */
const signed = (value: null | string): null | string => (value ? `−${value}` : null)

function formatDate(iso: string, locale: string): null | string {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(date)
  }
}

function addressLinesOf(address: null | Record<string, unknown>): string[] {
  if (!address) {
    return []
  }

  const part = (key: string) => text(address[key])
  const name = [part('firstName'), part('lastName')].filter(Boolean).join(' ')
  const locality = [part('city'), part('region'), part('postalCode')].filter(Boolean).join(', ')

  return [name, part('company'), part('line1'), part('line2'), locality, part('country')].filter(
    (line): line is string => typeof line === 'string' && line.length > 0,
  )
}

const text = (value: unknown): null | string =>
  typeof value === 'string' && value.length > 0 ? value : null
