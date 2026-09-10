/**
 * Representative demo content for the NORTH / 01 catalogue and editorial surfaces.
 *
 * ```
 * pnpm seed
 * ```
 *
 * **Content only.** Plan §6's brief is *"seed only representative demo content"*, and this script
 * reads that word strictly: categories, size guides, products, variants, collections, Edits, a
 * campaign, a lookbook, journal articles, FAQs, promotions, the homepage composition, and the
 * three globals. It creates **no
 * customers, carts, orders, reviews or wishlist rows**, because those are not content — they are
 * records of things people did, and inventing them produces an admin panel full of purchases nobody
 * made and reviews nobody wrote. A commerce demo whose order list is fiction is worse than one whose
 * order list is empty, and plan §0.1.17's rule against functionality that "looks real but silently
 * does nothing" points the same way. Those tables fill up when Phases 7, 14, 17 and 21 make them
 * fillable.
 *
 * **No media.** Every image field in the schema is optional and every one is left empty, because
 * media is **Phase 8** — Cloudinary, `sharp`, responsive variants — and committing placeholder
 * binaries to stand in for it would be a different kind of fiction. Plan §8.1d already specifies the
 * result: a deliberate neutral placeholder that preserves layout dimensions. This seed is what the
 * storefront looks like against that path, which is worth seeing early.
 *
 * **Idempotent.** Everything is keyed by slug, code or question and updated in place if it already
 * exists, so running it twice changes nothing and running it after an edit re-seeds the demo values.
 * Nothing is deleted: content an editor added by hand survives a re-seed.
 *
 * **Local only, and aimed at one named database.** Seeding *over* a real catalogue would overwrite an
 * editor's work, so this refuses to run unless the **D-10** push guard is satisfied — the same
 * evidence that lets Drizzle rewrite the development schema, and the same evidence that goes away the
 * moment `DATABASE_URL` is repointed. See `requireLocalDatabase` below.
 */

import config from '../src/payload.config'

import { developmentDatabase } from '../src/lib/env.core'
import { rich, upsert, type ProductSpec } from './seed/shared'

/**
 * **The guard names the database, not the environment.** An `appEnv !== 'local'` check was the first
 * version of this and it is not a guard at all: `appEnv` is derived from `VERCEL_ENV`/`VERCEL`/
 * `NODE_ENV`, none of which are set when the Payload CLI runs on a laptop, so it resolves to `local`
 * whatever `DATABASE_URL` happens to point at. Someone with a production connection string in `.env`
 * would have passed it.
 *
 * `developmentDatabase` is the check that actually knows: decision **D-10** requires
 * `DATABASE_PUSH_TARGET` to name the one database that may be modified, and this compares it against
 * the database `DATABASE_URL` really addresses. A destructive local script is therefore armed by the
 * same evidence as Drizzle's schema push, and disarmed by the same repointing — without borrowing
 * push's `NODE_ENV === 'development'` requirement, which the Payload CLI never satisfies.
 */
const requireLocalDatabase = (script: string): void => {
  if (!developmentDatabase.ok) {
    throw new Error(
      `${script} refuses to run: ${developmentDatabase.reason}. ` +
        'It may only touch the development database that DATABASE_PUSH_TARGET names — see D-10.',
    )
  }
}

requireLocalDatabase('seed')

const { getPayload } = await import('payload')

const payload = await getPayload({ config })

