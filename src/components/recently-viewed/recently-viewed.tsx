'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

import type { ProductCard as ProductCardModel } from '@/lib/catalog/resolve'

import { ProductCard } from '@/components/catalog/product-card'
import { createLocalList } from '@/components/local-list'
import { Section } from '@/components/layout/section'
import { PageContainer } from '@/components/layout/page-container'
import { HOME_IMAGE_SIZES } from '@/lib/home/sizes'
import { resolveRecentlyViewedAction } from '@/lib/recently-viewed/actions'
import {
  pushRecentlyViewed,
  RECENTLY_VIEWED_COPY,
  RECENTLY_VIEWED_KEY,
  readRecentlyViewed,
} from '@/lib/recently-viewed/rules'

/**
 * **Recently viewed** — plan §20.1c.
 *
 * Two components over one store, because the two halves happen on different pages: a product page
 * *records*, and any page may *render*.
 */

const store = createLocalList(RECENTLY_VIEWED_KEY, readRecentlyViewed)

/**
 * Record that this product was viewed. Renders nothing.
 *
 * An effect rather than an external-store read, because this one *writes* — it synchronises with an
 * external system, which is the use the rule against `setState`-in-effect exists to permit. It sets
 * no state and returns no markup.
 *
 * `pushRecentlyViewed` is idempotent, so strict mode's double mount and a customer refreshing the
 * page both leave one entry.
 */
export function RecordProductView({ productId }: { productId: number }) {
  useEffect(() => {
    store.set(pushRecentlyViewed(store.getSnapshot(), productId))
  }, [productId])

  return null
}

/**
 * The rail.
 *
 * **It renders nothing on the server and nothing on the first client render**, by construction: the
 * store's server snapshot is the empty list, so the markup React hydrates and the markup the server
 * sent are the same. Only then does it ask the server which of those ids are real products, and only
 * then does anything appear. That ordering is what keeps a device-local feature from making a
 * server-rendered page flicker.
 *
 * `exclude` keeps the product you are currently looking at out of its own rail, which is the one
 * entry the customer definitely does not need a link to.
 */
export function RecentlyViewed({ exclude }: { exclude?: number }) {
  const ids = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)

  const [cards, setCards] = useState<ProductCardModel[]>([])

  const wanted = ids.filter((id) => id !== exclude)
  const key = wanted.join(',')

  useEffect(() => {
    /*
     * No synchronous `setState` here — the empty case is *derived* at render below rather than
     * written into state. This repository lints a synchronous `setState` in an effect body as an
     * error, and it is right to: clearing state the render could have computed is a cascading render
     * for no reason. The asynchronous `setCards` inside the promise is a different thing, and the
     * only kind of state this component actually needs.
     */
    if (wanted.length === 0) {
      return
    }

    let live = true

    void resolveRecentlyViewedAction(wanted).then((resolved) => {
      if (live) {
        setCards(resolved)
      }
    })

    return () => {
      live = false
    }
    /*
     * Keyed on the joined ids rather than the array, because a new array with the same contents is a
     * different reference and would re-request on every render.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  /*
   * Derived, not stored. `cards` may still hold the previous answer while a new one is in flight, so
   * it is filtered against what the store currently says — which also means removing the last viewed
   * product empties the rail immediately rather than after a round trip.
   */
  const visible = cards.filter((card) => wanted.includes(card.id))

  /* Nothing viewed, or nothing that survived validation. A heading with a gap under it is worse. */
  if (visible.length === 0) {
    return null
  }

  return (
    <Section data-section="recently-viewed">
      <PageContainer>
        <h2 className="font-sans text-meta uppercase text-foreground-muted">
          {RECENTLY_VIEWED_COPY.title}
        </h2>

        <ul className="mt-m grid grid-cols-2 gap-m sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((card) => (
            <li key={card.id}>
              <ProductCard card={card} sizes={HOME_IMAGE_SIZES.recentlyViewed} />
            </li>
          ))}
        </ul>
      </PageContainer>
    </Section>
  )
}
