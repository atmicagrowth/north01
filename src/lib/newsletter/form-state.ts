/**
 * The shape the newsletter form's `useActionState` holds.
 *
 * It lives beside `actions.ts` rather than in it because **a `'use server'` module may only export
 * async functions** — Next enforces that, and a `const` export there is a build error. The same
 * split, for the same reason, as `lib/auth/form-state.ts`.
 *
 * The shape is duplicated from the auth one rather than shared. Unifying them would mean a third
 * module and an edit to four Phase 7 forms, for a type that carries no behaviour — and the two are
 * not actually the same: this one echoes a differently-named field and has no notion of a password
 * it must refuse to echo.
 */
export type NewsletterFormState = {
  status: 'error' | 'idle' | 'success'
  /** A form-level sentence, rendered in the focusable `role="alert"` region `FormStatus` provides. */
  message: null | string
  /** Field name → message, wired to the control with `aria-describedby`. */
  fieldErrors: Record<string, string>
  /**
   * What was typed, echoed back.
   *
   * Not polish — a correction. React **resets** an uncontrolled form once its action resolves, so
   * without this a rejected address leaves the customer staring at an empty box. Measured in a
   * browser during Phase 7; the same mechanism applies here.
   */
  values: Record<string, string>
  /**
   * Incremented on every submit.
   *
   * Two identical failures produce an identical state object, React sees no change, and
   * `FormStatus`'s focus effect never re-runs — leaving someone who pressed the button twice with no
   * evidence anything happened. This counter is what makes the announcement reliable.
   */
  submissionCount: number
}

export const initialNewsletterFormState: NewsletterFormState = {
  status: 'idle',
  message: null,
  fieldErrors: {},
  values: {},
  submissionCount: 0,
}
