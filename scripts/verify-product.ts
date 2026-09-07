/**
 * The Phase 13 product-page rules, checked against the running code rather than the comments that
 * describe them.
 *
 * ```
 * pnpm verify:product
 * ```
 *
 * The shape `verify-catalog.ts` established: pure fixtures for every rule, then **real Payload
 * documents** for the states that matter. The **D-10** guard applies — it creates and deletes
 * documents, so it refuses to run anywhere but the development database `DATABASE_PUSH_TARGET`
 * names.
 *
 * `lib/product/product.ts` is deliberately not imported: it is `server-only` and holds reads and no
 * rules. Everything asserted here lives in `lib/product/variants.ts`, which is why plan §13.1c's
 * combination table can be exercised as fixtures at all.
 *
 * **§13.1c's own example is a named check.** *"If Black / M exists but Cream / M does not: Black
 * selectable, Cream M disabled, do not permit submission of Cream / M."* A rule stated that
 * concretely in the plan should be asserted that concretely in the harness, because a screenshot of a
 * customer who happened to pick a combination that works proves nothing about the one that does not.
 */

import type { Payload } from 'payload'

import config from '../src/payload.config'

import { developmentDatabase } from '../src/lib/env.core'
import { publishedProductWhere } from '../src/lib/catalog/query'
import { loadProductParams } from '../src/lib/product/params'
import { isRovingKey, rovingIndex, tabbableIndex } from '../src/lib/product/roving'
import { PRODUCT_IMAGE_SIZES } from '../src/lib/product/sizes'
import {
  buildVariantMatrix,
  inventoryMessage,
  priceRangeForColor,
  resolveVariant,
  type SelectableVariant,
} from '../src/lib/product/variants'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-product refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes collection documents, so it may only touch the development database ' +
      'that DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const { getPayload } = await import('payload')

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

const USD = 'USD' as const
const EN = 'en-US'

let nextId = 1

const variant = (overrides: Partial<SelectableVariant> = {}): SelectableVariant => ({
  active: true,
  color: 'Black',
  colorHex: '#141414',
  compareAtPriceMinor: null,
  id: nextId++,
  image: null,
  inventoryQuantity: 10,
  priceMinor: 12_000,
  size: 'M',
  sizeSortOrder: 30,
  sku: `SKU-${nextId}`,
  ...overrides,
})

const matrix = (
  variants: SelectableVariant[],
  requested: { color?: null | string; size?: null | string } = {},
) => buildVariantMatrix(variants, requested, USD, EN, 5)

/* =================================================================================================
 * A — §13.1c's own example, stated as the plan states it
 * ============================================================================================== */

const PLAN_EXAMPLE = [
  variant({ color: 'Black', size: 'M', sizeSortOrder: 30 }),
  variant({ color: 'Black', size: 'L', sizeSortOrder: 40 }),
  variant({ color: 'Cream', size: 'L', sizeSortOrder: 40 }),
]

{
  const black = matrix(PLAN_EXAMPLE, { color: 'Black' })
  const cream = matrix(PLAN_EXAMPLE, { color: 'Cream' })

  check(
    'A: Black is selectable',
    black.colors.some((c) => c.value === 'Black' && c.available),
  )

  check('A: M is available in Black', black.sizes.find((s) => s.value === 'M')?.available === true)

  check(
    'A: Cream / M is DISABLED — the combination the plan names',
    cream.sizes.find((s) => s.value === 'M')?.available === false,
  )

  check(
    'A: …and is marked MISSING rather than sold out, because it does not exist',
    cream.sizes.find((s) => s.value === 'M')?.missing === true,
  )

  check(
    'A: M is still LISTED in Cream — disabled, never hidden',
    cream.sizes.some((s) => s.value === 'M'),
    cream.sizes.map((s) => s.value).join(','),
  )

  check(
    'A: Cream / M cannot be submitted — it resolves to no variant',
    matrix(PLAN_EXAMPLE, { color: 'Cream', size: 'M' }).selected === null,
  )

  check(
    'A: Black / M does resolve',
    matrix(PLAN_EXAMPLE, { color: 'Black', size: 'M' }).selected?.color === 'Black',
  )
}

/* =================================================================================================
 * B — Active, sold out and missing are three different things
 * ============================================================================================== */

check(
  'B: an INACTIVE variant is not offered at all',
  matrix([variant({ active: false, color: 'Rust' })]).colors.every((c) => c.value !== 'Rust'),
)

