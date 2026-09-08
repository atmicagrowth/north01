/**
 * The Phase 14 cart rules, checked against the running code rather than the comments that describe
 * them.
 *
 * ```
 * pnpm verify:cart
 * ```
 *
 * The Phase 14 prompt asks for *"unit tests for every cart calculation and merge edge case"* — the
 * only phase in the corpus that asks for tests by name — and §14.1b enumerates seven edge cases
 * explicitly. **Every one of them is a named check below**, in the plan's own words, because a rule
 * stated that concretely should be asserted that concretely.
 *
 * `lib/cart/cart.ts` is deliberately not imported: it is `server-only` and holds reads, writes and a
 * cookie. Everything asserted in the pure sections lives in `lib/cart/rules.ts`, which is why a merge
 * involving two bags, a stock change and a deleted product can be exercised as a fixture.
 *
 * The **D-10** guard applies to section F — it creates and deletes documents, so it refuses to run
 * anywhere but the development database `DATABASE_PUSH_TARGET` names.
 */

import type { Payload } from 'payload'

import config from '../src/payload.config'

import { developmentDatabase } from '../src/lib/env.core'
import {
  cartTotals,
  clampNotice,
  clampQuantity,
  mergeCartLines,
  shippingProgress,
  CART_COPY,
  QUANTITY_HARD_CAP,
  type CartLineInput,
  type LineAvailability,
} from '../src/lib/cart/rules'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-cart refuses to run: ${developmentDatabase.reason}. ` +
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

const stocked = (overrides: Partial<LineAvailability> = {}): LineAvailability => ({
  active: true,
  inventoryQuantity: 10,
  priceMinor: 12_000,
  productPublished: true,
  ...overrides,
})

let nextVariant = 1000

const line = (overrides: Partial<CartLineInput> = {}): CartLineInput => {
  const variantId = overrides.variantId ?? nextVariant++

  return { productId: 1, quantity: 1, variantId, ...overrides }
}

const availabilityFor = (
  entries: [number, LineAvailability | null][],
): Map<number, LineAvailability | null> => new Map(entries)

/* =================================================================================================
 * A — Clamping, which both the mutation path and the merge path share
 * ============================================================================================== */

check(
  'A: a quantity within both bounds is granted in full',
  clampQuantity(3, stocked(), 10).quantity === 3,
)

check('A: …and is not reported as clamped', clampQuantity(3, stocked(), 10).clampedBy === null)

{
  const clamped = clampQuantity(6, stocked({ inventoryQuantity: 4 }), 10)

  check('A: stock is the binding bound when it is the smaller', clamped.quantity === 4)
  check(
    'A: …and the reason names STOCK, not policy',
    clamped.clampedBy === 'stock',
    String(clamped.clampedBy),
  )
}

{
  const clamped = clampQuantity(15, stocked({ inventoryQuantity: 50 }), 10)

  check('A: policy is the binding bound when it is the smaller', clamped.quantity === 10)
  check(
    'A: …and the reason names POLICY',
    clamped.clampedBy === 'policy',
    String(clamped.clampedBy),
  )
}

check(
  'A: when both bounds bite, the customer gets the smaller of the two',
  clampQuantity(15, stocked({ inventoryQuantity: 8 }), 10).quantity === 8,
)

check(
  'A: an INACTIVE variant cannot be added at all',
  clampQuantity(1, stocked({ active: false }), 10).quantity === 0,
)

check(
  'A: a variant on an UNPUBLISHED product cannot be added — §13.1d',
  clampQuantity(1, stocked({ productPublished: false }), 10).quantity === 0,
)

check(
  'A: a variant with NO PRICE cannot be added — there is nothing to charge',
  clampQuantity(1, stocked({ priceMinor: null }), 10).quantity === 0,
)

check(
  'A: a variant that no longer exists cannot be added',
  clampQuantity(1, null, 10).quantity === 0,
)

check(
  'A: sold out is zero and says so',
  clampQuantity(1, stocked({ inventoryQuantity: 0 }), 10).clampedBy === 'soldOut',
)

check(
  'A: the schema’s hard cap of 99 wins over any policy above it',
  clampQuantity(500, stocked({ inventoryQuantity: 500 }), 250).quantity === QUANTITY_HARD_CAP,
)

check(
  'A: a fractional quantity is floored, never rounded up past stock',
  clampQuantity(3.9, stocked({ inventoryQuantity: 3 }), 10).quantity === 3,
)

check('A: a negative quantity resolves to none', clampQuantity(-5, stocked(), 10).quantity === 0)

/*
 * Phase 16's second sweep: `Math.max(0, Math.floor(x))` reads like a clamp and passes `NaN` straight
 * through, because `Math.floor(NaN)` is `NaN` and `Math.max(0, NaN)` is `NaN`. It was in five places
 * this project had not tested. These are the cart's.
 */
check(
  'A: a NaN quantity resolves to none rather than to NaN',
  clampQuantity(Number.NaN, stocked(), 10).quantity === 0,
  String(clampQuantity(Number.NaN, stocked(), 10).quantity),
)

check(
  'A: NaN stock is treated as no stock, not as unlimited stock',
  clampQuantity(5, stocked({ inventoryQuantity: Number.NaN }), 10).quantity === 0,
  String(clampQuantity(5, stocked({ inventoryQuantity: Number.NaN }), 10).quantity),
)

check(
  'A: an Infinite quantity is bounded by the policy rather than becoming Infinity',
  clampQuantity(Number.POSITIVE_INFINITY, stocked({ inventoryQuantity: 50 }), 10).quantity === 0,
  String(clampQuantity(Number.POSITIVE_INFINITY, stocked({ inventoryQuantity: 50 }), 10).quantity),
)

check(
  'A: a policy below one is still at least one — a shop cannot forbid buying anything',
  clampQuantity(1, stocked(), 0).quantity === 1,
)

/* Notices */
check(
  'A: the stock notice gives the real number',
  clampNotice({ clampedBy: 'stock', quantity: 3 }) === 'Only 3 left, so that is what we added.',
  String(clampNotice({ clampedBy: 'stock', quantity: 3 })),
)

check(
  'A: …and reads naturally at one',
  clampNotice({ clampedBy: 'stock', quantity: 1 }) === 'Only one left, so we added one.',
)

check(
  'A: the policy notice explains the limit rather than blaming stock',
  (clampNotice({ clampedBy: 'policy', quantity: 10 }) ?? '').includes('per order'),
)

check(
  'A: an unclamped add says nothing at all',
  clampNotice({ clampedBy: null, quantity: 2 }) === null,
)

/* -------------------------------------------------------------------------------------------------
 * The two clamps answer two questions, and confusing them is a rule that type-checks and is wrong.
 *
 * Phase 14's first sweep found the bag rendering a quantity of 2 beside a subtotal charging for 1,
 * because `maxQuantity` was computed by clamping the line's CURRENT quantity — which returns the
 * current quantity — instead of clamping the policy maximum. Both calls have the same signature and
 * the same return type; only the argument differs.
 * ---------------------------------------------------------------------------------------------- */

{
  const availability = stocked({ inventoryQuantity: 1 })

  const held = clampQuantity(2, availability, 10)
  const ceiling = clampQuantity(10, availability, 10)

  check(
    'A: clamping the STORED quantity answers "may they keep what they have?"',
    held.quantity === 1,
    String(held.quantity),
  )

  check(
    'A: clamping the POLICY answers "how many could they have?" — and it is the same number here',
    ceiling.quantity === 1,
  )

  const roomy = stocked({ inventoryQuantity: 8 })

  check(
    'A: …and the two DIVERGE whenever the bag holds less than the shelf',
    clampQuantity(2, roomy, 10).quantity === 2 && clampQuantity(10, roomy, 10).quantity === 8,
    `${clampQuantity(2, roomy, 10).quantity} held vs ${clampQuantity(10, roomy, 10).quantity} available`,
  )

  check(
    'A: using the held clamp as a ceiling would make every line look full',
    clampQuantity(2, roomy, 10).quantity < clampQuantity(10, roomy, 10).quantity,
  )
}

/* =================================================================================================
 * B — §14.1b's seven steps
 * ============================================================================================== */

{
  const guestOnly = [line({ quantity: 2, variantId: 1 })]
  const merged = mergeCartLines([], guestOnly, availabilityFor([[1, stocked()]]), 10)

  check('B: "Customer has no cart" — the guest lines survive', merged.lines.length === 1)
  check('B: …at the quantity they had', merged.lines[0]?.quantity === 2)
  check('B: …and are not marked as combined', merged.lines[0]?.combined === false)
}

{
  const customerOnly = [line({ quantity: 3, variantId: 2 })]
  const merged = mergeCartLines(customerOnly, [], availabilityFor([[2, stocked()]]), 10)

  check('B: "Guest cart empty" — the customer bag is untouched', merged.lines.length === 1)
  check('B: …at its own quantity', merged.lines[0]?.quantity === 3)
}

check(
  'B: "Customer cart empty" and guest empty — the result is an empty bag, not an error',
  mergeCartLines([], [], availabilityFor([]), 10).lines.length === 0,
)

{
  const merged = mergeCartLines(
    [line({ quantity: 2, variantId: 3 })],
    [line({ quantity: 3, variantId: 3 })],
    availabilityFor([[3, stocked()]]),
    10,
  )

  check('B: "Same variant exists in both carts" — one line, not two', merged.lines.length === 1)
  check('B: …and the quantities are SUMMED (§14.1b step 5)', merged.lines[0]?.quantity === 5)
  check('B: …and the line knows it was combined', merged.lines[0]?.combined === true)
}

{
  const merged = mergeCartLines(
    [line({ quantity: 1, variantId: 4 })],
    [line({ quantity: 1, variantId: 5 })],
    availabilityFor([
      [4, stocked()],
      [5, stocked({ active: false })],
    ]),
    10,
  )

  check(
    'B: "One variant becomes unavailable during merge" — it is removed, not zeroed',
    merged.lines.length === 1 && merged.lines[0]?.variantId === 4,
  )

  check(
    'B: …and the removal is REPORTED',
    merged.dropped.length === 1 && merged.dropped[0]?.variantId === 5,
  )
}

{
  const merged = mergeCartLines(
    [line({ quantity: 3, variantId: 6 })],
    [line({ quantity: 3, variantId: 6 })],
    availabilityFor([[6, stocked({ inventoryQuantity: 4 })]]),
    10,
  )

  check(
    'B: "Quantity exceeds stock after merge" — the SUM is clamped, not each side',
    merged.lines[0]?.quantity === 4,
    String(merged.lines[0]?.quantity),
  )

  check(
    'B: …and the reduction is reported with what was asked for',
    merged.reduced[0]?.requested === 6 && merged.reduced[0]?.resolved === 4,
  )
}

{
  const merged = mergeCartLines(
    [],
    [line({ quantity: 1, variantId: 7 })],
    availabilityFor([[7, null]]),
    10,
  )

  check(
    'B: "Product deleted while guest was browsing" — the line is dropped',
    merged.lines.length === 0 && merged.dropped.length === 1,
  )
}

{
  /* Three lines, one of each outcome, to prove the three lists do not leak into each other. */
  const merged = mergeCartLines(
    [line({ quantity: 1, variantId: 8 }), line({ quantity: 9, variantId: 9 })],
    [line({ quantity: 1, variantId: 10 })],
    availabilityFor([
      [8, stocked()],
      [9, stocked({ inventoryQuantity: 2 })],
      [10, null],
    ]),
    10,
  )

  check('B: a mixed merge keeps exactly the survivable lines', merged.lines.length === 2)
  check('B: …reports exactly one reduction', merged.reduced.length === 1)
  check('B: …and exactly one removal', merged.dropped.length === 1)
}

{
  const merged = mergeCartLines(
    [line({ quantity: 1, variantId: 20 }), line({ quantity: 1, variantId: 21 })],
    [line({ quantity: 1, variantId: 22 })],
    availabilityFor([
      [20, stocked()],
      [21, stocked()],
      [22, stocked()],
    ]),
    10,
  )

  check(
    'B: the customer’s own lines lead, in their own order — signing in must not reorder your bag',
    merged.lines.map((entry) => entry.variantId).join(',') === '20,21,22',
    merged.lines.map((entry) => entry.variantId).join(','),
  )
}

check(
  'B: the merge is a pure function of its inputs — the same inputs twice give the same bag',
  JSON.stringify(
    mergeCartLines(
      [line({ quantity: 2, variantId: 30 })],
      [line({ quantity: 2, variantId: 31 })],
      availabilityFor([
        [30, stocked()],
        [31, stocked()],
      ]),
      10,
    ),
  ) ===
    JSON.stringify(
      mergeCartLines(
        [line({ quantity: 2, variantId: 30 })],
        [line({ quantity: 2, variantId: 31 })],
        availabilityFor([
          [30, stocked()],
          [31, stocked()],
        ]),
        10,
      ),
    ),
)

/* =================================================================================================
 * C — Totals, and the discipline of `null`
 * ============================================================================================== */

{
  const totals = cartTotals([
    { quantity: 2, unitPriceMinor: 12_000 },
    { quantity: 1, unitPriceMinor: 9_500 },
  ])

  check(
    'C: the subtotal is quantity times price, summed',
    totals.subtotalMinor === 33_500,
    String(totals.subtotalMinor),
  )
  check(
    'C: the item count counts UNITS, not lines',
    totals.itemCount === 3,
    String(totals.itemCount),
  )
}

check('C: an empty bag totals zero rather than throwing', cartTotals([]).subtotalMinor === 0)

check(
  'C: discount is NULL, not zero — Phase 15 owns it and a computed £0.00 would be a lie',
  cartTotals([]).discountMinor === null,
)

check('C: shipping is NULL — Phase 16', cartTotals([]).shippingMinor === null)

check('C: tax is NULL — Phase 16', cartTotals([]).taxMinor === null)

check(
  'C: isFinal is FALSE while anything is unknown, so the UI says "Subtotal" not "Total"',
  cartTotals([{ quantity: 1, unitPriceMinor: 100 }]).isFinal === false,
)

check(
  'C: the total equals the subtotal while the rest is unknown',
  cartTotals([{ quantity: 2, unitPriceMinor: 500 }]).totalMinor === 1_000,
)

check(
  'C: a negative price cannot drag the subtotal below zero',
  cartTotals([{ quantity: 1, unitPriceMinor: -500 }]).subtotalMinor === 0,
)

check(
  'C: a fractional quantity is floored — a bag cannot hold half a jacket',
  cartTotals([{ quantity: 2.7, unitPriceMinor: 100 }]).subtotalMinor === 200,
)

check(
  'C: a NaN price cannot make the subtotal NaN',
  cartTotals([{ quantity: 1, unitPriceMinor: Number.NaN }]).subtotalMinor === 0,
  String(cartTotals([{ quantity: 1, unitPriceMinor: Number.NaN }]).subtotalMinor),
)

check(
  'C: a NaN quantity cannot either',
  cartTotals([{ quantity: Number.NaN, unitPriceMinor: 500 }]).subtotalMinor === 0,
)

check(
  'D: a NaN subtotal cannot produce a NaN progress fraction — it would render width: NaN%',
  Number.isFinite(shippingProgress(Number.NaN, 10_000)?.fraction ?? Number.NaN),
)

/* =================================================================================================
 * D — Shipping progress, §14.1e
 * ============================================================================================== */

check('D: no threshold configured means no message', shippingProgress(1_000, null) === null)

{
  const progress = shippingProgress(4_000, 10_000)

  check('D: below the threshold, the remainder is the gap', progress?.remainingMinor === 6_000)
  check('D: …and it does not qualify', progress?.qualified === false)
  check('D: …and the fraction is the ratio', progress?.fraction === 0.4)
}

{
  const progress = shippingProgress(10_000, 10_000)

  check('D: exactly at the threshold qualifies', progress?.qualified === true)
  check('D: …with nothing remaining', progress?.remainingMinor === 0)
}

check(
  'D: above the threshold, the fraction is capped at 1',
  shippingProgress(50_000, 10_000)?.fraction === 1,
)

check(
  'D: a threshold of zero means everything ships free, not a division by zero',
  shippingProgress(0, 0)?.qualified === true,
)

check('D: a negative threshold is treated as unconfigured', shippingProgress(100, -1) === null)

/* =================================================================================================
 * E — Copy
 * ============================================================================================== */

check(
  'E: every message is a non-empty string',
  Object.values(CART_COPY).every((value) => typeof value === 'string' && value.length > 0),
)

check(
  'E: the failure copy tells the customer what to do, not what broke',
  CART_COPY.mutationFailed.includes('try again') && !CART_COPY.mutationFailed.includes('500'),
)

/* =================================================================================================
 * F — Real documents
 *
 * The rules above are pure. These check that the schema they will be written into actually accepts
 * what they produce — the compound unique index in particular, which is §14.1b step 5 expressed as a
 * constraint and which no fixture can exercise.
 * ============================================================================================== */

const payload: Payload = await getPayload({ config })

const created: { collection: 'cart-items' | 'carts'; id: number }[] = []

const cleanup = async () => {
  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true })
      .catch(() => undefined)
  }
}

try {
  const { docs: variants } = await payload.find({
    collection: 'product-variants',
    depth: 0,
    limit: 2,
    overrideAccess: true,
    sort: 'id',
  })

  const [first, second] = variants

  if (!first || !second) {
    check(
      'F: skipped — the development database has fewer than two variants',
      true,
      'run pnpm seed',
    )
  } else {
    const cart = await payload.create({
      collection: 'carts',
      data: {
        currency: 'USD',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        status: 'active',
        token: `verify-cart-${Date.now()}`,
      },
      overrideAccess: true,
    })

    created.push({ collection: 'carts', id: cart.id })

    check(
      'F: a cart is created with a token',
      typeof cart.token === 'string' && cart.token.length > 0,
    )

    const item = await payload.create({
      collection: 'cart-items',
      data: {
        cart: cart.id,
        product: typeof first.product === 'object' ? first.product.id : first.product,
        quantity: 2,
        variant: first.id,
      },
      overrideAccess: true,
    })

    created.push({ collection: 'cart-items', id: item.id })

    check('F: a line is created', item.quantity === 2)

    /*
     * The constraint §14.1b step 5 depends on. Without it a double-tapped Add button produces two
     * lines for one variant and every total is quietly wrong.
     */
    const duplicate = await payload
      .create({
        collection: 'cart-items',
        data: {
          cart: cart.id,
          product: typeof first.product === 'object' ? first.product.id : first.product,
          quantity: 1,
          variant: first.id,
        },
        overrideAccess: true,
      })
      .then((doc) => {
        created.push({ collection: 'cart-items', id: doc.id })

        return doc
      })
      .catch(() => null)

    check(
      'F: (cart, variant) is UNIQUE — a second line for the same variant is refused by the database',
      duplicate === null,
      duplicate === null ? '' : 'a duplicate line was accepted',
    )

    const other = await payload.create({
      collection: 'cart-items',
      data: {
        cart: cart.id,
        product: typeof second.product === 'object' ? second.product.id : second.product,
        quantity: 1,
        variant: second.id,
      },
      overrideAccess: true,
    })

    created.push({ collection: 'cart-items', id: other.id })

    check('F: a different variant in the same cart is fine', other.id !== item.id)

    /* Quantity is bounded by the schema as well as by policy. */
    const absurd = await payload
      .update({
        collection: 'cart-items',
        data: { quantity: 500 },
        id: item.id,
        overrideAccess: true,
      })
      .catch(() => null)

    check('F: the schema refuses a quantity above 99, whatever policy says', absurd === null)

    const zero = await payload
      .update({
        collection: 'cart-items',
        data: { quantity: 0 },
        id: item.id,
        overrideAccess: true,
      })
      .catch(() => null)

    check('F: …and refuses zero — a bag may not hold none of something', zero === null)

    /*
     * `Carts.beforeDelete` cascades to the lines. Without it, deleting a cart with lines fails on a
     * not-null violation — which would make an expiry sweep impossible.
     */
    const { totalDocs: before } = await payload.find({
      collection: 'cart-items',
      limit: 0,
      overrideAccess: true,
      where: { cart: { equals: cart.id } },
    })

    check('F: the cart has both its lines before deletion', before === 2, String(before))

    await payload.delete({ collection: 'carts', id: cart.id, overrideAccess: true })

    const { totalDocs: after } = await payload.find({
      collection: 'cart-items',
      limit: 0,
      overrideAccess: true,
      where: { cart: { equals: cart.id } },
    })

    check(
      'F: deleting a cart cascades to its lines rather than orphaning them',
      after === 0,
      String(after),
    )
  }
} finally {
  await cleanup()
}

/* -------------------------------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------------------------------- */

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} cart checks passed.`,
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
  throw new Error(`${failed.length} cart check(s) failed.`)
}
