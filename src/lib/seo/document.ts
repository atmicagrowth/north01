import type { Media } from '@/payload-types'

/**
 * **`seoField()`'s three overrides, normalised.**
 *
 * The group is on nine collections and has been since Phase 6, described in its own docblock as
 * *"overrides, not the metadata itself"* and *"falling back to the page's hero when unset is Phase
 * 24's job."* This is that job, and the normalisation is where the two halves of the promise are
 * kept: an empty string is **not** an override — it is an editor who cleared a field, which means
 * "derive it", not "publish an empty tag".
 *
 * No `server-only` guard and no Payload import: it takes an unknown value and returns a plain shape,
 * so `pnpm verify:seo` can drive it. That matters more here than it looks, because "empty means
 * derive" is exactly the rule a future refactor would break silently.
 */
export type DocumentSeo = {
  description: null | string
  /** Populated only. A bare relationship id cannot produce a URL, so it is the same as absent. */
  image: Media | null
  title: null | string
}

/**
 * Returned by identity for every document with no overrides, so it is frozen: a shared object handed
 * to nine collections' worth of callers is one mutation away from an editor's title appearing on a
 * page that never had one.
 */
export const EMPTY_DOCUMENT_SEO: DocumentSeo = Object.freeze({
  description: null,
  image: null,
  title: null,
})

const text = (value: unknown): null | string => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : null
}

export function documentSeo(value: unknown): DocumentSeo {
  if (value === null || typeof value !== 'object') {
    return EMPTY_DOCUMENT_SEO
  }

  const group = value as { description?: unknown; image?: unknown; title?: unknown }

  return {
    description: text(group.description),
    image:
      typeof group.image === 'object' && group.image !== null && 'id' in group.image
        ? (group.image as Media)
        : null,
    title: text(group.title),
  }
}
