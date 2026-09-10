import type { ProductSpec } from './shared'

/**
 * **Six products below the waist, plus the two jackets the outerwear rail was missing** — plan
 * §29.1b, which names Jackets, Pants and Shorts among the categories the demo has to cover. Shorts
 * had a category and no products in it: a navigable, empty shelf.
 *
 * The whole of §29.1c is one instruction — *"the demo should feel authored rather than generated
 * from a template"* — so the variation below is the deliverable, not decoration. What varies, and
 * why it had to:
 *
 * - **Colour count: 1, 2, 2, 2, 3, 4.** A catalogue where every product has two swatches never
 *   exercises the swatch row's wrap, and never shows a product page with no swatch choice to make.
 * - **Size runs of three, four and five, in two different vocabularies.** Waist 30–36 for the chino
 *   and the ripstop short, matching the trousers Phase 6 seeded; XS–XL and its truncations for the
 *   rest. A drawstring pant genuinely is sold S–L rather than by the inch, so the variety is the
 *   real one rather than an invented one.
 * - **Description length: one paragraph to three.** Material and care lists run from two lines to
 *   five. A card holder has one care line and a quilted liner has three, because that is true.
 * - **One compare-at price, on the ripstop short.** An end-of-season markdown on a summer short is a
 *   sale; a markdown on all six is a price list.
 * - **Two women's, two men's, two unisex**, against a first ten that were unisex throughout, so the
 *   gender facet in §12.1a has something to separate.
 *
 * **The stock is deliberate, and it is the part most easily undone by a well-meaning edit.**
 * §11.1b's card states are derived from `derived.inventoryTotal`, the sum across *all* active
 * variants, so a product only reads `lowStock` on a card when the entire run is nearly gone:
 *
 * - `unstructured-blazer` totals **4** units against `siteSettings.lowStockThreshold` of 5 — a
 *   card permanently reading "Only 4 left" on a piece flagged limited edition, which is the one
 *   context in which a nearly-empty grid tile is a feature rather than a bug.
 * - The other five total well above the threshold and read `available`.
 * - `soldOut` at card level is already reachable through `cashmere-scarf`; nothing here duplicates
 *   it, because a demo catalogue with two dead products starts to look broken rather than busy.
 *
 * Size-level sold-out is a different state in a different component — the variant selector, not the
 * card — and it had no coverage in the seed at all. Five of these six carry at least one zeroed
 * size, arranged so the selector is exercised three ways: a size gone in **one colour only**
 * (`quilted-liner` XL in Chalk, `drawstring-pant` M in Sage, `wide-leg-chino` 36 in Ink), a size
 * gone in **every** colour (`ripstop-short` 36), and a size gone in every colour on a product that
 * is *also* low overall (`unstructured-blazer` XS and L). Changing a zero here to a one costs the
 * selector its disabled state.
 *
 * **`sizeGuide` is deliberately omitted from every product in this module**, and that is a real gap
 * rather than an oversight. The two guides Phase 6 seeded are `mens-tops` (XS–XL) and
 * `mens-bottoms` (waist 30–36); `wide-leg-chino` and `ripstop-short` would fit the latter exactly,
 * but `drawstring-pant` is a bottom sized XS–L and matches neither, and the two jackets are
 * outerwear measured over a layer rather than against a tops chart. Attaching a guide whose rows do
 * not list the sizes on sale is worse than attaching none — the customer opens the drawer and their
 * size is not in it. If the caller wants a guide on the two that genuinely fit, it should do so at
 * the call site where the guide ids are in scope; see the wiring note in this module's handover.
 *
 * Nothing here executes at import time. This file declares data and the seed writes it, so the
 * idempotency guarantee lives entirely in `upsert`'s slug and sku lookups in `scripts/seed.ts`.
 *
 * `sortOrder` claims **175–200 in steps of five**, not the round band it started at. The two sibling
 * content modules written alongside this one had already taken 110–170 (tops) and 210–250
 * (accessories), and the gap between them is the right place for a jacket-to-shorts run: the default
 * catalogue order then reads tops, outerwear and bottoms, accessories, which is the order the
 * navigation in `03_NORTH01_Website_Structure` puts them in. Six products do not fit a gap of three
 * at a spacing of ten, so the spacing halves rather than the order breaking.
 */

/** XS–XL, matching `scripts/seed.ts`'s `APPAREL_SIZES`. Duplicated rather than exported from the
 * seed, because a content module importing from its own orchestrator is a cycle waiting to be
 * discovered by whichever phase splits the seed again. */
const APPAREL_SIZES = [
  { size: 'XS', sizeSortOrder: 10 },
  { size: 'S', sizeSortOrder: 20 },
  { size: 'M', sizeSortOrder: 30 },
  { size: 'L', sizeSortOrder: 40 },
  { size: 'XL', sizeSortOrder: 50 },
]

