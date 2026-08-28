import type { Where } from 'payload'

import { formatPriceRange } from '@/lib/money'
import { resolveLink, type ShellLink } from '@/lib/navigation/resolve'
import { documentHref } from '@/lib/navigation/routes'
import type { CurrencyCode } from '@/payload/fields/money'
import type { Category, Collection, Homepage, Media, Product } from '@/payload-types'

/**
 * **The homepage record, turned into something components can render.**
 *
 * This module is the Phase 10 counterpart of `lib/navigation/resolve.ts`, and it is pure for the
 * same reason: it imports nothing from `next`, nothing runnable from `payload` and nothing marked
 * `server-only`, so **every rule below can be exercised by `scripts/verify-home.ts` outside a
 * request**. `lib/home/home.ts` holds the caching and the try/catch and no rules at all.
 *
 * The one `payload` import is `import type { Where }`, which TypeScript erases entirely. A `Where`
 * built here is handed straight to `payload.find`, and typing it as a bare record would mean the
 * query shape — the thing standing between a customer and an unpublished product — was checked by
 * nobody.
 *
 * ### Feature matrix §3's six edge cases, resolved before a single element exists
 *
 * | Edge case | What happens |
 * |---|---|
 * | *Missing hero image* | the section is **kept**; `MediaImage` renders its placeholder in a box reserved from the delivery context, so nothing shifts |
 * | *Empty section* | **dropped** — a strip with no statements, a rail whose query returned nothing, a gallery whose every image was deleted |
 * | *Unpublished section* | **dropped** when the unpublished document *is* the section (a hero's campaign, a collection feature's collection); the **item** is dropped when it is one of many (a tile's category, a group's product) |
 * | *Invalid product relationship* | the **product** is dropped — a bare id, a `null` left by `ON DELETE SET NULL`, a soft-deleted row, a draft, a future publication date, an empty slug, or no purchasable price |
 * | *Slow media* | not a resolver concern — the box is reserved and the LQIP paints before any byte arrives |
 * | *Mobile-specific crop* | `mobileMedia` is carried separately at every surface that has one; absent, `MediaImage` re-crops the desktop asset, which is §10.1b's *"safe fallback"* |
 *
 * **Dropping is the whole strategy**, and it is the one Phase 9 argued for: rendering a dead link is
 * the broken internal route the matrix asks us to avoid, and rendering a *disabled* section is plan
 * §0.1.17's fake control with an apology attached. A homepage one section shorter is the only honest
 * outcome — and **the empty homepage is a reachable state** that `page.tsx` must render without
 * complaint.
 *
 * ### Why publication is re-tested here, again
 *
 * `payload.findGlobal` and `payload.find` default to `overrideAccess: true`, and that flag
 * propagates into relationship population — so an unpublished product or a draft collection
 * populates in full. `navigation/resolve.ts` records this for the shell; the homepage's surface is
 * larger, because `products` carry `status` **and** are soft-deletable, so there are two ways for a
 * populated document to be one a customer must not see.
 *
 * Passing `overrideAccess: false` instead would be worse, not better: when access filters a
 * reference out, Payload resolves the field to a **bare id**, so a two-state problem becomes a
 * three-state one. Populate everything, then decide here.
 *
 * `publishedAt` is checked even though the access layer deliberately ignores it. That is not a
 * disagreement — `access/index.ts` says scheduling *"is a query concern belonging to the page that
 * renders the listing"*, and a homepage is a listing. A campaign dated next Tuesday must not lead
 * the site today.
 *
 * ### Two rules that came out of Phase 9's audit
 *
 * **Nothing here builds a URL.** Every path comes from `documentHref`, which encodes the slug — a
 * stored `../../admin` interpolated into a template literal climbs out of its namespace.
 *
 * **Nothing here uses content as a React key.** Editors can and do duplicate headings and hrefs;
 * two navigation items at one URL shared a mega-menu panel until the audit found it. Keys are the
 * block's own id, falling back to the index.
 */

