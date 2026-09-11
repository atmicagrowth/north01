'use client'

import { useActionState } from 'react'

import { Field } from '@/components/auth/field'
import { FormStatus } from '@/components/auth/form-status'
import { TurnstileWidget } from '@/components/security/turnstile-widget'
import { Button } from '@/components/ui/button'
import { forgotPassword } from '@/lib/auth/actions'
import { initialAuthFormState } from '@/lib/auth/form-state'

/**
 * Ask for a reset link. Plan §7.1e.
 *
 * The form is replaced by its own confirmation on success rather than sitting there inviting a
 * second submit. That is not only tidiness: every submit issues a *new* token and invalidates the
 * previous one, so a customer who presses the button twice and then opens the first email gets a
 * link that no longer works — the "reused reset link" edge case, reached by being helpful.
 */
export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPassword, initialAuthFormState)

  if (state.status === 'success') {
    return <FormStatus state={state} />
  }

  return (
    <form action={action} className="flex flex-col gap-m" noValidate>
      <FormStatus state={state} />

      <Field
        name="email"
        defaultValue={state.values.email ?? ''}
        label="Email"
        type="email"
        autoComplete="email"
        required
        error={state.fieldErrors.email}
      />

      <TurnstileWidget submissionCount={state.submissionCount} />

      <Button type="submit" variant="primary" size="lg" block loading={pending}>
        Send reset link
      </Button>
    </form>
  )
}
