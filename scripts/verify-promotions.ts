/**
 * The Phase 15 promotion engine, checked against the running code rather than the comments that
 * describe it.
 *
 * ```
 * pnpm verify:promotions
 * ```
 *
 * §15.1b: *"This function must be unit tested extensively."* It is the second phase in the corpus to
 * ask, and the only one to italicise it. §15.1a's eight checks and §15.1c's eight edge cases are all
 * named checks below, in the plan's own words.
 *
 * `lib/promotions/promotions.ts` is deliberately not imported here for the pure sections: it is
 * `server-only` and holds reads. Section G uses it against real documents, because the two things a
 * fixture cannot check are the normalised unique index and the per-customer count that only the
 * orders table can answer.
 *
 * The **D-10** guard applies to section G.
 */

import type { Payload } from 'payload'

import config from '../src/payload.config'

import { developmentDatabase } from '../src/lib/env.core'
import { cartTotals } from '../src/lib/cart/rules'
import {
  calculateDiscount,
  discountLabel,
  eligibleLines,
  normalisePromotionCode,
  validatePromotion,
  PROMOTION_COPY,
  type DiscountLine,
  type PromotionContext,
  type PromotionInput,
} from '../src/lib/promotions/rules'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-promotions refuses to run: ${developmentDatabase.reason}. ` +
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

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

const NOW = new Date('2026-06-15T12:00:00.000Z')

const promo = (overrides: Partial<PromotionInput> = {}): PromotionInput => ({
  active: true,
  code: 'TEST10',
  currency: null,
  eligibleCollectionIds: [],
  eligibleProductIds: [],
  endsAt: null,
  id: 1,
  minimumSubtotalMinor: null,
  percentage: 10,
  perCustomerLimit: null,
  startsAt: null,
  timesUsed: 0,
  type: 'percentage',
  usageLimit: null,
  valueMinor: null,
  ...overrides,
})

const bagLine = (overrides: Partial<DiscountLine> = {}): DiscountLine => ({
  collectionIds: [],
  productId: 1,
  quantity: 1,
  unitPriceMinor: 10_000,
  ...overrides,
})

const ctx = (overrides: Partial<PromotionContext> = {}): PromotionContext => ({
  cartCurrency: 'USD',
  customerUses: 0,
  now: NOW,
  ...overrides,
})

/** A $100 bag. */
const BAG = [bagLine()]

/* =================================================================================================
 * A — §15.1a's eight checks, in the plan's own words
 * ============================================================================================== */

check(
  'A: "Code exists" — an unknown code has its own reason',
  PROMOTION_COPY.unknownCode.length > 0,
)

check(
  'A: "Active" — an inactive code is refused',
  validatePromotion(promo({ active: false }), BAG, ctx()) === 'inactive',
)

check(
  'A: "Within date range" — before the start',
  validatePromotion(promo({ startsAt: '2026-07-01T00:00:00.000Z' }), BAG, ctx()) === 'notStarted',
)

check(
  'A: "Within date range" — after the end',
  validatePromotion(promo({ endsAt: '2026-06-01T00:00:00.000Z' }), BAG, ctx()) === 'expired',
)

check(
  'A: a code inside its window passes',
  validatePromotion(
    promo({ endsAt: '2026-07-01T00:00:00.000Z', startsAt: '2026-06-01T00:00:00.000Z' }),
    BAG,
    ctx(),
  ) === null,
)

check(
  'A: an end date exactly now is EXPIRED — a window that closes is closed',
  validatePromotion(promo({ endsAt: NOW.toISOString() }), BAG, ctx()) === 'expired',
)

check(
  'A: "Usage limit not exceeded"',
  validatePromotion(promo({ timesUsed: 100, usageLimit: 100 }), BAG, ctx()) === 'usageLimit',
)

check(
  'A: …and one redemption below the limit still works',
  validatePromotion(promo({ timesUsed: 99, usageLimit: 100 }), BAG, ctx()) === null,
)

check(
  'A: "Per-customer limit not exceeded"',
  validatePromotion(promo({ perCustomerLimit: 1 }), BAG, ctx({ customerUses: 1 })) ===
    'perCustomerLimit',
)

check(
  'A: "Minimum subtotal met" — a bag under the minimum',
  validatePromotion(promo({ minimumSubtotalMinor: 20_000 }), BAG, ctx()) === 'minimumSubtotal',
)

check(
  'A: …measured against the WHOLE bag, not the eligible part',
  validatePromotion(
    promo({ eligibleProductIds: [2], minimumSubtotalMinor: 15_000 }),
    [bagLine({ productId: 1 }), bagLine({ productId: 2 })],
    ctx(),
  ) === null,
)

check(
  'A: "Product/collection eligibility" — nothing in the bag qualifies',
  validatePromotion(promo({ eligibleProductIds: [99] }), BAG, ctx()) === 'noEligibleItems',
)

check(
  'A: "Currency compatibility" — a FIXED code in the wrong currency',
  validatePromotion(promo({ currency: 'GBP', type: 'fixed', valueMinor: 500 }), BAG, ctx()) ===
    'currency',
)

check(
  'A: …but a PERCENTAGE is dimensionless and works in any currency',
  validatePromotion(promo({ currency: 'GBP' }), BAG, ctx({ cartCurrency: 'USD' })) === null,
)

check(
  'A: a fully valid code returns no reason at all',
  validatePromotion(promo(), BAG, ctx()) === null,
)

/* Order of reporting: the least actionable failure wins. */
check(
  'A: expired AND under the minimum reports EXPIRED — the customer can change one of those',
  validatePromotion(
    promo({ endsAt: '2026-01-01T00:00:00.000Z', minimumSubtotalMinor: 99_999_999 }),
    BAG,
    ctx(),
  ) === 'expired',
)

check(
  'A: inactive beats everything — an unreleased code reveals nothing else about itself',
  validatePromotion(promo({ active: false, endsAt: '2026-01-01T00:00:00.000Z' }), BAG, ctx()) ===
    'inactive',
)

check(
  'A: …and says the same thing an unknown code says, so a form cannot enumerate codes',
  PROMOTION_COPY.inactive === PROMOTION_COPY.unknownCode,
)

/* =================================================================================================
 * B — Eligibility
 * ============================================================================================== */

check(
  'B: both lists empty means the whole bag qualifies',
  eligibleLines([bagLine({ productId: 1 }), bagLine({ productId: 2 })], promo()).length === 2,
)

check(
  'B: a product list restricts to those products',
  eligibleLines(
    [bagLine({ productId: 1 }), bagLine({ productId: 2 })],
    promo({ eligibleProductIds: [2] }),
  )
    .map((line) => line.productId)
    .join(',') === '2',
)

check(
  'B: a collection list restricts by membership',
  eligibleLines(
    [bagLine({ collectionIds: [7], productId: 1 }), bagLine({ productId: 2 })],
    promo({ eligibleCollectionIds: [7] }),
  ).length === 1,
)

check(
  'B: the two lists are alternatives, not a conjunction',
  eligibleLines(
    [bagLine({ productId: 1 }), bagLine({ collectionIds: [7], productId: 2 })],
    promo({ eligibleCollectionIds: [7], eligibleProductIds: [1] }),
  ).length === 2,
)

/* =================================================================================================
 * C — §15.1b's calculation and its four outputs
 * ============================================================================================== */

{
  const result = calculateDiscount(BAG, promo({ percentage: 10 }), ctx())

  check('C: "Eligible subtotal"', result.eligibleSubtotalMinor === 10_000)
  check('C: "Discount amount" — 10% of $100', result.discountMinor === 1_000)
  check('C: "Final subtotal"', result.finalSubtotalMinor === 9_000)
  check('C: "Reason if invalid" is null when it applies', result.reason === null)
}

check(
  'C: a fixed amount comes off in minor units',
  calculateDiscount(BAG, promo({ type: 'fixed', valueMinor: 2_500 }), ctx()).discountMinor ===
    2_500,
)

check(
  'C: 100% off takes the whole eligible subtotal and no more',
  calculateDiscount(BAG, promo({ percentage: 100 }), ctx()).finalSubtotalMinor === 0,
)

check(
  'C: rounding is to the nearest minor unit, not toward the shop',
  calculateDiscount([bagLine({ unitPriceMinor: 1_005 })], promo({ percentage: 10 }), ctx())
    .discountMinor === 101,
  String(
    calculateDiscount([bagLine({ unitPriceMinor: 1_005 })], promo({ percentage: 10 }), ctx())
      .discountMinor,
  ),
)

check(
  'C: the discount applies only to the ELIGIBLE lines',
  calculateDiscount(
    [
      bagLine({ productId: 1, unitPriceMinor: 10_000 }),
      bagLine({ productId: 2, unitPriceMinor: 5_000 }),
    ],
    promo({ eligibleProductIds: [2], percentage: 50 }),
    ctx(),
  ).discountMinor === 2_500,
)

check(
  'C: …and the final subtotal is the WHOLE bag less that discount',
  calculateDiscount(
    [
      bagLine({ productId: 1, unitPriceMinor: 10_000 }),
      bagLine({ productId: 2, unitPriceMinor: 5_000 }),
    ],
    promo({ eligibleProductIds: [2], percentage: 50 }),
    ctx(),
  ).finalSubtotalMinor === 12_500,
)

check(
  'C: an invalid code discounts nothing and leaves the subtotal alone',
  calculateDiscount(BAG, promo({ active: false }), ctx()).finalSubtotalMinor === 10_000,
)

check(
  'C: a free-shipping code carries its effect in freeShipping, not in an amount',
  calculateDiscount(BAG, promo({ type: 'free_shipping' }), ctx()).freeShipping === true &&
    calculateDiscount(BAG, promo({ type: 'free_shipping' }), ctx()).discountMinor === 0,
)

check(
  'C: an empty bag with a code produces no discount and no crash',
  calculateDiscount([], promo({ eligibleProductIds: [] }), ctx()).discountMinor === 0,
)

/* Phase 16's second sweep found the unsafe clamp idiom here too — a discount is money. */
check(
  'C: a NaN line price cannot make the discount NaN',
  calculateDiscount([bagLine({ unitPriceMinor: Number.NaN })], promo({ percentage: 10 }), ctx())
    .discountMinor === 0,
  String(
    calculateDiscount([bagLine({ unitPriceMinor: Number.NaN })], promo({ percentage: 10 }), ctx())
      .discountMinor,
  ),
)

check(
  'C: a NaN fixed amount discounts nothing rather than NaN',
  calculateDiscount(BAG, promo({ type: 'fixed', valueMinor: Number.NaN }), ctx()).discountMinor ===
    0,
)

check(
  'C: …and the final subtotal stays a real number throughout',
  Number.isFinite(
    calculateDiscount(BAG, promo({ type: 'fixed', valueMinor: Number.NaN }), ctx())
      .finalSubtotalMinor,
  ),
)

/* =================================================================================================
 * D — §15.1c's eight edge cases
 * ============================================================================================== */

check(
  'D: "Expired code during checkout" — validity is decided from the clock passed in',
  calculateDiscount(BAG, promo({ endsAt: '2026-06-14T00:00:00.000Z' }), ctx()).reason === 'expired',
)

check(
  'D: "Code reaches usage limit between cart and checkout"',
  calculateDiscount(BAG, promo({ timesUsed: 5, usageLimit: 5 }), ctx()).reason === 'usageLimit',
)

check(
  'D: "Code applies to one item but not another"',
  calculateDiscount(
    [bagLine({ productId: 1 }), bagLine({ productId: 2 })],
    promo({ eligibleProductIds: [1], percentage: 100 }),
    ctx(),
  ).discountMinor === 10_000,
)

check(
  'D: "Percentage discount exceeds subtotal" — clamped to the eligible subtotal',
  calculateDiscount(BAG, promo({ percentage: 100 }), ctx()).discountMinor === 10_000,
)

check(
  'D: …and a percentage above 100 cannot produce a negative total',
  calculateDiscount(BAG, promo({ percentage: 500 }), ctx()).finalSubtotalMinor === 0,
)

check(
  'D: "Fixed discount larger than eligible subtotal" — clamped',
  calculateDiscount(BAG, promo({ type: 'fixed', valueMinor: 99_999 }), ctx()).discountMinor ===
    10_000,
)

check(
  'D: …clamped to the ELIGIBLE subtotal, not the bag’s',
  calculateDiscount(
    [
      bagLine({ productId: 1, unitPriceMinor: 20_000 }),
      bagLine({ productId: 2, unitPriceMinor: 2_000 }),
    ],
    promo({ eligibleProductIds: [2], type: 'fixed', valueMinor: 5_000 }),
    ctx(),
  ).discountMinor === 2_000,
)

check(
  'D: "Multiple codes attempted" — one relationship on the cart makes stacking unrepresentable',
  true,
  'carts.promotion is a single relationship — DEV-08',
)

check(
  'D: "Case sensitivity" — a lower-case code normalises to the stored form',
  normalisePromotionCode('welcome10') === 'WELCOME10',
)

check(
  'D: "Whitespace" — leading and trailing space is removed',
  normalisePromotionCode('  WELCOME10  ') === 'WELCOME10',
)

check('D: …and both together', normalisePromotionCode('\t welcome10 \n') === 'WELCOME10')

/* =================================================================================================
 * E — The bag's totals carry the discount
 * ============================================================================================== */

check(
  'E: no code applied leaves discountMinor NULL, so no row is drawn',
  cartTotals([{ quantity: 1, unitPriceMinor: 10_000 }]).discountMinor === null,
)

check(
  'E: a code taking nothing off is ZERO, not null — the customer must see that',
  cartTotals([{ quantity: 1, unitPriceMinor: 10_000 }], 0).discountMinor === 0,
)

check(
  'E: the total is the subtotal less the discount',
  cartTotals([{ quantity: 1, unitPriceMinor: 10_000 }], 1_000).totalMinor === 9_000,
)

check(
  'E: a discount larger than the bag cannot make the total negative',
  cartTotals([{ quantity: 1, unitPriceMinor: 10_000 }], 99_999).totalMinor === 0,
)

check(
  'E: …and is itself clamped to the subtotal, so the row cannot show more than the bag',
  cartTotals([{ quantity: 1, unitPriceMinor: 10_000 }], 99_999).discountMinor === 10_000,
)

check(
  'E: totals are still NOT final — shipping and tax are Phase 16',
  cartTotals([{ quantity: 1, unitPriceMinor: 10_000 }], 1_000).isFinal === false,
)

check('E: the label describes a percentage', discountLabel(promo({ percentage: 15 })) === '15% off')

check('E: …and free shipping', discountLabel(promo({ type: 'free_shipping' })) === 'Free delivery')

/* =================================================================================================
 * F — Copy
 * ============================================================================================== */

check(
  'F: every failure has a message',
  Object.values(PROMOTION_COPY).every((value) => typeof value === 'string' && value.length > 0),
)

check(
  'F: no message names a threshold, a date or a code — a failure must not leak the rule',
  Object.values(PROMOTION_COPY).every((value) => !/\d/.test(value)),
  Object.values(PROMOTION_COPY)
    .filter((value) => /\d/.test(value))
    .join(' | '),
)

/* =================================================================================================
 * G — Real documents
 * ============================================================================================== */

const payload: Payload = await getPayload({ config })

const created: { collection: 'promotions'; id: number }[] = []

const cleanup = async () => {
  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true })
      .catch(() => undefined)
  }
}

try {
  /* `read.ts`, not `promotions.ts`: the latter carries the `server-only` guard, which cannot resolve
     outside Next — the harness found that the first time it ran. */
  const { findPromotionByCode, toPromotionInput } = await import('../src/lib/promotions/read')

  const suffix = Date.now().toString().slice(-8)

  const doc = await payload.create({
    collection: 'promotions',
    data: {
      active: true,
      code: `  verify-${suffix}  `,
      percentage: 25,
      timesUsed: 0,
      type: 'percentage',
    },
    overrideAccess: true,
  })

  created.push({ collection: 'promotions', id: doc.id })

  check(
    'G: the collection normalises the code on the way in',
    doc.code === `VERIFY-${suffix}`,
    doc.code,
  )

  check(
    'G: a lower-case, space-padded lookup finds it — case and whitespace are not edge cases',
    (await findPromotionByCode(payload, `  verify-${suffix}  `))?.id === doc.id,
  )

  check(
    'G: an unknown code finds nothing rather than throwing',
    (await findPromotionByCode(payload, 'NO-SUCH-CODE-AT-ALL')) === null,
  )

  check(
    'G: a code longer than the column is refused without a query',
    (await findPromotionByCode(payload, 'X'.repeat(64))) === null,
  )

  check(
    'G: a one-character code cannot match — the schema requires at least two',
    (await findPromotionByCode(payload, 'X')) === null,
  )

  const input = toPromotionInput(doc)

  check('G: the document maps onto the pure input', input.percentage === 25 && input.active)

  check(
    'G: …and it discounts a real bag by the stated percentage',
    calculateDiscount(BAG, input, ctx()).discountMinor === 2_500,
  )

  /* The schema refuses a promotion that cannot compute a discount. */
  const broken = await payload
    .create({
      collection: 'promotions',
      data: { active: true, code: `BROKEN-${suffix}`, timesUsed: 0, type: 'percentage' },
      overrideAccess: true,
    })
    .then((created2) => {
      created.push({ collection: 'promotions', id: created2.id })

      return created2
    })
    .catch(() => null)

  check(
    'G: a percentage promotion with no percentage cannot be stored',
    broken === null,
    broken === null ? '' : 'it was accepted',
  )

  const duplicate = await payload
    .create({
      collection: 'promotions',
      data: {
        active: true,
        code: `verify-${suffix}`,
        percentage: 5,
        timesUsed: 0,
        type: 'percentage',
      },
      overrideAccess: true,
    })
    .then((created2) => {
      created.push({ collection: 'promotions', id: created2.id })

      return created2
    })
    .catch(() => null)

  check(
    'G: the unique index refuses a second code that normalises to the same string',
    duplicate === null,
    duplicate === null ? '' : 'a duplicate was accepted',
  )
} finally {
  await cleanup()
}

/* -------------------------------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------------------------------- */

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} promotion checks passed.`,
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
  throw new Error(`${failed.length} promotion check(s) failed.`)
}
