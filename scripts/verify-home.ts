/**
 * The Phase 10 homepage rules, checked against the running code rather than against the comments
 * that describe them.
 *
 * ```
 * pnpm verify:home
 * ```
 *
 * **It runs in two halves**, the same shape `verify-shell.ts` established.
 *
 * The first needs no database. `lib/home/resolve.ts`, `lib/money.ts` and `lib/home/sizes.ts` import
 * nothing from Next and nothing from the server — that separation exists so that every edge case in
 * feature matrix §3 can be exercised here as a pure function, one fixture per case, instead of being
 * asserted by reading a browser.
 *
 * The second half does the thing fixtures cannot: it creates **real** Payload documents in the
 * states that matter — a draft campaign, a scheduled one, a product with no active variant — and
 * checks that the resolver drops exactly what a customer must not see. A hand-written fixture proves
 * the function; a real document proves the function is being fed what it thinks it is. That is the
 * difference that mattered in Phase 7's access harness, which passed while testing the wrong user.
 *
 * It writes to the database and cleans up after itself, and refuses to run anywhere but the
 * development database `DATABASE_PUSH_TARGET` names — the **D-10** guard, the same one `seed.ts`,
 * `verify-access.ts`, `verify-media.ts` and `verify-shell.ts` use.
 *
 * `lib/home/home.ts` is deliberately **not** imported: it is `server-only` and depends on Next's
 * data cache, neither of which exists under the Payload CLI. That module holds caching and a
 * try/catch and no rules, which is why every rule lives somewhere this script can reach.
 *
 * One check here has no equivalent in any earlier harness: **§T asserts that no generated Postgres
 * identifier has been truncated.** Phase 10 is the first phase to put blocks under a global, where
 * the `${global}_blocks_${block}_${field}_id_${target}_id_fk` template runs long — and a breach is
 * silent, because Postgres truncates with a NOTICE and the matching `DROP CONSTRAINT` truncates
 * identically, so a roll forward and back passes while the Drizzle snapshot holds a name the
 * database has never had.
 */

import type { Payload } from 'payload'

import config from '../src/payload.config'

import { developmentDatabase } from '../src/lib/env.core'
import { formatMinorUnits, formatPriceRange } from '../src/lib/money'
import { HOME_IMAGE_SIZES } from '../src/lib/home/sizes'
import {
  EMPTY_HOME,
  RAIL_FLAG,
  isPublicDocument,
  railRequests,
  railWhere,
  resolveHome,
  resolveProductTile,
  type RailProducts,
  type RailSource,
} from '../src/lib/home/resolve'
import { isExternalHref, isInternalHref } from '../src/lib/navigation/routes'
import { NewsletterSchema } from '../src/lib/newsletter/schemas'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-home refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes collection documents, so it may only touch the development database ' +
      'that DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const { getPayload } = await import('payload')

/* -------------------------------------------------------------------------------------------------
 * Harness
 * ---------------------------------------------------------------------------------------------- */

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

const USD = 'USD' as const
const EN = 'en-US'

/** The fixture shape `resolveHome` accepts, without exporting an internal type to reach it. */
type HomepageFixture = Parameters<typeof resolveHome>[0]['homepage']

const NO_RAILS: RailProducts = new Map()

/** Resolve a bare list of blocks. */
const resolve = (sections: unknown[], rails: RailProducts = NO_RAILS) =>
  resolveHome({
    homepage: { sections } as unknown as HomepageFixture,
    rails,
    currency: USD,
    locale: EN,
  })

/** One block in, one resolved section out — or `undefined` if it was dropped. */
const one = (section: unknown, rails: RailProducts = NO_RAILS) =>
  resolve([section], rails).sections[0]

/** A published, purchasable product document, with overrides. */
const product = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Field Jacket',
  slug: 'field-jacket',
  status: 'published',
  gallery: [],
  derived: { priceFromMinor: 24000, priceToMinor: 24000, inventoryTotal: 5 },
  ...overrides,
})

const publishedCampaign = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Due North',
  slug: 'aw26',
  season: 'AW26',
  status: 'published',
  ...overrides,
})

/* -------------------------------------------------------------------------------------------------
 * A — rail sourcing
 * ---------------------------------------------------------------------------------------------- */

const RAIL_CASES: [RailSource, string][] = [
  ['new', 'isNew'],
  ['bestSellers', 'isBestSeller'],
  ['limited', 'isLimitedEdition'],
  ['featured', 'featured'],
]

