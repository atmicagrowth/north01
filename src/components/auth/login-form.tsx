'use client'

import { useActionState } from 'react'

import { Field } from '@/components/auth/field'
import { FormStatus } from '@/components/auth/form-status'
import { Button } from '@/components/ui/button'
import { login } from '@/lib/auth/actions'
import { initialAuthFormState } from '@/lib/auth/form-state'
import { TurnstileWidget } from '@/components/security/turnstile-widget'

/**
 * Sign in. Plan §7.1e.
 *
 * `useActionState` rather than an `onSubmit` handler: the form posts to the Server Action, React
 * holds the returned state, and `pending` drives the button's busy state without a `useState` and a
 * `try/finally` in every form.
 *
 * **`defaultValue` from the returned state is what keeps the form filled in.** The obvious assumption
 * — uncontrolled inputs keep whatever the customer typed — is false here, and it was believed until a
 * browser said otherwise: React **resets** an uncontrolled form once its action resolves, so a failed
 * sign-in emptied the email field. The only thing it resets *to* is the rendered `defaultValue`, so
 * the server echoes back what was submitted. The password is deliberately not echoed; see
 * `form-state.ts`.
 *
 * `noValidate` turns off the browser's own bubble validation. `required` and `type="email"` stay,
 * because they still drive the mobile keyboard and the accessibility tree — but the messages the
 * customer reads come from one place, the server, and read the same on every browser.
 */
export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, initialAuthFormState)

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

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

      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        error={state.fieldErrors.password}
      />

      <TurnstileWidget submissionCount={state.submissionCount} />

      <Button type="submit" variant="primary" size="lg" block loading={pending}>
        Sign in
      </Button>
    </form>
  )
}
