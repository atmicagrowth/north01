import { notFound } from 'next/navigation'

import { JournalArticlePage } from '@/components/editorial/journal-article'
import { getJournalArticle } from '@/lib/editorial/read'

/**
 * **`/journal/[slug]`** — plan §23.1c.
 *
 * The section is one sentence long — *"journal content should support links to products and
 * collections. Avoid creating an editorial dead end."* — and both halves are the article page's job
 * rather than this file's.
 */
export default async function JournalRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = await getJournalArticle(slug)

  if (!article) {
    notFound()
  }

  return <JournalArticlePage article={article} />
}
