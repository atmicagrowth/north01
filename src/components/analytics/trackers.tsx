'use client'

import { useEffect, useRef, type ReactNode } from 'react'

import { trackEvent } from '@/lib/analytics/track'
import type { AnalyticsEvent, AnalyticsItem, AnalyticsPayload } from '@/lib/analytics/events'

/**
 * **The two shapes almost every §25.1a event takes**, so that instrumenting a server-rendered page
 * costs one element rather than a `'use client'` directive.
 *
 * That constraint is doing real work. `ProductCard`, `ProductPage` and every editorial page in this
 * project are Server Components, and the reason is written down in several places: the homepage's
 * performance argument rests on shipping almost no client JavaScript. Adding an `onClick` to
 * `ProductCard` to report a `select_item` would convert the most-rendered component in the shop, and
 * everything it renders, into client components — a large regression bought with an analytics event.
 *
 * So neither of these components renders anything of its own. One fires on mount; the other listens
 * at a container and reads the card that was clicked out of the DOM.
 */

/**
 * Fire one event, once, when this mounts.
 *
 * `view_item`, `quick_view_opened`, `shop_the_look_opened` and `begin_checkout` are all "this
 * happened because the customer is here" events, and *here* is a mount.
 *
 * The ref guard matters in development, where React's Strict Mode deliberately mounts, unmounts and
 * remounts every component — without it, every one of these events is double-counted on a developer's
 * machine and nowhere else, which is the worst place for a discrepancy to live.
 */
export function TrackOnMount<E extends AnalyticsEvent>({
  event,
  payload,
}: {
  event: E
  payload: AnalyticsPayload<E>
}) {
  const fired = useRef(false)

  /*
   * `payload` is an object literal at every call site, so a new reference every render. It is
   * deliberately **not** a dependency: this fires on mount, and the guard makes a second run a
   * no-op regardless.
   */
  const latest = useRef(payload)

  /*
   * The "latest ref" pattern, written in an effect rather than during render because
   * `react-hooks/refs` forbids the latter — and is right to: a ref written during render is a value
   * React cannot see, so a re-render triggered by anything else reads whatever the last render left
   * behind. Declared **before** the effect that reads it, because React runs effects in order.
   */
  useEffect(() => {
    latest.current = payload
  })

  useEffect(() => {
    if (fired.current) {
      return
    }

    fired.current = true

    trackEvent(event, latest.current)
  }, [event])

  return null
}

/**
 * **`view_item_list` on mount and `select_item` on click, for a grid of Server Components.**
 *
 * The click half is event delegation: one listener on the wrapper, reading `data-item-id` and
 * `data-item-name` off the nearest card. `ProductCard` carries those attributes and nothing else —
 * no handler, no hook, no client boundary — so a grid of forty cards ships one listener rather than
 * forty.
 *
 * ### Why the item is read from the DOM rather than matched against `items`
 *
 * Because the two can disagree, and when they do the DOM is right. A card rendered inside this
 * wrapper but absent from `items` — a recommendation row that grew a section, a future layout — is
 * still a real click on a real product, and matching against the list would silently drop it.
 * `index` comes from the list when the id is in it, which is the part `items` genuinely knows.
 *
 * The listener is on the wrapper rather than the document: a page can hold several lists, and each
 * one has to attribute its clicks to itself.
 */
export function TrackList({
  children,
  items,
  listId,
  listName,
}: {
  children: ReactNode
  items: AnalyticsItem[]
  listId: string
  listName: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const latest = useRef(items)
  const viewed = useRef(false)

  /*
   * The "latest ref" pattern, written in an effect rather than during render because
   * `react-hooks/refs` forbids the latter — and is right to: a ref written during render is a value
   * React cannot see, so a re-render triggered by anything else reads whatever the last render left
   * behind. Declared **before** the effect that reads it, because React runs effects in order.
   */
  useEffect(() => {
    latest.current = items
  })

  useEffect(() => {
    if (viewed.current || latest.current.length === 0) {
      return
    }

    viewed.current = true

    trackEvent('view_item_list', { items: latest.current, listId, listName })
  }, [listId, listName])

  useEffect(() => {
    const node = container.current

    if (!node) {
      return
    }

    const onClick = (nativeEvent: MouseEvent) => {
      const target = nativeEvent.target

      if (!(target instanceof Element)) {
        return
      }

      const card = target.closest<HTMLElement>('[data-item-id]')

      if (!card || !node.contains(card)) {
        return
      }

      const itemId = card.dataset.itemId

      if (!itemId) {
        return
      }

      const known = latest.current.find((item) => item.itemId === itemId)

      trackEvent('select_item', {
        items: [known ?? { itemId, itemName: card.dataset.itemName ?? itemId }],
        listId,
        listName,
      })
    }

    /*
     * Capture phase. A card's own click handling — the cart drawer closing itself, a hotspot
     * preventing default — can stop propagation before a bubbling listener here would ever run, and
     * a `select_item` that disappears whenever the surrounding UI does something is worse than none.
     */
    node.addEventListener('click', onClick, true)

    return () => node.removeEventListener('click', onClick, true)
  }, [listId, listName])

  /*
   * `display: contents`, so this wrapper can be dropped anywhere — including directly around a CSS
   * grid's items — without becoming a box that breaks the layout it was inserted into. It has no
   * semantics of its own to lose, which is the case where `contents` is safe.
   */
  return (
    <div className="contents" data-slot="track-list" ref={container}>
      {children}
    </div>
  )
}
