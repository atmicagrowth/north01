'use client'

import { useActionState } from 'react'

import { Field } from '@/components/auth/field'
import { FormStatus } from '@/components/auth/form-status'
import { Button } from '@/components/ui/button'
import { resetPassword } from '@/lib/auth/actions'
import { initialAuthFormState } from '@/lib/auth/form-state'
import { PASSWORD_RULE_TEXT } from '@/lib/password-policy'

/**
 * Choose a new password with a token from the reset email. Plan §7.1e.
 *
 * The token travels in a hidden input rather than being read from the URL by the action, because a
 * Server Action has no URL — it is a POST to whatever route it was used on, and `searchParams` are
 * not part of what it receives. The page reads the query string and hands it here.
 *
 * The token is **not validated on page load**, deliberately. Checking it on `GET` would mean a link
 * preview, a mail scanner or a corporate URL-rewriter could burn a single-use token before the
 * customer ever clicked it. It is spent on submit, once, by the person choosing the password.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, initialAuthFormState)

  return (
    <form action={action} className="flex flex-col gap-m" noValidate>
      <input type="hidden" name="token" value={token} />

      <FormStatus state={state} />

      <Field
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        hint={PASSWORD_RULE_TEXT}
        error={state.fieldErrors.password}
      />

      <Button type="submit" variant="primary" size="lg" block loading={pending}>
        Set new password
      </Button>
    </form>
  )
}