check(
  'B: a SOLD OUT variant is still listed',
  matrix([variant({ inventoryQuantity: 0 })]).sizes.some((s) => s.value === 'M'),
)

check(
  'B: …but is not available',
  matrix([variant({ inventoryQuantity: 0 })]).sizes.find((s) => s.value === 'M')?.available ===
    false,
)

check(
  'B: …and is NOT marked missing — it exists, it is out of stock',
  matrix([variant({ inventoryQuantity: 0 })]).sizes.find((s) => s.value === 'M')?.missing === false,
)

check(
  'B: a sold-out combination still RESOLVES, so the page can say "sold out in this size"',
  matrix([variant({ inventoryQuantity: 0 })], { color: 'Black', size: 'M' }).selected !== null,
)

check(
  'B: a variant with no price is not offered',
  matrix([variant({ priceMinor: null })]).colors.length === 0,
)

/* =================================================================================================
 * C — Falling back
 * ============================================================================================== */

{
  const stock = [
    variant({ color: 'Sold Out Colour', inventoryQuantity: 0, size: 'M' }),
    variant({ color: 'In Stock', inventoryQuantity: 4, size: 'M' }),
  ]

  check(
    'C: no selection falls back to a colour that has stock',
    matrix(stock).selectedColor === 'In Stock',
  )

  check(
    'C: an unknown colour falls back and is REPORTED',
    matrix(stock, { color: 'Puce' }).invalidSelection,
  )

  check(
    'C: an unknown size does NOT pick a size on the customer’s behalf',
    matrix(stock, { color: 'In Stock', size: 'ZZ' }).selectedSize === null,
  )

  check('C: …and is reported', matrix(stock, { color: 'In Stock', size: 'ZZ' }).invalidSelection)

  check(
    'C: a valid selection is not reported as invalid',
    !matrix(stock, { color: 'In Stock', size: 'M' }).invalidSelection,
  )

  check(
    'C: colour matching is case-insensitive, so a hand-typed URL resolves',
    matrix(stock, { color: 'in stock' }).selectedColor === 'In Stock',
  )

  check(
    'C: size matching is too',
    matrix(stock, { color: 'In Stock', size: 'm' }).selectedSize === 'M',
  )
}

check(
  'C: a product whose every colour is sold out still renders a selection',
  matrix([variant({ inventoryQuantity: 0 })]).selectedColor === 'Black',
)

check(
  'C: a product with no variants renders nothing rather than throwing',
  matrix([]).colors.length === 0,
)

/* =================================================================================================
 * D — Sizes are ordered by the merchandiser, never alphabetically
 * ============================================================================================== */

{
  const apparel = [
    variant({ size: 'XL', sizeSortOrder: 50 }),
    variant({ size: 'S', sizeSortOrder: 20 }),
    variant({ size: 'M', sizeSortOrder: 30 }),
    variant({ size: 'L', sizeSortOrder: 40 }),
  ]

  check(
    'D: sizes read S, M, L, XL — not alphabetically',
    matrix(apparel)
      .sizes.map((s) => s.value)
      .join(',') === 'S,M,L,XL',
    matrix(apparel)
      .sizes.map((s) => s.value)
      .join(','),
  )

  const conflicting = [
    variant({ color: 'Black', size: 'M', sizeSortOrder: 30 }),
    variant({ color: 'Bone', size: 'M', sizeSortOrder: 99 }),
    variant({ color: 'Black', size: 'S', sizeSortOrder: 20 }),
  ]

  check(
    'D: a size ranks by its LOWEST sort order, so one mis-keyed row cannot reorder the row',
    matrix(conflicting)
      .sizes.map((s) => s.value)
      .join(',') === 'S,M',
  )
}

/* =================================================================================================
 * E — Price
 * ============================================================================================== */

check(
  'E: one price shows that price',
  priceRangeForColor([variant({ priceMinor: 9500 })], 'Black', USD, EN) === '$95.00',
)

check(
  'E: a range shows "From"',
  priceRangeForColor(
    [variant({ priceMinor: 9500 }), variant({ priceMinor: 24_000, size: 'L' })],
    'Black',
    USD,
    EN,
  ) === 'From $95.00',
)

check(
  'E: the range is scoped to the SELECTED colour, not the product',
  priceRangeForColor(
    [variant({ color: 'Black', priceMinor: 24_000 }), variant({ color: 'Bone', priceMinor: 9500 })],
    'Black',
    USD,
    EN,
  ) === '$240.00',
)

