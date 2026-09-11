import 'server-only'

import { cache } from 'react'

import type { ProductCard } from '@/lib/catalog/resolve'
import type { EditorialSection } from './resolve'
import type { Collection, Edit, Journal, Lookbook, Media } from '@/payload-types'

import { getCatalogSettings } from '@/lib/catalog/catalog'
import { publishedProductWhere } from '@/lib/catalog/query'
import { PRODUCT_CARD_POPULATE, resolveProductCards } from '@/lib/catalog/resolve'
import { getPayloadClient } from '@/lib/payload'
import { documentSeo, type DocumentSeo } from '@/lib/seo/document'
import { resolveEditorialBody } from './resolve'

/**
 * **Reading the four editorial document types** — plan §23.1a, §23.1b and §23.1c.
 *
 * `server-only`, and unlike most of this project's read modules that is the *right* place for the
 * guard rather than a compromise: these reach for their own Payload client, are imported only from
 * route components, and hold no decision a harness would want to drive. The decisions are in
 * `resolve.ts`, which is unguarded and is where `pnpm verify:editorial` points.
 *
 * ---
 *
 * ### A draft is *absent*, not forbidden
 *
 * Every read runs under `overrideAccess: false, user: null`, so `publishedOnly` narrows it with a
 * `Where` rather than refusing. An unpublished collection comes back as `null` and the route calls
 * `notFound()` — no status check anywhere in a page. `shop/[category]` established the pattern and
 * the reason: *"a draft is absent rather than forbidden"*, so a URL cannot be used to discover
 * unreleased work.
 *
 * ### Products are never read through the relationship at depth
 *
 * `collections.products` populated at `depth: 2` would look like it saves a query, and would show
 * scheduled drops and withdrawn garments: `Products.access.read` is `publishedOnly`, which checks
 * `status` and explicitly **not** `publishedAt`, and knows nothing about `derived.priceFromMinor`,
 * the rule that withdraws a product with no active variant. Only `publishedProductWhere(now)` applies
 * all three, and it only applies on a `find` against `products`.
 *
 * So membership is read as an ordered list of ids at `depth: 0`, and the products are a second query.
 * That is the same shape `readRecentlyViewedCards` uses, including the re-sort: an `id IN (…)` query
 * returns rows in the database's order, not the list's, and on a collection the list order **is the
 * curation** — `Collections.ts` says so: *"dragging a row is the curation."*
 */

const STOREFRONT_ACCESS = { overrideAccess: false, user: null } as const

/** A populated `Media`, or `null`. A bare id cannot be rendered. */
const asMedia = (value: unknown): Media | null =>
  typeof value === 'object' && value !== null && 'url' in value ? (value as Media) : null

const relatedIds = (values: unknown): number[] =>
  Array.isArray(values)
    ? values
        .map((value) =>
          typeof value === 'number'
            ? value
            : typeof value === 'object' && value && 'id' in value
              ? Number((value as { id: number }).id)
              : Number.NaN,
        )
        .filter((id) => Number.isSafeInteger(id) && id > 0)
    : []

/**
 * Resolve an ordered list of product ids into cards, keeping the order.
 *
 * Exported because a Collection page, an Edit page's product groups and a Journal article's related
 * products all need exactly this, and three copies would be three chances to forget the re-sort.
 */
export async function readProductCards(ids: readonly number[]): Promise<ProductCard[]> {
  const wanted = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))]

  if (wanted.length === 0) {
    return []
  }

  const [payload, settings] = await Promise.all([getPayloadClient(), getCatalogSettings()])

  const { docs } = await payload.find({
    collection: 'products',
    depth: 1,
    // Neither join field is read — see `PRODUCT_CARD_POPULATE` in `lib/catalog/resolve.ts`.
    joins: false,
    limit: wanted.length,
    ...STOREFRONT_ACCESS,
    where: { and: [...publishedProductWhere(new Date().toISOString()), { id: { in: wanted } }] },
  })

  const cards = resolveProductCards(
    docs,
    settings.currency,
    settings.locale,
    settings.lowStockThreshold,
  )
  const byId = new Map(cards.map((card) => [card.id, card]))

  /* The curator's order, not the database's. */
  return wanted.map((id) => byId.get(id)).filter((card): card is ProductCard => card !== undefined)
}

