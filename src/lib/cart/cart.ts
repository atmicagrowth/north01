import 'server-only'

import { randomBytes } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres'
import { cookies } from 'next/headers'
import { cache } from 'react'
import type { Payload } from 'payload'

import { getCatalogSettings, type CatalogSettings } from '@/lib/catalog/catalog'
import { cartCheckoutLock } from '@/lib/checkout/pending-order'
import { resolvePromotion, type ResolvedPromotion } from '@/lib/promotions/promotions'
import { shippingProvider } from '@/lib/shipping/provider'
import type { ShippingQuote } from '@/lib/shipping/rules'
import { taxProvider } from '@/lib/tax/provider'
import type { TaxResult } from '@/lib/tax/rules'
import { appEnv } from '@/lib/env.server'
import { publishedProductWhere } from '@/lib/catalog/query'
import { resolveProductCards, type ProductCard } from '@/lib/catalog/resolve'
import { formatMinorUnits } from '@/lib/money'
import { getPayloadClient } from '@/lib/payload'
import type { Cart, CartItem, Media, Product, ProductVariant } from '@/payload-types'

import {
  cartTotals,
  clampQuantity,
  mergeCartLines,
  priceMovedFrom,
  shippingProgress,
  type CartLineInput,
  type CartTotals,
  type ClampedQuantity,
  type LineAvailability,
  type ShippingProgress,
} from './rules'

/**
 * **The bag: reads, writes, the cookie, and the failure policy.**
 *
 * Every *rule* is in `rules.ts`. This file decides nothing about quantities, merges or totals — it
 * loads what those rules need, applies them, and writes the result down.
 *
 * ---
 *
 * ### `overrideAccess: true`, and why that is the safe answer here rather than the lazy one
 *
 * `Carts.ts` and `CartItems.ts` grant **no** customer write access, on purpose: their docblocks say
 * that opening `PATCH /api/carts` would put a second, unvalidated door onto the same table. This
 * module is the only door. It runs past those rules because it is the code the rules were written to
 * exclude everyone else in favour of — and every mutation below re-reads the variant, the product
 * and the settings from the database before it writes anything.
 *
 * That is the opposite posture from `lib/catalog/catalog.ts`, which reads the storefront with
 * `overrideAccess: false` so that a draft is invisible even to a bug. The difference is that reads
 * there are *for* the browser, and writes here are *about* the browser's request but never take its
 * word for anything.
 *
 * ### The token is the only thing the browser holds, and it holds it in an HTTP-only cookie
 *
 * §14.1a: *"a cryptographically strong server-issued cart token stored in a secure, HTTP-only cookie
 * where practical."* It is practical. The token is 32 bytes of CSPRNG entropy, generated **here** —
 * `Carts.ts` anticipates that and keeps its own generator as the guarantee that no other writer can
 * create a cart without one. This module never accepts a token from a request body; the browser's
 * only role is to hand back the cookie it was given. A guessed token is a stranger's bag, which is
 * why it is 256 bits and why nothing in it is derived from the customer.
 *
 * **`sameSite: 'lax'`** rather than `strict`: a bag must survive arriving from an email link or a
 * search result, and `strict` drops the cookie on every cross-site navigation into the shop. `lax`
 * still withholds it from cross-site POSTs, which is the case that matters.
 *
 * ### Reading a bag revalidates it, and that is why the read is a mutation
 *
 * §14.1e lists *"product price changed"*, *"product becomes unavailable"*, *"quantity becomes
 * unavailable"* and *"user opens multiple tabs and carts diverge"*. All four are the same fact: the
 * bag is a set of references and the world moves underneath it. So `getCart` re-reads every variant
 * live, clamps every quantity, and reports what changed — it never repairs the stored rows behind the
 * customer's back on a plain read, because a page view is not a decision. The repair happens on the
 * next mutation and at checkout preflight (§17.1a), and until then the customer sees the truth with
 * the reason beside it.
 */

/**
 * The cookie holding the guest bag's token.
 *
 * The **only** cookie this application names itself — the session cookie is Payload's
 * `payload-token`, from its own `cookiePrefix` default. An earlier version of this comment claimed
 * the two shared a prefix; they do not, and Phase 14's second sweep corrected the sentence rather
 * than renaming a cookie to make a comment true.
 */
const CART_COOKIE = 'north01_cart'

/** Thirty days, matching `Carts.expiresAt`'s default. A bag and its cookie should expire together. */
const CART_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

/** Two hops: `variant.image` and `product.gallery[].image`. */
const CART_DEPTH = 2

/**
 * No real bag is near this. It exists so a corrupt row cannot make the drawer unbounded.
 *
 * It is a **real** cap, not headroom: `pagination: false` does not make `limit` decorative — measured
 * during Phase 13's second sweep, a `pagination: false` read with `limit: 2` returns two rows. So a
 * bag that reached 200 lines would silently render 200 of them and total 200 of them, which is a
 * wrong number rather than a slow page. `readCartLines` logs if it ever binds, because "no real bag
 * is near this" is a prediction and a log is a fact.
 */
const LINE_LIMIT = 200

export type CartLineView = {
  /** `null` when the variant cannot currently be bought — §14.1e's "product becomes unavailable". */
  availability: LineAvailability | null
  color: null | string
  /**
   * **What the customer will actually get**, which is not always what the row says.
   *
   * The stored `quantity` is what they asked for; this is that number clamped to what the warehouse
   * and the policy can meet today. They differ exactly when §14.1e's *"quantity becomes unavailable"*
   * has happened, and the bag renders **this** one — because the subtotal is computed from it, and a
   * line reading "2" beside a subtotal charging for one is a page that contradicts itself.
   *
   * The stored row is left alone: a read is not a decision (see the module docblock). The repair
   * happens on the next mutation, and until then the customer sees the truth with the original
   * beside it.
   */
  effectiveQuantity: number
  id: number
  image: Media | null
  /**
   * True when `maxQuantity` is the per-order policy (`maxQuantityPerLine`) rather than stock — the
   * warehouse has more. The line then says "up to N per order" instead of "that is all we have".
   */
  limitedByPolicy: boolean
  /** The most this line may hold right now, for the stepper's bound. */
  maxQuantity: number
  productId: number
  productName: string
  productSlug: string
  quantity: number
  size: null | string
  /**
   * The variant's SKU, for the order snapshot.
   *
   * `OrderItems.sku` is required and durable — `ProductVariants.ts` never reassigns a SKU — so an
   * order records what was actually bought even after the variant is withdrawn. Carrying it on the
   * line means checkout does not re-read every variant it has already read.
   */
  sku: null | string
  /**
   * The unit price when the customer last added or changed this line, formatted — present only when
   * it differs from today's. Plan §31.1e; see `priceMovedFrom`.
   */
  priceChangedFromLabel?: null | string
  /** `null` when the variant has no usable price. */
  unitPriceLabel: null | string
  unitPriceMinor: null | number
  variantId: number
}