check(
  'E: a product with no offerable variant has no price',
  priceRangeForColor([variant({ active: false })], null, USD, EN) === null,
)

check(
  'E: a genuine saving renders a struck price',
  resolveVariant(variant({ compareAtPriceMinor: 24_000, priceMinor: 9500 }), USD, EN, 5)
    ?.compareAtLabel === '$240.00',
)

check(
  'E: an equal compare-at is not a sale',
  resolveVariant(variant({ compareAtPriceMinor: 9500, priceMinor: 9500 }), USD, EN, 5)
    ?.compareAtLabel === null,
)

check(
  'E: a compare-at BELOW the price is not a negative saving',
  resolveVariant(variant({ compareAtPriceMinor: 5000, priceMinor: 9500 }), USD, EN, 5)
    ?.compareAtLabel === null,
)

/* =================================================================================================
 * F — Inventory messaging (§13.1b)
 * ============================================================================================== */

const messageFor = (quantity: number, threshold = 5) =>
  inventoryMessage(resolveVariant(variant({ inventoryQuantity: quantity }), USD, EN, threshold))

check('F: sold out says so', messageFor(0) === 'Sold out in this size')
check('F: one left is "Last one", not "Only 1 left"', messageFor(1) === 'Last one')
check('F: two left gives the real number', messageFor(2) === 'Only 2 left')
check('F: at the threshold is still low stock', messageFor(5) === 'Only 5 left')
check(
  'F: above the threshold says NOTHING — it would be noise on every page',
  messageFor(6) === null,
)
check('F: no selection says nothing', inventoryMessage(null) === null)
check(
  'F: a zero threshold cannot make sold-out read as in stock',
  messageFor(0, 0) === 'Sold out in this size',
)

/* =================================================================================================
 * G — The URL contract and the sizes table
 * ============================================================================================== */

check(
  'G: the params loader reads colour and size',
  (await loadProductParams(Promise.resolve({ color: 'Bone', size: 'M' }))).color === 'Bone',
)

check(
  'G: an absent parameter is null rather than undefined',
  (await loadProductParams(Promise.resolve({}))).size === null,
)

check(
  'G: every product sizes string is present and non-empty',
  Object.values(PRODUCT_IMAGE_SIZES).every(
    (value) => typeof value === 'string' && value.length > 0,
  ),
)

check(
  'G: the gallery string has a fixed tier above 1440, where the container stops growing',
  PRODUCT_IMAGE_SIZES.gallery.includes('(min-width: 1440px) 742px'),
  PRODUCT_IMAGE_SIZES.gallery,
)

check(
  'G: the zoom surface asks for the full viewport — it is the one place that should',
  PRODUCT_IMAGE_SIZES.zoom === '100vw',
)

/* =================================================================================================
 * I — Roving focus
 *
 * A `role="radiogroup"` with a roving `tabIndex` and no arrow keys is a control a keyboard user can
 * see and cannot reach. Three of them ship on this page, so the arithmetic gets its own section.
 * ============================================================================================== */

check(
  'I: the size row is reachable when NOTHING is selected — the state every arrival is in',
  tabbableIndex(-1) === 0,
)

check('I: a selection keeps the tab stop', tabbableIndex(3) === 3)

check(
  'I: both axes move — the row wraps at 390px, so Down must work where Right does',
  rovingIndex(0, 4, 'ArrowDown') === 1 && rovingIndex(0, 4, 'ArrowRight') === 1,
)

check(
  'I: …and backwards on both axes',
  rovingIndex(2, 4, 'ArrowUp') === 1 && rovingIndex(2, 4, 'ArrowLeft') === 1,
)

check('I: the last option wraps forward to the first', rovingIndex(3, 4, 'ArrowRight') === 0)

check('I: the first wraps backward to the last', rovingIndex(0, 4, 'ArrowLeft') === 3)

check(
  'I: Home and End reach the ends',
  rovingIndex(2, 4, 'Home') === 0 && rovingIndex(1, 4, 'End') === 3,
)

check(
  'I: focus outside the group enters at the first option going forward',
  rovingIndex(-1, 4, 'ArrowRight') === 0,
)

check('I: …and at the last going backward', rovingIndex(-1, 4, 'ArrowLeft') === 3)

check('I: an empty group has nowhere to go rather than index 0', rovingIndex(0, 0, 'Home') === -1)

