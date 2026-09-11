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
 *
 * ### Art direction is two things, and Phase 10 added the second
 *
 * `mobileContext` re-crops **one** asset at two ratios — the same photograph, framed upright for a
 * phone. That is what Phase 8 built and it covers most surfaces.
 *
 * `mobileMedia` supplies a **different asset** for narrow screens, and it exists because the schema
 * already promised it: `campaigns.mobileHero` has been in the data model since Phase 6, described as
 * a portrait crop with a docblock citing plan §10.1b's *"Mobile media"* — and until Phase 10 there
 * was no way to render it. The field was unreachable, which is the CMS half of §0.1.17's fake
 * control.
 *
 * The two compose: `mobileMedia` decides *which* asset the mobile `<source>` uses, `mobileContext`
 * decides how it is cropped, and either may be used without the other. When `mobileMedia` is absent
 * the behaviour is exactly what it was before — §10.1b's *"Mobile image omitted: use safe fallback"*
 * is therefore satisfied by doing nothing, which is the right shape for a fallback.
 *
 * **The reserved mobile box follows the asset that will actually be served.** That matters for an
 * uncropped context, where `reserveBox` reads the asset's own dimensions: reserving from the desktop
 * record while delivering the mobile one is the letterboxing defect Phase 8 measured, reintroduced
 * through a different door.
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
   * A **different asset** below 768px — a portrait frame shot for the phone, not a re-crop of the
   * landscape one. `campaigns.mobileHero` is the field this exists for.
   *
   * Absent, the mobile `<source>` uses `media` (re-cropped by `mobileContext` if one is given),
   * which is plan §10.1b's *"safe fallback"*. Present without `mobileContext`, it is delivered in
   * the same context as the desktop asset.
   *
   * The `alt` text comes from the desktop record either way: `<picture>` has one `<img>` and
   * therefore one accessible name, so a differing `alt` on the mobile asset is deliberately unused.
   */
  mobileMedia?: MediaValue
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

