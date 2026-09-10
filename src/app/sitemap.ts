import type { MetadataRoute } from 'next'

import { siteUrl } from '@/lib/env.server'
import { getPayloadClient } from '@/lib/payload'
import { publishedProductWhere } from '@/lib/catalog/query'
import { buildSitemap, STATIC_SITEMAP_ROUTES, type SitemapEntry } from '@/lib/seo/routes'

/**
 * **`/sitemap.xml`** — plan §24.1c: *"include relevant published routes."*
 *
 * ### Published means what it means everywhere else in this project
 *
 * Products go through `publishedProductWhere(now)`, which is the same predicate the shop grid, the
 * search index and every editorial page use — so a scheduled drop is not submitted before it lands,
 * and a garment with no active variant is not submitted at all. Documents are read under
 * `overrideAccess: false, user: null`, so `publishedOnly` narrows them the same way it narrows a
 * page render.
 *
 * A sitemap built from a privileged read would list drafts. That is not a small mistake: it hands a
 * crawler a URL that answers 404 to the public, and it discloses the existence of unreleased work.
 *
 * ### `lastModified` is `updatedAt`, and only where it is real
 *
 * Payload stamps it on every write. It is omitted rather than defaulted for the static routes,
 * because "today" on the homepage every day is a claim that stops meaning anything.
 *
 * ### It degrades rather than failing
 *
 * A database that cannot be reached returns the four static routes instead of a 500. A sitemap
 * missing its product URLs for an hour is a recoverable problem; a sitemap URL that answers 500 is
 * one a crawler remembers.
 */
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: SitemapEntry[] = [...STATIC_SITEMAP_ROUTES]

  try {
    const payload = await getPayloadClient()
    const now = new Date().toISOString()
    const access = { overrideAccess: false, user: null } as const

    const [products, categories, collections, edits, lookbooks, journal] = await Promise.all([
      payload.find({
        collection: 'products',
        depth: 0,
        limit: 1000,
        ...access,
        where: { and: publishedProductWhere(now) },
      }),
      payload.find({ collection: 'categories', depth: 0, limit: 200, ...access }),
      payload.find({ collection: 'collections', depth: 0, limit: 200, ...access }),
      payload.find({ collection: 'edits', depth: 0, limit: 200, ...access }),
      payload.find({ collection: 'lookbooks', depth: 0, limit: 200, ...access }),
      payload.find({ collection: 'journal', depth: 0, limit: 500, ...access }),
    ])

    /**
     * **A cap that is reached is reported.**
     *
     * Every read here is bounded, and a bound that is silently hit is the worst shape a sitemap can
     * take: the file is valid, the build is green, and a slice of the catalogue is simply not
     * submitted. Nobody finds out from the output, because the output looks exactly the same.
     *
     * `totalDocs` is what makes it detectable, and `readVariants` in `lib/product/product.ts`
     * established the pattern for the same reason.
     */
    const add = (
      page: { docs: { slug?: null | string; updatedAt?: null | string }[]; totalDocs?: number },
      prefix: string,
      changeFrequency: SitemapEntry['changeFrequency'],
      priority: number,
    ) => {
      if ((page.totalDocs ?? 0) > page.docs.length) {
        payload.logger.error(
          { prefix, read: page.docs.length, total: page.totalDocs },
          `The sitemap read hit its limit for "${prefix}". URLs are missing — raise the limit in ` +
            'src/app/sitemap.ts.',
        )
      }

      for (const doc of page.docs) {
        if (typeof doc.slug !== 'string' || doc.slug.length === 0) {
          continue
        }

        entries.push({
          changeFrequency,
          ...(doc.updatedAt ? { lastModified: new Date(doc.updatedAt) } : {}),
          path: `${prefix}/${doc.slug}`,
          priority,
        })
      }
    }

    add(products, '/product', 'weekly', 0.8)
    add(categories, '/shop', 'weekly', 0.7)
    add(collections, '/collections', 'weekly', 0.7)
    /*
     * `/edit`, singular — `documentHref` in `lib/navigation/routes.ts` is the one map every link in
     * this application goes through, and it emits `/edit/<slug>`. Phase 24 wrote `/edits` here and
     * Phase 23 had built the route directory under the same wrong spelling, so the sitemap submitted
     * URLs that answered 404 while the mega menu linked somewhere else that also did. Phase 30's
     * responsive pass found it by asking the browser for every navigation href.
     */
    add(edits, '/edit', 'weekly', 0.6)
    add(lookbooks, '/lookbook', 'monthly', 0.5)
    add(journal, '/journal', 'monthly', 0.5)
  } catch (error) {
    /*
     * **Logged, not swallowed.** Static routes only is a survivable answer; not knowing it happened
     * is not. An empty-looking sitemap and an unreachable database are indistinguishable on screen
     * and could not be more different to an operator — `home.ts` and `catalog.ts` both say so, and
     * this is the one route where the reader is a crawler that will not report the problem either.
     */
    console.error(
      '[seo] The sitemap could not be built from the database; static routes only.',
      error,
    )
  }

  return buildSitemap(siteUrl, entries)
}
