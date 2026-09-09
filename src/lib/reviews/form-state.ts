/**
 * **What the review form returns, and its idle value.**
 *
 * A separate file for the constraint recorded twice already in this repository: a `'use server'`
 * module may export **async functions and nothing else**, and the rule is enforced by the
 * server-actions runtime rather than by the compiler — so a const beside the action type-checks,
 * lints, builds, and then answers 500 when somebody presses the button.
 *
 * The shape matches `NewsletterFormState` exactly, because `Field` and `FormStatus` from
 * `components/auth/` consume it and those are shared unchanged. The division of accessibility labour
 * they encode is fixed: `FormStatus` is the focusable `role="alert"` summary, `Field` describes one
 * control — *summary announces, fields describe* — and it only works if a summary is always supplied,
 * which is why `message` is never `null` on failure.
 */

export type ReviewFormState = {
  fieldErrors: Record<string, string>
  message: null | string
  status: 'error' | 'idle' | 'success'
  /**
   * Incremented on every submit. Without it the focus effect cannot tell two identical failures
   * apart and never re-runs — recorded in Phase 7 after a rejected sign-in left focus adrift.
   */
  submissionCount: number
  /** Echoed back, because React resets an uncontrolled form once its action resolves. */
  values: Record<string, string>
}

export const initialReviewFormState: ReviewFormState = {
  fieldErrors: {},
  message: null,
  status: 'idle',
  submissionCount: 0,
  values: {},
}
