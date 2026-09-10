import type { Metadata } from 'next'

import { notFound } from 'next/navigation'

import { JournalArticlePage } from '@/components/editorial/journal-article'
import { getJournalArticle } from '@/lib/editorial/read'
import { pageMetadata } from '@/lib/seo/site'

/**
 * **`/journal/[slug]`** — plan §23.1c.
 *
 * The section is one sentence long — *"journal content should support links to products and
 * collections. Avoid creating an editorial dead end."* — and both halves are the article page's job
 * rather than this file's.
 *
 * The excerpt is the description when there is one: it is the only plain-text summary an editor
 * writes by hand anywhere in this project, and a sentence chosen for a card is a better meta
 * description than the first 155 characters of the body. The body is the fallback, flattened.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const article = await getJournalArticle(slug)

  if (!article) {
    return { title: 'Not found' }
  }

  return pageMetadata({
    description: article.excerpt ?? article.body,
    image: article.heroImage,
    path: `/journal/${slug}`,
    seo: article.seo,
    title: article.title,
  })
}

export default async function JournalRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = await getJournalArticle(slug)

  if (!article) {
    notFound()
  }

  return <JournalArticlePage article={article} />
}
