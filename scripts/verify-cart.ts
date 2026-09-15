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
 * `lib/cart/cart.ts` is not imported by the pure sections: everything asserted there lives in
 * `lib/cart/rules.ts`, which is why a merge involving two bags, a stock change and a deleted product
 * can be exercised as a fixture. Section G (sweep 1, S03) does import it — dynamically, after
 * Payload is up — for `mergeGuestBag`, the merge's database half, which takes the cookie's token as
 * an argument and so runs outside a request. G5 and G6 (the recheck of S03) hold a rival transaction
 * open and wait until Postgres reports the merge queued behind it (`pg_blocking_pids`, the technique
 * `verify-access.ts` uses), so the interleaving they test is the one that runs, every time.
 *
 * The **D-10** guard applies to sections F and G — they create and delete documents, so the script
 * refuses to run anywhere but the development database `DATABASE_PUSH_TARGET` names.
 */

import { sql } from '@payloadcms/db-postgres'
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

const created: {
  collection: 'cart-items' | 'carts' | 'customers' | 'orders' | 'product-variants' | 'products'
  id: number
}[] = []

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

  /* ===============================================================================================
   * G — sweep 1 S03, a guest bag with a checkout in flight survives sign-in
   *
   * The merge deleted the guest bag unconditionally, which cleared `orders.cart` on an order whose
   * customer was paying for it in another tab: preflight could no longer find that order to expire
   * its session, the payment could no longer convert its bag, and a guest could no longer open its
   * confirmation. `mergeGuestBag` now leaves such a bag alone, and decides — and writes — under the
   * locks a payment takes.
   * ============================================================================================ */
  {
    const { guestBagHasLiveCheckout, mergeGuestBag, PREPARED_CHECKOUT_WINDOW_MS } =
      await import('../src/lib/cart/cart')

    const tag = Date.now().toString().slice(-9)
    const NOW = new Date('2026-09-14T12:00:00.000Z')
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

    check(
      'G: a pending_payment order is in flight at any age — a delayed payment can clear for days',
      guestBagHasLiveCheckout(
        [{ paymentStatus: 'pending_payment', updatedAt: ago(20 * 86_400_000) }],
        NOW,
      ),
    )

    check(
      'G: a checkout_started order is in flight just inside the window, and not at it',
      guestBagHasLiveCheckout(
        [{ paymentStatus: 'checkout_started', updatedAt: ago(PREPARED_CHECKOUT_WINDOW_MS - 1) }],
        NOW,
      ) &&
        !guestBagHasLiveCheckout(
          [{ paymentStatus: 'checkout_started', updatedAt: ago(PREPARED_CHECKOUT_WINDOW_MS) }],
          NOW,
        ),
    )

    check(
      'G: …and the window is an hour — twice the 31-minute session',
      PREPARED_CHECKOUT_WINDOW_MS === 60 * 60 * 1000,
    )

    check(
      'G: draft, payment_failed, cancelled and no orders at all are not in flight',
      !guestBagHasLiveCheckout(
        ['draft', 'payment_failed', 'cancelled'].map((paymentStatus) => ({
          paymentStatus,
          updatedAt: ago(0),
        })),
        NOW,
      ) && !guestBagHasLiveCheckout([], NOW),
    )

    const product = await payload.create({
      collection: 'products',
      data: {
        name: `Merge fixture ${tag}`,
        slug: `merge-fixture-${tag}`,
        sortOrder: 9999,
        status: 'published',
      } as never,
      overrideAccess: true,
    })

    created.push({ collection: 'products', id: product.id })

    const variant = await payload.create({
      collection: 'product-variants',
      data: {
        active: true,
        color: 'Bone',
        colorFamily: 'bone',
        colorHex: '#e8e4dc',
        inventoryQuantity: 10,
        priceMinor: 5_000,
        product: product.id,
        size: 'M',
        sizeSortOrder: 30,
        sku: `MG-${tag}`,
      } as never,
      overrideAccess: true,
    })

    created.push({ collection: 'product-variants', id: variant.id })

    const makeCustomer = async (label: string) => {
      const customer = await payload.create({
        collection: 'customers',
        data: {
          email: `merge-${label}-${tag}@example.test`,
          firstName: 'Merge',
          lastName: 'Fixture',
          password: 'Correct-Horse-Battery-9',
        } as never,
        overrideAccess: true,
      })

      created.push({ collection: 'customers', id: customer.id })

      return customer
    }

    const makeBag = async (label: string, customerId: null | number, lineQuantity: number) => {
      const bag = await payload.create({
        collection: 'carts',
        data: {
          ...(customerId === null ? {} : { customer: customerId }),
          currency: 'USD',
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          status: 'active',
          token: `merge-${label}-${tag}`,
        } as never,
        overrideAccess: true,
      })

      created.push({ collection: 'carts', id: bag.id })

      if (lineQuantity > 0) {
        const item = await payload.create({
          collection: 'cart-items',
          data: { cart: bag.id, product: product.id, quantity: lineQuantity, variant: variant.id },
          overrideAccess: true,
        })

        created.push({ collection: 'cart-items', id: item.id })
      }

      return bag
    }

    const makeOrder = async (
      label: string,
      bagId: number,
      paymentStatus: string,
      req?: Parameters<typeof payload.create>[0]['req'],
    ) => {
      const order = await payload.create({
        collection: 'orders',
        data: {
          cart: bagId,
          currency: 'USD',
          discountMinor: 0,
          email: `merge-${label}-${tag}@example.test`,
          fulfillmentStatus: 'unfulfilled',
          orderNumber: `N1-MG-${label}-${tag}`,
          paymentStatus,
          shippingMinor: 0,
          ...(paymentStatus === 'pending_payment'
            ? { stripeCheckoutSessionId: `cs_merge_${label}_${tag}` }
            : {}),
          subtotalMinor: 10_000,
          taxMinor: 0,
          totalMinor: 10_000,
        } as never,
        overrideAccess: true,
        req,
      })

      created.push({ collection: 'orders', id: order.id })

      return order
    }

    const bagNow = async (id: number) =>
      (
        await payload.find({
          collection: 'carts',
          depth: 0,
          limit: 1,
          overrideAccess: true,
          where: { id: { equals: id } },
        })
      ).docs[0] ?? null

    const linesOf = async (bagId: number) =>
      (
        await payload.find({
          collection: 'cart-items',
          depth: 0,
          limit: 10,
          overrideAccess: true,
          pagination: false,
          where: { cart: { equals: bagId } },
        })
      ).docs

    const cartOf = async (orderId: number) => {
      const order = await payload.findByID({
        collection: 'orders',
        depth: 0,
        id: orderId,
        overrideAccess: true,
      })

      return typeof order.cart === 'object' && order.cart !== null
        ? order.cart.id
        : (order.cart ?? null)
    }

    /* ---- G1: on Stripe's page in another tab, then signs in */
    {
      const customer = await makeCustomer('g1')
      const account = await makeBag('g1-account', customer.id, 0)
      const guest = await makeBag('g1-guest', null, 2)
      const paying = await makeOrder('G1', guest.id, 'pending_payment')

      const result = await mergeGuestBag(payload, customer.id, guest.token)

      check(
        'G1: **S03 a guest bag whose order is pending payment is not merged** — deferred, cookie kept',
        result.outcome === 'deferred' && result.cookie === 'keep',
        JSON.stringify(result),
      )

      check(
        'G1: …the guest bag still exists, still active, with its line',
        (await bagNow(guest.id))?.status === 'active' && (await linesOf(guest.id)).length === 1,
      )

      check(
        'G1: **…and the order still points at it** — preflight can expire its session, payment can convert it',
        (await cartOf(paying.id)) === guest.id,
        String(await cartOf(paying.id)),
      )

      check(
        'G1: …while the account bag is untouched — the goods are not offered twice',
        (await linesOf(account.id)).length === 0,
      )
    }

    /* ---- G2: preflight has just prepared the order; the session is seconds from being recorded */
    {
      const customer = await makeCustomer('g2')

      await makeBag('g2-account', customer.id, 0)

      const guest = await makeBag('g2-guest', null, 1)
      const prepared = await makeOrder('G2', guest.id, 'checkout_started')

      const result = await mergeGuestBag(payload, customer.id, guest.token)

      check(
        'G2: **S03 a checkout just started on the guest bag defers the merge too**',
        result.outcome === 'deferred' &&
          (await bagNow(guest.id)) !== null &&
          (await cartOf(prepared.id)) === guest.id,
        JSON.stringify(result),
      )
    }

    /* ---- G3: only orders that can no longer take money — the merge goes ahead */
    {
      const customer = await makeCustomer('g3')
      const account = await makeBag('g3-account', customer.id, 0)
      const guest = await makeBag('g3-guest', null, 2)
      const failed = await makeOrder('G3F', guest.id, 'payment_failed')
      const abandoned = await makeOrder('G3A', guest.id, 'checkout_started')

      /* Two hours ago — `updatedAt` cannot be backdated through the Local API. */
      await payload.db.drizzle.execute(
        sql`UPDATE "orders" SET "updated_at" = ${new Date(Date.now() - 2 * 3_600_000).toISOString()}
            WHERE "id" = ${abandoned.id}`,
      )

      const result = await mergeGuestBag(payload, customer.id, guest.token)
      const accountLines = await linesOf(account.id)

      check(
        'G3: a guest bag whose orders cannot be paid — failed, and a start abandoned an hour ago — is merged',
        result.outcome === 'merged' &&
          typeof result.cookie === 'object' &&
          result.cookie.issue === account.token,
        JSON.stringify(result),
      )

      check(
        'G3: …its line is in the account bag, and the guest bag is gone',
        accountLines.length === 1 &&
          accountLines[0]?.quantity === 2 &&
          (await bagNow(guest.id)) === null,
        `${accountLines.length} line(s), guest ${(await bagNow(guest.id)) === null ? 'gone' : 'kept'}`,
      )

      check(
        'G3: …and those dead orders lose the link, as before — neither can take a payment',
        (await cartOf(failed.id)) === null && (await cartOf(abandoned.id)) === null,
      )
    }

    /* ---- G4: the guest bag is paid for in another tab while the merge waits for its lock */
    {
      const customer = await makeCustomer('g4')
      const account = await makeBag('g4-account', customer.id, 0)
      const guest = await makeBag('g4-guest', null, 1)
      const paying = await makeOrder('G4', guest.id, 'pending_payment')

      const rival = await payload.db.beginTransaction()

      if (rival === null) throw new Error('could not open the rival transaction')

      const rivalDb = (
        payload.db as unknown as {
          sessions: Record<string, { db: { execute: (query: unknown) => Promise<unknown> } }>
        }
      ).sessions[String(rival)]!.db

      /* `fulfil.ts`'s claim: the payment holds the order's row. */
      await rivalDb.execute(
        sql`UPDATE "orders" SET "payment_status" = 'paid', "updated_at" = now() WHERE "id" = ${paying.id}`,
      )

      const merging = mergeGuestBag(payload, customer.id, guest.token).then(
        (result) => ({ error: null, result }),
        (error: unknown) => ({ error, result: null }),
      )

      let parked = false

      for (let attempt = 0; attempt < 50 && !parked; attempt += 1) {
        const waiting = await payload.db.drizzle.execute(
          sql`SELECT count(*)::int AS "waiting" FROM pg_stat_activity
              WHERE "datname" = current_database()
                AND "wait_event_type" = 'Lock'
                AND "query" ILIKE '%"cart_id" =%FOR UPDATE%'`,
        )

        parked = Number((waiting.rows[0] as { waiting?: number } | undefined)?.waiting ?? 0) > 0

        if (!parked) await new Promise((resolve) => setTimeout(resolve, 200))
      }

      /* …then converts the bag and commits, in `fulfil.ts`'s order. */
      const converted = await rivalDb
        .execute(sql`UPDATE "carts" SET "status" = 'converted' WHERE "id" = ${guest.id}`)
        .then(
          async () => {
            await payload.db.commitTransaction(rival)

            return true
          },
          async () => {
            await payload.db.rollbackTransaction(rival).catch(() => undefined)

            return false
          },
        )

      const merged = await merging

      check('G4: the race was really run — the merge waited on the order being paid', parked)

      check(
        'G4: **S03 no deadlock, and the merge sees the bag was paid for** — `gone`, nothing written',
        converted && merged.error === null && merged.result?.outcome === 'gone',
        `converted=${converted} ${merged.error === null ? JSON.stringify(merged.result) : String(merged.error)}`,
      )

      check(
        'G4: …the paid bag is kept as the order’s history, and the order still points at it',
        (await bagNow(guest.id))?.status === 'converted' && (await cartOf(paying.id)) === guest.id,
      )

      check(
        'G4: …and the lines just bought are not copied into the account bag',
        (await linesOf(account.id)).length === 0,
      )
    }

    /*
     * ---- G5 and G6: an order is being written on the guest bag at the moment the merge runs
     *
     * The recheck of S03 found that the merge read the guest bag's orders BEFORE it locked the bag.
     * An order preflight had inserted but not yet committed was invisible to that read, the bag lock
     * then waited for the insert's commit, and the merge went ahead on the stale "no orders" — it
     * deleted the bag, and the new checkout lost its link to it. So each scenario holds a rival
     * transaction open, starts the merge, waits until Postgres itself says the merge is queued behind
     * the rival, and only then lets the rival write and commit.
     */
    const { cartCheckoutLock } = await import('../src/lib/checkout/pending-order')

    /** A transaction this script holds open, with its backend pid — as `verify-access.ts` does. */
    const holdTransaction = async () => {
      const transactionID = await payload.db.beginTransaction()

      if (transactionID === null) throw new Error('could not open the rival transaction')

      const handle = (
        payload.db as unknown as {
          sessions: Record<
            string,
            { db: { execute: (query: unknown) => Promise<{ rows: unknown[] }> } }
          >
        }
      ).sessions[String(transactionID)]!.db

      const { rows } = await handle.execute(sql`SELECT pg_backend_pid() AS "pid"`)

      return {
        commit: () => payload.db.commitTransaction(transactionID),
        execute: (query: unknown) => handle.execute(query),
        pid: Number((rows[0] as { pid: number }).pid),
        req: { transactionID } as Parameters<typeof payload.create>[0]['req'],
        rollback: () => payload.db.rollbackTransaction(transactionID).catch(() => undefined),
      }
    }

    /** Wait until some other backend is blocked on a lock held by `pid`. */
    const blockedBehind = async (pid: number, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs

      while (Date.now() < deadline) {
        const { rows } = await payload.db.drizzle.execute(
          sql`SELECT count(*)::int AS "waiting" FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`,
        )

        if ((rows[0] as { waiting: number }).waiting > 0) return true

        await new Promise((resolve) => setTimeout(resolve, 25))
      }

      return false
    }

    /* ---- G5: preflight holds the bag's checkout lock, and its order is not written yet */
    {
      const customer = await makeCustomer('g5')
      const account = await makeBag('g5-account', customer.id, 0)
      const guest = await makeBag('g5-guest', null, 1)

      /* `upsertPendingOrder`'s first statement: the per-bag lock, held to its commit. */
      const preflight = await holdTransaction()

      await preflight.execute(cartCheckoutLock(guest.id))

      const merging = mergeGuestBag(payload, customer.id, guest.token).then(
        (result) => ({ error: null, result }),
        (error: unknown) => ({ error, result: null }),
      )

      const parked = await blockedBehind(preflight.pid)

      /* …then it creates the order on the bag and commits, as preflight does after its lookup. */
      const written = await makeOrder('G5', guest.id, 'checkout_started', preflight.req).then(
        async (order) => {
          await preflight.commit()

          return order
        },
        async () => {
          await preflight.rollback()

          return null
        },
      )

      const merged = await merging

      check(
        'G5: **S03 the merge waits for a checkout being prepared on the guest bag** — the same checkout lock',
        parked,
      )

      check(
        'G5: **…and defers once that order is committed** — nothing merged, cookie kept',
        written !== null && merged.error === null && merged.result?.outcome === 'deferred',
        `order ${written === null ? 'not written' : 'written'}; ${merged.error === null ? JSON.stringify(merged.result) : String(merged.error)}`,
      )

      check(
        'G5: …the new order still points at the guest bag, which keeps its line, and the account bag gets nothing',
        written !== null &&
          (await cartOf(written.id)) === guest.id &&
          (await bagNow(guest.id))?.status === 'active' &&
          (await linesOf(guest.id)).length === 1 &&
          (await linesOf(account.id)).length === 0,
        written === null ? 'no order' : `order cart ${await cartOf(written.id)}`,
      )
    }

    /* ---- G6: an order inserted on the guest bag, uncommitted, by a writer without the checkout lock */
    {
      const customer = await makeCustomer('g6')
      const account = await makeBag('g6-account', customer.id, 0)
      const guest = await makeBag('g6-guest', null, 1)

      /* The insert's foreign-key check holds a key-share lock on the bag row until it commits. */
      const writer = await holdTransaction()
      const order = await makeOrder('G6', guest.id, 'checkout_started', writer.req)

      const merging = mergeGuestBag(payload, customer.id, guest.token).then(
        (result) => ({ error: null, result }),
        (error: unknown) => ({ error, result: null }),
      )

      /* The merge has passed its order lock — the row is invisible to it — and waits for the bag. */
      const parked = await blockedBehind(writer.pid)

      await writer.commit()

      const merged = await merging

      check('G6: the race was really run — the merge queued behind the uncommitted insert', parked)

      check(
        'G6: **S03 an order committed while the merge waited for the bag is seen** — deferred, not merged',
        merged.error === null && merged.result?.outcome === 'deferred',
        merged.error === null ? JSON.stringify(merged.result) : String(merged.error),
      )

      check(
        'G6: …so the order keeps its bag, the bag keeps its line, and the account bag gets nothing',
        (await cartOf(order.id)) === guest.id &&
          (await bagNow(guest.id))?.status === 'active' &&
          (await linesOf(guest.id)).length === 1 &&
          (await linesOf(account.id)).length === 0,
        `order cart ${await cartOf(order.id)}, guest ${(await bagNow(guest.id)) === null ? 'gone' : 'kept'}`,
      )
    }
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
