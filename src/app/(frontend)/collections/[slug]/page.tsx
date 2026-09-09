import { notFound } from 'next/navigation'

import { CollectionPage } from '@/components/editorial/collection-page'
import { getCollectionPage } from '@/lib/editorial/read'

/**
 * **`/collections/[slug]`** — plan §23.1a.
 *
 * A thin adapter, like every other document-backed route in this project: resolve, `notFound()` on
 * null, and hand the whole thing to one component. The route file holds no markup.
 *
 * **A draft is a 404 and gets there without a status check.** The read runs under
 * `overrideAccess: false, user: null`, so `publishedOnly` narrows it with a `Where` — an unpublished
 * collection is simply absent. `shop/[category]` established that, and the reason is that a URL must
 * not be usable to discover unreleased work.
 *
 * **No `generateMetadata` and no `generateStaticParams`.** SEO is Phase 24, exactly as Phases 10, 11,
 * 12 and 13 deferred it; `seoField()` is already on the collection for that phase to read.
 */
export default async function CollectionRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const collection = await getCollectionPage(slug)

  if (!collection) {
    notFound()
  }

  return <CollectionPage collection={collection} />
}
