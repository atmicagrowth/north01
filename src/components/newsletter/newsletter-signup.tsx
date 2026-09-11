'use client'

import { useActionState, useState } from 'react'

import { useActionResult } from '@/components/analytics/use-action-result'
import { trackEvent } from '@/lib/analytics/track'

import { Field } from '@/components/auth/field'
import { FormStatus } from '@/components/auth/form-status'
import { Button } from '@/components/ui/button'
import { subscribe } from '@/lib/newsletter/actions'
import { initialNewsletterFormState } from '@/lib/newsletter/form-state'
import { TurnstileWidget } from '@/components/security/turnstile-widget'

/**
 * **The footer's newsletter column.** Structure §20 lists it among the footer's five columns and
 * structure §4's step 8 is *"Newsletter/footer"* — one item, because that is where it lives.
 *
 * `SiteFooter` has taken a `newsletter` slot since **Phase 3**, whose grid widens from three columns
 * to four the moment it is filled. **DEV-25** left it empty because the subscriber collection did
 * not exist yet; Phase 6 built it, so this fills it. **DEV-42**.
 *
 * There is deliberately **no newsletter block on the homepage**. A block plus this column would put
 * two signup forms on one page — a duplicate surface, not a second route into commerce.
 *
 * ### It reuses Phase 7's form components unchanged
 *
 * `Field` and `FormStatus` come from `components/auth/`, and moving them here would touch four
 * Phase 7 forms for a directory name. What they buy is the wiring that is quietly got wrong
 * everywhere: `aria-invalid` on the control, `aria-describedby` pointing at the message, an icon so
 * the error is not colour-only (WCAG 1.4.1), and focus moved to the result on submit.
 *
 * ### The field is `newsletterEmail`, and it must stay that way
 *
 * This footer renders on **every route**, including `/login` and `/register`, which already have a
 * field named `email`. `Field` derives `id`, `htmlFor` and both `aria-describedby` targets from
 * `name`, so two `email` fields on one page would cross-wire the sign-in form's label to this input.
 * The rename is the fix that changes no Phase 7 component; passing an `id` override would not work,
 * because every id in that component is derived from the name.
 *
 * ### Progressive enhancement, stated honestly
 *
 * `useActionState` makes this a Client Component, so with JavaScript disabled the submit queues
 * rather than posting. That is the same trade every Phase 7 form already makes, and it is written
 * down rather than claimed otherwise.
 */
export function NewsletterSignup() {
  const [state, action, pending] = useActionState(subscribe, initialNewsletterFormState)
  /*
   * The security check waits for the form to be used. This footer is on every page, and mounted
   * eagerly Turnstile ran a third-party challenge on every page view before anyone touched it
   * (§30.1c). The first focus inside the form loads it — long before the customer can submit.
   */
  const [engaged, setEngaged] = useState(false)

  /*
   * **§25.1a's `newsletter_signup`, on a successful subscribe.** Not on submit: the action
   * validates the address and can refuse, and a rejected email is not a signup.
   *
   * `source` is `'footer'` because that is where this renders — `SiteFooter` mounts it on every
   * route. If a second placement ever appears it gets its own value rather than sharing this one;
   * a signup event that cannot say where it came from cannot answer the question it exists for.
   */
  useActionResult(state, (result) => {
    if (result.status === 'success') {
      trackEvent('newsletter_signup', { source: 'footer' })
    }
  })

  return (
    <div>
      <h2 id="newsletter-heading" className="font-sans text-meta uppercase text-foreground-muted">
        Newsletter
      </h2>

      {/*
        **The copy must not promise a send.** "No more than twice a month" is a cadence, and Phase 19
        owns email — nothing in this application can send anything today, so that sentence was the
        one thing on the page contradicting three written claims that it promises nothing. What is
        true right now is that the address is recorded; say that.
      */}
      <p className="mt-m max-w-measure font-sans text-body-sm text-foreground-muted">
        Add your address for collection releases and campaign stories.
      </p>

      <form
        action={action}
        aria-labelledby="newsletter-heading"
        className="mt-m flex flex-col gap-4"
        noValidate
        onFocusCapture={() => setEngaged(true)}
      >
        <FormStatus state={state} />

        {/*
          The label is "Email address for the newsletter", not "Email". The footer renders on every
          route, so on `/login` and `/register` a bare "Email" produced **two textboxes with the
          same accessible name** — legal HTML, and unusable in a screen reader's form-controls list,
          where the two are indistinguishable. The `name` was already disambiguated for the `id`
          collision; this disambiguates it for a listener.
        */}
        <Field
          name="newsletterEmail"
          defaultValue={state.values.newsletterEmail ?? ''}
          label="Email address for the newsletter"
          type="email"
          autoComplete="email"
          required
          error={state.fieldErrors.newsletterEmail}
        />

        <TurnstileWidget active={engaged} submissionCount={state.submissionCount} />

        <Button type="submit" variant="secondary" loading={pending}>
          Sign up
        </Button>
      </form>
    </div>
  )
}
