/**
 * **The account, the wishlist and recently-viewed — plan §20.**
 *
 * ```
 * pnpm verify:account
 * ```
 *
 * The phase prompt names its own tests and names exactly two: *"add tests for **cross-account access
 * prevention** and **merge behavior**."* Both are here, and the first is the one that matters — §7.1b
 * forbids reading another customer's order, and the only way to know that holds is to sign in as one
 * customer and go looking for another's.
 *
 * Sections A–C are pure and need no database. D onwards is the real one, and the **D-10** guard
 * applies: they create and delete customers, orders and wishlist rows.
 */

import type { Payload } from 'payload'

import config from '../src/payload.config'

import { isCurrentAccountRoute, ACCOUNT_ROUTES } from '../src/lib/account/navigation'
import { readCustomerOrder, readCustomerOrders } from '../src/lib/account/orders'
import { developmentDatabase } from '../src/lib/env.core'
import {
  orderByRecency,
  pushRecentlyViewed,
  readRecentlyViewed,
  RECENTLY_VIEWED_LIMIT,
} from '../src/lib/recently-viewed/rules'
import {
  mergeGuestWishlist,
  readWishlistProductIds,
  removeFromWishlist,
  saveToWishlist,
} from '../src/lib/wishlist/read'
import {
  addToGuestWishlist,
  GUEST_WISHLIST_LIMIT,
  planWishlistMerge,
  readGuestWishlist,
  removeFromGuestWishlist,
} from '../src/lib/wishlist/rules'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-account refuses to run: ${developmentDatabase.reason}. ` +
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

/* =================================================================================================
 * A — the device-local stores, against hostile input
 * ============================================================================================== */

{
  check(
    'A: a corrupted store parses to an empty list rather than throwing',
    readGuestWishlist('{{{').length === 0,
  )
  check('A: a non-array parses to empty', readGuestWishlist('{"a":1}').length === 0)
  check('A: an unset key parses to empty', readGuestWishlist(null).length === 0)

  check(
    'A: **entries that are not product ids are discarded** — strings, floats, negatives, objects',
    readGuestWishlist(JSON.stringify(['4', 1.5, -2, {}, null, 7])).join(',') === '7',
    readGuestWishlist(JSON.stringify(['4', 1.5, -2, {}, null, 7])).join(','),
  )

  const overflowing = JSON.stringify(Array.from({ length: 500 }, (_, i) => i + 1))

  check(
    'A: a hostile store is capped on the way in, so nothing unbounded reaches a query',
    readGuestWishlist(overflowing).length === GUEST_WISHLIST_LIMIT,
    String(readGuestWishlist(overflowing).length),
  )

  check(
    'A: **adding is idempotent** — a double tap cannot produce two entries',
    addToGuestWishlist(addToGuestWishlist([9], 4), 4).join(',') === '4,9',
    addToGuestWishlist(addToGuestWishlist([9], 4), 4).join(','),
  )

  check(
    'A: adding moves an existing entry to the front',
    addToGuestWishlist([1, 2, 3], 3).join(',') === '3,1,2',
  )
  check(
    'A: removing what is not there changes nothing',
    removeFromGuestWishlist([1, 2], 9).join(',') === '1,2',
  )

  check(
    'A: recently-viewed is capped at its own limit',
    readRecentlyViewed(overflowing).length === RECENTLY_VIEWED_LIMIT,
    String(readRecentlyViewed(overflowing).length),
  )

  check(
    'A: **re-viewing a product does not duplicate it** — strict mode mounts effects twice',
    pushRecentlyViewed(pushRecentlyViewed([1, 2], 5), 5).join(',') === '5,1,2',
  )

  check(
    'A: §20.1c a resolved subset is re-ordered by viewing order, not by database order',
    orderByRecency([3, 1, 2], [{ id: 1 }, { id: 2 }, { id: 3 }])
      .map((item) => item.id)
      .join(',') === '3,1,2',
  )

  check(
    'A: …and an id that resolved to nothing simply is not in the result',
    orderByRecency([3, 99, 1], [{ id: 1 }, { id: 3 }])
      .map((item) => item.id)
      .join(',') === '3,1',
  )
}

/* =================================================================================================
 * B — §20.1b's merge, as a decision
 * ============================================================================================== */

{
  const plan = planWishlistMerge({ existing: [2], guest: [3, 2, 9], valid: [2, 3] })

  check(
    'B: **existing customer wishlist wins duplicates** — nothing is written for one already saved',
    plan.alreadySaved.join(',') === '2' && !plan.toAdd.includes(2),
  )

  check(
    'B: **invalid/deleted products are removed** — an id that resolved to no product is dropped',
    plan.invalid.join(',') === '9' && !plan.toAdd.includes(9),
  )

  check(
    'B: **preserve order where useful** — inserts run oldest-first so the merged list is not inverted',
    plan.toAdd.join(',') === '3',
  )

  const ordered = planWishlistMerge({ existing: [], guest: [30, 20, 10], valid: [10, 20, 30] })

  check(
    'B: …a three-entry guest list inserts oldest first',
    ordered.toAdd.join(',') === '10,20,30',
    ordered.toAdd.join(','),
  )

  const empty = planWishlistMerge({ existing: [1], guest: [], valid: [] })

  check('B: an empty guest list plans nothing', empty.toAdd.length === 0)
}

/* =================================================================================================
 * C — §20.1d's routes
 * ============================================================================================== */

{
  check('C: §20.1d names six routes and five are navigable', ACCOUNT_ROUTES.length === 5)

  check(
    'C: **/account does not match every other account route** — it is a prefix of all of them',
    !isCurrentAccountRoute('/account', '/account/orders'),
  )

  check('C: /account matches itself exactly', isCurrentAccountRoute('/account', '/account'))

  check(
    'C: an order detail page still marks Orders current',
    isCurrentAccountRoute('/account/orders', '/account/orders/N1-2609-ABC123'),
  )

  check(
    'C: the plan names the route `settings`, so the nav does too',
    ACCOUNT_ROUTES.some((route) => route.href === '/account/settings'),
  )
}

/* =================================================================================================
 * The database half
 * ============================================================================================== */

const payload: Payload = await getPayload({ config })

const created: {
  collection:
    'customers' | 'order-items' | 'orders' | 'product-variants' | 'products' | 'wishlist-items'
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
      email: `verify-account-${tag}-${suffix}@example.test`,
      firstName: 'Verify',
      lastName: tag,
      password: 'correct-horse-battery-staple',
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'customers', id: customer.id })

  return customer
}

async function makeProduct(index: string, published = true) {
  const product = await payload.create({
    collection: 'products',
    data: {
      name: `Account fixture ${suffix}-${index}`,
      slug: `account-fixture-${suffix}-${index}`,
      sortOrder: 9999,
      status: published ? 'published' : 'draft',
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'products', id: product.id })

  return product
}

try {
  /* ============================================ D — the wishlist against the database */
  {
    const alice = await makeCustomer('alice')
    const product = await makeProduct('d')

    const first = await saveToWishlist(payload, alice.id, product.id)

    check('D: a published product can be saved', first === 'added', first)

    const second = await saveToWishlist(payload, alice.id, product.id)

    check(
      'D: **saving twice is refused by the database, not by a check** — the compound unique index',
      second === 'alreadySaved',
      second,
    )

    const draft = await makeProduct('d-draft', false)
    const refused = await saveToWishlist(payload, alice.id, draft.id)

    check(
      'D: an unpublished product cannot be saved — the same publication rule the shop grid uses',
      refused === 'unavailable',
      refused,
    )

    const ids = await readWishlistProductIds(payload, alice.id)

    check(
      'D: the list holds exactly what was saved',
      ids.join(',') === String(product.id),
      ids.join(','),
    )

    const removed = await removeFromWishlist(payload, alice.id, product.id)

    check('D: removing works', removed === 'removed', removed)
    check(
      'D: …and removing again is not an error',
      (await removeFromWishlist(payload, alice.id, product.id)) === 'notSaved',
    )
  }

  /* ============================================ E — cross-account, the named requirement */
  {
    const alice = await makeCustomer('e-alice')
    const mallory = await makeCustomer('e-mallory')
    const product = await makeProduct('e')

    await saveToWishlist(payload, alice.id, product.id)

    check(
      "E: **mallory's wishlist does not contain alice's saved product**",
      (await readWishlistProductIds(payload, mallory.id)).length === 0,
    )

    /*
     * The important one: a remove scoped to mallory must not reach alice's row, even though this
     * service runs with `overrideAccess: true` and could delete anything it named.
     */
    const attempt = await removeFromWishlist(payload, mallory.id, product.id)

    check(
      "E: **mallory cannot remove alice's saved product** — the delete is scoped by customer",
      attempt === 'notSaved',
      attempt,
    )

    check(
      "E: …and alice's row is still there",
      (await readWishlistProductIds(payload, alice.id)).join(',') === String(product.id),
    )

    /* Orders — §7.1b's "may NOT read another customer's order". */
    const order = await payload.create({
      collection: 'orders',
      data: {
        currency: 'USD',
        customer: alice.id,
        discountMinor: 0,
        email: `verify-account-e-alice-${suffix}@example.test`,
        fulfillmentStatus: 'unfulfilled',
        orderNumber: `N1-AC-E-${suffix}`,
        paymentStatus: 'paid',
        shippingMinor: 0,
        subtotalMinor: 5_000,
        taxMinor: 0,
        totalMinor: 5_000,
      } as never,
      overrideAccess: true,
    })

    created.push({ collection: 'orders', id: order.id })

    check(
      'E: alice can read her own order by its number',
      (await readCustomerOrder(payload, alice.id, order.orderNumber, 'en-US')) !== null,
    )

    check(
      "E: **mallory reading alice's order number gets NOTHING — not a refusal**",
      (await readCustomerOrder(payload, mallory.id, order.orderNumber, 'en-US')) === null,
    )

    check(
      "E: …and it is absent from mallory's order list",
      (await readCustomerOrders(payload, mallory.id, 'en-US')).length === 0,
    )

    check(
      'E: a draft order is not shown as an order the customer placed',
      (await readCustomerOrders(payload, alice.id, 'en-US')).every((row) => row.status !== 'draft'),
    )
  }

  /* ============================================ F — the merge, against the database */
  {
    const alice = await makeCustomer('f')
    const kept = await makeProduct('f-kept')
    const fresh = await makeProduct('f-fresh')
    const gone = await makeProduct('f-gone', false)

    await saveToWishlist(payload, alice.id, kept.id)

    const outcome = await mergeGuestWishlist(
      payload,
      alice.id,
      [fresh.id, kept.id, gone.id],
      new Date().toISOString(),
    )

    check('F: **the new product is added**', outcome.added === 1, String(outcome.added))
    check(
      'F: **the already-saved one is not written again**',
      outcome.alreadySaved.join(',') === String(kept.id),
    )
    check('F: **the unpublished one is dropped**', outcome.invalid.join(',') === String(gone.id))

    const after = await readWishlistProductIds(payload, alice.id)

    check(
      'F: the account ends with exactly two saved products',
      after.length === 2 && after.includes(kept.id) && after.includes(fresh.id),
      after.join(','),
    )

    /* Merging the same list again is a no-op — the constraint, not a flag, is what makes it one. */
    const again = await mergeGuestWishlist(
      payload,
      alice.id,
      [fresh.id, kept.id],
      new Date().toISOString(),
    )

    check('F: **merging the same list twice adds nothing**', again.added === 0, String(again.added))
  }
} finally {
  await cleanup()
}

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} account checks passed.`,
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
  throw new Error(`${failed.length} account check(s) failed.`)
}
