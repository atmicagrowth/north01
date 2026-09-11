import {
  documentHref,
  isExternalHref,
  isInternalHref,
  isRoutablePath,
} from '@/lib/navigation/routes'
import type { Media, Navigation, SiteSetting } from '@/payload-types'

/**
 * **The CMS navigation record, turned into something a component can render.**
 *
 * Feature matrix §1 lists five edge cases for the global shell and three of them are resolved here,
 * before a single element exists:
 *
 * | Edge case | What happens |
 * |---|---|
 * | *Missing navigation item* | an item with no resolvable href is **dropped**, not rendered disabled |
 * | *Unpublished collection* | a reference to a draft — or to a document scheduled for a future `publishedAt` — resolves to nothing, so the item is dropped |
 * | *Broken internal route* | a reference whose target was deleted arrives as `null` (`ON DELETE SET NULL`) and is dropped; a reference to a collection with no public page is dropped by `documentHref` |
 *
 * Dropping is the whole strategy, and it is deliberate. The alternatives are worse in both
 * directions: rendering a dead link is the "broken internal route" the matrix asks us to handle, and
 * rendering a *disabled* navigation item is plan §0.1.17's fake control — a word in the header that
 * looks like a destination and is not one. A menu that is one item shorter is the only honest
 * outcome, and an empty column, an empty menu and an empty header are all reachable states that the
 * components downstream must render without complaint.
 *
 * ### Why publication is re-checked here
 *
 * `payload/access/index.ts` narrows a *public* read to published documents, but the shell is loaded
 * through the Local API, whose default is `overrideAccess: true` — so an unpublished target would
 * populate happily. The check is therefore explicit rather than inherited.
 *
 * `publishedAt` is included, which the access rule deliberately excludes. That is not a
 * disagreement: the rule's own docblock says scheduling *"is a query concern belonging to the page
 * that renders the listing"*, and a navigation menu is a listing. A collection scheduled for next
 * Tuesday must not appear in the header today, while remaining reachable by URL for review — which
 * is exactly the split the access rule describes.
 */

type PrimaryItem = NonNullable<Navigation['primary']>[number]

/** The reference union `payload/fields/link.ts` produces, identical at every depth it appears. */
type CmsReference = PrimaryItem['reference']

/** The four fields `linkFields()` contributes, wherever they are inlined. */
type CmsLink = {
  label?: null | string
  kind: 'reference' | 'url'
  reference?: CmsReference
  href?: null | string
}

export type ShellLink = {
  label: string
  href: string
  /** Leaves the site. Drives `target` and `rel` on the rendered anchor. */
  external: boolean
}

export type ShellColumn = {
  heading: null | string
  links: ShellLink[]
}

export type ShellFeature = {
  /** Populated `Media`, or `null` — an unpopulated id cannot be rendered and is treated as absent. */
  image: Media | null
  caption: null | string
  link: ShellLink | null
}

export type ShellNavItem = ShellLink & {
  columns: ShellColumn[]
  feature: ShellFeature | null
}

export type ShellFooterColumn = {
  heading: string
  links: ShellLink[]
}

export type ShellSocial = {
  platform: string
  /** The word rendered in the footer. See `site-footer.tsx` for why it is a word and not an icon. */
  label: string
  url: string
}

export type ShellNavigation = {
  primary: ShellNavItem[]
  footer: ShellFooterColumn[]
  social: ShellSocial[]
}

export type ShellAnnouncement = {
  message: string
  /** A site path or absolute URL, or `null` for a bar that is not a link. */
  href: null | string
  external: boolean
}

export type ShellSettings = {
  siteName: string
  tagline: null | string
  /** The header mark. `null` falls back to the wordmark — the field's own stated behaviour. */
  logo: Media | null
  announcement: ShellAnnouncement | null
}

/** What the header and footer render when Site Settings cannot be read. */
export const FALLBACK_SITE_NAME = 'NORTH / 01'

/**
 * The display name for each platform in the `Navigation` global's closed list.
 *
 * A lookup rather than a `toUpperCase()`, because two of the six are not their own slug in print —
 * TikTok and YouTube carry internal capitals — and because an unknown value falling through to
 * itself is better than one that has been mangled.
 */
const SOCIAL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
  youtube: 'YouTube',
  x: 'X',
  linkedin: 'LinkedIn',
}

/**
 * Is this document visible to the public right now?
 *
 * Every linkable collection carries `status`; only some carry `publishedAt` — a taxonomy is not
 * scheduled — which is why the second is read through an `in` guard rather than assumed.
 */
function isPublicDocument(document: object): boolean {
  if ((document as { status?: unknown }).status !== 'published') {
    return false
  }

  if (!('publishedAt' in document)) {
    return true
  }

  const publishedAt = (document as { publishedAt?: unknown }).publishedAt

  if (typeof publishedAt !== 'string') {
    return true
  }

  const timestamp = Date.parse(publishedAt)

  // An unparseable date is not evidence of anything; the status column already said published.
  return Number.isNaN(timestamp) || timestamp <= Date.now()
}

