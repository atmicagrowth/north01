import type { Metadata } from 'next'

import { notFound } from 'next/navigation'

import { CollectionPage } from '@/components/editorial/collection-page'
import { getCollectionPage } from '@/lib/editorial/read'
import { privateMetadata } from '@/lib/seo/metadata'
import { pageMetadata } from '@/lib/seo/site'

/**
 * **`/collections/[slug]`** — plan §23.1a, with plan §24.1a's metadata.
 *
 * A thin adapter, like every other document-backed route in this project: resolve, `notFound()` on
 * null, and hand the whole thing to one component. The route file holds no markup.
 *
 * **A draft is a 404 and gets there without a status check.** The read runs under
 * `overrideAccess: false, user: null`, so `publishedOnly` narrows it with a `Where` — an unpublished
 * collection is simply absent. `shop/[category]` established that, and the reason is that a URL must
 * not be usable to discover unreleased work.
 *
 * ### `generateMetadata` calls the same reader as the page, on purpose
 *
 * `getCollectionPage` is wrapped in React's `cache`, so the two calls in one request are **one
 * query**. That is not merely an optimisation: reading the document twice through two different
 * queries is how a `<title>` ends up describing a page that 404'd, because the two reads can
 * disagree about publication state in the moment an editor unpublishes.
 *
 * A missing document returns bare metadata rather than throwing. `generateMetadata` runs beside the
 * page, not before it, and an exception here would replace the page's honest 404 with a 500.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const collection = await getCollectionPage(slug)

  if (!collection) {
    return privateMetadata('Not found')
  }

  return pageMetadata({
    description: collection.description,
    image: collection.heroMedia ?? collection.introMedia,
    path: `/collections/${slug}`,
    seo: collection.seo,
    title: collection.title,
  })
}

export default async function CollectionRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const collection = await getCollectionPage(slug)

  if (!collection) {
    notFound()
  }

  return <CollectionPage collection={collection} />
}
