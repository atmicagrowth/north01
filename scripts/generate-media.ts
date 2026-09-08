/**
 * **Stand-in art for every image the storefront asks for, generated rather than sourced.**
 *
 * ```
 * pnpm generate:media          # create the assets and attach them
 * pnpm generate:media --clean  # remove everything this script previously made, then rebuild
 * ```
 *
 * ### Why this exists, and what it is not
 *
 * The catalogue is real, the layouts are real, and until now every rectangle on the site rendered
 * §8.1d's neutral placeholder — correct behaviour, and a shop that looks unfinished. This fills those
 * rectangles with something deliberate while the real photography does not exist.
 *
 * **It is not a substitute for photographs**, and nothing here pretends to be one. There are no
 * fabricated garments, no faces, no borrowed stock images with someone else's licence attached. What
 * it draws is what a studio actually has before a shoot: a colour, a weave, and a lit ground.
 *
 * ### The aesthetic is one decision applied twice
 *
 * `NORTH01_Visual_Guide_OnlineOnly.md` gives the palette — Obsidian `#0A0A0A`, Warm Black `#1D1C1A`,
 * Bone `#F1EEE8`, Stone `#A9A39A`, Graphite `#33312D`, Soft Taupe `#C7B8A0` — and the guide's own
 * character: dark, quiet, one accent used sparingly. Two generators follow from it:
 *
 * 1. **Fabric.** A garment's own colour, lit from above, with a twill weave and soft folds. The
 *    colour is not invented: it is `productVariants.colorHex`, the value the shop already publishes
 *    as that variant's colour. So a Bone crew renders bone and an Indigo denim renders indigo, and
 *    the swatch is *true* even though the photograph is missing.
 * 2. **Editorial.** A lit ground with a single soft form and a horizon rule, for campaigns, journal
 *    entries, categories and collections. One form per asset, positioned and sized from a hash of the
 *    slug, so the same entry draws the same picture on every run and no two are alike.
 *
 * ### Written by hand, because the toolchain has no image library
 *
 * **DEV-33** removed `sharp`; there is no canvas, and nothing in `docs/STACK_VERSIONS.md` draws
 * pixels. Adding a dependency for stand-in art would be the wrong trade, so this encodes PNG itself
 * with `node:zlib` — signature, `IHDR`, filtered scanlines, `IDAT`, `IEND`. About eighty lines, no
 * install, and it deletes cleanly with the rest of the file when real photography arrives.
 *
 * Filters are chosen per scanline by the standard minimum-sum-of-absolute-differences heuristic,
 * which matters more than it sounds: these images are smooth by construction, so `Up` predicts almost
 * every row exactly and the whole set compresses to a few megabytes rather than a few hundred.
 *
 * ### One Cloudinary account, two databases — read this before `--clean`
 *
 * The public id of an asset is derived from its filename, and these filenames are deterministic. So
 * `swatch-indigo.png` is `north01/swatch-indigo` **whichever database created it** — development and
 * production point at the same objects on the same CDN.
 *
 * Sharing them is harmless and even useful. Deleting them is not. `--clean` removes Payload documents,
 * and removing an upload document tells the storage adapter to delete the object behind it, so
 * cleaning one database silently strips the images off the other. Measured the hard way: a `--clean`
 * against development, interrupted halfway, left the live site's campaign and journal images
 * answering 404 while its product images still resolved.
 *
 * Two consequences worth holding on to:
 *
 * - **A `--clean` run is only safe if it finishes.** It deletes and then re-uploads under the same
 *   ids, so a completed run restores what it removed. An interrupted one does not.
 * - **`--clean` against a database that is not the only consumer of those assets is a live change to
 *   the other one.** Separate the environments at the Cloudinary end — a distinct cloud or folder per
 *   environment — before treating this as routine.
 *
 * ### The D-10 guard applies
 *
 * It creates and deletes documents, so it writes only to the database `DATABASE_PUSH_TARGET` names.
 * A deployment carries code, never rows, so a deployed database is a legitimate target — named
 * explicitly on the command line, and never by a file left armed afterwards. See the note on
 * `PAYLOAD_MIGRATING` below for what that deliberate act is and is not allowed to reach.
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { Payload } from 'payload'

/**
 * **Set before the Payload config is evaluated, so this script can never push schema.**
 *
 * The Postgres adapter reads it in `connect()` and skips Drizzle's push when it is `true` — the same
 * move `baseline-migrations.ts` makes, and for a sharper reason here. This script writes *content*,
 * and content is the one thing a deployment does not carry: production gets its rows from the CMS,
 * not from the repository. So there is a real case for pointing it at a deployed database on purpose:
 *
 * ```
 * DATABASE_URL=<production> DATABASE_PUSH_TARGET=<production host/db> pnpm generate:media
 * ```
 *
 * D-10 still applies and still does its job — the operator has to *name* the database they mean, in
 * two places, on one command line, with nothing left armed afterwards. What this line adds is the
 * guarantee that naming it cannot also rewrite its schema: the deliberate act stays limited to the
 * rows, which is what was intended, and never reaches the DDL, which was not.
 *
 * Hence the dynamic imports below. A static `import` is hoisted above this assignment and would
 * evaluate the config first, which is the whole failure this prevents.
 */
