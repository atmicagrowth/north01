import 'server-only'

import { unstable_cache } from 'next/cache'
import { cache } from 'react'

import {
  EMPTY_HOME,
  railRequests,
  railWhere,
  resolveHome,
  type HomeContent,
  type RailProducts,
} from '@/lib/home/resolve'
import { getPayloadClient } from '@/lib/payload'
import { DEFAULT_CURRENCY, type CurrencyCode } from '@/payload/fields/money'

/**
 * **The reads that build the homepage.**
 *
 * A *loader*, and nothing else — the same split `lib/navigation/shell.ts` uses and for the same
 * reason. Every rule about what a resolved homepage looks like lives in `resolve.ts`, which imports
 * nothing from Next and nothing from the server, so `scripts/verify-home.ts` can exercise all of it
 * outside a request. What is left here is caching and a try/catch, and caching is the one thing that
 * cannot be tested from a CLI.
 *
 * ### Two caches, doing two different jobs
 *
 * - **`cache()`** — React's per-render memo, so the page and its metadata are one read.
 * - **`unstable_cache`** — Next's cross-request data cache, which is what stops every visitor paying
 *   for a global read plus a query per rail. It carries the **`home` tag**, and
 *   `payload/hooks/revalidateTags.ts` calls `revalidateTag` when the homepage global or a campaign
 *   is saved, so an editor's change reaches the storefront without a deployment. The 300-second
 *   `revalidate` is the floor under that.
 *
 * `unstable_cache` is still the correct API here. Next 16's own documentation says it *"has been
 * replaced by `use cache`"* — but only under **Cache Components**, which `next.config.mjs` does not
 * enable, so `'use cache'`, `cacheTag` and `cacheLife` are unavailable. Turning that flag on changes
 * PPR, `loading.js` and `generateMetadata` semantics across every route and is not a homepage
 * decision. This is the same model, and the same reasoning, as the shell.
 *
 * **This is what keeps `/` a static route.** The build prerenders the homepage and stamps the cache
 * tags that `unstable_cache` contributed onto the route's entry, which is how a `revalidateTag`
 * call reaches prerendered HTML at all. An *uncached* read would make `/` dynamic; a cached but
 * *untagged* one would make an editor's save invisible for five minutes. Nothing in here may read
 * `cookies()` or `headers()` — it is forbidden inside a cache scope and would do the same damage.
 *
 * ### Failure degrades one section, or fails the render — never a cached blank page
 *
 * There are two failure scales here and they are handled differently on purpose.
 *
 * **One rail, or the settings read.** Each is caught individually, so a single failing query costs
 * that rail and nothing else. This is the same rule `home-sections.tsx` applies to an unrecognised
 * block — *"must cost that section and not the homepage"* — and the settings read has literal
 * fallbacks three lines below it anyway.
 *
 * **The homepage global itself.** `getHome` returns `degraded: true`, and `page.tsx` **throws** on
 * it. That is deliberate and it is a correction: the first version of this module documented "never
 * throws" as a virtue, and it was the opposite.
 *
 * `/` is a statically prerendered route with a 300-second revalidate, so a *background regeneration*
 * renders the page and ISR stores whatever came back. A function that cannot throw therefore returns
 * a perfectly valid empty homepage, Next caches that **200**, and the blank page replaces the good
 * HTML for the next five minutes — outliving the database blip that caused it. A render that throws
 * fails the regeneration, and Next keeps serving the last good HTML instead. The `try` around the
 * *call* still does its job for the data cache; the route cache is a second cache the original
 * reasoning did not account for.
 *
 * At build time the same throw fails `pnpm build`, which is already the documented behaviour in
 * decision **D-32**'s table: *"a deploy against a broken database fails loudly rather than silently
 * baking a fallback site."*
 *
 * There is no fallback *content* here, and that is the difference from the shell. `fallback.ts`
 * reproduces the site's information architecture, which is a fact about the site; a homepage is
 * entirely merchandising, and inventing a campaign would put words in an editor's mouth.
 */

