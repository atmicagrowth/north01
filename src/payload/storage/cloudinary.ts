import { cloudStoragePlugin } from '@payloadcms/plugin-cloud-storage'
import type { Adapter, GeneratedAdapter } from '@payloadcms/plugin-cloud-storage/types'
import { v2 as cloudinary } from 'cloudinary'
import type { UploadApiOptions, UploadApiResponse } from 'cloudinary'
import type { Plugin } from 'payload'

/**
 * **The Cloudinary storage adapter — decision D-03, and the phase that was told to confirm it.**
 *
 * D-03 and **DEV-05** chose a thin first-party adapter on `@payloadcms/plugin-cloud-storage` over any
 * community package, on the premise that no official Cloudinary adapter exists. Phase 8 was asked to
 * confirm that premise and did, against the registry rather than from memory:
 * `@payloadcms/storage-cloudinary` returns a hard **404**, while `storage-s3`, `storage-vercel-blob`,
 * `storage-azure`, `storage-gcs` and `storage-uploadthing` all publish at exactly `3.88.0`. Official
 * adapters ship at our version; Cloudinary is simply not one of them. The premise holds and the
 * deviation is confirmed rather than revisited.
 *
 * The shape mirrors the official S3 adapter deliberately: a plugin-shaped function that builds a
 * per-collection adapter factory and delegates to `cloudStoragePlugin`, with the provider client
 * configured once at module scope rather than per request.
 *
 * **This is the only file in the project that imports the `cloudinary` SDK, and the only one that
 * ever sees `CLOUDINARY_API_SECRET`.** It is reached from `payload.config.ts` and from nowhere else,
 * so it cannot enter a client bundle. Delivery URLs are built by `lib/media/cloudinary-url.ts`, which
 * needs no SDK, no server and no secret — see that file for why that is a property of Cloudinary's
 * URL grammar rather than a convention we maintain.
 */

/**
 * **A constant, not a setting, and that is load-bearing.**
 *
 * The plugin writes this into the collection schema as the `prefix` field's SQL `DEFAULT`. If it came
 * from the environment it would differ between a configured machine and an unconfigured one, and the
 * committed migration would be correct for exactly one of them — the failure `docs/DATABASE.md` §6
 * has no recovery for. It is also the Cloudinary folder every asset lands in, which keeps this
 * project separable from anything else sharing the cloud.
 */
export const CLOUDINARY_FOLDER = 'north01'

export type CloudinaryStorageOptions = {
  /** Public. It is a path segment of every delivery URL. */
  cloudName: string
  /** Server-only. */
  apiKey: string
  /** Server-only, and never returned to any caller. */
  apiSecret: string
  /**
   * `false` leaves Payload on local-disk storage. The plugin is still registered — see
   * `cloudinaryStorage` for why that is not the same as not calling it.
   */
  enabled: boolean
}

/**
 * `cloudinary.config()` is **global mutable module state**, not per-call configuration, so it is set
 * once here and never again.
 *
 * `analytics: false` is not optional. The SDK appends a `?_a=<token>` tracking parameter to every URL
 * it generates, which would follow our assets into every `img` tag on the site. Nothing here builds a
 * delivery URL through the SDK — but the flag costs nothing and closes the door on a future caller
 * who does.
 *
 * `secure: true` because the SDK's default is `http`, and an `http://` image on an `https://` page is
 * mixed content, which browsers block outright.
 *
 * **What this cannot defend against**, recorded so it is not mistaken for handled: the SDK reads
 * `CLOUDINARY_URL`, `CLOUDINARY_ACCOUNT_URL` and `CLOUDINARY_API_PROXY` straight out of `process.env`
 * on its first `config()` call, merging them *under* whatever is passed here. An explicit
 * `api_secret` therefore wins, but a malformed `CLOUDINARY_URL` still throws at boot. That is why
 * `lib/env.core.ts` refuses all three outright — a variable this project does not use should not be
 * able to reconfigure the one integration that holds a write credential.
 */
let configuredFingerprint: null | string = null