export type CartView = {
  currency: CatalogSettings['currency']
  /**
   * The applied discount code, decided against **this** bag on **this** read — Phase 15.
   *
   * `null` when no code is applied. When a code is applied but no longer valid, this is present with
   * a `result.reason`, because §15.1c's *"expired code during checkout"* and *"code reaches usage
   * limit between cart and checkout"* are both cases where the customer must be told rather than
   * quietly charged full price.
   */
  discount: null | ResolvedPromotion
  /** True when the live read disagreed with the stored rows — §14.1e's stale-state banner. */
  drifted: boolean
  id: number
  lines: CartLineView[]
  locale: string
  /** Feature matrix §10 again: products related to what is in the bag. */
  recommendations: ProductCard[]
  shipping: null | ShippingProgress
  /** Phase 16's quote for this bag. `destinationKnown` is false until checkout has an address. */
  shippingQuote: ShippingQuote
  /** Phase 16's tax boundary. `pending_address` on every bag, because there is no address yet. */
  tax: TaxResult
  totals: CartTotals
}

/** What a mutation returns. Never a total — the caller re-reads the bag. */
export type CartMutationResult = {
  clamped?: ClampedQuantity
  ok: boolean
  reason?: 'invalid' | 'notFound' | 'unavailable'
}

/* -------------------------------------------------------------------------------------------------
 * Identity — plan §14.1a
 * ---------------------------------------------------------------------------------------------- */

/**
 * The bag for this request, creating one only when asked.
 *
 * `create: false` is the default and it matters: a page view must not write a row. A crawler hitting
 * every product page would otherwise leave a cart per request, and the table that holds anonymous
 * shoppers' bags is the last one that should grow on reads.
 */
async function resolveCart(
  payload: Payload,
  customerId: null | number,
  create = false,
): Promise<Cart | null> {
  const jar = await cookies()
  const token = jar.get(CART_COOKIE)?.value ?? null
  const now = new Date().toISOString()

  /*
   * A signed-in shopper's bag is found by customer id first. The cookie may still be carrying a
   * guest token from before they signed in — `mergeGuestCart` clears it, but a request that races
   * the merge must not resurrect the guest bag.
   */
  if (customerId !== null) {
    const { docs } = await payload.find({
      collection: 'carts',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      sort: '-updatedAt',
      where: {
        and: [
          { customer: { equals: customerId } },
          { status: { equals: 'active' } },
          { expiresAt: { greater_than: now } },
        ],
      },
    })

    if (docs[0]) {
      return docs[0]
    }
  }

  if (token) {
    const { docs } = await payload.find({
      collection: 'carts',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        and: [
          { token: { equals: token } },
          { status: { equals: 'active' } },
          { expiresAt: { greater_than: now } },
        ],
      },
    })

    const found = docs[0]

    /*
     * **A cart that has an owner is never resolvable by cookie.** `!found.customer` is the whole
     * condition, and it was `customerId === null || !found.customer` until Phase 14's second sweep —
     * which meant an ANONYMOUS request presenting the cookie of a signed-in session's cart was
     * handed that cart. Measured: register, add one thing, sign out, and the header still read
     * "Bag, 1 item" — the previous account holder's bag, on a shared machine, to whoever sat down
     * next. `logout` now clears the cookie as well; this is the check that does not depend on it.
     *
     * A guest bag whose token is presented by a signed-in shopper is **used** rather than ignored:
     * this is the ordinary "added things, then signed in" path, and refusing it here would strand
     * the lines.
     *
     * When the request is a mutation, it is also **claimed** — one `customer` write, so the bag
     * stops being findable only by a cookie. Without that, a signed-in shopper whose merge did not
     * run keeps filling an ownerless cart that vanishes with their cookies, and the next sign-in
     * treats it as a guest bag all over again.
     *
     * The claim is a Payload update, so it locks the bag before it reads it (`Carts.ts`,
     * `beforeOperation`): a payment converting this bag at the same moment is waited for, and the
     * claim cannot write `active` back over `converted`.
     *
     * The claim happens on `create` and nowhere else, because `create` is the flag that says this
     * request is a decision. A read still just reads — see the module docblock. (An earlier version
     * of this comment said "claimed" while the code only returned it, which is the mismatch Phase
     * 14's second sweep was looking for.)
     */
    if (found && !found.customer) {
      if (create && customerId !== null) {
        return payload.update({
          collection: 'carts',
          data: { customer: customerId },
          id: found.id,
          overrideAccess: true,
        })
      }

      return found
    }
  }

  if (!create) {
    return null
  }

  const settings = await getCatalogSettings()

  /*
   * The token and the expiry are supplied here rather than left to the collection's own generators,
   * which `Carts.ts` explicitly anticipates (*"Phase 14 owns issuing it to the browser ... and may
   * supply its own value, which this leaves alone"*). The collection's `beforeValidate` hook and
   * `defaultValue` remain as the guarantee that a cart cannot exist without either, for any writer
   * that is not this one — the admin panel, a seed, a future import.
   *
   * The same 32 bytes of CSPRNG entropy. A token is what stands between a shopper and a stranger's
   * bag, so the width is not a place to economise, and it is not derived from anything about them.
   */
  return payload.create({
    collection: 'carts',
    data: {
      ...(customerId === null ? {} : { customer: customerId }),
      currency: settings.currency,
      expiresAt: new Date(Date.now() + CART_COOKIE_MAX_AGE * 1000).toISOString(),
      status: 'active',
      token: randomBytes(32).toString('base64url'),
    },
    overrideAccess: true,
  })
}

/**
 * Put the bag's token in the browser.
 *
 * Called only from mutations, never from a read — a `Set-Cookie` on a GET is what turns a cached page
 * into a shared session. `httpOnly` because no script has any reason to read it and every reason not
 * to be able to.
 */
