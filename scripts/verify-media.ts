/**
 * The Phase 8 media rules, checked against the running code rather than against the comments that
 * describe them.
 *
 * ```
 * pnpm verify:media
 * ```
 *
 * **It runs in two halves, and the second one is conditional.**
 *
 * The first half needs no Cloudinary account and is what gates the phase: the upload rules of plan
 * §8.1b (mime allowlist, magic-byte sniffing, the executable-disguised-as-an-image case, the
 * dimension cap), the delivery-URL grammar of §8.1c, and the layout-geometry guarantees of §8.1d.
 * Every one of those is a property of *our* code and is provable today.
 *
 * The second half runs only when `integrationStatus('cloudinary') === 'configured'`. It is the live
 * round trip — upload, derive, fetch, delete — and it exists because the project is being committed
 * with no credentials, at the user's direction. When the credentials arrive this script is the single
 * command that proves the integration, including the one thing that cannot be predicted from here:
 * whether the account has **Strict transformations** enabled, which would make every dynamically
 * built URL in `lib/media/cloudinary-url.ts` return 400.
 *
 * It writes to the database and cleans up after itself, and refuses to run anywhere but the
 * development database `DATABASE_PUSH_TARGET` names — the **D-10** guard, the same one `seed.ts` and
 * `verify-access.ts` use.
 */

import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import zlib from 'zlib'

import type { Payload } from 'payload'

import config from '../src/payload.config'

import { developmentDatabase, integrationStatus } from '../src/lib/env.core'
import {
  MEDIA_CONTEXTS,
  buildCloudinaryUrl,
  buildLqipUrl,
  buildSocialCardUrl,
  buildSrcSet,
  reserveBox,
  type MediaContext,
} from '../src/lib/media/cloudinary-url'
import { ACCEPTED_MIME_TYPES, MAX_IMAGE_DIMENSION } from '../src/lib/media/limits'
import { toPublicId, CLOUDINARY_FOLDER } from '../src/payload/storage/cloudinary'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-media refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes media records, so it may only touch the development database that ' +
      'DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const { getPayload } = await import('payload')

const PREFIX = 'verify-media'

/**
 * **The fixtures are generated, not committed.**
 *
 * `scripts/seed.ts` refuses to commit placeholder binaries and says why — *"committing placeholder
 * binaries to stand in for it would be a different kind of fiction"*. The same argument applies to
 * test images, with an extra one on top: a hostile fixture is a file that looks like an executable
 * disguised as a picture, and putting several of those in a repository invites exactly one
 * misunderstanding.
 *
 * Everything below is written with Node's own `zlib` and no dependency at all. The PNGs are real —
 * a correct signature, a real IHDR, a real deflate stream — because a fake one would prove nothing
 * about a magic-byte check.
 */
const FIXTURES = await mkdtemp(path.join(tmpdir(), 'north01-media-'))

function crcTable() {
  return Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    return c >>> 0
  })
}

const CRC = crcTable()

