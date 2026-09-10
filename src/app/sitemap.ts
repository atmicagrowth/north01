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

    const add = (
      docs: { slug?: null | string; updatedAt?: null | string }[],
      prefix: string,
      changeFrequency: SitemapEntry['changeFrequency'],
      priority: number,
    ) => {
      for (const doc of docs) {
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

    add(products.docs, '/product', 'weekly', 0.8)
    add(categories.docs, '/shop', 'weekly', 0.7)
    add(collections.docs, '/collections', 'weekly', 0.7)
    add(edits.docs, '/edits', 'weekly', 0.6)
    add(lookbooks.docs, '/lookbook', 'monthly', 0.5)
    add(journal.docs, '/journal', 'monthly', 0.5)
  } catch {
    /* Static routes only. A degraded sitemap beats a 500 a crawler will remember. */
  }

  return buildSitemap(siteUrl, entries)
}