function configure(options: CloudinaryStorageOptions): typeof cloudinary {
  const fingerprint = `${options.cloudName}:${options.apiKey}`

  if (configuredFingerprint !== fingerprint) {
    cloudinary.config({
      cloud_name: options.cloudName,
      api_key: options.apiKey,
      api_secret: options.apiSecret,
      secure: true,
      analytics: false,
    })

    configuredFingerprint = fingerprint
  }

  return cloudinary
}

/* -------------------------------------------------------------------------------------------------
 * Naming
 * ---------------------------------------------------------------------------------------------- */

/**
 * A Cloudinary `public_id` is the asset's name *without* an extension — the extension in a delivery
 * URL is a request for a format, not part of the identifier. Payload's `filename` carries one, so it
 * comes off here.
 *
 * **The sanitising is not belt-and-braces, it is the braces.** Payload sanitises only the *basename*
 * of an uploaded filename and takes the extension from the client verbatim, so the string arriving
 * here is not fully under our control. A public id becomes the last path segment of a URL, where a
 * `..` is resolved by the fetching agent rather than by Cloudinary — so an unfiltered one is a way to
 * address a different asset entirely. Everything outside a conservative set is replaced, runs are
 * collapsed, and the result can neither be empty nor climb.
 *
 * Payload has already made the filename unique (`filename` carries a `unique` index, and
 * `getSafeFileName` appends a counter on collision), so the derived id inherits that uniqueness and a
 * re-upload never silently overwrites a different asset.
 */
export function toPublicId(filename: string): string {
  const withoutExtension = filename.replace(/\.[^./\\]+$/, '')

  const safe = withoutExtension
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 180)

  return `${CLOUDINARY_FOLDER}/${safe || 'asset'}`
}

/**
 * Cloudinary routes images, video and everything else through different delivery namespaces, and the
 * `resource_type` chosen at upload is the one that must appear in every URL forever afterwards.
 *
 * This is used only to *choose* the namespace at upload time. Afterwards the authority is
 * `cloudinaryResourceType`, stored from Cloudinary's own response — because the `mimeType` Payload
 * stores is the one the browser declared in the multipart body and is validated by nothing.
 * `checkFileRestrictions` sniffs the *buffer* and compares the sniffed type, but never writes it
 * back, so a file can pass validation and still carry a MIME string that is a lie. Deriving a
 * delivery namespace from a lie produces a 404 on every image on the page.
 */
function resourceTypeForUpload(mimeType: string): 'image' | 'raw' | 'video' {
  if (mimeType.startsWith('image/')) {
    return 'image'
  }

  if (mimeType.startsWith('video/')) {
    return 'video'
  }

  return 'raw'
}

/** Cloudinary reports a `format` (`jpg`, `mp4`); this is the MIME type that actually corresponds. */
const MIME_BY_FORMAT: Record<string, string> = {
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mp4: 'video/mp4',
  png: 'image/png',
  webm: 'video/webm',
  webp: 'image/webp',
}

/* -------------------------------------------------------------------------------------------------
 * The adapter
 * ---------------------------------------------------------------------------------------------- */

/**
 * `upload_stream` is callback-based and returns a Node `Transform`, not a promise — the SDK's
 * promise-returning `upload()` takes a path or a URL, not a buffer, so it cannot be used here.
 * Payload hands us a `Buffer`, so the stream is wrapped and fed once.
 */
function uploadBuffer(
  client: typeof cloudinary,
  buffer: Buffer,
  options: UploadApiOptions,
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = client.uploader.upload_stream(options, (error, result) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error?.message ?? error)))
        return
      }

      if (!result) {
        reject(new Error('Cloudinary returned no result for an upload that did not error.'))
        return
      }

      resolve(result)
    })

    stream.end(buffer)
  })
}

