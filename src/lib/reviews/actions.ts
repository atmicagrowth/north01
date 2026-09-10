'use server'

import { revalidatePath } from 'next/cache'

import { getCustomer } from '@/lib/auth/session'
import { getPayloadClient } from '@/lib/payload'
import { publicFormRefusal } from '@/lib/security/guard'

import type { ReviewFormState } from './form-state'
import { hasPaidOrderFor, isReviewableProduct } from './read'
import { REVIEW_COPY, REVIEW_SECTION_COPY } from './rules'
import { ReviewSchema } from './schemas'

/**
 * **Submitting a review** — plan §21.1a, §21.1b and §21.1c.
 *
 * ---
 *
 * ### The three things the browser is not allowed to decide
 *
 * `status`, `verifiedPurchase` and `customer` are all absent from the form and all absent from this
 * action's inputs, and each is absent for its own reason:
 *
 * - **`status`** defaults to `pending` on the column, and the field carries
 *   `access: { create: isStaffField, update: isStaffField }` — so a review created through *any* door
 *   lands pending no matter what the request body says. §21.1b's moderation rule is expressed as
 *   access control rather than as a hook somebody could forget to run.
 * - **`verifiedPurchase`** is staff-only for the same reason and is set here, from an order lookup,
 *   because a badge the submitter can assert is not a badge.
 * - **`customer`** is forced by `enforceCustomerOwnership('customer')` on create *and* on update. The
 *   collection's `create: isActiveCustomer` only asks whether the caller is an active customer, so
 *   `POST /api/reviews` with `{ customer: 42 }` would pass it; forcing the value is what closes that.
 *   Phase 7's note: *"reassigning an existing row is the same attack a second later."*
 *
 * ### The duplicate is caught by the database, not by a check before it
 *
 * §21.1c's first abuse case. `Reviews` carries a compound unique index on `(product, customer)` with
 * both columns `required` — Phase 6 made `customer` required precisely so the index would bite, since
 * Postgres treats NULLs as distinct.
 *
 * So this attempts the insert and catches the violation, rather than reading first. The newsletter
 * action recorded why read-then-create is wrong twice over: it is a concurrency bug, and it is a
 * measurable **timing oracle**, because an unknown value costs a SELECT plus an INSERT while a known
 * one costs only the SELECT.
 *
 * The catch is deliberately **narrow**. Anything that is not a uniqueness violation on this
 * collection must not be reported to the customer as "you already reviewed this".
 *
 * ### What is deliberately not here
 *
 * **No rate limiting.** Plan §26.1a names *"review submission"* as a Turnstile surface, and Turnstile
 * is Phase 26's, as is its dependency. Recorded as owed rather than improvised here — and stated
 * without overclaiming: this is an authenticated write endpoint with a Zod-shaped body, and the only
 * thing bounding it is that a customer may submit one review per product.
 *
 * **No profanity filter.** §21.1c lists *"profanity/spam"* and neither the plan nor the features
 * matrix specifies a mechanism, a word list or a service, and no phase is assigned one. The answer
 * this project gives is human moderation: every review lands `pending` and a person approves it. See
 * **DEV-70**.
 *
 * **No photo upload.** §6.1j and §13.1f both mention review photos and the column exists — but
 * `media.create` is staff-only, and **D-28** records that media bytes are public the moment they are
 * uploaded. An unmoderated review photo would therefore be publicly fetchable before any person had
 * seen it, which is §21.1b's rule defeated by the one field that bypasses it. See **DEV-71**.
 */
