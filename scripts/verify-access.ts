/**
 * The Phase 7 access-control matrix, checked against the running rules rather than against the
 * comments that describe them.
 *
 * ```
 * pnpm verify:access
 * ```
 *
 * **What this is, and what it is not.** Plan §7.1e asks for *"automated tests for cross-user access
 * attempts and role escalation attempts"*. The test *framework* is Phase 27 (§27.1a, Vitest), and
 * plan §2.1b forbids installing a later phase's dependencies early — Phase 3 hit the same wall and
 * settled it the same way, running Playwright and axe-core from outside the project rather than
 * adding them to `package.json` (notes §1.8.7). So the assertions live in a script that needs
 * nothing but what is already installed, and Phase 27 lifts them into a suite. They are the same
 * assertions either way.
 *
 * **It exercises the real gate.** Every check runs through the Local API with
 * `overrideAccess: false` and an explicit `user`, which is the same `executeAccess` path the REST
 * API and the admin panel take. Nothing here reimplements a rule in order to test it.
 *
 * **It writes to the database, and cleans up after itself.** Four accounts, an order, an address, a
 * wishlist row and a draft product, all prefixed `verify-access` and all removed in a `finally`. It
 * refuses to run against anything but the development database that `DATABASE_PUSH_TARGET` names —
 * the same **D-10** guard `seed.ts` uses, and for a stronger reason: this one creates and deletes
 * customer rows.
 */

import type { Payload, TypedUser } from 'payload'

import config from '../src/payload.config'

import { developmentDatabase } from '../src/lib/env.core'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-access refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes customer records, so it may only touch the development database that ' +
      'DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const { getPayload } = await import('payload')

const PREFIX = 'verify-access'
const PASSWORD = 'correct-horse-battery-staple'

/* -------------------------------------------------------------------------------------------------
 * A very small assertion harness
 * ---------------------------------------------------------------------------------------------- */

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

/**
 * Run an operation that **must** be refused, and insist on the *right kind* of refusal.
 *
 * Payload expresses "no" two ways and both count: a boolean `false` rule throws `Forbidden`, while a
 * `Where` rule that matches nothing produces a `NotFound` — which is the shape the ownership rules
 * take, and the interesting half of §7.1b.
 *
 * What must not count is any other throw. An earlier version of this file accepted every error, and
 * a fixture with one wrong field name in it would have reported a passing access check while proving
 * nothing at all. Naming the acceptable errors is what stops this file being able to lie.
 */
async function denied(
  name: string,
  operation: () => Promise<unknown>,
  expected: string[] = ['Forbidden', 'NotFound'],
) {
  try {
    await operation()
    check(name, false, 'the operation succeeded and should not have')
  } catch (error) {
    const kind = error instanceof Error ? error.constructor.name : String(error)

    check(
      name,
      expected.includes(kind),
      expected.includes(kind) ? kind : `threw ${kind}, expected one of ${expected.join('/')}`,
    )
  }
}

async function allowed(name: string, operation: () => Promise<unknown>) {
  try {
    await operation()
    check(name, true)
  } catch (error) {
    check(name, false, error instanceof Error ? `${error.constructor.name}: ${error.message}` : '?')
  }
}

/** `req.user` as Payload builds it: the document plus the collection it came from. */
function asUser(doc: unknown, collection: 'customers' | 'users'): TypedUser {
  return { ...(doc as object), collection } as TypedUser
}

/**
 * Create a fixture row, bypassing access control.
 *
 * The cast is the same trade `seed.ts` makes and for the same reason: Payload's per-collection data
 * types are a discriminated union keyed on `collection`, so a helper that takes the slug as a
 * parameter cannot narrow it. The alternative is fabricating values for every server-maintained
 * `required` field — `products.derived`, which a hook computes, or `product-variants.sizeSortOrder`,
 * which another one does — and a fixture that hand-writes a cache is a fixture that can disagree
 * with the code under test. Access control is what this file checks, and every one of these rows is
 * created with `overrideAccess: true` on purpose.
 */
async function fixture(
  collection: Parameters<Payload['create']>[0]['collection'],
  data: Record<string, unknown>,
): Promise<{ id: number }> {
  const created = await payload.create({ collection, data: data as never, overrideAccess: true })

  return created as { id: number }
}

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

const payload: Payload = await getPayload({ config })

