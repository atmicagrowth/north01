/**
 * **Reviews — plan §21.**
 *
 * ```
 * pnpm verify:reviews
 * ```
 *
 * The phase prompt asks for exactly two tests and names both: *"tests for **unauthorized
 * submissions** and **duplicate reviews**."* Both are here against the real database, along with the
 * §21.1c abuse cases and §13.1f's rendering rules, which are decidable without one.
 *
 * Sections A–C are pure. D onwards is the real database, and the **D-10** guard applies.
 */

import type { Payload } from 'payload'

import config from '../src/payload.config'

import { developmentDatabase } from '../src/lib/env.core'
import { hasPaidOrderFor, hasReviewed, readProductReviews } from '../src/lib/reviews/read'
import {
  distributionPercent,
  isRating,
  reviewEligibility,
  summariseReviews,
} from '../src/lib/reviews/rules'
import { ReviewSchema } from '../src/lib/reviews/schemas'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-reviews refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes collection documents, so it may only touch the development database ' +
      'that DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const { getPayload } = await import('payload')

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

/* ============================================ A — rating validation, the prompt's third ask */
{
  check('A: a whole number in range is a rating', isRating(1) && isRating(5) && isRating(3))
  check('A: **3.7 is not** — min/max alone would have admitted it', !isRating(3.7))
  check('A: zero and six are not', !isRating(0) && !isRating(6))
  check('A: a numeric string is not', !isRating('4' as never))
  check('A: NaN is not', !isRating(Number.NaN))
}

/* ============================================ B — §13.1f's summary */
{
  const empty = summariseReviews([])

  check(
    'B: **no reviews averages to null, never zero** — zero is a rating somebody could have given',
    empty.average === null && empty.count === 0,
    String(empty.average),
  )

  check(
    'B: …and every bucket is zero',
    Object.values(empty.distribution).every((n) => n === 0),
  )
  check('B: …and the histogram cannot divide by zero', distributionPercent(empty, 5) === 0)

  const mixed = summariseReviews([5, 4, 4, 1])

  check('B: the average is rounded to one decimal', mixed.average === 3.5, String(mixed.average))
  check('B: the count is the number of valid ratings', mixed.count === 4)
  check(
    'B: the distribution buckets correctly',
    mixed.distribution[4] === 2 && mixed.distribution[1] === 1,
  )
  check(
    'B: percentages are whole numbers',
    distributionPercent(mixed, 4) === 50,
    String(distributionPercent(mixed, 4)),
  )

  const dirty = summariseReviews([5, 3.7, 0, 9, 4] as never)

  check(
    'B: an out-of-range value is discarded rather than skewing the average',
    dirty.count === 2 && dirty.average === 4.5,
    `${dirty.count}/${dirty.average}`,
  )
}

/* ============================================ C — §21.1a's gate and §21.1c's refusals */
{
  const decide = (over: Partial<Parameters<typeof reviewEligibility>[0]>) =>
    reviewEligibility({
      hasPaidOrder: false,
      hasReviewed: false,
      productAvailable: true,
      signedIn: true,
      suspended: false,
      ...over,
    })

  check(
    'C: **§21.1a a signed-out visitor cannot submit** — the prompt names this test',
    decide({ signedIn: false }).canReview === false,
  )

  check(
    'C: **a purchase is NOT required** — the plan hedges twice and outranks the matrix (DEV-69)',
    decide({ hasPaidOrder: false }).canReview,
  )

  const verified = decide({ hasPaidOrder: true })

  check(
    'C: …a purchase is recorded as a badge instead',
    verified.canReview && verified.verifiedPurchase,
  )

  check(
    'C: §21.1c a suspended account cannot submit',
    decide({ suspended: true }).canReview === false,
  )
  check(
    'C: §21.1c a deleted product cannot be reviewed',
    decide({ productAvailable: false }).canReview === false,
  )
  check('C: §21.1c a second review is refused', decide({ hasReviewed: true }).canReview === false)

  const suspendedAndSignedOut = decide({ signedIn: false, suspended: true })

  check(
    'C: the refusals report least-actionable first — suspension outranks being signed out',
    !suspendedAndSignedOut.canReview && suspendedAndSignedOut.reason === 'suspended',
  )

  /* §21.1c's "oversized text", at the schema layer. */
  const long = ReviewSchema.safeParse({
    reviewBody: 'x'.repeat(2001),
    reviewDisplayName: 'Ada',
    reviewRating: '5',
    reviewTitle: '',
  })

  check('C: §21.1c oversized text is refused', !long.success)

  const short = ReviewSchema.safeParse({
    reviewBody: 'ok',
    reviewDisplayName: 'Ada',
    reviewRating: '5',
    reviewTitle: '',
  })

  check('C: …and "ok" is not a review either', !short.success)

  const good = ReviewSchema.safeParse({
    reviewBody: 'A genuinely useful sentence about the product.',
    reviewDisplayName: 'Ada',
    reviewRating: '4',
    reviewTitle: '',
  })

  check('C: a real review passes', good.success, good.success ? '' : 'rejected')
  check('C: …and the rating is coerced to a number', good.success && good.data.reviewRating === 4)
}

