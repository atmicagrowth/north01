import type { Metadata } from 'next'

/**
 * **Plan §24.1a's metadata, built in one place.**
 *
 * > *"Every indexable page needs: title, description, canonical URL, Open Graph metadata,
 * > Twitter/social image metadata where applicable."*
 *
 * Five things, and the reason they are one function rather than five fields repeated on eleven routes
 * is that four of them are derived from the other one. A page that supplies a title and a path gets a
 * canonical, an `og:title`, a `twitter:title` and a social image without having to remember any of
 * them — and cannot supply an Open Graph title that disagrees with its own `<title>`, which is the
 * failure mode of hand-written metadata.
 *
 * **No `server-only` guard and no environment import.** `siteUrl` is passed in, which keeps this
 * module drivable by `pnpm verify:seo` — the canonical rules are the part worth testing, and testing
 * them should not require booting Next.
 */

export type SeoInput = {
  /**
   * Bypass the root layout's `%s · NORTH / 01` template.
   *
   * Exactly one page needs this — the homepage, whose title **is** the site name and would otherwise
   * render as *"NORTH / 01 · NORTH / 01"*. The old homepage docblock recorded that trap and answered
   * it by exporting no metadata at all, which cost the page its canonical and its Open Graph card.
   */
  absoluteTitle?: boolean
  /** The document's own SEO overrides, where it has them. Empty means "derive it". */
  overrides?: { description?: null | string; image?: null | string; title?: null | string }
  /** Falls back to the site description when a page has nothing of its own. */
  description?: null | string
  /** `false` for anything private — §24.1d. */
  index?: boolean
  /** A social image URL, already absolute. */
  image?: null | string
  /** The route's path, always beginning with a slash and never carrying a query. */
  path: string
  siteName?: string
  siteUrl: string
  title: string
}

const SITE_NAME = 'NORTH / 01'

const FALLBACK_DESCRIPTION = 'An online-only direct-to-consumer premium apparel storefront.'

/**
 * **The canonical URL.**
 *
 * Three rules, and each one exists because a search engine treats the variants as different pages:
 *
 * 1. **No query string, ever.** `/shop?colour=bone&page=3` is a filtered view of `/shop`, and
 *    `/search?q=…` is a result set rather than a document. Canonicalising them to their own URLs
 *    would ask an index to hold every combination of every facet; canonicalising to the bare path is
 *    what says *"this is one page, seen through a filter."*
 * 2. **No trailing slash**, except at the root, which is only ever `/`.
 * 3. **Absolute, from `siteUrl`** — never from a request header. `resetPasswordEmail.ts` recorded
 *    why in Phase 7: a `Host` header is attacker-controlled, and a canonical built from one is a
 *    canonical an attacker can point at their own domain.
 */
export function canonicalUrl(siteUrl: string, path: string): string {
  const origin = siteUrl.replace(/\/+$/, '')
  const clean = `/${
    path
      .split('?')[0]
      ?.split('#')[0]
      ?.replace(/^\/+|\/+$/g, '') ?? ''
  }`

  return clean === '/' ? `${origin}/` : `${origin}${clean}`
}

/**
 * Trim a description to something a search result can show.
 *
 * Search engines truncate around 155–160 characters, and a description cut mid-word by a machine
 * reads worse than one cut at a word by us. Cut at a word boundary and add nothing — an ellipsis in a
 * meta description is a character spent saying "there was more".
 */
export function trimDescription(value: null | string | undefined, max = 155): null | string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''

  if (text.length === 0) {
    return null
  }

  if (text.length <= max) {
    return text
  }

  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')

  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()
}

/**
 * **§24.1a, assembled.**
 *
 * The document's own `seo` fields always win — `seoField()` describes them as overrides, and an
 * editor who typed a title meant it. Everything they left empty is derived.
 *
 * `index: false` produces `robots: { follow: false, index: false }` **and no canonical**, which is
 * deliberate: a canonical on a page that must not be indexed is a mixed signal, and §24.1d asks for
 * one signal.
 */
export function buildMetadata(input: SeoInput): Metadata {
  const siteName = input.siteName ?? SITE_NAME
  const indexable = input.index !== false

  const title = input.overrides?.title?.trim() || input.title
  const description =
    trimDescription(input.overrides?.description) ??
    trimDescription(input.description) ??
    FALLBACK_DESCRIPTION

  const image = input.overrides?.image || input.image || null
  const url = canonicalUrl(input.siteUrl, input.path)

  return {
    ...(indexable
      ? { alternates: { canonical: url } }
      : { robots: { follow: false, index: false } }),

    description,

    openGraph: {
      description,
      siteName,
      /*
       * The title here is the page's own, NOT the templated one. A `<title>` reads
       * "Field Jacket · NORTH / 01" because a browser tab needs the context; an Open Graph card
       * renders the site name separately, so repeating it produces "Field Jacket · NORTH / 01 —
       * NORTH / 01" in a share preview.
       */
      title,
      type: 'website',
      url,
      ...(image ? { images: [{ url: image }] } : {}),
    },

    title: input.absoluteTitle ? { absolute: title } : title,

    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      description,
      title,
      ...(image ? { images: [image] } : {}),
    },
  }
}

/**
 * A `Metadata` for a page that must never be indexed — §24.1d.
 *
 * Cart, checkout, account, auth. One helper so the shape cannot drift between eleven routes, and so
 * that "is this private?" is a single word at the top of a file rather than a nested object somebody
 * has to read carefully.
 */
export function privateMetadata(title: string): Metadata {
  return { robots: { follow: false, index: false }, title }
}

/** An absolute URL for a stored media record, or `null`. Relative paths are made absolute. */
export function absoluteImageUrl(siteUrl: string, url: null | string | undefined): null | string {
  if (typeof url !== 'string' || url.length === 0) {
    return null
  }

  if (/^https?:\/\//i.test(url)) {
    return url
  }

  return `${siteUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
}

/**
 * **Lexical rich text, flattened to a sentence.**
 *
 * A meta description is plain text, and most of the descriptions this shop has are rich text: a
 * collection's `description`, an edit's `intro`, a product's `description`. Rather than ask editors
 * for a second, plain copy of prose they have already written, the first paragraphs are flattened
 * here and trimmed by `trimDescription`.
 *
 * The walk is deliberately structure-agnostic — it collects `text` from any node that has one and
 * recurses into any `children` array — because it runs against stored JSON, and stored JSON outlives
 * the editor version that wrote it. A node shape this does not recognise costs its own text, not the
 * description.
 *
 * Block-level nodes are separated by a space so two paragraphs do not run together into one word.
 */
export function richTextToPlainText(value: unknown, limit = 400): string {
  const parts: string[] = []
  let length = 0

  const walk = (node: unknown): void => {
    if (length > limit || node === null || typeof node !== 'object') {
      return
    }

    if (Array.isArray(node)) {
      for (const child of node) walk(child)

      return
    }

    const record = node as { children?: unknown; root?: unknown; text?: unknown }

    if (typeof record.text === 'string' && record.text.length > 0) {
      parts.push(record.text)
      length += record.text.length + 1
    }

    if (record.root !== undefined) {
      walk(record.root)
    }

    if (Array.isArray(record.children)) {
      walk(record.children)
    }
  }

  walk(value)

  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