/** Waist 30–36, matching the trousers and the `mens-bottoms` guide's rows. */
const WAIST_SIZES = [
  { size: '30', sizeSortOrder: 10 },
  { size: '32', sizeSortOrder: 20 },
  { size: '34', sizeSortOrder: 30 },
  { size: '36', sizeSortOrder: 40 },
]

/**
 * Six products for `jackets`, `pants` and `shorts`. Consumed by the same loop in `scripts/seed.ts`
 * that writes the first ten, so every field is written and every variant sku is derived the same
 * way: `sku`-`first three letters of the colour name, uppercased`-`size`. That derivation is why no
 * two colours on one product here start with the same three letters.
 */
export const LOWER_PRODUCTS: ProductSpec[] = [
  {
    slug: 'quilted-liner',
    name: 'Quilted Liner',
    sku: 'N01-QL',
    shortDescription: 'A diamond-quilted layer that works alone or under a coat.',
    description: [
      'Recycled ripstop over a light wadding, quilted in a wide diamond so the fill stays where it was put through a wash.',
      'Cut close enough to go under the Field Jacket and finished well enough not to. Snap front, two hand pockets, a rib at the cuff.',
    ],
    categories: ['jackets', 'clothing'],
    gender: 'unisex',
    fit: 'slim',
    materials: [
      'Recycled nylon ripstop shell, 40 gsm',
      'Recycled polyester wadding, 60 gsm',
      'Recycled nylon taffeta lining',
      'Antique-nickel snaps',
      'Rib-knit cuffs, 95% cotton, 5% elastane',
    ],
    care: [
      'Machine wash cold on a gentle cycle.',
      'Tumble dry low. The heat is what brings the loft back.',
      'Do not iron. Do not dry clean.',
    ],
    tags: ['outerwear'],
    priceMinor: 29500,
    colors: [
      { name: 'Ink', hex: '#1B1D24', family: 'navy', stock: [6, 14, 18, 12, 5] },
      { name: 'Olive', hex: '#4E5138', family: 'green', stock: [4, 9, 11, 7, 3] },
      // XL gone in Chalk alone — the selector has to disable a size on one swatch and restore it on
      // the next, which is the only way that code path gets walked in a browser.
      { name: 'Chalk', hex: '#EFEBE2', family: 'white', stock: [2, 5, 6, 4, 0] },
    ],
    sizes: APPAREL_SIZES,
    flags: { isNew: true },
    sortOrder: 175,
  },
  {
    slug: 'unstructured-blazer',
    name: 'Unstructured Blazer',
    sku: 'N01-UB',
    shortDescription: 'No canvas, no shoulder pad, no lining below the yoke.',
    description: [
      'A jacket built the way a shirt is. The cloth does the shaping and there is nothing underneath to argue with it.',
      'Wool and linen in a loose plain weave that breathes in July and creases the way linen is meant to.',
      'Patch pockets, a two-button front, and a half lining across the shoulders so it still slides over a knit.',
    ],
    categories: ['jackets', 'clothing'],
    gender: 'women',
    fit: 'regular',
    materials: [
      '54% wool, 46% linen, 260 gsm',
      'Cupro half lining',
      'Horn buttons',
      'Woven in Biella',
    ],
    care: ['Dry clean only.', 'Steam to drop the creases. Hang on a wide shoulder.'],
    tags: ['tailoring', 'limited'],
    priceMinor: 39500,
    /*
     * **Deliberately down to four units, and it has to stay that way.** §11.1b's `lowStock` card
     * state needs `0 < derived.inventoryTotal <= 5`, and `inventoryTotal` sums every active variant
     * — so unlike the sold-out scarf, this cannot be arranged by thinning one colour. Both colours
     * and all four sizes are counted here, XS and L are empty in both, and the total is 4. Raise any single
     * number above and the state disappears from the demo entirely.
     */
    colors: [
      { name: 'Bone', hex: '#E7E2D8', family: 'bone', stock: [0, 1, 1, 0] },
      { name: 'Slate', hex: '#5A6068', family: 'grey', stock: [0, 0, 2, 0] },
    ],
    sizes: APPAREL_SIZES.slice(0, 4),
    flags: { featured: true, isLimitedEdition: true },
    sortOrder: 180,
  },
  {
    slug: 'drawstring-pant',
    name: 'Drawstring Pant',
    sku: 'N01-DP',
    shortDescription: 'A wide cotton pant that closes with a cord and nothing else.',
    description: [
      'Washed cotton twill, soft from the first wear, cut wide through the leg and gathered at the waist. There is no zip and no button; the cord does all of it.',
    ],
    categories: ['pants', 'clothing'],
    gender: 'women',
    fit: 'relaxed',
    materials: ['100% cotton twill, 240 gsm, garment washed', 'Cotton drawcord'],
    care: ['Machine wash cold. Tumble dry low, or hang and let the crease fall out.'],
    tags: ['core'],
    priceMinor: 15500,
    // Four swatches — the only product in the catalogue with more than two, and the reason the
    // swatch row's overflow behaviour is visible anywhere.
    colors: [
      { name: 'Black', hex: '#141414', family: 'black', stock: [9, 16, 14, 8] },
      { name: 'Bone', hex: '#E7E2D8', family: 'bone', stock: [6, 12, 10, 5] },
      { name: 'Clay', hex: '#A66A4A', family: 'rust', stock: [3, 7, 6, 2] },
      { name: 'Sage', hex: '#8C9179', family: 'green', stock: [4, 8, 0, 3] },
    ],
    sizes: APPAREL_SIZES.slice(0, 4),
    flags: { isBestSeller: true },
    sortOrder: 185,
  },
  {
    slug: 'wide-leg-chino',
    name: 'Wide-Leg Chino',
    sku: 'N01-WL',
    shortDescription: 'Cotton twill, cut straight from the hip and left there.',
    description: [
      'A dense two-ply twill that holds a leg line without being pressed into one. It arrives with a dry hand and loses it slowly.',
      'Slant pockets, a plain hem, and a rise that sits at the waist rather than under it.',
    ],
    categories: ['pants', 'clothing'],
    gender: 'men',
    fit: 'relaxed',
    materials: [
      '100% cotton twill, 320 gsm',
      'Two-ply in warp and weft',
      'Hidden hook-and-bar closure',
    ],
    care: [
      'Machine wash warm. Hang to dry.',
      'Warm iron on the reverse if you want the crease back.',
    ],
    tags: ['core', 'tailoring'],
    priceMinor: 18500,
    colors: [
      { name: 'Stone', hex: '#A9A39A', family: 'grey', stock: [5, 11, 9, 4] },
      { name: 'Ink', hex: '#1B1D24', family: 'navy', stock: [3, 8, 7, 0] },
    ],
    sizes: WAIST_SIZES,
    // No flags. Not everything in a catalogue is new, best-selling or limited, and a grid where
    // every tile carries a badge is a grid where the badges have stopped meaning anything.
    sortOrder: 190,
  },
  {
    slug: 'ripstop-short',
    name: 'Ripstop Short',
    sku: 'N01-RS',
    shortDescription: 'A seven-inch short in a dry cotton ripstop.',
    description: [
      'Ripstop woven from a fine cotton yarn, which is what keeps it light without going papery. Seven inches at the inseam, one back pocket, and a hem that sits above the knee and stays there.',
    ],
    categories: ['shorts', 'clothing'],
    gender: 'men',
    fit: 'regular',
    materials: [
      '100% cotton ripstop, 150 gsm',
      'Bar-tacked at the stress points',
      'Concealed zip fly',
    ],
    care: ['Machine wash cold. Hang to dry.'],
    tags: ['summer'],
    priceMinor: 11000,
    /*
     * **The only compare-at price in this module.** A summer short marked down at the end of the
     * season is a sale a customer believes; six of six marked down is a price list. It also gives
     * the PDP and the card exactly one place to render struck-through pricing, which is enough to
     * check it and not enough to make the catalogue look like an outlet.
     */
    compareAtPriceMinor: 14000,
    // Waist 36 is gone in both colours — a size that is absent from the run rather than absent from
    // a swatch, which is a different disabled state to the Quilted Liner's.
    colors: [
      { name: 'Olive', hex: '#4E5138', family: 'green', stock: [2, 4, 3, 0] },
      { name: 'Sand', hex: '#C8B79B', family: 'tan', stock: [0, 3, 2, 0] },
    ],
    sizes: WAIST_SIZES,
    sortOrder: 195,
  },
  {
    slug: 'loopback-short',
    name: 'Loopback Short',
    sku: 'N01-LS',
    shortDescription: 'The Heavyweight Hoodie, from the waist down.',
    description: [
      'The same loopback cotton as the hoodie, knitted a little lighter at 380 gsm and dyed in the same bath, so the two sit together without one looking newer than the other.',
      'Elastic waist under a flat drawcord, side seam pockets, and a raw-edge hem that will curl a little and then stop.',
    ],
    categories: ['shorts', 'clothing'],
    gender: 'unisex',
    fit: 'relaxed',
    materials: ['100% cotton loopback, 380 gsm', 'Cotton drawcord'],
    care: ['Machine wash cold, inside out. Hang to dry.'],
    tags: ['jersey', 'summer'],
    priceMinor: 8500,
    // One colour, three sizes — the smallest matrix in the catalogue, and the only product where the
    // colour selector has nothing to choose between. That case has to render too.
    colors: [{ name: 'Fog', hex: '#B7BAB6', family: 'grey', stock: [7, 12, 9] }],
    sizes: APPAREL_SIZES.slice(1, 4),
    sortOrder: 200,
  },
]