async function issueCookie(token: string): Promise<void> {
  const jar = await cookies()

  jar.set(CART_COOKIE, token, {
    httpOnly: true,
    maxAge: CART_COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    /*
     * `appEnv`, not `process.env.NODE_ENV`.
     *
     * `payload.config.ts` sets the session cookie's `secure` from `appEnv !== 'local'`, and two
     * cookies on one site deciding the same question by two different rules is how they come to
     * disagree on the deployment nobody tested. `appEnv` is also the project's own answer — it reads
     * `VERCEL_ENV` first and falls back to `NODE_ENV`, and it withholds privilege when it cannot
     * tell preview from production. Reading `process.env` past it was the shortcut §1.9's audit
     * already found once.
     */
    secure: appEnv !== 'local',
  })
}

/**
 * Drop the guest token.
 *
 * Exported for `logout`: a session that owned a cart leaves a cookie behind, and a cookie is a guest
 * identity. `resolveCart` refuses an owned cart by token regardless, so this is belt as well as
 * braces — but leaving a stale token in the jar means the next guest bag is created against a token
 * the browser already has, and the tidier state is no token at all.
 */
export async function forgetCartCookie(): Promise<void> {
  await clearCookie()
}

async function clearCookie(): Promise<void> {
  const jar = await cookies()

  jar.set(CART_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/', sameSite: 'lax' })
}

/* -------------------------------------------------------------------------------------------------
 * Reading
 * ---------------------------------------------------------------------------------------------- */

const relatedId = (value: unknown): null | number => {
  if (typeof value === 'number') {
    return value
  }

  return typeof value === 'object' && value && 'id' in value
    ? ((value as { id: number }).id ?? null)
    : null
}

const asDoc = <T>(value: unknown): T | null =>
  typeof value === 'object' && value !== null ? (value as T) : null

function availabilityOf(
  variant: ProductVariant | null,
  product: Product | null,
): LineAvailability | null {
  if (!variant || !product) {
    return null
  }

  const published =
    product.status === 'published' &&
    (!product.publishedAt || new Date(product.publishedAt).getTime() <= Date.now())

  return {
    active: variant.active !== false,
    inventoryQuantity:
      typeof variant.inventoryQuantity === 'number' ? variant.inventoryQuantity : 0,
    priceMinor: typeof variant.priceMinor === 'number' ? variant.priceMinor : null,
    productPublished: published,
  }
}

/**
 * The bag as the page renders it, or `null` when there is no bag at all.
 *
 * `cache` so the drawer, the header count and the page can each ask without three round trips inside
 * one render.
 */
/**
 * **Plan §31.1f's "session expired": is there a bag on this device that belongs to someone signed out?**
 *
 * A signed-in customer's bag is theirs; `resolveCart` deliberately does not hand it to an anonymous
 * request, even one carrying the right cookie. So when the session expires — seven days, or a sign-out
 * in another tab — `getCart(null)` answers `null`, and checkout and the bag both said *"Your bag is
 * empty"*, which was false: the bag is intact and waiting. This tells the two apart, so the answer can
 * be *sign in*.
 *
 * Only ever called with no signed-in customer. Reads; never writes, never reassigns ownership.
 */
export async function hasSignedOutBag(): Promise<boolean> {
  const jar = await cookies()
  const token = jar.get(CART_COOKIE)?.value ?? null

  if (!token) {
    return false
  }

  const payload = await getPayloadClient()

  const { docs } = await payload.find({
    collection: 'carts',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      and: [
        { token: { equals: token } },
        { status: { equals: 'active' } },
        { expiresAt: { greater_than: new Date().toISOString() } },
        { customer: { exists: true } },
      ],
    },
  })

  return docs.length > 0
}