export const HOME_CACHE_TAG = 'home'

/**
 * `depth: 2`, and the number is not a guess.
 *
 * Depth is hops, exactly. `hero.campaign` is hop 1; the campaign's `hero` image, its `cta.reference`
 * and its `collection` are hop 2. `productGroup.products[]` is hop 1 and each product's
 * `gallery[].image` is hop 2. `categoryTiles.items[].category.image` and
 * `collectionFeature.collection.heroMedia` are likewise hop 2.
 *
 * **At `depth: 1` the homepage renders with no photographs and no resolvable calls to action** —
 * every one of those would arrive as a bare id, which `resolve.ts` correctly treats as absent.
 */
const GLOBAL_DEPTH = 2

/** One hop is enough for a rail: `gallery[].image` is the only thing a tile reads. */
const RAIL_DEPTH = 1

type LoadedHome = {
  content: HomeContent
  currency: CurrencyCode
  locale: string
  siteName: string
}

const loadHome = unstable_cache(
  async (): Promise<LoadedHome> => {
    const payload = await getPayloadClient()

    /*
     * The homepage read is allowed to reject — it is the page. The settings read is not: every value
     * it supplies has a literal fallback below, so losing it should cost the currency format, not
     * the storefront.
     */
    const [homepage, settings] = await Promise.all([
      payload.findGlobal({ slug: 'homepage', depth: GLOBAL_DEPTH }),
      payload.findGlobal({ slug: 'site-settings', depth: 0 }).catch((error) => {
        console.error('[home] Site settings could not be read; using defaults.', error)

        return null
      }),
    ])

    const currency = (settings?.defaultCurrency ?? DEFAULT_CURRENCY) as CurrencyCode
    const locale = settings?.defaultLocale?.trim() || 'en-US'
    const siteName = settings?.siteName?.trim() || 'NORTH / 01'

    /*
     * One query per rail block, in parallel. `railRequests` reads the blocks; `railWhere` builds the
     * filter — both in the pure module, so the published-state clauses are asserted by the
     * verification script rather than by reading this file.
     *
     * The limit is applied in the query rather than after resolution. A rail whose products all drop
     * at render therefore comes back short, which is the honest outcome: over-fetching to guarantee
     * a full row would mean querying for products we have already decided not to show.
     */
    const now = new Date().toISOString()
    const requests = railRequests(homepage)

    const rails: RailProducts = new Map(
      await Promise.all(
        requests.map(async ({ key, source, limit }) => {
          /*
           * One rail failing must not take the page. The resolver drops a rail whose product list is
           * empty, so an empty array degrades to exactly one missing section.
           */
          const docs = await payload
            .find({
              collection: 'products',
              depth: RAIL_DEPTH,
              limit,
              pagination: false,
              sort: ['sortOrder', '-publishedAt'],
              where: railWhere(source, now),
            })
            .then((result) => result.docs)
            .catch((error) => {
              console.error(`[home] The ${source} rail could not be read; dropping it.`, error)

              return []
            })

          return [key, docs] as const
        }),
      ),
    )

    return {
      content: resolveHome({ homepage, rails, currency, locale }),
      currency,
      locale,
      siteName,
    }
  },
  ['north01-home'],
  { tags: [HOME_CACHE_TAG], revalidate: 300 },
)

export type Home = LoadedHome

/** The resolved homepage. Never throws. */
export const getHome = cache(async (): Promise<Home> => {
  try {
    return await loadHome()
  } catch (error) {
    /*
     * Logged, not swallowed — for the same reason the shell logs: an empty homepage and an
     * unreachable database look identical on screen and could not be more different to an operator.
     */
    console.error('[home] The homepage could not be read; rendering the empty state.', error)

    return {
      content: { ...EMPTY_HOME, degraded: true },
      currency: DEFAULT_CURRENCY,
      locale: 'en-US',
      siteName: 'NORTH / 01',
    }
  }
})
