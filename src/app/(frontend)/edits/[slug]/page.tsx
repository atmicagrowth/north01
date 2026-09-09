import { notFound } from 'next/navigation'

import { EditPage } from '@/components/editorial/edit-page'
import { getEditPage } from '@/lib/editorial/read'

/**
 * **`/edits/[slug]`** — plan §23.1b's intent-based shopping pages.
 *
 * Same shape as every other document route. The four questions §23.1b asks an edit to answer are
 * answered by the composition rather than by this file — see `edit-page.tsx`.
 */
export default async function EditRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const edit = await getEditPage(slug)

  if (!edit) {
    notFound()
  }

  return <EditPage edit={edit} />
}
