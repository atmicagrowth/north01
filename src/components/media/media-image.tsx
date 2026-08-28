/*
 * `@next/next/no-img-element` is disabled for this file, deliberately and with the argument written
 * out in the docblock below rather than left as a bare suppression.
 *
 * The rule's advice is *"consider `next/image` or a custom image loader"*, and this file is the
 * considered answer: `next/image`'s optimizer requires `sharp`, which this project does not install;
 * it would re-encode an image Cloudinary has already encoded, at a cost per image; and it cannot
 * render `<picture>`, which visual guide §10's art direction requires. The rule's own stated concerns
 * — LCP and bandwidth — are addressed here directly, by a clamped Cloudinary `srcset`, `f_auto`
 * negotiation, native lazy loading and `fetchpriority`.
 *
 * This is the only file in the project permitted to render a raw `<img>`. Every other surface goes
 * through `MediaImage`, which is why the exemption is one file wide.
 */
/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from 'react'

import { publicEnv } from '@/lib/env.public'
import { cn } from '@/lib/cn'
import {
  MEDIA_CONTEXTS,
  buildCloudinaryUrl,
  buildLqipUrl,
  buildSrcSet,
  reserveBox,
  type CloudinaryAsset,
  type MediaContext,
} from '@/lib/media/cloudinary-url'
import { resolveContext, type MediaRole } from '@/lib/media/roles'
import type { Media } from '@/payload-types'

/**
 * **The one way an image reaches a page.** Plan §8.1c's responsive delivery and §8.1d's missing-media
 * behaviour, in a single server component.
 *
 * ### Why not `next/image`
 *
 * Three reasons, and the first is decisive.
 *
 * 1. **Next's optimizer needs `sharp` on the server**, and this project deliberately does not install
 *    it (see `Media.ts`). Pointing `next/image` at Cloudinary would therefore either fail or fall
 *    back to serving the original unmodified.
 * 2. **It would transform an already-transformed image.** Cloudinary has just produced an AVIF at
 *    exactly the requested width; re-encoding it through a second optimizer costs money per image and
 *    can only lose quality. Two CDNs in the path is one too many.
 * 3. **A custom loader cannot express art direction.** `next/image` renders one `<img>` and derives a
 *    `srcset` from widths alone, but visual guide §10 asks for *"intentional mobile crops instead of
 *    simply squeezing desktop images into a smaller box"* — a different **aspect ratio** per
 *    breakpoint, which is `<picture>` with `media` conditions and nothing else.
 *
 * What `next/image` would otherwise have given us is native HTML now: `loading`, `decoding` and
 * `fetchpriority` are attributes, not features. So this component ships **no client JavaScript at
 * all** — it is a server component that returns markup.
 *
 * ### How layout shift is prevented, in every state
 *
 * §8.1d and §30.1b both demand it, and the mechanism is the same one for all four states: **the box
 * comes from the context, not from the asset.** `reserveBox` reads the delivery context — a property
 * of the page — so the rectangle is known before it is known whether an asset exists, whether its
 * bytes arrive, or whether the CDN 404s. `aspect-ratio` holds the space with no JavaScript and no
 * padding-top hack.
 */

/** What an `upload` field holds once populated. Unpopulated it is an id, which is not enough to render. */
export type MediaValue = Media | null | number | undefined

