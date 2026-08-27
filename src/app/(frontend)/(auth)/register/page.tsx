import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { RegisterForm } from '@/components/auth/register-form'
import { PageTitle } from '@/components/layout/page-title'
import { Link } from '@/components/ui/link'
import { getCustomer, safeReturnPath } from '@/lib/auth/session'

export const metadata: Metadata = {
  title: 'Create an account',
  robots: { index: false, follow: false },
}

/**
 * Create an account. Plan §7.1e.
 *
 * **No social sign-in buttons.** §7.1e says it outright — *"OAuth is not implemented; do not create
 * fake buttons for providers that do not exist"* — and it is the account system's instance of the
 * standing rule against UI that looks functional and is not.
 *
 * The copy under the title is structure §16's *"do not force account creation before browsing or
 * adding to cart"*, said to the customer rather than only observed in the routing. An account is
 * offered as useful, not required, and Phase 17's checkout will let a guest through.
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const next = safeReturnPath(typeof params.next === 'string' ? params.next : undefined)

  if (await getCustomer()) {
    redirect(next ?? '/account')
  }

  return (
    <div className="flex flex-col gap-l">
      <div className="flex flex-col gap-m">
        <PageTitle eyebrow="Account" size="display-l">
          Create an account
        </PageTitle>

        <p className="max-w-measure font-sans text-body text-foreground-muted">
          An account keeps your order history, saved addresses and wishlist in one place. You never
          need one to browse, and you will not need one to check out.
        </p>
      </div>

      <RegisterForm next={next ?? undefined} />

      <p className="border-t border-border pt-6 font-sans text-body-sm text-foreground-muted">
        Already have an account?{' '}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}>Sign in</Link>.
      </p>
    </div>
  )
}
