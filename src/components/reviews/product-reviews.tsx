import type { PublicReview } from '@/lib/reviews/read'
import type { ReviewEligibility, ReviewSummary, Rating as RatingValue } from '@/lib/reviews/rules'

import { PageContainer } from '@/components/layout/page-container'
import { Section, SectionHeading } from '@/components/layout/section'
import { ReviewForm } from '@/components/reviews/review-form'
import { Link } from '@/components/ui/link'
import { Rating } from '@/components/ui/rating'
import {
  distributionPercent,
  MAX_RATING,
  MIN_RATING,
  REVIEW_COPY,
  REVIEW_SECTION_COPY,
} from '@/lib/reviews/rules'

/**
 * **The reviews block on the product page** — plan §13.1f.
 *
 * > *"Display: average rating, review count, distribution, review entries, verified indicator, photo
 * > reviews where available. If no reviews: do not show an empty star histogram. Show a graceful 'be
 * > the first to review' state if review creation is enabled."*
 *
 * Everything on that list is here except the photographs, which cannot be built yet — see
 * **DEV-71** and the note in `lib/reviews/actions.ts`.
 *
 * ### The histogram is absent, not empty
 *
 * *"Do not show an empty star histogram"* is the only place in the corpus where the plan pre-agrees
 * on an **absence**, and it is worth honouring literally: five bars all at zero is not a neutral
 * chart, it reads as five one-star reviews at a glance. So a product with no reviews gets one
 * sentence and no chart at all.
 *
 * ### Everything rendered here is approved
 *
 * §21.1b. `readProductReviews` filters on `status: 'approved'`, and `Reviews.access.read` narrows an
 * anonymous read to the same thing independently — so a pending review cannot reach this component
 * through either door.
 */
export function ProductReviews({
  displayName,
  eligibility,
  productId,
  reviews,
  summary,
}: {
  /** Offered as the byline's starting point. Empty for a signed-out visitor, who sees no form. */
  displayName: string
  eligibility: ReviewEligibility & { ownReviewPending?: boolean }
  productId: number
  reviews: PublicReview[]
  summary: ReviewSummary
}) {
  const ratings = Array.from(
    { length: MAX_RATING },
    (_, index) => (MAX_RATING - index) as RatingValue,
  )

  return (
    <Section data-section="reviews" divider="top" spacing="tight">
      <PageContainer>
        <SectionHeading className="mb-l">{REVIEW_SECTION_COPY.title}</SectionHeading>

        <div className="grid gap-xl lg:grid-cols-12">
          <div className="flex flex-col gap-l lg:col-span-5">
            {summary.count === 0 ? (
              /* §13.1f: the graceful empty state, and deliberately no histogram beside it. */
              <p className="max-w-measure font-sans text-body text-foreground-muted">
                {REVIEW_SECTION_COPY.empty}
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <p className="font-serif text-display-l text-foreground-bright">
                    {summary.average}
                  </p>

                  <Rating
                    label={`${summary.average} out of ${MAX_RATING} stars, from ${summary.count} ${
                      summary.count === 1 ? 'review' : 'reviews'
                    }`}
                    size="lg"
                    value={summary.average ?? 0}
                  />

                  <p className="font-sans text-meta uppercase text-foreground-muted">
                    {summary.count} {summary.count === 1 ? 'review' : 'reviews'}
                  </p>
                </div>

                {/*
                  The distribution. A definition list rather than a table: each row is a label and a
                  value, and the bar is presentation of the value rather than a third thing.
                */}
                <dl className="flex flex-col gap-2">
                  {ratings.map((rating) => {
                    const percent = distributionPercent(summary, rating)

                    return (
                      <div className="flex items-center gap-s" key={rating}>
                        <dt className="w-16 font-sans text-micro uppercase text-foreground-muted">
                          {rating} star{rating === 1 ? '' : 's'}
                        </dt>

                        <dd className="flex flex-1 items-center gap-s">
                          <span
                            aria-hidden="true"
                            className="h-1 flex-1 overflow-hidden bg-surface-raised"
                          >
                            <span
                              className="block h-full bg-foreground-muted"
                              style={{ width: `${percent}%` }}
                            />
                          </span>

                          <span className="w-10 text-right font-sans text-micro text-foreground-muted">
                            {summary.distribution[rating]}
                          </span>
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              </>
            )}

            {/*
              The form, or the reason there is not one. Never both, and never a form that would be
              refused — plan §0.1.17.
            */}
            {eligibility.canReview ? (
              <div className="border-t border-border pt-m">
                <h3 className="mb-m font-sans text-meta uppercase text-foreground-muted">
                  {REVIEW_SECTION_COPY.submitTitle}
                </h3>

                <ReviewForm defaultDisplayName={displayName} productId={productId} />
              </div>
            ) : (
              <p className="border-t border-border pt-m font-sans text-body-sm text-foreground-muted">
                {/* Their review is waiting for a person (§21.1b) — say that, not merely that it exists. */}
                {eligibility.reason === 'alreadyReviewed' && eligibility.ownReviewPending
                  ? REVIEW_SECTION_COPY.pending
                  : REVIEW_COPY[eligibility.reason]}{' '}
                {eligibility.reason === 'notSignedIn' ? (
                  <Link href="/login?next=/account">Sign in</Link>
                ) : null}
              </p>
            )}
          </div>

          <div className="lg:col-span-7">
            {reviews.length > 0 ? (
              <ul className="flex flex-col border-t border-border">
                {reviews.map((review) => (
                  <li className="flex flex-col gap-2 border-b border-border py-m" key={review.id}>
                    <div className="flex flex-wrap items-center gap-s">
                      <Rating value={review.rating} />

                      {review.verifiedPurchase ? (
                        /*
                          §13.1f's "verified indicator". A statement about the past, stored on the row
                          rather than re-derived, so it does not flicker as orders are refunded.
                        */
                        <span className="font-sans text-micro uppercase text-foreground-muted">
                          {REVIEW_SECTION_COPY.verified}
                        </span>
                      ) : null}
                    </div>

                    {review.title ? (
                      <p className="font-sans text-heading-s text-foreground-bright">
                        {review.title}
                      </p>
                    ) : null}

                    {/*
                      Customer text, rendered as a React text node. React escapes it; nothing here
                      interprets it as markup, and there is no `dangerouslySetInnerHTML` anywhere in
                      this feature.
                    */}
                    <p className="max-w-measure whitespace-pre-line font-sans text-body-sm text-foreground">
                      {review.body}
                    </p>

                    <p className="font-sans text-micro uppercase text-foreground-muted">
                      {review.displayName}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </PageContainer>
    </Section>
  )
}

export { MIN_RATING }