export const getCart = cache(async (customerId: null | number): Promise<CartView | null> => {
  const payload = await getPayloadClient()
  const settings = await getCatalogSettings()
  const cart = await resolveCart(payload, customerId)

  if (!cart) {
    return null
  }

  const { docs } = await payload.find({
    collection: 'cart-items',
    depth: CART_DEPTH,
    limit: LINE_LIMIT,
    overrideAccess: true,
    pagination: false,
    sort: 'createdAt',
    where: { cart: { equals: cart.id } },
  })

  if (docs.length >= LINE_LIMIT) {
    payload.logger.error(
      { cartId: cart.id, lines: docs.length },
      `A bag reached the ${LINE_LIMIT}-line read cap. Its totals are computed from a truncated ` +
        'read — raise LINE_LIMIT in lib/cart/cart.ts.',
    )
  }

  let drifted = false

  const lines: CartLineView[] = docs.map((item: CartItem) => {
    const variant = asDoc<ProductVariant>(item.variant)
    const product = asDoc<Product>(item.product)
    const availability = availabilityOf(variant, product)

    /*
     * **Two clamps, and they answer different questions.**
     *
     * `held` asks *may the customer keep what they have?* — it clamps the stored quantity, and a
     * difference is drift: stock fell, the variant was withdrawn, the policy changed.
     *
     * `ceiling` asks *how many could they have?* — it clamps the policy maximum, so the answer is
     * `min(stock, policy)` regardless of what is currently in the bag.
     *
     * Using the first for both is the defect a browser found: with one in the bag and two in stock,
     * clamping the stored quantity returns one, `atCeiling` was therefore always true, and the `+`
     * control was disabled on every line in the bag from the moment it was added.
     */
    const held = clampQuantity(item.quantity, availability, settings.maxQuantityPerLine)
    const ceiling = clampQuantity(
      settings.maxQuantityPerLine,
      availability,
      settings.maxQuantityPerLine,
    )

    if (held.quantity !== item.quantity) {
      drifted = true
    }

    const image =
      asDoc<Media>(variant?.image) ?? asDoc<Media>((product?.gallery ?? [])[0]?.image) ?? null

    const unitPriceMinor = availability?.priceMinor ?? null
    const movedFrom = priceMovedFrom(item.priceSeenMinor, unitPriceMinor)

    return {
      availability,
      color: variant?.color?.trim() || null,
      id: item.id,
      image,
      limitedByPolicy:
        ceiling.quantity > 0 && (availability?.inventoryQuantity ?? 0) > ceiling.quantity,
      maxQuantity: ceiling.quantity,
      priceChangedFromLabel:
        movedFrom === null ? null : formatMinorUnits(movedFrom, settings.currency, settings.locale),
      productId: product?.id ?? (relatedId(item.product) as number),
      productName: product?.name ?? 'This item',
      productSlug: product?.slug ?? '',
      effectiveQuantity: held.quantity,
      quantity: item.quantity,
      size: variant?.size?.trim() || null,
      sku: variant?.sku?.trim() || null,
      unitPriceLabel:
        unitPriceMinor === null
          ? null
          : formatMinorUnits(unitPriceMinor, settings.currency, settings.locale),
      unitPriceMinor,
      variantId: variant?.id ?? (relatedId(item.variant) as number),
    }
  })

  /*
   * Totals count only what can actually be bought. A line whose variant has been withdrawn stays
   * visible — §14.1e wants the customer to see it — but paying for it is not on offer, so counting it
   * in the subtotal would quote a price for something that cannot be sold.
   */
  const buyable = lines.filter((line) => line.unitPriceMinor !== null && line.maxQuantity > 0)

  /*
   * The promotion is re-decided on **every read**, never read back from a stored amount. The cart
   * carries which code was chosen and nothing else, so §15.1c's *"expired code during checkout"* and
   * *"code reaches usage limit between cart and checkout"* cannot produce a stale discount: there is
   * no stored number to go stale.
   */
  const promotionId = relatedId(cart.promotion)

  const discount =
    promotionId === null
      ? null
      : await resolvePromotion(
          payload,
          promotionId,
          /*
           * `collectionIds` is left empty here on purpose. Membership is owned by the collection —
           * `products.collections` is a virtual `join` with no column — so `resolvePromotion` fills
           * it from the other side, and only when the promotion actually names collections.
           */
          buyable.map((line) => ({
            collectionIds: [],
            productId: line.productId,
            quantity: line.effectiveQuantity,
            unitPriceMinor: line.unitPriceMinor as number,
          })),
          settings.currency,
          customerId,
        )

  const priced = buyable.map((line) => ({
    quantity: line.effectiveQuantity,
    unitPriceMinor: line.unitPriceMinor as number,
  }))

  /*
   * A free-shipping code carries its effect in `freeShipping`, not in an amount, so it passes `null`
   * and draws no Discount row — "Discount −$0.00" beside "Free delivery" reads as a code that did
   * nothing. A code with an *amount* of zero still draws its row, because that one is genuinely
   * surprising and the customer should see it. DEV-60.
   */
  const discountMinor =
    discount?.result.reason === null && !discount.result.freeShipping
      ? discount.result.discountMinor
      : null

  const subtotalMinor = priced.reduce(
    (total, line) => total + line.unitPriceMinor * line.quantity,
    0,
  )

  /*
   * **Phase 16.** The bag has no address, so this quote prices without one — which the static
   * provider can do honestly, because its prices come from the cart and only its *eligibility* comes
   * from the destination. `destinationKnown` is false and the summary says so.
   *
   * A bag with nothing in it is not quoted at all: charging delivery on an empty bag is a number with
   * nothing under it.
   */
  const shippingQuote = await shippingProvider.quote({
    currency: settings.currency,
    destination: null,
    discountMinor: discountMinor ?? 0,
    freeShippingPromotion: discount?.result.reason === null && discount.result.freeShipping,
    freeShippingThresholdMinor: settings.freeShippingThresholdMinor,
    subtotalMinor,
  })

  const quotedRate =
    priced.length === 0
      ? null
      : (shippingQuote.rates.find((rate) => rate.id === shippingQuote.defaultRateId) ?? null)

  const tax = await taxProvider.calculate({
    address: null,
    currency: settings.currency,
    discountMinor: discountMinor ?? 0,
    shippingMinor: quotedRate?.amountMinor ?? 0,
    subtotalMinor,
  })

  const totals = cartTotals(priced, discountMinor, quotedRate?.amountMinor ?? null, tax.amountMinor)

  return {
    currency: settings.currency,
    discount,
    drifted,
    id: cart.id,
    lines,
    locale: settings.locale,
    recommendations: await readCartRecommendations(payload, lines, settings),
    /*
     * **The discounted subtotal**, which is the number `quoteShipping` compares against the
     * threshold. Reading the raw subtotal here would let the sentence say "free delivery" beside a
     * rate that charges for it — §16.1d's *"free-shipping threshold crossed because of a coupon"*,
     * arriving as two surfaces disagreeing rather than as a wrong number.
     */
    shipping: shippingProgress(
      Math.max(0, totals.subtotalMinor - (totals.discountMinor ?? 0)),
      settings.freeShippingThresholdMinor,
    ),
    shippingQuote,
    tax,
    totals,
  }
})

/**
 * **"You may also like"** for the bag — §14.1e's recommendations.
 *
 * Products sharing a category with something already in the bag, excluding what is already there.
 * The same Postgres-backed rule the product page uses, and Postgres-backed for the same reason: a
 * recommendation that disappears when the search service does is a worse recommendation.
 *
 * An empty bag gets the curated catalogue rather than nothing, because the drawer's empty state is
 * the one place a shopper is most likely to want a way back in.
 */
async function readCartRecommendations(
  payload: Payload,
  lines: CartLineView[],
  settings: CatalogSettings,
): Promise<ProductCard[]> {
  const now = new Date().toISOString()
  const inBag = lines.map((line) => line.productId).filter((id) => typeof id === 'number')

  const categoryIds =
    inBag.length === 0
      ? []
      : (
          await payload.find({
            collection: 'products',
            depth: 0,
            limit: inBag.length,
            overrideAccess: true,
            where: { id: { in: inBag } },
          })
        ).docs.flatMap((product) =>
          (product.categories ?? [])
            .map(relatedId)
            .filter((id): id is number => typeof id === 'number'),
        )

  const read = async (scoped: boolean) => {
    const { docs } = await payload.find({
      collection: 'products',
      depth: 1,
      // Neither join field is read — see `PRODUCT_CARD_POPULATE` in `lib/catalog/resolve.ts`.
      joins: false,
      limit: 4,
      overrideAccess: true,
      sort: ['sortOrder', '-publishedAt', 'slug'],
      where: {
        and: [
          ...publishedProductWhere(now),
          ...(inBag.length > 0 ? [{ id: { not_in: inBag } }] : []),
          ...(scoped && categoryIds.length > 0 ? [{ categories: { in: categoryIds } }] : []),
        ],
      },
    })

    return resolveProductCards(docs, settings.currency, settings.locale, settings.lowStockThreshold)
  }

  const related = categoryIds.length > 0 ? await read(true) : []

  return related.length > 0 ? related : await read(false)
}

