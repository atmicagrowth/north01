import { z } from 'zod'

import { MAX_RATING, MIN_RATING } from './rules'

/**
 * **Input shaping for the review form — and explicitly not the security boundary.**
 *
 * `lib/auth/schemas.ts` states the rule this follows: *"This is input shaping, not the security
 * boundary. Every rule here is enforced again underneath… because a server action is one door into
 * the data and the REST API is another."*
 *
 * Every bound below is restated as Payload field config on `Reviews` — `maxLength: 60` on the display
 * name, `minLength: 10, maxLength: 2000` on the body, `min: 1, max: 5` plus an integer `validate` on
 * the rating. A request that skips this schema entirely meets the same limits one layer down.
 *
 * ### The field names are namespaced
 *
 * `reviewTitle`, not `title`. `components/auth/field.tsx` derives the control's `id`, its `htmlFor`
 * and both `aria-describedby` targets from the field **name**, so two forms on one page with a field
 * called `title` would produce duplicate ids and point a label at the wrong control. The newsletter
 * form set this precedent with `newsletterEmail` after the footer began rendering on `/login`.
 */

const bounded = (label: string, max: number) =>
  z
    .string({ error: `Enter ${label}.` })
    .trim()
    .min(1, `Enter ${label}.`)
    .max(max, `That ${label} is too long.`)

export const ReviewSchema = z.object({
  /**
   * §21.1c's *"oversized text"*. Two thousand characters is several long paragraphs; the floor of ten
   * is what stops "ok" being a review, which is the other half of the same problem.
   */
  reviewBody: z
    .string({ error: 'Write a few words about the product.' })
    .trim()
    .min(10, 'Write at least a sentence — ten characters or more.')
    .max(2000, 'That review is too long. Two thousand characters is the limit.'),

  /**
   * The public byline. Separate from the account name by Phase 6's design, so a customer is never
   * forced to publish the name on their card.
   */
  reviewDisplayName: bounded('a name to show with your review', 60),

  reviewRating: z.coerce
    .number({ error: 'Choose a rating.' })
    .int('Choose a rating from one to five.')
    .min(MIN_RATING, 'Choose a rating from one to five.')
    .max(MAX_RATING, 'Choose a rating from one to five.'),

  /** Optional — §6.1j lists it, and a review with only a body is a complete review. */
  reviewTitle: z.string().trim().max(120, 'That title is too long.').optional().or(z.literal('')),
})

export type ReviewInput = z.infer<typeof ReviewSchema>
