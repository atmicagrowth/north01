/**
 * **The upload limits of plan §8.1b, stated once.**
 *
 * Two callers must agree on them and they sit on opposite sides of the config: the file-size cap is a
 * **root** option (`buildConfig({ upload: { limits } })`, because it is a Busboy setting that applies
 * to every upload collection at once) while the dimension cap is enforced by a hook on the `media`
 * collection itself. Splitting the numbers between two files is how they drift.
 *
 * No import, no environment — the same shape as `lib/password-policy.ts`, and for the same reason.
 *
 * ### The numbers are this project's, because §8.1b gives none
 *
 * The plan asks for *"Maximum dimensions"*, *"Maximum file size"* and *"Reasonable image formats"* and
 * names no threshold for any of them. Each of these is therefore a decision recorded in the notes,
 * not compliance with a line somebody wrote.
 */

/**
 * 4 MB — set by the platform, not by taste (Phase 36, audit R3-16).
 *
 * This was 25 MB, sized for a full-frame camera JPEG, and it promised something production could not
 * deliver. **Vercel Functions reject a request body over 4.5 MB** with a 413 of their own, before
 * Payload runs — so `responseOnLimit` below never fired and the editor saw a bare failure. Uploads
 * pass through that function because the Cloudinary adapter (`payload/storage/cloudinary.ts`) streams
 * server-side and there are no client-direct uploads. Every file between 4.5 and 25 MB was therefore
 * refused in production while the admin panel said it was allowed.
 *
 * 4 MB (4,194,304 bytes) leaves room under 4.5 MB for the multipart boundaries and the document's own
 * fields, which travel in the same body. It is enough for a web-ready photograph and a very short
 * clip; a camera original or a longer video has to be exported smaller first, and the editor-facing
 * description in `Media.ts` says so. Raising it means uploading directly from the browser to
 * Cloudinary, which is a feature this project has not built — not a bigger number here.
 *
 * **This number is worthless without `abortOnLimit`.** Payload passes these options straight to
 * Busboy, whose behaviour on exceeding a limit is to *truncate the stream and carry on*: the first N
 * bytes are kept, a `truncated` flag is set, and the upload completes normally. Payload never reads
 * that flag. So a size limit alone converts an oversized upload from an honest failure into a
 * silently corrupt asset stored with a 201. `payload.config.ts` sets both, plus `responseOnLimit` so
 * the editor is told what happened rather than shown a bare status code.
 *
 * **It is also a memory budget, not just a policy.** Payload's `useTempFiles` defaults to `false`, so
 * an upload is buffered whole in RAM before it is written anywhere. The limit is the per-request
 * ceiling that choice implies.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

/**
 * 12,000 pixels on either side.
 *
 * **Not a taste rule** — it is a decompression-bomb guard. A 30,000 × 30,000 PNG of flat colour is a
 * few hundred kilobytes on disk and about 3.6 GB of RGBA in memory, so a file that passes the size
 * limit above can still take a server down when something decodes it. Cloudinary independently
 * refuses anything beyond 65,500 on a side, so a generous cap here fails fast and locally rather than
 * after a full upload round trip.
 *
 * 12,000 is far past any photograph a camera produces (a 100 MP medium-format back is about 11,600 on
 * its long edge) and far short of the range where decoding becomes dangerous.
 */
export const MAX_IMAGE_DIMENSION = 12_000

/**
 * The formats accepted on upload — and this list is a **security control before it is a compatibility
 * one**.
 *
 * Setting `mimeTypes` at all is what switches Payload from *"trust the extension and the
 * browser-declared type"* to *"sniff the magic bytes"*. The two are mutually exclusive branches in
 * `checkFileRestrictions`, and only the second one reads the file. With this key absent — the state
 * the collection was in until Phase 8 — renaming `payload.sh` to `photo.jpg` was sufficient to store
 * it.
 *
 * Formats are named explicitly rather than with an `image/*` wildcard, because a wildcard readmits
 * everything the two exclusions below exist to keep out.
 *
 * ### SVG is excluded, and it is not an oversight about vector logos
 *
 * An SVG is a script-execution context that renders as a picture. Payload has a `validateSvg`, and it
 * can be stepped around: a file opening with an `<?xml …?>` declaration is sniffed as
 * `application/xml`, **relabelled** to `image/svg+xml`, and then skips validation entirely, because
 * the relabelling happens inside the branch the validator guards. Keeping SVG out of this allowlist
 * is what actually stops it — the relabelled type then fails the allowlist test instead. A logo ships
 * as PNG.
 *
 * ### GIF is excluded, and that one is about polyglots
 *
 * `file-type` reads magic bytes **at offset 0 only**. `GIF89a` followed by an entire Windows
 * executable is therefore detected as `image/gif`, passes validation, and is stored — the classic
 * polyglot, and the reason plan §8.1b's *"Do not accept arbitrary executable files"* is not satisfied
 * by sniffing alone. GIF's header is uniquely convenient for this because it is short, fixed, and
 * imposes nothing on the bytes that follow.
 *
 * Excluding it costs nothing the corpus asks for: no document mentions GIF, and motion has a field of
 * its own in `products.video`. The second gate is Cloudinary itself — the adapter uploads with an
 * explicit `resource_type`, so an "image" that no decoder can read is rejected at the far end too.
 *
 * ### Video is included
 *
 * `products.video` (plan §6.1b) is an upload field pointing at this same collection. A
 * still-images-only list would have quietly broken a field Phase 6 shipped.
 */
export const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'video/mp4',
  'video/webm',
] as const

/**
 * The message an editor sees when they exceed `MAX_UPLOAD_BYTES`.
 *
 * Payload's default is nothing at all, which surfaces as a bare 413 with no explanation of what to do
 * about it.
 */
export const UPLOAD_LIMIT_MESSAGE = `That file is larger than the ${Math.round(
  MAX_UPLOAD_BYTES / (1024 * 1024),
)} MB upload limit. Export it at a lower quality, or resize it, and try again.`
