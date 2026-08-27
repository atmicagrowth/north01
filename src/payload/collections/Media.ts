import path from 'path'
import { fileURLToPath } from 'url'

import type { CollectionConfig } from 'payload'

import { anyone, isAdmin, isStaff } from '../access'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * **A skeleton, on purpose.** Phase 8 owns media — Cloudinary delivery, `sharp`, responsive
 * variants, focal points, mime and dimension validation, media roles, transformation metadata
 * (plan §8.1a–d). None of that is here.
 *
 * What is here is the *target of a relationship*, and it has to exist now because Phase 6 cannot be
 * built without it. Plan §6.1a asks a global for a logo; §6.1b asks a product for a gallery and an
 * optional video; §6.1e, §6.1f, §6.1g and §6.1h ask for hero, intro and cover media; §6.1i asks an
 * article for a hero image; §6.1j asks a review for photos. Every one of those is an `upload` field,
 * and an `upload` field needs a collection to point at. The alternatives were both worse: text
 * columns holding URLs, to be swapped for real relationships in Phase 8 — a rewrite of a dozen
 * tables and every foreign key between them — or leaving the fields out and adding them later, which
 * is the same rewrite wearing a different name.
 *
 * This is the precedent Phase 2 set with `Users`, which exists as "foundation, not a feature"
 * because Payload requires one auth collection before any feature needs authentication. See notes
 * §1.7.5 and the deviation recorded for this decision.
 *
 * **What Phase 8 will add, and must not be pre-empted here:** a storage adapter (until then files
 * land on local disk, which is correct for development and wrong for a serverless deployment), the
 * `imageSizes` that `sharp` powers, `focalPoint` and `crop`, `mimeTypes` and size limits, and the
 * media-role and dimension metadata §8.1a lists. `sharp` is deliberately not installed: without it
 * Payload stores the original file and skips image processing, which is exactly the reduced
 * behaviour intended here, and installing it now would be installing a later phase's dependency.
 *
 * `alt` is required from the start. It is the one media field that is not a Phase 8 concern —
 * accessibility is "part of implementation, not a final cosmetic pass" (plan §0.1.19), and an alt
 * text backfilled across a seeded catalogue months later is the thing that never happens.
 */
export const Media: CollectionConfig = {
  slug: 'media',

  admin: {
    useAsTitle: 'filename',
    defaultColumns: ['filename', 'alt', 'mimeType', 'updatedAt'],
    group: 'Content',
    description: 'Images and video. Cloudinary delivery and responsive variants arrive in Phase 8.',
  },

  upload: {
    /**
     * `<repo>/media`, which `.gitignore` has excluded since Phase 1 under its `payload` heading —
     * the directory was anticipated before the collection was. Outside `src/`, because everything
     * under `src/` is application source that the build compiles and the repository tracks, and an
     * uploaded file is neither.
     *
     * Resolved from this file rather than `process.cwd()`: the `payload` CLI, `next dev` and the
     * production server are three different working directories, and a relative default would put
     * uploads in three different places.
     *
     * This path is development-only in effect. A serverless function's filesystem is ephemeral, so
     * a deployed build storing uploads here would lose them — a fact about Phase 8's storage adapter
     * being absent, not a defect in this line. Files are served by Payload's own
     * `/api/media/file/:filename` route, never as Next static assets.
     */
    staticDir: path.resolve(dirname, '../../../media'),
  },

  /**
   * Public read, because a media record is the metadata for an asset the storefront renders — alt
   * text, dimensions, credit — and an image referenced by a published page is public by construction.
   *
   * This governs the *record*, not the file. From **Phase 8** the bytes are served by Cloudinary from
   * its own URL, which Payload's access control never sees; anything that must not be public must not
   * be uploaded here. Nothing in the corpus asks for private media, and the two collections that
   * could plausibly want it — order documents, review photos awaiting moderation — are covered by
   * their own rules or do not exist.
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
  ],
}