/** A populated reference to a published document with a public route, or `null`. */
function referenceHref(reference: CmsReference): null | string {
  if (!reference || typeof reference !== 'object') {
    return null
  }

  const { relationTo, value } = reference

  // Depth 0, or a relationship Payload could not populate: an id is not enough to build a URL.
  if (typeof value !== 'object' || value === null) {
    return null
  }

  if (!isPublicDocument(value)) {
    return null
  }

  const slug = (value as { slug?: unknown }).slug

  if (typeof slug !== 'string' || slug === '') {
    return null
  }

  return documentHref(relationTo, slug)
}

/** A typed path or absolute URL, or `null` if it is neither. */
function typedHref(href: null | string | undefined): null | string {
  if (typeof href !== 'string') {
    return null
  }

  const trimmed = href.trim()

  return isInternalHref(trimmed) || isExternalHref(trimmed) ? trimmed : null
}

/**
 * One CMS link, resolved — or `null`.
 *
 * `fallbackLabel` exists for the featured panel, whose label is optional in the schema because the
 * caption often carries the words instead.
 */
export function resolveLink(
  link: CmsLink | null | undefined,
  fallbackLabel?: string,
): ShellLink | null {
  if (!link) {
    return null
  }

  const href = link.kind === 'reference' ? referenceHref(link.reference) : typedHref(link.href)

  /* Phase 35 (P35-01): an internal link to a page that does not exist is dropped — see `PAGE_ROUTE_PATTERNS`. */
  if (!href || (!isExternalHref(href) && !isRoutablePath(href))) {
    return null
  }

  const label = (link.label ?? fallbackLabel ?? '').trim()

  if (label === '') {
    return null
  }

  return { label, href, external: isExternalHref(href) }
}

function resolveLinks(links: (CmsLink | null | undefined)[] | null | undefined): ShellLink[] {
  return (links ?? []).map((link) => resolveLink(link)).filter((link) => link !== null)
}

/** An `upload` field holds a populated document or a bare id; only the first can be rendered. */
function resolveMedia(image: (number | null) | Media | undefined): Media | null {
  return typeof image === 'object' && image !== null ? image : null
}

function resolveFeature(feature: PrimaryItem['feature']): ShellFeature | null {
  if (!feature) {
    return null
  }

  const image = resolveMedia(feature.image)
  const caption = feature.caption?.trim() || null
  const link = resolveLink(feature, caption ?? undefined)

  // A panel with neither a picture nor a caption is an empty box with a border around it.
  return image || caption ? { image, caption, link } : null
}

/**
 * The whole navigation global, resolved.
 *
 * Order is preserved exactly as the editor arranged it — array order is the only ordering the schema
 * has, and re-sorting navigation would take an editorial decision away from the person who made it.
 */
export function resolveNavigation(navigation: Navigation | null | undefined): ShellNavigation {
  const primary = (navigation?.primary ?? [])
    .map((item): ShellNavItem | null => {
      const link = resolveLink(item)

      if (!link) {
        return null
      }

      const columns = (item.columns ?? [])
        .map((column) => ({
          heading: column.heading?.trim() || null,
          links: resolveLinks(column.links),
        }))
        // A column whose every link was unpublished or deleted is a heading over nothing.
        .filter((column) => column.links.length > 0)

      return { ...link, columns, feature: resolveFeature(item.feature) }
    })
    .filter((item) => item !== null)

  const footer = (navigation?.footer ?? [])
    .map((column) => ({
      heading: column.heading?.trim() ?? '',
      links: resolveLinks(column.links),
    }))
    .filter((column) => column.heading !== '' && column.links.length > 0)

  const social = (navigation?.social ?? [])
    .filter((entry) => isExternalHref(entry.url))
    .map((entry) => ({
      platform: entry.platform,
      label: SOCIAL_LABELS[entry.platform] ?? entry.platform,
      url: entry.url,
    }))

  return { primary, footer, social }
}

/**
 * The announcement bar, or `null`.
 *
 * Three separate conditions collapse into one absent bar: the editor has not enabled it, they
 * enabled it and left the message empty, or the message is whitespace. All three mean the same thing
 * on the page — no bar — and none of them is an error.
 *
 * The href is re-validated rather than trusted. `SiteSettings.ts` validates it on save, but a row
 * written before that validator existed, or by a script, has never been through it, and this value
 * becomes an anchor's `href` on every page of the site.
 */
export function resolveAnnouncement(
  announcement: SiteSetting['announcement'] | null | undefined,
): ShellAnnouncement | null {
  if (!announcement?.enabled) {
    return null
  }

  const message = announcement.message?.trim()

  if (!message) {
    return null
  }

  const href = typedHref(announcement.href)

  return { message, href, external: href !== null && isExternalHref(href) }
}

/** The identity half of the shell. */
export function resolveSettings(settings: SiteSetting | null | undefined): ShellSettings {
  return {
    siteName: settings?.siteName?.trim() || FALLBACK_SITE_NAME,
    tagline: settings?.tagline?.trim() || null,
    logo: resolveMedia(settings?.logo),
    announcement: resolveAnnouncement(settings?.announcement),
  }
}
