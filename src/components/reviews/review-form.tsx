'use client'

import { useActionState } from 'react'

import { Field } from '@/components/auth/field'
import { FormStatus } from '@/components/auth/form-status'
import { Button } from '@/components/ui/button'
import { initialReviewFormState } from '@/lib/reviews/form-state'
import { submitReviewAction } from '@/lib/reviews/actions'
import { MAX_RATING, MIN_RATING, REVIEW_SECTION_COPY } from '@/lib/reviews/rules'

/**
 * **The review form** — plan §21.1a.
 *
 * Rendered **only** when the server has already decided this customer may submit. A form that
 * collects a review and then refuses it is §0.1.17's fake control, so the refusals are rendered
 * instead of the form, by the section above.
 *
 * `Field` and `FormStatus` are Phase 7's and are reused unchanged — the newsletter form set that
 * precedent rather than copying them for a directory name. Their division of accessibility labour is
 * fixed and this depends on it: `FormStatus` is the focusable `role="alert"` summary and is rendered
 * **above** the fields; each `Field` describes one control and deliberately does not announce. It only
 * works if a summary is always supplied, which is why the action never returns a `null` message on
 * failure.
 *
 * `noValidate` because the browser's own bubbles cannot be styled, cannot be focused reliably, and
 * would pre-empt the summary that is doing the announcing.
 *
 * ### The rating is a radio group, not a star widget
 *
 * Five radios with real labels. A row of clickable stars is a custom widget that has to reimplement
 * arrow-key traversal, focus management and an accessible name for every option — all of which a
 * native radio group already has and none of which it can get wrong. The stars belong on the
 * *reading* side, where `Rating` renders them and says the number out loud.
 */
export function ReviewForm({
  defaultDisplayName,
  productId,
}: {
  /** The customer's first name, offered as a starting point. They may publish anything they like. */
  defaultDisplayName: string
  productId: number
}) {
  const [state, action, pending] = useActionState(submitReviewAction, initialReviewFormState)

  if (state.status === 'success') {
    /*
     * §21.1b, said out loud. The review is `pending` and will not appear until a person approves it;
     * a form that simply emptied itself would look like the review had been published.
     */
    return (
      <p
        aria-live="polite"
        className="max-w-measure border-t border-border pt-6 font-sans text-body-sm text-foreground"
      >
        {state.message}
      </p>
    )
  }

  return (
    <form action={action} className="flex max-w-measure flex-col gap-m" noValidate>
      <input name="productId" type="hidden" value={productId} />

      <FormStatus state={state} />

      <fieldset className="flex flex-col gap-2">
        <legend className="font-sans text-micro uppercase text-foreground-muted">Rating</legend>

        <div className="flex flex-wrap gap-m">
          {Array.from({ length: MAX_RATING }, (_, index) => {
            const value = MIN_RATING + index

            return (
              <label className="flex items-center gap-2 font-sans text-body-sm" key={value}>
                <input
                  defaultChecked={state.values.reviewRating === String(value)}
                  name="reviewRating"
                  type="radio"
                  value={value}
                />
                {value}
              </label>
            )
          })}
        </div>

        {state.fieldErrors.reviewRating ? (
          <p className="font-sans text-body-sm text-error">{state.fieldErrors.reviewRating}</p>
        ) : null}
      </fieldset>

      <Field
        defaultValue={state.values.reviewDisplayName ?? defaultDisplayName}
        error={state.fieldErrors.reviewDisplayName}
        hint="Shown publicly with your review. It does not have to be your full name."
        label="Name to show with your review"
        name="reviewDisplayName"
        required
      />

      <Field
        defaultValue={state.values.reviewTitle ?? ''}
        error={state.fieldErrors.reviewTitle}
        label="Review title (optional)"
        name="reviewTitle"
      />

      <div className="flex flex-col gap-2">
        <label
          className="font-sans text-micro uppercase text-foreground-muted"
          htmlFor="reviewBody"
        >
          Your review
        </label>
        <textarea
          aria-describedby={state.fieldErrors.reviewBody ? 'reviewBody-error' : undefined}
          className="min-h-32 border border-border-control bg-surface px-3 py-2 font-sans text-body-sm text-foreground"
          defaultValue={state.values.reviewBody ?? ''}
          id="reviewBody"
          name="reviewBody"
          required
        />
        {state.fieldErrors.reviewBody ? (
          <p className="font-sans text-body-sm text-error" id="reviewBody-error">
            {state.fieldErrors.reviewBody}
          </p>
        ) : null}
      </div>

      <div>
        <Button disabled={pending} size="lg" type="submit" variant="primary">
          {REVIEW_SECTION_COPY.submitTitle}
        </Button>
      </div>

      <p className="font-sans text-body-sm text-foreground-muted">
        Reviews are checked before they appear.
      </p>
    </form>
  )
}