/* -------------------------------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------------------------- */

/** A resolved call to action. Deliberately the shell's type — a link is a link. */
export type HomeCta = ShellLink

/**
 * The minimum honest representation of a product on the homepage.
 *
 * `soldOut` is carried and **not rendered** in Phase 10. Plan §11.1b owns the product card's nine
 * states, and inventing the sold-out one here would be building that phase early; carrying the fact
 * costs nothing and means the tile does not have to be re-plumbed when Phase 11 arrives.
 */
export type ProductTile = {
  id: number
  name: string
  href: string
  /** Populated `Media`, or `null`. A bare id cannot be rendered and is treated as absent. */
  image: Media | null
  /** Already formatted — `"$240.00"` or `"From $95.00"`. Never `null`: a product without one is dropped. */
  priceLabel: string
  soldOut: boolean
}

/**
 * A Lexical document, deliberately opaque.
 *
 * Typing it properly would drag `@payloadcms/richtext-lexical` into a module whose whole point is
 * that a CLI can import it with no framework and no server. `Prose` narrows it at the render
 * boundary, which is the only place that knows what to do with it.
 */
export type RichTextValue = unknown

export type HomeHero = {
  type: 'hero'
  /**
   * `h1` for the first surviving hero, `h2` for any after it.
   *
   * Computed here rather than in the component because nothing stops an editor adding a second
   * campaign hero — the block's own plural label is "Campaign heroes" — and two `<h1>`s is a WCAG
   * 1.3.1 heading-structure failure that axe does **not** report, because `page-has-heading-one`
   * only requires *at least* one. Phase 10's audit found exactly that.
   */
  headingLevel: 'h1' | 'h2'
  season: null | string
  headline: string
  story: RichTextValue
  media: Media | null
  mobileMedia: Media | null
  primary: HomeCta | null
  secondary: HomeCta | null
}

export type HomePromoStrip = {
  type: 'promoStrip'
  items: { text: string; link: HomeCta | null }[]
}

export type HomeCategoryTiles = {
  type: 'categoryTiles'
  heading: null | string
  tiles: { name: string; href: string; image: Media | null }[]
}

/** Both `productRail` (a query) and `productGroup` (a curation) normalise to this. */
export type HomeProductRail = {
  type: 'productRail'
  heading: null | string
  intro: null | string
  layout: 'grid' | 'rail'
  cta: HomeCta | null
  products: ProductTile[]
}

export type HomeCollectionFeature = {
  type: 'collectionFeature'
  eyebrow: null | string
  title: string
  body: null | string
  media: Media | null
  mobileMedia: Media | null
  cta: HomeCta
}

export type HomeSocialGallery = {
  type: 'socialGallery'
  heading: null | string
  items: { image: Media; handle: null | string; link: HomeCta | null }[]
}

export type HomeFigure = {
  type: 'figure'
  media: Media
  mobileMedia: Media | null
  treatment: 'contained' | 'fullBleed'
  caption: null | string
  cta: HomeCta | null
}

export type HomeSplitFeature = {
  type: 'splitFeature'
  media: Media
  imageSide: 'left' | 'right'
  eyebrow: null | string
  heading: null | string
  body: RichTextValue
  cta: HomeCta | null
}

export type HomeEditorial = {
  type: 'editorial'
  eyebrow: null | string
  heading: null | string
  body: RichTextValue
  width: 'narrow' | 'wide'
  cta: HomeCta | null
}

export type HomeShopTheLook = {
  type: 'shopTheLook'
  media: Media
  heading: null | string
  hotspots: {
    x: number
    y: number
    xMobile: number
    yMobile: number
    tone: 'light' | 'dark'
    label: null | string
    product: ProductTile
  }[]
}

export type HomeBody =
  | HomeCategoryTiles
  | HomeCollectionFeature
  | HomeEditorial
  | HomeFigure
  | HomeHero
  | HomeProductRail
  | HomePromoStrip
  | HomeShopTheLook
  | HomeSocialGallery
  | HomeSplitFeature

