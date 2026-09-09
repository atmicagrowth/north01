/**
 * **Plan §21's decisions, as pure functions.**
 *
 * The phase prompt asks for exactly two tests — *"unauthorized submissions and duplicate reviews"* —
 * and both are decisions rather than queries, so both are decidable here without a database.
 *
 * `lib/reviews/read.ts` next door does the reads and the writes. Neither decides anything.
 *
 * ---
 *
 * ### The corpus disagrees with itself about reviews, twice
 *
 * Plan §21.1a and feature matrix §9 are not the same specification, and `AGENTS.md` ranks the plan
 * above the matrix. Both conflicts are resolved here and recorded as **DEV-69**:
 *
 * 1. **Is a purchase required to review?** The plan hedges twice — *"**If** verified purchase is
 *    required"*, and the prompt's *"**optional** verified-purchase checks"*. The matrix lists
 *    *"review for non-owned product"* as an abuse case, which only makes sense if ownership is a
 *    gate. The plan wins: **a purchase is a badge, not a gate.**
 * 2. **Which order state counts?** The plan says a **paid** order. The matrix says *"order not
 *    delivered yet"*, which is four states further along §18.1b's machine. The plan wins: **paid.**
 */

/* -------------------------------------------------------------------------------------------------
 * Rating
 * ---------------------------------------------------------------------------------------------- */

export const MIN_RATING = 1
export const MAX_RATING = 5

export type Rating = 1 | 2 | 3 | 4 | 5

/**
 * **The phase prompt's *"rating validation"*.**
 *
 * A whole number from one to five. `min`/`max` alone would admit 3.7 — which is why `Reviews.rating`
 * carries a redundant `validate` closure beside its bounds, and why this exists as well: a server
 * action is one door into the data and the REST API is another, so the rule is enforced at both.
 */
export function isRating(value: unknown): value is Rating {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_RATING &&
    value <= MAX_RATING
  )
}

/* -------------------------------------------------------------------------------------------------
 * The summary — plan §13.1f
 * ---------------------------------------------------------------------------------------------- */

export type ReviewSummary = {
  /** One decimal, or `null` when there is nothing to average. Never `0` — see below. */
  average: null | number
  count: number
  /** How many reviews gave each rating, keyed 1–5. All zero when there are none. */
  distribution: Record<Rating, number>
}

/**
 * **§13.1f's *"average rating, review count, distribution"*, computed rather than cached.**
 *
 * `Products.ts` decided in Phase 6 not to store review aggregates, and this is the other half of that
 * decision. Caching them would mean a moderator approving a review has to invalidate a column on a
 * different table, and the day that hook fails is the day a product page shows a rating nobody gave.
 *
 * **`average` is `null` when there are no reviews, never `0`.** Zero is a rating a customer could
 * have given; absence is not. `lib/money.ts` made the same distinction for a price and it is the same
 * mistake to make here — a product showing "0.0 stars" reads as universally hated rather than as
 * unreviewed, which is the difference between no information and false information.
 *
 * Rounded to one decimal, because a rating printed to more is a precision the sample does not have.
 */
export function summariseReviews(ratings: readonly number[]): ReviewSummary {
  const distribution: Record<Rating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }

  let total = 0
  let count = 0

  for (const value of ratings) {
    if (!isRating(value)) {
      continue
    }

    distribution[value] += 1
    total += value
    count += 1
  }

  return {
    average: count === 0 ? null : Math.round((total / count) * 10) / 10,
    count,
    distribution,
  }
}

/**
 * What proportion of reviews gave this rating, as a percentage.
 *
 * Zero when there are none, which is what stops a histogram dividing by zero — and §13.1f forbids
 * rendering the histogram at all in that case, so this is the second line of defence rather than the
 * first.
 */
export function distributionPercent(summary: ReviewSummary, rating: Rating): number {
  return summary.count === 0 ? 0 : Math.round((summary.distribution[rating] / summary.count) * 100)
}

