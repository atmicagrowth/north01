import type { Metadata } from 'next'

import { notFound } from 'next/navigation'

import { PolicyPage } from '@/components/help/policy-page'
import { getLegalPublication, getSupportPolicies } from '@/lib/help/read'
import { privateMetadata } from '@/lib/seo/metadata'
import { pageMetadata } from '@/lib/seo/site'

/**
 * **`/legal/privacy`** — the footer link that 404'd from Phase 9, was withdrawn in Phase 28, and has a
 * page again from Phase 37. Gap **G-19**.
 *
 * The body is `site-settings.privacyPolicy` and this route holds no copy of its own — not a summary,
 * not an introduction, not a placeholder paragraph. A privacy notice is a statement about what this
 * business does with personal data, and the only honest thing a route can do is render the one text
 * the owner is accountable for. That text was seeded as a plain-English starting draft, written from
 * how the application works at the owner's request (`scripts/seed/legal.ts`); it is not legal advice,
 * and the owner is to have it reviewed before live orders — the field's own admin help says so.
 *
 * ### No text, no page
 *
 * A field with no text — never filled in, which is production's state until the owner enters it, or
 * emptied in the admin — **answers 404**, and `publishedLegalNav` drops the link from the footer, the
 * Support nav and the sitemap in the same state. The help pages say *"not published yet"* instead, but
 * a privacy page that says it has no notice is still a privacy page: linked from every page of a shop
 * taking payments, and indexable under a description claiming to explain how personal data is used.
 * The metadata follows the same answer, as the other document routes' do.
 */
export async function generateMetadata(): Promise<Metadata> {
  const policies = await getSupportPolicies()

  if (policies.privacy === null) {
    return privateMetadata('Not found')
  }

  return pageMetadata({
    description:
      'The privacy notice for this shop: what personal data is collected, and how it is used.',
    path: '/legal/privacy',
    title: 'Privacy',
  })
}

export default async function PrivacyPage() {
  const [policies, legal] = await Promise.all([getSupportPolicies(), getLegalPublication()])

  if (policies.privacy === null) {
    notFound()
  }

  /*
   * `privacy: true` whatever the cached flags say: this render has just read the document and found
   * text, and the Support nav must mark the page the reader is on even in the one request after a save
   * that the link cache has not caught up with.
   */
  return (
    <PolicyPage
      body={policies.privacy}
      eyebrow="Legal"
      legal={{ ...legal, privacy: true }}
      title="Privacy"
    />
  )
}