/* -------------------------------------------------------------------------------------------------
 * Mutations — plan §14.1c, with §13.1d's revalidation list
 * ---------------------------------------------------------------------------------------------- */

/**
 * §13.1d, in order: *"Product exists. Product is published. Variant exists. Variant active. Quantity
 * is positive integer. Quantity does not exceed allowed bounds/inventory policy. Current price is
 * authoritative."*
 *
 * Every one of those is a database read taken at the moment of the write, and **no price crosses the
 * boundary from the browser at all** — the plan's *"never trust a client-submitted price"* is
 * satisfied by there being nothing to trust: the request carries a variant id and a quantity, and
 * `cart-items` stores no price.
 */
async function readVariantForWrite(payload: Payload, variantId: number) {
  const variant = await payload
    .findByID({ collection: 'product-variants', depth: 1, id: variantId, overrideAccess: true })
    .catch(() => null)

  if (!variant) {
    return null
  }

  const product = asDoc<Product>(variant.product)

  if (!product) {
    return null
  }

  return { availability: availabilityOf(variant, product), product, variant }
}

export async function addToCart(
  customerId: null | number,
  variantId: number,
  requested: number,
): Promise<CartMutationResult> {
  if (!Number.isSafeInteger(variantId) || !Number.isSafeInteger(requested) || requested < 1) {
    return { ok: false, reason: 'invalid' }
  }

  const payload = await getPayloadClient()
  const settings = await getCatalogSettings()
  const found = await readVariantForWrite(payload, variantId)

  if (!found) {
    return { ok: false, reason: 'notFound' }
  }

  const cart = await resolveCart(payload, customerId, true)

  if (!cart) {
    return { ok: false, reason: 'notFound' }
  }

  await issueCookie(cart.token)

  const { docs } = await payload.find({
    collection: 'cart-items',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { and: [{ cart: { equals: cart.id } }, { variant: { equals: variantId } }] },
  })

  const existing = docs[0]

  /*
   * Adding to a line that already exists is an increment, not a replacement — the double-tap and the
   * "one more of these" case are the same gesture. The SUM is what gets clamped, for the reason
   * `mergeCartLines` clamps the sum: two checks that each pass can still add up to more than the
   * warehouse has.
   */
  const clamped = clampQuantity(
    (existing?.quantity ?? 0) + requested,
    found.availability,
    settings.maxQuantityPerLine,
  )

  if (clamped.quantity <= 0) {
    return { clamped, ok: false, reason: 'unavailable' }
  }

  if (existing) {
    await payload.update({
      collection: 'cart-items',
      /* The price they are looking at as they add it — plan §31.1e, `priceSeenMinor`. */
      data: { priceSeenMinor: found.availability?.priceMinor ?? null, quantity: clamped.quantity },
      id: existing.id,
      overrideAccess: true,
    })
  } else {
    await payload.create({
      collection: 'cart-items',
      data: {
        cart: cart.id,
        priceSeenMinor: found.availability?.priceMinor ?? null,
        product: found.product.id,
        quantity: clamped.quantity,
        variant: variantId,
      },
      overrideAccess: true,
    })
  }

  return { clamped, ok: true }
}

export async function setCartLineQuantity(
  customerId: null | number,
  lineId: number,
  requested: number,
): Promise<CartMutationResult> {
  if (!Number.isSafeInteger(lineId) || !Number.isSafeInteger(requested) || requested < 0) {
    return { ok: false, reason: 'invalid' }
  }

  const payload = await getPayloadClient()
  const line = await ownedLine(payload, customerId, lineId)

  if (!line) {
    return { ok: false, reason: 'notFound' }
  }

  if (requested === 0) {
    await payload.delete({ collection: 'cart-items', id: lineId, overrideAccess: true })

    return { ok: true }
  }

  const settings = await getCatalogSettings()
  const variantId = relatedId(line.variant)
  const found = variantId === null ? null : await readVariantForWrite(payload, variantId)
  const clamped = clampQuantity(requested, found?.availability ?? null, settings.maxQuantityPerLine)

  if (clamped.quantity <= 0) {
    /* A quantity that cannot be met at all removes the line: a bag may not hold zero of something. */
    await payload.delete({ collection: 'cart-items', id: lineId, overrideAccess: true })

    return { clamped, ok: true }
  }

  await payload.update({
    collection: 'cart-items',
    /* Changing the quantity in the bag is looking at today's price — so it becomes the seen one. */
    data: { priceSeenMinor: found?.availability?.priceMinor ?? null, quantity: clamped.quantity },
    id: lineId,
    overrideAccess: true,
  })

  return { clamped, ok: true }
}

export async function removeCartLine(
  customerId: null | number,
  lineId: number,
): Promise<CartMutationResult> {
  if (!Number.isSafeInteger(lineId)) {
    return { ok: false, reason: 'invalid' }
  }

  const payload = await getPayloadClient()
  const line = await ownedLine(payload, customerId, lineId)

  if (!line) {
    return { ok: false, reason: 'notFound' }
  }

  await payload.delete({ collection: 'cart-items', id: lineId, overrideAccess: true })

  return { ok: true }
}

/**
 * **A line belongs to the requester, or it does not exist.**
 *
 * The one authorisation check in this file, and it is the whole of it: a line id is a small integer
 * that anyone can guess, so every mutation that takes one resolves the line's cart and compares it
 * with the cart this request owns. Returning `null` rather than a distinct "forbidden" is deliberate
 * — a probe that can tell "not yours" from "not there" can enumerate other people's bags.
 */
async function ownedLine(
  payload: Payload,
  customerId: null | number,
  lineId: number,
): Promise<CartItem | null> {
  const cart = await resolveCart(payload, customerId)

  if (!cart) {
    return null
  }

  const line = await payload
    .findByID({ collection: 'cart-items', depth: 0, id: lineId, overrideAccess: true })
    .catch(() => null)

  return line && relatedId(line.cart) === cart.id ? line : null
}

