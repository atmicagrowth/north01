import type { Payload } from 'payload'

import type { Promotion } from '@/payload-types'

import {
  calculateDiscount,
  normalisePromotionCode,
  PROMOTION_CODE_MAX_LENGTH,
  type DiscountLine,
  type DiscountResult,
  type PromotionInput,
} from './rules'

/**
 * **Reading promotions, and counting what only the database can count.**
 *
 * **No `server-only` guard, and that is the same structural choice `lib/catalog/query.ts` makes.**
 * Every function here takes a `Payload` instance as an argument rather than reaching for one — it
 * touches no cookie, no request and no secret — so it is importable by `pnpm verify:promotions`,
 * which runs outside Next where `server-only` cannot resolve at all. The guard belongs on the module
 * that calls `getPayloadClient`, which is `promotions.ts` next door.
 *
 * Found the moment the harness first ran: `ERR_MODULE_NOT_FOUND: Cannot find package 'server-only'`.
 * A guard on the wrong module does not make anything safer; it only makes it untestable.
 *
 * Every *rule* is in `rules.ts`. This file turns a Payload document into the structural input those
 * rules take, answers the one question they cannot — how many times this customer has already used
 * this code — and nothing else.
 *
 * ### `overrideAccess: true`, because the collection is staff-only on purpose
 *
 * `Promotions.ts` closes **read** as well as write: *"an open `GET /api/promotions` hands every
 * unreleased code, every threshold and every exclusion to anyone who asks."* So the storefront never
 * reads the collection through the API, and this module reads it past access control — which is
 * exactly what that docblock says Phase 15 would do.
 *
 * Nothing about a promotion reaches the browser except the code the customer typed, the label, and
 * the amount it took off. A failure returns a *reason*, and two of the nine reasons deliberately
 * produce the same sentence so that a form field cannot be used to enumerate unreleased codes.
 *
 * ### The per-customer count comes from orders, not from a counter
 *
 * `Promotions.ts` again: *"`perCustomerLimit` is compared against a count of that customer's paid
 * orders carrying this promotion."* A second counter would duplicate a fact the orders table owns and
 * would be wrong the first time an order was refunded. A guest has no orders to count, so a
 * per-customer limit is unenforceable against them — recorded in **DEV-59** rather than pretended
 * away.
 */

/** A promotion whose validity has been decided against a specific bag. */
export type ResolvedPromotion = {
  code: string
  id: number
  promotion: PromotionInput
  result: DiscountResult
}

const idsOf = (value: unknown): number[] =>
  Array.isArray(value)
    ? value
        .map((entry) =>
          typeof entry === 'number'
            ? entry
            : typeof entry === 'object' && entry && 'id' in entry
              ? (entry as { id: number }).id
              : null,
        )
        .filter((id): id is number => typeof id === 'number')
    : []

/** A Payload document as the pure rules see it. The only place the two shapes meet. */
export function toPromotionInput(doc: Promotion): PromotionInput {
  return {
    active: doc.active === true,
    code: doc.code,
    currency: doc.currency ?? null,
    eligibleCollectionIds: idsOf(doc.eligibleCollections),
    eligibleProductIds: idsOf(doc.eligibleProducts),
    endsAt: doc.endsAt ?? null,
    id: doc.id,
    minimumSubtotalMinor:
      typeof doc.minimumSubtotalMinor === 'number' ? doc.minimumSubtotalMinor : null,
    percentage: typeof doc.percentage === 'number' ? doc.percentage : null,
    perCustomerLimit: typeof doc.perCustomerLimit === 'number' ? doc.perCustomerLimit : null,
    startsAt: doc.startsAt ?? null,
    timesUsed: typeof doc.timesUsed === 'number' ? doc.timesUsed : 0,
    type: doc.type,
    usageLimit: typeof doc.usageLimit === 'number' ? doc.usageLimit : null,
    valueMinor: typeof doc.valueMinor === 'number' ? doc.valueMinor : null,
  }
}

/**
 * Find a promotion by the code a customer typed.
 *
 * The lookup normalises first, so §15.1c's *"case sensitivity"* and *"whitespace"* stop being edge
 * cases before the query runs — the stored column is normalised by the collection's own hook, and
 * this applies the identical transformation so the unique index compares like with like.
 *
 * A code longer than the column can hold cannot match anything, so it is refused without a query.
 */
export async function findPromotionByCode(
  payload: Payload,
  raw: string,
): Promise<null | Promotion> {
  const code = normalisePromotionCode(raw)

  if (code.length < 2 || code.length > PROMOTION_CODE_MAX_LENGTH) {
    return null
  }

  const { docs } = await payload.find({
    collection: 'promotions',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { code: { equals: code } },
  })

  return docs[0] ?? null
}

