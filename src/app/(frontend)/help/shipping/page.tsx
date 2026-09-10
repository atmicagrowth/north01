import type { Metadata } from 'next'

import { PolicyPage } from '@/components/help/policy-page'
import { getSupportPolicies } from '@/lib/help/read'
import { pageMetadata } from '@/lib/seo/site'

/**
 * **`/help/shipping`** — the route the footer has linked to since Phase 9, and which did not exist.
 *
 * The body is `site-settings.shippingPolicy`, the same field the product page's accordion reads.
 * `SiteSettings.ts` calls these *"one policy with one source"*, and gap **G-08** recorded that a
 * dedicated support page must render that field rather than keep a second copy of the words.
 */
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    description: 'How and when orders are delivered, and what delivery costs.',
    path: '/help/shipping',
    title: 'Shipping',
  })
}

export default async function ShippingPage() {
  const policies = await getSupportPolicies()

  return <PolicyPage body={policies.shipping} title="Shipping" />
}