/**
 * A resolved section.
 *
 * `lcp` and `key` are computed here rather than in a component so that both are testable without a
 * browser — the same reasoning that put every navigation rule in `navigation/resolve.ts`.
 */
export type HomeSection = HomeBody & {
  key: string
  /**
   * The one image on the page that gets `fetchpriority="high"`. Plan §10.1d: *"Proper priority only
   * for the main hero/LCP image."*
   *
   * It is **not** `index === 0`. A homepage that opens with a promise strip has no image in its
   * first section, and priority must follow the picture rather than the position.
   */
  lcp: boolean
}

/**
 * One resolved section, narrowed to a single block type.
 *
 * Renderers take `SectionOf<'hero'>` rather than `HomeHero` so that `key` and `lcp` — which the
 * resolver computes and a component must not — travel with the model instead of being extra props
 * a caller can forget to pass.
 */
export type SectionOf<T extends HomeBody['type']> = Extract<HomeSection, { type: T }>

export type HomeContent = {
  sections: HomeSection[]
  /**
   * At least one hero survived, so a section carries the page's `<h1>`.
   *
   * When it is `false` — an empty homepage, or every hero dropped — `page.tsx` supplies a visually
   * hidden `<h1>` instead, so the document outline stays valid in every reachable state. The
   * *upper* bound is enforced separately, by `HomeHero.headingLevel`: a boolean can say "at least
   * one" and cannot say "exactly one", which is how two `<h1>`s got past this in the first place.
   */
  hasHeading: boolean
  /** The globals could not be read. Never rendered; it exists so an operator can tell this from an
   *  editor who simply emptied the page. Same contract as `Shell.degraded`. */
  degraded: boolean
}

export type RailSource = 'bestSellers' | 'featured' | 'limited' | 'new'

/* -------------------------------------------------------------------------------------------------
 * Rail sourcing
 * ---------------------------------------------------------------------------------------------- */

/**
 * The `productRail` block's four sources, mapped onto the four boolean columns Phase 6 shipped.
 *
 * A `Record` typed on the union rather than a lookup with a fallback: adding a fifth option to the
 * block without adding it here is a compile error, which is the only way these two lists stay in
 * step.
 */
export const RAIL_FLAG: Record<
  RailSource,
  'featured' | 'isBestSeller' | 'isLimitedEdition' | 'isNew'
> = {
  new: 'isNew',
  bestSellers: 'isBestSeller',
  limited: 'isLimitedEdition',
  featured: 'featured',
}

/**
 * The query behind a rail.
 *
 * Built here, rather than in the loader, so that `verify-home.ts` can assert the published-state
 * clauses exist without a database. Three conditions, and each is load-bearing:
 *
 * - `status: published` — the obvious one.
 * - the `publishedAt` disjunction — a product scheduled for next week is `published` *and* must not
 *   appear yet. `exists: false` is the first branch because most products never carry a date.
 * - the merchandising flag — which is the whole difference between "New arrivals" and "Best sellers".
 *
 * Soft-deleted rows need no clause: `payload.find` excludes them unless asked for them. That is the
 * opposite of `upsert`'s `trash: true` in the seed, and the asymmetry is Payload's, not ours.
 */
export function railWhere(source: RailSource, now: string): Where {
  return {
    and: [
      { status: { equals: 'published' } },
      { or: [{ publishedAt: { exists: false } }, { publishedAt: { less_than_equal: now } }] },
      { [RAIL_FLAG[source]]: { equals: true } },
    ],
  }
}

/* -------------------------------------------------------------------------------------------------
 * Primitives
 * ---------------------------------------------------------------------------------------------- */

const text = (value: null | string | undefined): null | string => value?.trim() || null