try {
  // ---------------------------------------------------------------- taxonomy
  //
  // Plan §6.1d's examples, and no more than that: *"avoid creating categories that are not actually
  // used in navigation or filters."* Two levels, matching structure §2's SHOP children.
  const categorySpecs = [
    { slug: 'clothing', name: 'Clothing', parent: null, sortOrder: 10 },
    { slug: 'tops', name: 'Tops', parent: 'clothing', sortOrder: 20 },
    /*
     * **Phase 29 added Tees, Hats and Bags**, which §29.1b names and this taxonomy did not have.
     * Tees sits under Tops beside Shirts; Hats and Bags under Accessories, which until now was a
     * leaf holding everything from a scarf to a card holder. §6.1d's rule still governs — *"avoid
     * creating categories that are not actually used in navigation or filters"* — and all three now
     * hold products, which is what makes them legitimate rather than decorative.
     */
    { slug: 'tees', name: 'Tees', parent: 'tops', sortOrder: 25 },
    { slug: 'shirts', name: 'Shirts', parent: 'tops', sortOrder: 30 },
    { slug: 'sweatshirts', name: 'Sweatshirts', parent: 'tops', sortOrder: 40 },
    { slug: 'hoodies', name: 'Hoodies', parent: 'tops', sortOrder: 50 },
    { slug: 'jackets', name: 'Jackets', parent: 'clothing', sortOrder: 60 },
    { slug: 'pants', name: 'Pants', parent: 'clothing', sortOrder: 70 },
    { slug: 'shorts', name: 'Shorts', parent: 'clothing', sortOrder: 80 },
    { slug: 'accessories', name: 'Accessories', parent: null, sortOrder: 90 },
    { slug: 'hats', name: 'Hats', parent: 'accessories', sortOrder: 100 },
    { slug: 'bags', name: 'Bags', parent: 'accessories', sortOrder: 110 },
  ]

  const categoryIds = new Map<string, number>()

  // Two passes: a parent must exist before a child can point at it.
  for (const spec of categorySpecs.filter((c) => !c.parent)) {
    categoryIds.set(
      spec.slug,
      await upsert({
        payload,
        collection: 'categories',
        where: { slug: { equals: spec.slug } },
        data: {
          name: spec.name,
          slug: spec.slug,
          sortOrder: spec.sortOrder,
          status: 'published',
        },
      }),
    )
  }

  for (const spec of categorySpecs.filter((c) => c.parent)) {
    categoryIds.set(
      spec.slug,
      await upsert({
        payload,
        collection: 'categories',
        where: { slug: { equals: spec.slug } },
        data: {
          name: spec.name,
          slug: spec.slug,
          parent: categoryIds.get(spec.parent as string),
          sortOrder: spec.sortOrder,
          status: 'published',
        },
      }),
    )
  }

  payload.logger.info(`Categories: ${categoryIds.size}`)

  // ------------------------------------------------------------- size guides
  const topsGuideId = await upsert({
    payload,
    collection: 'size-guides',
    where: { slug: { equals: 'mens-tops' } },
    data: {
      title: 'Tops',
      slug: 'mens-tops',
      unit: 'cm',
      appliesTo: [categoryIds.get('tops'), categoryIds.get('shirts'), categoryIds.get('hoodies')],
      rows: [
        {
          size: 'XS',
          measurements: [
            { label: 'Chest', value: '86–91' },
            { label: 'Length', value: '68' },
          ],
        },
        {
          size: 'S',
          measurements: [
            { label: 'Chest', value: '91–96' },
            { label: 'Length', value: '70' },
          ],
        },
        {
          size: 'M',
          measurements: [
            { label: 'Chest', value: '96–101' },
            { label: 'Length', value: '72' },
          ],
        },
        {
          size: 'L',
          measurements: [
            { label: 'Chest', value: '101–106' },
            { label: 'Length', value: '74' },
          ],
        },
        {
          size: 'XL',
          measurements: [
            { label: 'Chest', value: '106–112' },
            { label: 'Length', value: '76' },
          ],
        },
      ],
      fitNotes: rich('Cut for a regular fit through the body. Between sizes, take the larger.'),
      modelNote: 'Model is 186 cm and wears a size M.',
    },
  })

  const bottomsGuideId = await upsert({
    payload,
    collection: 'size-guides',
    where: { slug: { equals: 'mens-bottoms' } },
    data: {
      title: 'Trousers and shorts',
      slug: 'mens-bottoms',
      unit: 'cm',
      appliesTo: [categoryIds.get('pants'), categoryIds.get('shorts')],
      rows: [
        {
          size: '30',
          measurements: [
            { label: 'Waist', value: '76' },
            { label: 'Inseam', value: '81' },
          ],
        },
        {
          size: '32',
          measurements: [
            { label: 'Waist', value: '81' },
            { label: 'Inseam', value: '81' },
          ],
        },
        {
          size: '34',
          measurements: [
            { label: 'Waist', value: '86' },
            { label: 'Inseam', value: '83' },
          ],
        },
        {
          size: '36',
          measurements: [
            { label: 'Waist', value: '91' },
            { label: 'Inseam', value: '83' },
          ],
        },
      ],
      fitNotes: rich('Measured flat, unstretched. Waist sizes run true.'),
    },
  })

  // ---------------------------------------------------------------- products
  //
  // Prices are minor units. Sizes carry an explicit sort order because "L" sorts before "M"
  // alphabetically and a size selector reading L / M / S / XL is the tell of a schema that could not
  // express an order.
  const APPAREL_SIZES = [
    { size: 'XS', sizeSortOrder: 10 },
    { size: 'S', sizeSortOrder: 20 },
    { size: 'M', sizeSortOrder: 30 },
    { size: 'L', sizeSortOrder: 40 },
    { size: 'XL', sizeSortOrder: 50 },
  ]

  const WAIST_SIZES = [
    { size: '30', sizeSortOrder: 10 },
    { size: '32', sizeSortOrder: 20 },
    { size: '34', sizeSortOrder: 30 },
    { size: '36', sizeSortOrder: 40 },
  ]

  const products: ProductSpec[] = [
    {
      slug: 'field-jacket',
      name: 'Field Jacket',
      sku: 'N01-FJ',
      shortDescription: 'A weatherproofed cotton field jacket, cut clean through the body.',
      description: [
        'Built from a dry, tightly woven cotton that softens with wear and holds its shape through a season of it.',
        'Four patch pockets, a two-way zip beneath a storm placket, and a collar that stands without help.',
      ],
      categories: ['jackets', 'clothing'],
      gender: 'unisex',
      fit: 'regular',
      materials: ['100% organic cotton, 9 oz', 'Corozo buttons', 'Bemberg cupro lining'],
      care: [
        'Machine wash cold on a gentle cycle. Hang to dry.',
        'Do not tumble dry. Warm iron if needed.',
      ],
      tags: ['outerwear', 'core'],
      sizeGuide: topsGuideId,
      priceMinor: 48000,
      colors: [
        { name: 'Graphite', hex: '#2B2B29', family: 'charcoal', stock: [4, 9, 12, 8, 3] },
        { name: 'Bone', hex: '#E7E2D8', family: 'bone', stock: [2, 6, 7, 5, 0] },
      ],
      sizes: APPAREL_SIZES,
      flags: { featured: true, isNew: true },
      sortOrder: 10,
    },
    {
      slug: 'merino-crew',
      name: 'Merino Crew',
      sku: 'N01-MC',
      shortDescription: 'Fine-gauge merino, knitted in a single piece.',
      description: [
        'Extra-fine merino from a mill that has been spinning it for four generations. Light enough for a layer, warm enough alone.',
      ],
      categories: ['tops', 'clothing'],
      gender: 'unisex',
      fit: 'slim',
      materials: ['100% extra-fine merino wool, 18.5 micron'],
      care: ['Hand wash cool or dry clean. Dry flat, away from direct heat.'],
      tags: ['knitwear', 'core'],
      sizeGuide: topsGuideId,
      priceMinor: 22000,
      compareAtPriceMinor: 28000,
      colors: [
        { name: 'Ink', hex: '#1B1D24', family: 'navy', stock: [6, 11, 14, 9, 4] },
        { name: 'Oat', hex: '#D6CFC0', family: 'bone', stock: [3, 5, 2, 0, 0] },
      ],
      sizes: APPAREL_SIZES,
      flags: { isBestSeller: true, isNew: true },
      sortOrder: 20,
    },
    {
      slug: 'oxford-shirt',
      name: 'Oxford Shirt',
      sku: 'N01-OS',
      shortDescription: 'Washed oxford cloth with an unlined, softly rolled collar.',
      description: ['Woven on shuttle looms, then washed once so it arrives already broken in.'],
      categories: ['shirts', 'tops', 'clothing'],
      gender: 'unisex',
      fit: 'regular',
      materials: ['100% cotton oxford, 140 gsm', 'Mother-of-pearl buttons'],
      care: ['Machine wash warm. Tumble dry low, or hang while damp and skip the iron.'],
      tags: ['shirting', 'core'],
      sizeGuide: topsGuideId,
      priceMinor: 16500,
      colors: [
        { name: 'Chalk', hex: '#EFEBE2', family: 'white', stock: [5, 10, 15, 10, 6] },
        { name: 'Slate', hex: '#5A6068', family: 'grey', stock: [4, 8, 9, 7, 2] },
      ],
      sizes: APPAREL_SIZES,
      flags: { isBestSeller: true, featured: true },
      sortOrder: 30,
    },
    {
      slug: 'heavyweight-hoodie',
      name: 'Heavyweight Hoodie',
      sku: 'N01-HH',
      shortDescription: 'Loopback cotton at 500 gsm, with a two-panel hood.',
      description: [
        'Knitted heavy and dyed in the piece, so the colour settles rather than sits on top.',
      ],
      categories: ['hoodies', 'tops', 'clothing'],
      gender: 'unisex',
      fit: 'relaxed',
      materials: ['100% cotton loopback, 500 gsm'],
      care: ['Machine wash cold, inside out. Hang to dry.'],
      tags: ['jersey'],
      sizeGuide: topsGuideId,
      priceMinor: 19500,
      colors: [{ name: 'Charcoal', hex: '#333330', family: 'charcoal', stock: [3, 7, 11, 8, 5] }],
      sizes: APPAREL_SIZES,
      flags: { featured: true, isNew: true },
      sortOrder: 40,
    },
    {
      slug: 'wool-overshirt',
      name: 'Wool Overshirt',
      sku: 'N01-WO',
      shortDescription: 'A shirt with the weight of a jacket.',
      description: ['Melton wool, brushed and pressed until the surface is close to felt.'],
      categories: ['jackets', 'clothing'],
      gender: 'unisex',
      fit: 'relaxed',
      materials: ['80% wool, 20% nylon melton, 620 gsm'],
      care: ['Dry clean only.'],
      tags: ['outerwear', 'limited'],
      sizeGuide: topsGuideId,
      priceMinor: 34000,
      colors: [{ name: 'Moss', hex: '#3F4736', family: 'green', stock: [2, 4, 5, 3, 1] }],
      sizes: APPAREL_SIZES,
      flags: { isLimitedEdition: true, isNew: true, featured: true },
      sortOrder: 50,
    },
    {
      slug: 'pleated-trouser',
      name: 'Pleated Trouser',
      sku: 'N01-PT',
      shortDescription: 'A single forward pleat, and a leg that falls straight from it.',
      description: [
        'Cut from a dry wool-blend twill that creases where it should and nowhere else.',
      ],
      flags: { isLimitedEdition: true },
      categories: ['pants', 'clothing'],
      gender: 'unisex',
      fit: 'relaxed',
      materials: ['62% wool, 38% cotton twill'],
      care: ['Dry clean. Press on the reverse.'],
      tags: ['tailoring'],
      sizeGuide: bottomsGuideId,
      priceMinor: 26000,
      colors: [
        { name: 'Graphite', hex: '#2B2B29', family: 'charcoal', stock: [4, 9, 7, 3] },
        { name: 'Sand', hex: '#C8B79B', family: 'tan', stock: [2, 5, 4, 0] },
      ],
      sizes: WAIST_SIZES,
      sortOrder: 60,
    },
    {
      slug: 'selvedge-denim',
      name: 'Selvedge Denim',
      sku: 'N01-SD',
      shortDescription: 'Raw 14 oz selvedge, cut straight.',
      description: [
        'Woven on shuttle looms in Okayama. Unwashed, so the first six months are yours.',
      ],
      categories: ['pants', 'clothing'],
      gender: 'unisex',
      fit: 'slim',
      materials: ['100% cotton selvedge denim, 14 oz'],
      care: ['Wash rarely, cold, inside out. Hang to dry.'],
      tags: ['denim', 'core'],
      sizeGuide: bottomsGuideId,
      priceMinor: 23500,
      colors: [{ name: 'Indigo', hex: '#2A3550', family: 'navy', stock: [3, 8, 10, 5] }],
      sizes: WAIST_SIZES,
      flags: { isBestSeller: true, isLimitedEdition: true },
      sortOrder: 70,
    },
    {
      slug: 'cotton-tee',
      name: 'Cotton Tee',
      sku: 'N01-CT',
      shortDescription: 'Compact cotton jersey, cut with a set-in sleeve.',
      description: [
        'Long-staple cotton knitted tight, so the shoulder seam stays where it was put.',
      ],
      categories: ['tops', 'clothing'],
      gender: 'unisex',
      fit: 'regular',
      materials: ['100% long-staple cotton, 220 gsm'],
      care: ['Machine wash cold. Tumble dry low.'],
      tags: ['jersey', 'core'],
      sizeGuide: topsGuideId,
      priceMinor: 7500,
      colors: [
        { name: 'Chalk', hex: '#EFEBE2', family: 'white', stock: [12, 20, 24, 18, 9] },
        { name: 'Black', hex: '#141414', family: 'black', stock: [10, 18, 22, 16, 8] },
      ],
      sizes: APPAREL_SIZES,
      sortOrder: 80,
    },
    {
      slug: 'cashmere-scarf',
      name: 'Cashmere Scarf',
      sku: 'N01-CS',
      shortDescription: 'Brushed cashmere, two metres of it.',
      description: ['Woven loosely and brushed twice, which is what makes it warm without weight.'],
      categories: ['accessories'],
      gender: 'unisex',
      fit: 'regular',
      materials: ['100% cashmere'],
      care: ['Dry clean. Store folded, not hung.'],
      tags: ['accessory', 'gift'],
      priceMinor: 21000,
      /*
       * **Deliberately sold out — both colours at zero.**
       *
       * Plan §11.1b requires a product card that can say "Sold out", and until Phase 11's audit the
       * seeded catalogue could not produce one: all ten products were in stock, so that state, the
       * low-stock state and the badge precedence between them had only ever been exercised by
       * fixtures. Three of the nine card states were unreachable in a browser, which meant no
       * browser pass and no axe sweep had ever covered them.
       *
       * It has to be *every* colour, because `derived.inventoryTotal` is the sum across active
       * variants — zeroing one colour and leaving the other would still total four.
       *
       * The product stays published and keeps its price, which is exactly the distinction
       * `ProductVariants.ts` draws: sold out is "active && inventoryQuantity === 0", a temporary
       * state the customer is told about, and it is not the same as withdrawn.
       */
      colors: [
        { name: 'Oat', hex: '#D6CFC0', family: 'bone', stock: [0] },
        { name: 'Rust', hex: '#8A4B32', family: 'rust', stock: [0] },
      ],
      sizes: [{ size: 'ONE SIZE', sizeSortOrder: 10 }],
      flags: { featured: true, isBestSeller: true, isLimitedEdition: true },
      sortOrder: 90,
    },
    {
      slug: 'card-holder',
      name: 'Card Holder',
      sku: 'N01-CH',
      shortDescription: 'Four pockets, one piece of leather, no lining.',
      description: [
        'Vegetable-tanned in Tuscany and cut in one piece, so there is nothing inside to come apart.',
      ],
      categories: ['accessories'],
      gender: 'unisex',
      fit: 'regular',
      materials: ['Vegetable-tanned calf leather'],
      care: ['Wipe with a dry cloth. It will darken. That is the point.'],
      tags: ['accessory', 'gift', 'leather'],
      priceMinor: 9500,
      /*
       * **Deliberately low stock.** Two units against `siteSettings.lowStockThreshold` of 5, so the
       * catalogue permanently carries a card reading "Only 2 left" — plan §11.1b's low-stock state,
       * and the other half of the coverage gap the scarf above closes. See that comment.
       */
      colors: [{ name: 'Espresso', hex: '#43302B', family: 'brown', stock: [2] }],
      sizes: [{ size: 'ONE SIZE', sizeSortOrder: 10 }],
      sortOrder: 100,
    },
  ]

  const productIds = new Map<string, number>()
  let variantCount = 0

  for (const spec of products) {
    const productId = await upsert({
      payload,
      collection: 'products',
      where: { slug: { equals: spec.slug } },
      data: {
        name: spec.name,
        slug: spec.slug,
        shortDescription: spec.shortDescription,
        description: rich(...spec.description),
        categories: spec.categories.map((slug) => categoryIds.get(slug)).filter(Boolean),
        gender: spec.gender,
        fit: spec.fit,
        materials: spec.materials,
        care: rich(...spec.care),
        tags: spec.tags,
        ...(spec.sizeGuide ? { sizeGuide: spec.sizeGuide } : {}),
        sortOrder: spec.sortOrder,
        status: 'published',
        featured: spec.flags?.featured ?? false,
        isNew: spec.flags?.isNew ?? false,
        isBestSeller: spec.flags?.isBestSeller ?? false,
        isLimitedEdition: spec.flags?.isLimitedEdition ?? false,
      },
    })

    productIds.set(spec.slug, productId)

    for (const color of spec.colors) {
      for (const [index, size] of spec.sizes.entries()) {
        const sku = `${spec.sku}-${color.name.slice(0, 3).toUpperCase()}-${size.size.replace(/\s+/g, '')}`

        await upsert({
          payload,
          collection: 'product-variants',
          where: { sku: { equals: sku } },
          data: {
            product: productId,
            sku,
            color: color.name,
            colorHex: color.hex,
            colorFamily: color.family,
            size: size.size,
            sizeSortOrder: size.sizeSortOrder,
            priceMinor: spec.priceMinor,
            ...(spec.compareAtPriceMinor ? { compareAtPriceMinor: spec.compareAtPriceMinor } : {}),
            inventoryQuantity: color.stock[index] ?? 0,
            active: true,
          },
        })

        variantCount += 1
      }
    }
  }

  payload.logger.info(`Products: ${productIds.size}, variants: ${variantCount}`)

  // ------------------------------------------------------------- collections
  //
  // Structure §2's four, with Essentials among them rather than in Edit — DEV-01.
  const collectionSpecs = [
    {
      slug: 'current-season',
      title: 'Current Season',
      description: 'The pieces the season was built around.',
      products: ['field-jacket', 'wool-overshirt', 'merino-crew', 'pleated-trouser'],
    },
    {
      slug: 'essentials',
      title: 'Essentials',
      description: 'The ten things that make everything else work.',
      products: [
        'cotton-tee',
        'oxford-shirt',
        'merino-crew',
        'selvedge-denim',
        'heavyweight-hoodie',
      ],
    },
    {
      slug: 'limited',
      title: 'Limited',
      description: 'Made once, in a quantity we can count.',
      products: ['wool-overshirt', 'cashmere-scarf'],
    },
    {
      slug: 'archive',
      title: 'Archive',
      description: 'Past seasons, while they last.',
      products: ['card-holder', 'cotton-tee'],
    },
  ]

  const collectionIds = new Map<string, number>()

  for (const spec of collectionSpecs) {
    collectionIds.set(
      spec.slug,
      await upsert({
        payload,
        collection: 'collections',
        where: { slug: { equals: spec.slug } },
        data: {
          title: spec.title,
          slug: spec.slug,
          description: rich(spec.description),
          products: spec.products.map((slug) => productIds.get(slug)).filter(Boolean),
          status: 'published',
          body: [
            {
              blockType: 'editorial',
              eyebrow: spec.title,
              heading: spec.description,
              body: rich(
                'Photography arrives in Phase 8. Until then this page is composed from type alone, which is a fair test of the hierarchy.',
              ),
              width: 'narrow',
              cta: { kind: 'url', label: 'Shop all', href: '/shop' },
            },
          ],
        },
      }),
    )
  }

  // Related collections, once every collection exists to be related to.
  for (const spec of collectionSpecs) {
    await payload.update({
      collection: 'collections',
      id: collectionIds.get(spec.slug) as number,
      data: {
        relatedCollections: collectionSpecs
          .filter((other) => other.slug !== spec.slug)
          .slice(0, 2)
          .map((other) => collectionIds.get(other.slug)),
      },
      depth: 0,
    })
  }

  payload.logger.info(`Collections: ${collectionIds.size}`)

  // -------------------------------------------------------------------- edits
  //
  // Structure §2's four. Essentials is a Collection above, per DEV-01.
  const editSpecs = [
    {
      slug: 'weekend',
      title: 'Weekend',
      intro: 'Two days that ask nothing of you, dressed accordingly.',
      groups: [
        {
          title: 'Saturday morning',
          products: ['heavyweight-hoodie', 'selvedge-denim', 'cotton-tee'],
        },
        { title: 'Somewhere colder', products: ['wool-overshirt', 'cashmere-scarf'] },
      ],
    },
    {
      slug: 'travel',
      title: 'Travel',
      intro: 'Things that survive being folded into a bag at speed.',
      groups: [{ title: 'Carry-on', products: ['merino-crew', 'pleated-trouser', 'card-holder'] }],
    },
    {
      slug: 'everyday',
      title: 'Everyday',
      intro: 'The rotation. Worn more than everything else combined.',
      groups: [
        { title: 'The rotation', products: ['cotton-tee', 'oxford-shirt', 'selvedge-denim'] },
      ],
    },
    {
      slug: 'gifts',
      title: 'Gifts',
      intro: 'For people whose size you do not know.',
      groups: [{ title: 'One size', products: ['cashmere-scarf', 'card-holder'] }],
    },
  ]

  for (const spec of editSpecs) {
    await upsert({
      payload,
      collection: 'edits',
      where: { slug: { equals: spec.slug } },
      data: {
        title: spec.title,
        slug: spec.slug,
        intro: rich(spec.intro),
        status: 'published',
        productGroups: spec.groups.map((group) => ({
          title: group.title,
          products: group.products.map((slug) => productIds.get(slug)).filter(Boolean),
        })),
      },
    })
  }

  payload.logger.info(`Edits: ${editSpecs.length}`)

  // -------------------------------------------------------------------- media
  /**
   * **What is already in the media library, if anything.**
   *
   * The seed creates **no** assets — plan §6's brief is content only, and Phase 8 built the
   * placeholder path precisely so that an empty library renders a deliberate neutral box at the
   * right aspect ratio rather than a broken layout.
   *
   * But three homepage blocks and each community-gallery item carry `validateRequiredUpload` —
   * Phase 6's *"required to author, nullable in the database"* rule — so writing them against an
   * empty library is a `ValidationError`, not a page of placeholders. (Measured: seven errors, one
   * per required upload.)
   *
   * So the composition adapts to what is there. With no media it writes the **six** sections that
   * need no asset — hero, category tiles, two product rails, collection feature, promise strip; with
   * media it writes **ten**, adding the two split features, shop-the-look and the community gallery,
   * and attaching the campaign's own desktop and mobile frames. Both are valid homepages, and
   * neither invents a media id the seed did not create.
   *
   * (Those two counts are the ones the code actually produces. An earlier version of this comment
   * said "seven" and "eleven", which were the block *types* in the picker rather than the sections
   * written here — the sort of number that is right when written and wrong by the next commit.)
   */
  const { docs: mediaDocs } = await payload.find({
    collection: 'media',
    limit: 30,
    sort: 'id',
    overrideAccess: true,
  })

  const byRole = (role: string) =>
    mediaDocs.filter((doc) => (doc as { role?: string }).role === role)
  const campaignMedia = byRole('campaign')
  const editorialMedia = byRole('editorial')

  const pick = (index: number): number | undefined =>
    editorialMedia[index]?.id ?? mediaDocs[index]?.id

  /** Only compose a media block when there is genuinely something to put in it. */
  const withMedia = <T>(image: number | undefined, block: (id: number) => T): T[] =>
    image === undefined ? [] : [block(image)]

  const socialItems = editorialMedia
    .slice(0, 4)
    .map((doc) => ({ image: doc.id, handle: '@north01' }))

  if (mediaDocs.length > 0) {
    payload.logger.info(
      `Media present: ${mediaDocs.length} — the full composition will be written.`,
    )
  } else {
    payload.logger.info('Media library empty — the media-led sections are omitted, by design.')
  }

  // ---------------------------------------------------------------- campaign
  const campaignId = await upsert({
    payload,
    collection: 'campaigns',
    where: { slug: { equals: 'aw26-north' } },
    data: {
      title: 'Due North',
      slug: 'aw26-north',
      season: 'AW26',
      /*
       * The desktop and mobile frames are a genuinely different pair when the library has them —
       * `campaigns.mobileHero` has existed since Phase 6 and was unrenderable until Phase 10 gave
       * `MediaImage` a `mobileMedia` prop. Attaching both is what exercises that path.
       */
      ...(campaignMedia[0] ? { hero: campaignMedia[0].id } : {}),
      ...(campaignMedia[1] ? { mobileHero: campaignMedia[1].id } : {}),
      story: rich(
        'A season assembled for weather rather than for a mood board. Heavier cloth, fewer pieces, and nothing that needs explaining.',
      ),
      collection: collectionIds.get('current-season'),
      products: ['field-jacket', 'wool-overshirt', 'merino-crew'].map((slug) =>
        productIds.get(slug),
      ),
      cta: {
        kind: 'reference',
        label: 'See the collection',
        reference: { relationTo: 'collections', value: collectionIds.get('current-season') },
      },
      // Plan §10.1b's second hero button. Added to `campaigns` in Phase 10 — see that collection.
      secondaryCta: {
        kind: 'url',
        label: 'Read the story',
        href: '/journal/a-weekend-north',
      },
      status: 'published',
    },
  })

  // ---------------------------------------------------------------- lookbook
  await upsert({
    payload,
    collection: 'lookbooks',
    where: { slug: { equals: 'aw26' } },
    data: {
      title: 'AW26',
      slug: 'aw26',
      season: 'AW26',
      intro: rich('Two chapters, shot over one weekend on the same stretch of coast.'),
      status: 'published',
      chapters: [
        {
          title: 'Headland',
          editorialText: rich('Wind, and clothing that does not argue with it.'),
          hotspots: [
            {
              product: productIds.get('field-jacket'),
              label: 'Field Jacket',
              xDesktop: 42,
              yDesktop: 38,
              xMobile: 50,
              yMobile: 44,
              markerTone: 'light' as const,
            },
            {
              product: productIds.get('pleated-trouser'),
              xDesktop: 46,
              yDesktop: 72,
              xMobile: 52,
              yMobile: 78,
              markerTone: 'light',
            },
          ],
        },
        {
          title: 'Inland',
          editorialText: rich('Layers, subtracted one at a time.'),
          hotspots: [
            {
              product: productIds.get('merino-crew'),
              xDesktop: 55,
              yDesktop: 40,
              xMobile: 50,
              yMobile: 46,
              markerTone: 'dark',
            },
          ],
        },
      ],
    },
  })

  // ----------------------------------------------------------------- journal
  const journalSpecs = [
    {
      slug: 'on-selvedge',
      title: 'On Selvedge',
      category: 'craft',
      author: 'Editorial',
      excerpt: 'Why a slower loom makes a better edge, and what that costs.',
      related: ['selvedge-denim'],
    },
    {
      slug: 'the-case-for-fewer-things',
      title: 'The Case for Fewer Things',
      category: 'style',
      author: 'Editorial',
      excerpt: 'A wardrobe is not a collection. It is a rotation.',
      related: ['cotton-tee', 'oxford-shirt', 'merino-crew'],
    },
    {
      slug: 'a-weekend-north',
      title: 'A Weekend North',
      category: 'places',
      author: 'Editorial',
      excerpt: 'Three days, one bag, and the argument for packing less than you think.',
      related: ['field-jacket', 'cashmere-scarf'],
    },
  ]

  /** Captured so the homepage's editorial block can reference an article rather than type a path. */
  const journalIds = new Map<string, number>()

  for (const spec of journalSpecs) {
    const journalId = await upsert({
      payload,
      collection: 'journal',
      where: { slug: { equals: spec.slug } },
      data: {
        title: spec.title,
        slug: spec.slug,
        category: spec.category,
        author: spec.author,
        excerpt: spec.excerpt,
        body: rich(
          spec.excerpt,
          'Demo copy. The Journal exists so editorial has somewhere to go that is not a product page, and so a product page has somewhere to send a reader who is not ready to buy.',
        ),
        relatedProducts: spec.related.map((slug) => productIds.get(slug)).filter(Boolean),
        status: 'published',
      },
    })

    journalIds.set(spec.slug, journalId)
  }

  payload.logger.info(`Journal: ${journalSpecs.length}`)

  // -------------------------------------------------------------------- FAQs
  const faqSpecs = [
    {
      question: 'When will my order ship?',
      topic: 'orders',
      answer: 'Orders placed before 2pm ship the same working day.',
      sortOrder: 10,
    },
    {
      question: 'How much is delivery?',
      topic: 'shipping',
      answer:
        'Standard delivery is free above the threshold shown in your bag. Express and overnight are charged at checkout.',
      sortOrder: 20,
    },
    {
      question: 'Can I return something?',
      topic: 'returns',
      answer: 'Anything unworn can be returned within 30 days. Start the return from your account.',
      sortOrder: 30,
    },
    {
      question: 'How do I choose a size?',
      topic: 'sizing',
      answer:
        'Every product page has a size guide with real measurements. Between sizes, take the larger.',
      sortOrder: 40,
    },
    {
      question: 'How should I wash wool?',
      topic: 'care',
      answer: 'Cool hand wash or dry clean, and dry flat. Never hang wet knitwear.',
      sortOrder: 50,
    },
    {
      question: 'Do I need an account to order?',
      topic: 'account',
      answer: 'No. You can check out as a guest and create an account later.',
      sortOrder: 60,
    },
  ]

  for (const spec of faqSpecs) {
    await upsert({
      payload,
      collection: 'faqs',
      where: { question: { equals: spec.question } },
      data: {
        question: spec.question,
        answer: rich(spec.answer),
        topic: spec.topic,
        sortOrder: spec.sortOrder,
        status: 'published',
      },
    })
  }

  payload.logger.info(`FAQs: ${faqSpecs.length}`)

  // -------------------------------------------------------------- promotions
  //
  // Inactive on purpose. A live discount code in seed data is a live discount code.
  await upsert({
    payload,
    collection: 'promotions',
    where: { code: { equals: 'WELCOME10' } },
    data: {
      code: 'WELCOME10',
      description: 'Demo: 10% off a first order.',
      type: 'percentage',
      percentage: 10,
      minimumSubtotalMinor: 10000,
      perCustomerLimit: 1,
      active: false,
    },
  })

  await upsert({
    payload,
    collection: 'promotions',
    where: { code: { equals: 'FREESHIP' } },
    data: {
      code: 'FREESHIP',
      description: 'Demo: free standard delivery.',
      type: 'free_shipping',
      active: false,
    },
  })

  // ----------------------------------------------------------------- globals
  await payload.updateGlobal({
    slug: 'site-settings',
    data: {
      siteName: 'NORTH / 01',
      tagline: 'Considered clothing for people who wear it out.',
      contactEmail: 'help@north01.example',
      defaultCurrency: 'USD',
      defaultLocale: 'en-US',
      freeShippingThresholdMinor: 15000,
      lowStockThreshold: 5,
      /*
       * Four terms the seeded catalogue actually answers — D-38.
       *
       * Seeding them is not decoration: `getPopularSearches` drops any term with no hits, so an
       * unseeded field means the section renders in zero environments and the phase would ship the
       * FIELD rather than the SECTION. Each of these was measured against the index: hoodie 1,
       * merino 1, jacket 1, cashmere 1.
       */
      search: {
        popularSearches: [
          { term: 'hoodie' },
          { term: 'merino' },
          { term: 'jacket' },
          { term: 'cashmere' },
        ],
      },
      maxQuantityPerLine: 10,
      shippingPolicy: rich(
        'Standard delivery is free above the threshold shown in your bag, and charged below it. Express and overnight are quoted at checkout.',
        'Everything ships from a single fulfilment centre. There is no collection point — NORTH / 01 is an online shop.',
      ),
      returnsPolicy: rich(
        'Anything unworn, with its tags on, can be returned within 30 days of delivery.',
        'Start a return from your account, or from the order confirmation email if you checked out as a guest.',
      ),
      defaultSeoTitle: 'NORTH / 01',
      defaultSeoDescription: 'Considered clothing, made in small runs and built to be worn out.',
      announcement: {
        enabled: false,
        message: 'Complimentary delivery on orders over $150.',
        href: '/shop',
      },
    },
    depth: 0,
  })

  await payload.updateGlobal({
    slug: 'navigation',
    data: {
      // Six primary items — DEV-07, C-08. The array caps at six, so this is the whole navigation.
      primary: [
        { label: 'New', kind: 'url', href: '/shop?sort=newest' },
        {
          label: 'Shop',
          kind: 'url',
          href: '/shop',
          columns: [
            {
              heading: 'Clothing',
              links: [
                {
                  label: 'Tops',
                  kind: 'reference',
                  reference: { relationTo: 'categories', value: categoryIds.get('tops') },
                },
                {
                  label: 'Jackets',
                  kind: 'reference',
                  reference: { relationTo: 'categories', value: categoryIds.get('jackets') },
                },
                {
                  label: 'Pants',
                  kind: 'reference',
                  reference: { relationTo: 'categories', value: categoryIds.get('pants') },
                },
              ],
            },
            {
              heading: 'Accessories',
              links: [
                {
                  label: 'All accessories',
                  kind: 'reference',
                  reference: { relationTo: 'categories', value: categoryIds.get('accessories') },
                },
              ],
            },
          ],
        },
        {
          label: 'Collections',
          kind: 'url',
          href: '/collections',
          columns: [
            {
              heading: 'Collections',
              links: collectionSpecs.map((spec) => ({
                label: spec.title,
                kind: 'reference' as const,
                reference: {
                  relationTo: 'collections' as const,
                  value: collectionIds.get(spec.slug),
                },
              })),
            },
          ],
        },
        {
          label: 'Edit',
          kind: 'url',
          href: '/edit',
          columns: [
            {
              heading: 'The Edit',
              links: editSpecs.map((spec) => ({
                label: spec.title,
                kind: 'url' as const,
                href: `/edit/${spec.slug}`,
              })),
            },
          ],
        },
        { label: 'Lookbook', kind: 'url', href: '/lookbook' },
        { label: 'About', kind: 'url', href: '/about' },
      ],
      footer: [
        {
          heading: 'Shop',
          links: [
            { label: 'All products', kind: 'url', href: '/shop' },
            { label: 'Collections', kind: 'url', href: '/collections' },
            { label: 'The Edit', kind: 'url', href: '/edit' },
          ],
        },
        /*
         * **Every href here is a route that exists** — Phase 28's audit found four that were not.
         * `/help` (the FAQ pointed at a page that was never built, rather than at `/help/faq`),
         * `/contact` (gap G-08), and `/about`. Seeding a footer full of 404s makes every fresh
         * install look broken, and it is the first thing anybody clicks.
         */
        {
          heading: 'Help',
          links: [
            { label: 'FAQ', kind: 'url', href: '/help/faq' },
            { label: 'Shipping', kind: 'url', href: '/help/shipping' },
            { label: 'Returns', kind: 'url', href: '/help/returns' },
          ],
        },
        {
          heading: 'NORTH / 01',
          links: [
            { label: 'Journal', kind: 'url', href: '/journal' },
            { label: 'Lookbook', kind: 'url', href: '/lookbook' },
          ],
        },
      ],
      social: [
        { platform: 'instagram', url: 'https://instagram.com/north01' },
        { platform: 'pinterest', url: 'https://pinterest.com/north01' },
      ],
    },
    depth: 0,
  })

  // -------------------------------------------------------------- homepage
  /**
   * **The homepage composition**, in structure §4's order — see the media lookup above for why four
   * of these ten sections are conditional:
   *
   * > 1. Hero campaign. 2. Featured categories. 3. New arrivals. 4. Editorial / Shop the Look
   * > moment. 5. Best sellers or limited edition. 6. Brand story. 7. Community/social.
   * > 8. Newsletter/footer.
   *
   * Step 8 is the footer's column, not a section here — **DEV-42**.
   *
   * `updateGlobal` rather than `upsert`: a global has one document and this replaces the whole of
   * it, so the seed is idempotent by construction. Running it twice produces eleven sections, not
   * twenty-two.
   *
   * **No media is attached, deliberately.** The seed creates no assets — plan §6's brief is content
   * only, and Phase 8 built the placeholder path precisely so an empty media library renders a
   * deliberate neutral box at the right aspect ratio rather than a broken layout. That path is
   * still the one this project is committed in.
   */
  /**
   * **The four blocks that cannot be authored without an image.**
   *
   * `splitFeature`, `figure`, `shopTheLook` and each `socialGallery` item carry
   * `validateRequiredUpload` — Phase 6's *"required to author, nullable in the database"* rule,
   * which is what keeps a referenced asset deletable while still refusing a half-finished block.
   * The seed creates no media, so writing those blocks against an empty library is a
   * `ValidationError`, not a page with placeholders. (Measured: seven errors, one per required
   * upload.)
   *
   * So the composition adapts. On an empty media library the seed writes the seven blocks that
   * need no asset; on a library with images it writes all eleven. Both are valid homepages, and
   * neither is a lie about what is in the database — which is better than either hard-coding a
   * media id the seed did not create, or dropping four of structure §4's eight steps permanently.
   */
  await payload.updateGlobal({
    slug: 'homepage',
    data: {
      sections: [
        { blockType: 'hero', campaign: campaignId },
        {
          blockType: 'categoryTiles',
          heading: 'Shop by category',
          items: [
            { category: categoryIds.get('jackets') },
            { category: categoryIds.get('tops') },
            { category: categoryIds.get('pants') },
            { category: categoryIds.get('accessories') },
          ],
        },
        {
          blockType: 'productRail',
          heading: 'New arrivals',
          source: 'new',
          limit: 4,
          layout: 'grid',
          cta: { kind: 'url', label: 'View all', href: '/shop' },
        },
        ...withMedia(pick(0), (image) => ({
          blockType: 'splitFeature' as const,
          image,
          imageSide: 'left' as const,
          eyebrow: 'AW26',
          heading: 'Cloth chosen for weather',
          body: rich(
            'The overshirt is a twelve-ounce wool, milled in Yorkshire and cut long enough to sit over a crew. It is the piece the rest of the season is built around.',
          ),
          cta: {
            kind: 'reference' as const,
            label: 'Read the journal',
            reference: { relationTo: 'journal' as const, value: journalIds.get('on-selvedge') },
          },
        })),
        ...withMedia(pick(1), (image) => ({
          blockType: 'shopTheLook' as const,
          image,
          heading: 'Shop the look',
          hotspots: [
            {
              product: productIds.get('wool-overshirt'),
              label: 'Wool Overshirt',
              xDesktop: 38,
              yDesktop: 34,
              xMobile: 44,
              yMobile: 38,
              markerTone: 'light' as const,
            },
            {
              product: productIds.get('pleated-trouser'),
              label: 'Pleated Trouser',
              xDesktop: 44,
              yDesktop: 70,
              xMobile: 50,
              yMobile: 74,
              markerTone: 'light' as const,
            },
            {
              product: productIds.get('cashmere-scarf'),
              label: 'Cashmere Scarf',
              xDesktop: 52,
              yDesktop: 22,
              xMobile: 58,
              yMobile: 26,
              markerTone: 'dark' as const,
            },
          ],
        })),
        {
          blockType: 'productRail',
          heading: 'Best sellers',
          source: 'bestSellers',
          limit: 4,
          layout: 'rail',
          cta: { kind: 'url', label: 'View all', href: '/shop' },
        },
        {
          blockType: 'collectionFeature',
          collection: collectionIds.get('limited'),
          eyebrow: 'Limited',
          body: 'Short runs of the pieces we could only make a few of. When they are gone they are not repeated.',
        },
        // The brand story is a split feature — DEV-43. Same shape, different words.
        ...withMedia(pick(2), (image) => ({
          blockType: 'splitFeature' as const,
          image,
          imageSide: 'right' as const,
          eyebrow: 'About',
          heading: 'Fewer things, made properly',
          body: rich(
            'NORTH / 01 is an online-only label. No shops, no seasonal churn, and no pretending that a garment needs to be replaced every six months.',
          ),
          cta: { kind: 'url' as const, label: 'About the label', href: '/about' },
        })),
        ...(socialItems.length >= 3
          ? [{ blockType: 'socialGallery' as const, heading: 'Worn by', items: socialItems }]
          : []),
        {
          blockType: 'promoStrip',
          items: [
            { text: 'Made in small runs' },
            { text: 'Thirty-day returns' },
            { text: 'Carbon-neutral delivery' },
          ],
        },
      ],
    },
    depth: 0,
  })

  payload.logger.info('Globals: site-settings, navigation, homepage')
  payload.logger.info('Seed complete.')
} finally {
  await payload.destroy()
}
