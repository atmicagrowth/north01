/**
 * **The real photography, imported and placed.**
 *
 * ```
 * pnpm import:media                     # read ./brand-media, upload, attach
 * pnpm import:media -- --from <dir>     # read somewhere else
 * ```
 *
 * `generate-media.ts` fills empty rectangles with art it draws. This does the opposite job: it takes
 * photographs somebody actually shot and puts them where they belong. Where the two disagree, this
 * one wins — a photograph is what the surface was designed for, and the generated fabric studies are
 * the stand-in for its absence.
 *
 * ### The placement is a decision per surface, not a shuffle
 *
 * The map at the bottom of this file is explicit: every file is named against the document and field
 * it fills. That is deliberate. A script that scattered images by index would place a cap photograph
 * on the Jackets tile the first time the file list changed order, and nothing would catch it.
 *
 * ### Where the photographs are *not* used, and why
 *
 * **Product galleries keep the generated art.** The supplied garment photographs are between 224 and
 * 467 pixels wide; a product page renders its gallery at up to 1400. Cloudinary would upscale, and an
 * upscaled 264-pixel photograph on a product page reads as a mistake in a way that a sharp,
 * colour-true fabric study does not. The category tiles are a different matter — they render around
 * 301 CSS pixels, which is the size these files actually are.
 *
 * That is a resolution judgement, not a preference. Supply larger garment photography and the map
 * below is where to say so.
 *
 * ### The D-10 guard applies
 *
 * It creates and updates documents, so it writes only to the database `DATABASE_PUSH_TARGET` names.
 * As with `generate-media.ts`, a deployed database is a legitimate target when it is named
 * explicitly on the command line — and `PAYLOAD_MIGRATING` below means naming it cannot also rewrite
 * its schema.
 *
 * ### One Cloudinary account, two databases
 *
 * Public ids come from filenames, so these objects are shared by every environment pointing at the
 * same cloud. Importing twice overwrites rather than duplicates, which is harmless. Deleting is the
 * dangerous direction — see the note in `generate-media.ts`.
 */