/**
 * Does this Lexical document contain anything a reader would see?
 *
 * An editor who selects a body and deletes it does **not** leave `null` behind — Lexical stores a
 * root with one empty paragraph, which is truthy. Without this, `editorial` and `splitFeature`
 * blocks stayed on the page as a heading with an invisible gap under it, contradicting this module's
 * own drop/keep table. Found by Phase 10's audit.
 *
 * The walk is shallow-recursive over `children` and stops at the first non-empty text node, so it
 * costs nothing on a real document.
 */
function hasProseContent(value: unknown): boolean {
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') {
      return false
    }

    const { text: nodeText, children } = node as { children?: unknown[]; text?: unknown }

    if (typeof nodeText === 'string' && nodeText.trim() !== '') {
      return true
    }

    return Array.isArray(children) && children.some(walk)
  }

  return walk((value as { root?: unknown })?.root)
}

/** An `upload` or `relationship` holds a populated document or a bare id; only the first renders. */
const asDocument = <T extends object>(value: number | null | T | undefined): T | null =>
  typeof value === 'object' && value !== null ? value : null

const asMedia = (value: (number | null) | Media | undefined): Media | null =>
  asDocument<Media>(value ?? null)

/**
 * Is this document visible to the public right now?
 *
 * Deliberately a copy of the shell's rule rather than an import of it, plus one clause the shell
 * does not need: **`deletedAt`**. Products are the only linkable collection with `trash: true`, and
 * a soft-deleted product is a row that still populates, still has a slug, and must never be
 * merchandised. Categories carry no `publishedAt` at all, which is why that field is read through an
 * `in` guard rather than assumed.
 */
export function isPublicDocument(document: object): boolean {
  if ((document as { deletedAt?: unknown }).deletedAt) {
    return false
  }

  if ((document as { status?: unknown }).status !== 'published') {
    return false
  }

  if (!('publishedAt' in document)) {
    return true
  }

  const publishedAt = (document as { publishedAt?: unknown }).publishedAt

  if (typeof publishedAt !== 'string') {
    return true
  }

  const timestamp = Date.parse(publishedAt)

  // An unparseable date is not evidence of anything; the status column already said published.
  return Number.isNaN(timestamp) || timestamp <= Date.now()
}

/** A published document with a real route, or `null`. */
function documentPath(collection: string, document: object): null | string {
  if (!isPublicDocument(document)) {
    return null
  }

  const slug = (document as { slug?: unknown }).slug

  if (typeof slug !== 'string' || slug === '') {
    return null
  }

  return documentHref(collection, slug)
}

/* -------------------------------------------------------------------------------------------------
 * Products
 * ---------------------------------------------------------------------------------------------- */

/**
 * One product, or `null`.
 *
 * The `null` cases are every way a relationship can be something a customer must not see, and they
 * are checked in cost order — the cheap structural ones first, the price last.
 *
 * **A product with no purchasable price is dropped**, and that is a merchandising judgement worth
 * defending. `derived.priceFromMinor` is `null` exactly when the product has no active variant, so
 * the product cannot be bought at any price. A homepage rail is a merchandising surface; an
 * unbuyable product in it is a dead end dressed as an offer. It also keeps Phase 10 out of §11.1b's
 * sold-out card state, which is the right owner for *"you cannot have this one"*.
 *
 * A product that is merely **out of stock** is kept, with its price, and `soldOut` recorded — it is
 * still purchasable merchandise the moment stock returns, and hiding it would make the homepage
 * flicker with inventory.
 */
export function resolveProductTile(
  value: unknown,
  currency: CurrencyCode,
  locale: string,
): ProductTile | null {
  const product = asDocument<Product>(value as Product | number | null | undefined)

  if (!product) {
    return null
  }

  const href = documentPath('products', product)

  if (!href) {
    return null
  }

  const name = text(product.name)

  if (!name) {
    return null
  }

  const priceLabel = formatPriceRange(
    product.derived?.priceFromMinor,
    product.derived?.priceToMinor,
    currency,
    locale,
  )

  if (!priceLabel) {
    return null
  }

  return {
    id: product.id,
    name,
    href,
    // The first gallery image is the card image — `Products.ts` says so in the field description.
    image: asMedia(product.gallery?.[0]?.image),
    priceLabel,
    soldOut: (product.derived?.inventoryTotal ?? 0) <= 0,
  }
}

