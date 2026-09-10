import type { Metadata } from 'next'

import { EditorialIndex } from '@/components/editorial/editorial-index'
import { getEditIndex } from '@/lib/editorial/read'
import { pageMetadata } from '@/lib/seo/site'

/**
 * **`/edit`** — the same story as `/collections`, and the same fix.
 *
 * The path is singular because `documentHref` in `lib/navigation/routes.ts` says so, and that map is
 * the one every link in this application goes through. Phase 23 built the detail route under
 * `/edits/` instead, so **every Edit link in the shop 404'd** — the mega menu, the footer, search
 * suggestions and, from Phase 24, the sitemap. Phase 30 renamed the route to match the map rather
 * than changing the map, because the map is what the rest of the code already agrees with.
 */
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    description: 'Shopping by intent — a set of pieces chosen for one occasion or one problem.',
    path: '/edit',
    title: 'The Edit',
  })
}

export default async function EditIndexPage() {
  return (
    <EditorialIndex
      emptyMessage="No edits are published yet."
      entries={await getEditIndex()}
      eyebrow="The Edit"
      title="The Edit"
    />
  )
}
