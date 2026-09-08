/**
 * **Plan §15.1a's eight checks and §15.1b's calculation, as pure functions.**
 *
 * §15.1a opens with two words — *"Server-side only"* — and §15.1b asks for *"a pure calculation
 * function separate from UI"* that *"must be unit tested extensively"*. This module is both halves.
 * It imports nothing from Next, Payload or `server-only`, so `pnpm verify:promotions` can walk every
 * edge case §15.1c enumerates without a database, a request or a browser.
 *
 * `lib/promotions/promotions.ts` does the reads, the writes and the failure policy. It decides
 * nothing.
 *
 * ---
 *
 * ### The output shape is the plan's, exactly
 *
 * §15.1b names four outputs: *"eligible subtotal, discount amount, final subtotal, reason if
 * invalid."* `DiscountResult` is those four and one more — `freeShipping`, because
 * `Promotions.type` has a third value the plan's output list does not cover and dropping it on the
 * floor would make a whole promotion type silently do nothing.
 *
 * ### A failure has a reason, and the reason is a value rather than a sentence
 *
 * Eight checks can fail and a customer typing a code deserves to know which. The reason is a union
 * member, not a string, so the copy lives in one place, the harness can assert the *decision* rather
 * than the wording, and a message can be changed without touching the engine.
 *
 * ### Order matters, because only the first failure is shown
 *
 * A code that is expired *and* under its minimum should say expired: the customer can do something
 * about a small basket and nothing about a date. The order below runs from *"this code is not for
 * you"* to *"this code is not for this bag"*, which is also least-to-most actionable.
 */

import { toMinorAmount, toWholeCount } from '@/lib/money'

/** Trim and upper-case — the same normalisation `fields/slug.ts` applies on the way into the database. */
export function normalisePromotionCode(raw: string): string {
  return raw.trim().toUpperCase()
}

/** The longest code the schema will store. A longer input cannot match anything. */
export const PROMOTION_CODE_MAX_LENGTH = 32

export type PromotionType = 'fixed' | 'free_shipping' | 'percentage'

/** A promotion as the rules see it. Structural rather than a Payload type, so fixtures are cheap. */
export type PromotionInput = {
  active: boolean
  code: string
  /** Only meaningful for `fixed` — a money amount is only an amount in one currency. */
  currency: null | string
  eligibleCollectionIds: number[]
  eligibleProductIds: number[]
  endsAt: null | string
  id: number
  minimumSubtotalMinor: null | number
  percentage: null | number
  perCustomerLimit: null | number
  startsAt: null | string
  timesUsed: number
  type: PromotionType
  usageLimit: null | number
  valueMinor: null | number
}

/** One bag line, with everything eligibility needs to be decided from. */
export type DiscountLine = {
  /** Every collection this product belongs to. Resolved at validation time, per `Promotions.ts`. */
  collectionIds: number[]
  productId: number
  quantity: number
  unitPriceMinor: number
}

export type PromotionContext = {
  /** The bag's currency, fixed when the bag was created. */
  cartCurrency: string
  /**
   * How many times **this customer** has already used this code, counted from paid orders.
   *
   * `Promotions.ts` is explicit that this is not a stored counter: it is a count of the customer's
   * paid orders carrying the promotion, because a second counter would be a duplicate of a fact the
   * orders table owns and would be wrong the first time an order was refunded.
   */
  customerUses: number
  now: Date
}

export type PromotionFailure =
  | 'currency'
  | 'expired'
  | 'inactive'
  | 'minimumSubtotal'
  | 'noEligibleItems'
  | 'notStarted'
  | 'perCustomerLimit'
  | 'unknownCode'
  | 'usageLimit'

export type DiscountResult = {
  /** §15.1b. Zero when the code does not apply. */
  discountMinor: number
  /** §15.1b. The part of the bag this code is allowed to touch. */
  eligibleSubtotalMinor: number
  /** §15.1b. The whole bag's subtotal after the discount — never below zero. */
  finalSubtotalMinor: number
  /** `free_shipping` promotions carry their effect here rather than in `discountMinor`. */
  freeShipping: boolean
  /** §15.1b's *"reason if invalid"*. `null` when the code applies. */
  reason: null | PromotionFailure
}

const subtotalOf = (lines: DiscountLine[]): number =>
  lines.reduce(
    (total, line) => total + toMinorAmount(line.unitPriceMinor) * toWholeCount(line.quantity),
    0,
  )

/**
 * Which lines this promotion is allowed to discount — §15.1a's *"product/collection eligibility"*.
 *
 * **Both lists empty means the whole bag.** `Promotions.ts` says so in the field description, and it
 * is the common case: most codes are not restricted. When either list has entries, a line qualifies
 * if it matches **either** — the two lists are alternatives, not a conjunction, because an editor
 * naming a product *and* a collection means "these things" rather than "things that are both".
 *
 * §15.1c's *"code applies to one item but not another"* is this function returning a subset, and the
 * discount being computed from that subset rather than from the bag.
 */
export function eligibleLines(lines: DiscountLine[], promotion: PromotionInput): DiscountLine[] {
  const products = new Set(promotion.eligibleProductIds)
  const collections = new Set(promotion.eligibleCollectionIds)

  if (products.size === 0 && collections.size === 0) {
    return lines
  }

  return lines.filter(
    (line) =>
      products.has(line.productId) ||
      line.collectionIds.some((collectionId) => collections.has(collectionId)),
  )
}

