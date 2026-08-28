import path from 'path'
import { fileURLToPath } from 'url'

import type { CollectionConfig } from 'payload'
import { ValidationError } from 'payload'

import { publicEnv } from '../../lib/env.public'
import { ACCEPTED_MIME_TYPES, MAX_IMAGE_DIMENSION } from '../../lib/media/limits'
import { MEDIA_ROLE_OPTIONS } from '../../lib/media/roles'
import { anyone, isAdmin, isStaff, nobodyField } from '../access'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * The cloud name reaches this file through the **browser-safe** environment tier, which is the only
 * one `src/payload/**` is allowed to import — `env.core` is fenced by ESLint to four paths (**D-14**)
 * and `env.server` cannot resolve `server-only` under the tsx loader the Payload CLI uses.
 *
 * That is not a workaround, it is the correct tier: a Cloudinary cloud name is a path segment of
 * every delivery URL the browser fetches, so it is public by construction. The API key and secret are
 * a different matter entirely and never come near this file — see `payload/storage/cloudinary.ts`.
 */
const CLOUDINARY_CLOUD_NAME = publicEnv.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME

/**
 * Images and video — Payload holds the metadata, Cloudinary holds and delivers the bytes.
 *
 * **This collection was created in Phase 6 and filled in here**, which is deviation **DEV-28**: an
 * `upload` field needs a collection to point at, and twenty-three of them across nine collections,
 * five blocks and two globals needed one before Phase 8 arrived. Phase 6 built the skeleton — a
 * `staticDir`, a required `alt`, an optional `caption` — and left everything below.
 *
 * ### What Phase 8 added, and why each thing is here
 *
 * **`mimeTypes` is a security control, not a convenience.** Payload's `checkFileRestrictions` has two
 * mutually exclusive branches, and which one runs depends entirely on whether this key is set. With it
 * absent — the state this collection was in until now — there is **no content inspection at all**: the
 * only defence is a case-insensitive `endsWith` against a list of dangerous extensions plus an equality
 * test on the MIME type *the browser claimed*. Renaming `payload.sh` to `photo.jpg` defeats both.
 * Setting `mimeTypes` switches on `file-type`'s magic-byte sniffing, which reads the actual bytes.
 * Plan §8.1b's *"Do not accept arbitrary executable files"* is only true with this key present.
 *
 * **SVG is excluded deliberately, and it is not an oversight about vector logos.** An SVG is a script
 * execution context wearing an image's clothing, and Payload's own `validateSvg` has a hole: a file
 * beginning with an `<?xml …?>` declaration is sniffed as `application/xml`, relabelled to
 * `image/svg+xml`, and then **skips validation entirely** because the relabelling happens inside the
 * branch the validator guards. Excluding it from this list means the relabelled file fails the
 * allowlist test instead, which is the only reliable place to stop it. A logo ships as PNG.
 *
 * **Video is included** because `products.video` (plan §6.1b) is an upload field pointing here. An
 * allowlist of still images would have quietly broken a Phase 6 field.
 *
 * **`crop: false`, and no `sharp`.** Payload's crop tool needs `sharp`, and without it the UI renders
 * and silently discards the crop — *"UI that looks functional but silently does nothing"*, which this
 * project forbids outright. Installing `sharp` would fix the silence and still leave the tool wrong:
 * every delivered variant is re-derived from the **original** through Cloudinary, so a crop stored
 * here would be ignored by the thing that actually produces the image. A tool whose output is
 * discarded downstream should not be on the screen. Framing is expressed through the focal point
 * below, which the delivery layer genuinely reads.
 *
 * **`focalPoint: true` is explicit because the default hides it.** Payload shows the picker only when
 * `imageSizes`, `resizeOptions`, or an exact `focalPoint === true` is present, and this collection has
 * none of the first two. The columns have existed since Phase 6 — `focal_x`, `focal_y` — because
 * Payload adds them unless focal point is switched off; Phase 8 is what makes them mean something.
 */
