import type { Metadata } from 'next'

import { SignOutButton } from '@/components/auth/sign-out-button'
import { PageTitle } from '@/components/layout/page-title'
import { Link } from '@/components/ui/link'
import { requireCustomer } from '@/lib/auth/session'
import { privateMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = privateMetadata('Settings')

/**
 * **`/account/settings`** — plan §20.1d.
 *
 * The plan names the route `settings`; structure §16 and the features matrix call the screen
 * *Profile*. `AGENTS.md` ranks the plan above both, so the route and the label are both "Settings" —
 * a nav item reading "Profile" that lands on `/settings` is the small mismatch that makes somebody
 * wonder whether they clicked the wrong thing.
 *
 * ### What is here, and what is deliberately not
 *
 * §7.1b's list of what a customer may do is short and this screen is the "manage their credentials"
 * entry. **Changing a password is done through the reset flow**, not through a form here, and that is
 * a decision rather than an omission: Phase 7 already built a single-use, one-hour, email-delivered
 * reset that re-checks the password policy, and a second path to the same outcome would be a second
 * place for it to be wrong. Phase 19 made that flow deliver a real message.
 *
 * Changing an email address is absent for a sharper reason: `orders.email` is a **snapshot** taken at
 * checkout, so changing the account address does not and must not change where past confirmations
 * went. That interaction deserves to be designed rather than added to a settings page because the
 * field happened to be nearby.
 */
export default async function AccountSettingsPage() {
  const customer = await requireCustomer('/account/settings')

  return (
    <div className="flex flex-col gap-l">
      <PageTitle eyebrow="Account" size="display-l">
        Settings
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

      <div className="flex flex-col items-start gap-s">
        <h2 className="font-sans text-meta uppercase text-foreground-muted">Password</h2>
        <p className="max-w-measure font-sans text-body-sm text-foreground-muted">
          Changing your password is done by email, so a link can only be used once and expires on
          its own.
        </p>
        <Link className="font-sans text-meta uppercase" href="/forgot-password">
          Send me a reset link
        </Link>
      </div>

      <div className="border-t border-border pt-6">
        <SignOutButton />
      </div>
    </div>
  )
}
