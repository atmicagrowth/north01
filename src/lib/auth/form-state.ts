/**
 * The shape every auth form's `useActionState` holds.
 *
 * It lives beside `actions.ts` rather than in it because a `'use server'` module may only export
 * async functions — Next enforces that, and a `const` export there is a build error. Types are
 * erased and could have stayed, but keeping the type and its initial value together is what makes
 * the rule obvious to the next person rather than a mystery about a moved constant.
 */
export type AuthFormState = {
  /** `idle` before the first submit; `success` for the flows that stay on the page. */
  status: 'error' | 'idle' | 'success'
  /** A form-level sentence. Rendered in a focusable `role="alert"` region — see `form-status.tsx`. */
  message: null | string
  /** Field name → message. Rendered next to the control and wired with `aria-describedby`. */
  fieldErrors: Record<string, string>
  /**
   * What the customer typed, echoed back so a failed submit does not empty the form.
   *
   * **This is not optional polish, it is a correction.** React resets an uncontrolled form once its
   * action resolves — measured in a browser: after a rejected registration, `firstName`, `lastName`
   * and `email` all came back empty while the field that had just been re-typed kept its value. So
   * "uncontrolled inputs keep what was typed" is false for a form driven by a Server Action, and the
   * only thing React resets *to* is the rendered `defaultValue`. Hence this.
   *
   * **Passwords are never in here.** Echoing one would put the plaintext in the RSC payload, in the
   * browser's memory, and in any log that captured the response — for the sake of saving a customer
   * one field, on the one field a password manager refills for free.
   */
  values: Record<string, string>
  /**
   * A monotonic counter, incremented on every submit.
   *
   * It exists so the client can tell "the same error again" from "no new result". Two identical
   * failed submits produce an identical state object, React sees no change, and the effect that
   * moves focus to the message never re-runs — leaving a customer who pressed the button twice with
   * no evidence anything happened. This is what makes the announcement reliable, and it is the
   * form-level half of the focus problem Phase 3 handed here when `Button` chose a real `disabled`
   * attribute over `aria-disabled` (see `components/ui/button.tsx`).
   */
  submissionCount: number
}

export const initialAuthFormState: AuthFormState = {
  status: 'idle',
  message: null,
  fieldErrors: {},
  values: {},
  submissionCount: 0,
}