/* -------------------------------------------------------------------------------------------------
 * Merge on sign-in — plan §14.1b
 * ---------------------------------------------------------------------------------------------- */

/**
 * **Reconcile the guest bag with the customer's bag, once, at sign-in.**
 *
 * Called from `login` and `register` after the session exists. This reads the cookie and writes it
 * back; every database decision is {@link mergeGuestBag}'s, and every line decision is
 * `mergeCartLines`'.
 *
 * ### It never throws into the sign-in
 *
 * A failed merge must not fail a login. The worst outcome of the `catch` is a shopper who signs in
 * and finds their guest additions missing from the bag — recoverable, visible, and enormously better
 * than being told their password is wrong because a cart row would not write. Since sweep 1 (S03) the
 * merge is one transaction, so a failure part-way leaves both bags exactly as they were. The cookie is
 * left as it was too, so a later sign-in on this device tries again from the same state — but only
 * while the cookie still names the guest bag: signing out clears it (`forgetCartCookie`), and after
 * that nothing can reach the guest lines again.
 */
export async function mergeGuestCart(customerId: number): Promise<void> {
  const payload = await getPayloadClient()

  try {
    const jar = await cookies()
    const token = jar.get(CART_COOKIE)?.value ?? null

    if (!token) {
      return
    }

    const { cookie, outcome } = await mergeGuestBag(payload, customerId, token)

    if (outcome === 'deferred') {
      payload.logger.info({
        customerId,
        msg: 'Cart merge deferred at sign-in: the guest bag has a checkout in flight, so it was left as it is.',
      })
    }

    if (cookie === 'clear') {
      await clearCookie()
    } else if (cookie !== 'keep') {
      await issueCookie(cookie.issue)
    }
  } catch (error) {
    payload.logger.error({
      err: error,
      msg:
        'Cart merge failed at sign-in. Nothing was merged: the customer keeps their own bag, and the ' +
        'guest lines stay in the guest bag, which a later sign-in merges only if the bag cookie still ' +
        'names it.',
    })
  }
}

/**
 * What a merge did, and what the sign-in must do with the bag cookie because of it.
 *
 * - `none` — no guest bag the token can reach, or one that already belongs to somebody.
 * - `claimed` — the customer had no bag, so the guest bag became theirs.
 * - `merged` — the guest's lines are in the customer's bag and the guest bag is gone.
 * - `deferred` — the guest bag has a checkout in flight and was left untouched (see below).
 * - `gone` — the guest bag stopped being an active bag between the read and the lock: paid for in
 *   another tab, or merged by a sign-in racing this one. Nothing was written.
 */
export type GuestBagMerge = {
  cookie: 'clear' | 'keep' | { issue: string }
  outcome: 'claimed' | 'deferred' | 'gone' | 'merged' | 'none'
}

/**
 * **A `checkout_started` order counts as in flight for this long after it was last written.**
 *
 * Preflight writes the order at `checkout_started`, and the Stripe session made from it is recorded
 * (`pending_payment`) seconds later. The session lives 31 minutes (`lib/checkout/session.ts`), so an
 * order still at `checkout_started` an hour after its last write is an attempt that never reached
 * Stripe — its session creation failed or its process died — and it can never take a payment: the
 * payment claim in `fulfil.ts` requires the order's recorded session. Twice the lifetime, so a slow
 * session creation is never mistaken for an abandoned one; bounded, so an abandoned one cannot hold a
 * guest bag out of every merge until the retention sweep removes the order thirty days later.
 */
export const PREPARED_CHECKOUT_WINDOW_MS = 60 * 60 * 1000

/**
 * **Whether a guest bag has a checkout in flight** — sweep 1, S03. Pure, and exported so
 * `verify:cart` can hold the rule to its boundaries as well as run it against the database.
 *
 * In flight means an order on the bag that may still take money:
 *
 * - **`pending_payment`**, at any age — a Checkout Session is open, or a delayed bank payment is
 *   clearing (days, for some methods). Its end is always a webhook, and the order leaves this status.
 * - **`checkout_started`, written within {@link PREPARED_CHECKOUT_WINDOW_MS}** — preflight has just
 *   prepared it, and the session made from it is about to be recorded.
 *
 * `draft`, `payment_failed`, `cancelled` and an old `checkout_started` cannot be paid, and `paid` /
 * `refunded` mean the bag is already `converted` — which the merge never reads as a guest bag anyway.
 */
export function guestBagHasLiveCheckout(
  orders: readonly { paymentStatus: string; updatedAt: Date | string }[],
  now: Date,
): boolean {
  return orders.some(
    (order) =>
      order.paymentStatus === 'pending_payment' ||
      (order.paymentStatus === 'checkout_started' &&
        now.getTime() - new Date(order.updatedAt).getTime() < PREPARED_CHECKOUT_WINDOW_MS),
  )
}

type TxHandle = { execute: (query: unknown) => Promise<{ rows?: unknown[] }> }

