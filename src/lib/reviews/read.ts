import type { Payload } from 'payload'

import type { ReviewEligibility, ReviewSummary } from './rules'

import { FINALISABLE_STATUSES } from '@/lib/checkout/rules'
import { reviewEligibility, summariseReviews } from './rules'

/**
 * **Reviews against the database** — plan §21.1a, §21.1b and §13.1f.
 *
 * No `server-only` guard: every function takes a `Payload` instance and its subject as arguments, so
 * `pnpm verify:reviews` can drive the two things the phase prompt names — unauthorized submissions
 * and duplicate reviews — against a real database.
 *
 * ---
 *
 * ### `status: 'approved'` is in every public query, and that is not the only thing enforcing it
 *
 * §21.1b: *"Only approved reviews appear publicly."* `Reviews.access.read` already narrows an
 * anonymous read with a `Where` of `{ status: { equals: 'approved' } }`, so a public request could
 * not see a pending review even if this module asked for one.
 *
 * The filter is written out anyway, because these reads run with `overrideAccess: true` — and a
 * service that bypasses access control and then relies on it is one edit away from publishing
 * unmoderated text on a product page. The constraint the collection carries is the guarantee; the
 * clause here is what keeps the guarantee visible in the code that would otherwise defeat it.
 */

const STOREFRONT_ACCESS = { overrideAccess: false, user: null } as const

export type PublicReview = {
  body: string
  createdAt: string
  displayName: string
  id: number
  rating: number
  title: null | string
  verifiedPurchase: boolean
}

export type ReviewBlock = {
  reviews: PublicReview[]
  summary: ReviewSummary
}

/**
 * The approved reviews for one product, and their summary.
 *
 * The summary is computed from **the same rows that are rendered**, not from a separate aggregate
 * query. That is deliberate: two queries can disagree, and the failure mode is a page claiming
 * forty-one reviews above a list of forty.
 */
export async function readProductReviews(
  payload: Payload,
  productId: number,
  limit = 50,
): Promise<ReviewBlock> {
  const { docs } = await payload.find({
    collection: 'reviews',
    depth: 0,
    limit,
    overrideAccess: true,
    sort: '-createdAt',
    where: {
      and: [{ product: { equals: productId } }, { status: { equals: 'approved' } }],
    },
  })

  const reviews: PublicReview[] = docs.map((row) => ({
    body: String(row.body),
    createdAt: String(row.createdAt),
    displayName: String(row.displayName),
    id: row.id,
    rating: Number(row.rating),
    title: typeof row.title === 'string' && row.title.length > 0 ? row.title : null,
    verifiedPurchase: row.verifiedPurchase === true,
  }))

  return { reviews, summary: summariseReviews(reviews.map((review) => review.rating)) }
}

/**
 * **§21.1a's *"match customer to a paid order containing the product"*.**
 *
 * Two reads rather than a join, because `order-items` is where the product lives and `orders` is
 * where the payment state does.
 *
 * **Paid, not delivered.** §21.1a says paid, and `FINALISABLE_STATUSES` is derived from §17.1c's
 * machine — so this asks the opposite question and takes everything that is *no longer* awaiting
 * payment. A refunded order still counts: the customer did buy it, and had it long enough to form an
 * opinion. Feature matrix §9's *"order not delivered yet"* would set the bar four states further
 * along; the plan outranks it, and that conflict is recorded as **DEV-69**.
 */
export async function hasPaidOrderFor(
  payload: Payload,
  customerId: number,
  productId: number,
): Promise<boolean> {
  const { docs } = await payload.find({
    collection: 'orders',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    where: {
      and: [
        { customer: { equals: customerId } },
        { paymentStatus: { not_in: [...FINALISABLE_STATUSES, 'draft'] } },
      ],
    },
  })

  if (docs.length === 0) {
    return false
  }

  const { totalDocs } = await payload.find({
    collection: 'order-items',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      and: [{ order: { in: docs.map((order) => order.id) } }, { product: { equals: productId } }],
    },
  })

  return totalDocs > 0
}

/** Whether this customer has already reviewed this product, in **any** state. */
export async function hasReviewed(
  payload: Payload,
  customerId: number,
  productId: number,
): Promise<boolean> {
  const { totalDocs } = await payload.find({
    collection: 'reviews',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      and: [{ customer: { equals: customerId } }, { product: { equals: productId } }],
    },
  })

  return totalDocs > 0
}

/**
 * Everything the product page needs to decide what to render where the form would go.
 *
 * A signed-out visitor costs **no queries at all** — the answer is already known, and the overwhelming
 * majority of product-page views are signed out.
 */
export async function resolveEligibility(
  payload: Payload,
  customer: null | { accountStatus?: null | string; id: number },
  productId: number,
  productAvailable: boolean,
): Promise<ReviewEligibility> {
  if (!customer) {
    return reviewEligibility({
      hasPaidOrder: false,
      hasReviewed: false,
      productAvailable,
      signedIn: false,
      suspended: false,
    })
  }

  const [reviewed, paid] = await Promise.all([
    hasReviewed(payload, customer.id, productId),
    hasPaidOrderFor(payload, customer.id, productId),
  ])

  return reviewEligibility({
    hasPaidOrder: paid,
    hasReviewed: reviewed,
    productAvailable,
    signedIn: true,
    suspended: customer.accountStatus !== undefined && customer.accountStatus !== 'active',
  })
}

/**
 * Whether this product may be reviewed at all — §21.1c's *"deleted product"*.
 *
 * The same publication rule the shop grid uses, under `overrideAccess: false, user: null`, so a
 * soft-deleted, unpublished or scheduled product answers `false` without this module needing to know
 * which of the three it was.
 */
export async function isReviewableProduct(payload: Payload, productId: number): Promise<boolean> {
  const { totalDocs } = await payload.find({
    collection: 'products',
    depth: 0,
    limit: 1,
    ...STOREFRONT_ACCESS,
    where: { id: { equals: productId } },
  })

  return totalDocs > 0
}