/* -------------------------------------------------------------------------------------------------
 * §23.1a — collections
 * ---------------------------------------------------------------------------------------------- */

export type CollectionView = {
  body: EditorialSection[]
  description: unknown
  /** §23.1a's "featured products" — see the note on `getCollectionPage`. */
  featured: ProductCard[]
  heroMedia: Media | null
  introMedia: Media | null
  products: ProductCard[]
  related: { href: string; title: string }[]
  /** `seoField()`'s overrides — Phase 24 reads them; nothing did before. */
  seo: DocumentSeo
  title: string
}

const FEATURED_COUNT = 4

export const getCollectionPage = cache(async (slug: string): Promise<CollectionView | null> => {
  const [payload, settings] = await Promise.all([getPayloadClient(), getCatalogSettings()])

  const { docs } = await payload.find({
    collection: 'collections',
    depth: 2,
    limit: 1,
    /*
     * Products arrive here populated — through the list, a block, or a hotspot — and a card reads
     * six of their fields. Without this each one also carries both of its joins; see
     * `PRODUCT_CARD_POPULATE`.
     */
    populate: { products: PRODUCT_CARD_POPULATE },
    ...STOREFRONT_ACCESS,
    where: { slug: { equals: slug } },
  })

  const collection = docs[0] as Collection | undefined

  if (!collection) {
    return null
  }

  const productIds = relatedIds(collection.products)
  const products = await readProductCards(productIds)

  return {
    body: resolveEditorialBody(collection.body, {
      currency: settings.currency,
      locale: settings.locale,
    }),
    description: collection.description ?? null,
    /*
     * **§23.1a's "featured products", taken as the first four of the ordered list.**
     *
     * There is no `featuredProducts` field, and adding one would be a schema change — a generated,
     * committed migration and a deviation. It would also duplicate a decision the editor has already
     * made: `Collections.products` is explicitly ordered, and its own field description says *"an
     * order is a property of the list"* and *"dragging a row is the curation."* The front of a
     * curated list is what featured means.
     *
     * Resolved from the SAME cards as the grid rather than by a second query, so the two can never
     * disagree about whether something is published.
     */
    featured: products.length > FEATURED_COUNT ? products.slice(0, FEATURED_COUNT) : [],
    heroMedia: asMedia(collection.heroMedia),
    introMedia: asMedia(collection.introMedia),
    products,
    related: (collection.relatedCollections ?? [])
      .map((value) =>
        typeof value === 'object' && value && 'slug' in value && 'title' in value
          ? { href: `/collections/${String(value.slug)}`, title: String(value.title) }
          : null,
      )
      .filter((entry): entry is { href: string; title: string } => entry !== null),
    seo: documentSeo(collection.seo),
    title: String(collection.title),
  }
})

/* -------------------------------------------------------------------------------------------------
 * §23.1b — edits
 * ---------------------------------------------------------------------------------------------- */

export type EditView = {
  body: EditorialSection[]
  groups: { intro: null | string; products: ProductCard[]; title: string }[]
  hero: Media | null
  intro: unknown
  lookbooks: { href: string; title: string }[]
  seo: DocumentSeo
  title: string
}