/**
 * **The merge itself, against the database** — everything `mergeGuestCart` does except touch the
 * cookie, so `verify:cart` can run it. Takes the token the cookie held, and says what the cookie
 * should become.
 *
 * ### Four shapes, and only one of them is a merge
 *
 * - **No guest bag** — nothing to do. (§14.1b's *"guest cart empty"*.)
 * - **No customer bag** — the guest cart is *claimed*: one `customer` write, no line copying, no ids
 *   changing. (*"Customer has no cart"*.) Copying would be the same rows with new ids and one more
 *   chance to lose one. Any order on the bag keeps pointing at it, so a checkout in flight is safe.
 * - **A guest bag with a checkout in flight** — left exactly as it is. See below.
 * - **Both** — the real merge, then the guest cart is deleted so it cannot be presented again.
 *
 * ### A checkout in flight keeps its bag — sweep 1, S03
 *
 * An order reaches its bag only through `orders.cart`, and three things depend on that link:
 * preflight finds the order to reuse — and the previous Stripe session to expire — by the bag it is
 * checking out (`checkout/pending-order.ts`); `fulfil.ts` converts the order's bag when it is paid;
 * and a guest's confirmation page matches the order to the bag's token (`checkout/confirmation.ts`).
 *
 * The merge used to delete the guest bag unconditionally, which cleared that link
 * (`ON DELETE SET NULL`) on an order whose customer was on Stripe's payment page in another tab. They
 * could then pay it and be told *"We could not find that order"*, with the lines they had just bought
 * still in their bag; or check out the account bag, whose preflight never found the orphaned order,
 * never expired its session, and left **two payable sessions for the same goods** — exactly what
 * R1-01's retire-the-previous-session step exists to prevent.
 *
 * So when {@link guestBagHasLiveCheckout} holds, nothing is merged, nothing is deleted, and the
 * cookie keeps naming the guest bag: the confirmation page still opens and the checkout still resolves
 * against its own bag. The shopper sees their account bag meanwhile, without the lines they are in the
 * middle of paying for — which is the honest picture, and far better than showing goods a delayed
 * payment may already be buying.
 *
 * **Nothing retries a deferred merge.** While the shopper stays signed in, `resolveCart` finds their
 * own bag by customer id and never looks at the cookie — and the first add to the bag while signed in
 * (`addToCart` re-issues it with `issueCookie`) replaces the cookie with the account bag's
 * token. From then on the guest bag is forgotten exactly as if they had signed out, and a guest order
 * still paying in another tab cannot show its confirmation page on this device (the payment itself,
 * its confirmation email and the order are unaffected). A later sign-in merges the guest bag only if
 * the cookie still names it and its checkout has ended by then — the case after a session that simply
 * expired. Signing out clears the cookie (`logout` → `forgetCartCookie`), and after that no sign-in
 * can find the guest bag: if its checkout was paid, the bag was converted and nothing is lost; if not,
 * its lines stay in an ownerless bag until the retention sweep deletes it at expiry. (One path does
 * pick it up: if the account bag is itself converted by a checkout while the cookie still names the
 * guest bag, the next bag write finds no account bag, falls back to the cookie and claims the guest
 * bag.)
 *
 * (Moving the order to the customer's bag instead was considered and refused: a bag can hold only
 * one reusable order before preflight's newest-first pick stops finding the others, and a delayed
 * payment still clearing would make preflight refuse the whole account bag, for days, as already
 * paid.)
 *
 * ### One transaction, locked the way a checkout and a payment lock
 *
 * The decision and every write are made in one transaction that takes three locks, in this order:
 *
 * 1. **The bag's checkout lock** (`cartCheckoutLock`, the advisory lock `upsertPendingOrder` holds
 *    from its order lookup to its commit). An order being prepared on the guest bag is therefore
 *    either committed before the merge looks, or not started until the merge has committed — and a
 *    preparation that starts after a merge deleted the bag fails on the missing bag, before any
 *    session exists.
 * 2. **The orders on the guest bag**, then 3. **the guest bag** (`FOR UPDATE`) — the order a payment
 *    takes them in (`fulfil.ts` claims the order, then converts the bag), so the two queue instead of
 *    deadlocking. Nothing that holds an order or a bag lock waits for the checkout lock afterwards
 *    (preflight takes it first, the payment and the sweep never), so taking it first cannot deadlock.
 *
 * Copying the guest's code takes a fourth lock, on **the customer's bag**: every Payload update of a
 * bag locks it before reading it (`Carts.hooks.beforeOperation`, the concurrency review of
 * 2026-09-15), so a payment converting that bag cannot be undone by the copy. A payment holds nothing
 * this transaction holds while it waits for that bag, so the fourth lock closes no cycle.
 *
 * **The orders are read again once the bag's lock is granted, and the decision is made on that read**
 * (sweep 1's recheck of S03). Step 2 locks only the orders that existed when it ran: an order inserted
 * by a writer that does not take the checkout lock, and committed while the merge waited for the bag,
 * was invisible to it. An insert referencing the bag waits for the bag's lock (its foreign-key check
 * takes a key-share lock on the bag row), so once that lock is held every order on the bag is
 * committed and in the second read. With all three held, no checkout can start on the bag, no order on
 * it can be paid or have its session recorded, and nothing can convert it; so the bag that is deleted
 * is the bag that was checked. A bag found paid for or merged by the time the lock is granted is left
 * alone (`gone`).
 *
 * ### The guest's discount code comes along when the customer's bag has none
 *
 * Phase 36 (R2-03). A code applied as a guest used to vanish with the deleted guest cart. It is now
 * copied to the customer's bag when that bag has no code of its own; if it has one, the customer's
 * code wins. Only the reference moves — `getCart` re-decides the promotion on the next read, so a
 * code this customer may not use (a first-order code on an account with orders, say) shows its
 * reason beside it like any other failing code. In the claim path the code is already on the row.
 *
 * ### The cookie
 *
 * **It names the customer's bag after a merge, instead of being cleared** — plan §31.1f's "session
 * expired", Phase 31. It was cleared at every sign-in, so when a session later ran out the device had
 * nothing left to recognise the bag by, and checkout and the bag both said *"Your bag is empty"* to
 * someone whose bag was intact. Keeping it lets `hasSignedOutBag` answer *sign in*.
 *
 * It exposes nothing: `resolveCart` refuses an owned bag to an anonymous request whatever the cookie
 * says (Phase 14's second sweep), so the cookie can only ever lead to a sign-in prompt. An explicit
 * sign-out still forgets it (`logout` → `forgetCartCookie`) — leaving a shared computer is a decision,
 * and an expired session is not. After a claim, a deferral or `gone` it is left as it is; with no
 * reachable guest bag it is cleared, unless the bag it names is already this customer's.
 */
