import { notFound } from 'next/navigation'

import { LookbookPage } from '@/components/editorial/lookbook-page'
import { getLookbook } from '@/lib/editorial/read'

/**
 * **`/lookbook/[slug]`** — the route Phase 22 deliberately did not build.
 *
 * Phase 22 built the hotspot interaction and recorded that the page belonged here: *"§22 names no
 * route, the page is Phase 23's, and building it here would be building a later phase early."* This
 * is that page, and the hotspots on it are Phase 22's components unchanged.
 */
export default async function LookbookRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const lookbook = await getLookbook(slug)

  if (!lookbook) {
    notFound()
  }

  return <LookbookPage lookbook={lookbook} />
}