const createAdapter =
  (options: CloudinaryStorageOptions): Adapter =>
  (): GeneratedAdapter => {
    const client = configure(options)

    return {
      name: 'cloudinary',

      /**
       * **The returned object is written back to the document**, through a second `payload.update()`
       * the plugin issues with `req.context.skipCloudStorage` set to prevent recursion. That is the
       * supported channel for persisting what Cloudinary decided, and it is why plan §8.1a's *"Asset
       * ID"* and *"Public identifier"* can be two real columns rather than values re-derived on every
       * read and hoped to still match.
       *
       * The official S3 adapter returns `data` unchanged specifically to avoid that extra write. We
       * accept it — one UPDATE per upload — because four of the values are things only Cloudinary
       * knows, and three of them are corrections rather than additions:
       *
       * - **`width` / `height`** replace Payload's. Payload measures the *raw raster* with a
       *   header-only probe that ignores EXIF orientation, so a portrait photograph from a phone is
       *   recorded transposed. Cloudinary's numbers describe the asset Cloudinary will actually
       *   deliver, which makes the width clamp and the reserved layout box correct **by
       *   construction** rather than correct only for images without an orientation flag. Getting
       *   this wrong is a guaranteed layout shift on exactly the images most likely to be uploaded.
       * - **`filesize`** replaces the browser-reported byte count with the stored one.
       * - **`mimeType`** replaces the browser's claim with the format Cloudinary decoded.
       *
       * `overwrite: false` with `unique_filename: false` means *"trust the public_id we computed"*.
       * Payload has already guaranteed the filename is unique, so letting Cloudinary invent its own
       * suffix would produce an id that no longer matches the row referencing it.
       */
      handleUpload: async ({ data, file }) => {
        const publicId = toPublicId(file.filename)
        const uploadAs = resourceTypeForUpload(file.mimeType)

        const result = await uploadBuffer(client, file.buffer, {
          public_id: publicId,
          resource_type: uploadAs,
          overwrite: false,
          unique_filename: false,
          use_filename: false,
          invalidate: true,
        })

        const format = (result.format ?? '').toLowerCase()

        return {
          ...data,
          cloudinaryPublicId: result.public_id,
          cloudinaryAssetId: result.asset_id ?? null,
          cloudinaryVersion: result.version ?? null,
          cloudinaryResourceType: result.resource_type ?? uploadAs,
          ...(result.width ? { width: result.width } : {}),
          ...(result.height ? { height: result.height } : {}),
          ...(result.bytes ? { filesize: result.bytes } : {}),
          ...(MIME_BY_FORMAT[format] ? { mimeType: MIME_BY_FORMAT[format] } : {}),
        }
      },

      /**
       * The plugin's own `afterDelete` **swallows whatever this throws** — it logs and returns the
       * document — so a Cloudinary outage orphans the asset silently rather than failing the delete.
       * That is the plugin's behaviour, not ours, and it is the right trade: a delete the customer or
       * editor has already been shown should not be blocked by a third party being down. It is
       * recorded here so the orphan is a known cost rather than a mystery. Reconciling it needs a
       * sweep of Cloudinary against the `media` table, which no phase has claimed.
       *
       * `resource_type` must match what the asset was uploaded as or `destroy` reports success while
       * deleting nothing — it looks in the wrong namespace. It comes from the stored column, not from
       * `mimeType`, for the reason `resourceTypeForUpload` explains.
       */
      handleDelete: async ({ doc, filename }) => {
        const record = doc as {
          cloudinaryPublicId?: null | string
          cloudinaryResourceType?: null | string
        }

        const publicId = record.cloudinaryPublicId || toPublicId(filename)
        const resourceType = (record.cloudinaryResourceType ?? 'image') as 'image' | 'raw' | 'video'

        await client.uploader.destroy(publicId, {
          resource_type: resourceType,
          invalidate: true,
        })
      },

      /**
       * The canonical URL of the **original** asset, which is what Payload stores in `url`.
       *
       * Deliberately untransformed. Every responsive variant plan §8.1c asks for is derived at render
       * time from the `public_id` by `lib/media/cloudinary-url.ts`, because a single stored URL cannot
       * be eight contexts at once — and because a URL frozen into a row at upload time is a breakpoint
       * that can never be changed again without a data migration.
       *
       * **It is called twice with different data, and both must work.** The `url` field's
       * `beforeChange` hook runs before `handleUpload` has returned anything, so on the first call
       * `data.cloudinaryPublicId` is undefined; the `afterRead` hook then re-runs it on every read
       * with the persisted row. The fallback is not a guess — `toPublicId` is deterministic from the
       * filename, so both calls produce the same id, and the second simply adds the version.
       *
       * No extension is appended: Cloudinary returns the asset's own format when none is requested,
       * and the storefront's `f_auto` overrides it anyway.
       */
      generateURL: ({ data, filename }) => {
        const record = data as {
          cloudinaryPublicId?: null | string
          cloudinaryResourceType?: null | string
          cloudinaryVersion?: null | number
        }

        const publicId = record.cloudinaryPublicId || toPublicId(filename)
        const version = record.cloudinaryVersion ? `v${record.cloudinaryVersion}/` : ''
        const resourceType = record.cloudinaryResourceType ?? 'image'

        return `https://res.cloudinary.com/${options.cloudName}/${resourceType}/upload/${version}${publicId}`
      },

      /**
       * **Unreachable, and required anyway.**
       *
       * `disablePayloadAccessControl: true` makes the plugin skip registering this entirely — it only
       * pushes the handler when access control is *not* disabled — but `GeneratedAdapter` types it as
       * mandatory. Rather than throw inside a function the type system insists exists, it redirects to
       * the same canonical URL `generateURL` produces, so a future configuration change that routes a
       * request here works instead of exploding.
       */
      staticHandler: (_req, { params }) =>
        Response.redirect(
          `https://res.cloudinary.com/${options.cloudName}/image/upload/${toPublicId(params.filename)}`,
          307,
        ),
    }
  }