import { existsSync, readdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import type { Payload } from 'payload'

process.env.PAYLOAD_MIGRATING = 'true'

export {}

const { developmentDatabase } = await import('../src/lib/env.core')

if (!developmentDatabase.ok) {
  throw new Error(
    `import-brand-media refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and updates collection documents, so DATABASE_PUSH_TARGET must name the database ' +
      'that DATABASE_URL actually reaches — see D-10.',
  )
}

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')

const payload: Payload = await getPayload({ config })

/** Distinct from `generate-media.ts`'s marker, so neither script can clean up the other's work. */
const MARKER = 'Supplied photography — pnpm import:media'

const fromIndex = process.argv.indexOf('--from')
const fromArg = fromIndex >= 0 ? process.argv[fromIndex + 1] : undefined
const source =
  fromArg && fromArg.length > 0
    ? isAbsolute(fromArg)
      ? fromArg
      : resolve(process.cwd(), fromArg)
    : resolve(process.cwd(), 'brand-media')

if (!existsSync(source)) {
  throw new Error(
    `No source directory at ${source}. Put the photography there, or pass --from <dir>. ` +
      'Filenames matter: the placement map in this script names each one.',
  )
}

type Role = 'campaign' | 'editorial' | 'product'

/**
 * `alt` is written per file rather than generated, because alt text is a description of a photograph
 * and a script cannot see one. These are the descriptions of the images that were handed over.
 */
const LIBRARY: Record<string, { alt: string; role: Role }> = {
  '00_campaign_hero_panorama': {
    alt: 'A model in a black wool coat on a headland, snow-capped mountains and the sea behind him',
    role: 'campaign',
  },
  '01_hero_male_mountain': {
    alt: 'A model in a black jacket against a clouded mountain range, under the NORTH / 01 wordmark',
    role: 'campaign',
  },
  '02_editorial_female_cream': {
    alt: 'A model in a cream knit, lit by low sun',
    role: 'editorial',
  },
  '03_mountain_landscape': { alt: 'A snow-streaked peak under flat grey light', role: 'editorial' },
  '04_cream_fabric_detail': { alt: 'Cream cashmere, folded close', role: 'product' },
  '05_brand_dark_texture': { alt: 'The NORTH / 01 wordmark on a black ground', role: 'editorial' },
  '06_garment_rack': {
    alt: 'A rail of hooded sweatshirts in bone, grey, charcoal and olive',
    role: 'product',
  },
  '07_zipper_label_detail': {
    alt: 'The NORTH / 01 label above a zip on a black hooded jacket',
    role: 'product',
  },
  '08_north01_cap_product': {
    alt: 'An olive six-panel cap with the NORTH / 01 mark',
    role: 'product',
  },
  '09_male_black_outerwear': {
    alt: 'A model in a dark hooded jacket against a pale sky',
    role: 'editorial',
  },
  '10_coastal_black_sand_beach': {
    alt: 'Black sand, surf and sea stacks under an overcast sky',
    role: 'editorial',
  },
  '11_editorial_woman_sunglasses': {
    alt: 'A model in black with wraparound sunglasses, hair caught by the wind',
    role: 'editorial',
  },
  '12_stone_texture': { alt: 'Wet black rock, close', role: 'editorial' },
  '13_brand_typography_panel': {
    alt: 'Timeless essentials for a modern world — NORTH / 01, set on bone',
    role: 'editorial',
  },
  '14_full_body_editorial_male': {
    alt: 'A model in a black sweatshirt and bone trousers on open rock',
    role: 'editorial',
  },
  '15_collared_garment_label': {
    alt: 'The NORTH / 01 neck label on a black crew sweatshirt',
    role: 'product',
  },
  '16_editorial_woman_black': { alt: 'A model in a black wool coat, close', role: 'editorial' },
}

const uploaded = new Map<string, number>()

for (const file of readdirSync(source).filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name))) {
  const key = file.replace(/\.[^.]+$/, '')
  const entry = LIBRARY[key]

  if (!entry) {
    payload.logger.warn(`Skipped ${file} — no entry in the placement map.`)
    continue
  }

  /*
   * Replaced rather than duplicated. The public id comes from the filename, so a second import would
   * otherwise leave two documents pointing at one object, and a later cleanup would delete the object
   * out from under the survivor.
   */
  const { docs } = await payload.find({
    collection: 'media',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { filename: { equals: file } },
  })

  const existing = docs[0]

  if (existing) {
    uploaded.set(key, existing.id)
    continue
  }

  const doc = await payload.create({
    collection: 'media',
    data: { alt: entry.alt, caption: MARKER, role: entry.role },
    filePath: join(source, file),
    overrideAccess: true,
  })

  uploaded.set(key, doc.id)
}

const id = (key: string): number => {
  const found = uploaded.get(key)

  if (found === undefined) {
    throw new Error(`The placement map names ${key}, which is not in ${source}.`)
  }

  return found
}

/* -------------------------------------------------------------------------------------------------
 * The placement map
 * ---------------------------------------------------------------------------------------------- */

type Placement = {
  collection: 'campaigns' | 'categories' | 'collections' | 'edits' | 'journal' | 'lookbooks'
  fields: Record<string, null | string>
  slug: string
}

/**
 * Garment photographs go to garment categories and landscapes go to the editorial surfaces, which is
 * the only arrangement that survives someone looking at it.
 *
 * `campaigns.aw26-north.mobileHero` is set to `null` on purpose. The panorama is 2.5:1 and there is
 * no upright original of it; `MediaImage` re-crops the desktop asset to 4:5 when the mobile field is
 * empty, which is §10.1b's *"mobile image omitted: use safe fallback"* and a better answer than a
 * different photograph of a different subject.
 */
const PLACEMENTS: Placement[] = [
  {
    collection: 'campaigns',
    fields: { hero: '00_campaign_hero_panorama', mobileHero: null },
    slug: 'aw26-north',
  },

  { collection: 'categories', fields: { image: '09_male_black_outerwear' }, slug: 'jackets' },
  { collection: 'categories', fields: { image: '07_zipper_label_detail' }, slug: 'hoodies' },
  { collection: 'categories', fields: { image: '15_collared_garment_label' }, slug: 'sweatshirts' },
  { collection: 'categories', fields: { image: '02_editorial_female_cream' }, slug: 'shirts' },
  { collection: 'categories', fields: { image: '16_editorial_woman_black' }, slug: 'tops' },
  { collection: 'categories', fields: { image: '14_full_body_editorial_male' }, slug: 'pants' },
  { collection: 'categories', fields: { image: '11_editorial_woman_sunglasses' }, slug: 'shorts' },
  { collection: 'categories', fields: { image: '08_north01_cap_product' }, slug: 'accessories' },
  { collection: 'categories', fields: { image: '06_garment_rack' }, slug: 'clothing' },

  {
    collection: 'collections',
    fields: { heroMedia: '01_hero_male_mountain', introMedia: '04_cream_fabric_detail' },
    slug: 'current-season',
  },
  {
    collection: 'collections',
    fields: { heroMedia: '13_brand_typography_panel', introMedia: '12_stone_texture' },
    slug: 'essentials',
  },
  {
    collection: 'collections',
    fields: { heroMedia: '05_brand_dark_texture', introMedia: '03_mountain_landscape' },
    slug: 'limited',
  },
  {
    collection: 'collections',
    fields: { heroMedia: '10_coastal_black_sand_beach', introMedia: '12_stone_texture' },
    slug: 'archive',
  },

  { collection: 'edits', fields: { hero: '02_editorial_female_cream' }, slug: 'everyday' },
  { collection: 'edits', fields: { hero: '11_editorial_woman_sunglasses' }, slug: 'weekend' },
  { collection: 'edits', fields: { hero: '09_male_black_outerwear' }, slug: 'travel' },
  { collection: 'edits', fields: { hero: '13_brand_typography_panel' }, slug: 'gifts' },

  {
    collection: 'journal',
    fields: { heroImage: '03_mountain_landscape' },
    slug: 'a-weekend-north',
  },
  {
    collection: 'journal',
    fields: { heroImage: '10_coastal_black_sand_beach' },
    slug: 'the-case-for-fewer-things',
  },
  { collection: 'journal', fields: { heroImage: '04_cream_fabric_detail' }, slug: 'on-selvedge' },

  { collection: 'lookbooks', fields: { coverImage: '00_campaign_hero_panorama' }, slug: 'aw26' },
]

const placed: string[] = []

for (const placement of PLACEMENTS) {
  const { docs } = await payload.find({
    collection: placement.collection,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { slug: { equals: placement.slug } },
  })

  const doc = docs[0]

  if (!doc) {
    payload.logger.warn(`No ${placement.collection} with slug ${placement.slug}; skipped.`)
    continue
  }

  const data = Object.fromEntries(
    Object.entries(placement.fields).map(([field, key]) => [field, key === null ? null : id(key)]),
  )

  await payload.update({
    collection: placement.collection,
    data: data as never,
    id: doc.id,
    overrideAccess: true,
  })

  placed.push(
    `${placement.collection}/${placement.slug}  ${Object.entries(placement.fields)
      .map(([field, key]) => `${field}=${key ?? 'null'}`)
      .join(' ')}`,
  )
}

/*
 * **Hotspots, composed on the photograph they point into** — Phase 35, audits P35-02 and P35-09.
 *
 * A hotspot is a position on one particular picture. The seed used to write positions with no
 * picture (the AW26 chapters, which then rendered neither) or on whatever media came first (the
 * homepage Shop the Look, on a fabric swatch). Here the image and the positions are chosen together,
 * by eye, against the files in `brand-media/`: `14_` is a full-length figure in a black crew and cream
 * trousers, `09_` a close portrait in a black shell jacket.
 */
const productBySlug = async (slug: string): Promise<number | undefined> =>
  (
    await payload.find({
      collection: 'products',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { slug: { equals: slug } },
    })
  ).docs[0]?.id as number | undefined

const spot = async (
  slug: string,
  label: string,
  x: number,
  y: number,
  markerTone: 'dark' | 'light',
) => {
  const product = await productBySlug(slug)

  return product === undefined
    ? []
    : [{ label, markerTone, product, xDesktop: x, xMobile: x, yDesktop: y, yMobile: y }]
}

const fullLengthLook = [
  ...(await spot('merino-crew', 'Merino Crew', 50, 32, 'light')),
  ...(await spot('pleated-trouser', 'Pleated Trouser', 48, 66, 'dark')),
]

const { docs: lookbooks } = await payload.find({
  collection: 'lookbooks',
  depth: 0,
  limit: 1,
  overrideAccess: true,
  where: { slug: { equals: 'aw26' } },
})

const aw26 = lookbooks[0]

if (aw26) {
  const chapterImages: Record<string, { hotspots: unknown[]; image: string }> = {
    Headland: {
      hotspots: await spot('field-jacket', 'Field Jacket', 30, 82, 'light'),
      image: '09_male_black_outerwear',
    },
    Inland: { hotspots: fullLengthLook, image: '14_full_body_editorial_male' },
  }

  await payload.update({
    collection: 'lookbooks',
    data: {
      chapters: (aw26.chapters ?? []).map((chapter) => {
        const composed = chapterImages[chapter.title]

        return composed
          ? { ...chapter, heroImage: id(composed.image), hotspots: composed.hotspots }
          : chapter
      }),
    } as never,
    id: aw26.id,
    overrideAccess: true,
  })

  placed.push('lookbooks/aw26  chapters: Headland=09 (1 hotspot), Inland=14 (2 hotspots)')
}

const homepage = await payload.findGlobal({ depth: 0, overrideAccess: true, slug: 'homepage' })
const sections = [...((homepage.sections ?? []) as { blockType: string }[])]
const look = {
  blockType: 'shopTheLook',
  heading: 'Shop the look',
  hotspots: fullLengthLook,
  image: id('14_full_body_editorial_male'),
}
const existingLook = sections.findIndex((section) => section.blockType === 'shopTheLook')

if (existingLook >= 0) {
  sections[existingLook] = look
} else {
  const afterRail = sections.findIndex((section) => section.blockType === 'productRail')

  sections.splice(afterRail >= 0 ? afterRail + 1 : sections.length, 0, look)
}

await payload.updateGlobal({
  data: { ...homepage, sections } as never,
  overrideAccess: true,
  slug: 'homepage',
})

placed.push('homepage  shopTheLook=14 (2 hotspots)')

/* The sharing image is the one that has to say the brand's name in a card with no context. */
const settings = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })

await payload.updateGlobal({
  data: { ...settings, defaultOgImage: id('13_brand_typography_panel') } as never,
  overrideAccess: true,
  slug: 'site-settings',
})

process.stdout.write(
  `${placed.join('\n')}\n\n${uploaded.size} photograph(s) imported, ${placed.length} placement(s) written.\n`,
)

await payload.destroy()
