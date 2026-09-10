import type { ProductSpec } from './shared'

/**
 * **Seven tops — two tees, two shirts, a sweatshirt and two hoodies** — plan §29.1b, which names
 * those four categories as the ones the demo catalogue has to cover before the shop's filters mean
 * anything. Phase 1 shipped ten products and only four of them were tops; a `tees` facet with one
 * member and a `sweatshirts` facet with none is a filter panel that demonstrates nothing.
 *
 * **§29.1c is the rule this file is written against:** *"the demo should feel authored rather than
 * generated from a template."* So nothing here is uniform on purpose —
 *
 * - **Colour counts run 1, 1, 2, 2, 2, 3, 4.** A one-colour limited run and a four-colour core tee
 *   are different commercial decisions and the data should say so.
 * - **Three different size runs.** XS–XL for the pieces made in five sizes, XS–L for the two
 *   women's pieces, S–XL for a men's shirt that is not cut in an XS. The `sizeSortOrder` values are
 *   the same 10..50 scale `seed.ts` uses, so a short run keeps the shape of the full one rather
 *   than renumbering from 10 and sorting oddly against its siblings.
 * - **Descriptions run one to four paragraphs**, materials one to four entries, care one to three.
 *   A rib tee has one fibre and one instruction. A zip hoodie has a hood, a zip and a drawcord.
 * - **Two of the seven carry a compare-at price**, both for a reason a merchandiser could defend: a
 *   linen camp shirt and a check flannel, marked down at the ends of their seasons. §29.1c's point
 *   is that a sale on everything is a sale on nothing.
 * - **Flags are sparse.** Two featured, three new, two best-sellers, one limited edition. Nothing
 *   carries all four.
 * - **Gender is mixed** — three unisex, two men, two women — because Phase 1's catalogue was unisex
 *   end to end and `gender` is a filterable attribute (§12.1a) that only ever had one value in it.
 *
 * **Stock is deliberate, not decorative.** `french-terry-hoodie` totals four units against
 * `siteSettings.lowStockThreshold` of 5, so it is a permanent second `lowStock` card next to the
 * card holder; its L is at zero, as are three variants of `camp-collar-shirt` and one of
 * `flannel-shirt`, which is the *variant*-level sold-out state the size selector disables — a
 * different thing from the whole-product `soldOut` card the cashmere scarf covers. See
 * `productCardState` in `src/lib/catalog/resolve.ts`: the card state reads `derived.inventoryTotal`,
 * the sum across active variants, so a product only reads `soldOut` when every size of every colour
 * is empty. Nothing here is fully sold out; the scarf already is.
 *
 * **What this module does NOT do:**
 *
 * - **No `sizeGuide`.** All seven are tops and all seven want the tops guide, but its id is a row
 *   `seed.ts` upserts at run time and this file has no way to know it. The caller injects it.
 * - **No images.** `gallery` is populated by `scripts/import-brand-media.ts` against slugs, not
 *   here, and inventing upload ids would be the fake-data version of §0.1.17's fake control.
 * - **It runs nothing on import.** This is a `const`; the orchestration stays in `seed.ts` so the
 *   order the catalogue is built in remains readable in one place. Idempotency comes from the
 *   caller's `upsert` on `slug` and `sku`. Every SKU below is unique and is derived the way
 *   `seed.ts` derives the existing ones — base SKU, first three letters of the colour, size — which
 *   is also why no two colours *within a product* share their first three letters.
 *
 * `sortOrder` occupies 110–170. Phase 1 used 10–100; a module that appends takes the next band so
 * the merchandised order stays stable when another content module is added beside it.
 */

/**
 * The size runs these seven need, declared here rather than imported: `seed.ts` keeps
 * `APPAREL_SIZES` inside its seeding function, where nothing outside can reach it, and a content
 * module that reached into the orchestrator's body is exactly what `shared.ts` exists to avoid. The
 * duplication is five lines and it buys independence.
 */
const XS_TO_XL = [
  { size: 'XS', sizeSortOrder: 10 },
  { size: 'S', sizeSortOrder: 20 },
  { size: 'M', sizeSortOrder: 30 },
  { size: 'L', sizeSortOrder: 40 },
  { size: 'XL', sizeSortOrder: 50 },
]

/** Cut in four sizes, not five. Both women's pieces stop at L. */
const XS_TO_L = XS_TO_XL.slice(0, 4)

/** A men's shirt that starts at S. The sort orders stay 20..50, so it interleaves correctly. */
const S_TO_XL = XS_TO_XL.slice(1)