export type MediaImageProps = {
  media: MediaValue
  /**
   * Which of plan §8.1c's contexts to deliver. Omit it and the asset's own `role` decides — that is
   * the whole purpose of §8.1a's "media role", and the reason it is not a column nothing reads.
   */
  context?: MediaContext
  /**
   * The art-directed variant shown below 768px. Supplying it renders a `<picture>`, and this is the
   * only way to change the *crop* between breakpoints rather than just the resolution.
   *
   * The breakpoint is fixed rather than a prop. 768px is one of the eight plan §30.1a names, it is
   * Tailwind's `md`, and it is where this design system already switches every other layout — a
   * per-call breakpoint would let one image change shape at a width where nothing else does. It also
   * has to be a literal: the reserved box switches through a `max-md:` utility, and Tailwind can only
   * generate a class it can see in the source.
   */
  mobileContext?: MediaContext
  /**
   * The CSS `sizes` attribute — how wide the image will be at each breakpoint.
   *
   * **Required, and not defaulted.** A `srcset` with `w` descriptors and no `sizes` is specified to
   * fall back to `100vw`, so a thumbnail in a four-column grid would download the full-viewport
   * candidate. Every caller knows its own layout; this component cannot guess it, and guessing wrong
   * is invisible in review and expensive in production.
   */
  sizes: string
  /**
   * Above the fold. Sets `fetchpriority="high"` and disables lazy loading — plan §30.1c's *"Hero/LCP
   * image should be prioritized"*.
   */
  priority?: boolean
  /**
   * Overrides the alt text stored on the record. Pass `''` for an image that is purely decorative and
   * whose meaning is already carried by adjacent text; anything else is a mistake, because the record
   * has an author-written alt and it is required.
   */
  alt?: string
  className?: string
  /** Applied to the `<img>` itself. `object-cover` is the default and is usually right. */
  imageClassName?: string
}

/** An unpopulated relationship is a number, which cannot be rendered. */
function asRecord(media: MediaValue): Media | null {
  return typeof media === 'object' && media !== null ? media : null
}

function toAsset(record: Media): CloudinaryAsset | null {
  if (!record.cloudinaryPublicId) {
    return null
  }

  return {
    publicId: record.cloudinaryPublicId,
    resourceType: record.cloudinaryResourceType === 'video' ? 'video' : 'image',
    version: record.cloudinaryVersion ?? null,
    width: record.width ?? null,
    height: record.height ?? null,
    focalX: record.focalX ?? null,
    focalY: record.focalY ?? null,
  }
}

/**
 * **The deliberate neutral placeholder of §8.1d.**
 *
 * Flat `surface` with a hairline border — the quietest thing the palette can do that still reads as
 * intentional rather than as a failure. It is not `Skeleton`: that primitive pulses forever, which
 * says *loading*, and an image that is absent is not arriving later.
 *
 * It carries no text and no icon. There is nothing useful to say inside a product card, and visual
 * guide §11 asks for restraint over decoration. It is `aria-hidden` because a missing image is not
 * information — the surrounding content already says what the thing is, and announcing "no image"
 * would be noise in a listing of forty.
 */
function Placeholder({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden
      data-slot="media-placeholder"
      className={cn('w-full bg-surface ring-1 ring-inset ring-border', className)}
      style={style}
    />
  )
}