for (const [source, column] of RAIL_CASES) {
  check(`rail: ${source} filters on ${column}`, RAIL_FLAG[source] === column, RAIL_FLAG[source])
}

check(
  'rail: RAIL_FLAG has exactly the four sources the block offers',
  Object.keys(RAIL_FLAG).length === 4,
  Object.keys(RAIL_FLAG).join(', '),
)

{
  const where = railWhere('new', '2026-08-28T00:00:00.000Z') as {
    and: Record<string, unknown>[]
  }

  check('rail: the query is a conjunction of three clauses', where.and?.length === 3)

  check(
    'rail: every query demands status = published',
    JSON.stringify(where.and[0]) === JSON.stringify({ status: { equals: 'published' } }),
    JSON.stringify(where.and[0]),
  )

  check(
    'rail: a scheduled product is excluded by the publishedAt disjunction',
    JSON.stringify(where.and[1]).includes('less_than_equal') &&
      JSON.stringify(where.and[1]).includes('exists'),
    JSON.stringify(where.and[1]),
  )
}

{
  const requests = railRequests({
    sections: [
      { blockType: 'promoStrip', id: 'a', items: [] },
      { blockType: 'productRail', id: 'b', source: 'bestSellers', limit: 6 },
      { blockType: 'productRail', id: 'c', source: 'new' },
      // A row written before the field's min/max existed.
      { blockType: 'productRail', id: 'd', source: 'new', limit: 900 },
    ],
  } as unknown as HomepageFixture)

  check('rail: only productRail blocks request products', requests.length === 3)
  check('rail: the request key is the block id', requests[0]?.key === 'b', requests[0]?.key)
  check('rail: an absent limit defaults to 4', requests[1]?.limit === 4, String(requests[1]?.limit))
  check(
    'rail: an absurd stored limit is clamped to 12',
    requests[2]?.limit === 12,
    String(requests[2]?.limit),
  )
}

/* -------------------------------------------------------------------------------------------------
 * B — the product tile, and every way a relationship can be invalid
 * ---------------------------------------------------------------------------------------------- */

const TILE_DROPS: [string, unknown][] = [
  ['an unpopulated relationship (a bare id)', 7],
  ['a deleted target (ON DELETE SET NULL)', null],
  ['undefined', undefined],
  ['a draft', product({ status: 'draft' })],
  ['a soft-deleted row', product({ deletedAt: '2026-08-01T00:00:00.000Z' })],
  ['a future publication date', product({ publishedAt: '2099-01-01T00:00:00.000Z' })],
  ['an empty slug', product({ slug: '' })],
  ['a missing slug', product({ slug: undefined })],
  ['an empty name', product({ name: '   ' })],
  [
    'no purchasable price (no active variant)',
    product({ derived: { priceFromMinor: null, inventoryTotal: 0 } }),
  ],
]

for (const [label, value] of TILE_DROPS) {
  check(`tile: dropped — ${label}`, resolveProductTile(value, USD, EN) === null)
}

{
  const tile = resolveProductTile(product(), USD, EN)

  check('tile: a published, priced product resolves', tile !== null)
  check(
    'tile: the href comes from the route map',
    tile?.href === '/product/field-jacket',
    tile?.href ?? '',
  )
  check('tile: the price is formatted', tile?.priceLabel === '$240.00', tile?.priceLabel ?? '')
  check('tile: in stock is not sold out', tile?.soldOut === false)
}

check(
  'tile: KEPT when out of stock — the sold-out card state is Phase 11 (§11.1b)',
  resolveProductTile(product({ derived: { priceFromMinor: 24000, inventoryTotal: 0 } }), USD, EN)
    ?.soldOut === true,
)

check(
  'tile: KEPT when the gallery is empty — MediaImage renders the placeholder',
  resolveProductTile(product({ gallery: [] }), USD, EN)?.image === null,
)

check(
  'tile: an unpopulated gallery image is treated as absent, never rendered as an id',
  resolveProductTile(product({ gallery: [{ image: 42 }] }), USD, EN)?.image === null,
)

check(
  'tile: a price range reads "From"',
  resolveProductTile(
    product({ derived: { priceFromMinor: 9500, priceToMinor: 14500, inventoryTotal: 3 } }),
    USD,
    EN,
  )?.priceLabel === 'From $95.00',
)

