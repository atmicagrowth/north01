'use client'

import { useEffect, useRef } from 'react'

import { trackEvent } from '@/lib/analytics/track'
import type { AnalyticsItem } from '@/lib/analytics/events'

/**
 * **Plan §25.1a's `purchase`, and the one event in the taxonomy that must not be sent twice.**
 *
 * Every other event describes something a customer did, and doing it twice is two events. A
 * purchase is a fact about an order, and reporting it twice **doubles reported revenue** — the one
 * number in an analytics property that other decisions get made from. Everything unusual in this
 * file exists for that.
 *
 * ### Three conditions, and only the third is obvious
 *
 * 1. **The order is paid.** §17.1g, and the whole architecture behind it: *"only a
 *    signature-verified Stripe webhook marks an order paid. Reaching the success page is not
 *    payment."* A customer lands here the instant Stripe redirects, which is routinely **before**
 *    the webhook has arrived — so the success page renders *Order received* and this sends nothing.
 *    On refresh, once the webhook has landed, the page says *Order confirmed* and the event fires.
 *    An unpaid order that is never paid is never reported, which is correct.
 * 2. **It has not already been sent, on this device.** The success URL is bookmarkable,
 *    refreshable and shareable. `sessionStorage` is keyed on the order number, so a refresh, a back
 *    button and a second tab all find the same mark.
 * 3. **It has not already been sent, in this component.** React Strict Mode remounts in
 *    development; the ref covers the window before `sessionStorage` is written.
 *
 * ### Why `sessionStorage` and not `localStorage`
 *
 * The mark only needs to outlive a refresh, not a browser. A customer who buys the same items again
 * next month gets a **new order number**, so `localStorage` would be storing keys forever to
 * prevent a collision that cannot happen — and a shared or reset browser would silently lose the
 * mark anyway. Session scope is the honest lifetime of the thing being remembered.
 *
 * Storage can throw — private mode, blocked site data. It is wrapped, and a throw means the event
 * is sent: an occasional double-count is a smaller error than silently dropping revenue, and this
 * is the one place in the file where that trade goes the other way.
 */
export function TrackPurchase({
  currency,
  items,
  paid,
  shippingMinor,
  taxMinor,
  transactionId,
  valueMinor,
}: {
  currency: string
  items: AnalyticsItem[]
  /** Whether the **webhook** has marked this order paid. Not whether the customer reached here. */
  paid: boolean
  shippingMinor?: null | number
  taxMinor?: null | number
  /** The order number a customer would quote. GA4 dedupes server-side on this too. */
  transactionId: string
  valueMinor: number
}) {
  const fired = useRef(false)

  const payload = useRef({ currency, items, shippingMinor, taxMinor, transactionId, valueMinor })

  /*
   * The "latest ref" pattern, written in an effect rather than during render because
   * `react-hooks/refs` forbids the latter — and is right to: a ref written during render is a value
   * React cannot see, so a re-render triggered by anything else reads whatever the last render left
   * behind. Declared **before** the effect that reads it, because React runs effects in order.
   */
  useEffect(() => {
    payload.current = { currency, items, shippingMinor, taxMinor, transactionId, valueMinor }
  })

  useEffect(() => {
    if (!paid || fired.current) {
      return
    }

    const key = `north01:purchase:${transactionId}`

    let alreadySent = false

    try {
      alreadySent = window.sessionStorage.getItem(key) !== null
    } catch {
      /* Blocked storage. Fall through and send — see the docblock on which way this trade goes. */
    }

    if (alreadySent) {
      fired.current = true

      return
    }

    fired.current = true

    try {
      window.sessionStorage.setItem(key, '1')
    } catch {
      /* Same. The mark is best-effort; the ref still covers this page view. */
    }

    trackEvent('purchase', payload.current)
  }, [paid, transactionId])

  return null
}