export const getEditPage = cache(async (slug: string): Promise<EditView | null> => {
  const [payload, settings] = await Promise.all([getPayloadClient(), getCatalogSettings()])

  const { docs } = await payload.find({
    collection: 'edits',
    depth: 2,
    limit: 1,
    /*
     * Products arrive here populated — through the list, a block, or a hotspot — and a card reads
     * six of their fields. Without this each one also carries both of its joins; see
     * `PRODUCT_CARD_POPULATE`.
     */
    populate: { products: PRODUCT_CARD_POPULATE },
    ...STOREFRONT_ACCESS,
    where: { slug: { equals: slug } },
  })

  const edit = docs[0] as Edit | undefined

  if (!edit) {
    return null
  }

  /*
   * §23.1b's four questions — *"what is this edit? why should I care? what products belong here?
   * where do I shop?"* — map onto the fields the collection already has: the title and the hero
   * answer the first, the intro the second, the captioned product groups the third, and every group
   * is itself a way to shop, which is the fourth.
   *
   * **One query for every group, not one per group.** These were resolved in series, with a comment
   * reasoning that groups are few — true, and on a database a round trip away it is also the whole
   * cost: each group was a full query waiting on the one before it, and `/edit/cold` spent 1.45s
   * before its first byte. The union goes out once and each group takes its own products back out
   * of it, in its own curated order.
   *
   * Nothing about the rules changes. `readProductCards` still applies `publishedProductWhere` to
   * every id, so a withdrawn product is absent from whichever groups named it, and each group's list
   * is de-duplicated exactly as the per-group call de-duplicated it.
   */
  const productGroups = edit.productGroups ?? []
  const cards = await readProductCards(productGroups.flatMap((group) => relatedIds(group.products)))
  const cardsById = new Map(cards.map((card) => [card.id, card]))

  const groups: EditView['groups'] = []

  for (const group of productGroups) {
    const products = [...new Set(relatedIds(group.products))]
      .map((id) => cardsById.get(id))
      .filter((card): card is ProductCard => card !== undefined)

    /* A captioned set with nothing left in it is a caption. The prompt's "empty product
     * relationships", answered by omission rather than by an empty row. */
    if (products.length > 0) {
      groups.push({
        intro: typeof group.intro === 'string' && group.intro.length > 0 ? group.intro : null,
        products,
        title: String(group.title),
      })
    }
  }

  return {
    body: resolveEditorialBody(edit.body, { currency: settings.currency, locale: settings.locale }),
    groups,
    hero: asMedia(edit.hero),
    intro: edit.intro ?? null,
    lookbooks: (edit.lookbooks ?? [])
      .map((value) =>
        typeof value === 'object' && value && 'slug' in value && 'title' in value
          ? { href: `/lookbook/${String(value.slug)}`, title: String(value.title) }
          : null,
      )
      .filter((entry): entry is { href: string; title: string } => entry !== null),
    seo: documentSeo(edit.seo),
    title: String(edit.title),
  }
})

/* -------------------------------------------------------------------------------------------------
 * Lookbooks — the route Phase 22 deliberately left
 * ---------------------------------------------------------------------------------------------- */

export type LookbookView = {
  /** The index-page cover, which is also the best social card a season has. */
  cover: Media | null
  chapters: {
    editorialText: unknown
    gallery: { caption: null | string; media: Media }[]
    heroImage: Media | null
    hotspots: Extract<EditorialSection, { type: 'shopTheLook' }>['hotspots']
    title: string
  }[]
  intro: unknown
  season: null | string
  seo: DocumentSeo
  title: string
}

export const getLookbook = cache(async (slug: string): Promise<LookbookView | null> => {
  const [payload, settings] = await Promise.all([getPayloadClient(), getCatalogSettings()])

  const { docs } = await payload.find({
    collection: 'lookbooks',
    depth: 2,
    limit: 1,
    /*
     * Products arrive here populated — through the list, a block, or a hotspot — and a card reads
     * six of their fields. Without this each one also carries both of its joins; see
     * `PRODUCT_CARD_POPULATE`.
     */
    populate: { products: PRODUCT_CARD_POPULATE },
    ...STOREFRONT_ACCESS,
    where: { slug: { equals: slug } },
  })

  const lookbook = docs[0] as Lookbook | undefined

  if (!lookbook) {
    return null
  }

  /*
   * A chapter's hotspots go through the same resolution the `shopTheLook` block does, by borrowing
   * that case: the chapter carries an image and a hotspot array, which is exactly a `shopTheLook`
   * block wearing different field names. Doing it any other way would have been a second
   * implementation of §22.1b's "hide the hotspot" rule, and two implementations of a rule is one too
   * many.
   */
  const { resolveEditorialSection } = await import('./resolve')

  return {
    chapters: (lookbook.chapters ?? []).map((chapter, index) => {
      const resolved = resolveEditorialSection(
        {
          blockType: 'shopTheLook',
          heading: null,
          hotspots: chapter.hotspots ?? [],
          image: chapter.heroImage,
        } as never,
        index,
        { currency: settings.currency, locale: settings.locale },
      )

      return {
        editorialText: chapter.editorialText ?? null,
        gallery: (chapter.gallery ?? [])
          .map((row) => {
            const media = asMedia(row.image)

            return media
              ? {
                  caption:
                    typeof row.caption === 'string' && row.caption.length > 0 ? row.caption : null,
                  media,
                }
              : null
          })
          .filter((row): row is { caption: null | string; media: Media } => row !== null),
        heroImage: asMedia(chapter.heroImage),
        hotspots: resolved?.type === 'shopTheLook' ? resolved.hotspots : [],
        title: String(chapter.title),
      }
    }),
    cover: asMedia(lookbook.coverImage),
    intro: lookbook.intro ?? null,
    season:
      typeof lookbook.season === 'string' && lookbook.season.length > 0 ? lookbook.season : null,
    seo: documentSeo(lookbook.seo),
    title: String(lookbook.title),
  }
})

