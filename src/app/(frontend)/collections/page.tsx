import type { Metadata } from 'next'

import { EditorialIndex } from '@/components/editorial/editorial-index'
import { getCollectionIndex } from '@/lib/editorial/read'
import { pageMetadata } from '@/lib/seo/site'

/**
 * **`/collections`** — linked from the header since Phase 9, 404 until Phase 30.
 *
 * §23.1a built `/collections/[slug]` and recorded the index as owed; Phase 28 repeated it; Phase 30's
 * responsive pass caught it by asking the browser for every navigation href.
 */
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    description: 'Campaign-led edits of the range, each built around a season or an idea.',
    path: '/collections',
    title: 'Collections',
  })
}

export default async function CollectionsIndexPage() {
  return (
    <EditorialIndex
      emptyMessage="No collections are published yet."
      entries={await getCollectionIndex()}
      eyebrow="Collections"
      title="Collections"
    />
  )
}