async function makeCustomer(tag: string) {
  return payload.create({
    collection: 'customers',
    overrideAccess: true,
    data: {
      email: `${PREFIX}-${tag}@example.test`,
      password: PASSWORD,
      firstName: 'Verify',
      lastName: tag,
      accountStatus: 'active',
    },
  })
}

async function makeStaff(tag: string, role: 'admin' | 'editor') {
  return payload.create({
    collection: 'users',
    overrideAccess: true,
    data: { email: `${PREFIX}-${tag}@example.test`, password: PASSWORD, role },
  })
}

async function cleanup() {
  const where = { email: { like: PREFIX } }

  // Orders and their lines first: `customers` cascades addresses, wishlist rows and reviews, but an
  // order deliberately outlives its customer, so it has to go by hand.
  const orders = await payload.find({
    collection: 'orders',
    where: { email: { like: PREFIX } },
    limit: 100,
    overrideAccess: true,
    trash: true,
  })

  for (const order of orders.docs) {
    await payload.delete({ collection: 'orders', id: order.id, overrideAccess: true, trash: false })
  }

  await payload.delete({
    collection: 'carts',
    where: { 'customer.email': { like: PREFIX } },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'products',
    where: { slug: { like: PREFIX } },
    overrideAccess: true,
    trash: false,
  })
  await payload.delete({ collection: 'customers', where, overrideAccess: true, trash: false })
  await payload.delete({ collection: 'users', where, overrideAccess: true })
}

/* -------------------------------------------------------------------------------------------------
 * The matrix
 * ---------------------------------------------------------------------------------------------- */