function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (const byte of buffer) {
    c = CRC[(c ^ byte) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/** An 8-bit greyscale PNG of the given size. Greyscale keeps a 12,500px fixture under 2 MB of RAM. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, checksum])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // greyscale

  const raw = Buffer.alloc((width + 1) * height, 0x9a)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0 // filter byte
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function writeFixtures() {
  await writeFile(path.join(FIXTURES, 'portrait.png'), png(2400, 3000))
  await writeFile(path.join(FIXTURES, 'landscape.png'), png(3000, 1200))
  await writeFile(path.join(FIXTURES, 'oversized.png'), png(12_500, 40))

  // The hostile set of §8.1b. Each is a real instance of the thing it names.
  await writeFile(
    path.join(FIXTURES, 'not-really-an-image.jpg'),
    Buffer.from(['#!/bin/sh', 'echo "a shell script wearing a .jpg extension"', ''].join('\n')),
  )
  await writeFile(
    path.join(FIXTURES, 'trojan.png'),
    Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1022, 0x90)]),
  )
  await writeFile(
    path.join(FIXTURES, 'xss.svg'),
    Buffer.from(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
        '<script>alert(1)</script><rect width="100" height="100"/></svg>',
    ),
  )
  await writeFile(
    path.join(FIXTURES, 'page.html'),
    Buffer.from('<script>alert(document.domain)</script>'),
  )

  /**
   * The polyglot: a valid GIF header followed by an executable. `file-type` reads magic bytes at
   * offset 0 only, so this is detected as `image/gif` — which is precisely why `image/gif` is not in
   * the allowlist. The check below proves the exclusion is what stops it.
   */
  await writeFile(
    path.join(FIXTURES, 'polyglot.gif'),
    Buffer.concat([
      Buffer.from('GIF89a'),
      Buffer.from([0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00]),
      Buffer.from('MZ'),
      Buffer.alloc(512, 0x90),
    ]),
  )
}

await writeFixtures()

/* -------------------------------------------------------------------------------------------------
 * Harness
 * ---------------------------------------------------------------------------------------------- */

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

/**
 * An upload that **must** be refused, and by the right mechanism.
 *
 * Accepting any thrown error would let a typo in a fixture path report a passing security check while
 * proving nothing — the exact defect the Phase 7 harness shipped with and had to have removed. The
 * error must mention the file or the type, not merely exist.
 */
async function rejected(name: string, operation: () => Promise<unknown>) {
  try {
    await operation()
    check(name, false, 'the upload SUCCEEDED and must not have')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const isValidation =
      /mime|type|file|upload|dimension|pixel|size|invalid/i.test(message) &&
      !/ENOENT|no such file/i.test(message)

    check(name, isValidation, message.slice(0, 120))
  }
}

const payload: Payload = await getPayload({ config })

async function cleanup() {
  await payload.delete({
    collection: 'media',
    where: { alt: { like: PREFIX } },
    overrideAccess: true,
  })
}

async function upload(file: string, alt: string, role = 'editorial') {
  return payload.create({
    collection: 'media',
    overrideAccess: true,
    data: { alt, role } as never,
    filePath: path.join(FIXTURES, file),
  })
}

/* -------------------------------------------------------------------------------------------------
 * Half one — provable with no Cloudinary account
 * ---------------------------------------------------------------------------------------------- */

try {
  await cleanup()

  // ---- §8.1b upload rules ----------------------------------------------------------------------

  const good = await upload('portrait.png', `${PREFIX} portrait`, 'product')
  check(
    'a real image uploads and its dimensions are read without sharp',
    good.width === 2400 && good.height === 3000,
    `${good.width}x${good.height}`,
  )
  check('the mime type is recorded', good.mimeType === 'image/png', String(good.mimeType))
  check('the media role is stored', good.role === 'product', String(good.role))

  await rejected('a shell script named .jpg is refused', () =>
    upload('not-really-an-image.jpg', `${PREFIX} shell script`),
  )

  await rejected('a Windows executable named .png is refused', () =>
    upload('trojan.png', `${PREFIX} executable`),
  )

  await rejected('an SVG carrying a <script> is refused', () => upload('xss.svg', `${PREFIX} svg`))

  await rejected('an HTML document is refused', () => upload('page.html', `${PREFIX} html`))

  await rejected('a GIF/executable polyglot is refused', () =>
    upload('polyglot.gif', `${PREFIX} polyglot`),
  )

  await rejected('an image beyond the dimension cap is refused', () =>
    upload('oversized.png', `${PREFIX} huge`),
  )

  check(
    'the dimension cap is the one the limits module declares',
    MAX_IMAGE_DIMENSION === 12_000,
    String(MAX_IMAGE_DIMENSION),
  )
  check(
    'GIF is not accepted — the offset-0 polyglot carrier',
    !(ACCEPTED_MIME_TYPES as readonly string[]).includes('image/gif'),
  )
  check(
    'SVG is not accepted',
    !(ACCEPTED_MIME_TYPES as readonly string[]).includes('image/svg+xml'),
  )
  check(
    'video is accepted, because products.video points here',
    (ACCEPTED_MIME_TYPES as readonly string[]).includes('video/mp4'),
  )

  // ---- public id derivation and hardening -------------------------------------------------------

  check(
    'a public id is folder-scoped and loses its extension',
    toPublicId('a-photo.jpg') === `${CLOUDINARY_FOLDER}/a-photo`,
    toPublicId('a-photo.jpg'),
  )
  check(
    'a public id cannot climb out of its folder',
    !toPublicId('../../etc/passwd.jpg').includes('..'),
    toPublicId('../../etc/passwd.jpg'),
  )
  check(
    'a public id cannot inject a transformation separator',
    !toPublicId('a,c_scale,w_9999.jpg').includes(','),
    toPublicId('a,c_scale,w_9999.jpg'),
  )
  check(
    'an empty name still yields an id',
    toPublicId('.jpg').endsWith('/asset'),
    toPublicId('.jpg'),
  )

  // ---- §8.1c delivery grammar, and §8.1d geometry -----------------------------------------------

  const asset = { publicId: `${CLOUDINARY_FOLDER}/x`, width: 2400, height: 3000 }

  for (const context of Object.keys(MEDIA_CONTEXTS) as MediaContext[]) {
    const definition = MEDIA_CONTEXTS[context]
    const url = buildCloudinaryUrl({ cloudName: 'c', asset, context, width: 99_999 })

    check(
      `${context}: never requests more than the source holds`,
      !/w_(\d+)/.test(url) || Number(/w_(\d+)/.exec(url)![1]) <= asset.width,
      /w_\d+/.exec(url)?.[0] ?? '?',
    )

    const box = reserveBox(context, null)
    check(
      `${context}: reserves a box with no asset at all`,
      box.width > 0 && box.height > 0,
      `${box.width}x${box.height}`,
    )

    if (definition.aspectRatio !== null) {
      check(
        `${context}: the reserved box matches the declared ratio`,
        Math.abs(box.width / box.height - definition.aspectRatio) < 0.01,
      )
    }
  }

  check(
    'a portrait crop of a landscape clamps on height, not width',
    buildSrcSet({
      cloudName: 'c',
      asset: { publicId: 'x', width: 864, height: 576 },
      context: 'productCard',
    }).includes('w_460'),
  )
  check(
    'no delivery URL carries the SDK analytics parameter',
    !buildCloudinaryUrl({ cloudName: 'c', asset, context: 'productCard', width: 400 }).includes(
      '_a=',
    ),
  )
  check(
    'f_auto is used for the storefront',
    buildCloudinaryUrl({ cloudName: 'c', asset, context: 'productCard', width: 400 }).includes(
      'f_auto',
    ),
  )
  check(
    'f_jpg is used for the social card, which negotiates nothing',
    buildSocialCardUrl({ cloudName: 'c', asset }).includes('f_jpg'),
  )
  check(
    'the LQIP is a 24px blur',
    buildLqipUrl({ cloudName: 'c', asset, context: 'productCard' }).includes('w_24') &&
      buildLqipUrl({ cloudName: 'c', asset, context: 'productCard' }).includes('e_blur'),
  )
  check(
    'a video URL uses the video delivery namespace',
    buildCloudinaryUrl({
      cloudName: 'c',
      asset: { publicId: 'v', resourceType: 'video' },
      context: 'editorial',
      width: 640,
    }).includes('/video/upload/'),
  )
  check(
    'the hotspot-bearing editorial context does not crop',
    MEDIA_CONTEXTS.editorial.crop === 'limit' && MEDIA_CONTEXTS.editorial.aspectRatio === null,
  )

  // ---- the degraded path, which is the committed state -------------------------------------------

  const cloudinary = integrationStatus('cloudinary')

  check(
    'with Cloudinary unconfigured, an uploaded asset still has a usable URL',
    cloudinary !== 'configured' ? Boolean(good.url) : true,
    String(good.url).slice(0, 60),
  )
  check(
    'the schema carries the storage prefix column whether or not Cloudinary is configured',
    'prefix' in good,
    `prefix=${String((good as { prefix?: unknown }).prefix)}`,
  )

  /* -----------------------------------------------------------------------------------------------
   * Half two — the live round trip. Only with credentials.
   * -------------------------------------------------------------------------------------------- */

  if (cloudinary !== 'configured') {
    payload.logger.info(
      'Cloudinary is not configured, so the live round trip was skipped. ' +
        'Set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET and run this again.',
    )
  } else {
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME as string

    const live = await upload('landscape.png', `${PREFIX} live`, 'campaign')

    check(
      'the upload reached Cloudinary',
      Boolean(live.cloudinaryPublicId),
      String(live.cloudinaryPublicId),
    )
    check('an asset id was stored — §8.1a', Boolean(live.cloudinaryAssetId))
    check('a version was stored', Boolean(live.cloudinaryVersion))
    check(
      'the resource type was stored from Cloudinary, not derived from a client mime',
      live.cloudinaryResourceType === 'image',
      String(live.cloudinaryResourceType),
    )
    check(
      'the stored url points at Cloudinary, not at this server',
      String(live.url).startsWith('https://res.cloudinary.com/'),
      String(live.url).slice(0, 60),
    )
    check(
      'Cloudinary’s dimensions replaced the local probe’s',
      live.width === 3000 && live.height === 1200,
      `${live.width}x${live.height}`,
    )

    const liveAsset = {
      publicId: live.cloudinaryPublicId as string,
      version: live.cloudinaryVersion ?? null,
      width: live.width ?? null,
      height: live.height ?? null,
    }

    /**
     * **The check that cannot be made without an account.** "Strict transformations" is an
     * account-level setting that refuses any derived URL not registered in advance; with it on, every
     * dynamically built URL this project emits returns 400 and the whole delivery design fails.
     */
    for (const context of ['productCard', 'heroDesktop', 'thumbnail'] as MediaContext[]) {
      const url = buildCloudinaryUrl({
        cloudName,
        asset: liveAsset,
        context,
        width: MEDIA_CONTEXTS[context].widths[0],
      })
      const response = await fetch(url, { headers: { Accept: 'image/avif,image/webp,image/*' } })

      check(
        `live: ${context} derives on the fly (strict transformations off)`,
        response.ok,
        `${response.status} ${response.headers.get('content-type') ?? ''}`,
      )
    }

    const lqip = await fetch(buildLqipUrl({ cloudName, asset: liveAsset, context: 'productCard' }))
    const lqipBytes = (await lqip.arrayBuffer()).byteLength
    check(
      'live: the LQIP is small enough to be worth inlining',
      lqip.ok && lqipBytes < 2000,
      `${lqipBytes} bytes`,
    )

    await payload.delete({ collection: 'media', id: live.id, overrideAccess: true })

    const gone = await fetch(
      buildCloudinaryUrl({ cloudName, asset: liveAsset, context: 'thumbnail', width: 96 }),
    )
    check(
      'live: deleting the record removes the asset from Cloudinary',
      gone.status === 404,
      String(gone.status),
    )
  }
} finally {
  await cleanup()
  await rm(FIXTURES, { recursive: true, force: true })
}

/* -------------------------------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------------------------------- */

const failed = results.filter((result) => !result.ok)

for (const result of results) {
  payload.logger.info(
    `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  )
}

payload.logger.info(`${results.length - failed.length}/${results.length} media checks passed.`)

if (failed.length > 0) {
  throw new Error(`${failed.length} media check(s) failed.`)
}

process.exit(0)