export async function submitReviewAction(
  previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const values = {
    reviewBody: String(formData.get('reviewBody') ?? ''),
    reviewDisplayName: String(formData.get('reviewDisplayName') ?? ''),
    reviewRating: String(formData.get('reviewRating') ?? ''),
    reviewTitle: String(formData.get('reviewTitle') ?? ''),
  }

  const fail = (
    message: null | string,
    fieldErrors: Record<string, string> = {},
  ): ReviewFormState => ({
    fieldErrors,
    message,
    status: 'error',
    submissionCount: previous.submissionCount + 1,
    values,
  })

  /*
   * **§26.1a.** The one form in this shop whose output is *published*, which is why §21.1c gave it
   * moderation and why it gets a challenge as well: moderation catches what is submitted, and this
   * bounds how much there is to catch.
   */
  const refused = await publicFormRefusal(formData)

  if (refused) {
    return fail(refused)
  }

  const productId = Number(formData.get('productId'))

  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return fail('That review could not be submitted. Please refresh the page and try again.')
  }

  const customer = await getCustomer()

  /*
   * §21.1a's gate, and one of the two behaviours the phase prompt asks to be tested by name.
   * `getCustomer()` returns `null` for a suspended account as well as a signed-out one, so §21.1c's
   * "customer account disabled" arrives here too — the page renders no form in either case, and this
   * is the door somebody would have to knock on directly.
   */
  if (!customer) {
    return fail(REVIEW_COPY.notSignedIn)
  }

  const parsed = ReviewSchema.safeParse(values)

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}

    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '')

      /* First message per field only — a control can only point at one. */
      if (field && !fieldErrors[field]) {
        fieldErrors[field] = issue.message
      }
    }

    return fail(
      Object.keys(fieldErrors).length === 1
        ? 'Check the highlighted field.'
        : 'Check the highlighted fields.',
      fieldErrors,
    )
  }

  const payload = await getPayloadClient()

  /* §21.1c's "deleted product" — including unpublished and scheduled, which the read cannot tell apart. */
  if (!(await isReviewableProduct(payload, productId))) {
    return fail(REVIEW_COPY.productUnavailable)
  }

  const verifiedPurchase = await hasPaidOrderFor(payload, customer.id, productId)

  try {
    await payload.create({
      collection: 'reviews',
      data: {
        body: parsed.data.reviewBody,
        displayName: parsed.data.reviewDisplayName,
        product: productId,
        rating: parsed.data.reviewRating,
        title: parsed.data.reviewTitle || undefined,
        verifiedPurchase,
      } as never,
      overrideAccess: true,
    })
  } catch (error) {
    if (isDuplicateReview(error)) {
      return fail(REVIEW_COPY.alreadyReviewed)
    }

    payload.logger.error({ err: error, msg: 'A review could not be saved.', productId })

    return fail('That did not go through. Please refresh the page and try again.')
  }

  /*
   * The product page renders the approved reviews, and this one is not approved — so nothing visible
   * changes yet. Revalidating anyway is what makes the form disappear and the "already reviewed"
   * state appear, which is the change the customer actually made.
   */
  revalidatePath('/product/[slug]', 'page')

  return {
    fieldErrors: {},
    message: REVIEW_SECTION_COPY.pending,
    status: 'success',
    submissionCount: previous.submissionCount + 1,
    values: {},
  }
}

/**
 * The two shapes a refused duplicate arrives in.
 *
 * Payload validates uniqueness before inserting, so a sequential duplicate arrives pre-wrapped as a
 * `ValidationError`. That pre-check is itself a read-then-write and cannot see an uncommitted row, so
 * two submissions racing each other pass it and the **database** refuses the second with SQLSTATE
 * 23505. Matching only the first shape would report a real race as an unexpected failure.
 *
 * Narrow on purpose: a validation error about some other field is a genuine defect and must not be
 * reported to the customer as "you already reviewed this".
 */
function isDuplicateReview(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  if (/duplicate key value|23505/i.test(error.message)) {
    return true
  }

  const data = (error as { data?: { errors?: { path?: string }[] } }).data

  return (
    error.name === 'ValidationError' &&
    Array.isArray(data?.errors) &&
    data.errors.some((entry) => entry?.path === 'product' || entry?.path === 'customer')
  )
}