process.env.PAYLOAD_MIGRATING = 'true'

export {}

const { developmentDatabase } = await import('../src/lib/env.core')

if (!developmentDatabase.ok) {
  throw new Error(
    `generate-media refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes collection documents, so DATABASE_PUSH_TARGET must name the database ' +
      'that DATABASE_URL actually reaches — see D-10.',
  )
}

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')

/* -------------------------------------------------------------------------------------------------
 * PNG, by hand
 * ---------------------------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)

  for (let n = 0; n < 256; n++) {
    let c = n

    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }

    table[n] = c >>> 0
  }

  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff

  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  }

  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8)

  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')

  const body = Buffer.concat([head.subarray(4), data])
  const tail = Buffer.alloc(4)

  tail.writeUInt32BE(crc32(body), 0)

  return Buffer.concat([head.subarray(0, 4), body, tail])
}

/**
 * Truecolour 8-bit PNG. One filter chosen per scanline from None/Sub/Up by minimum sum of absolute
 * signed residuals — the heuristic the PNG specification itself suggests, and the reason a 1400×1750
 * gradient lands around forty kilobytes instead of seven megabytes.
 */
function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)

  const candidate = Buffer.alloc(stride)
  const chosen = Buffer.alloc(stride)

  for (let y = 0; y < height; y++) {
    const row = y * stride
    const prev = row - stride

    let bestScore = Infinity
    let bestFilter = 0

    for (let filter = 0; filter <= 2; filter++) {
      if (filter === 2 && y === 0) {
        continue
      }

      let score = 0

      for (let i = 0; i < stride; i++) {
        const value = rgb[row + i]!
        const left = i >= 3 ? rgb[row + i - 3]! : 0
        const up = prev >= 0 ? rgb[prev + i]! : 0
        const delta = filter === 0 ? value : filter === 1 ? value - left : value - up

        candidate[i] = delta & 0xff
        score += Math.abs(((delta + 128) & 0xff) - 128)
      }

      if (score < bestScore) {
        bestScore = score
        bestFilter = filter
        candidate.copy(chosen)
      }
    }

    raw[(stride + 1) * y] = bestFilter
    chosen.copy(raw, (stride + 1) * y + 1)
  }

  const ihdr = Buffer.alloc(13)

  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 /* bit depth */
  ihdr[9] = 2 /* truecolour */

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ])
}

/* -------------------------------------------------------------------------------------------------
 * Colour and noise
 * ---------------------------------------------------------------------------------------------- */

type Rgb = [number, number, number]

const OBSIDIAN: Rgb = [0x0a, 0x0a, 0x0a]
const WARM_BLACK: Rgb = [0x1d, 0x1c, 0x1a]
const STONE: Rgb = [0xa9, 0xa3, 0x9a]
const SOFT_TAUPE: Rgb = [0xc7, 0xb8, 0xa0]

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '').trim()
  const full = clean.length === 3 ? [...clean].map((c) => c + c).join('') : clean
  const n = Number.parseInt(full.slice(0, 6), 16)

  return Number.isFinite(n) ? [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff] : [0x80, 0x80, 0x80]
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const smoothstep = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t

  return x * x * (3 - 2 * x)
}

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
]

/** A stable 32-bit hash, so the same slug always draws the same picture. */
function hash(text: string): number {
  let h = 2166136261

  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }

  return h >>> 0
}

function rng(seed: number) {
  let state = seed || 1

  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0

    let t = Math.imul(state ^ (state >>> 15), 1 | state)

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function paint(width: number, height: number, shade: (x: number, y: number) => Rgb): Buffer {
  const rgb = new Uint8Array(width * height * 3)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = shade(x, y)
      const i = (y * width + x) * 3

      rgb[i] = clamp255(Math.round(r))
      rgb[i + 1] = clamp255(Math.round(g))
      rgb[i + 2] = clamp255(Math.round(b))
    }
  }

  return encodePng(width, height, rgb)
}

/**
 * The lit ground both generators stand on: Obsidian at the edges lifting to Warm Black where the
 * light falls. Everything else is drawn over this, so the whole set shares one room.
 */
function ground(x: number, y: number, w: number, h: number, lightX: number, lightY: number): Rgb {
  const dx = (x / w - lightX) * 1.15
  const dy = (y / h - lightY) * 1.15
  const fall = smoothstep(1 - Math.min(1, Math.hypot(dx, dy) * 1.25))

  return mixRgb(OBSIDIAN, WARM_BLACK, fall * 0.85)
}

/**
 * A woven surface. The twill runs one way and the warp and weft cross it, and all three are coarse
 * enough to survive delivery: Cloudinary re-encodes to JPEG at `q_auto`, and the first version of this
 * was so fine that the encoder smoothed it out entirely — a fabric that arrived as a plain gradient.
 * Amplitude is a parameter for the same reason, because what reads on a swatch is heavy on a hero.
 */
function weave(x: number, y: number, scale: number, amp: number): number {
  const twill = Math.sin((x + y) * (Math.PI / (7 * scale)))
  const warp = Math.sin(x * (Math.PI / (4 * scale)))
  const weft = Math.sin(y * (Math.PI / (4 * scale)))
  const slub = Math.sin(x * 0.031 + y * 0.017) * Math.sin(y * 0.047)

  return (twill * 0.55 + warp * 0.22 + weft * 0.16 + slub * 0.3) * amp
}

/* -------------------------------------------------------------------------------------------------
 * The two generators
 * ---------------------------------------------------------------------------------------------- */

type FabricOptions = {
  hex: string
  height: number
  macro: boolean
  seed: string
  width: number
}

/**
 * **A length of the garment's own cloth, hung and lit.**
 *
 * The shape matters more than it first seems. The first version drew a full-height rectangle, which
 * renders as a *column* — architecture, not clothing. This one has a shoulder it hangs from, a slight
 * A-line fall to the hem, three folds and a shadow on the ground behind it, which is the minimum a
 * shape needs before the eye reads cloth.
 *
 * `macro` drops the shape and fills the frame with the weave instead: the close-up that sits second
 * in the gallery, where the point is the material rather than the drape.
 */
function fabric({ hex, height: h, macro, seed, width: w }: FabricOptions): Buffer {
  const base = hexToRgb(hex)
  const random = rng(hash(seed))

  const folds = [0.24 + random() * 0.1, 0.46 + random() * 0.08, 0.7 + random() * 0.12]
  const scale = macro ? 3.2 : 1.1

  /* The shoulder is narrower than the hem — cloth falls open, it does not hang straight. */
  const shoulderHalf = 0.2 + random() * 0.02
  const hemHalf = shoulderHalf + 0.075
  const top = 0.07
  const hem = 0.985

  return paint(w, h, (x, y) => {
    const u = x / w
    const v = y / h

    if (macro) {
      const vignette = Math.hypot(u - 0.5, v - 0.5)
      const lit = 1.1 - smoothstep(vignette * 1.35) * 0.42
      const cloth = weave(x, y, scale, 9)

      return [base[0] * lit + cloth, base[1] * lit + cloth, base[2] * lit + cloth]
    }

    const bed = ground(x, y, w, h, 0.5, 0.2)

    /* The drop shadow the cloth casts, drawn before the cloth so the cloth sits on top of it. */
    const shadow = (1 - smoothstep(Math.abs(u - 0.5) / 0.42)) * smoothstep((v - 0.55) / 0.45)
    const floor = mixRgb(bed, OBSIDIAN, shadow * 0.55)

    if (v < top || v > hem) {
      return floor
    }

    const drop = (v - top) / (hem - top)
    const half = lerp(shoulderHalf, hemHalf, smoothstep(drop))
    const edge = (Math.abs(u - 0.5) - half) * w

    if (edge > 2.5) {
      return floor
    }

    /* Light from above and slightly left, falling away down the drop. */
    let lit = 1.12 - smoothstep(drop) * 0.34
    const inset = 1 - Math.abs(u - 0.5) / half

    lit *= 0.74 + smoothstep(Math.min(1, inset * 2.4)) * 0.26

    /* A shoulder shadow: the cloth turns away from the light where it folds over the hanger. */
    lit *= 1 - Math.exp(-Math.pow((drop - 0.02) / 0.05, 2)) * 0.22

    for (const fold of folds) {
      const d = (u - 0.5 - (fold - 0.5) * half * 1.6) / (0.035 + drop * 0.02)

      lit *= 1 - Math.exp(-d * d) * 0.2
    }

    const cloth = weave(x, y, scale, 7)
    const shade: Rgb = [base[0] * lit + cloth, base[1] * lit + cloth, base[2] * lit + cloth]

    return mixRgb(shade, floor, smoothstep(Math.max(0, edge) / 2.5))
  })
}

type EditorialOptions = {
  height: number
  seed: string
  width: number
}

/**
 * **A lit ground, one luminous form, one rule.**
 *
 * The first version of this was almost black — technically a gradient, visually a smudge, and
 * indistinguishable from a rendering failure. The accent now carries real weight and the light has a
 * centre, so the frame reads as a photographed room rather than an empty file. It is still dark,
 * because the guide is dark and headline type sits on top of these.
 *
 * The form is a band, a column or a disc, chosen by the slug, with a smaller counter-form set against
 * it so the composition has somewhere to go.
 */
function editorial({ height: h, seed, width: w }: EditorialOptions): Buffer {
  const random = rng(hash(seed))
  const kind = Math.floor(random() * 3)
  const accent = random() > 0.45 ? SOFT_TAUPE : STONE
  const strength = 0.3 + random() * 0.16

  const cx = 0.3 + random() * 0.4
  const cy = 0.3 + random() * 0.32
  const size = 0.22 + random() * 0.2
  const horizon = 0.62 + random() * 0.16
  const lightX = 0.3 + random() * 0.4

  const counterX = cx > 0.5 ? 0.18 + random() * 0.14 : 0.68 + random() * 0.14
  const counterSize = size * (0.32 + random() * 0.18)

  const aspect = w / h

  return paint(w, h, (x, y) => {
    const u = x / w
    const v = y / h

    let shade = ground(x, y, w, h, lightX, 0.32)

    let presence = 0

    if (kind === 0) {
      presence = 1 - smoothstep(Math.abs(v - cy) / size)
    } else if (kind === 1) {
      presence = 1 - smoothstep(Math.abs(u - cx) / (size * 0.8))
    } else {
      presence = 1 - smoothstep(Math.hypot((u - cx) * aspect, v - cy) / size)
    }

    shade = mixRgb(shade, accent, presence * strength)

    /* The counter-form, always a disc, always quieter. */
    const counter =
      1 - smoothstep(Math.hypot((u - counterX) * aspect, v - (cy + 0.1)) / counterSize)

    shade = mixRgb(shade, accent, counter * strength * 0.5)

    /* The rule, and the ground it separates. Below it everything settles a shade darker. */
    if (v > horizon) {
      shade = mixRgb(shade, OBSIDIAN, smoothstep((v - horizon) / 0.3) * 0.55)
    }

    const rule = Math.abs(v - horizon) * h

    if (rule < 1.4) {
      shade = mixRgb(shade, STONE, (1 - rule / 1.4) * 0.4)
    }

    /* Tooth, at an amplitude that survives a JPEG encoder. */
    const tooth = weave(x, y, 2.2, 3.4)

    return [shade[0] + tooth, shade[1] + tooth, shade[2] + tooth]
  })
}

/* -------------------------------------------------------------------------------------------------
 * `--preview`, so the art can be judged before sixty-one of it exist
 * ---------------------------------------------------------------------------------------------- */

if (process.argv.includes('--preview')) {
  const dir = join(process.cwd(), 'media-preview')

  mkdirSync(dir, { recursive: true })

  const samples: [string, Buffer][] = [
    [
      'fabric-bone',
      fabric({ hex: '#E7E2D8', height: 1750, macro: false, seed: 'field-jacket', width: 1400 }),
    ],
    [
      'fabric-indigo',
      fabric({ hex: '#2A3550', height: 1750, macro: false, seed: 'selvedge-denim', width: 1400 }),
    ],
    [
      'fabric-rust-macro',
      fabric({ hex: '#8A4B32', height: 1000, macro: true, seed: 'wool-overshirt', width: 800 }),
    ],
    ['editorial-campaign', editorial({ height: 1350, seed: 'campaign-aw26-north', width: 2400 })],
    ['editorial-journal', editorial({ height: 1000, seed: 'journal-on-selvedge', width: 1800 })],
  ]

  for (const [name, bytes] of samples) {
    writeFileSync(join(dir, `${name}.png`), bytes)
  }

  process.stdout.write(
    `${samples.map(([n, b]) => `${n}.png  ${(b.length / 1024).toFixed(0)} KB`).join('\n')}\n\n` +
      `Wrote ${samples.length} preview(s) to ${dir}. Nothing was uploaded and no document changed.\n`,
  )

  process.exit(0)
}

/* -------------------------------------------------------------------------------------------------
 * Writing the assets and attaching them
 * ---------------------------------------------------------------------------------------------- */

const payload: Payload = await getPayload({ config })

const CLEAN = process.argv.includes('--clean')

/** Every asset this script makes carries the marker, so `--clean` can find exactly its own work. */
const MARKER = 'Generated stand-in — pnpm generate:media'

const staging = join(tmpdir(), `north01-media-${Date.now()}`)

mkdirSync(staging, { recursive: true })

const made: string[] = []

async function upload(
  name: string,
  bytes: Buffer,
  alt: string,
  role: 'campaign' | 'editorial' | 'product',
): Promise<number> {
  const file = join(staging, `${name}.png`)

  writeFileSync(file, bytes)

  const doc = await payload.create({
    collection: 'media',
    data: { alt, caption: MARKER, role },
    filePath: file,
    overrideAccess: true,
  })

  made.push(`${name}.png  ${(bytes.length / 1024).toFixed(0)} KB`)

  return doc.id
}

try {
  if (CLEAN) {
    payload.logger.warn(
      'Deleting generated assets. Their Cloudinary objects go with them, and every environment ' +
        'sharing this cloud loses those images until this run finishes re-uploading them.',
    )

    /**
     * **Detach before deleting, or the catalogue becomes unsaveable.**
     *
     * `products.gallery[].image` is `required`, and a media relationship is `ON DELETE SET NULL`
     * (`docs/DATABASE.md` §8). Delete the assets first and every product is left holding gallery rows
     * whose required field is null — so the *product* is now invalid, and the next write to it fails
     * validation. That is not hypothetical: the first version of this block did exactly that, and the
     * failure surfaced two steps later as `syncProductDerived` being unable to refresh a price range,
     * which is a long way from the cause.
     *
     * So the references go first, and the rows they pointed at go second.
     */
    for (const product of (
      await payload.find({ collection: 'products', depth: 0, limit: 500, overrideAccess: true })
    ).docs) {
      await payload.update({
        collection: 'products',
        data: { gallery: [] },
        id: product.id,
        overrideAccess: true,
      })
    }

    for (const variant of (
      await payload.find({
        collection: 'product-variants',
        depth: 0,
        limit: 500,
        overrideAccess: true,
      })
    ).docs) {
      await payload.update({
        collection: 'product-variants',
        data: { image: null },
        id: variant.id,
        overrideAccess: true,
      })
    }

    const detach: [
      'campaigns' | 'categories' | 'collections' | 'edits' | 'journal' | 'lookbooks',
      string[],
    ][] = [
      ['campaigns', ['hero', 'mobileHero']],
      ['categories', ['image']],
      ['collections', ['heroMedia', 'introMedia']],
      ['edits', ['hero']],
      ['journal', ['heroImage']],
      ['lookbooks', ['coverImage']],
    ]

    for (const [collection, fields] of detach) {
      for (const doc of (
        await payload.find({ collection, depth: 0, limit: 500, overrideAccess: true })
      ).docs) {
        await payload.update({
          collection,
          data: Object.fromEntries(fields.map((field) => [field, null])) as never,
          id: doc.id,
          overrideAccess: true,
        })
      }
    }

    /*
     * Paged rather than taken in one bite: `limit` is a page size, not a promise, and a run that
     * removed the first hundred and reported success would leave the rest attached to nothing.
     */
    let removed = 0

    for (;;) {
      const page = await payload.find({
        collection: 'media',
        depth: 0,
        limit: 100,
        overrideAccess: true,
        where: { caption: { equals: MARKER } },
      })

      if (page.docs.length === 0) {
        break
      }

      for (const doc of page.docs) {
        await payload
          .delete({ collection: 'media', id: doc.id, overrideAccess: true })
          .catch(() => undefined)

        removed++
      }
    }

    payload.logger.info(`Detached and removed ${removed} previously generated asset(s).`)
  }

  /* ---- One swatch per colour, shared by every variant that wears it ---- */

  const variants = await payload.find({
    collection: 'product-variants',
    depth: 0,
    limit: 500,
    overrideAccess: true,
  })

  const byColour = new Map<string, { hex: string; ids: number[] }>()

  for (const variant of variants.docs) {
    const colour = String(variant.color)
    const entry = byColour.get(colour) ?? { hex: String(variant.colorHex), ids: [] }

    entry.ids.push(variant.id)
    byColour.set(colour, entry)
  }

  const swatchFor = new Map<string, number>()

  for (const [colour, { hex, ids }] of byColour) {
    const slug = colour.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const id = await upload(
      `swatch-${slug}`,
      fabric({ hex, height: 1000, macro: true, seed: `swatch-${slug}`, width: 800 }),
      `${colour} fabric, woven detail`,
      'product',
    )

    swatchFor.set(colour, id)

    for (const variantId of ids) {
      await payload.update({
        collection: 'product-variants',
        data: { image: id },
        id: variantId,
        overrideAccess: true,
      })
    }
  }

  /* ---- Two gallery images per product: the cloth hanging, and the weave up close ---- */

  const products = await payload.find({
    collection: 'products',
    depth: 0,
    limit: 200,
    overrideAccess: true,
  })

  for (const product of products.docs) {
    const slug = String(product.slug)
    const mine = variants.docs.filter((v) => {
      const owner = typeof v.product === 'number' ? v.product : (v.product as { id: number })?.id

      return owner === product.id
    })

    const primary = mine[0]
    const hex = primary ? String(primary.colorHex) : '#C7B8A0'
    const name = String(product.name)

    const hanging = await upload(
      `product-${slug}`,
      fabric({ hex, height: 1750, macro: false, seed: slug, width: 1400 }),
      `${name} — studio study`,
      'product',
    )

    const close = await upload(
      `product-${slug}-detail`,
      fabric({ hex, height: 1750, macro: true, seed: `${slug}-detail`, width: 1400 }),
      `${name} — fabric detail`,
      'product',
    )

    await payload.update({
      collection: 'products',
      data: { gallery: [{ image: hanging }, { image: close }] },
      id: product.id,
      overrideAccess: true,
    })
  }

  /* ---- Editorial surfaces ---- */

  const editorialTargets = [
    { collection: 'categories' as const, fields: ['image'], height: 1500, width: 1200 },
    {
      collection: 'collections' as const,
      fields: ['heroMedia', 'introMedia'],
      height: 1200,
      width: 2000,
    },
    { collection: 'edits' as const, fields: ['hero'], height: 1200, width: 2000 },
    { collection: 'journal' as const, fields: ['heroImage'], height: 1000, width: 1800 },
    { collection: 'lookbooks' as const, fields: ['coverImage'], height: 1500, width: 1200 },
  ]

  for (const target of editorialTargets) {
    const docs = await payload.find({
      collection: target.collection,
      depth: 0,
      limit: 200,
      overrideAccess: true,
    })

    for (const doc of docs.docs) {
      const slug = String((doc as { slug?: string }).slug ?? doc.id)
      const data: Record<string, number> = {}

      for (const field of target.fields) {
        data[field] = await upload(
          `${target.collection}-${slug}${target.fields.length > 1 ? `-${field}` : ''}`,
          editorial({
            height: target.height,
            seed: `${target.collection}-${slug}-${field}`,
            width: target.width,
          }),
          `${String((doc as { title?: string }).title ?? slug)} — editorial`,
          'editorial',
        )
      }

      await payload.update({
        collection: target.collection,
        data: data as never,
        id: doc.id,
        overrideAccess: true,
      })
    }
  }

  /* ---- Campaigns carry a second, portrait frame for phones ---- */

  const campaigns = await payload.find({
    collection: 'campaigns',
    depth: 0,
    limit: 100,
    overrideAccess: true,
  })

  for (const campaign of campaigns.docs) {
    const slug = String(campaign.slug)

    const hero = await upload(
      `campaign-${slug}`,
      editorial({ height: 1350, seed: `campaign-${slug}`, width: 2400 }),
      `${String(campaign.title)} — campaign`,
      'campaign',
    )

    const mobileHero = await upload(
      `campaign-${slug}-mobile`,
      editorial({ height: 1600, seed: `campaign-${slug}-mobile`, width: 1080 }),
      `${String(campaign.title)} — campaign, portrait`,
      'campaign',
    )

    await payload.update({
      collection: 'campaigns',
      data: { hero, mobileHero },
      id: campaign.id,
      overrideAccess: true,
    })
  }

  /* ---- One sharing image for everything that has none of its own ---- */

  const og = await upload(
    'north01-open-graph',
    editorial({ height: 630, seed: 'north01-open-graph', width: 1200 }),
    'NORTH / 01',
    'editorial',
  )

  const settings = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })

  await payload.updateGlobal({
    slug: 'site-settings',
    data: { ...settings, defaultOgImage: og } as never,
    overrideAccess: true,
  })

  const total = made.length

  process.stdout.write(`${made.join('\n')}\n\n${total} asset(s) generated and attached.\n`)
} finally {
  rmSync(staging, { force: true, recursive: true })
  await payload.destroy()
}