export async function mergeGuestBag(
  payload: Payload,
  customerId: number,
  token: string,
): Promise<GuestBagMerge> {
  const now = new Date()

  const { docs: guestCarts } = await payload.find({
    collection: 'carts',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      and: [
        { token: { equals: token } },
        { status: { equals: 'active' } },
        { expiresAt: { greater_than: now.toISOString() } },
      ],
    },
  })

  const guestCart = guestCarts[0]

  if (!guestCart || relatedId(guestCart.customer) !== null) {
    /* A bag this customer already owns stays pointed at; anyone else's bag, or none, is forgotten. */
    return {
      cookie: guestCart && relatedId(guestCart.customer) === customerId ? 'keep' : 'clear',
      outcome: 'none',
    }
  }

  const { docs: customerCarts } = await payload.find({
    collection: 'carts',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    sort: '-updatedAt',
    where: {
      and: [
        { customer: { equals: customerId } },
        { status: { equals: 'active' } },
        { expiresAt: { greater_than: now.toISOString() } },
      ],
    },
  })

  const customerCart = customerCarts[0]

  if (!customerCart) {
    await payload.update({
      collection: 'carts',
      data: { customer: customerId },
      id: guestCart.id,
      overrideAccess: true,
    })

    /* The cookie already names this bag, which is now theirs. */
    return { cookie: 'keep', outcome: 'claimed' }
  }

  const transactionID = await payload.db.beginTransaction()

  if (transactionID === null) {
    throw new Error('Could not begin a transaction to merge the guest bag.')
  }

  const req = { transactionID } as Parameters<typeof payload.find>[0]['req']

  try {
    const tx = (payload.db as unknown as { sessions?: Record<string, { db: TxHandle }> })
      .sessions?.[String(transactionID)]?.db

    if (!tx) {
      throw new Error('The cart merge’s transaction session was not available.')
    }

    /* 1. No order is being prepared on the guest bag while this transaction decides. */
    await tx.execute(cartCheckoutLock(guestCart.id))

    /* 2. The orders that exist, so none of them can be paid or re-prepared while this decides. */
    await tx.execute(
      sql`SELECT "id" FROM "orders"
          WHERE "cart_id" = ${guestCart.id}
          ORDER BY "id"
          FOR UPDATE`,
    )

    /* 3. The bag. */
    const lockedBag = await tx.execute(
      sql`SELECT "status" FROM "carts" WHERE "id" = ${guestCart.id} FOR UPDATE`,
    )

    const bagStatus = (lockedBag.rows?.[0] as { status?: unknown } | undefined)?.status

    if (bagStatus !== 'active') {
      await payload.db.commitTransaction(transactionID)

      return { cookie: 'keep', outcome: 'gone' }
    }

    /*
     * The decision's read, taken with every lock held — see "locked the way a checkout and a payment
     * lock" above. Not step 2's rows: an order committed while this waited for the bag is only here.
     */
    const current = await tx.execute(
      sql`SELECT "payment_status", "updated_at" FROM "orders" WHERE "cart_id" = ${guestCart.id}`,
    )

    const orders = (
      (current.rows ?? []) as { payment_status: string; updated_at: Date | string }[]
    ).map((row) => ({ paymentStatus: String(row.payment_status), updatedAt: row.updated_at }))

    /* The clock is read now too: the locks may have been waited for. */
    if (guestBagHasLiveCheckout(orders, new Date())) {
      await payload.db.commitTransaction(transactionID)

      return { cookie: 'keep', outcome: 'deferred' }
    }

    /* One after the other: both run on the transaction's single connection. */
    const guestLines = await readLines(payload, guestCart.id, req)
    const customerLines = await readLines(payload, customerCart.id, req)

    const availability = await readAvailability(payload, [
      ...guestLines.map((line) => line.variantId),
      ...customerLines.map((line) => line.variantId),
    ])

    const settings = await getCatalogSettings()
    const merged = mergeCartLines(
      customerLines,
      guestLines,
      availability,
      settings.maxQuantityPerLine,
    )

    const existing = new Map(customerLines.map((line) => [line.variantId, line]))

    for (const line of merged.lines) {
      const current = existing.get(line.variantId)

      if (current) {
        if (current.quantity !== line.quantity) {
          await payload.update({
            collection: 'cart-items',
            data: { quantity: line.quantity },
            id: current.id,
            overrideAccess: true,
            req,
          })
        }
      } else {
        await payload.create({
          collection: 'cart-items',
          data: {
            cart: customerCart.id,
            product: line.productId,
            quantity: line.quantity,
            variant: line.variantId,
          },
          overrideAccess: true,
          req,
        })
      }
    }

    /* §14.1b step 6, on the customer's own bag as well as the guest's. */
    for (const gone of merged.dropped) {
      const current = existing.get(gone.variantId)

      if (current) {
        await payload.delete({
          collection: 'cart-items',
          id: current.id,
          overrideAccess: true,
          req,
        })
      }
    }

    /* The guest's code, when the customer's bag has none — see "discount code" above. */
    const guestPromotion = relatedId(guestCart.promotion)

    if (guestPromotion !== null && relatedId(customerCart.promotion) === null) {
      await payload.update({
        collection: 'carts',
        data: { promotion: guestPromotion },
        id: customerCart.id,
        overrideAccess: true,
        req,
      })
    }

    await payload.delete({ collection: 'carts', id: guestCart.id, overrideAccess: true, req })

    await payload.db.commitTransaction(transactionID)
  } catch (error) {
    /* Payload may already have ended the transaction on a failed Local API call. */
    await payload.db.rollbackTransaction(transactionID).catch(() => undefined)

    throw error
  }

  return {
    cookie: customerCart.token ? { issue: customerCart.token } : 'clear',
    outcome: 'merged',
  }
}

type StoredLine = CartLineInput & { id: number }

async function readLines(
  payload: Payload,
  cartId: number,
  req?: Parameters<typeof payload.find>[0]['req'],
): Promise<StoredLine[]> {
  const { docs } = await payload.find({
    collection: 'cart-items',
    depth: 0,
    limit: LINE_LIMIT,
    overrideAccess: true,
    pagination: false,
    req,
    sort: 'createdAt',
    where: { cart: { equals: cartId } },
  })

  return docs.flatMap((item) => {
    const productId = relatedId(item.product)
    const variantId = relatedId(item.variant)

    return productId === null || variantId === null
      ? []
      : [{ id: item.id, productId, quantity: item.quantity, variantId }]
  })
}

/**
 * One read for every variant the merge touches.
 *
 * A variant that no longer exists is `null` in the map rather than absent, so the merge can tell
 * *"deleted"* from *"never asked about"* — §14.1b's *"product deleted while guest was browsing"*.
 */
async function readAvailability(
  payload: Payload,
  variantIds: number[],
): Promise<Map<number, LineAvailability | null>> {
  const unique = [...new Set(variantIds)]
  const map = new Map<number, LineAvailability | null>(unique.map((id) => [id, null]))

  if (unique.length === 0) {
    return map
  }

  const { docs } = await payload.find({
    collection: 'product-variants',
    depth: 1,
    limit: unique.length,
    overrideAccess: true,
    pagination: false,
    where: { id: { in: unique } },
  })

  for (const variant of docs) {
    map.set(variant.id, availabilityOf(variant, asDoc<Product>(variant.product)))
  }

  return map
}