check(
  'tile: a slug is encoded, so a stored traversal cannot climb out of /product/',
  resolveProductTile(product({ slug: '../../admin' }), USD, EN)?.href ===
    '/product/..%2F..%2Fadmin',
  resolveProductTile(product({ slug: '../../admin' }), USD, EN)?.href ?? '',
)

/* -------------------------------------------------------------------------------------------------
 * C — publication
 * ---------------------------------------------------------------------------------------------- */

check('publication: a published document is public', isPublicDocument({ status: 'published' }))
check('publication: a draft is not', !isPublicDocument({ status: 'draft' }))
check(
  'publication: a soft-deleted document is not, whatever its status',
  !isPublicDocument({ status: 'published', deletedAt: '2026-01-01T00:00:00.000Z' }),
)
check(
  'publication: a future publishedAt is not yet public',
  !isPublicDocument({ status: 'published', publishedAt: '2099-01-01T00:00:00.000Z' }),
)
check(
  'publication: a past publishedAt is public',
  isPublicDocument({ status: 'published', publishedAt: '2020-01-01T00:00:00.000Z' }),
)
check(
  'publication: a category, which carries no publishedAt at all, is public when published',
  isPublicDocument({ status: 'published', name: 'Jackets', slug: 'jackets' }),
)
check(
  'publication: an unparseable date is not evidence — the status column already said published',
  isPublicDocument({ status: 'published', publishedAt: 'not a date' }),
)

/* -------------------------------------------------------------------------------------------------
 * D — every block, in every state the matrix names
 * ---------------------------------------------------------------------------------------------- */

// --- hero
check(
  'hero: a published campaign resolves',
  one({ blockType: 'hero', campaign: publishedCampaign() })?.type === 'hero',
)
check(
  'hero: DROPPED — a draft campaign',
  one({ blockType: 'hero', campaign: publishedCampaign({ status: 'draft' }) }) === undefined,
)
check(
  'hero: DROPPED — a scheduled campaign (structure §12 "scheduled/past campaign")',
  one({
    blockType: 'hero',
    campaign: publishedCampaign({ publishedAt: '2099-01-01T00:00:00.000Z' }),
  }) === undefined,
)
check(
  'hero: DROPPED — a deleted campaign leaves null',
  one({ blockType: 'hero', campaign: null }) === undefined,
)
check(
  'hero: DROPPED — an unpopulated campaign is a bare id',
  one({ blockType: 'hero', campaign: 3 }) === undefined,
)
check(
  'hero: DROPPED — a campaign with no title',
  one({ blockType: 'hero', campaign: publishedCampaign({ title: ' ' }) }) === undefined,
)

{
  const hero = one({ blockType: 'hero', campaign: publishedCampaign() })

  check('hero: KEPT with no image — §10.1b, the placeholder reserves the box', hero !== undefined)
  check(
    'hero: no CTA is a legitimate state (§10.1b "CTA omitted")',
    hero?.type === 'hero' && hero.primary === null,
  )
}

{
  const hero = one({
    blockType: 'hero',
    campaign: publishedCampaign({
      cta: { kind: 'url', label: 'See the collection', href: '/collections/limited' },
      secondaryCta: { kind: 'url', label: 'Read the story', href: '/journal/a-weekend-north' },
    }),
  })

  check(
    'hero: both §10.1b CTAs resolve',
    hero?.type === 'hero' && hero.primary !== null && hero.secondary !== null,
  )
}

check(
  'hero: a CTA with a valid href but no label is dropped — resolveLink requires words',
  (() => {
    const hero = one({
      blockType: 'hero',
      campaign: publishedCampaign({ cta: { kind: 'url', label: '  ', href: '/shop' } }),
    })

    return hero?.type === 'hero' && hero.primary === null
  })(),
)

// --- promoStrip
check('promoStrip: DROPPED — no items', one({ blockType: 'promoStrip', items: [] }) === undefined)
check(
  'promoStrip: DROPPED — every item blank',
  one({ blockType: 'promoStrip', items: [{ text: ' ' }] }) === undefined,
)
check(
  'promoStrip: a blank statement is dropped and the rest survive',
  (() => {
    const strip = one({
      blockType: 'promoStrip',
      items: [{ text: ' ' }, { text: 'Thirty-day returns' }],
    })

    return strip?.type === 'promoStrip' && strip.items.length === 1
  })(),
)

// --- categoryTiles
const category = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Jackets',
  slug: 'jackets',
  status: 'published',
  ...overrides,
})

