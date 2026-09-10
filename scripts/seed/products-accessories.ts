import type { ProductSpec } from './shared'

/**
 * **Hats, bags and the hard-goods accessories** — five products added in Phase 29.
 *
 * §29.1b names Hats and Bags among the categories the demo must cover and the catalogue had neither:
 * ten products, of which two were accessories (a scarf and a card holder) and eight were clothing.
 * This module fills those two categories and adds one more accessory beside them.
 *
 * It exports **data only**. `scripts/seed.ts` owns the write loop, so every row here goes through the
 * same `upsert` keyed on `slug` (products) and the generated `sku` (variants) — the idempotency the
 * phase requires is inherited rather than reimplemented, and nothing in this file runs at import
 * time.
 *
 * ---
 *
 * ### Why these five differ from each other on purpose
 *
 * §29.1c is explicit that the demo should read as *"authored rather than generated from a template"*,
 * and accessories are where a template shows first: five products in a row, each with two colours,
 * three material lines and a two-sentence description, is a spreadsheet with a serif font on it. So
 * the variation here is structural rather than cosmetic:
 *
 * | | colours | sizes | materials | care | description |
 * |---|---|---|---|---|---|
 * | Watch Cap | 2 | one size | 2 | 2 | 2 sentences |
 * | Six-Panel Cap | 4 | S/M, L/XL | 3 | 1 | 3 sentences |
 * | Weekend Holdall | 1 | one size | 5 | 3 | 4 sentences |
 * | Musette | 2 | one size | 2 | 2 | 2 sentences |
 * | Bridle Belt | 2 | 30–36 | 3 | 2 | 3 sentences |
 *
 * A leather bag's care lines are nothing like a wool hat's, and neither is a paraphrase of the other:
 * waxed cotton must never be washed, lambswool pills and then stops, bridle leather wants wax once a
 * year and no conditioner. That is the level the copy is written at — how the thing is made and how
 * it behaves.
 *
 * ### Stock is merchandising, not filler
 *
 * §11.1b's card states all stay reachable from the demo, and this file adds the middle one plus the
 * per-size case the existing catalogue could not produce:
 *
 * - **Low stock** — the Weekend Holdall is one colour, one size, three units. `derived.inventoryTotal`
 *   is the sum across active variants, so a single-variant product is the only honest way to sit a
 *   *product* under `siteSettings.lowStockThreshold` (5) without claiming a whole size run is nearly
 *   gone. The card reads "Only 3 left" and it is true.
 * - **Sold out in one size** — Six-Panel Cap in Sand/L-XL and Ink/S-M, Bridle Belt in Black/36. The
 *   product card still says available, because it is; the *size selector* is where the customer meets
 *   a disabled option, and that path had no demo data behind it before this.
 * - **Fully sold out** stays where Phase 11 put it, on the Cashmere Scarf. Two products showing "Sold
 *   out" in an eleven-product accessories aisle would read as a broken shop rather than a
 *   demonstrated state.
 *
 * ### Decisions a reader would otherwise have to reverse-engineer
 *
 * - **No `sizeGuide` on any of the five, deliberately.** The two guides that exist measure a chest and
 *   an inseam. A cap has neither, a holdall has none of the above, and a belt sized 30–36 is already
 *   labelled in the unit a customer would look up — the number on the label *is* the measurement,
 *   which is why the copy says so instead. Pointing these at `mens-bottoms` would put a trouser inseam
 *   table on a hat, and inventing an accessories guide is scope the phase brief never asked for. The
 *   field is optional; this is what optional is for.
 * - **`fit` is `regular` throughout and means nothing.** `ProductSpec.fit` is required and a holdall
 *   has no fit. The existing Cashmere Scarf and Card Holder resolve it the same way, and a sixth
 *   spelling of the same non-answer would be worse than a consistent one.
 * - **Four unisex, one men's.** The Bridle Belt is `men` because its size run *is* the men's waist
 *   scale the trousers and denim already use — a customer filtering Men and finding a belt sized 32
 *   has been told something true. Putting a gender on a knitted cap or a canvas bag would file a fact
 *   in the filter that the product does not have.
 * - **One compare-at price across the five**, on the Musette. A sale on everything is a sale on
 *   nothing, and the strikethrough only means anything while it stays rare.
 * - **New size tokens.** `S/M` and `L/XL` join the size facet's vocabulary. `CATALOG_PARSERS` splits
 *   that parameter on commas, so a slash is safe in a value, and `ProductVariants.size` is free text
 *   precisely because apparel sizing is not one scale.
 * - **Colours reuse the house palette's names and hexes** wherever the same colour genuinely recurs —
 *   Bone, Ink, Sand, Black and Espresso are already in the catalogue. A brand with eleven off-whites
 *   has no palette, and the colour *facet* groups on `family` regardless.
 * - **`sortOrder` 210–250** leaves the 110–200 band to the clothing Phase 29 adds alongside these, and
 *   keeps accessories at the end of the merchandised order, where the scarf and card holder (90, 100)
 *   already sit relative to clothing.
 * - **SKU codes claimed here: WC, SP, WH, MU, BB.** They have to stay unique against FJ, MC, OS, HH,
 *   WO, PT, SD, CT, CS, CH and against whatever a sibling module adds — `sku` is UNIQUE across the
 *   catalogue, so a collision fails the seed loudly. That is the right failure, but it is still one.
 *
 * **No media.** Every image field is left empty, for the reason the docblock at the top of
 * `scripts/seed.ts` gives.
 */

