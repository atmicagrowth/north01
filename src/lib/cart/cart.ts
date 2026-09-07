import 'server-only'

import { randomBytes } from 'node:crypto'

import { cookies } from 'next/headers'
import { cache } from 'react'
import type { Payload } from 'payload'

import { getCatalogSettings, type CatalogSettings } from '@/lib/catalog/catalog'
import { publishedProductWhere } from '@/lib/catalog/query'
import { resolveProductCards, type ProductCard } from '@/lib/catalog/resolve'
import { formatMinorUnits } from '@/lib/money'
import { getPayloadClient } from '@/lib/payload'
import type { Cart, CartItem, Media, Product, ProductVariant } from '@/payload-types'

import {
  cartTotals,
  clampQuantity,
  mergeCartLines,
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

/** The cookie holding the guest bag's token. Prefixed like every other cookie this project sets. */
const CART_COOKIE = 'north01_cart'

/** Thirty days, matching `Carts.expiresAt`'s default. A bag and its cookie should expire together. */
const CART_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

/** Two hops: `variant.image` and `product.gallery[].image`. */
const CART_DEPTH = 2

/** No real bag is near this. It exists so a corrupt row cannot make the drawer unbounded. */
const LINE_LIMIT = 200

export type CartLineView = {
  /** `null` when the variant cannot currently be bought — §14.1e's "product becomes unavailable". */
  availability: LineAvailability | null
  color: null | string
  id: number
  image: Media | null
  /** The most this line may hold right now, for the stepper's bound. */
  maxQuantity: number
  productId: number
  productName: string
  productSlug: string
  quantity: number
  size: null | string
  /** `null` when the variant has no usable price. */
  unitPriceLabel: null | string
  unitPriceMinor: null | number
  variantId: number
}

export type CartView = {
  currency: CatalogSettings['currency']
  /** True when the live read disagreed with the stored rows — §14.1e's stale-state banner. */
  drifted: boolean
  id: number
  lines: CartLineView[]
  locale: string
  /** Feature matrix §10 again: products related to what is in the bag. */
  recommendations: ProductCard[]
  shipping: null | ShippingProgress
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
     * A guest bag whose token is presented by a signed-in shopper is claimed rather than ignored:
     * this is the ordinary "added things, then signed in" path, and `mergeGuestCart` has already run
     * by the time a page renders. Refusing it here would strand the lines.
     */
    if (found && (customerId === null || !found.customer)) {
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
    secure: process.env.NODE_ENV === 'production',
  })
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

    return {
      availability,
      color: variant?.color?.trim() || null,
      id: item.id,
      image,
      maxQuantity: ceiling.quantity,
      productId: product?.id ?? (relatedId(item.product) as number),
      productName: product?.name ?? 'This item',
      productSlug: product?.slug ?? '',
      quantity: item.quantity,
      size: variant?.size?.trim() || null,
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
  const totals = cartTotals(
    lines
      .filter((line) => line.unitPriceMinor !== null && line.maxQuantity > 0)
      .map((line) => ({
        quantity: Math.min(line.quantity, line.maxQuantity),
        unitPriceMinor: line.unitPriceMinor as number,
      })),
  )

  return {
    currency: settings.currency,
    drifted,
    id: cart.id,
    lines,
    locale: settings.locale,
    recommendations: await readCartRecommendations(payload, lines, settings),
    shipping: shippingProgress(totals.subtotalMinor, settings.freeShippingThresholdMinor),
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
      data: { quantity: clamped.quantity },
      id: existing.id,
      overrideAccess: true,
    })
  } else {
    await payload.create({
      collection: 'cart-items',
      data: {
        cart: cart.id,
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
    data: { quantity: clamped.quantity },
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
 * Called from `login` and `register` after the session exists. Every decision is `mergeCartLines`';
 * this walks the result and writes it.
 *
 * ### Three shapes, and only one of them is a merge
 *
 * - **No guest bag** — nothing to do. (§14.1b's *"guest cart empty"*.)
 * - **No customer bag** — the guest cart is *claimed*: one `customer` write, no line copying, no ids
 *   changing. (*"Customer has no cart"*.) Copying would be the same rows with new ids and one more
 *   chance to lose one.
 * - **Both** — the real merge, then the guest cart is deleted so it cannot be presented again.
 *
 * The cookie is cleared either way at the end, because after this the bag is found by customer id
 * and a stale guest token in the jar is a second identity for the same shopper.
 *
 * ### It never throws into the sign-in
 *
 * A failed merge must not fail a login. The worst outcome of the `catch` is a shopper who signs in
 * and finds their guest additions missing from the bag — recoverable, visible, and enormously better
 * than being told their password is wrong because a cart row would not write.
 */
export async function mergeGuestCart(customerId: number): Promise<void> {
  const payload = await getPayloadClient()

  try {
    const jar = await cookies()
    const token = jar.get(CART_COOKIE)?.value ?? null

    if (!token) {
      return
    }

    const now = new Date().toISOString()

    const { docs: guestCarts } = await payload.find({
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

    const guestCart = guestCarts[0]

    if (!guestCart || relatedId(guestCart.customer) !== null) {
      await clearCookie()

      return
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
          { expiresAt: { greater_than: now } },
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

      await clearCookie()

      return
    }

    const [guestLines, customerLines] = await Promise.all([
      readLines(payload, guestCart.id),
      readLines(payload, customerCart.id),
    ])

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
        })
      }
    }

    /* §14.1b step 6, on the customer's own bag as well as the guest's. */
    for (const gone of merged.dropped) {
      const current = existing.get(gone.variantId)

      if (current) {
        await payload.delete({ collection: 'cart-items', id: current.id, overrideAccess: true })
      }
    }

    await payload.delete({ collection: 'carts', id: guestCart.id, overrideAccess: true })
    await clearCookie()
  } catch (error) {
    payload.logger.error({
      err: error,
      msg: 'Cart merge failed at sign-in. The customer keeps their own bag; guest lines may be lost.',
    })
  }
}

type StoredLine = CartLineInput & { id: number }

async function readLines(payload: Payload, cartId: number): Promise<StoredLine[]> {
  const { docs } = await payload.find({
    collection: 'cart-items',
    depth: 0,
    limit: LINE_LIMIT,
    overrideAccess: true,
    pagination: false,
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
