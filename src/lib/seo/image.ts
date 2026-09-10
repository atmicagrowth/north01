import type { Media } from '@/payload-types'

import { publicEnv } from '@/lib/env.public'
import { buildSocialCardUrl } from '@/lib/media/cloudinary-url'

/**
 * **The Open Graph card URL for a stored image** — §24.1a's *"Twitter/social image metadata"*.
 *
 * `buildSocialCardUrl` was written in **Phase 8** and, until this phase, had **no caller anywhere**.
 * Its docblock says why it exists: `f_jpg` rather than `f_auto`, because a social crawler sends no
 * meaningful `Accept` header and several will not render AVIF at all, and a clamped width so a small
 * source is delivered sharp at the right ratio rather than upscaled and soft. This is the phase that
 * was meant to call it.
 *
 * ### Why the URL is Cloudinary's and not the stored `url`
 *
 * A hero is a 3:2 or a 4:5 photograph and a social card is 1.91:1. Handing a platform the original
 * means the platform crops it, badly, in a place nobody chose — most often through the middle of a
 * face. Asking Cloudinary for the card shape means the crop is the one `gravity` was configured for.
 *
 * ### A video is not a card
 *
 * `defaultOgImage` and `seo.image` are `upload` relations to `media`, and `media` holds video too.
 * Asking Cloudinary for a 1.91:1 JPEG of a video asset produces a URL in the video delivery
 * namespace that no crawler will render as an image. `resourceType` is the stored column — never
 * derived from `mimeType`, per `Media.ts` — so the check is exact.
 *
 * ### Absence is a real answer
 *
 * No Cloudinary account, an unmigrated asset, a video, or a document with no image at all: `null`, and
 * `buildMetadata` then emits a `summary` Twitter card rather than `summary_large_image`. A card
 * pointing at an image that 404s renders worse than a card with no image.
 */
export function socialImageUrl(media: Media | null | undefined): null | string {
  const cloudName = publicEnv.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME

  if (!cloudName || !media?.cloudinaryPublicId || media.cloudinaryResourceType === 'video') {
    return null
  }

  return buildSocialCardUrl({
    asset: {
      focalX: media.focalX ?? null,
      focalY: media.focalY ?? null,
      height: media.height ?? null,
      publicId: media.cloudinaryPublicId,
      resourceType: 'image',
      version: media.cloudinaryVersion ?? null,
      width: media.width ?? null,
    },
    cloudName,
  })
}