check(
  'I: only the six navigation keys are claimed — Tab and typing must still work',
  ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home'].every(isRovingKey) &&
    !isRovingKey('Tab') &&
    !isRovingKey(' ') &&
    !isRovingKey('Enter') &&
    !isRovingKey('PageDown'),
)

/* =================================================================================================
 * H — Real documents
 * ============================================================================================== */

const payload: Payload = await getPayload({ config })

const created: { collection: 'product-variants' | 'products'; id: number }[] = []

const cleanup = async () => {
  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true, trash: false })
      .catch(() => undefined)
  }
}

try {
  const stamp = Date.now() % 1_000_000

  const product = await payload.create({
    collection: 'products',
    data: {
      name: `Verify Parka ${stamp}`,
      slug: `vp-${stamp}`,
      sortOrder: 0,
      status: 'published',
    } as never,
    overrideAccess: true,
  })
  created.push({ collection: 'products', id: product.id })

  for (const [color, size, order, quantity] of [
    ['Black', 'M', 30, 4],
    ['Black', 'L', 40, 0],
    ['Cream', 'L', 40, 7],
  ] as const) {
    const row = await payload.create({
      collection: 'product-variants',
      data: {
        active: true,
        color,
        colorFamily: 'black',
        inventoryQuantity: quantity,
        priceMinor: 32_000,
        product: product.id,
        size,
        sizeSortOrder: order,
        sku: `VP-${stamp}-${color}-${size}`,
      },
      overrideAccess: true,
    })
    created.push({ collection: 'product-variants', id: row.id })
  }

  const { docs } = await payload.find({
    collection: 'product-variants',
    depth: 0,
    limit: 0,
    pagination: false,
    sort: ['sizeSortOrder', 'size'],
    where: { product: { equals: product.id } },
  })

  const real = docs.map((doc) => ({
    active: doc.active,
    color: doc.color,
    colorHex: doc.colorHex,
    compareAtPriceMinor: doc.compareAtPriceMinor,
    id: doc.id,
    image: null,
    inventoryQuantity: doc.inventoryQuantity,
    priceMinor: doc.priceMinor,
    size: doc.size,
    sizeSortOrder: doc.sizeSortOrder,
    sku: doc.sku,
  }))

  const liveCream = buildVariantMatrix(real, { color: 'Cream' }, USD, EN, 5)

  check(
    'H: real variants produce two colours',
    liveCream.colors.length === 2,
    liveCream.colors.map((c) => c.value).join(','),
  )

  check(
    'H: Cream / M is disabled against REAL rows, not just fixtures',
    liveCream.sizes.find((s) => s.value === 'M')?.available === false,
  )

  check(
    'H: Black / L is sold out but present',
    (() => {
      const black = buildVariantMatrix(real, { color: 'Black' }, USD, EN, 5)
      const l = black.sizes.find((s) => s.value === 'L')

      return l?.available === false && l.missing === false
    })(),
  )

  /*
   * The route's 404 and the listing's exclusion must be ONE rule. A product reachable by URL but
   * absent from every listing would be a back door around `publishedProductWhere`.
   */
  const now = new Date().toISOString()

  const reachable = async () =>
    (
      await payload.find({
        collection: 'products',
        depth: 0,
        limit: 1,
        where: { and: [...publishedProductWhere(now), { slug: { equals: product.slug } }] },
      })
    ).docs.length

  check('H: a published product is reachable by slug', (await reachable()) === 1)

  await payload.update({
    collection: 'products',
    data: { status: 'draft' },
    id: product.id,
    overrideAccess: true,
  })

  check('H: a DRAFT product is not reachable by slug — the route 404s', (await reachable()) === 0)

  await payload.update({
    collection: 'products',
    data: { publishedAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), status: 'published' },
    id: product.id,
    overrideAccess: true,
  })

  check('H: a SCHEDULED product is not reachable either', (await reachable()) === 0)
} finally {
  await cleanup()
}

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} product checks passed.`,
  ...failed.map((result) => `FAIL  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`),
  '',
  ...results.map(
    (result) =>
      `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  ),
].join('\n')

await new Promise<void>((resolve, reject) => {
  process.stdout.write(`${report}\n`, (error) => (error ? reject(error) : resolve()))
})

await payload.destroy()

if (failed.length > 0) {
  throw new Error(`${failed.length} product check(s) failed.`)
}
