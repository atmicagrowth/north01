import type { Metadata } from 'next'

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'
import { PageTitle } from '@/components/layout/page-title'
import { Link } from '@/components/ui/link'
import { privateMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = privateMetadata('Reset your password')

/**
 * Ask for a reset link. Plan §7.1e.
 *
 * Unlike `/login` and `/register` this route does **not** redirect a signed-in customer away.
 * Someone who is signed in on one device and has forgotten the password on another is exactly the
 * person who needs this page, and bouncing them to their account overview would be the software
 * being clever at their expense.
 */
export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-l">
      <div className="flex flex-col gap-m">
        <PageTitle eyebrow="Account" size="display-l">
          Reset your password
        </PageTitle>

        <p className="max-w-measure font-sans text-body text-foreground-muted">
          Enter the email address on your account and we will send a link to choose a new password.
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="border-t border-border pt-m font-sans text-body-sm text-foreground-muted">
        Remembered it? <Link href="/login">Sign in</Link>.
      </p>
    </div>
  )
}