const resolveTiles = (
  values: readonly unknown[] | null | undefined,
  currency: CurrencyCode,
  locale: string,
): ProductTile[] =>
  (values ?? [])
    .map((value) => resolveProductTile(value, currency, locale))
    .filter((tile) => tile !== null)

/* -------------------------------------------------------------------------------------------------
 * Sections
 * ---------------------------------------------------------------------------------------------- */

type Section = NonNullable<Homepage['sections']>[number]

/** The products a `productRail` block asked the loader to fetch, keyed by the block's own key. */
export type RailProducts = Map<string, unknown[]>

export type ResolveHomeArgs = {
  homepage: Homepage | null | undefined
  rails: RailProducts
  currency: CurrencyCode
  locale: string
}

/**
 * One block, or `null`.
 *
 * The `switch` is exhaustive over `blockType`; a block added to `blocks/home.ts` without a case here
 * fails `tsc` at the `never` in the default branch.
 */
function resolveSection(
  section: Section,
  key: string,
  { rails, currency, locale }: Omit<ResolveHomeArgs, 'homepage'>,
): HomeBody | null {
  switch (section.blockType) {
    case 'hero': {
      const campaign = asDocument(section.campaign)

      // The campaign *is* the hero. Draft, scheduled or deleted, there is nothing to lead with.
      if (!campaign || !isPublicDocument(campaign)) {
        return null
      }

      const headline = text(campaign.title)

      if (!headline) {
        return null
      }

      return {
        type: 'hero',
        // Overwritten below, once the whole list is known — see `resolveHome`.
        headingLevel: 'h1',
        season: text(campaign.season),
        headline,
        story: hasProseContent(campaign.story) ? campaign.story : null,
        media: asMedia(campaign.hero),
        mobileMedia: asMedia(campaign.mobileHero),
        primary: resolveLink(campaign.cta),
        secondary: resolveLink(campaign.secondaryCta),
      }
    }

    case 'promoStrip': {
      const items = (section.items ?? [])
        .map((item) => ({ text: text(item.text), link: resolveLink(item.link) }))
        .filter((item): item is { text: string; link: HomeCta | null } => item.text !== null)

      return items.length > 0 ? { type: 'promoStrip', items } : null
    }

    case 'categoryTiles': {
      const tiles = (section.items ?? [])
        .map((item) => {
          const category = asDocument<Category>(item.category)
          const href = category ? documentPath('categories', category) : null

          if (!category || !href) {
            return null
          }

          const name = text(item.label) ?? text(category.name)

          return name ? { name, href, image: asMedia(item.image) ?? asMedia(category.image) } : null
        })
        .filter((tile) => tile !== null)

      return tiles.length > 0
        ? { type: 'categoryTiles', heading: text(section.heading), tiles }
        : null
    }

    case 'productRail': {
      const products = resolveTiles(rails.get(key), currency, locale)

      return products.length > 0
        ? {
            type: 'productRail',
            heading: text(section.heading),
            intro: null,
            layout: section.layout === 'rail' ? 'rail' : 'grid',
            cta: resolveLink(section.cta),
            products,
          }
        : null
    }

    case 'productGroup': {
      const products = resolveTiles(section.products, currency, locale)

      return products.length > 0
        ? {
            type: 'productRail',
            heading: text(section.heading),
            intro: text(section.intro),
            layout: section.layout === 'rail' ? 'rail' : 'grid',
            cta: null,
            products,
          }
        : null
    }

    case 'collectionFeature': {
      const collection = asDocument<Collection>(section.collection)
      const href = collection ? documentPath('collections', collection) : null

      if (!collection || !href) {
        return null
      }

      const title = text(collection.title)

      if (!title) {
        return null
      }

      /*
       * §10.1c — *"every commerce-driven editorial block should have an explicit CTA or linked
       * product/collection path."* The path is guaranteed structurally: the editor's CTA is an
       * override for the *words*, never the difference between linked and unlinked.
       */
      const cta = resolveLink(section.cta) ?? {
        label: 'View the collection',
        href,
        external: false,
      }

      return {
        type: 'collectionFeature',
        eyebrow: text(section.eyebrow),
        title,
        body: text(section.body),
        media: asMedia(section.image) ?? asMedia(collection.heroMedia),
        mobileMedia: asMedia(section.mobileImage),
        cta,
      }
    }

    case 'socialGallery': {
      const items = (section.items ?? [])
        .map((item) => {
          const image = asMedia(item.image)

          // The image is the content here; a credit with no picture is not a gallery entry.
          return image ? { image, handle: text(item.handle), link: resolveLink(item.link) } : null
        })
        .filter((item) => item !== null)

      return items.length > 0
        ? { type: 'socialGallery', heading: text(section.heading), items }
        : null
    }

    case 'figure': {
      const media = asMedia(section.image)

      return media
        ? {
            type: 'figure',
            media,
            mobileMedia: asMedia(section.mobileImage),
            treatment: section.treatment === 'fullBleed' ? 'fullBleed' : 'contained',
            caption: text(section.caption),
            cta: resolveLink(section.cta),
          }
        : null
    }

    case 'splitFeature': {
      const media = asMedia(section.image)

      if (!media) {
        return null
      }

      const heading = text(section.heading)
      const body = hasProseContent(section.body) ? section.body : null

      // An image with no words is a `figure`, and the editor has that block.
      if (!heading && !body) {
        return null
      }

      return {
        type: 'splitFeature',
        media,
        imageSide: section.imageSide === 'right' ? 'right' : 'left',
        eyebrow: text(section.eyebrow),
        heading,
        body,
        cta: resolveLink(section.cta),
      }
    }

    case 'editorial': {
      const heading = text(section.heading)
      const body = hasProseContent(section.body) ? section.body : null

      if (!heading && !body) {
        return null
      }

      return {
        type: 'editorial',
        eyebrow: text(section.eyebrow),
        heading,
        body,
        width: section.width === 'wide' ? 'wide' : 'narrow',
        cta: resolveLink(section.cta),
      }
    }

    case 'shopTheLook': {
      const media = asMedia(section.image)

      if (!media) {
        return null
      }

      const hotspots = (section.hotspots ?? [])
        .map((hotspot) => {
          const product = resolveProductTile(hotspot.product, currency, locale)

          /*
           * Coordinates are percentages of the rendered box and `0` is a legitimate one, so this
           * tests for a number rather than for truthiness. A hotspot missing them would sit in the
           * top-left corner of the photograph pointing at nothing.
           */
          const coordinates = [hotspot.xDesktop, hotspot.yDesktop, hotspot.xMobile, hotspot.yMobile]

          if (!product || !coordinates.every((n) => typeof n === 'number' && Number.isFinite(n))) {
            return null
          }

          return {
            x: hotspot.xDesktop,
            y: hotspot.yDesktop,
            xMobile: hotspot.xMobile,
            yMobile: hotspot.yMobile,
            tone: hotspot.markerTone === 'dark' ? ('dark' as const) : ('light' as const),
            label: text(hotspot.label),
            product,
          }
        })
        .filter((hotspot) => hotspot !== null)

      return hotspots.length > 0
        ? { type: 'shopTheLook', media, heading: text(section.heading), hotspots }
        : null
    }

    default:
      return unknownSection(section)
  }
}

