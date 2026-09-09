import type { Collection, Edit, Media } from '@/payload-types'
import type { CurrencyCode } from '@/payload/fields/money'

import { resolveProductTile, type ProductTile } from '@/lib/home/resolve'

/**
 * **The editorial block vocabulary, resolved for any page that carries it.**
 *
 * `lib/home/resolve.ts` already resolves these blocks — and cannot be reused. Its `resolveSection` is
 * module-private and typed to `NonNullable<Homepage['sections']>[number]`, whose union does not
 * include `GalleryBlock` or `PullQuoteBlock`; widening it would mean the homepage dispatcher's
 * exhaustive `never` default rejecting two blocks the homepage can never receive. Two resolvers with
 * one shared block vocabulary is the honest shape, and the duplication is small because the hard part
 * — `resolveProductTile` — is already exported.
 *
 * ---
 *
 * ### Two blocks had no renderer at all, and that was a live defect
 *
 * `gallery` and `pullQuote` have been authorable on Collections and Edits since Phase 6, and neither
 * had a resolver case or a component anywhere. An editor could compose a page section that rendered
 * **nothing** — plan §0.1.17's rule against controls that do nothing, inverted: not a control that
 * lies, but a CMS field that silently discards work.
 *
 * Nothing had noticed because no route rendered `collections.body` yet. Phase 23 is the first phase
 * that does, so Phase 23 is where the two get built.
 *
 * ### Resolution drops, it does not throw
 *
 * The phase prompt asks to *"handle unpublished content, missing hero media, empty product
 * relationships, and deleted related products without broken pages."* Every case here returns `null`
 * for a block that cannot be rendered, and the caller filters. A collection whose figure lost its
 * image renders one section fewer; it does not render an error.
 */

export type EditorialBody =
  NonNullable<Collection['body']>[number] | NonNullable<Edit['body']>[number]

export type EditorialSection =
  | {
      key: string
      type: 'editorial'
      body: unknown
      eyebrow: null | string
      heading: null | string
    }
  | {
      key: string
      type: 'figure'
      caption: null | string
      cta: { href: string; label: string } | null
      media: Media
      mobileMedia: Media | null
      treatment: 'contained' | 'fullBleed'
    }
  | {
      key: string
      type: 'gallery'
      images: { caption: null | string; media: Media }[]
      layout: 'grid' | 'pair' | 'triptych'
    }
  | {
      key: string
      type: 'productGroup'
      heading: null | string
      intro: null | string
      products: ProductTile[]
    }
  | { key: string; type: 'pullQuote'; attribution: null | string; quote: string }
  | {
      key: string
      type: 'shopTheLook'
      heading: null | string
      hotspots: {
        label: null | string
        product: ProductTile
        tone: 'dark' | 'light'
        x: number
        xMobile: number
        y: number
        yMobile: number
      }[]
      media: Media
    }
  | {
      key: string
      type: 'splitFeature'
      body: unknown
      cta: { href: string; label: string } | null
      eyebrow: null | string
      heading: null | string
      imageSide: 'left' | 'right'
      media: Media
    }

const text = (value: unknown): null | string =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

/** A populated `Media`, or `null`. A bare id cannot be rendered, so it is treated as absent. */
const asMedia = (value: unknown): Media | null =>
  typeof value === 'object' && value !== null && 'url' in value ? (value as Media) : null

const asCta = (value: unknown): { href: string; label: string } | null => {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const cta = value as { href?: unknown; label?: unknown }
  const href = text(cta.href)
  const label = text(cta.label)

  return href && label ? { href, label } : null
}

/**
 * Resolve one block, or `null` if it cannot be rendered.
 *
 * The `key` is positional. Payload gives array rows an `id`, but it is optional on the generated type
 * and a block added before a save has none — a positional key is stable for the render it is used in,
 * which is all a key has to be.
 */
