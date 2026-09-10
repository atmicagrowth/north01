/**
 * **What may be indexed, and what may not** — plan §24.1c and §24.1d.
 *
 * > *"Include relevant published routes. Exclude: cart, checkout, account pages, admin, private
 * > routes."* / *"Keep private/application routes out of indexing."*
 *
 * One list, used by both the sitemap and `robots.txt`, because the two disagreeing is the classic
 * SEO defect: a sitemap that submits a URL `robots.txt` disallows tells a crawler two things at once,
 * and the one it believes is not predictable.
 *
 * Pure, so `pnpm verify:seo` can assert the exclusions without booting anything.
 */

/**
 * **Everything a crawler must be kept out of.**
 *
 * Prefixes, matched against the start of a path. Each one is here for its own reason and the reasons
 * are worth separating, because "private" is doing a lot of work in §24.1c:
 *
 * - `/cart`, `/checkout` — **application state, not documents.** A crawler indexing a cart indexes an
 *   empty one, forever, under a title that promises otherwise.
 * - `/account` — **somebody's data.** These already carry `robots: { index: false }` per page; this is
 *   the second, coarser statement of the same rule, and both are wanted: a page-level tag is only
 *   read once the page is fetched, and `robots.txt` stops the fetch.
 * - `/admin`, `/api` — **not the storefront at all.** Payload's panel and its REST surface.
 * - `/login`, `/register`, `/forgot-password`, `/reset-password` — **the doors, not the rooms.** A
 *   password-reset URL carries a single-use token; a crawler that fetched one would burn it.
 * - `/design-system` — an internal specimen sheet. Real, useful, and nobody's search result.
 * - `/search` — see the note inside the list.
 */
export const NON_INDEXABLE_PREFIXES: readonly string[] = [
  '/account',
  '/admin',
  '/api',
  '/cart',
  '/checkout',
  '/design-system',
  '/forgot-password',
  '/login',
  '/register',
  '/reset-password',
  /*
   * A search results page is a **query**, not a document. Indexing one produces a search result that
   * leads to a search result, and every distinct `?q=` is another near-duplicate of the same page.
   * The bare `/search` route is excluded with it: on its own it shows an empty state, which is not a
   * page anybody should arrive at from an index.
   */
  '/search',
]

/** Whether a path may be indexed at all — §24.1d. */
export function isIndexablePath(path: string): boolean {
  const clean = path.split('?')[0] ?? path

  return !NON_INDEXABLE_PREFIXES.some(
    (prefix) => clean === prefix || clean.startsWith(`${prefix}/`),
  )
}

export type SitemapEntry = {
  changeFrequency?: 'daily' | 'monthly' | 'weekly' | 'yearly'
  lastModified?: Date
  path: string
  priority?: number
}

/**
 * The routes that exist regardless of what is in the database.
 *
 * `priority` is a hint and a weak one — search engines have said for years that they largely ignore
 * it — so these are set to say something true about the shop's own structure rather than to plead:
 * the homepage and the shop are the way in, the editorial indexes are secondary, and nothing here
 * claims 1.0 except the front door.
 */
export const STATIC_SITEMAP_ROUTES: readonly SitemapEntry[] = [
  { changeFrequency: 'daily', path: '/', priority: 1 },
  { changeFrequency: 'daily', path: '/shop', priority: 0.9 },
  /* `/collections` and `/edit` were built in Phase 30; §24.1c wanted them from the start. */
  { changeFrequency: 'weekly', path: '/collections', priority: 0.7 },
  { changeFrequency: 'weekly', path: '/edit', priority: 0.7 },
  { changeFrequency: 'weekly', path: '/lookbook', priority: 0.6 },
  { changeFrequency: 'weekly', path: '/journal', priority: 0.6 },
  /* Phase 28 built these three from content that had been in the CMS since Phase 6. */
  { changeFrequency: 'monthly', path: '/help/faq', priority: 0.4 },
  { changeFrequency: 'monthly', path: '/help/shipping', priority: 0.4 },
  { changeFrequency: 'monthly', path: '/help/returns', priority: 0.4 },
]

/**
 * Assemble the sitemap, dropping anything that must not be indexed.
 *
 * The filter is applied **here** rather than trusted to the callers, so a future route added to the
 * document list cannot end up submitted by accident. It is the same belt-and-braces posture the rest
 * of this project takes with published-content filters: the constraint is stated where it would
 * otherwise be violated.
 */
export function buildSitemap(
  siteUrl: string,
  entries: readonly SitemapEntry[],
): {
  changeFrequency?: SitemapEntry['changeFrequency']
  lastModified?: Date
  priority?: number
  url: string
}[] {
  const origin = siteUrl.replace(/\/+$/, '')
  const seen = new Set<string>()

  return entries
    .filter((entry) => isIndexablePath(entry.path))
    .filter((entry) => {
      /* A duplicate URL in a sitemap is not an error, but it is noise a crawler has to reconcile. */
      if (seen.has(entry.path)) {
        return false
      }

      seen.add(entry.path)

      return true
    })
    .map((entry) => ({
      ...(entry.changeFrequency ? { changeFrequency: entry.changeFrequency } : {}),
      ...(entry.lastModified ? { lastModified: entry.lastModified } : {}),
      ...(entry.priority === undefined ? {} : { priority: entry.priority }),
      url: entry.path === '/' ? `${origin}/` : `${origin}${entry.path}`,
    }))
}
