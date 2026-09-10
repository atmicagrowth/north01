import 'server-only'

import { cache } from 'react'

import type { ProductCard } from '@/lib/catalog/resolve'
import type { EditorialSection } from './resolve'
import type { Collection, Edit, Journal, Lookbook, Media } from '@/payload-types'

import { getCatalogSettings } from '@/lib/catalog/catalog'
import { publishedProductWhere } from '@/lib/catalog/query'
import { resolveProductCards } from '@/lib/catalog/resolve'
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
    featured: products.slice(0, FEATURED_COUNT),
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
   * The groups are resolved in series rather than in parallel: they are few, and each one's product
   * query is bounded by its own list.
   */
  const groups: EditView['groups'] = []

  for (const group of edit.productGroups ?? []) {
    const products = await readProductCards(relatedIds(group.products))

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