/**
 * How many times this customer has already redeemed this code — or is redeeming it right now.
 *
 * Counted from **paid** orders, and (Phase 36, audit R1-07) from **`pending_payment`** orders too: a
 * customer who has been sent to Stripe with the code is using it, and counting only paid orders let
 * one customer open several checkouts, each validated at zero uses, and pay for all of them. An order
 * that started checkout and never reached Stripe has not used a code, and a refunded order is not a
 * paid one — the case a stored counter gets wrong.
 *
 * **Excluding the current attempt.** The customer's own in-flight order for the bag they are looking
 * at is `pending_payment` too, and counting it would tell them they had used the code they are
 * trying to finish paying with. That order belongs to their *active* cart — one order per cart,
 * `checkout/preflight.ts` — so pending orders whose cart is still active are not counted. A pending
 * order on any other cart is a different checkout that can still be paid, and is.
 */
export async function countCustomerUses(
  payload: Payload,
  promotionId: number,
  customerId: null | number,
): Promise<number> {
  if (customerId === null) {
    return 0
  }

  const { docs: activeCarts } = await payload.find({
    collection: 'carts',
    depth: 0,
    limit: 50,
    overrideAccess: true,
    pagination: false,
    where: {
      and: [{ customer: { equals: customerId } }, { status: { equals: 'active' } }],
    },
  })

  const activeCartIds = activeCarts.map((cart) => cart.id)

  const { totalDocs } = await payload.find({
    collection: 'orders',
    depth: 0,
    limit: 0,
    overrideAccess: true,
    where: {
      and: [
        { promotion: { equals: promotionId } },
        { customer: { equals: customerId } },
        {
          or: [
            { paymentStatus: { equals: 'paid' } },
            {
              and: [
                { paymentStatus: { equals: 'pending_payment' } },
                ...(activeCartIds.length > 0
                  ? [
                      {
                        or: [{ cart: { not_in: activeCartIds } }, { cart: { exists: false } }],
                      },
                    ]
                  : []),
              ],
            },
          ],
        },
      ],
    },
  })

  return totalDocs
}

/**
 * **Which of these lines belong to the promotion's eligible collections.**
 *
 * Membership is owned by the **collection**, not the product: `products.collections` is a Payload
 * `join`, which is virtual and has no column, so reading it from a product gives a paginated
 * `{ docs }` object rather than a list of ids — and a caller that treated it as an array would get an
 * empty one and a collection-scoped promotion that silently never applied. Phase 11 learned the same
 * thing about facets; the direction is forced by `collections.products` being the ordered `hasMany`
 * that curation writes.
 *
 * So the query runs the other way, and **only when the promotion names collections at all** — which
 * most do not. A code with no eligibility lists costs no query here.
 */
export async function attachCollectionMembership(
  payload: Payload,
  lines: DiscountLine[],
  eligibleCollectionIds: number[],
): Promise<DiscountLine[]> {
  if (eligibleCollectionIds.length === 0 || lines.length === 0) {
    return lines
  }

  const { docs } = await payload.find({
    collection: 'collections',
    depth: 0,
    limit: eligibleCollectionIds.length,
    overrideAccess: true,
    pagination: false,
    where: { id: { in: eligibleCollectionIds } },
  })

  /** productId -> the eligible collections it is a member of. */
  const membership = new Map<number, number[]>()

  for (const collection of docs) {
    for (const productId of idsOf(collection.products)) {
      membership.set(productId, [...(membership.get(productId) ?? []), collection.id])
    }
  }

  return lines.map((line) => ({
    ...line,
    collectionIds: membership.get(line.productId) ?? [],
  }))
}

/**
 * **Decide a promotion against a bag, right now.**
 *
 * Called from two places and they are different moments: when a customer applies a code, and on
 * **every read of the bag afterwards**. The second is the one that matters — §15.1c's first two edge
 * cases are *"expired code during checkout"* and *"code reaches usage limit between cart and
 * checkout"*, and both are the same fact: a code that was valid when it was applied may not be valid
 * now. Nothing about the discount is stored on the cart except which promotion was chosen, so there
 * is no stale amount to go wrong.
 */
export async function resolvePromotion(
  payload: Payload,
  promotionId: number,
  lines: DiscountLine[],
  cartCurrency: string,
  customerId: null | number,
): Promise<null | ResolvedPromotion> {
  const doc = await payload
    .findByID({ collection: 'promotions', depth: 0, id: promotionId, overrideAccess: true })
    .catch(() => null)

  if (!doc) {
    return null
  }

  const promotion = toPromotionInput(doc)
  const scoped = await attachCollectionMembership(payload, lines, promotion.eligibleCollectionIds)

  return {
    code: promotion.code,
    id: promotion.id,
    promotion,
    result: calculateDiscount(scoped, promotion, {
      cartCurrency,
      customerUses: await countCustomerUses(payload, promotion.id, customerId),
      now: new Date(),
    }),
  }
}