check(
  'categoryTiles: a published category resolves to /shop/<slug>',
  (() => {
    const tiles = one({ blockType: 'categoryTiles', items: [{ category: category() }] })

    return tiles?.type === 'categoryTiles' && tiles.tiles[0]?.href === '/shop/jackets'
  })(),
)
check(
  'categoryTiles: DROPPED — the only tile pointed at a draft category',
  one({ blockType: 'categoryTiles', items: [{ category: category({ status: 'draft' }) }] }) ===
    undefined,
)
check(
  'categoryTiles: one dropped tile does not drop the section',
  (() => {
    const tiles = one({
      blockType: 'categoryTiles',
      items: [{ category: category({ status: 'draft' }) }, { category: category({ id: 2 }) }],
    })

    return tiles?.type === 'categoryTiles' && tiles.tiles.length === 1
  })(),
)
check(
  'categoryTiles: the label falls back to the category name',
  (() => {
    const tiles = one({
      blockType: 'categoryTiles',
      items: [{ category: category(), label: '  ' }],
    })

    return tiles?.type === 'categoryTiles' && tiles.tiles[0]?.name === 'Jackets'
  })(),
)

// --- productRail / productGroup
check(
  'productRail: DROPPED — the query returned nothing (matrix §3 "empty section")',
  one({ blockType: 'productRail', id: 'r', source: 'new' }, new Map([['r', []]])) === undefined,
)
check(
  'productRail: DROPPED — every product resolved was invalid',
  one({ blockType: 'productRail', id: 'r', source: 'new' }, new Map([['r', [7, null]]])) ===
    undefined,
)
check(
  'productRail: resolves from the loader’s map, keyed by block id',
  (() => {
    const rail = one(
      { blockType: 'productRail', id: 'r', source: 'new' },
      new Map([['r', [product()]]]),
    )

    return rail?.type === 'productRail' && rail.products.length === 1
  })(),
)
check(
  'productGroup: the curated order is preserved exactly',
  (() => {
    const group = one({
      blockType: 'productGroup',
      products: [
        product({ id: 2, slug: 'b', name: 'B' }),
        product({ id: 1, slug: 'a', name: 'A' }),
      ],
    })

    return group?.type === 'productRail' && group.products.map((p) => p.id).join(',') === '2,1'
  })(),
)
check(
  'productGroup: DROPPED — every product invalid (matrix §3 "invalid product relationship")',
  one({ blockType: 'productGroup', products: [7, null, product({ status: 'draft' })] }) ===
    undefined,
)
check(
  'productGroup: normalises to the same shape as productRail, so one component renders both',
  one({ blockType: 'productGroup', products: [product()] })?.type === 'productRail',
)

// --- collectionFeature
const collection = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Limited',
  slug: 'limited',
  status: 'published',
  ...overrides,
})

check(
  'collectionFeature: DROPPED — a draft collection',
  one({ blockType: 'collectionFeature', collection: collection({ status: 'draft' }) }) ===
    undefined,
)
check(
  'collectionFeature: DROPPED — a deleted collection',
  one({ blockType: 'collectionFeature', collection: null }) === undefined,
)
check(
  '§10.1c: a collection feature ALWAYS has a path into commerce, even with no CTA authored',
  (() => {
    const feature = one({ blockType: 'collectionFeature', collection: collection() })

    return feature?.type === 'collectionFeature' && feature.cta.href === '/collections/limited'
  })(),
)
check(
  'collectionFeature: an authored CTA overrides the words, not the existence of the link',
  (() => {
    const feature = one({
      blockType: 'collectionFeature',
      collection: collection(),
      cta: { kind: 'url', label: 'Shop limited', href: '/shop' },
    })

    return feature?.type === 'collectionFeature' && feature.cta.label === 'Shop limited'
  })(),
)

// --- socialGallery
check(
  'socialGallery: DROPPED — no populated images',
  one({ blockType: 'socialGallery', items: [{ image: 5 }, { handle: '@north01' }] }) === undefined,
)
check(
  'socialGallery: an item with an image survives; one without is dropped',
  (() => {
    const gallery = one({
      blockType: 'socialGallery',
      items: [{ image: { id: 1, alt: 'x' } }, { handle: '@north01' }],
    })

    return gallery?.type === 'socialGallery' && gallery.items.length === 1
  })(),
)