/* -------------------------------------------------------------------------------------------------
 * Who may submit — plan §21.1a and §21.1c
 * ---------------------------------------------------------------------------------------------- */

/**
 * Why a customer cannot leave a review. One member per way the answer is no, so the harness asserts
 * the **decision** and the page can say something a person can act on.
 */
export type ReviewRefusal = 'alreadyReviewed' | 'notSignedIn' | 'productUnavailable' | 'suspended'

export type ReviewEligibility =
  { canReview: false; reason: ReviewRefusal } | { canReview: true; verifiedPurchase: boolean }

/**
 * **§21.1a's gate, and the four §21.1c cases that close it.**
 *
 * > *"Only authenticated customers should submit reviews unless a deliberately designed
 * > verified-review workflow is implemented."*
 *
 * No such workflow is designed anywhere in the corpus, so authentication is the gate — and it is the
 * **only** gate. A purchase is not required; it is recorded, and shown as a badge.
 *
 * The refusals, in the order they are reported, which runs from least to most actionable:
 *
 * - **`suspended`** — §21.1c's *"customer account disabled"*. Checked first because nothing else this
 *   customer could do would change the answer. Note that `getCustomer()` already returns `null` for a
 *   suspended account, so in practice this arrives as `notSignedIn`; it is a distinct member because
 *   the *rule* is distinct, and a future surface that resolves a customer differently should not have
 *   to rediscover it.
 * - **`notSignedIn`** — the gate itself. The page shows a sign-in link rather than a form, because a
 *   form that collects a review and then refuses it is §0.1.17's fake control.
 * - **`productUnavailable`** — §21.1c's *"deleted product"*. A product that is unpublished, scheduled
 *   or soft-deleted cannot be reviewed; the review would be about something nobody can see.
 * - **`alreadyReviewed`** — §21.1c's *"duplicate review by same customer for same product"*, and the
 *   second of the two behaviours the prompt asks to be tested by name. This is the *courtesy* check:
 *   the guarantee is the compound unique index on `(product, customer)`, which Phase 6 built with
 *   both columns `required` precisely so it would bite. Asking here means the page can say so instead
 *   of the customer discovering it by submitting.
 */
export function reviewEligibility(input: {
  hasReviewed: boolean
  hasPaidOrder: boolean
  productAvailable: boolean
  signedIn: boolean
  suspended: boolean
}): ReviewEligibility {
  if (input.suspended) {
    return { canReview: false, reason: 'suspended' }
  }

  if (!input.signedIn) {
    return { canReview: false, reason: 'notSignedIn' }
  }

  if (!input.productAvailable) {
    return { canReview: false, reason: 'productUnavailable' }
  }

  if (input.hasReviewed) {
    return { canReview: false, reason: 'alreadyReviewed' }
  }

  return { canReview: true, verifiedPurchase: input.hasPaidOrder }
}

/* -------------------------------------------------------------------------------------------------
 * Copy
 * ---------------------------------------------------------------------------------------------- */

export const REVIEW_COPY: Record<ReviewRefusal, string> = {
  alreadyReviewed: 'You have already reviewed this product. Thank you.',
  notSignedIn: 'Sign in to leave a review.',
  productUnavailable: 'This product is no longer available to review.',
  suspended: 'This account cannot leave reviews. Contact us if you think that is wrong.',
}

export const REVIEW_SECTION_COPY = {
  /**
   * §13.1f: *"show a graceful 'Be the first to review' state if review creation is enabled."*
   *
   * The same section forbids the other half outright — *"do not show an empty star histogram"* — so
   * a product with no reviews gets this sentence and no chart at all.
   */
  empty: 'No reviews yet. Be the first to review this product.',
  /**
   * §21.1b is why this exists: a review lands `pending` and is not public until a person approves it.
   * Telling the customer so is the difference between moderation and a review that vanishes on
   * submit.
   */
  pending: 'Thank you. Your review has been submitted and will appear once it has been checked.',
  submitTitle: 'Write a review',
  title: 'Reviews',
  verified: 'Verified purchase',
} as const
