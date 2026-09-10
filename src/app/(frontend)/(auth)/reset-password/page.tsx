import type { Metadata } from 'next'

import { FormNotice } from '@/components/auth/form-status'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'
import { PageTitle } from '@/components/layout/page-title'
import { Link } from '@/components/ui/link'
import { privateMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = privateMetadata('Choose a new password')

/**
 * Choose a new password, using the token from the reset email. Plan §7.1e.
 *
 * The route is `/reset-password?token=…` and the path half of that is a constant shared with the
 * email that links to it — `RESET_PASSWORD_PATH` in `payload/email/resetPasswordEmail.ts`. A query
 * parameter rather than a path segment for one reason: a path segment would make a malformed link
 * a 404 from Next before this page could explain what went wrong, and "not found" is the least
 * useful thing to tell someone holding an expired reset email.
 *
 * A **missing** token is answered here, without touching the database. An *invalid* or *expired* one
 * cannot be — telling those apart requires spending it, and spending it on page load would let a
 * mail scanner or a link preview burn a single-use token before the customer clicked. So the page
 * renders the form and the submit produces the real answer. See `lib/auth/actions.ts`.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const token = typeof params.token === 'string' ? params.token : ''

  return (
    <div className="flex flex-col gap-l">
      <PageTitle eyebrow="Account" size="display-l">
        Choose a new password
      </PageTitle>

      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <FormNotice>
          This link is missing its reset code. Links can also be broken by an email client wrapping
          them across lines — <Link href="/forgot-password">ask for a new one</Link> and open it in
          one click.
        </FormNotice>
      )}

      <p className="border-t border-border pt-6 font-sans text-body-sm text-foreground-muted">
        <Link href="/login">Back to sign in</Link>
      </p>
    </div>
  )
}