// --- figure / splitFeature / editorial
check('figure: DROPPED — no image', one({ blockType: 'figure', image: null }) === undefined)
check(
  'figure: DROPPED — an unpopulated image',
  one({ blockType: 'figure', image: 9 }) === undefined,
)
check(
  'figure: contained is the default treatment — "occasional full-bleed moments"',
  (() => {
    const figure = one({ blockType: 'figure', image: { id: 1, alt: 'x' } })

    return figure?.type === 'figure' && figure.treatment === 'contained'
  })(),
)
check(
  'splitFeature: DROPPED — no image',
  one({ blockType: 'splitFeature', heading: 'x' }) === undefined,
)
check(
  'splitFeature: DROPPED — an image with no words is a figure, and that block exists',
  one({ blockType: 'splitFeature', image: { id: 1, alt: 'x' } }) === undefined,
)
check('editorial: DROPPED — no heading and no body', one({ blockType: 'editorial' }) === undefined)
check(
  'editorial: a heading alone is enough',
  one({ blockType: 'editorial', heading: 'Cloth chosen for weather' })?.type === 'editorial',
)

// --- shopTheLook
const hotspot = (overrides: Record<string, unknown> = {}) => ({
  product: product(),
  xDesktop: 40,
  yDesktop: 50,
  xMobile: 45,
  yMobile: 55,
  ...overrides,
})

check(
  'shopTheLook: DROPPED — no image',
  one({ blockType: 'shopTheLook', hotspots: [hotspot()] }) === undefined,
)
check(
  'shopTheLook: DROPPED — every hotspot invalid',
  one({
    blockType: 'shopTheLook',
    image: { id: 1, alt: 'x' },
    hotspots: [hotspot({ product: null })],
  }) === undefined,
)
check(
  'shopTheLook: a hotspot missing coordinates is dropped, not placed at 0,0',
  one({
    blockType: 'shopTheLook',
    image: { id: 1, alt: 'x' },
    hotspots: [hotspot({ xDesktop: undefined })],
  }) === undefined,
)
check(
  'shopTheLook: coordinate 0 is legitimate and must not be dropped as falsy',
  (() => {
    const look = one({
      blockType: 'shopTheLook',
      image: { id: 1, alt: 'x' },
      hotspots: [hotspot({ xDesktop: 0, yDesktop: 0, xMobile: 0, yMobile: 0 })],
    })

    return look?.type === 'shopTheLook' && look.hotspots.length === 1
  })(),
)
check(
  'shopTheLook: the look survives when one of two hotspots drops',
  (() => {
    const look = one({
      blockType: 'shopTheLook',
      image: { id: 1, alt: 'x' },
      hotspots: [hotspot({ product: null }), hotspot()],
    })

    return look?.type === 'shopTheLook' && look.hotspots.length === 1
  })(),
)

/* -------------------------------------------------------------------------------------------------
 * E — the composition as a whole
 * ---------------------------------------------------------------------------------------------- */

check(
  'home: null resolves to an empty page without throwing',
  resolveHome({ homepage: null, rails: NO_RAILS, currency: USD, locale: EN }).sections.length === 0,
)
check(
  'home: undefined resolves to an empty page',
  resolveHome({ homepage: undefined, rails: NO_RAILS, currency: USD, locale: EN }).sections
    .length === 0,
)
check('home: an empty sections array is an empty page', resolve([]).sections.length === 0)
check(
  'home: a list of entirely invalid sections is an empty page, not a crash',
  resolve([
    { blockType: 'hero', campaign: null },
    { blockType: 'promoStrip', items: [] },
  ]).sections.length === 0,
)
check(
  'home: EMPTY_HOME is not degraded — an editor emptying the page is not a failure',
  EMPTY_HOME.degraded === false,
)

check(
  'home: an unrecognised block type costs that section, never the page',
  resolve([
    { blockType: 'somethingFromANewerDeployment' },
    { blockType: 'editorial', heading: 'x' },
  ]).sections.length === 1,
)

check(
  'home: the editor’s order is preserved exactly',
  resolve([
    { blockType: 'editorial', heading: 'first' },
    { blockType: 'promoStrip', items: [{ text: 'second' }] },
    { blockType: 'editorial', heading: 'third' },
  ])
    .sections.map((s) => s.type)
    .join(',') === 'editorial,promoStrip,editorial',
)