export function resolveEditorialSection(
  block: EditorialBody,
  index: number,
  context: { currency: CurrencyCode; locale: string },
): EditorialSection | null {
  const key = `${block.blockType}-${index}`

  switch (block.blockType) {
    case 'editorial': {
      /* A text block with no text is an empty section, not a section with empty text. */
      return block.body
        ? {
            body: block.body,
            eyebrow: text(block.eyebrow),
            heading: text(block.heading),
            key,
            type: 'editorial',
          }
        : null
    }

    case 'figure': {
      const media = asMedia(block.image)

      return media
        ? {
            caption: text(block.caption),
            cta: asCta(block.cta),
            key,
            media,
            mobileMedia: asMedia(block.mobileImage),
            treatment: block.treatment === 'fullBleed' ? 'fullBleed' : 'contained',
            type: 'figure',
          }
        : null
    }

    case 'gallery': {
      /*
       * Each image is validated on its own, so one broken upload costs one frame rather than the
       * gallery. The block requires at least two rows to author; if fewer than two survive, the
       * layout it was composed for no longer applies and the section is dropped.
       */
      const images = (block.images ?? [])
        .map((row) => {
          const media = asMedia(row.image)

          return media ? { caption: text(row.caption), media } : null
        })
        .filter((row): row is { caption: null | string; media: Media } => row !== null)

      return images.length >= 2
        ? {
            images,
            key,
            layout:
              block.layout === 'grid' ? 'grid' : block.layout === 'triptych' ? 'triptych' : 'pair',
            type: 'gallery',
          }
        : null
    }

    case 'productGroup': {
      const products = (block.products ?? [])
        .map((value) => resolveProductTile(value, context.currency, context.locale))
        .filter((tile): tile is ProductTile => tile !== null)

      /* The prompt's "empty product relationships": a heading above nothing is worse than nothing. */
      return products.length > 0
        ? {
            heading: text(block.heading),
            intro: text(block.intro),
            key,
            products,
            type: 'productGroup',
          }
        : null
    }

    case 'pullQuote': {
      const quote = text(block.quote)

      return quote ? { attribution: text(block.attribution), key, quote, type: 'pullQuote' } : null
    }

    case 'shopTheLook': {
      const media = asMedia(block.image)

      if (!media) {
        return null
      }

      const hotspots = (block.hotspots ?? [])
        .map((hotspot) => {
          const product = resolveProductTile(hotspot.product, context.currency, context.locale)

          /*
           * §22.1b. Zero is a legitimate coordinate, so this tests for a number rather than for
           * truthiness — the same test `lib/home/resolve.ts` makes, for the same reason.
           */
          const coordinates = [hotspot.xDesktop, hotspot.yDesktop, hotspot.xMobile, hotspot.yMobile]

          if (!product || !coordinates.every((n) => typeof n === 'number' && Number.isFinite(n))) {
            return null
          }

          return {
            label: text(hotspot.label),
            product,
            tone: hotspot.markerTone === 'dark' ? ('dark' as const) : ('light' as const),
            x: hotspot.xDesktop,
            xMobile: hotspot.xMobile,
            y: hotspot.yDesktop,
            yMobile: hotspot.yMobile,
          }
        })
        .filter((hotspot) => hotspot !== null)

      return hotspots.length > 0
        ? { heading: text(block.heading), hotspots, key, media, type: 'shopTheLook' }
        : null
    }

    case 'splitFeature': {
      const media = asMedia(block.image)

      return media
        ? {
            body: block.body,
            cta: asCta(block.cta),
            eyebrow: text(block.eyebrow),
            heading: text(block.heading),
            imageSide: block.imageSide === 'right' ? 'right' : 'left',
            key,
            media,
            type: 'splitFeature',
          }
        : null
    }

    default:
      /*
       * A block this resolver does not know costs that block, not the page. Deliberately not an
       * exhaustive `never` guard: the vocabulary is shared with the homepage, and a block added for
       * the homepage should not break a collection page at compile time — it should render nothing
       * there until somebody decides it belongs.
       */
      return null
  }
}

/** Resolve a whole `body`, dropping what cannot be rendered. */
export function resolveEditorialBody(
  body: EditorialBody[] | null | undefined,
  context: { currency: CurrencyCode; locale: string },
): EditorialSection[] {
  return (body ?? [])
    .map((block, index) => resolveEditorialSection(block, index, context))
    .filter((section): section is EditorialSection => section !== null)
}
