/**
 * **Plan §27.1b — "Login form".**
 *
 * The sign-in form is the most attacked control in the storefront and the one where an
 * accessibility mistake is invisible to the person who wrote it. Three things here are worth a test
 * and the rest is markup:
 *
 * 1. **A failure has to be announced as a form-level summary, not only beside the field.** By the
 *    time the action resolves the customer's focus is already gone — `Button` expresses "busy" with
 *    the real `disabled` attribute (see `components/ui/button.tsx`), and a `<button>` that becomes
 *    disabled while focused drops focus to `document.body`. A red sentence under the email field is
 *    then something only a sighted user who happens to be looking at that field will ever find.
 *    `FormStatus` exists to fix exactly that, so **the summary, its live region, and the focus move
 *    are the headline assertions of this file.** Its `submissionCount` trick — announcing the *same*
 *    failure a second time — is tested too, because that is the part that silently rots.
 * 2. **What the form refuses to say.** A refused sign-in gets one generic sentence and points at
 *    neither field, because a form that distinguishes "no such account" from "wrong password" is an
 *    oracle answering *does this person shop here*. The lockout is the single documented exception.
 * 3. **What the form refuses to keep.** The submitted email is echoed back so a failed attempt does
 *    not empty the form; the password is deliberately never echoed, because that would put plaintext
 *    in the RSC payload and in any log that captured it.
 *
 * Everything is queried by role and accessible name. Nothing here asserts a class or a snapshot —
 * §27 asks for business-critical logic and user flows, and a class name is neither.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthFormState } from '@/lib/auth/form-state'

/*
 * `login` is a Server Action: `'use server'`, `next/headers`, a Payload client and a `redirect()`.
 * None of that can run in jsdom, and none of it is what §27.1b is about — this is a test of the form
 * that calls it. The module is replaced wholesale so the real one is never evaluated, and the double
 * keeps the action's *contract*: `(previous, formData) => AuthFormState`.
 */
const { loginMock } = vi.hoisted(() => ({
  loginMock: vi.fn<(previous: AuthFormState, formData: FormData) => Promise<AuthFormState>>(),
}))

vi.mock('@/lib/auth/actions', () => ({ login: loginMock }))

import { LoginForm } from '@/components/auth/login-form'

/** Verbatim from `actions.ts`. Copied rather than imported: that module is the one being doubled. */
const GENERIC_LOGIN_FAILURE = 'That email and password do not match an account.'
const LOCKED_FAILURE =
  'Too many sign-in attempts. This account is locked for a few minutes — try again shortly, or reset your password.'

/**
 * The real action's `failure()` helper, reproduced: it increments `submissionCount` off the previous
 * state and echoes back only the fields in `ECHOED_FIELDS` — which does not include `password`.
 * Reproducing it rather than returning a frozen object is what makes the `submissionCount` tests
 * mean anything.
 */
function respondsWithFailure(message: null | string, fieldErrors: Record<string, string> = {}) {
  loginMock.mockImplementation(async (previous, formData) => ({
    status: 'error',
    message,
    fieldErrors,
    values: { email: String(formData.get('email') ?? '') },
    submissionCount: previous.submissionCount + 1,
  }))
}