/* --- LCP */
check(
  'lcp: set on exactly one section',
  resolve([
    { blockType: 'hero', campaign: publishedCampaign({ hero: { id: 1, alt: 'x' } }) },
    { blockType: 'figure', image: { id: 2, alt: 'y' } },
  ]).sections.filter((s) => s.lcp).length === 1,
)
check(
  'lcp: NOT index 0 — it follows the picture, so a leading promo strip does not claim it',
  (() => {
    const { sections } = resolve([
      { blockType: 'promoStrip', items: [{ text: 'Made in small runs' }] },
      { blockType: 'figure', image: { id: 2, alt: 'y' } },
    ])

    return sections[0]?.lcp === false && sections[1]?.lcp === true
  })(),
)
check(
  'lcp: a hero with no image does not claim priority for a placeholder',
  (() => {
    const { sections } = resolve([
      { blockType: 'hero', campaign: publishedCampaign() },
      { blockType: 'figure', image: { id: 2, alt: 'y' } },
    ])

    return sections[0]?.lcp === false && sections[1]?.lcp === true
  })(),
)
check(
  'lcp: a page with no imagery at all sets it on nothing',
  resolve([{ blockType: 'editorial', heading: 'x' }]).sections.every((s) => !s.lcp),
)

/* --- headings */
check(
  'heading: a surviving hero owns the h1',
  resolve([{ blockType: 'hero', campaign: publishedCampaign() }]).hasHeading,
)
check(
  'heading: no hero means the page supplies a visually hidden h1',
  !resolve([{ blockType: 'editorial', heading: 'x' }]).hasHeading,
)
check(
  'heading: a dropped hero does not leave hasHeading true',
  !resolve([{ blockType: 'hero', campaign: publishedCampaign({ status: 'draft' }) }]).hasHeading,
)

/* --- keys */
check(
  'keys: unique across sections whose content is identical (notes §1.14.13, finding 4)',
  (() => {
    const { sections } = resolve([
      { blockType: 'editorial', heading: 'Same words' },
      { blockType: 'editorial', heading: 'Same words' },
    ])

    return sections.length === 2 && sections[0]!.key !== sections[1]!.key
  })(),
)
check(
  'keys: a block id is used when present',
  resolve([{ blockType: 'editorial', id: 'abc', heading: 'x' }]).sections[0]?.key === 'abc',
)

/* -------------------------------------------------------------------------------------------------
 * F — money
 * ---------------------------------------------------------------------------------------------- */

const MONEY: [string, null | string, null | string][] = [
  ['24000 USD', formatMinorUnits(24000, 'USD', 'en-US'), '$240.00'],
  ['0 USD', formatMinorUnits(0, 'USD', 'en-US'), '$0.00'],
  ['9999 GBP en-GB', formatMinorUnits(9999, 'GBP', 'en-GB'), '£99.99'],
  ['null', formatMinorUnits(null, 'USD', 'en-US'), null],
  ['undefined', formatMinorUnits(undefined, 'USD', 'en-US'), null],
  ['NaN', formatMinorUnits(Number.NaN, 'USD', 'en-US'), null],
  ['Infinity', formatMinorUnits(Number.POSITIVE_INFINITY, 'USD', 'en-US'), null],
  ['a negative price', formatMinorUnits(-100, 'USD', 'en-US'), null],
  ['a fractional minor unit', formatMinorUnits(19.99, 'USD', 'en-US'), null],
]

for (const [label, actual, expected] of MONEY) {
  check(`money: ${label}`, actual === expected, `${actual}`)
}

check(
  'money: an equal range is a single price',
  formatPriceRange(24000, 24000, 'USD', 'en-US') === '$240.00',
)
check(
  'money: a real range reads From',
  formatPriceRange(9500, 14500, 'USD', 'en-US') === 'From $95.00',
)
check(
  'money: a null high bound is a single price',
  formatPriceRange(9500, null, 'USD', 'en-US') === '$95.00',
)
check(
  'money: no low bound is no price at all',
  formatPriceRange(null, 14500, 'USD', 'en-US') === null,
)
check(
  'money: an invalid locale degrades to no price rather than throwing on a rail',
  formatMinorUnits(24000, 'USD', 'not-a-locale!!') === null,
)

/* -------------------------------------------------------------------------------------------------
 * G — sizes, and the rich-text href rule (D-35)
 * ---------------------------------------------------------------------------------------------- */

for (const [surface, value] of Object.entries(HOME_IMAGE_SIZES)) {
  check(
    `sizes: ${surface} is a non-empty string`,
    typeof value === 'string' && value.length > 0,
    value,
  )
}

