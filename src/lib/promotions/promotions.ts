import 'server-only'

import { getPayloadClient } from '@/lib/payload'

import {
  attachCollectionMembership,
  countCustomerUses,
  findPromotionByCode,
  toPromotionInput,
  type ResolvedPromotion,
} from './read'
import { calculateDiscount, type DiscountLine } from './rules'

export type { ResolvedPromotion } from './read'
export { resolvePromotion, toPromotionInput } from './read'

/**
 * **The two mutations, and the only part of Phase 15 that needs a request-scoped client.**
 *
 * Everything that merely *reads* a promotion lives in `read.ts`, which carries no `server-only`
 * guard so the harness can exercise it. This file is the half that calls `getPayloadClient`, and the
 * guard is here for the reason the guard exists: a client component importing it must be a build
 * error, not a runtime surprise.
 */

/**
 * The whole apply path: look the code up, decide it against the live bag, and write the choice.
 *
 * **One code at a time.** `carts.promotion` is a single relationship, so applying a second code
 * replaces the first — §15.1c's *"multiple codes attempted"* resolved by the schema rather than by a
 * rule that could be forgotten, and the default the plan asks for (**DEV-08**).
 *
 * A code that does not currently apply is **not written**. Storing an invalid promotion would mean
 * the bag carried a code the customer would see fail on every subsequent page.
 */
export async function applyPromotion(
  cartId: number,
  code: string,
  lines: DiscountLine[],
  cartCurrency: string,
  customerId: null | number,
): Promise<ResolvedPromotion | { reason: 'unknownCode' }> {
  const payload = await getPayloadClient()
  const doc = await findPromotionByCode(payload, code)

  if (!doc) {
    return { reason: 'unknownCode' }
  }

  const promotion = toPromotionInput(doc)
  const scoped = await attachCollectionMembership(payload, lines, promotion.eligibleCollectionIds)

  const result = calculateDiscount(scoped, promotion, {
    cartCurrency,
    customerUses: await countCustomerUses(payload, promotion.id, customerId),
    now: new Date(),
  })

  if (result.reason !== null) {
    return { code: promotion.code, id: promotion.id, promotion, result }
  }

  await payload.update({
    collection: 'carts',
    data: { promotion: promotion.id },
    id: cartId,
    overrideAccess: true,
  })

  return { code: promotion.code, id: promotion.id, promotion, result }
}

export async function clearPromotion(cartId: number): Promise<void> {
  const payload = await getPayloadClient()

  await payload.update({
    collection: 'carts',
    data: { promotion: null },
    id: cartId,
    overrideAccess: true,
  })
}