export type LookbookCard = {
  coverImage: Media | null
  href: string
  season: null | string
  title: string
}

export const getLookbookIndex = cache(async (): Promise<LookbookCard[]> => {
  const payload = await getPayloadClient()

  const { docs } = await payload.find({
    collection: 'lookbooks',
    depth: 1,
    limit: 50,
    sort: '-publishedAt',
    ...STOREFRONT_ACCESS,
  })

  return docs.map((lookbook) => ({
    coverImage: asMedia(lookbook.coverImage),
    href: `/lookbook/${String(lookbook.slug)}`,
    season:
      typeof lookbook.season === 'string' && lookbook.season.length > 0 ? lookbook.season : null,
    title: String(lookbook.title),
  }))
})

/* -------------------------------------------------------------------------------------------------
 * §23.1c — journal
 * ---------------------------------------------------------------------------------------------- */

export type JournalCard = {
  category: null | string
  excerpt: null | string
  heroImage: Media | null
  href: string
  publishedAt: null | string
  title: string
}

export type JournalView = JournalCard & {
  author: null | string
  body: unknown
  seo: DocumentSeo
  relatedArticles: JournalCard[]
  relatedCollections: { href: string; title: string }[]
  relatedProducts: ProductCard[]
}

const toCard = (article: Journal): JournalCard => ({
  category: typeof article.category === 'string' ? article.category : null,
  excerpt:
    typeof article.excerpt === 'string' && article.excerpt.length > 0 ? article.excerpt : null,
  heroImage: asMedia(article.heroImage),
  href: `/journal/${String(article.slug)}`,
  publishedAt: typeof article.publishedAt === 'string' ? article.publishedAt : null,
  title: String(article.title),
})

export const getJournalIndex = cache(async (): Promise<JournalCard[]> => {
  const payload = await getPayloadClient()

  const { docs } = await payload.find({
    collection: 'journal',
    depth: 1,
    limit: 50,
    sort: '-publishedAt',
    ...STOREFRONT_ACCESS,
  })

  return docs.map((article) => toCard(article as Journal))
})

export const getJournalArticle = cache(async (slug: string): Promise<JournalView | null> => {
  const payload = await getPayloadClient()

  const { docs } = await payload.find({
    collection: 'journal',
    depth: 2,
    limit: 1,
    /*
     * Products arrive here populated — through the list, a block, or a hotspot — and a card reads
     * six of their fields. Without this each one also carries both of its joins; see
     * `PRODUCT_CARD_POPULATE`.
     */
    populate: { products: PRODUCT_CARD_POPULATE },
    ...STOREFRONT_ACCESS,
    where: { slug: { equals: slug } },
  })

  const article = docs[0] as Journal | undefined

  if (!article) {
    return null
  }

  /*
   * **§23.1c: *"avoid creating an editorial dead end."***
   *
   * The three related lists are the whole of that instruction, and they are resolved through the
   * same published rules as everything else — so a related product that has been withdrawn simply is
   * not offered, rather than being a link to a 404. The prompt names it: *"deleted related products
   * without broken pages."*
   */
  const relatedProducts = await readProductCards(relatedIds(article.relatedProducts))

  return {
    ...toCard(article),
    author: typeof article.author === 'string' && article.author.length > 0 ? article.author : null,
    body: article.body ?? null,
    seo: documentSeo(article.seo),
    relatedArticles: (article.relatedArticles ?? [])
      .map((value) =>
        typeof value === 'object' && value && 'slug' in value ? toCard(value as Journal) : null,
      )
      .filter((card): card is JournalCard => card !== null),
    relatedCollections: (article.relatedCollections ?? [])
      .map((value) =>
        typeof value === 'object' && value && 'slug' in value && 'title' in value
          ? { href: `/collections/${String(value.slug)}`, title: String(value.title) }
          : null,
      )
      .filter((entry): entry is { href: string; title: string } => entry !== null),
    relatedProducts,
  }
})