/* -------------------------------------------------------------------------------------------------
 * The plugin
 * ---------------------------------------------------------------------------------------------- */

/**
 * **The plugin is registered whether or not Cloudinary is configured, and that is the point.**
 *
 * The obvious shape — register it only when credentials exist — produces two different database
 * schemas from one committed migration. `getFields` injects a `prefix` column, and only when a
 * `prefix` is set *or* `alwaysInsertFields` is true; with the plugin absent entirely, neither
 * happens. A developer with no credentials would then generate a migration that a configured
 * production does not match, which is the one failure mode `docs/DATABASE.md` §6 has no recovery for.
 *
 * So `enabled` carries the configured/unconfigured distinction and `alwaysInsertFields: true` pins the
 * schema on both sides of it. Verified in the plugin's own source: with `enabled: false` it returns
 * early having done nothing *except* run `getFields`, so the columns appear and no upload behaviour
 * does. Local-disk storage keeps working, which is exactly right for development. The `prefix` value
 * is a module constant for the same reason — it becomes the column's SQL `DEFAULT`.
 *
 * **`disablePayloadAccessControl: true` is the other decision made here**, and it is not cosmetic.
 * `adapter.generateURL` is called from exactly one place — the plugin's `afterRead` hook — and only
 * when this flag is set. Without it Payload keeps its own `/api/media/file/<filename>` in `url` and
 * every byte is proxied through the Next server by `staticHandler`: Cloudinary demoted to origin
 * storage behind a Node process, which defeats the reason it is in the stack at all. `Media.ts`
 * anticipated this in Phase 6 — *"the bytes are served by Cloudinary from its own URL, which
 * Payload's access control never sees"*.
 *
 * Two consequences, both deliberate:
 *
 * 1. **Media bytes are public to anyone holding the URL.** True of every CDN-delivered asset
 *    everywhere, and the reason nothing private may be uploaded to this collection.
 * 2. **It forces `skipSafeFetch: true` on the collection**, disabling Payload's SSRF filter for the
 *    paste-from-URL ingest path — the flag is not overridable. That path is closed independently:
 *    `Media.ts` sets `pasteURL: false`, and Payload's endpoint hard-rejects when it is not an object
 *    with an allowlist. The SSRF filter is switched off over a door that is bolted.
 */
export const cloudinaryStorage = (options: CloudinaryStorageOptions): Plugin =>
  cloudStoragePlugin({
    enabled: options.enabled,
    alwaysInsertFields: true,
    collections: {
      media: {
        adapter: options.enabled ? createAdapter(options) : null,
        disablePayloadAccessControl: true,
        prefix: CLOUDINARY_FOLDER,
      },
    },
  })