export function MediaImage({
  media,
  context,
  mobileContext,
  sizes,
  priority = false,
  alt,
  className,
  imageClassName,
}: MediaImageProps) {
  const record = asRecord(media)
  const resolved = resolveContext(context, record?.role as MediaRole | undefined)
  const box = reserveBox(resolved, record)
  const mobileBox = mobileContext ? reserveBox(mobileContext, record) : null

  /**
   * The box is reserved with `aspect-ratio` rather than fixed pixels, so the image is fluid but its
   * *shape* is fixed — which is exactly what §30.1b's *"fixed/known image aspect ratios"* means. The
   * `width`/`height` attributes are set as well: they are what a browser uses to reserve space before
   * CSS arrives, and omitting them reintroduces the shift on a slow stylesheet.
   *
   * **Art direction has to reserve two boxes, not one**, and the first version of this reserved only
   * the desktop one. A browser measured it: the `<picture>` correctly served a 4:5 crop below 768px
   * while the frame stayed 16:9, so the mobile hero was letterboxed into a landscape hole. Worse, it
   * was invisible in the state that actually renders today — with no asset at all the component
   * returns a placeholder, and the placeholder never consulted `mobileContext` in the first place.
   *
   * The ratio therefore travels as a custom property and is switched by a `max-md:` utility, so the
   * *reserved geometry* changes at the same breakpoint the *image source* does. Both are 768px, and
   * that is why the breakpoint is a literal rather than a prop.
   */
  const frame: CSSProperties = {
    ['--media-ar' as string]: `${box.width} / ${box.height}`,
    ...(mobileBox
      ? { ['--media-ar-mobile' as string]: `${mobileBox.width} / ${mobileBox.height}` }
      : {}),
  }

  const frameClass = mobileBox
    ? 'aspect-[var(--media-ar)] max-md:aspect-[var(--media-ar-mobile)]'
    : 'aspect-[var(--media-ar)]'

  // State 1 — there is no asset at all. The state the entire seeded catalogue is in today.
  if (!record) {
    return <Placeholder className={cn(frameClass, className)} style={frame} />
  }

  const cloudName = publicEnv.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  const asset = toAsset(record)
  const altText = alt ?? record.alt ?? ''

  /**
   * State 2 — the record exists but Cloudinary does not, which is the committed state of this
   * project and the whole of local development.
   *
   * Payload has already stored a working same-origin URL (`/api/media/file/<filename>`), so the image
   * renders; what is lost is the responsive `srcset` and the crop, because both are Cloudinary's.
   * The frame is still reserved from the context, so switching Cloudinary on later changes what fills
   * the box and never the box itself.
   */
  if (!cloudName || !asset) {
    if (!record.url) {
      return <Placeholder className={cn(frameClass, className)} style={frame} />
    }

    return (
      <div
        data-slot="media-image"
        className={cn('relative w-full overflow-hidden bg-surface', frameClass, className)}
        style={frame}
      >
        <img
          src={record.url}
          alt={altText}
          width={box.width}
          height={box.height}
          loading={priority ? 'eager' : 'lazy'}
          decoding={priority ? 'sync' : 'async'}
          fetchPriority={priority ? 'high' : undefined}
          className={cn('h-full w-full object-cover', imageClassName)}
        />
      </div>
    )
  }

  const widths = MEDIA_CONTEXTS[resolved].widths
  const desktopSrcSet = buildSrcSet({ cloudName, asset, context: resolved })
  const desktopFallback = buildCloudinaryUrl({
    cloudName,
    asset,
    context: resolved,
    // The largest candidate, as the `src` a browser without `srcset` support would take. The builder
    // clamps it against the stored dimensions, so this never asks for more than the source holds.
    width: widths[widths.length - 1],
  })

  /**
   * State 3 — the asset is real and Cloudinary is configured.
   *
   * The blurred 24-pixel copy is the *background* of the frame rather than a second `<img>`: it costs
   * 120 bytes, needs no JavaScript to swap out, and means the photograph fades in over its own
   * colours instead of over a grey rectangle. It also covers **state 4** for free — if delivery 404s,
   * the browser paints the alt text over the blur inside an already-reserved box, which is a
   * deliberate-looking absence rather than a broken-image icon and a jump.
   */
  const blur: CSSProperties = {
    ...frame,
    backgroundImage: `url("${buildLqipUrl({ cloudName, asset, context: resolved })}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }

  const image = (
    <img
      src={desktopFallback}
      srcSet={mobileContext ? undefined : desktopSrcSet}
      sizes={mobileContext ? undefined : sizes}
      alt={altText}
      width={box.width}
      height={box.height}
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      fetchPriority={priority ? 'high' : undefined}
      className={cn('h-full w-full object-cover', imageClassName)}
    />
  )

  return (
    <div
      data-slot="media-image"
      className={cn('relative w-full overflow-hidden bg-surface', frameClass, className)}
      style={blur}
    >
      {mobileContext ? (
        <picture>
          {/*
            Art direction, and the reason this component renders `<picture>` at all. The mobile source
            is a different CROP, not a smaller copy — visual guide §10. It comes first because a
            browser takes the first matching `<source>`.
          */}
          <source
            media="(max-width: 767.98px)"
            srcSet={buildSrcSet({ cloudName, asset, context: mobileContext })}
            sizes={sizes}
          />
          <source srcSet={desktopSrcSet} sizes={sizes} />
          {image}
        </picture>
      ) : (
        image
      )}
    </div>
  )
}
