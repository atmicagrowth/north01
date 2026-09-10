import type { Metadata } from 'next'

import { notFound } from 'next/navigation'

import { CatalogPage } from '@/components/catalog/catalog-page'
import { getShopCategory } from '@/lib/catalog/catalog'
import { loadCatalogParams } from '@/lib/catalog/params'
import { privateMetadata } from '@/lib/seo/metadata'
import { pageMetadata } from '@/lib/seo/site'

/**
 * **`/shop/<category>` — the route `lib/navigation/routes.ts` has been pointing at since Phase 9.**
 *
 * `documentHref('categories', slug)` returns `/shop/<slug>`, and until now every one of those links
 * 404'd. Phase 10's notes list it first among what was owed: *"every commerce destination on this
 * page 404s — `/shop/<slug>` (Phase 11)."* This closes it, and with it every category link in the
 * mega menu, the mobile navigation, the footer and the homepage's category tiles.
 *
 * ### The 404 is a real 404, and the unknown *filter* is not
 *
 * An unrecognised slug in the **path** means this page does not exist, so `notFound()` — the global
 * 404 decision **D-31** put inside the shell, not a blank document. An unrecognised value in
 * `?category=` means something else entirely: plan §11.1d's *"URL contains unknown category"*, which
 * `normaliseCatalogQuery` drops and the toolbar reports. Same bad slug, two right answers, decided
 * by where it appeared.
 *
 * A **draft** category is a 404 too, and gets there without a status check here: `getShopCategory`
 * reads through the ordinary access rules, where `publishedOnly` returns a `Where` rather than a
 * refusal, so a draft is *absent* rather than forbidden. `Categories.ts` chose that shape for
 * exactly this route.
 *
 * ### The listing includes descendants
 *
 * `/shop/clothing` shows everything under Clothing, not only the products somebody remembered to tag
 * *Clothing* as well as *Hoodies*. `expandCategory` widens the slug to its subtree for the Postgres
 * engine, and `withAncestors` stores the widened form in the search index, so both engines answer
 * the same question. `verify:catalog` asserts they agree.
 */
/**
 * §24.1a, from the category document. `getShopCategory` is React-`cache`d by slug, so this and the
 * render are one query.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const { category: slug } = await params
  const category = await getShopCategory(slug)

  if (!category) {
    return privateMetadata('Not found')
  }

  return pageMetadata({
    description: category.description,
    image: category.image,
    path: `/shop/${category.slug}`,
    seo: category.seo,
    title: category.name,
  })
}

export default async function ShopCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ category: slug }, catalogParams] = await Promise.all([
    params,
    loadCatalogParams(searchParams),
  ])

  const category = await getShopCategory(slug)

  if (!category) {
    notFound()
  }

  return (
    <CatalogPage
      basePath={`/shop/${category.slug}`}
      eyebrow="Shop"
      lede={category.description}
      params={catalogParams}
      routeCategory={category.slug}
      title={category.name}
    />
  )
}