/**
 * Compile-time exhaustiveness, runtime silence.
 *
 * The `never` parameter is what makes `tsc` fail when a block is added to `blocks/home.ts` and not
 * handled above. Returning `null` rather than throwing is deliberate: one block type this build does
 * not recognise — a row written by a newer deployment, a rollback mid-migration — must cost that
 * section, not the homepage.
 */
function unknownSection(section: never): null {
  console.error('[home] Unhandled section type', (section as { blockType?: unknown })?.blockType)

  return null
}

/** Does this section carry an image that could be the largest contentful paint? */
function hasMedia(section: HomeBody): boolean {
  switch (section.type) {
    case 'hero':
    case 'collectionFeature':
      // Either frame is a picture. A hero given only a mobile crop still paints one full-bleed.
      return section.media !== null || section.mobileMedia !== null
    case 'figure':
    case 'splitFeature':
    case 'shopTheLook':
      return true
    /*
     * The *first* tile, not `.some()`. The renderers pass `priority` to index 0 only, so a section
     * whose first tile is a placeholder and whose third has a photograph would claim the page's one
     * priority hint and then spend it on an empty box. The two must ask the same question.
     */
    case 'categoryTiles':
      return section.tiles[0]?.image != null
    case 'productRail':
      return section.products[0]?.image != null
    case 'socialGallery':
      // `items[].image` is required by the resolver, so the first tile always has one.
      return true
    case 'promoStrip':
    case 'editorial':
      return false
  }
}

