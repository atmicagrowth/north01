'use server'

import { getPayloadClient } from '@/lib/payload'
import { publicFormRefusal } from '@/lib/security/guard'

import type { NewsletterFormState } from './form-state'
import { NewsletterSchema } from './schemas'

/**
 * **Newsletter signup.** Plan §10.1a lists *"Newsletter"* among the homepage blocks, feature matrix
 * §3 lists it as a homepage section, and structure §4's step 8 names it *"Newsletter/footer"*.
 *
 * ### Why this is real functionality and not §0.1.17's fake control
 *
 * The row this writes is the artefact `newsletter-subscribers` was designed to hold: an address, a
 * **consent timestamp**, a **source**, and a status. Plan §6.1n specifies exactly those four fields
 * and nothing more, and its own docblock names this phase as the owner — *"there is no signup form
 * yet; the newsletter block is plan §10.1a. The phase that builds the form owns the decision."*
 *
 * **DEV-25** deferred the footer column in Phase 3 on the stated grounds that *"a signup field
 * rendered now would post nowhere — the subscriber collection is Phase 6.1n."* Phase 6 built it. The
 * premise expired, and the deviation is discharged here as **DEV-42**.
 *
 * What is *not* built is the mail: no welcome email, no confirmation, no double opt-in. **Phase 19**
 * owns transactional email and §19.1b's template list. These rows are therefore **single opt-in** —
 * `status: 'subscribed'` immediately, which is the only representable state in the Phase 6 schema —
 * and Phase 19 owns reconciling that with a confirmation flow if it wants one. Nothing on the page
 * claims an email is coming.
 *
 * ### Two deliberate departures from the Phase 7 precedent
 *
 * **1. This writes with `overrideAccess: true`, and `newsletter-subscribers.create` stays
 * `isStaff`.** `register` does the opposite — `overrideAccess: false`, on the principle that *"the
 * storefront gets no privilege the REST API does not have"* — and that principle is right for an
 * auth collection, which must be publicly creatable or nobody could sign up.
 *
 * It is wrong here, because of a property this collection has and `customers` does not: `email` is
 * `unique` and `read` is `isStaff`. An openly creatable endpoint would answer a duplicate address
 * with a constraint error and a fresh one with a success — turning `POST
 * /api/newsletter-subscribers` into a **membership-enumeration oracle over personal data** for
 * anyone with a list of addresses. Keeping `create` staff-only means this Server Action is the only
 * write path, and Next gives it an Origin/Host check for free.
 *
 * **2. A duplicate address returns success.** The registration form deliberately *does* disclose
 * that an email is taken (**DEV-31**), because an account either exists or it does not and the
 * person submitting is the account holder. A mailing-list membership is not the submitter's to
 * learn about: anyone can type anyone's address into a footer. So both paths return the identical
 * message, and the difference is recorded in the log rather than in the response.
 *
 * ### What is owed
 *
 * **Rate limiting — Phase 26**, in the same words `Customers.ts` uses for registration: it is
 * *"recorded as owed rather than improvised here."* §26.1a puts Turnstile on the newsletter
 * specifically.
 *
 * **What protects this today, stated accurately.** An earlier version of this paragraph named two
 * protections that are not ones, and Phase 10's audit disproved both by replaying a captured Server
 * Action request:
 *
 * - Next's **Origin/Host check is a browser-CSRF defence, not authentication.** A request that
 *   simply omits the `Origin` header is accepted and the row is written. A *wrong* origin is
 *   rejected; no origin is not.
 * - **There is no 320-character column cap.** `newsletter_subscribers.email` is `varchar` with no
 *   length. The only cap is Zod's, in this action.
 *
 * So the honest position is: this is an unauthenticated write endpoint with a Zod-shaped body, and
 * the only thing standing between it and a script is that nobody has pointed one at it. That is the
 * same exposure `Customers.ts` records for registration, and it is owed to the same phase. It is
 * written down here rather than papered over, because a security note that overstates its
 * protections is worse than none.
 */

/** Zod's field errors, first message per field — a control can only point at one. */
function parse(formData: FormData) {
  const result = NewsletterSchema.safeParse(Object.fromEntries(formData))

  if (result.success) {
    return { ok: true as const, data: result.data }
  }

  const fieldErrors: Record<string, string> = {}

  for (const issue of result.error.issues) {
    const field = issue.path[0]

    if (typeof field === 'string' && !fieldErrors[field]) {
      fieldErrors[field] = issue.message
    }
  }

  return { ok: false as const, fieldErrors }
}

/**
 * The one message both the new-subscriber and already-subscribed paths return.
 *
 * It says what happened without confirming membership, and it does not promise an email — because
 * Phase 19 has not built one and a message that promises mail nobody sends is the same dishonesty
 * as a control that does nothing.
 */
