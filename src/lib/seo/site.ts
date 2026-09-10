import 'server-only'

import type { Metadata } from 'next'

import { unstable_cache } from 'next/cache'
import { cache } from 'react'

import type { Media } from '@/payload-types'

import { siteUrl } from '@/lib/env.server'
import { getPayloadClient } from '@/lib/payload'

import { buildMetadata, richTextToPlainText, trimDescription } from './metadata'
import { socialImageUrl } from './image'
import { EMPTY_DOCUMENT_SEO, type DocumentSeo } from './document'

/**
 * **The site-wide half of §24.1a**, and the reason it is read from the CMS rather than hard-coded.
 *
 * `site-settings` has carried `siteName`, `defaultSeoTitle`, `defaultSeoDescription`, `defaultOgImage`
 * and `logo` since **Phase 6**. Until this phase **nothing read any of them.** That is the same
 * defect Phase 23 found in the `gallery` and `pullQuote` blocks — a CMS field that silently discards
 * an editor's work — and it is worse here, because the fields sit in a settings screen that looks
 * like it is configuring exactly this.
 *
 * ### Cached the way the rest of the settings are
 *
 * `unstable_cache` tagged `site-settings`, which `SiteSettings.afterChange` already revalidates, and
 * `cache()` on top so a single render reads it once. Both layers were established by
 * `getCatalogSettings`; metadata runs on every page, so a per-request `findGlobal` would be the most
 * frequent query in the application.
 *
 * ### It fails open, and — the part the first version got wrong — it does not remember failing
 *
 * A settings global that cannot be read produces the built-in defaults rather than an exception.
 * `generateMetadata` throwing takes the **page** down, not just its `<head>`, and a database blip
 * should not turn every product page into a 500 to avoid a generic `<title>`.
 *
 * But the fallback belongs **outside** `unstable_cache`, not inside it. The first version caught the
 * error on the `findGlobal` itself, which meant the cached function returned successfully with blank
 * defaults — so Next stored those blanks for **300 seconds**, and every page rendered during that
 * window carried them long after the database recovered. Two failures in one: the error was also
 * never logged, because nothing ever threw.
 *
 * Letting it throw is what makes both right. `unstable_cache` does not store a rejected promise, so
 * the next request tries again; `getSeoDefaults` catches, logs, and falls back **for that request
 * only**. It is the same argument the homepage's `degraded` throw makes in `home.ts`: the danger is
 * not the outage, it is writing the outage into a cache that outlives it.
 */
export type SeoDefaults = {
  description: null | string
  /** The brand mark, for `Organization.logo`. Distinct from the OG card, which is a photograph. */
  logo: Media | null
  ogImage: Media | null
  siteName: string
  title: null | string
}

const FALLBACK_SITE_NAME = 'NORTH / 01'

const text = (value: unknown): null | string => {
  const trimmed = typeof value === 'string' ? value.trim() : ''

  return trimmed.length > 0 ? trimmed : null
}

const loadSeoDefaults = unstable_cache(
  async (): Promise<SeoDefaults> => {
    const payload = await getPayloadClient()

    /*
     * `depth: 1` so the OG image arrives populated — an id cannot produce a URL. **Not** wrapped in
     * a `.catch()`: see the docblock. A failure must propagate out of the cached function so it is
     * not the thing that gets cached.
     */
    const settings = await payload.findGlobal({ slug: 'site-settings', depth: 1 })

    return {
      description: text(settings?.defaultSeoDescription),
      logo:
        typeof settings?.logo === 'object' && settings.logo !== null
          ? (settings.logo as Media)
          : null,
      ogImage:
        typeof settings?.defaultOgImage === 'object' && settings.defaultOgImage !== null
          ? (settings.defaultOgImage as Media)
          : null,
      siteName: text(settings?.siteName) ?? FALLBACK_SITE_NAME,
      title: text(settings?.defaultSeoTitle),
    }
  },
  ['north01-seo-defaults'],
  { revalidate: 300, tags: ['site-settings'] },
)

export const getSeoDefaults = cache(async (): Promise<SeoDefaults> => {
  try {
    return await loadSeoDefaults()
  } catch (error) {
    console.error('[seo] Site settings could not be read; using built-in defaults.', error)

    return {
      description: null,
      logo: null,
      ogImage: null,
      siteName: FALLBACK_SITE_NAME,
      title: null,
    }
  }
})

export type PageMetadataInput = {
  /** Skip the layout's title template. The homepage, and nothing else — see `SeoInput`. */
  absoluteTitle?: boolean
  /** Rich text or a plain string. Flattened and trimmed; the document's own SEO description wins. */
  description?: unknown
  /** The page's own image — a hero, a cover, a product photograph. */
  image?: Media | null
  /** `seoField()`'s overrides for this document, already normalised. */
  seo?: DocumentSeo
  /** The canonical path. No query, no trailing slash — `canonicalUrl` enforces both anyway. */
  path: string
  title: string
}

/**
 * **One call, and a page has every part of §24.1a.**
 *
 * The precedence is stated once, here, so eleven routes cannot disagree about it:
 *
 * 1. the document's own SEO override, because an editor who typed a title meant it;
 * 2. the page's own content — its name, its prose, its hero;
 * 3. the site defaults from `site-settings`;
 * 4. the built-in fallback, which exists so a fresh install is not blank.
 *
 * The image walks the same ladder, and the site default is what makes it worth having: a journal
 * article with no hero still shares with the brand's card rather than as a bare grey rectangle.
 */
export async function pageMetadata(input: PageMetadataInput): Promise<Metadata> {
  const defaults = await getSeoDefaults()
  const seo = input.seo ?? EMPTY_DOCUMENT_SEO

  const description =
    typeof input.description === 'string'
      ? input.description
      : richTextToPlainText(input.description)

  return buildMetadata({
    ...(input.absoluteTitle ? { absoluteTitle: true } : {}),
    description: trimDescription(description) ?? defaults.description,
    /*
     * Two calls, not `socialImageUrl(input.image ?? defaults.ogImage)`. The page's own image may
     * exist as a record and still produce no URL — an asset uploaded before Cloudinary was
     * configured, or a video. Choosing the record first and asking for a URL second means such a
     * page gets **no card at all** while the site default sat there unused. Ask each in turn.
     */
    image: socialImageUrl(input.image) ?? socialImageUrl(defaults.ogImage),
    overrides: {
      description: seo.description,
      image: socialImageUrl(seo.image),
      title: seo.title,
    },
    path: input.path,
    siteName: defaults.siteName,
    siteUrl,
    title: input.title,
  })
}

/** The site's own origin, for structured data and canonical URLs built outside `pageMetadata`. */
export function getSiteUrl(): string {
  return siteUrl
}
