import 'server-only'

import { unstable_cache } from 'next/cache'
import { cache } from 'react'

import type { Faq } from '@/payload-types'

import { SITE_SETTINGS_CACHE_TAG } from '@/lib/navigation/shell'
import {
  hasPublishedText,
  NO_LEGAL_DOCUMENTS,
  type LegalPublication,
} from '@/lib/navigation/utility'
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

/**
 * §28.1c's topics, in the order a customer meets them rather than alphabetically.
 *
 * **Exhaustive by type**, so the compiler is what keeps this list level with `Faqs.ts`. The page is
 * built by mapping this array; a seventh option added to the collection and left out here would drop
 * every answer filed under it from `/help/faq` — silently, with no empty heading and nothing logged.
 * `Faqs.ts` already records that shape of defect being found twice. Now it fails `pnpm typecheck`
 * instead (the content sweep, 2026-09-15).
 */
const FAQ_TOPIC_LABELS: Record<NonNullable<Faq['topic']>, string> = {
  account: 'Account',
  care: 'Product care',
  orders: 'Orders',
  returns: 'Returns',
  shipping: 'Shipping',
  sizing: 'Sizing',
}

export const FAQ_TOPICS = (
  ['orders', 'shipping', 'returns', 'sizing', 'care', 'account'] as const
).map((value) => ({ label: FAQ_TOPIC_LABELS[value], value }))

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
 *
 * **And no `.catch`** (sweep 1, S18). This turned a failed read into `docs: []`, which the page renders
 * as *"There are no published answers here yet."* — with HTTP 200 and indexable metadata, a false
 * statement about the shop made on the one occasion the page cannot know it. `indexOf` in
 * `lib/editorial/read.ts` removed the same pattern; the error now reaches `(frontend)/error.tsx`, which
 * offers a retry and is `noindex`.
 */
export const getFaqGroups = cache(async (): Promise<FaqGroup[]> => {
  const payload = await getPayloadClient()

  const { docs } = await payload.find({
    collection: 'faqs',
    depth: 0,
    limit: 200,
    pagination: false,
    sort: ['sortOrder', 'question'],
    ...STOREFRONT_ACCESS,
  })

  return FAQ_TOPICS.map(({ label, value }) => ({
    entries: (docs as Faq[])
      .filter((faq) => faq.topic === value)
      .map((faq) => ({ answer: faq.answer ?? null, id: faq.id, question: String(faq.question) })),
    label,
    topic: value,
  })).filter((group) => group.entries.length > 0)
})

export type SupportPolicy = {
  privacy: unknown
  returns: unknown
  shipping: unknown
  terms: unknown
}

/** A stored document if it has text, and `null` otherwise — `hasPublishedText` decides. */
const publishedOrNull = (value: unknown): unknown => (hasPublishedText(value) ? value : null)

/**
 * The four policy documents, or `null` for any of them.
 *
 * `null` is a real state and each surface answers it, rather than rendering a heading over nothing:
 * `/help/shipping` and `/help/returns` say the policy is not published yet, and `/legal/privacy` and
 * `/legal/terms` answer 404 and drop out of every link row.
 *
 * **An unreachable settings global is not that state, and throws** (sweep 1, S18). It used to be
 * caught into four nulls, so a database blip made `/help/returns` and `/help/shipping` tell customers
 * — and any crawler — with HTTP 200 that the shop had no returns or shipping policy, and made the
 * legal pages answer 404. Unpublished is something this read can know; unreadable is not, so the error
 * reaches `(frontend)/error.tsx` (a retry, `noindex`) exactly as `indexOf`, `getJournalIndex` and
 * `getLookbookIndex` already let theirs. The **links** still fail closed, in `getLegalPublication`:
 * hiding two footer links for one request is harmless, a page claiming a document does not exist is
 * not.
 *
 * **`null` means *no text*, not *no value*.** A field an editor emptied in the admin is stored as a
 * Lexical root holding one empty paragraph — truthy, and blank. Passing that through made a cleared
 * privacy notice render as a title over nothing, with the footer still linking to it. Every document
 * goes through `hasPublishedText`, so an emptied field and a field never filled in are one state.
 *
 * **Four, not two, since Phase 37.** `privacyPolicy` and `termsOfSale` closed gap **G-19** and render
 * at `/legal/privacy` and `/legal/terms`. They are read here rather than through a second module
 * because they are the same fact: one `findGlobal` against `site-settings`, four rich-text columns
 * out of it. A sibling reader would have issued a second query for the same row and given the legal
 * pages their own way to degrade.
 *
 * The name still says *support*: these are the documents the support and legal surfaces render, and
 * `/help/shipping` and `/help/returns` share the call.
 */
export const getSupportPolicies = cache(async (): Promise<SupportPolicy> => {
  const payload = await getPayloadClient()

  const settings = await payload.findGlobal({ depth: 0, slug: 'site-settings' })

  return {
    privacy: publishedOrNull(settings?.privacyPolicy),
    returns: publishedOrNull(settings?.returnsPolicy),
    shipping: publishedOrNull(settings?.shippingPolicy),
    terms: publishedOrNull(settings?.termsOfSale),
  }
})

const loadLegalPublication = unstable_cache(
  async (): Promise<LegalPublication> => {
    const payload = await getPayloadClient()

    /* **Not** wrapped in a `.catch()` — a failure must propagate so it is not what gets cached. */
    const settings = await payload.findGlobal({ depth: 0, slug: 'site-settings' })

    return {
      privacy: hasPublishedText(settings?.privacyPolicy),
      terms: hasPublishedText(settings?.termsOfSale),
    }
  },
  ['north01-legal-publication'],
  { revalidate: 300, tags: [SITE_SETTINGS_CACHE_TAG] },
)

/**
 * **Which legal documents have text — for the links, not for the pages.**
 *
 * The footer renders on every page of the shop, and it now has to know whether to offer Privacy and
 * Terms. Asking `getSupportPolicies` would put an uncached `findGlobal` into every render, which is
 * exactly what `getSeoDefaults` and `getShell` were built to avoid. So the answer is two booleans in
 * Next's data cache, under the `site-settings` tag that `SiteSettings.afterChange` revalidates, with
 * `cache()` on top so the footer, `HelpNav` and the checkout page are one read per render.
 *
 * The **pages** do not use this. `/legal/privacy` decides whether to 404 from `getSupportPolicies`,
 * which reads the row it renders; a link row one request behind a save is harmless, a page that
 * rendered a document it had just been told was empty would not be.
 *
 * **It fails closed, and does not remember failing** — the `getSeoDefaults` arrangement. A settings
 * global that cannot be read hides both links for that request; the error is logged, and nothing is
 * cached. The pages behind them do not degrade the same way — `getSupportPolicies` throws, so a page
 * that cannot read its document shows the error boundary rather than a 404 or a "not published".
 */
export const getLegalPublication = cache(async (): Promise<LegalPublication> => {
  try {
    return await loadLegalPublication()
  } catch (error) {
    console.error(
      '[help] Site settings could not be read; the legal links are hidden for this request.',
      error,
    )

    return NO_LEGAL_DOCUMENTS
  }
})