const CONFIRMATION = 'Thank you — you are on the list.'

/**
 * Is this the `unique` index on `email` refusing a second row?
 *
 * Payload surfaces a constraint violation as a `ValidationError` whose issue path names the field.
 * The check is deliberately narrow: anything else must not be mistaken for "already subscribed" and
 * reported to the customer as success.
 */
function isDuplicateEmail(error: unknown): boolean {
  const data = (error as { data?: { errors?: { path?: unknown }[] } })?.data

  if (Array.isArray(data?.errors) && data.errors.some((issue) => issue?.path === 'email')) {
    return true
  }

  // The raw Postgres path, in case the write ever bypasses Payload's own validation.
  return (error as { code?: unknown })?.code === '23505'
}

export async function subscribe(
  previous: NewsletterFormState,
  formData: FormData,
): Promise<NewsletterFormState> {
  /*
   * **§26.1a, before anything else happens.** Verification is the first gate rather than the last,
   * so a refused request costs one Cloudflare round trip and never reaches a query, a hash or a
   * write. It runs before validation too: a bot's malformed payload should not get a free field-by-
   * field critique of the form it is attacking.
   */
  const refused = await publicFormRefusal(formData)

  if (refused) {
    return {
      fieldErrors: {},
      message: refused,
      status: 'error',
      submissionCount: previous.submissionCount + 1,
      values: {},
    }
  }

  const submitted = formData.get('newsletterEmail')
  const values: Record<string, string> =
    typeof submitted === 'string' && submitted !== '' ? { newsletterEmail: submitted } : {}

  const parsed = parse(formData)

  if (!parsed.ok) {
    /*
     * The message is not optional, and `null` here was a real accessibility defect.
     *
     * `FormStatus` renders nothing without one, so on a validation failure there was no live region
     * on the page at all — and because `Button` uses a real `disabled` attribute for its busy state,
     * focus had already fallen to `<body>`. The customer got a red field they were not looking at
     * and no announcement. `Field` deliberately clears `role="alert"` on its own message
     * (`field.tsx`: *"summary announces, fields describe"*), which is right — and only works when
     * there is a summary. `lib/auth/actions.ts` supplies one for exactly this reason.
     */
    return {
      status: 'error',
      message: 'Check the highlighted field.',
      fieldErrors: parsed.fieldErrors,
      values,
      submissionCount: previous.submissionCount + 1,
    }
  }

  const { newsletterEmail: email } = parsed.data

  try {
    const payload = await getPayloadClient()

    /*
     * **Attempt the write unconditionally, and swallow the duplicate.**
     *
     * The obvious shape — read, then create only if absent — is the one this action had, and it
     * reintroduced as a *timing* oracle the very thing the design set out to prevent: an unknown
     * address cost a SELECT plus an INSERT, a known one cost a SELECT, and the difference is
     * measurable. It was a concurrency bug too, since two submissions of the same new address could
     * both find nothing and both insert.
     *
     * Attempting the insert every time makes both paths cost the same work, and the `unique` index
     * on `email` — not application logic — is what makes the second one a no-op. Honouring a prior
     * unsubscribe falls out of the same mechanism: the row already exists, so the insert fails and
     * nothing is changed. That row exists precisely so *"a later import cannot resurrect the
     * address"* (`NewsletterSubscribers.ts`).
     */
    try {
      await payload.create({
        collection: 'newsletter-subscribers',
        overrideAccess: true,
        /*
         * `consentedAt` is written explicitly rather than left to the field's `defaultValue`. It is
         * the record that makes the signup defensible, and the moment it should carry is the moment
         * consent was given — which is here, not whenever a default happens to be evaluated.
         */
        data: {
          email,
          consentedAt: new Date().toISOString(),
          source: 'footer',
          status: 'subscribed',
        },
      })
    } catch (error) {
      /*
       * A duplicate is the expected outcome for an address already on the list, and it must be
       * indistinguishable from a fresh signup. Anything else is a real failure and is rethrown to
       * the outer handler.
       */
      if (!isDuplicateEmail(error)) {
        throw error
      }
    }

    return {
      status: 'success',
      message: CONFIRMATION,
      fieldErrors: {},
      values: {},
      submissionCount: previous.submissionCount + 1,
    }
  } catch (error) {
    console.error('[newsletter] Signup failed.', error)

    /*
     * Recoverable by design. A Server Action id rotates at least every fourteen days, so a tab left
     * open across a deployment can fail with nothing the customer did wrong — the copy has to point
     * at the fix rather than describing a fault.
     */
    return {
      status: 'error',
      message: 'That did not go through. Please refresh the page and try again.',
      fieldErrors: {},
      values,
      submissionCount: previous.submissionCount + 1,
    }
  }
}
