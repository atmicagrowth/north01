'use client'

import { useActionState } from 'react'

import { Field } from '@/components/auth/field'
import { FormStatus } from '@/components/auth/form-status'
import { Button } from '@/components/ui/button'
import { register } from '@/lib/auth/actions'
import { initialAuthFormState } from '@/lib/auth/form-state'
import { PASSWORD_RULE_TEXT } from '@/lib/password-policy'
import { TurnstileWidget } from '@/components/security/turnstile-widget'

/**
 * Create an account. Plan §7.1e.
 *
 * The password rule is shown as a hint *before* it is broken, from the same constant the server
 * enforces — a policy a customer only discovers by failing is a policy that reads as an obstacle.
 *
 * `autoComplete="new-password"` is what tells a password manager to offer to generate one rather
 * than to fill the existing one, and it is the difference between a manager helping and a manager
 * pasting the customer's *other* password into a registration form.
 */
export function RegisterForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(register, initialAuthFormState)

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <FormStatus state={state} />

      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          name="firstName"
          defaultValue={state.values.firstName ?? ''}
          label="First name"
          autoComplete="given-name"
          required
          error={state.fieldErrors.firstName}
        />
        <Field
          name="lastName"
          defaultValue={state.values.lastName ?? ''}
          label="Last name"
          autoComplete="family-name"
          required
          error={state.fieldErrors.lastName}
        />
      </div>

      <Field
        name="email"
        defaultValue={state.values.email ?? ''}
        label="Email"
        type="email"
        autoComplete="email"
        required
        error={state.fieldErrors.email}
      />

      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        hint={PASSWORD_RULE_TEXT}
        error={state.fieldErrors.password}
      />

      <TurnstileWidget submissionCount={state.submissionCount} />

      <Button type="submit" variant="primary" size="lg" block loading={pending}>
        Create account
      </Button>
    </form>
  )
}
