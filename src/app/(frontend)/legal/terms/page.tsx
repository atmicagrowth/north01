import type { Metadata } from 'next'

import { notFound } from 'next/navigation'

import { PolicyPage } from '@/components/help/policy-page'
import { getLegalPublication, getSupportPolicies } from '@/lib/help/read'
import { privateMetadata } from '@/lib/seo/metadata'
import { pageMetadata } from '@/lib/seo/site'

/**
 * **`/legal/terms`** — the second half of gap **G-19**, and the second footer link that pointed at
 * nothing from Phase 9.
 *
 * The body is `site-settings.termsOfSale`, rendered as written. Terms of sale are the contract a
 * customer accepts by placing an order — the checkout page says so beside the payment button and
 * links here — which makes an invented word in them worse than a missing page: it would be a term
 * nobody agreed to, presented as one they did. The seeded text is a plain-English starting draft
 * written from how the application works, at the owner's request; the owner is accountable for it
 * and is to have it reviewed.
 *
 * **Still owed before live orders**, and recorded on the field itself rather than only here: the
 * company's legal name, its registered address and the governing law. None of the three is known to
 * this build, and none can be derived from anything in it.
 *
 * **No text, no page** — a 404, with the link gone from the footer, the Support nav, the checkout
 * sentence and the sitemap. `/legal/privacy` explains why a legal page does not take the help pages'
 * *"not published yet"* state.
 */
export async function generateMetadata(): Promise<Metadata> {
  const policies = await getSupportPolicies()

  if (policies.terms === null) {
    return privateMetadata('Not found')
  }

  return pageMetadata({
    description: 'The terms of sale for orders placed with this shop.',
    path: '/legal/terms',
    title: 'Terms',
  })
}

export default async function TermsPage() {
  const [policies, legal] = await Promise.all([getSupportPolicies(), getLegalPublication()])

  if (policies.terms === null) {
    notFound()
  }

  /* `terms: true` for the reason `/legal/privacy` gives: this render has just found the text. */
  return (
    <PolicyPage
      body={policies.terms}
      eyebrow="Legal"
      legal={{ ...legal, terms: true }}
      title="Terms"
    />
  )
}
