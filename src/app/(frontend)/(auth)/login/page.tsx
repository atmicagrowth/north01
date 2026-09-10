import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { FormNotice } from '@/components/auth/form-status'
import { LoginForm } from '@/components/auth/login-form'
import { PageTitle } from '@/components/layout/page-title'
import { Link } from '@/components/ui/link'
import { getCustomer, safeReturnPath } from '@/lib/auth/session'
import { privateMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = privateMetadata('Sign in')

/**
 * Sign in. Plan §7.1e.
 *
 * The notices are one-shot query flags set by the flows that end here: a completed password reset,
 * a sign-out, and the narrow case where registration succeeded but the automatic sign-in did not.
 * They are read as *presence* rather than as content, so nothing a stranger puts in the URL is
 * rendered — a message parameter would be a text-injection vector on the one page where a forged
 * sentence ("your session expired, re-enter your card details") does the most damage.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const next = safeReturnPath(typeof params.next === 'string' ? params.next : undefined)

  /*
   * Already signed in. Sending them on rather than showing a form they do not need — and honouring
   * `next`, because arriving here with one means something interrupted a journey.
   */
  if (await getCustomer()) {
    redirect(next ?? '/account')
  }

  const notice =
    params.reset !== undefined
      ? 'Your password has been changed. Sign in with your new password.'
      : params.signedOut !== undefined
        ? 'You are signed out.'
        : params.registered !== undefined
          ? 'Your account was created. Sign in to continue.'
          : null

  return (
    <div className="flex flex-col gap-l">
      <PageTitle eyebrow="Account" size="display-l">
        Sign in
      </PageTitle>

      {notice ? <FormNotice>{notice}</FormNotice> : null}

      <LoginForm next={next ?? undefined} />

      <div className="flex flex-col gap-2 border-t border-border pt-6 font-sans text-body-sm text-foreground-muted">
        <p>
          <Link href="/forgot-password">Forgotten your password?</Link>
        </p>
        <p>
          No account yet?{' '}
          <Link href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}>
            Create one
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