/* ============================================ The database half */

const payload: Payload = await getPayload({ config })

const created: {
  collection: 'customers' | 'order-items' | 'orders' | 'products' | 'reviews'
  id: number
}[] = []

const cleanup = async () => {
  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true, trash: false })
      .catch(() => undefined)
  }
}

const suffix = Date.now().toString().slice(-9)

async function makeCustomer(tag: string) {
  const customer = await payload.create({
    collection: 'customers',
    data: {
      accountStatus: 'active',
      email: `verify-reviews-${tag}-${suffix}@example.test`,
      firstName: 'Verify',
      lastName: tag,
      password: 'correct-horse-battery-staple',
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'customers', id: customer.id })

  return customer
}

async function makeProduct(index: string) {
  const product = await payload.create({
    collection: 'products',
    data: {
      name: `Review fixture ${suffix}-${index}`,
      slug: `review-fixture-${suffix}-${index}`,
      sortOrder: 9999,
      status: 'published',
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'products', id: product.id })

  return product
}

async function makeReview(
  customerId: number,
  productId: number,
  rating: number,
  status: 'approved' | 'pending' | 'rejected',
) {
  const review = await payload.create({
    collection: 'reviews',
    data: {
      body: 'A perfectly ordinary review body, long enough to pass the floor.',
      customer: customerId,
      displayName: 'Verify',
      product: productId,
      rating,
      status,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'reviews', id: review.id })

  return review
}

try {
  /* ============================================ D — §21.1b, only approved reviews are public */
  {
    const product = await makeProduct('d')
    const a = await makeCustomer('d-a')
    const b = await makeCustomer('d-b')
    const c = await makeCustomer('d-c')

    await makeReview(a.id, product.id, 5, 'approved')
    await makeReview(b.id, product.id, 1, 'pending')
    await makeReview(c.id, product.id, 1, 'rejected')

    const block = await readProductReviews(payload, product.id)

    check(
      'D: **§21.1b only the approved review is public** — pending and rejected are absent',
      block.reviews.length === 1 && block.reviews[0]?.rating === 5,
      `${block.reviews.length} shown`,
    )

    check(
      'D: **…and the summary is computed from the same rows** — no page claiming 3 above a list of 1',
      block.summary.count === 1 && block.summary.average === 5,
      `${block.summary.count}/${block.summary.average}`,
    )
  }

  /* ============================================ E — duplicate reviews, the named test */
  {
    const product = await makeProduct('e')
    const alice = await makeCustomer('e')

    await makeReview(alice.id, product.id, 4, 'pending')

    check('E: the first review exists', await hasReviewed(payload, alice.id, product.id))

    let refused = false

    try {
      await payload.create({
        collection: 'reviews',
        data: {
          body: 'A second review of the same product by the same customer.',
          customer: alice.id,
          displayName: 'Verify',
          product: product.id,
          rating: 1,
        } as never,
        overrideAccess: true,
      })
    } catch {
      refused = true
    }

    check(
      'E: **§21.1c a second review by the same customer is refused by the database**',
      refused,
      refused ? '' : 'a duplicate was accepted',
    )

    /* A different customer reviewing the same product is not a duplicate. */
    const bob = await makeCustomer('e-bob')

    await makeReview(bob.id, product.id, 5, 'pending')

    check(
      'E: …but a different customer may review the same product',
      await hasReviewed(payload, bob.id, product.id),
    )

    /* And the same customer may review a different product. */
    const other = await makeProduct('e-other')

    await makeReview(alice.id, other.id, 3, 'pending')

    check(
      'E: …and the same customer may review a different product',
      await hasReviewed(payload, alice.id, other.id),
    )
  }

  /* ============================================ F — §21.1a's paid-order match */
  {
    const product = await makeProduct('f')
    const buyer = await makeCustomer('f-buyer')
    const browser = await makeCustomer('f-browser')

    check(
      'F: a customer with no orders has no verified purchase',
      !(await hasPaidOrderFor(payload, browser.id, product.id)),
    )

    const order = await payload.create({
      collection: 'orders',
      data: {
        currency: 'USD',
        customer: buyer.id,
        discountMinor: 0,
        email: `verify-reviews-f-${suffix}@example.test`,
        fulfillmentStatus: 'unfulfilled',
        orderNumber: `N1-RV-F-${suffix}`,
        paymentStatus: 'paid',
        shippingMinor: 0,
        subtotalMinor: 5_000,
        taxMinor: 0,
        totalMinor: 5_000,
      } as never,
      overrideAccess: true,
    })

    created.push({ collection: 'orders', id: order.id })

    const item = await payload.create({
      collection: 'order-items',
      data: {
        lineTotalMinor: 5_000,
        order: order.id,
        product: product.id,
        productName: 'Review fixture',
        quantity: 1,
        sku: `RV-${suffix}`,
        unitPriceMinor: 5_000,
        variantLabel: 'Bone / M',
      } as never,
      overrideAccess: true,
    })

    created.push({ collection: 'order-items', id: item.id })

    check(
      'F: **§21.1a a paid order containing the product is a verified purchase**',
      await hasPaidOrderFor(payload, buyer.id, product.id),
    )

    check(
      "F: …and it is that customer's purchase, not anyone else's",
      !(await hasPaidOrderFor(payload, browser.id, product.id)),
    )

    const otherProduct = await makeProduct('f-other')

    check(
      'F: …and it verifies THAT product, not everything they ever bought',
      !(await hasPaidOrderFor(payload, buyer.id, otherProduct.id)),
    )

    /* An order that never reached payment does not verify anything. */
    const unpaid = await payload.create({
      collection: 'orders',
      data: {
        currency: 'USD',
        customer: browser.id,
        discountMinor: 0,
        email: `verify-reviews-f2-${suffix}@example.test`,
        fulfillmentStatus: 'unfulfilled',
        orderNumber: `N1-RV-F2-${suffix}`,
        paymentStatus: 'pending_payment',
        shippingMinor: 0,
        subtotalMinor: 5_000,
        taxMinor: 0,
        totalMinor: 5_000,
      } as never,
      overrideAccess: true,
    })

    created.push({ collection: 'orders', id: unpaid.id })

    const unpaidItem = await payload.create({
      collection: 'order-items',
      data: {
        lineTotalMinor: 5_000,
        order: unpaid.id,
        product: product.id,
        productName: 'Review fixture',
        quantity: 1,
        sku: `RV2-${suffix}`,
        unitPriceMinor: 5_000,
        variantLabel: 'Bone / M',
      } as never,
      overrideAccess: true,
    })

    created.push({ collection: 'order-items', id: unpaidItem.id })

    check(
      'F: **an unpaid order verifies nothing** — §21.1a says paid, and the bar is exactly there',
      !(await hasPaidOrderFor(payload, browser.id, product.id)),
    )
  }
} finally {
  await cleanup()
}

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} review checks passed.`,
  ...failed.map((result) => `FAIL  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`),
  '',
  ...results.map(
    (result) =>
      `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  ),
].join('\n')

await new Promise<void>((resolve, reject) => {
  process.stdout.write(`${report}\n`, (error) => (error ? reject(error) : resolve()))
})

await payload.destroy()

if (failed.length > 0) {
  throw new Error(`${failed.length} review check(s) failed.`)
}