/**
 * **§15.1a, all eight checks**, in the order the customer is told about them.
 *
 * Returns the first failure or `null`. It takes the cart's subtotal rather than computing one,
 * because `minimumSubtotalMinor` is compared against *"the subtotal before shipping and tax"* — the
 * whole bag, per the field's own description, not the eligible subset. A code that says "spend $100"
 * means spend $100, not "have $100 of qualifying goods".
 */
export function validatePromotion(
  promotion: PromotionInput,
  lines: DiscountLine[],
  context: PromotionContext,
): null | PromotionFailure {
  if (!promotion.active) {
    return 'inactive'
  }

  const now = context.now.getTime()

  if (promotion.startsAt && new Date(promotion.startsAt).getTime() > now) {
    return 'notStarted'
  }

  if (promotion.endsAt && new Date(promotion.endsAt).getTime() <= now) {
    return 'expired'
  }

  if (promotion.usageLimit !== null && promotion.timesUsed >= promotion.usageLimit) {
    return 'usageLimit'
  }

  if (promotion.perCustomerLimit !== null && context.customerUses >= promotion.perCustomerLimit) {
    return 'perCustomerLimit'
  }

  /*
   * Currency only constrains a FIXED amount. A percentage is dimensionless — 10% off is 10% off in
   * any currency — and free shipping has no amount at all. Applying the check to all three would
   * make a percentage code fail in a currency it works perfectly well in.
   */
  if (
    promotion.type === 'fixed' &&
    promotion.currency !== null &&
    promotion.currency !== context.cartCurrency
  ) {
    return 'currency'
  }

  if (
    promotion.minimumSubtotalMinor !== null &&
    subtotalOf(lines) < promotion.minimumSubtotalMinor
  ) {
    return 'minimumSubtotal'
  }

  if (eligibleLines(lines, promotion).length === 0) {
    return 'noEligibleItems'
  }

  return null
}

/**
 * **§15.1b.** Validate, then compute.
 *
 * ### Rounding is a decision and it is stated here
 *
 * A percentage of a minor-unit amount is rarely a whole number. `Math.round` — not `floor` — because
 * the discount belongs to the customer, and flooring every percentage discount is a systematic
 * fraction of a penny in the shop's favour on every order that has one. Rounding is unbiased across
 * many orders, which is the only property that matters at this scale.
 *
 * ### The discount can never exceed what it is discounting
 *
 * §15.1c names both directions — *"percentage discount exceeds subtotal"* and *"fixed discount larger
 * than eligible subtotal"*. A percentage of at most 100 cannot exceed its base, but the clamp is
 * applied to both anyway: the alternative is a rule that holds only while a validator elsewhere keeps
 * `percentage` at or below 100, and a discount larger than the bag is a negative total, which is a
 * refund the shop did not agree to.
 *
 * The clamp is against the **eligible** subtotal, not the bag's. A $50 code on a bag holding $200 of
 * ineligible goods and $20 of eligible ones takes $20.
 */
export function calculateDiscount(
  lines: DiscountLine[],
  promotion: PromotionInput,
  context: PromotionContext,
): DiscountResult {
  const reason = validatePromotion(promotion, lines, context)
  const eligibleSubtotalMinor = subtotalOf(eligibleLines(lines, promotion))
  const subtotal = subtotalOf(lines)

  if (reason !== null) {
    return {
      discountMinor: 0,
      eligibleSubtotalMinor,
      finalSubtotalMinor: subtotal,
      freeShipping: false,
      reason,
    }
  }

  if (promotion.type === 'free_shipping') {
    return {
      discountMinor: 0,
      eligibleSubtotalMinor,
      finalSubtotalMinor: subtotal,
      freeShipping: true,
      reason: null,
    }
  }

  const raw =
    promotion.type === 'percentage'
      ? Math.round((eligibleSubtotalMinor * Math.max(0, promotion.percentage ?? 0)) / 100)
      : toMinorAmount(promotion.valueMinor ?? 0)

  const discountMinor = Math.min(raw, eligibleSubtotalMinor)

  return {
    discountMinor,
    eligibleSubtotalMinor,
    finalSubtotalMinor: Math.max(0, subtotal - discountMinor),
    freeShipping: false,
    reason: null,
  }
}

/* -------------------------------------------------------------------------------------------------
 * Copy
 * ---------------------------------------------------------------------------------------------- */

/**
 * One sentence per failure, in one place.
 *
 * **Every one of them says what the customer can do about it, or that there is nothing to do.** The
 * two that reveal nothing are deliberate: `inactive` and `unknownCode` produce the *same* message,
 * because telling somebody that a code exists but is switched off is telling them a code exists —
 * which is how an unreleased campaign leaks from a form field.
 */
export const PROMOTION_COPY: Record<PromotionFailure, string> = {
  currency: 'That code cannot be used in this currency.',
  expired: 'That code has expired.',
  inactive: 'That code is not recognised.',
  minimumSubtotal: 'Your bag is under the minimum for that code.',
  noEligibleItems: 'That code does not apply to anything in your bag.',
  notStarted: 'That code is not active yet.',
  perCustomerLimit: 'You have already used that code.',
  unknownCode: 'That code is not recognised.',
  usageLimit: 'That code has been fully redeemed.',
}

/** What the bag shows beside an applied code. */
export function discountLabel(promotion: PromotionInput): string {
  if (promotion.type === 'free_shipping') {
    return 'Free delivery'
  }

  return promotion.type === 'percentage' ? `${promotion.percentage ?? 0}% off` : 'Amount off'
}
