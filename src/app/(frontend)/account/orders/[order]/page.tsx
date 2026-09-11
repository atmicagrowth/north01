import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PageTitle } from '@/components/layout/page-title'
import { Link } from '@/components/ui/link'
import { readCustomerOrder } from '@/lib/account/orders'
import { requireCustomer } from '@/lib/auth/session'
import { getCatalogSettings } from '@/lib/catalog/catalog'
import { getPayloadClient } from '@/lib/payload'
import { privateMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = privateMetadata('Order')

/**
 * **`/account/orders/[order]`** — plan §20.1d, spelled `[order]` because the plan spells it `[order]`.
 *
 * ---
 *
 * ### The segment is the order **number**, not the database id
 *
 * `N1-2609-ABC123`, the reference on the confirmation email. Two reasons, and the second is the one
 * that decided it. A database id is a running count of every order the shop has ever taken, so
 * putting one in a URL tells a customer how many came before theirs. And an id is *guessable in
 * sequence*, which makes enumeration a matter of counting.
 *
 * The order number is not secret either — `formatOrderNumber` says so, it is designed to be read
 * aloud — and it does not need to be, because the query below is scoped by the session's customer id.
 * Guessing another customer's number returns nothing.
 *
 * ### A cross-account request is **not found**, never forbidden
 *
 * `readCustomerOrder` returns `null` both for an order that does not exist and for one belonging to
 * somebody else, and this page cannot tell them apart because it is not given enough information to.
 * Phase 7 recorded why: *"a cross-account read is not a 403 that confirms the order exists — it is an
 * empty result, which confirms nothing."* A 403 here would be a disclosure oracle: it would tell an
 * attacker which order numbers are real.
 *
 * This is one of the two behaviours the phase prompt asks to be tested by name.
 */
export default async function AccountOrderPage({ params }: { params: Promise<{ order: string }> }) {
  const { order: orderNumber } = await params

  const customer = await requireCustomer(`/account/orders/${encodeURIComponent(orderNumber)}`)

  const [payload, settings] = await Promise.all([getPayloadClient(), getCatalogSettings()])

  const order = await readCustomerOrder(payload, customer.id, orderNumber, settings.locale)

  if (!order) {
    notFound()
  }

  return (
    <div className="flex flex-col gap-l">
      <div className="flex flex-col gap-s">
        <Link
          className="font-sans text-meta uppercase text-foreground-muted"
          href="/account/orders"
        >
          ← All orders
        </Link>

        <PageTitle eyebrow={order.statusLabel} size="display-l">
          {order.orderNumber}
        </PageTitle>

        <p className="max-w-measure font-sans text-body-sm text-foreground-muted">
          {order.statusDetail}
        </p>
      </div>

      {/* §18.1c stores the carrier and the tracking number; this is where a customer looks for them. */}
      {order.trackingNumber ? (
        <div className="flex flex-col gap-1 border-t border-border pt-m">
          <span className="font-sans text-micro uppercase text-foreground-muted">Tracking</span>
          <span className="font-sans text-body-sm">
            {order.carrier ? `${order.carrier} · ` : ''}
            {order.trackingUrl ? (
              <Link external href={order.trackingUrl}>
                {order.trackingNumber}
              </Link>
            ) : (
              order.trackingNumber
            )}
          </span>
        </div>
      ) : null}

      <div className="border-t border-border">
        <h2 className="sr-only">Items</h2>

        <ul>
          {order.lines.map((line, index) => (
            <li
              className="flex flex-wrap items-baseline justify-between gap-s border-b border-border py-m"
              key={`${line.sku}-${index}`}
            >
              <span className="flex flex-col gap-1">
                <span className="font-sans text-body-sm text-foreground">{line.productName}</span>
                <span className="font-sans text-micro uppercase text-foreground-muted">
                  {line.variantLabel} · {line.quantity}
                </span>
              </span>

              <span className="font-sans text-body-sm">{line.lineTotal ?? ''}</span>
            </li>
          ))}
        </ul>
      </div>

      {/*
        Every figure is the snapshot §18.1d freezes at purchase, so this still says what the customer
        paid after the product has been renamed or repriced.
      */}
      <dl className="flex flex-col gap-2">
        <Row label="Subtotal" value={order.subtotal} />
        <Row label="Discount" value={order.discount} />
        <Row label={order.shippingMethodLabel ?? 'Delivery'} value={order.shipping} />
        {/* P35-20: what checkout promised, still visible after payment. */}
        {order.shippingEstimate ? (
          <Row label="Estimated delivery" value={order.shippingEstimate} />
        ) : null}
        <Row label="Tax" value={order.tax} />
        <Row emphasis label="Total" value={order.total} />
      </dl>
    </div>
  )
}

function Row({
  emphasis = false,
  label,
  value,
}: {
  emphasis?: boolean
  label: string
  value: null | string
}) {
  if (!value) {
    return null
  }

  return (
    <div
      className={
        emphasis
          ? 'flex justify-between border-t border-border pt-3 font-sans text-body text-foreground-bright'
          : 'flex justify-between font-sans text-body-sm text-foreground-muted'
      }
    >
      <dt>{label}</dt>
      <dd className={emphasis ? '' : 'text-foreground'}>{value}</dd>
    </div>
  )
}
