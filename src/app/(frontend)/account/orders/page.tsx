import type { Metadata } from 'next'

import { PageTitle } from '@/components/layout/page-title'
import { Link } from '@/components/ui/link'
import { readCustomerOrders } from '@/lib/account/orders'
import { requireCustomer } from '@/lib/auth/session'
import { getCatalogSettings } from '@/lib/catalog/catalog'
import { getPayloadClient } from '@/lib/payload'

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: 'Your orders',
}

/**
 * **`/account/orders`** — plan §20.1d.
 *
 * `requireCustomer()` on the page rather than in the layout, for the reason the layout's own docblock
 * gives: a layout does not re-render on navigation within its segment, so a check placed there runs
 * once and then stops being a check.
 *
 * Every order is read scoped by the session's customer id. There is no id in the URL and nothing to
 * tamper with — the list is a property of who you are, not of what you asked for.
 *
 * ### The zero state is a real state
 *
 * The phase prompt requires it by name: *"ensure account screens work with zero orders."* A customer
 * who has never bought anything is the **normal** case for a new account, so the empty state is
 * written as a sentence and a way out rather than as an apology.
 */
export default async function AccountOrdersPage() {
  const customer = await requireCustomer('/account/orders')

  const [payload, settings] = await Promise.all([getPayloadClient(), getCatalogSettings()])
  const orders = await readCustomerOrders(payload, customer.id, settings.locale)

  return (
    <div className="flex flex-col gap-l">
      <PageTitle eyebrow="Account" size="display-l">
        Orders
      </PageTitle>

      {orders.length === 0 ? (
        <div className="flex flex-col items-start gap-s border-t border-border pt-6">
          <p className="font-sans text-body text-foreground">No orders yet.</p>
          <p className="max-w-measure font-sans text-body-sm text-foreground-muted">
            Anything you buy will appear here, with its status and what you paid.
          </p>
          <Link className="mt-s font-sans text-meta uppercase" href="/shop">
            Browse the shop
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col border-t border-border">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                className="flex flex-wrap items-baseline justify-between gap-s border-b border-border py-5"
                href={`/account/orders/${encodeURIComponent(order.orderNumber)}`}
                variant="unstyled"
              >
                <span className="flex flex-col gap-1">
                  <span className="font-sans text-body-sm text-foreground">
                    {order.orderNumber}
                  </span>
                  <span className="font-sans text-micro uppercase text-foreground-muted">
                    {order.statusLabel}
                    {order.placedAt ? ` · ${formatDate(order.placedAt, settings.locale)}` : ''}
                  </span>
                </span>

                <span className="font-sans text-body-sm text-foreground">{order.total ?? ''}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * A date a person reads, not an ISO string.
 *
 * Wrapped because `Intl` throws on a malformed locale, and a stored locale that a validator let
 * through once should not be able to empty this page — the same backstop `formatMinorUnits` carries.
 */
function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}