/* -------------------------------------------------------------------------------------------------
 * The two index pages — Phase 30
 * ---------------------------------------------------------------------------------------------- */

export type EditorialCard = {
  description: null | string
  heroImage: Media | null
  href: string
  title: string
}

/**
 * **`/collections` and `/edit`, which the header has linked to since Phase 9 and which did not
 * exist.**
 *
 * Phase 23 built the *detail* pages and recorded both indexes as owed; Phase 28's audit repeated it;
 * Phase 30's responsive pass finally asked the browser for every navigation href and got a 404 from
 * each. A link in the primary navigation that answers 404 is §0.1.17's fake control on the surface
 * that appears on every page of the shop.
 *
 * One reader for both, because the two collections differ in their *detail* pages and not in what an
 * index needs: a title, a line of description, a cover and a link. Two near-identical readers would
 * be two places to fix the same publication rule.
 *
 * Published only, through `STOREFRONT_ACCESS` — the same narrowing every other read here uses, so a
 * draft is absent rather than forbidden and a URL cannot enumerate unreleased work.
 */
const indexOf = async (
  collection: 'collections' | 'edits',
  prefix: string,
): Promise<EditorialCard[]> => {
  const payload = await getPayloadClient()

  /*
   * **Only the four fields a card shows.** Without a `select`, `depth: 1` also populated every member
   * product of every collection, every related collection, and every edit's product groups and
   * lookbooks — measured by sweep 1 at 86,576 bytes for `/api/collections` against 4,905 with this
   * select, and roughly twice the time. `depth: 1` stays, so the cover still arrives as a media record.
   *
   * **And no `.catch`.** This shipped turning a failed read into `docs: []`, which the index renders as
   * *"No collections are published yet."* — a false statement about the catalogue, made on the one
   * occasion the page cannot know it. `getLookbookIndex` and `getJournalIndex` let the error reach the
   * boundary; so does this. What that boundary says is Phase 31's.
   */
  const { docs } = await payload.find({
    collection,
    depth: 1,
    limit: 100,
    select:
      collection === 'collections'
        ? { description: true, heroMedia: true, slug: true, title: true }
        : { hero: true, intro: true, slug: true, title: true },
    sort: 'title',
    ...STOREFRONT_ACCESS,
  })

  return (docs as unknown as Record<string, unknown>[])
    .filter((doc) => typeof doc.slug === 'string' && doc.slug.length > 0)
    .map((doc) => ({
      /*
       * A collection's `description` is rich text and an edit's `intro` is too, so both are
       * flattened to a sentence rather than rendered — an index is a list, not a page.
       */
      description: trimIndexText(collection === 'collections' ? doc.description : doc.intro),
      heroImage: asMedia(collection === 'collections' ? doc.heroMedia : doc.hero),
      href: `${prefix}/${String(doc.slug)}`,
      title: String(doc.title),
    }))
}

/** The first sentence or so of a rich-text field, for a card. `null` when there is nothing. */
function trimIndexText(value: unknown): null | string {
  const parts: string[] = []

  const walk = (node: unknown): void => {
    if (parts.join(' ').length > 200 || node === null || typeof node !== 'object') return

    if (Array.isArray(node)) {
      for (const child of node) walk(child)

      return
    }

    const record = node as { children?: unknown; root?: unknown; text?: unknown }

    if (typeof record.text === 'string' && record.text.length > 0) parts.push(record.text)
    if (record.root !== undefined) walk(record.root)
    if (Array.isArray(record.children)) walk(record.children)
  }

  walk(value)

  const text = parts.join(' ').replace(/\s+/g, ' ').trim()

  if (text.length === 0) return null

  return text.length <= 160 ? text : `${text.slice(0, text.lastIndexOf(' ', 160)).trim()}…`
}

export const getCollectionIndex = cache(async (): Promise<EditorialCard[]> =>
  indexOf('collections', '/collections'),
)

export const getEditIndex = cache(async (): Promise<EditorialCard[]> => indexOf('edits', '/edit'))