/*
 * The Lexical link node stores whatever an editor typed — `LinkFeature()` is registered with no
 * field override — so `Prose` re-validates it at render. The rule is pulled from the real module
 * rather than restated here: a copy would pass while the component shipped the old one, which is
 * exactly the failure Phase 9's audit found across four files.
 */
const SAFE_HREF = (value: string) => isInternalHref(value) || isExternalHref(value)

const HREFS: [string, boolean][] = [
  ['/shop', true],
  ['/collections/limited', true],
  ['https://instagram.com/north01', true],
  ['http://example.com', true],
  ['javascript:alert(1)', false],
  ['data:text/html,<script>alert(1)</script>', false],
  ['//evil.example', false],
  ['/\t/evil.example', false],
  ['/\n/evil.example', false],
  ['\\/\\/evil.example', false],
  ['shop', false],
  ['', false],
]

for (const [href, expected] of HREFS) {
  check(
    `prose href: ${JSON.stringify(href)} → ${expected ? 'link' : 'plain text'}`,
    SAFE_HREF(href) === expected,
  )
}

/* -------------------------------------------------------------------------------------------------
 * H — the newsletter schema
 * ---------------------------------------------------------------------------------------------- */

check(
  'newsletter: the field is newsletterEmail, not email — the footer is on every route',
  'newsletterEmail' in NewsletterSchema.shape,
)

{
  const parsed = NewsletterSchema.safeParse({ newsletterEmail: '  Ada@Example.COM ' })

  check(
    'newsletter: a pasted address is trimmed and lowercased',
    parsed.success && parsed.data.newsletterEmail === 'ada@example.com',
    parsed.success ? parsed.data.newsletterEmail : 'rejected',
  )
}

for (const [label, value] of [
  ['empty', ''],
  ['malformed', 'not-an-email'],
  ['no domain', 'ada@'],
  ['over 320 characters', `${'a'.repeat(315)}@example.com`],
] as const) {
  check(
    `newsletter: rejected — ${label}`,
    !NewsletterSchema.safeParse({ newsletterEmail: value }).success,
  )
}

/* -------------------------------------------------------------------------------------------------
 * The database half
 * ---------------------------------------------------------------------------------------------- */

const payload: Payload = await getPayload({ config })

const PREFIX = 'verify-home'
const created: { collection: 'campaigns' | 'products'; id: number }[] = []

const cleanup = async () => {
  for (const { collection, id } of created.reverse()) {
    try {
      await payload.delete({ collection, id, overrideAccess: true, trash: false })
    } catch {
      // Already gone — a test may have deleted it deliberately.
    }
  }
}

