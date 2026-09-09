import type { Metadata } from 'next'

import { SignOutButton } from '@/components/auth/sign-out-button'
import { PageTitle } from '@/components/layout/page-title'
import { requireCustomer } from '@/lib/auth/session'

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
}

/**
 * The account overview — **the protected route Phase 7 owes, and no more than that.**
 *
 * Structure §16 lists five account screens: Overview, Orders, Wishlist, Addresses, Profile. Plan
 * §20.1d assigns all of them, by route, to **Phase 20**. What §7.1e assigns to *this* phase is
 * *"protected account routes"* — the guard, the redirect, the return journey — and §7.1b's *"read
 * their own profile"*.
 *
 * **Phase 20 discharged that.** The five screens exist, so `AccountNav` in the layout links to them
 * and the paragraph that used to explain their absence is gone. Phase 7's note said the screens and
 * the navigation had to arrive together, because a link to a route that does not exist is the same
 * lie as a button that does nothing (plan §0.1.17) — and they did.
 *
 * `requireCustomer()` is the real guard — see the layout for why it is here and not there. It is
 * given this route's own path so that signing in returns the customer where they were going.
 */
export default async function AccountPage() {
  const customer = await requireCustomer('/account')

  return (
    <div className="flex flex-col gap-l">
      <PageTitle eyebrow="Account" size="display-l">
        {customer.firstName}
      </PageTitle>

      <dl className="grid gap-px border-t border-border text-body-sm sm:grid-cols-2">
        <div className="flex flex-col gap-1 border-b border-border py-5">
          <dt className="font-sans text-micro uppercase text-foreground-muted">Name</dt>
          <dd>
            {customer.firstName} {customer.lastName}
          </dd>
        </div>

        <div className="flex flex-col gap-1 border-b border-border py-5">
          <dt className="font-sans text-micro uppercase text-foreground-muted">Email</dt>
          <dd className="break-words">{customer.email}</dd>
        </div>
      </dl>

      {/*
        Phase 20 built the screens this paragraph used to apologise for, so the paragraph is gone
        rather than reworded. The navigation above is the honest version of what it was trying to say.
      */}

      <div className="border-t border-border pt-6">
        <SignOutButton />
      </div>
    </div>
  )
}