export const Media: CollectionConfig = {
  slug: 'media',

  admin: {
    useAsTitle: 'filename',
    defaultColumns: ['filename', 'alt', 'role', 'mimeType', 'updatedAt'],
    group: 'Content',
    description:
      'Images and video. Payload holds the metadata; Cloudinary delivers the bytes and performs every crop and resize.',
  },

  upload: {
    /**
     * **The fallback, not the destination.** When Cloudinary is configured the storage plugin sets
     * `disableLocalStorage: true` and nothing is written here at all; this path is what makes local
     * development work with no credentials, which is the state the project is committed in.
     *
     * `<repo>/media`, git-ignored since Phase 1. Outside `src/`, because everything under `src/` is
     * source the build compiles and the repository tracks, and an uploaded file is neither. Resolved
     * from this file rather than `process.cwd()` because the `payload` CLI, `next dev` and the
     * production server are three different working directories.
     *
     * It remains development-only in effect: a serverless filesystem is ephemeral, so a deployment
     * with no Cloudinary configured would lose its uploads. `lib/env.core.ts` warns about exactly
     * that at startup rather than letting it be discovered later.
     */
    staticDir: path.resolve(dirname, '../../../media'),

    /**
     * The allowlist that turns on magic-byte inspection — see the note above. Formats are named
     * explicitly rather than with an `image/*` wildcard, because a wildcard would readmit SVG through
     * the back door.
     *
     * AVIF and WebP are accepted as *sources* even though Cloudinary's `f_auto` is what decides the
     * delivered format: an editor exporting from a modern tool should not be told their file is
     * unacceptable.
     */
    mimeTypes: [...ACCEPTED_MIME_TYPES],

    crop: false,
    focalPoint: true,

    /**
     * **A function, so no `sharp` and no `imageSizes` are needed to have a thumbnail.**
     *
     * Payload's `thumbnailURL` afterRead hook returns whatever this returns, short-circuiting before
     * it would otherwise look for a stored derivative. So the admin list gets a real, cheap,
     * Cloudinary-cropped thumbnail — and when Cloudinary is unconfigured it falls back to the local
     * URL Payload already produced, at full size, which is correct rather than broken.
     */
    adminThumbnail: ({ doc }) => {
      const record = doc as {
        cloudinaryPublicId?: null | string
        mimeType?: null | string
        url?: null | string
      }

      if (!record.cloudinaryPublicId || !CLOUDINARY_CLOUD_NAME) {
        return record.url ?? null
      }

      const kind = record.mimeType?.startsWith('video/') ? 'video' : 'image'

      return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/${kind}/upload/c_fill,g_auto,ar_1:1,w_120/f_auto,q_auto/${record.cloudinaryPublicId}`
    },

    /**
     * **Off.** Payload's "paste from URL" button defaults to on and makes the *browser* fetch an
     * arbitrary URL and hand the bytes back. Server-side fetching only engages with an explicit
     * allowlist, and there is nothing in the corpus asking for ingest-by-URL. An upload path nobody
     * asked for is attack surface nobody is watching.
     */
    pasteURL: false,
  },

  /**
   * Public read, because a media record is the metadata for an asset the storefront renders — alt
   * text, dimensions, credit — and an image referenced by a published page is public by construction.
   *
   * This governs the *record*, not the file. With Cloudinary configured the bytes are served from
   * `res.cloudinary.com`, which Payload's access control never sees, so **anything that must not be
   * public must not be uploaded here.** Nothing in the corpus asks for private media.
   */
  access: {
    read: anyone,
    create: isStaff,
    update: isStaff,
    delete: isAdmin,
  },

  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      admin: {
        description:
          'What the image shows, for screen readers and for when it fails to load. Describe the subject, not the file.',
      },
    },
    {
      name: 'caption',
      type: 'text',
      admin: {
        description: 'Optional. Rendered beside editorial imagery where the layout calls for it.',
      },
    },
    {
      /**
       * **Plan §8.1a's "Media role" — a term the corpus uses once and never defines.**
       *
       * The string appears exactly once in all six specification documents (plan §8.1a's bullet list)
       * and no document says what a role is, enumerates values, or names anything that reads one. It
       * is a specification gap of the same kind as **G-01**–**G-14**, and it is recorded as one.
       *
       * The reading taken here is the only one that makes it a column worth having: **a role names
       * the delivery context an asset defaults to.** An editor who uploads a campaign frame gets hero
       * framing without every consumer restating it, and a consumer that knows better always wins.
       * The alternative reading — a taxonomy label for filtering the media library — would be a
       * column nothing reads, which is the fake-functionality trap in database form.
       */
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'editorial',
      index: true,
      options: [...MEDIA_ROLE_OPTIONS],
      admin: {
        position: 'sidebar',
        description:
          'How this asset is framed by default. Any page may override it; this is what it does when nobody says otherwise.',
      },
    },
    {
      /**
       * §8.1a lists *"Asset ID"* and *"Public identifier"* as two separate things to store, and in
       * Cloudinary's vocabulary they genuinely are two.
       *
       * `public_id` is the addressable name — folder plus filename — and it is what every delivery
       * URL is built from. `asset_id` is an opaque identifier that survives a rename or a move
       * between folders, which `public_id` does not. Storing only the first would mean an asset
       * reorganised in the Cloudinary console becomes unfindable from this row.
       *
       * Both are written by the storage adapter through the value it returns from `handleUpload`, and
       * neither is editable: they are Cloudinary's facts about an object, and a hand-typed one is a
       * row pointing at somebody else's picture.
       */
      name: 'cloudinaryPublicId',
      type: 'text',
      index: true,
      access: { create: nobodyField, update: nobodyField },
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Set by Cloudinary at upload. Every delivery URL is built from this.',
      },
    },
    {
      name: 'cloudinaryAssetId',
      type: 'text',
      access: { create: nobodyField, update: nobodyField },
      admin: {
        readOnly: true,
        position: 'sidebar',
        description:
          'Cloudinary’s own identifier. Survives a rename or a move; the public id does not.',
      },
    },
    {
      /**
       * **Which Cloudinary delivery namespace the asset lives in — and the reason it is a column
       * rather than a one-line derivation from `mimeType`.**
       *
       * The obvious implementation is `mimeType.startsWith('video/') ? 'video' : 'image'`, and it is
       * wrong. The `mimeType` Payload stores is the string the *browser* put in the multipart body,
       * and nothing ever validates it: `checkFileRestrictions` sniffs the buffer and compares the
       * sniffed type against the allowlist, but never writes it back. A file can therefore pass every
       * upload rule and still carry a MIME string that is a lie.
       *
       * A lie here is not cosmetic. Cloudinary serves `/image/upload/…` and `/video/upload/…` from
       * different namespaces, so a wrong namespace is a 404 on every rendering of that asset. This
       * column is written from Cloudinary's own response, which is the only authoritative statement
       * of where the bytes actually went. (The adapter also corrects `mimeType` itself from
       * Cloudinary's decoded format, so the two agree from then on.)
       */
      name: 'cloudinaryResourceType',
      type: 'text',
      access: { create: nobodyField, update: nobodyField },
      admin: {
        readOnly: true,
        position: 'sidebar',
        description:
          'image or video, as Cloudinary stored it. Decides which delivery path a URL uses.',
      },
    },
    {
      /**
       * The upload version. Included in delivery URLs so that replacing an asset invalidates every
       * cached derivative of it at once, rather than leaving stale variants at the old URL.
       */
      name: 'cloudinaryVersion',
      type: 'number',
      access: { create: nobodyField, update: nobodyField },
      admin: {
        readOnly: true,
        position: 'sidebar',
        description:
          'Set by Cloudinary at upload. Cache-busts every derived variant when an asset is replaced.',
      },
    },
  ],

  hooks: {
    /**
     * **Maximum dimensions — plan §8.1b, and Payload has no option for it.**
     *
     * The `upload` config can cap the *file size* (at the root, see `payload.config.ts`) but there is
     * nothing anywhere that caps pixels: `resizeOptions` only downscales, and only with `sharp`, and
     * it never rejects. So the rule is a hook.
     *
     * It runs `beforeValidate`, which is late enough to work: `generateFileData` populates `width` and
     * `height` earlier in the same operation, and it does so **without `sharp`** — Payload falls back
     * to a header-only byte probe covering every format this collection accepts. The dimensions are
     * therefore real, not client-supplied.
     *
     * The cap is high on purpose. It is not a quality rule about what makes a good photograph; it is a
     * guard against the decompression bomb — a 30,000 × 30,000 PNG is a few hundred kilobytes on disk
     * and 3.6 GB of memory to decode. Cloudinary itself refuses beyond 65,500 on a side, so this
     * catches it before the bytes ever leave.
     */
    beforeValidate: [
      ({ data, req }) => {
        if (!data || !req.file) {
          return data
        }

        const { width, height } = data as { height?: null | number; width?: null | number }
        const tooWide = typeof width === 'number' && width > MAX_IMAGE_DIMENSION
        const tooTall = typeof height === 'number' && height > MAX_IMAGE_DIMENSION

        if (tooWide || tooTall) {
          throw new ValidationError({
            collection: 'media',
            errors: [
              {
                path: 'filename',
                message: `This image is ${width} × ${height}. The maximum on either side is ${MAX_IMAGE_DIMENSION} pixels — export a smaller version and upload that.`,
              },
            ],
            req,
          })
        }

        return data
      },
    ],
  },
}