try {
  /* --- I: the global exists and reads back */
  const homepage = await payload.findGlobal({ slug: 'homepage', depth: 2 })

  check('live: the homepage global reads', homepage !== null && typeof homepage === 'object')
  check(
    'live: sections is an array',
    Array.isArray(homepage?.sections),
    `${homepage?.sections?.length ?? 0} sections`,
  )

  /*
   * `depth: 2` is the number the loader uses, and the reason is that a hero's campaign is hop 1 and
   * that campaign's own image and CTA reference are hop 2. Asserting it against real data is the
   * only way to know the homepage will render photographs rather than integers.
   */
  const heroSection = homepage?.sections?.find((section) => section.blockType === 'hero')

  if (heroSection && 'campaign' in heroSection) {
    check(
      'live: depth 2 populates the hero’s campaign as a document, not an id',
      typeof heroSection.campaign === 'object' && heroSection.campaign !== null,
      typeof heroSection.campaign,
    )
  }

  /* --- J: real campaigns in every publication state */
  const makeCampaign = async (suffix: string, data: Record<string, unknown>) => {
    const doc = await payload.create({
      collection: 'campaigns',
      overrideAccess: true,
      data: { title: `${PREFIX} ${suffix}`, slug: `${PREFIX}-${suffix}`, ...data } as never,
    })

    created.push({ collection: 'campaigns', id: doc.id })

    return doc
  }

  const livePublished = await makeCampaign('published', { status: 'published' })
  const liveDraft = await makeCampaign('draft', { status: 'draft' })
  const liveScheduled = await makeCampaign('scheduled', {
    status: 'published',
    publishedAt: '2099-01-01T00:00:00.000Z',
  })

  check(
    'live: a published campaign renders a hero',
    one({ blockType: 'hero', campaign: livePublished })?.type === 'hero',
  )
  check(
    'live: a real DRAFT campaign drops the hero',
    one({ blockType: 'hero', campaign: liveDraft }) === undefined,
  )
  check(
    'live: a real SCHEDULED campaign drops the hero',
    one({ blockType: 'hero', campaign: liveScheduled }) === undefined,
  )

  check(
    'live: campaigns.secondaryCta exists — the field §10.1b named and Phase 6 did not have',
    'secondaryCta' in livePublished,
  )

  /* --- K: derived price, proved rather than assumed */
  const bare = await payload.create({
    collection: 'products',
    overrideAccess: true,
    data: {
      name: `${PREFIX} no variants`,
      slug: `${PREFIX}-no-variants`,
      status: 'published',
      sortOrder: 0,
    } as never,
  })

  created.push({ collection: 'products', id: bare.id })

  check(
    'live: a product with no active variant really has derived.priceFromMinor === null',
    bare.derived?.priceFromMinor === null || bare.derived?.priceFromMinor === undefined,
    String(bare.derived?.priceFromMinor),
  )

  check(
    'live: and is therefore dropped from a rail — an unbuyable product is not merchandise',
    resolveProductTile(bare, USD, EN) === null,
  )

  /* --- L: the rail query against real data */
  const now = new Date().toISOString()

  for (const source of ['new', 'bestSellers', 'limited', 'featured'] as RailSource[]) {
    const { docs } = await payload.find({
      collection: 'products',
      depth: 1,
      limit: 4,
      pagination: false,
      sort: ['sortOrder', '-publishedAt'],
      where: railWhere(source, now),
    })

    check(
      `live: the ${source} rail returns published products only`,
      docs.every((doc) => doc.status === 'published'),
      `${docs.length} products`,
    )
    check(`live: the ${source} rail is not empty after seeding`, docs.length > 0, `${docs.length}`)
    check(
      `live: every ${source} product survives resolution`,
      docs.every((doc) => resolveProductTile(doc, USD, EN) !== null),
    )
  }

  {
    const draft = await payload.create({
      collection: 'products',
      overrideAccess: true,
      data: {
        name: `${PREFIX} draft new`,
        slug: `${PREFIX}-draft-new`,
        status: 'draft',
        isNew: true,
        sortOrder: 0,
      } as never,
    })

    created.push({ collection: 'products', id: draft.id })

    const { docs } = await payload.find({
      collection: 'products',
      pagination: false,
      where: railWhere('new', new Date().toISOString()),
    })

    check(
      'live: a DRAFT product flagged isNew never reaches the New Arrivals rail',
      !docs.some((doc) => doc.id === draft.id),
    )
  }

  /* --- M: identifier lengths (the silent hazard this phase introduced) */
  const { pool } = payload.db as unknown as {
    pool?: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> }
  }

  if (pool) {
    const { rows } = await pool.query(`
      SELECT 'constraint' AS kind, conname AS name FROM pg_constraint WHERE length(conname) >= 63
      UNION ALL
      SELECT 'relation', relname FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND length(relname) >= 63
      UNION ALL
      SELECT 'type', typname FROM pg_type
        WHERE typnamespace = 'public'::regnamespace AND length(typname) >= 63
    `)

    /*
     * 63 is Postgres's limit, so a name AT 63 is the fingerprint of truncation — `ADD CONSTRAINT`
     * with a longer name succeeds silently and the matching DROP truncates identically, so a
     * migration rolls forward and back cleanly while the Drizzle snapshot holds a name the database
     * has never had. It only breaks when two long names truncate to the same 63 bytes.
     */
    check(
      'live: no generated identifier has been truncated at 63 bytes',
      rows.length === 0,
      rows.map((row) => `${row.kind}:${row.name}`).join(', '),
    )

    const { rows: longest } = await pool.query(`
      SELECT conname AS name, length(conname) AS len FROM pg_constraint
      WHERE conrelid::regclass::text LIKE 'homepage%' ORDER BY length(conname) DESC LIMIT 1
    `)

    check(
      'live: the longest homepage constraint is comfortably inside the limit',
      Number(longest[0]?.len ?? 0) < 63,
      `${longest[0]?.name} (${longest[0]?.len})`,
    )
  }
} finally {
  await cleanup()
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

payload.logger.info(`${results.length - failed.length}/${results.length} homepage checks passed.`)

if (failed.length > 0) {
  throw new Error(`${failed.length} homepage check(s) failed.`)
}

process.exit(0)