/** Exported for the one delivery that is not an `<img>`: the product video's `poster`. */
export function toAsset(record: Media): CloudinaryAsset | null {
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
 *
 * ### `data-sizes` is the only thing here that is not for the customer
 *
 * A `sizes` string is a promise about how wide the element will be, and the only way to know whether
 * it is true is to compare it with the box the element is actually laid out in. When the media
 * library has records that comparison is free — the `<img>` carries its own `sizes`. When the library
 * is empty, as it is on a fresh database, every image on the site is one of these placeholders and
 * there is nothing to measure.
 *
 * So the placeholder carries the string too. Phase 13's second sweep used it to resolve all seven of
 * the project's `sizes` strings the way a browser resolves them and check each against its rendered
 * width at ten viewports — which found four tiers over-claiming by up to 20% and one under-claiming
 * by 22%. One attribute on an `aria-hidden` box is a small price for a rule that is otherwise only
 * checkable by hand, and it disappears the moment a real image exists.
 */
function Placeholder({
  className,
  sizes,
  style,
}: {
  className?: string
  sizes?: string
  style?: CSSProperties
}) {
  return (
    <div
      aria-hidden
      data-sizes={sizes}
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
  mobileMedia,
  sizes,
  priority = false,
  alt,
  className,
  imageClassName,
}: MediaImageProps) {
  /*
   * A hero given only a mobile frame still renders. The fallback is symmetric on purpose: the
   * editor supplied one photograph and the honest thing is to show it, not to decide that the
   * wrong field was filled in.
   */
  const record = asRecord(media) ?? asRecord(mobileMedia)
  const mobileRecord = asRecord(mobileMedia) ?? record

  /**
   * Is there a genuinely different photograph for narrow screens?
   *
   * **Record identity, never Cloudinary metadata.** This test was `mobileAsset === null` — an asset
   * being derived from `cloudinaryPublicId` — which is `null` for *both* records whenever Cloudinary
   * is unconfigured. So the art-directed `<picture>` collapsed to a single `<img>` in precisely the
   * state the docblock above says it survives, and the state this project is committed in. Phase
   * 10's audit rendered it and found no `<picture>` at all.
   */
  const hasDistinctMobile = mobileRecord !== null && mobileRecord !== record

  const resolved = resolveContext(context, record?.role as MediaRole | undefined)

  /**
   * The mobile delivery context, or `null` for "no `<picture>` at all".
   *
   * A distinct mobile asset may carry its own `role`, so when the caller names no `mobileContext`
   * the context is resolved **from that record** rather than inherited from the desktop one. (The
   * comment here used to claim exactly that while the code inherited `resolved`.)
   */
  const mobileResolved: MediaContext | null =
    mobileContext ??
    (hasDistinctMobile
      ? resolveContext(undefined, mobileRecord?.role as MediaRole | undefined)
      : null)

  const box = reserveBox(resolved, record)
  /*
   * Reserve from the record that will actually be delivered. For an uncropped context `reserveBox`
   * reads the asset's own dimensions, so reserving from the desktop record while serving the mobile
   * one is the letterboxing defect Phase 8 measured, arriving through a different door.
   */
  const mobileBox = mobileResolved
    ? reserveBox(mobileResolved, hasDistinctMobile ? mobileRecord : record)
    : null

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
    return <Placeholder className={cn(frameClass, className)} sizes={sizes} style={frame} />
  }

  const cloudName = publicEnv.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  const asset = toAsset(record)
  /* `null` when the mobile source is the desktop one, or when it has no Cloudinary bytes. */
  const mobileAsset = mobileRecord && mobileRecord !== record ? toAsset(mobileRecord) : null
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
      return <Placeholder className={cn(frameClass, className)} sizes={sizes} style={frame} />
    }

    /*
     * Art direction survives here even with no CDN. The crops do not — those are Cloudinary's — but
     * a distinct `mobileMedia` is a distinct file that Payload is already serving, so the phone
     * still gets the photograph shot for it. This is the state the project is committed in, so the
     * branch is not hypothetical.
     */
    const mobileUrl = hasDistinctMobile ? (mobileRecord?.url ?? null) : null

    return (
      <div
        data-slot="media-image"
        className={cn('relative w-full overflow-hidden bg-surface', frameClass, className)}
        style={frame}
      >
        {mobileUrl ? (
          <picture>
            <source media="(max-width: 767.98px)" srcSet={mobileUrl} />
            <source srcSet={record.url} />
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
          </picture>
        ) : (
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
        )}
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
  /*
   * The blur follows the photograph that will actually be served. With a distinct mobile asset the
   * desktop blur is the wrong colours entirely, so the mobile one travels as a second custom
   * property and is switched at the same 768px breakpoint as the source and the reserved box.
   */
  const mobileLqip =
    mobileAsset && mobileResolved
      ? buildLqipUrl({ cloudName, asset: mobileAsset, context: mobileResolved })
      : null

  const blur: CSSProperties = {
    ...frame,
    ['--media-lqip' as string]: `url("${buildLqipUrl({ cloudName, asset, context: resolved })}")`,
    ...(mobileLqip ? { ['--media-lqip-mobile' as string]: `url("${mobileLqip}")` } : {}),
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }

  const blurClass = mobileLqip
    ? 'bg-[image:var(--media-lqip)] max-md:bg-[image:var(--media-lqip-mobile)]'
    : 'bg-[image:var(--media-lqip)]'

  const image = (
    <img
      src={desktopFallback}
      srcSet={mobileResolved ? undefined : desktopSrcSet}
      sizes={mobileResolved ? undefined : sizes}
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
      className={cn('relative w-full overflow-hidden bg-surface', frameClass, blurClass, className)}
      style={blur}
    >
      {mobileResolved ? (
        <picture>
          {/*
            Art direction, and the reason this component renders `<picture>` at all. The mobile
            source is a different CROP — and, when `mobileMedia` is supplied, a different
            PHOTOGRAPH — not a smaller copy. Visual guide §10. It comes first because a browser
            takes the first matching `<source>`.
          */}
          {/*
            Only when the mobile source actually differs. With a distinct `mobileMedia` record that
            has no Cloudinary id yet, `mobileAsset` is null and the same crop is requested from the
            same asset — two byte-identical `<source>`s over one file, which costs markup and buys
            nothing. Falling through to the desktop source is the same picture, honestly labelled.
          */}
          {mobileAsset || mobileResolved !== resolved ? (
            <source
              media="(max-width: 767.98px)"
              srcSet={buildSrcSet({
                cloudName,
                asset: mobileAsset ?? asset,
                context: mobileResolved,
              })}
              sizes={sizes}
            />
          ) : null}
          <source srcSet={desktopSrcSet} sizes={sizes} />
          {image}
        </picture>
      ) : (
        image
      )}
    </div>
  )
}
