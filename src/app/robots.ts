import type { MetadataRoute } from 'next'

import { siteUrl } from '@/lib/env.server'
import { NON_INDEXABLE_PREFIXES } from '@/lib/seo/routes'

/**
 * **`/robots.txt`** — plan §24.1d: *"keep private/application routes out of indexing."*
 *
 * The disallow list is `NON_INDEXABLE_PREFIXES`, the same constant the sitemap filters on. That
 * sharing is the point: a sitemap submitting a URL `robots.txt` disallows is the classic SEO defect,
 * because it tells a crawler two things at once and which one it believes is not predictable.
 *
 * ### It lives outside the route group, and that is required rather than stylistic
 *
 * `robots.ts` and `sitemap.ts` must sit at `app/`, not `app/(frontend)/`. A route group does not
 * appear in the URL, but these two files are resolved by position in the tree, and Payload's admin
 * occupies the sibling group — putting them inside `(frontend)` would still serve them at the root
 * and tie them to a layout they do not use.
 *
 * ### Each prefix becomes three rules, and one rule would have been wrong every way
 *
 * `Disallow: /account/` matches the subtree and **not** `/account` itself, which is a real page.
 * Dropping the slash to `Disallow: /account` fixes that and breaks something else: a disallow is a
 * plain prefix match, so it would also block `/accounts-payable` — the same string-versus-path trap
 * `isIndexablePath` avoids, arriving through a different door.
 *
 * So the subtree is spelled out exactly:
 *
 * - **`/account$`** — RFC 9309 defines `$` as an end-of-match anchor, so this is the bare path and
 *   nothing that merely starts with it.
 * - **`/account/`** — everything beneath.
 * - **`/account?`** — everything with a query. This one is easy to miss and matters most on
 *   `/search`: a matched path in RFC 9309 **includes the query string**, so neither of the rules
 *   above touches `/search?q=jacket`, which is the near-duplicate the exclusion exists for.
 *
 * ### There is no `crawlDelay` and no per-agent rule
 *
 * Both are usually cargo. `crawlDelay` is ignored by Google entirely; a shop this size does not need
 * to ration a crawler; and a list of named user agents is a maintenance burden that goes stale.
 *
 * ### There is no `Host:` line either
 *
 * It is not part of RFC 9309 — a Yandex-only extension that other crawlers ignore (Phase 36, audit
 * R3-24). The canonical origin is already stated by every page's canonical link and by the sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      allow: '/',
      disallow: NON_INDEXABLE_PREFIXES.flatMap((prefix) => [
        `${prefix}$`,
        `${prefix}/`,
        `${prefix}?`,
      ]),
      userAgent: '*',
    },
    sitemap: `${siteUrl.replace(/\/+$/, '')}/sitemap.xml`,
  }
}