/** Waist sizes on a belt, matching the trouser run exactly so the size facet does not fork. */
const BELT_SIZES = [
  { size: '30', sizeSortOrder: 10 },
  { size: '32', sizeSortOrder: 20 },
  { size: '34', sizeSortOrder: 30 },
  { size: '36', sizeSortOrder: 40 },
]

/** A single entry — the convention the Cashmere Scarf and Card Holder set for an unsized product. */
const ONE_SIZE = [{ size: 'ONE SIZE', sizeSortOrder: 10 }]

export const ACCESSORY_PRODUCTS: ProductSpec[] = [
  {
    slug: 'watch-cap',
    name: 'Watch Cap',
    sku: 'N01-WC',
    shortDescription: 'Deep-ribbed lambswool, knitted in the round.',
    description: [
      'Knitted in the round on an English frame, so there is no seam to sit across the forehead.',
      'Turn the brim once and it covers the ears, twice and it does not. The rib holds either.',
    ],
    categories: ['hats', 'accessories'],
    gender: 'unisex',
    fit: 'regular',
    materials: ['100% British lambswool, 3-ply', 'Woven cotton label, undyed'],
    care: [
      'Hand wash cool. Reshape while damp and dry flat.',
      'It will pill for the first few weeks. A comb takes them off, and then it stops.',
    ],
    tags: ['knitwear', 'accessory'],
    priceMinor: 6500,
    colors: [
      { name: 'Bone', hex: '#E7E2D8', family: 'bone', stock: [14] },
      { name: 'Moss', hex: '#3F4736', family: 'green', stock: [9] },
    ],
    sizes: ONE_SIZE,
    flags: { isBestSeller: true },
    sortOrder: 210,
  },
  {
    slug: 'six-panel-cap',
    name: 'Six-Panel Cap',
    sku: 'N01-SP',
    shortDescription: 'Washed twill on an unstructured crown, sized rather than adjustable.',
    description: [
      'Cotton twill washed twice before it is cut, so the crown sits down on the head instead of standing off it.',
      'Six panels, a covered button at the crown, and an eyelet punched through every seam.',
      'The brim is stitched in eight rows and takes its curve from a week of being worn, not from a press.',
    ],
    categories: ['hats', 'accessories'],
    gender: 'unisex',
    fit: 'regular',
    materials: ['100% cotton twill, 9.5 oz, garment washed', 'Cotton sweatband', 'Brass eyelets'],
    /*
     * One care line, and it is the only one that matters. There is a brim board inside a cap: the
     * machine that washes it is the machine that ends it, and anything longer than this sentence is
     * padding around that single instruction.
     */
    care: ['Spot clean only. A cap does not leave a machine the shape it went in.'],
    tags: ['accessory', 'core'],
    priceMinor: 5500,
    colors: [
      { name: 'Black', hex: '#141414', family: 'black', stock: [12, 7] },
      { name: 'Bone', hex: '#E7E2D8', family: 'bone', stock: [6, 4] },
      // Gone in L/XL — §11.1b's disabled size option, which no seeded product produced before.
      { name: 'Sand', hex: '#C8B79B', family: 'tan', stock: [3, 0] },
      // And the mirror of it: gone in the small size, held in the large.
      { name: 'Ink', hex: '#1B1D24', family: 'navy', stock: [0, 5] },
    ],
    sizes: [
      { size: 'S/M', sizeSortOrder: 10 },
      { size: 'L/XL', sizeSortOrder: 20 },
    ],
    flags: { isNew: true },
    sortOrder: 220,
  },
  {
    slug: 'weekend-holdall',
    name: 'Weekend Holdall',
    sku: 'N01-WH',
    shortDescription: 'Waxed cotton over a bridle leather base, sized for three days.',
    description: [
      'Made from an eight-ounce waxed cotton proofed at a Scottish mill that has been doing it since the 1920s, cut over a base of English bridle leather so the bag can be put down on wet ground without a thought.',
      'The frame is a single length of brass. The zip runs under a leather pull that will outlast its own teeth.',
      'Inside there is one pocket, and that is deliberate: a holdall divided into six compartments is a holdall you pack around rather than into.',
      'It will mark. Wax remembers everything, which is the whole argument for it.',
    ],
    categories: ['bags', 'accessories'],
    gender: 'unisex',
    fit: 'regular',
    materials: [
      '8 oz waxed cotton, Scottish milled',
      'English bridle leather base and handles',
      'Solid brass hardware, unlacquered',
      'Cotton drill lining',
      'Two-way brass zip',
    ],
    care: [
      'Brush it off dry. Never wash or dry clean waxed cotton — both strip the proofing out of it.',
      'Re-wax once a year, or whenever water stops beading on the shoulders of the bag.',
      'The brass will dull. Leave it, or bring it back with a dry cloth.',
    ],
    tags: ['accessory', 'leather', 'limited'],
    priceMinor: 52000,
    /*
     * **Deliberately low stock, and deliberately single-variant.** Three units, one colour, one size,
     * against `siteSettings.lowStockThreshold` of 5 — so `derived.inventoryTotal` is 3 and the card
     * reads "Only 3 left". A multi-size product cannot reach that state without claiming an entire
     * size run is nearly gone, which would be a lie told to make a badge appear.
     */
    colors: [{ name: 'Field Olive', hex: '#414634', family: 'green', stock: [3] }],
    sizes: ONE_SIZE,
    flags: { isLimitedEdition: true, featured: true },
    sortOrder: 230,
  },
  {
    slug: 'musette',
    name: 'Musette',
    sku: 'N01-MU',
    shortDescription: 'One strap, one pocket, and room for a day.',
    description: [
      'Taken from the feed bags handed up at the roadside, down to a strap long enough to go over the shoulder and under the opposite arm.',
      'Untreated cotton canvas, so it packs flat and keeps whatever creases it is folded into.',
    ],
    categories: ['bags', 'accessories'],
    gender: 'unisex',
    fit: 'regular',
    materials: ['12 oz cotton canvas, undyed', 'Cotton webbing strap'],
    care: [
      'Machine wash cold. It shrinks a little the first time and then holds.',
      'Dry flat. Press it if you want it sharp.',
    ],
    tags: ['accessory', 'core'],
    priceMinor: 8500,
    // The only compare-at price in this module — see the docblock.
    compareAtPriceMinor: 11000,
    colors: [
      { name: 'Natural', hex: '#DCD3C0', family: 'bone', stock: [22] },
      { name: 'Ink', hex: '#1B1D24', family: 'navy', stock: [16] },
    ],
    sizes: ONE_SIZE,
    sortOrder: 240,
  },
  {
    slug: 'bridle-belt',
    name: 'Bridle Belt',
    sku: 'N01-BB',
    shortDescription: 'One strap of English bridle leather, and a buckle held on two screws.',
    description: [
      'Cut from a single strap of English bridle leather, curried with tallow over six weeks so it bends instead of cracking.',
      'The buckle is solid brass and screwed on rather than stitched in, which makes a broken buckle a five-minute repair instead of a new belt.',
      'Sized to the trouser and not the body: the size on the label is the middle hole.',
    ],
    categories: ['accessories'],
    // The one gendered product here, and only because its size run is the men's waist scale.
    gender: 'men',
    fit: 'regular',
    materials: ['English bridle leather, 3.5 mm', 'Solid brass buckle', 'Brass fixing screws'],
    care: [
      'Wipe with a damp cloth and let it dry away from heat.',
      'Wax polish once a year. Nothing else, and never a conditioner.',
    ],
    tags: ['accessory', 'leather', 'gift'],
    priceMinor: 14000,
    colors: [
      { name: 'Espresso', hex: '#43302B', family: 'brown', stock: [4, 9, 7, 2] },
      // Out in the largest size only — the belt half of the disabled-size demo.
      { name: 'Black', hex: '#141414', family: 'black', stock: [6, 11, 8, 0] },
    ],
    sizes: BELT_SIZES,
    sortOrder: 250,
  },
]