/** Fills in plausible credentials and presses the button. Returns after the action has settled. */
async function signIn(
  user: ReturnType<typeof userEvent.setup>,
  email = 'ada@example.com',
  password = 'correct-horse-battery',
) {
  await user.type(screen.getByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

const submittedFormData = (call = 0) => loginMock.mock.calls[call]![1]

beforeEach(() => {
  /*
   * `vi.restoreAllMocks()` in `tests/setup/components.ts` restores *spies*; a bare `vi.fn()` keeps
   * its call log and its implementation across files' worth of tests. Reset it here or every
   * "called once" assertion below is really asserting a running total.
   */
  loginMock.mockReset()
  // A default that is never reached in the happy path: every test that cares sets its own.
  respondsWithFailure(GENERIC_LOGIN_FAILURE)
})

describe('LoginForm (§27.1b)', () => {
  describe('the fields a password manager and a screen reader both have to understand', () => {
    it('labels both credentials, so each control is reachable by its accessible name', () => {
      render(<LoginForm />)

      expect(screen.getByLabelText('Email')).toBeInTheDocument()
      expect(screen.getByLabelText('Password')).toBeInTheDocument()
    })

    it('carries the autoComplete tokens a password manager fills from: email and current-password', () => {
      render(<LoginForm />)

      /*
       * `current-password` rather than `new-password` is the whole difference between a manager
       * offering the saved credential and offering to generate a replacement for it.
       */
      expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email')
      expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
    })

    it('masks the password and types the email field, because both drive the keyboard shown on a phone', () => {
      render(<LoginForm />)

      expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
      expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    })

    it('marks both credentials required, keeping them required in the accessibility tree', () => {
      render(<LoginForm />)

      // `noValidate` turns off the browser's *bubbles*, not the semantics. `required` still has to
      // reach assistive technology, which reads it as "required" regardless of who validates.
      expect(screen.getByLabelText('Email')).toBeRequired()
      expect(screen.getByLabelText('Password')).toBeRequired()
    })

    it('still submits an empty form, because the server writes every message rather than the browser', async () => {
      const user = userEvent.setup()
      render(<LoginForm />)

      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      // If the browser's own constraint validation were live, this submit would never leave the
      // page and the customer would read a message that differs on every browser.
      await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1))
    })
  })

  describe('before anything has been submitted', () => {
    it('renders no status region on first paint, because an alert on load talks over the page', () => {
      render(<LoginForm />)

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('leaves an un-errored field free of aria-invalid and aria-describedby', () => {
      render(<LoginForm />)

      const email = screen.getByLabelText('Email')

      expect(email).not.toHaveAttribute('aria-invalid')
      expect(email).not.toHaveAttribute('aria-describedby')
    })
  })

  describe('a failure has to be announced, not just displayed', () => {
    it('renders the failure as a form-level summary in a live region, not only beside the field', async () => {
      const user = userEvent.setup()
      respondsWithFailure('Check the highlighted fields.', {
        email: 'Enter a valid email address.',
      })
      render(<LoginForm />)

      await signIn(user, 'not-an-email')

      /*
       * THE headline assertion of this file. A field error alone was a real defect: focus has
       * already left the button by the time the message renders, so nothing announces it and
       * nothing points a keyboard user at it.
       */
      const summary = await screen.findByRole('alert')
      expect(summary).toHaveTextContent('Check the highlighted fields.')
      // …and the field message is still there beside its control, doing the other half of the job.
      expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    })

    it('moves focus to the summary, because the busy button has just gone disabled and lost it', async () => {
      const user = userEvent.setup()
      render(<LoginForm />)

      await signIn(user)

      const summary = await screen.findByRole('alert')
      // Without this, focus is on `document.body` and the next Tab restarts at the top of the page.
      await waitFor(() => expect(summary).toHaveFocus())
    })

    it('puts the summary ahead of the fields, so the next Tab from it lands on the email input', async () => {
      const user = userEvent.setup()
      render(<LoginForm />)

      await signIn(user)
      await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())

      await user.tab()

      // The summary is a deliberate focus target, not a dead end: the customer carries on into the
      // form they have to correct.
      expect(screen.getByLabelText('Email')).toHaveFocus()
    })

    it('announces the same failure again on a second identical submit, because submissionCount changed', async () => {
      const user = userEvent.setup()
      render(<LoginForm />)

      await signIn(user)
      await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())

      // Move focus away, then repeat the exact same failing attempt.
      const password = screen.getByLabelText('Password')
      await user.click(password)
      expect(password).toHaveFocus()

      await user.type(password, 'correct-horse-battery')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      /*
       * Two identical failures produce an identical `message`. If the focus effect keyed on the
       * message rather than on `submissionCount` it would never re-run, and a customer who pressed
       * the button twice would get no evidence that anything happened at all.
       */
      await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
      expect(loginMock).toHaveBeenCalledTimes(2)
    })

    it('keeps exactly one alert for a summary plus field errors, so one failure is not read four times', async () => {
      const user = userEvent.setup()
      respondsWithFailure('Check the highlighted fields.', {
        email: 'Enter a valid email address.',
        password: 'Enter your password.',
      })
      render(<LoginForm />)

      await signIn(user, 'not-an-email', 'x')

      await screen.findByRole('alert')
      // `Field` deliberately clears `FieldMessage`'s own `role="alert"`: summary announces, fields
      // describe. Three invalid fields must not queue three alerts behind the summary.
      expect(screen.getAllByRole('alert')).toHaveLength(1)
      expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    })
  })

  describe('an errored field says so, and says why, to the control itself', () => {
    it('sets aria-invalid on the field the server rejected', async () => {
      const user = userEvent.setup()
      respondsWithFailure('Check the highlighted fields.', {
        email: 'Enter a valid email address.',
      })
      render(<LoginForm />)

      await signIn(user, 'not-an-email')

      /*
       * `aria-invalid` explicitly, rather than jest-dom's `toBeInvalid()`: that matcher also
       * consults the browser's own constraint validation, and both fields are `required` and empty
       * after React resets the form — so it would report "invalid" for a field the server never
       * complained about. The ARIA attribute is the thing under test, so assert the attribute.
       */
      await waitFor(() =>
        expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true'),
      )
      // The other field was not rejected and must not be dressed as though it was.
      expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid')
    })

    it('points aria-describedby at the message, so the reason is read out with the field', async () => {
      const user = userEvent.setup()
      respondsWithFailure('Check the highlighted fields.', {
        email: 'Enter a valid email address.',
      })
      render(<LoginForm />)

      await signIn(user, 'not-an-email')

      const email = await screen.findByLabelText('Email')
      await waitFor(() => expect(email).toHaveAttribute('aria-describedby'))

      const describedBy = email.getAttribute('aria-describedby')!
      const message = document.getElementById(describedBy)

      // A dangling `aria-describedby` reads as nothing at all — the id has to resolve, and the
      // element it resolves to has to be the sentence the customer needs.
      expect(message).not.toBeNull()
      expect(message).toHaveTextContent('Enter a valid email address.')
    })
  })

  describe('what comes back in the form after a failure', () => {
    it('echoes the submitted email back, because React empties an uncontrolled form when the action resolves', async () => {
      const user = userEvent.setup()
      render(<LoginForm />)

      await signIn(user, 'ada@example.com')

      await screen.findByRole('alert')
      /*
       * The obvious assumption — an uncontrolled input keeps what was typed — is false for a form
       * driven by a Server Action. React resets the form to its rendered `defaultValue`, so the
       * echo from the server is the only thing that keeps this field filled in.
       */
      await waitFor(() => expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com'))
    })

    it('never echoes the password back, at any cost to convenience', async () => {
      const user = userEvent.setup()
      render(<LoginForm />)

      await signIn(user, 'ada@example.com', 'correct-horse-battery')

      await screen.findByRole('alert')
      // Echoing it would put plaintext in the RSC payload, in browser memory, and in any log that
      // captured the response — to save one field that a password manager refills for free.
      const password = screen.getByLabelText('Password')
      await waitFor(() => expect(password).not.toHaveValue('correct-horse-battery'))
      expect(password).not.toHaveAttribute('value')
    })
  })

  describe('what the form refuses to reveal', () => {
    it('gives one generic sentence for a refused sign-in, so the form is not an account oracle', async () => {
      const user = userEvent.setup()
      respondsWithFailure(GENERIC_LOGIN_FAILURE)
      render(<LoginForm />)

      await signIn(user, 'nobody@example.com')

      const summary = await screen.findByRole('alert')
      expect(summary).toHaveTextContent(GENERIC_LOGIN_FAILURE)

      /*
       * Wrong password, unknown email, disabled account — one message. Anything that names the
       * distinction turns the form into a paid answer to "does this person shop here", which is
       * worth money to a competitor and worth more to whoever is credential-stuffing.
       */
      const said = summary.textContent ?? ''
      for (const leak of ['not found', 'no account', 'unknown', 'incorrect password', 'disabled']) {
        expect(said.toLowerCase()).not.toContain(leak)
      }
      // Nor may it leak by echoing the address into the sentence.
      expect(said).not.toContain('nobody@example.com')
    })

    it('does not point a refused sign-in at either field, which would answer the same question by implication', async () => {
      const user = userEvent.setup()
      respondsWithFailure(GENERIC_LOGIN_FAILURE)
      render(<LoginForm />)

      await signIn(user, 'nobody@example.com')

      await screen.findByRole('alert')
      // Marking the *email* invalid would say "we do not know this address"; marking the *password*
      // invalid would say "we do". Neither field carries the blame.
      expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid')
      expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid')
    })

    it('states the lockout plainly, the one failure §7.1e lets the form be specific about', async () => {
      const user = userEvent.setup()
      respondsWithFailure(LOCKED_FAILURE)
      render(<LoginForm />)

      await signIn(user)

      // A lockout is reached only after five failures against one address, so the attacker already
      // knows it exists — while the customer who mistyped needs to know that waiting is the answer.
      const summary = await screen.findByRole('alert')
      expect(summary).toHaveTextContent(LOCKED_FAILURE)
    })
  })

  describe('while the action is in flight', () => {
    /** Hands back a resolver so the pending window can be inspected rather than raced. */
    function deferLogin() {
      let release!: (state: AuthFormState) => void
      loginMock.mockImplementation(
        (previous) =>
          new Promise<AuthFormState>((resolve) => {
            release = (state) =>
              resolve({ ...state, submissionCount: previous.submissionCount + 1 })
          }),
      )
      return () => release({ ...failureState })
    }

    const failureState: AuthFormState = {
      status: 'error',
      message: GENERIC_LOGIN_FAILURE,
      fieldErrors: {},
      values: {},
      submissionCount: 1,
    }

    it('disables the sign-in button and marks it busy while the credentials are being checked', async () => {
      const user = userEvent.setup()
      const release = deferLogin()
      render(<LoginForm />)

      await signIn(user)

      const button = screen.getByRole('button', { name: 'Sign in' })
      await waitFor(() => expect(button).toBeDisabled())
      // `aria-busy` is what tells assistive technology this is *working*, not *unavailable* — two
      // states that must not be confused for a control the customer is waiting on.
      expect(button).toHaveAttribute('aria-busy', 'true')

      await act(async () => {
        release()
      })
    })

    it('keeps the accessible name "Sign in" while busy, so the button is never a nameless spinner', async () => {
      const user = userEvent.setup()
      const release = deferLogin()
      render(<LoginForm />)

      await signIn(user)

      // The label is faded with `opacity-0`, never `visibility: hidden` — the latter removes it from
      // the accessibility tree and leaves a critical `button-name` violation behind.
      await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled())

      await act(async () => {
        release()
      })
    })

    it('refuses a second submit while the first is still in flight', async () => {
      const user = userEvent.setup()
      const release = deferLogin()
      render(<LoginForm />)

      await signIn(user)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled())

      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      // A control that looks unavailable has to *be* unavailable: a second POST here is a second
      // failed attempt counted against the lockout the customer has not earned.
      expect(loginMock).toHaveBeenCalledTimes(1)

      await act(async () => {
        release()
      })
    })

    it('gives the button back once the attempt has resolved, so a failure can be corrected and retried', async () => {
      const user = userEvent.setup()
      const release = deferLogin()
      render(<LoginForm />)

      await signIn(user)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled())

      await act(async () => {
        release()
      })

      const button = screen.getByRole('button', { name: 'Sign in' })
      await waitFor(() => expect(button).toBeEnabled())
      expect(button).not.toHaveAttribute('aria-busy')
    })
  })

  describe('what actually reaches the server', () => {
    it('sends what the customer typed, so the server re-derives the result rather than trusting the page', async () => {
      const user = userEvent.setup()
      render(<LoginForm />)

      await signIn(user, 'ada@example.com', 'correct-horse-battery')

      await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1))
      const submitted = submittedFormData()
      expect(submitted.get('email')).toBe('ada@example.com')
      expect(submitted.get('password')).toBe('correct-horse-battery')
    })

    it('carries the return destination as a submitted field when one was given', async () => {
      const user = userEvent.setup()
      render(<LoginForm next="/account/orders" />)

      await signIn(user)

      await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1))
      // The destination travels with the submission so the server — which sanitises it via
      // `safeReturnPath` — decides where the customer lands. The browser only carries it.
      expect(submittedFormData().get('next')).toBe('/account/orders')
    })

    it('sends no destination at all when none was given, rather than inventing one', async () => {
      const user = userEvent.setup()
      render(<LoginForm />)

      await signIn(user)

      await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1))
      expect(submittedFormData().get('next')).toBeNull()
    })
  })
})
