import 'server-only'

import { cache } from 'react'

import type { Faq } from '@/payload-types'

import { getPayloadClient } from '@/lib/payload'

/**
 * **The support pages, read from the content that already existed.**
 *
 * Phase 28's audit found the footer linking to eight routes and **none of them existing** — every
 * `/help/*`, `/legal/*` and `/order-tracking` link on every page of the shop was a 404. Three of
 * them are answerable immediately, because the content has been in the CMS for phases:
 *
 * - `/help/faq` — the `faqs` collection, which §28.1c names as a managed surface and which, until
 *   now, **rendered nowhere**. That is the defect Phase 23 found in the `gallery` and `pullQuote`
 *   blocks: a CMS field an editor fills in and the site silently discards.
 * - `/help/shipping` and `/help/returns` — `site-settings.shippingPolicy` and `returnsPolicy`,
 *   whose own field descriptions have said *"and the shipping support page"* since Phase 6.
 *
 * `SiteSettings.ts` is explicit that these are **one policy with one source**, which is why the PDP
 * accordion and these pages read the same field rather than keeping a second copy.
 *
 * `server-only`, like every other read module here: it reaches for its own Payload client and holds
 * no decision a harness would want to drive.
 */

const STOREFRONT_ACCESS = { overrideAccess: false, user: null } as const

/** §28.1c's topics, in the order a customer meets them rather than alphabetically. */
export const FAQ_TOPICS = [
  { label: 'Orders', value: 'orders' },
  { label: 'Shipping', value: 'shipping' },
  { label: 'Returns', value: 'returns' },
  { label: 'Sizing', value: 'sizing' },
  { label: 'Product care', value: 'care' },
  { label: 'Account', value: 'account' },
] as const

export type FaqGroup = {
  entries: { answer: unknown; id: number; question: string }[]
  label: string
  topic: string
}

/**
 * Published FAQs, grouped by topic.
 *
 * **A topic with nothing published in it is not rendered.** An empty heading tells a customer the
 * page is broken; omitting it tells them nothing is missing, which is true. That is the same rule
 * `FilterPanel` applies to a facet with no options and `EditPage` applies to a product group whose
 * every product was withdrawn.
 *
 * Sorted by `sortOrder` then by question, so a merchandiser's ordering wins and ties are stable
 * rather than left to the planner.
 */
export const getFaqGroups = cache(async (): Promise<FaqGroup[]> => {
  const payload = await getPayloadClient()

  const { docs } = await payload
    .find({
      collection: 'faqs',
      depth: 0,
      limit: 200,
      pagination: false,
      sort: ['sortOrder', 'question'],
      ...STOREFRONT_ACCESS,
    })
    .catch(() => ({ docs: [] as Faq[] }))

  return FAQ_TOPICS.map(({ label, value }) => ({
    entries: (docs as Faq[])
      .filter((faq) => faq.topic === value)
      .map((faq) => ({ answer: faq.answer ?? null, id: faq.id, question: String(faq.question) })),
    label,
    topic: value,
  })).filter((group) => group.entries.length > 0)
})

export type SupportPolicy = { returns: unknown; shipping: unknown }

/**
 * The two policy documents, or `null` for either.
 *
 * `null` is a real state and the page says so, rather than rendering a heading over nothing. An
 * unreachable settings global is the same answer for the same reason — see the catalogue's readers.
 */
export const getSupportPolicies = cache(async (): Promise<SupportPolicy> => {
  const payload = await getPayloadClient()

  const settings = await payload.findGlobal({ depth: 0, slug: 'site-settings' }).catch(() => null)

  return {
    returns: settings?.returnsPolicy ?? null,
    shipping: settings?.shippingPolicy ?? null,
  }
})