try {
  await cleanup()

  const alice = await makeCustomer('alice')
  const mallory = await makeCustomer('mallory')

  /*
   * **The admin fixture is created first, and the order is load-bearing.**
   *
   * `Users.ts` has a `beforeValidate` hook that forces the **first** account on an empty database to
   * `admin`, so that `/admin/create-first-user` produces someone who can administer. It does not care
   * which role the caller asked for.
   *
   * With the editor created first, that hook silently promoted the *editor* fixture on any database
   * with no staff in it — a fresh clone, or one just rebuilt with `migrate:fresh`. Every
   * "an editor cannot …" assertion below then tested an admin, and one of them deletes a product, so
   * the run did not merely report wrong answers: it destroyed a fixture and crashed forty lines later
   * on a foreign key, with nothing in the output pointing at the cause.
   *
   * Creating the admin first means the hook promotes the account that was going to be an admin
   * anyway. The check underneath is what stops this being a silent ordering dependency again — it is
   * the same lesson as the harness defect Phase 7 recorded in §1.12.7: a fixture that is not what the
   * script thinks it is must fail loudly, not quietly pass.
   */
  const admin = await makeStaff('admin', 'admin')
  const editor = await makeStaff('editor', 'editor')

  const aliceUser = asUser(alice, 'customers')
  const malloryUser = asUser(mallory, 'customers')
  const editorUser = asUser(editor, 'users')
  const adminUser = asUser(admin, 'users')

  check(
    'the editor fixture is actually an editor — the first-account bootstrap did not promote it',
    editor.role === 'editor',
    `role is ${editor.role}`,
  )
  check('the admin fixture is an admin', admin.role === 'admin', `role is ${admin.role}`)

  const draft = await fixture('products', {
    name: `${PREFIX} draft product`,
    slug: `${PREFIX}-draft-product`,
    status: 'draft',
  })

  await fixture('product-variants', {
    product: draft.id,
    sku: `${PREFIX}-SKU-1`,
    color: 'Test Black',
    colorFamily: 'black',
    size: 'M',
    sizeSortOrder: 0,
    priceMinor: 1000,
    inventoryQuantity: 1,
    active: true,
  })

  /*
   * `token` and `expiresAt` have `defaultValue` generators on the collection, so a real cart never
   * needs them supplied. Naming them here is deliberate anyway: a deterministic token is what makes
   * the row findable and removable by the cleanup.
   */
  const aliceCart = await fixture('carts', {
    customer: alice.id,
    token: `${PREFIX}-cart-token`,
    currency: 'USD',
    status: 'active',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  })

  const aliceOrder = await fixture('orders', {
    customer: alice.id,
    email: `${PREFIX}-alice@example.test`,
    // Generated by a `beforeValidate` hook in real use; named here so cleanup can find the row.
    orderNumber: `${PREFIX}-order-1`,
    currency: 'USD',
    paymentStatus: 'draft',
    fulfillmentStatus: 'unfulfilled',
    subtotalMinor: 0,
    discountMinor: 0,
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: 0,
  })

  const aliceAddress = await fixture('addresses', {
    customer: alice.id,
    firstName: 'Verify',
    lastName: 'Alice',
    line1: '1 Test Street',
    city: 'Testville',
    postalCode: '00001',
    country: 'US',
  })

  /* ---- Public reads (§7.1b implies them; §11 and §13 depend on them) ---- */

  const publicProducts = await payload.find({
    collection: 'products',
    overrideAccess: false,
    limit: 200,
    where: { slug: { like: PREFIX } },
  })
  check(
    'anonymous cannot see a draft product',
    publicProducts.totalDocs === 0,
    `saw ${publicProducts.totalDocs}`,
  )

  const staffProducts = await payload.find({
    collection: 'products',
    overrideAccess: false,
    user: editorUser,
    where: { slug: { like: PREFIX } },
  })
  check('an editor can see a draft product', staffProducts.totalDocs === 1)

  await denied('anonymous cannot list promotions', () =>
    payload.find({ collection: 'promotions', overrideAccess: false }),
  )

  await denied('anonymous cannot list customers', () =>
    payload.find({ collection: 'customers', overrideAccess: false }),
  )

  await denied('anonymous cannot list orders', () =>
    payload.find({ collection: 'orders', overrideAccess: false }),
  )

  /*
   * The rule with no precedent in this codebase, so the one most worth proving: a variant is public
   * exactly when its product is, expressed as a `Where` across the relationship rather than as a
   * second status column. If Payload's Postgres adapter did not resolve `product.status` to a join,
   * this would silently publish every unreleased SKU and price.
   */
  const publicVariants = await payload.find({
    collection: 'product-variants',
    overrideAccess: false,
    where: { sku: { like: PREFIX } },
  })
  check(
    "a draft product's variants are invisible to the public",
    publicVariants.totalDocs === 0,
    `saw ${publicVariants.totalDocs}`,
  )

  await payload.update({
    collection: 'products',
    id: draft.id,
    data: { status: 'published' },
    overrideAccess: true,
  })
  const publishedVariants = await payload.find({
    collection: 'product-variants',
    overrideAccess: false,
    where: { sku: { like: PREFIX } },
  })
  check(
    "a published product's variants are visible to the public",
    publishedVariants.totalDocs === 1,
    `saw ${publishedVariants.totalDocs}`,
  )
  await payload.update({
    collection: 'products',
    id: draft.id,
    data: { status: 'draft' },
    overrideAccess: true,
  })

  /* ---- Carts: readable by their owner, written only by server code ---- */

  await allowed('alice can read her own cart', () =>
    payload.findByID({
      collection: 'carts',
      id: aliceCart.id,
      overrideAccess: false,
      user: aliceUser,
    }),
  )

  await denied("mallory cannot read alice's cart", () =>
    payload.findByID({
      collection: 'carts',
      id: aliceCart.id,
      overrideAccess: false,
      user: malloryUser,
    }),
  )

  await denied('a customer cannot edit their cart through the API', () =>
    payload.update({
      collection: 'carts',
      id: aliceCart.id,
      data: { status: 'converted' },
      overrideAccess: false,
      user: aliceUser,
    }),
  )

  /* ---- Cross-customer reads — §7.1b's hard boundary ---- */

  await denied("mallory cannot read alice's order", () =>
    payload.findByID({
      collection: 'orders',
      id: aliceOrder.id,
      overrideAccess: false,
      user: malloryUser,
    }),
  )

  await allowed('alice can read her own order', () =>
    payload.findByID({
      collection: 'orders',
      id: aliceOrder.id,
      overrideAccess: false,
      user: aliceUser,
    }),
  )

  /* ---- §17's invariant, closed by Phase 17's second sweep ---- */

  /*
   * `AGENTS.md`: *"Only a signature-verified Stripe webhook marks an order paid."* Phase 17 built
   * three mechanisms for that and left a fourth door open — `Orders.access.update` is `isStaff`,
   * so an admin could simply type it. `nobodyField` on the field closes it.
   *
   * Field-level access does not *throw*; Payload drops the field and applies the rest of the
   * update. So this asserts the **value**, not an error — the update is allowed to succeed and
   * required not to have moved the payment status. The tracking number proves the write landed,
   * which is what tells a working denial apart from an update that failed for some other reason.
   */
  await payload.update({
    collection: 'orders',
    data: { paymentStatus: 'paid', trackingNumber: `${PREFIX}-sweep-tracking` },
    id: aliceOrder.id,
    overrideAccess: false,
    user: adminUser,
  })

  const afterAdminEdit = await payload.findByID({
    collection: 'orders',
    depth: 0,
    id: aliceOrder.id,
    overrideAccess: true,
  })

  check(
    '**an admin cannot mark an order paid from the panel** — only the Stripe webhook may',
    afterAdminEdit.paymentStatus === 'draft',
    String(afterAdminEdit.paymentStatus),
  )

  check(
    '…and the rest of that same edit still applied, so the denial is the field and not the write',
    afterAdminEdit.trackingNumber === `${PREFIX}-sweep-tracking`,
    String(afterAdminEdit.trackingNumber),
  )

  const afterServerWrite = await payload.update({
    collection: 'orders',
    data: { paymentStatus: 'checkout_started' },
    id: aliceOrder.id,
    overrideAccess: true,
  })

  check(
    '…while the server path is untouched — `overrideAccess` skips field access, as the webhook needs',
    afterServerWrite.paymentStatus === 'checkout_started',
    String(afterServerWrite.paymentStatus),
  )

  await payload.update({
    collection: 'orders',
    data: { paymentStatus: 'draft' },
    id: aliceOrder.id,
    overrideAccess: true,
  })

  const malloryOrders = await payload.find({
    collection: 'orders',
    overrideAccess: false,
    user: malloryUser,
  })
  check(
    "mallory's order list does not contain alice's order",
    malloryOrders.totalDocs === 0,
    `saw ${malloryOrders.totalDocs}`,
  )

  await denied("mallory cannot read alice's address", () =>
    payload.findByID({
      collection: 'addresses',
      id: aliceAddress.id,
      overrideAccess: false,
      user: malloryUser,
    }),
  )

  await denied("mallory cannot update alice's address", () =>
    payload.update({
      collection: 'addresses',
      id: aliceAddress.id,
      data: { city: 'Malloryville' },
      overrideAccess: false,
      user: malloryUser,
    }),
  )

  await denied("mallory cannot delete alice's address", () =>
    payload.delete({
      collection: 'addresses',
      id: aliceAddress.id,
      overrideAccess: false,
      user: malloryUser,
    }),
  )

  await denied("mallory cannot read alice's customer record", () =>
    payload.findByID({
      collection: 'customers',
      id: alice.id,
      overrideAccess: false,
      user: malloryUser,
    }),
  )

  await denied("mallory cannot update alice's profile", () =>
    payload.update({
      collection: 'customers',
      id: alice.id,
      data: { firstName: 'Owned' },
      overrideAccess: false,
      user: malloryUser,
    }),
  )

  /* ---- Ownership is forced, not merely checked ---- */

  const plantedAddress = await payload.create({
    collection: 'addresses',
    overrideAccess: false,
    user: malloryUser,
    data: {
      customer: alice.id,
      firstName: 'Planted',
      lastName: 'Address',
      line1: '2 Test Street',
      city: 'Testville',
      postalCode: '00002',
      country: 'US',
    },
  })
  const plantedOwner =
    typeof plantedAddress.customer === 'object'
      ? plantedAddress.customer.id
      : plantedAddress.customer
  check(
    'an address created naming another customer belongs to its creator',
    plantedOwner === mallory.id,
    `owner is ${String(plantedOwner)}, expected ${mallory.id}`,
  )

  const plantedWishlist = await payload.create({
    collection: 'wishlist-items',
    overrideAccess: false,
    user: malloryUser,
    data: { customer: alice.id, product: draft.id },
  })
  const wishlistOwner =
    typeof plantedWishlist.customer === 'object'
      ? plantedWishlist.customer.id
      : plantedWishlist.customer
  check(
    'a wishlist row created naming another customer belongs to its creator',
    wishlistOwner === mallory.id,
    `owner is ${String(wishlistOwner)}, expected ${mallory.id}`,
  )

  /* ---- Privilege escalation ---- */

  const selfEnable = await payload.update({
    collection: 'customers',
    id: mallory.id,
    data: { accountStatus: 'disabled' },
    overrideAccess: false,
    user: malloryUser,
  })
  check(
    'a customer cannot change their own accountStatus',
    selfEnable.accountStatus === 'active',
    `became ${selfEnable.accountStatus}`,
  )

  const selfPromote = await payload.update({
    collection: 'users',
    id: editor.id,
    data: { role: 'admin' },
    overrideAccess: false,
    user: editorUser,
  })
  check(
    'an editor cannot promote themselves to admin',
    selfPromote.role === 'editor',
    `became ${selfPromote.role}`,
  )

  await denied('an editor cannot read another staff account', () =>
    payload.findByID({
      collection: 'users',
      id: admin.id,
      overrideAccess: false,
      user: editorUser,
    }),
  )

  await denied('an editor cannot create a staff account', () =>
    payload.create({
      collection: 'users',
      overrideAccess: false,
      user: editorUser,
      data: { email: `${PREFIX}-sneak@example.test`, password: PASSWORD, role: 'admin' },
    }),
  )

  await denied('an editor cannot delete a product', () =>
    payload.delete({
      collection: 'products',
      id: draft.id,
      overrideAccess: false,
      user: editorUser,
      trash: false,
    }),
  )

  /*
   * Field access denies by *removing the key*, so this is not a refusal to assert on — the request
   * succeeds and the value must simply not have moved. Reading the returned document is the only
   * honest way to check it, and the admin case beside it is what proves the rule is a boundary
   * rather than a global "no".
   */
  const settingsBefore = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })
  const editorAttempt = await payload.updateGlobal({
    slug: 'site-settings',
    data: { maxQuantityPerLine: 99 },
    overrideAccess: false,
    user: editorUser,
  })
  check(
    'an editor cannot change a commerce setting',
    editorAttempt.maxQuantityPerLine === settingsBefore.maxQuantityPerLine,
    `became ${String(editorAttempt.maxQuantityPerLine)}`,
  )

  const adminAttempt = await payload.updateGlobal({
    slug: 'site-settings',
    data: { maxQuantityPerLine: 99 },
    overrideAccess: false,
    user: adminUser,
  })
  check('an admin can change a commerce setting', adminAttempt.maxQuantityPerLine === 99)

  await payload.updateGlobal({
    slug: 'site-settings',
    data: { maxQuantityPerLine: settingsBefore.maxQuantityPerLine },
    overrideAccess: true,
  })

  await denied('an admin cannot delete their own staff account', () =>
    payload.delete({ collection: 'users', id: admin.id, overrideAccess: false, user: adminUser }),
  )

  await denied('nobody can create an order through access-controlled writes', () =>
    payload.create({
      collection: 'orders',
      overrideAccess: false,
      user: adminUser,
      data: {
        email: `${PREFIX}-forged@example.test`,
        orderNumber: `${PREFIX}-order-forged`,
        currency: 'USD',
        paymentStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        subtotalMinor: 0,
        discountMinor: 0,
        shippingMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
      },
    }),
  )

  /* ---- Reviews: moderation state is not the author's to set ---- */

  const review = await payload.create({
    collection: 'reviews',
    overrideAccess: false,
    user: aliceUser,
    data: {
      product: draft.id,
      customer: mallory.id,
      displayName: 'Verify Alice',
      rating: 5,
      body: 'Written by the verification script.',
      status: 'approved',
      verifiedPurchase: true,
    },
  })
  check(
    'a review cannot be self-approved',
    review.status === 'pending',
    `status is ${review.status}`,
  )
  check(
    'a review cannot claim a verified purchase',
    review.verifiedPurchase === false,
    `verifiedPurchase is ${String(review.verifiedPurchase)}`,
  )

  const anonymousReviews = await payload.find({
    collection: 'reviews',
    overrideAccess: false,
    where: { product: { equals: draft.id } },
  })
  check(
    'an unmoderated review is invisible to the public',
    anonymousReviews.totalDocs === 0,
    `saw ${anonymousReviews.totalDocs}`,
  )

  const ownReviews = await payload.find({
    collection: 'reviews',
    overrideAccess: false,
    user: aliceUser,
    where: { product: { equals: draft.id } },
  })
  check('an author can see their own unmoderated review', ownReviews.totalDocs === 1)

  /* ---- Sessions, and the admin-panel boundary, through real tokens ---- */

  const aliceSession = await payload.login({
    collection: 'customers',
    data: { email: `${PREFIX}-alice@example.test`, password: PASSWORD },
  })

  const aliceAuth = await payload.auth({
    headers: new Headers({ Authorization: `JWT ${aliceSession.token}` }),
  })
  check(
    'a customer token authenticates as a customer',
    (aliceAuth.user as { collection?: string } | null)?.collection === 'customers',
  )
  /*
   * `!== true`, not `=== false`. `getAccessResults` assigns `false`, and `sanitizePermissions` then
   * drops every falsy entry on its way to the client — so a customer's answer arrives as `undefined`
   * and staff's as `true`. Measured, not assumed: the first version of this check asserted `=== false`
   * and failed against a customer whose access is correctly refused.
   */
  check(
    'the admin panel is unreachable for a customer',
    aliceAuth.permissions.canAccessAdmin !== true,
    `canAccessAdmin is ${String(aliceAuth.permissions.canAccessAdmin)} (sanitised false)`,
  )

  const editorSession = await payload.login({
    collection: 'users',
    data: { email: `${PREFIX}-editor@example.test`, password: PASSWORD },
  })
  const editorAuth = await payload.auth({
    headers: new Headers({ Authorization: `JWT ${editorSession.token}` }),
  })
  check(
    'the admin panel is reachable for staff',
    editorAuth.permissions.canAccessAdmin === true,
    `canAccessAdmin is ${String(editorAuth.permissions.canAccessAdmin)}`,
  )

  const signedIn = await payload.findByID({
    collection: 'customers',
    id: alice.id,
    overrideAccess: true,
    showHiddenFields: true,
  })
  check(
    'signing in records a server-side session',
    (signedIn.sessions ?? []).length === 1,
    `${(signedIn.sessions ?? []).length} session(s)`,
  )

  /* ---- Disabling an account ---- */

  await payload.update({
    collection: 'customers',
    id: alice.id,
    data: { accountStatus: 'disabled' },
    overrideAccess: true,
  })

  const disabled = await payload.findByID({
    collection: 'customers',
    id: alice.id,
    overrideAccess: true,
    showHiddenFields: true,
  })
  check(
    'disabling an account revokes its live sessions',
    (disabled.sessions ?? []).length === 0,
    `${(disabled.sessions ?? []).length} session(s) remain`,
  )

  const revokedAuth = await payload.auth({
    headers: new Headers({ Authorization: `JWT ${aliceSession.token}` }),
  })
  check(
    "a disabled account's existing token stops authenticating",
    revokedAuth.user === null,
    `still resolves to ${String((revokedAuth.user as { email?: string } | null)?.email)}`,
  )

  await denied(
    'a disabled account cannot sign in',
    () =>
      payload.login({
        collection: 'customers',
        data: { email: `${PREFIX}-alice@example.test`, password: PASSWORD },
      }),
    ['AuthenticationError'],
  )

  const disabledUser = asUser(disabled, 'customers')

  await denied('a disabled account cannot read its own orders', () =>
    payload.findByID({
      collection: 'orders',
      id: aliceOrder.id,
      overrideAccess: false,
      user: disabledUser,
    }),
  )

  /* ---- Password policy, on every path ---- */

  await denied(
    'a short password is refused on registration',
    () =>
      payload.create({
        collection: 'customers',
        overrideAccess: false,
        data: {
          email: `${PREFIX}-weak@example.test`,
          password: 'short',
          firstName: 'Weak',
          lastName: 'Password',
          accountStatus: 'active',
        },
      }),
    ['ValidationError'],
  )

  await denied(
    'a password equal to the email address is refused',
    () =>
      payload.create({
        collection: 'customers',
        overrideAccess: false,
        data: {
          email: `${PREFIX}-echo@example.test`,
          password: `${PREFIX}-echo@example.test`,
          firstName: 'Echo',
          lastName: 'Password',
          accountStatus: 'active',
        },
      }),
    ['ValidationError'],
  )
} finally {
  await cleanup()
}

/* -------------------------------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------------------------------- */

const failed = results.filter((result) => !result.ok)

for (const result of results) {
  const line = `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`
  payload.logger.info(line)
}

payload.logger.info(`${results.length - failed.length}/${results.length} access checks passed.`)

if (failed.length > 0) {
  throw new Error(`${failed.length} access check(s) failed.`)
}

process.exit(0)
