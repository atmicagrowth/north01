import type { Payload, PayloadRequest } from 'payload'

import type { EmailData } from '@/emails/messages'
import type { EnqueueOutcome } from './send'

import { formatMinorUnits } from '@/lib/money'
import { dedupeKeyFor } from './rules'
import { enqueueEmail } from './send'

/**
 * **Turning an order into the four messages it can produce.**
 *
 * Every function here **enqueues and returns**; none of them delivers. That split is the whole reason
 * `send.ts` has two halves — the shipped and delivered messages are raised from a Payload
 * `afterChange` hook, which runs *inside* the open transaction, and a message delivered there would
 * be a message sent for a write that could still roll back.
 *
 * Nothing here throws. §19.1d is absolute about that, and the webhook route is why: it turns any
 * throw into a 500, Stripe retries, and the retry is refused by the unique event id without
 * reprocessing — so one thrown error from an email path would leave an order paid and its customer
 * permanently without a confirmation that nothing would ever resend.
 *
 * No `server-only` guard: these take a `Payload` rather than reaching for one, so `pnpm verify:email`
 * can drive them against the real database.
 */

/** Money is formatted here, once, so no template has to know what a minor unit is. */
function money(minor: null | number | undefined, currency: string, locale: string): null | string {
  return formatMinorUnits(minor, currency as never, locale)
}

/**
 * The locale to format in.
 *
 * `SiteSettings.defaultLocale` is the shop's own, and an order carries no locale of its own — there
 * is one storefront and one currency per order. A read failure falls back rather than failing the
 * message, because a confirmation formatted in the wrong locale is enormously better than none.
 */
async function shopLocale(payload: Payload): Promise<string> {
  const settings = await payload
    .findGlobal({ depth: 0, overrideAccess: true, slug: 'site-settings' })
    .catch(() => null)

  return settings && typeof settings.defaultLocale === 'string' ? settings.defaultLocale : 'en-US'
}

/**
 * **§17.1e's fourth step, and the one the plan deliberately puts outside the transaction.**
 *
 * > *"Webhook verified → Order marked paid → Inventory adjusted → Confirmation email"*
 *
 * The lines are read from `order-items`, which holds the frozen snapshots §18.1d protects — so the
 * receipt says what the customer bought at the price they paid, permanently, even after the product
 * is renamed or repriced. That is what makes `/checkout/success`'s promise (*"your confirmation email
 * is the record"*) true rather than aspirational.
 */
export async function queueOrderConfirmation(
  payload: Payload,
  orderId: number,
  req?: PayloadRequest,
): Promise<EnqueueOutcome> {
  const order = await payload
    .findByID({ collection: 'orders', depth: 0, id: orderId, overrideAccess: true, req })
    .catch(() => null)

  if (!order || typeof order.email !== 'string' || order.email.length === 0) {
    return { outcome: 'error', reason: 'The order has no address to send to.' }
  }

  const { docs } = await payload.find({
    collection: 'order-items',
    depth: 0,
    limit: 200,
    overrideAccess: true,
    req,
    where: { order: { equals: orderId } },
  })

  const locale = await shopLocale(payload)
  const currency = String(order.currency)

  const data: EmailData['orderConfirmation'] = {
    discount: order.discountMinor ? money(-order.discountMinor, currency, locale) : null,
    lines: docs.map((item) => ({
      lineTotal: money(item.lineTotalMinor, currency, locale) ?? '',
      productName: String(item.productName),
      quantity: Number(item.quantity),
      variantLabel: String(item.variantLabel),
    })),
    orderNumber: String(order.orderNumber),
    shipping: money(order.shippingMinor, currency, locale),
    shippingMethodLabel:
      typeof order.shippingMethodLabel === 'string' ? order.shippingMethodLabel : null,
    shippingEstimate: typeof order.shippingEstimate === 'string' ? order.shippingEstimate : null,
    subtotal: money(order.subtotalMinor, currency, locale),
    tax: order.taxMinor ? money(order.taxMinor, currency, locale) : null,
    total: money(order.totalMinor, currency, locale) ?? '',
  }

  return enqueueEmail(
    payload,
    {
      customerId: relatedId(order.customer),
      data,
      dedupeKey: dedupeKeyFor('orderConfirmation', { id: orderId }),
      kind: 'orderConfirmation',
      orderId,
      orderNumber: String(order.orderNumber),
      to: order.email,
    },
    req,
  )
}

/**
 * **§18.1c's *"trigger shipment email"*, and its delivered counterpart.**
 *
 * Raised from the `afterChange` hook, inside the transaction, with `req` passed so the row joins it.
 * If the transition rolls back, so does the intention to announce it — which is exactly right, and is
 * only achievable because this enqueues rather than sends.
 *
 * `planFulfillmentChange` already refuses `shipped` unless a carrier and a tracking number are both
 * present, so the dispatch message can rely on them.
 */
export async function queueFulfilmentMessage(
  payload: Payload,
  order: {
    carrier?: null | string
    customer?: unknown
    email?: null | string
    id: number
    orderNumber?: null | string
    trackingNumber?: null | string
    trackingUrl?: null | string
  },
  kind: 'orderDelivered' | 'orderShipped',
  req?: PayloadRequest,
): Promise<EnqueueOutcome> {
  if (typeof order.email !== 'string' || order.email.length === 0) {
    return { outcome: 'error', reason: 'The order has no address to send to.' }
  }

  const orderNumber = String(order.orderNumber ?? '')

  const data: EmailData['orderDelivered'] | EmailData['orderShipped'] =
    kind === 'orderShipped'
      ? {
          carrier: order.carrier ?? null,
          orderNumber,
          trackingNumber: order.trackingNumber ?? null,
          trackingUrl: order.trackingUrl ?? null,
        }
      : { orderNumber }

  return enqueueEmail(
    payload,
    {
      customerId: relatedId(order.customer),
      data: data as never,
      dedupeKey: dedupeKeyFor(kind, { id: order.id }),
      kind,
      orderId: order.id,
      orderNumber,
      to: order.email,
    },
    req,
  )
}

/**
 * **§18.1b's `PAID → REFUNDED`, announced.**
 *
 * Keyed on the order **and the amount**, because partial refunds are ordinary — `Orders.refundedMinor`
 * says so — and a second, larger refund is a second thing the customer is owed a notice about. Keying
 * on the order alone would swallow it silently.
 */
export async function queueRefundMessage(
  payload: Payload,
  orderId: number,
  amountMinor: null | number,
  req?: PayloadRequest,
): Promise<EnqueueOutcome> {
  const order = await payload
    .findByID({ collection: 'orders', depth: 0, id: orderId, overrideAccess: true, req })
    .catch(() => null)

  if (!order || typeof order.email !== 'string' || order.email.length === 0) {
    return { outcome: 'error', reason: 'The order has no address to send to.' }
  }

  const locale = await shopLocale(payload)

  return enqueueEmail(
    payload,
    {
      customerId: relatedId(order.customer),
      data: {
        amount: money(amountMinor, String(order.currency), locale),
        orderNumber: String(order.orderNumber),
      },
      dedupeKey: dedupeKeyFor('refund', { amountMinor, id: orderId }),
      kind: 'refund',
      orderId,
      orderNumber: String(order.orderNumber),
      to: order.email,
    },
    req,
  )
}

const relatedId = (value: unknown): null | number =>
  typeof value === 'number'
    ? value
    : typeof value === 'object' && value && 'id' in value
      ? ((value as { id: number }).id ?? null)
      : null