export const TOPS_PRODUCTS: ProductSpec[] = [
  {
    slug: 'heavy-tee',
    name: 'Heavy Tee',
    sku: 'N01-HT',
    shortDescription: 'Ten-ounce cotton jersey, taped at the neck and cut square through the body.',
    description: [
      'Knitted at 280 gsm on an open-width machine and washed once before it is cut, so the length it arrives at is the length it stays.',
      'The body is square through the chest and the shoulder seam sits a little outside the bone. That is where the line comes from.',
      'It creases. Heavy cotton does.',
    ],
    categories: ['tees', 'tops', 'clothing'],
    gender: 'unisex',
    fit: 'oversized',
    materials: ['100% cotton jersey, 280 gsm', 'Self-fabric neck tape'],
    care: [
      'Machine wash cold. Tumble dry low, or hang and let the weight do the work.',
      'Wash with like colours for the first three washes.',
    ],
    tags: ['jersey', 'core'],
    priceMinor: 9000,
    colors: [
      { name: 'Chalk', hex: '#EFEBE2', family: 'white', stock: [14, 26, 31, 22, 11] },
      { name: 'Black', hex: '#141414', family: 'black', stock: [12, 24, 28, 20, 9] },
      { name: 'Stone', hex: '#A9A39A', family: 'grey', stock: [6, 12, 15, 10, 4] },
      { name: 'Olive', hex: '#4A4D3C', family: 'green', stock: [3, 7, 9, 6, 2] },
    ],
    sizes: XS_TO_XL,
    flags: { isBestSeller: true },
    sortOrder: 110,
  },
  {
    slug: 'ribbed-tee',
    name: 'Ribbed Tee',
    sku: 'N01-RT',
    shortDescription: 'A fine 1x1 rib that holds its shape without gripping.',
    description: [
      'Knitted in a fine rib from long-staple cotton, with enough elastane in it to come back after a day of wear. The neck is bound rather than ribbed, so it lies flat instead of standing.',
    ],
    categories: ['tees', 'tops', 'clothing'],
    gender: 'women',
    fit: 'slim',
    materials: ['96% long-staple cotton, 4% elastane rib'],
    care: ['Machine wash cold. Dry flat.'],
    tags: ['jersey'],
    priceMinor: 6800,
    colors: [
      { name: 'Bone', hex: '#E7E2D8', family: 'bone', stock: [5, 9, 11, 7] },
      { name: 'Ink', hex: '#1B1D24', family: 'navy', stock: [4, 8, 10, 6] },
    ],
    sizes: XS_TO_L,
    flags: { isNew: true },
    sortOrder: 120,
  },
  {
    slug: 'camp-collar-shirt',
    name: 'Camp Collar Shirt',
    sku: 'N01-CC',
    shortDescription: 'Washed linen, an open collar cut in one piece, and a single patch pocket.',
    description: [
      'Woven from a mid-weight European linen and garment-washed, which takes the starch out of it before you ever put it on.',
      'The collar is one piece, cut to sit open, with nothing underneath holding it up. Fastened it reads as a shirt. Open it reads as a jacket.',
      'Linen wrinkles from the first hour. None of this is trying to stop that.',
    ],
    categories: ['shirts', 'tops', 'clothing'],
    gender: 'men',
    fit: 'relaxed',
    materials: [
      '100% washed European linen, 160 gsm',
      'Corozo buttons',
      'French-seamed side panels',
    ],
    care: [
      'Machine wash cold on a gentle cycle.',
      'Hang damp. Iron on the reverse if you want it flat.',
    ],
    tags: ['shirting', 'linen'],
    priceMinor: 15500,
    /*
     * **Marked down for a reason.** A washed-linen camp collar sitting in an autumn catalogue is one
     * of the two pieces here a buyer would actually discount, which is the point of §29.1c: the
     * compare-at prices in this module belong to the garments whose season has turned, not to
     * whichever products happened to come next in the list.
     */
    compareAtPriceMinor: 19000,
    /*
     * Thinning unevenly, the way an end-of-season line does — Sea has no XL left and Clay has lost
     * both ends of its run. These are *variant*-level zeros: the size selector disables them and the
     * card still reads available, because the product totals 27 units. Whole-product `soldOut` is
     * the cashmere scarf's job.
     */
    colors: [
      { name: 'Ecru', hex: '#E4DCCB', family: 'bone', stock: [4, 6, 5, 2] },
      { name: 'Sea', hex: '#5C7385', family: 'blue', stock: [2, 3, 2, 0] },
      { name: 'Clay', hex: '#A9603F', family: 'rust', stock: [0, 2, 1, 0] },
    ],
    sizes: S_TO_XL,
    sortOrder: 130,
  },
  {
    slug: 'flannel-shirt',
    name: 'Flannel Shirt',
    sku: 'N01-FS',
    shortDescription:
      'Brushed cotton flannel in a two-colour check, cut as a shirt rather than a jacket.',
    description: [
      'Woven in Portugal from yarn-dyed cotton, then brushed twice on the face and once on the reverse.',
      'The check is matched at the placket and across the chest pocket. It is slower to cut that way, and it is the difference between a flannel that looks made and one that looks printed.',
      'A single needle runs the side seams and the armholes.',
      'It softens quickly and keeps going. The second winter is when it starts to be worth what it cost.',
    ],
    categories: ['shirts', 'tops', 'clothing'],
    gender: 'unisex',
    fit: 'regular',
    materials: ['100% cotton flannel, 200 gsm', 'Yarn-dyed check', 'Smoked corozo buttons'],
    care: [
      'Machine wash warm. Tumble dry low.',
      'The brushed face flattens under heat, so a cool iron or none at all.',
    ],
    tags: ['shirting'],
    priceMinor: 14000,
    /** The second and last markdown in this module. See the note on the camp collar above. */
    compareAtPriceMinor: 17500,
    colors: [
      { name: 'Ash Check', hex: '#6E6B66', family: 'grey', stock: [3, 8, 12, 9, 4] },
      // XS is gone in Bracken and is not coming back this season.
      { name: 'Bracken Check', hex: '#7A5C39', family: 'brown', stock: [0, 5, 7, 6, 2] },
    ],
    sizes: XS_TO_XL,
    sortOrder: 140,
  },
  {
    slug: 'loopback-crew',
    name: 'Loopback Crew',
    sku: 'N01-LC',
    shortDescription: 'A 400 gsm loopback crew with a set-in sleeve and a V insert at the throat.',
    description: [
      'Knitted on a loopback machine slowly enough to leave the loops whole, so the inside stays open and the outside stays flat.',
      'The V insert at the throat takes the stretch when it goes over your head, which is where a crew neck usually goes first.',
    ],
    categories: ['sweatshirts', 'tops', 'clothing'],
    gender: 'unisex',
    fit: 'regular',
    materials: ['100% cotton loopback, 400 gsm', 'Two-needle rib at cuff and hem'],
    care: ['Machine wash cold, inside out. Hang to dry.'],
    tags: ['jersey', 'core'],
    priceMinor: 16000,
    colors: [
      { name: 'Bone', hex: '#E7E2D8', family: 'bone', stock: [6, 14, 18, 13, 6] },
      { name: 'Graphite', hex: '#2B2B29', family: 'charcoal', stock: [5, 12, 16, 11, 5] },
    ],
    sizes: XS_TO_XL,
    flags: { featured: true, isBestSeller: true },
    sortOrder: 150,
  },
  {
    slug: 'zip-hoodie',
    name: 'Zip Hoodie',
    sku: 'N01-ZH',
    shortDescription: 'A full-length zip through a two-panel hood, cut close through the body.',
    description: [
      'Brushed back at 380 gsm, between the tee and the heavyweight, which is the weight most people actually wear.',
      'The zip runs up through the hood rather than stopping at the collar, so it closes to the chin.',
      'Cut close through the body with a set-in sleeve. That is what keeps it from reading as sportswear.',
    ],
    categories: ['hoodies', 'tops', 'clothing'],
    gender: 'men',
    fit: 'slim',
    materials: [
      '100% cotton, brushed back, 380 gsm',
      'Two-panel hood, self-lined',
      'YKK Excella zip',
      'Waxed cotton drawcord',
    ],
    care: [
      'Machine wash cold, inside out, zip closed.',
      'Hang to dry. Do not tumble dry.',
      'Do not iron the zip tape.',
    ],
    tags: ['jersey'],
    priceMinor: 21000,
    colors: [{ name: 'Ink', hex: '#1B1D24', family: 'navy', stock: [2, 6, 9, 7, 3] }],
    sizes: XS_TO_XL,
    flags: { featured: true, isNew: true },
    sortOrder: 160,
  },
  {
    slug: 'french-terry-hoodie',
    name: 'French Terry Hoodie',
    sku: 'N01-FT',
    shortDescription: 'Unbrushed french terry, cut long and wide. One run, from one mill lot.',
    description: [
      'French terry at 280 gsm, left unbrushed so the loop stays visible on the inside and the face keeps its grain.',
      'Long through the body, wide through the sleeve. It was made once, from the end of a mill lot, and there will not be another.',
    ],
    categories: ['hoodies', 'tops', 'clothing'],
    gender: 'women',
    fit: 'oversized',
    materials: ['100% cotton french terry, 280 gsm', 'Undyed cotton drawcord'],
    care: ['Machine wash cold. Hang to dry and it keeps its length.'],
    tags: ['jersey', 'limited'],
    priceMinor: 17500,
    /*
     * **Deliberately near the end.** Four units across the whole product, against
     * `siteSettings.lowStockThreshold` of 5, so this permanently renders §11.1b's `lowStock` card —
     * the second one in the catalogue after the card holder, and the first on a multi-size garment,
     * where the badge has to sit alongside a size selector that has a disabled option in it. L is at
     * zero. A limited run that sold through its middle sizes first is what actually happens.
     */
    colors: [{ name: 'Fog', hex: '#B9B4AB', family: 'grey', stock: [1, 2, 1, 0] }],
    sizes: XS_TO_L,
    flags: { isLimitedEdition: true, isNew: true },
    sortOrder: 170,
  },
]