/**
 * The whole homepage, resolved.
 *
 * Order is the editor's, preserved exactly — array order is the only ordering the schema has, and
 * re-sorting a composition would take an editorial decision away from the person who made it.
 */
export function resolveHome({ homepage, rails, currency, locale }: ResolveHomeArgs): HomeContent {
  const resolved: HomeSection[] = []

  ;(homepage?.sections ?? []).forEach((section, index) => {
    // Never a heading or an href — editors duplicate both. Phase 9's audit, finding 4.
    const key = section.id ?? String(index)
    const body = resolveSection(section, key, { rails, currency, locale })

    if (body) {
      resolved.push({ ...body, key, lcp: false })
    }
  })

  const lcpIndex = resolved.findIndex((section) => hasMedia(section))

  if (lcpIndex >= 0) {
    resolved[lcpIndex] = { ...resolved[lcpIndex]!, lcp: true }
  }

  /*
   * Exactly one `<h1>`, guaranteed here rather than hoped for in a component.
   *
   * The first surviving hero keeps `h1`; every hero after it is demoted. Nothing in the schema stops
   * an editor adding a second one, and two `<h1>`s is a heading-structure failure that axe cannot
   * see — `page-has-heading-one` is satisfied by the first.
   */
  let heroSeen = false

  for (const [index, section] of resolved.entries()) {
    if (section.type !== 'hero') {
      continue
    }

    resolved[index] = { ...section, headingLevel: heroSeen ? 'h2' : 'h1' }
    heroSeen = true
  }

  return {
    sections: resolved,
    hasHeading: heroSeen,
    degraded: false,
  }
}

/** What the page renders when the global cannot be read, and when an editor has emptied it. */
export const EMPTY_HOME: HomeContent = { sections: [], hasHeading: false, degraded: false }

/**
 * The keys of the `productRail` blocks in a homepage record, in order, with the query each needs.
 *
 * Exported so the loader can issue the queries and `verify-home.ts` can assert the pairing without
 * a database. The key is computed identically to `resolveHome`'s, which is what makes
 * `rails.get(key)` line up.
 */
export function railRequests(
  homepage: Homepage | null | undefined,
): { key: string; limit: number; source: RailSource }[] {
  const requests: { key: string; limit: number; source: RailSource }[] = []

  ;(homepage?.sections ?? []).forEach((section, index) => {
    if (section.blockType !== 'productRail') {
      return
    }

    requests.push({
      key: section.id ?? String(index),
      /*
       * The block's `min`/`max` bound the field; this bounds a row written before they existed —
       * and `Math.trunc` is not decoration. A stored `4.5` survives a clamp unchanged and reaches
       * Postgres as `LIMIT 4.5`, which is a syntax error that rejects the whole rail query.
       */
      limit: Math.min(Math.max(Math.trunc(section.limit ?? 4) || 4, 1), 12),
      source: section.source,
    })
  })

  return requests
}
