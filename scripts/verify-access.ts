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

import { sql } from '@payloadcms/db-postgres'
import type { Payload, TypedUser } from 'payload'

import config from '../src/payload.config'

import { CUSTOMER_REVISION_KEY_PREFIX } from '../src/lib/auth/customer-revision'
import { developmentDatabase } from '../src/lib/env.core'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-access refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes customer records, so it may only touch the development database that ' +
      'DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const {
  createLocalReq,
  forgotPasswordOperation,
  getPayload,
  loginOperation,
  logoutOperation,
  refreshOperation,
  resetPasswordOperation,
  updateByIDOperation,
  updateOperation,
} = await import('payload')

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

/**
 * **A Payload write held open in its own transaction** — sweep 1, finding S02.
 *
 * The races S02 is about cannot be produced by firing two requests and hoping. So the revoking write
 * runs inside a transaction this script owns and has not committed; the competing write is started;
 * `blockedBehind` waits until Postgres itself reports that write queued behind the held transaction;
 * and only then is the held one committed. Every interleaving below is therefore the dangerous one,
 * on every run, rather than on the runs where the timing happened to line up.
 */
async function holdTransaction() {
  const transactionID = await payload.db.beginTransaction()

  if (transactionID === null) {
    throw new Error('Could not begin a transaction to hold.')
  }

  const handle = (
    payload.db as unknown as {
      sessions: Record<
        string,
        { db: { execute: (query: unknown) => Promise<{ rows: unknown[] }> } }
      >
    }
  ).sessions[String(transactionID)].db

  const { rows } = await handle.execute(sql`SELECT pg_backend_pid() AS "pid"`)

  return {
    commit: () => payload.db.commitTransaction(transactionID),
    pid: Number((rows[0] as { pid: number }).pid),
    req: { transactionID } as never,
    transactionID,
  }
}

/** Wait until some other backend is blocked on a lock held by `pid`. */
async function blockedBehind(pid: number, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const { rows } = await payload.db.drizzle.execute(
      sql`SELECT count(*)::int AS "waiting" FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`,
    )

    if ((rows[0] as { waiting: number }).waiting > 0) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  return false
}

/** How an operation ended: `'done'`, or the name of the error it threw. */
function outcomeOf(operation: Promise<unknown>): Promise<string> {
  return operation.then(
    () => 'done',
    (error: unknown) => (error instanceof Error ? error.constructor.name : String(error)),
  )
}

/** Whether `operation` settles within `ms` — false when it is still queued on a lock. */
function settlesWithin(operation: Promise<unknown>, ms = 5_000): Promise<boolean> {
  return Promise.race([
    operation.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ])
}

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

const payload: Payload = await getPayload({ config })

/**
 * A request shaped exactly as Payload's REST handlers make it: `payloadAPI: 'REST'` and no
 * `overrideAccess`. The guards under test key on `payloadAPI`, so this is the REST door without an
 * HTTP server in front of it.
 */
async function restReq(user?: TypedUser) {
  const req = await createLocalReq(user ? { user } : {}, payload)

  req.payloadAPI = 'REST'

  return req
}

/** A customer's stored sessions, read past access control and hidden-field stripping. */
async function sessionsOf(id: number) {
  return (
    (
      await payload.findByID({
        collection: 'customers',
        id,
        overrideAccess: true,
        showHiddenFields: true,
      })
    ).sessions ?? []
  )
}

/** Whether a customer token still resolves to a user. */
async function authenticates(token: string | undefined) {
  return (
    (await payload.auth({ headers: new Headers({ Authorization: `JWT ${token}` }) })).user !== null
  )
}

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
  // The R1-18 checks' lock and preference rows, including any a refused write failed to refuse.
  await payload.delete({
    collection: 'payload-locked-documents',
    where: { globalSlug: { like: PREFIX } },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'payload-preferences',
    where: { key: { like: PREFIX } },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'products',
    where: { slug: { like: PREFIX } },
    overrideAccess: true,
    trash: false,
  })

  const customerIds = (
    await payload.find({
      collection: 'customers',
      limit: 0,
      overrideAccess: true,
      pagination: false,
      trash: true,
      where,
    })
  ).docs.map((doc) => `${CUSTOMER_REVISION_KEY_PREFIX}${doc.id}`)

  await payload.delete({ collection: 'customers', where, overrideAccess: true, trash: false })
  await payload.delete({ collection: 'users', where, overrideAccess: true })

  // The revision markers the locks stamped — `Customers.ts` never deletes one, so a fixture must.
  if (customerIds.length > 0) {
    await payload.db.drizzle.execute(
      sql`DELETE FROM "payload_kv" WHERE "key" IN (${sql.join(
        customerIds.map((key) => sql`${key}`),
        sql`, `,
      )})`,
    )
  }
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

  // The restore is in a `finally`: a throw between the two writes must not leave the shop's limit at 99.
  try {
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
  } finally {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { maxQuantityPerLine: settingsBefore.maxQuantityPerLine },
      overrideAccess: true,
    })
  }

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

  /* Phase 34: without the Server Action's verified flag — i.e. `POST /api/reviews` — a customer is refused. */
  await denied('a review that skipped the Turnstile guard is refused', () =>
    payload.create({
      collection: 'reviews',
      overrideAccess: false,
      user: aliceUser,
      data: {
        product: draft.id,
        customer: alice.id,
        displayName: 'Verify Alice',
        rating: 5,
        body: 'Written by the verification script.',
        status: 'pending',
        verifiedPurchase: false,
      },
    }),
  )

  const review = await payload.create({
    collection: 'reviews',
    context: { turnstileVerified: true },
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

  /* ---- Sweep 1, S02: a revocation stays revoked while another write of the row is in flight ---- */

  {
    const racerEmail = `${PREFIX}-racer@example.test`
    const NEW_PASSWORD = 'A-new-passphrase-for-verify-9'
    const racer = await makeCustomer('racer')
    const racerUser = asUser(racer, 'customers')

    const signIn = (password = PASSWORD) =>
      payload.login({ collection: 'customers', data: { email: racerEmail, password } })

    const reEnable = () =>
      payload.update({
        collection: 'customers',
        data: { accountStatus: 'active' },
        id: racer.id,
        overrideAccess: true,
      })

    /* The REST refresh door. */

    const refreshing = await signIn()
    const refreshingAuth = await payload.auth({
      headers: new Headers({ Authorization: `JWT ${refreshing.token}` }),
    })
    const restRefresh = await createLocalReq({ user: refreshingAuth.user as TypedUser }, payload)

    restRefresh.payloadAPI = 'REST'

    await denied(
      'S02: **`POST /api/customers/refresh-token` is refused** — it outlived the seven-day bound and rewrote the row from a stale read',
      () => refreshOperation({ collection: payload.collections.customers, req: restRefresh }),
      ['Forbidden'],
    )

    const restLogout = await createLocalReq({ user: refreshingAuth.user as TypedUser }, payload)

    restLogout.payloadAPI = 'REST'

    await allowed('S02: …while `POST /api/customers/logout` still signs out', () =>
      logoutOperation({ collection: payload.collections.customers, req: restLogout }),
    )

    check('S02: …and that sign-out revoked its session', !(await authenticates(refreshing.token)))

    /* A disable against an in-flight profile write — the measured failure. */

    const patched = await signIn()
    const disablingForPatch = await holdTransaction()

    await payload.update({
      collection: 'customers',
      data: { accountStatus: 'disabled' },
      id: racer.id,
      overrideAccess: true,
      req: disablingForPatch.req,
    })

    const stalePatch = payload
      .update({
        collection: 'customers',
        data: { firstName: 'Stale' },
        id: racer.id,
        overrideAccess: false,
        user: racerUser,
      })
      .then(
        () => 'written',
        (error: unknown) => (error instanceof Error ? error.constructor.name : String(error)),
      )

    check(
      "S02: the customer's own profile write is queued behind the uncommitted disable",
      await blockedBehind(disablingForPatch.pid),
    )

    await disablingForPatch.commit()
    await stalePatch

    const afterPatch = await payload.findByID({
      collection: 'customers',
      id: racer.id,
      overrideAccess: true,
    })

    check(
      '**S02: a disable that commits under an in-flight profile write stays disabled** — it came back `active` before the lock',
      afterPatch.accountStatus === 'disabled',
      String(afterPatch.accountStatus),
    )
    check(
      "S02: …its sessions stay revoked, so the customer's token stops authenticating",
      (await sessionsOf(racer.id)).length === 0 && !(await authenticates(patched.token)),
      `${(await sessionsOf(racer.id)).length} session(s)`,
    )

    /* A disable against an in-flight sign-out of another session. */

    await reEnable()

    const leaving = await signIn()
    const staying = await signIn()
    const leavingAuth = await payload.auth({
      headers: new Headers({ Authorization: `JWT ${leaving.token}` }),
    })
    const disablingForLogout = await holdTransaction()

    await payload.update({
      collection: 'customers',
      data: { accountStatus: 'disabled' },
      id: racer.id,
      overrideAccess: true,
      req: disablingForLogout.req,
    })

    const logoutReq = await createLocalReq({ user: leavingAuth.user as TypedUser }, payload)

    logoutReq.payloadAPI = 'REST'

    const staleLogout = logoutOperation({
      collection: payload.collections.customers,
      req: logoutReq,
    }).catch(() => undefined)

    check(
      'S02: a sign-out is queued behind the uncommitted disable',
      await blockedBehind(disablingForLogout.pid),
    )

    await disablingForLogout.commit()
    await staleLogout

    const afterLogout = await payload.findByID({
      collection: 'customers',
      id: racer.id,
      overrideAccess: true,
      showHiddenFields: true,
    })

    check(
      '**S02: a sign-out that straddles a disable does not put the other sessions back**',
      afterLogout.accountStatus === 'disabled' &&
        (afterLogout.sessions ?? []).length === 0 &&
        !(await authenticates(staying.token)),
      `${String(afterLogout.accountStatus)}, ${(afterLogout.sessions ?? []).length} session(s)`,
    )

    /* A reset, and a sign-in with the old password that straddles it. */

    await reEnable()

    const beforeReset = await signIn()
    const resetToken = await payload.forgotPassword({
      collection: 'customers',
      data: { email: racerEmail },
      disableEmail: true,
    })
    const resetting = await holdTransaction()

    await payload.resetPassword({
      collection: 'customers',
      data: { password: NEW_PASSWORD, token: String(resetToken) },
      overrideAccess: true,
      req: resetting.req,
    })

    const staleSignIn = signIn().then(
      () => 'signed in',
      (error: unknown) => (error instanceof Error ? error.constructor.name : String(error)),
    )

    check(
      'S02: a sign-in with the old password is queued behind the uncommitted reset',
      await blockedBehind(resetting.pid),
    )

    await resetting.commit()

    const staleOutcome = await staleSignIn

    check(
      '**S02: a sign-in with the old password that straddles a reset is refused** — it restored the old hash before',
      staleOutcome === 'AuthenticationError',
      staleOutcome,
    )
    check(
      'S02: **a reset leaves no session at all** — the old cookie and the reset’s own, in the same commit as the password',
      (await sessionsOf(racer.id)).length === 0 && !(await authenticates(beforeReset.token)),
      `${(await sessionsOf(racer.id)).length} session(s)`,
    )

    await denied('S02: …the old password no longer signs in', () => signIn(), [
      'AuthenticationError',
    ])
    await allowed('S02: …and the new one does', () => signIn(NEW_PASSWORD))

    /* One link, used three times at once. */

    const sharedToken = await payload.forgotPassword({
      collection: 'customers',
      data: { email: racerEmail },
      disableEmail: true,
    })
    const reuses = await Promise.allSettled(
      [1, 2, 3].map((attempt) =>
        payload.resetPassword({
          collection: 'customers',
          data: { password: `${NEW_PASSWORD}-${attempt}`, token: String(sharedToken) },
          overrideAccess: true,
        }),
      ),
    )

    check(
      'S02: **one reset link used three times at once works exactly once**',
      reuses.filter((outcome) => outcome.status === 'fulfilled').length === 1,
      `${reuses.filter((outcome) => outcome.status === 'fulfilled').length} succeeded`,
    )

    /* The lock is the customer's own row, whatever `where` they send. */

    const bystander = await makeCustomer('bystander')
    const holdingBystander = await holdTransaction()

    await payload.update({
      collection: 'customers',
      data: { phone: '555 0100' },
      id: bystander.id,
      overrideAccess: true,
      req: holdingBystander.req,
    })

    const broadWrite = payload
      .update({
        collection: 'customers',
        data: { phone: '555 0199' },
        overrideAccess: false,
        user: racerUser,
        where: { id: { exists: true } },
      })
      .then(
        (result) => result.docs.map((doc) => doc.id),
        () => [] as number[],
      )

    const finishedFirst = await Promise.race([
      broadWrite.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
    ])

    await holdingBystander.commit()

    const broadWritten = await broadWrite

    check(
      "S02: a customer's `where: { id: { exists: true } }` update does not wait on another customer's locked row",
      finishedFirst,
    )
    check(
      '…and it wrote their own row and nobody else’s',
      broadWritten.length === 1 && broadWritten[0] === racer.id,
      broadWritten.join(','),
    )

    /* The admin panel's bulk edit arrives as a `where`, and locks the rows that `where` names. */
    const bulk = await payload.update({
      collection: 'customers',
      data: { phone: '555 0142' },
      overrideAccess: false,
      user: adminUser,
      where: { id: { in: [racer.id, bystander.id] } },
    })

    check(
      'S02: a staff bulk edit by `where` still writes every row it names',
      bulk.errors.length === 0 && bulk.docs.length === 2,
      `${bulk.docs.length} written, ${bulk.errors.length} error(s)`,
    )

    /*
     * **The recheck: the lock is decided by the access rule, not by who is asking.** Payload's REST
     * handlers never pass `overrideAccess`, and the first version of the lock read that absence as
     * trusted server code — so an anonymous `PATCH` locked whatever it named, the whole table for a
     * broad `where`, before `update` refused it. Each call below is shaped exactly as the REST
     * handler makes it (`payloadAPI: 'REST'`, no `overrideAccess`) and runs while another
     * transaction holds the bystander's row. One that locked that row would queue behind it;
     * `settlesWithin` is false for exactly that case, which `pg_blocking_pids` confirms below.
     */

    const holdingForRest = await holdTransaction()

    await payload.update({
      collection: 'customers',
      data: { phone: '555 0101' },
      id: bystander.id,
      overrideAccess: true,
      req: holdingForRest.req,
    })

    const racerRestUser = racerUser

    const restCases: { expect: string; name: string; run: () => Promise<unknown> }[] = [
      {
        name: 'an anonymous REST `PATCH /api/customers?where[id][exists]=true`',
        expect: 'Forbidden',
        run: async () =>
          updateOperation({
            collection: payload.collections.customers,
            data: { phone: '555 0666' },
            req: await restReq(),
            where: { id: { exists: true } },
          }),
      },
      {
        name: "an anonymous REST `PATCH /api/customers/<a customer's id>`",
        expect: 'Forbidden',
        run: async () =>
          updateByIDOperation({
            collection: payload.collections.customers,
            data: { phone: '555 0666' },
            id: bystander.id,
            req: await restReq(),
          }),
      },
      {
        name: "a customer's REST `PATCH` of another customer's row",
        expect: 'Forbidden',
        run: async () =>
          updateByIDOperation({
            collection: payload.collections.customers,
            data: { phone: '555 0666' },
            id: bystander.id,
            req: await restReq(racerRestUser),
          }),
      },
      {
        name: "a customer's REST `where[hash][exists]=true` (a hidden column)",
        expect: 'QueryError',
        run: async () =>
          updateOperation({
            collection: payload.collections.customers,
            data: { phone: '555 0666' },
            req: await restReq(racerRestUser),
            where: { hash: { exists: true } },
          }),
      },
    ]

    const pending: Promise<unknown>[] = []

    for (const restCase of restCases) {
      const running = outcomeOf(restCase.run())

      pending.push(running)

      const settled = await settlesWithin(running)
      const outcome = settled ? await running : 'still queued on the bystander’s lock'

      check(
        `S02 recheck: ${restCase.name} locks nothing it may not write, and is refused as before`,
        settled && outcome === restCase.expect,
        outcome,
      )
    }

    const broadRest = updateOperation({
      collection: payload.collections.customers,
      data: { phone: '555 0177' },
      req: await restReq(racerRestUser),
      where: { id: { exists: true } },
    })

    pending.push(broadRest.catch(() => undefined))

    const broadRestSettled = await settlesWithin(broadRest)
    const broadRestIds = broadRestSettled
      ? (await broadRest.catch(() => ({ docs: [] as { id: number }[] }))).docs.map((doc) => doc.id)
      : []

    check(
      "S02 recheck: a customer's REST `where[id][exists]=true` does not wait on another customer's row, and writes only their own",
      broadRestSettled && broadRestIds.length === 1 && broadRestIds[0] === racer.id,
      broadRestSettled ? broadRestIds.join(',') : 'still queued on the bystander’s lock',
    )

    const { rows: blockedRows } = await payload.db.drizzle.execute(
      sql`SELECT count(*)::int AS "waiting" FROM pg_stat_activity WHERE ${holdingForRest.pid} = ANY(pg_blocking_pids(pid))`,
    )

    check(
      'S02 recheck: …and Postgres reports nothing queued behind the bystander’s lock',
      (blockedRows[0] as { waiting: number }).waiting === 0,
      `${(blockedRows[0] as { waiting: number }).waiting} waiting`,
    )

    /* A permitted REST write still takes the lock: the editor's edit of the held row waits for it. */
    const staffRest = outcomeOf(
      updateByIDOperation({
        collection: payload.collections.customers,
        data: { phone: '555 0188' },
        id: bystander.id,
        req: await restReq(editorUser),
      }),
    )

    pending.push(staffRest)

    check(
      'S02 recheck: a staff REST edit of a row another transaction holds still queues behind it',
      await blockedBehind(holdingForRest.pid),
    )

    await holdingForRest.commit()
    await Promise.all(pending)

    check(
      'S02 recheck: …and completes once that transaction commits',
      (await staffRest) === 'done',
      await staffRest,
    )

    const ownRest = await outcomeOf(
      updateByIDOperation({
        collection: payload.collections.customers,
        data: { firstName: 'Renamed' },
        id: racer.id,
        req: await restReq(racerRestUser),
      }),
    )
    const renamed = await payload.findByID({
      collection: 'customers',
      id: racer.id,
      overrideAccess: true,
    })

    check(
      "S02 recheck: a customer's own REST profile edit still works",
      ownRest === 'done' && renamed.firstName === 'Renamed',
      `${ownRest}, firstName ${renamed.firstName}`,
    )

    const staffBulkRest = await updateOperation({
      collection: payload.collections.customers,
      data: { phone: '555 0143' },
      req: await restReq(adminUser),
      where: { id: { in: [racer.id, bystander.id] } },
    })

    check(
      'S02 recheck: a staff REST bulk edit by `where` still writes every row it names',
      staffBulkRest.errors.length === 0 && staffBulkRest.docs.length === 2,
      `${staffBulkRest.docs.length} written, ${staffBulkRest.errors.length} error(s)`,
    )

    /*
     * **The sign-in check runs on the sign-in's own connection.** Its first version read the
     * committed row on a second pool connection while the sign-in's transaction held the first and
     * the row lock, so every successful sign-in needed two connections at once. Here every pool
     * connection but one is checked out and held, and a sign-in has to finish on the one that is
     * left. The first version waited out `connectionTimeoutMillis` (15s) for a second connection and
     * failed; the window below is shorter than that on purpose.
     */

    const lonely = await makeCustomer('lonely')
    const lonelyEmail = `${PREFIX}-lonely@example.test`
    const pool = (
      payload.db as unknown as {
        pool: {
          connect: () => Promise<{ release: () => void }>
          idleCount: number
          options: { max?: number }
          totalCount: number
        }
      }
    ).pool
    /*
     * What is already checked out stays out of reach — the adapter's `connect` keeps one client for
     * its reconnect listener and never releases it — so the count to hold is the pool's size, less
     * those, less the one the sign-in gets.
     */
    const alreadyOut = pool.totalCount - pool.idleCount
    const occupied = await Promise.all(
      Array.from({ length: (pool.options.max ?? 10) - alreadyOut - 1 }, () => pool.connect()),
    )
    const lonelySignIn = outcomeOf(
      payload.login({ collection: 'customers', data: { email: lonelyEmail, password: PASSWORD } }),
    )
    const lonelySettled = await settlesWithin(lonelySignIn, 10_000)

    for (const client of occupied) {
      client.release()
    }

    const lonelyOutcome = await lonelySignIn

    check(
      `S02 recheck: **a sign-in completes with a single free pool connection** (${occupied.length + alreadyOut} of ${pool.options.max ?? 10} held elsewhere)`,
      lonelySettled && lonelyOutcome === 'done',
      lonelySettled ? lonelyOutcome : 'still waiting for a second connection after 10s',
    )

    /*
     * `resetLoginAttempts` rewrites `updated_at` inside the sign-in's transaction whenever the account
     * has a failed attempt on record — the reason the check cannot use that column as its marker.
     */
    await denied(
      'S02 recheck: a wrong password is refused…',
      () =>
        payload.login({
          collection: 'customers',
          data: { email: lonelyEmail, password: 'not-the-password' },
        }),
      ['AuthenticationError'],
    )
    await allowed('S02 recheck: …and the right one, straight after it, still signs in', () =>
      payload.login({ collection: 'customers', data: { email: lonelyEmail, password: PASSWORD } }),
    )

    /* A sign-out, the one revocation that leaves `updated_at` alone, straddled by a sign-in. */

    const leavingDevice = await payload.login({
      collection: 'customers',
      data: { email: lonelyEmail, password: PASSWORD },
    })
    const leavingDeviceAuth = await payload.auth({
      headers: new Headers({ Authorization: `JWT ${leavingDevice.token}` }),
    })
    const signingOut = await holdTransaction()
    const signOutReq = await createLocalReq({ user: leavingDeviceAuth.user as TypedUser }, payload)

    signOutReq.transactionID = signingOut.transactionID

    await logoutOperation({ collection: payload.collections.customers, req: signOutReq })

    const signInOverSignOut = outcomeOf(
      payload.login({ collection: 'customers', data: { email: lonelyEmail, password: PASSWORD } }),
    )

    check(
      'S02 recheck: a sign-in is queued behind an uncommitted sign-out',
      await blockedBehind(signingOut.pid),
    )

    await signingOut.commit()

    check(
      '**S02 recheck: a sign-in that straddles a sign-out is refused**, so the signed-out session stays dead',
      (await signInOverSignOut) === 'AuthenticationError' &&
        !(await authenticates(leavingDevice.token)),
      await signInOverSignOut,
    )

    /* A permanent delete, straddled by a sign-in whose write is an upsert. */

    const deleting = await holdTransaction()

    await payload.delete({
      collection: 'customers',
      id: lonely.id,
      overrideAccess: true,
      req: deleting.req,
      trash: false,
    })

    const signInOverDelete = outcomeOf(
      payload.login({ collection: 'customers', data: { email: lonelyEmail, password: PASSWORD } }),
    )

    check(
      'S02 recheck: a sign-in is queued behind an uncommitted delete',
      await blockedBehind(deleting.pid),
    )

    await deleting.commit()

    const resurrected = await payload.find({
      collection: 'customers',
      limit: 1,
      overrideAccess: true,
      trash: true,
      where: { id: { equals: lonely.id } },
    })

    check(
      '**S02 recheck: a sign-in that straddles a delete is refused and does not re-insert the account**',
      (await signInOverDelete) === 'AuthenticationError' && resurrected.docs.length === 0,
      `${await signInOverDelete}, ${resurrected.docs.length} row(s)`,
    )

    // `cleanup` finds markers through the fixtures still present, and this one's customer is gone.
    await payload.db.drizzle.execute(
      sql`DELETE FROM "payload_kv" WHERE "key" = ${`${CUSTOMER_REVISION_KEY_PREFIX}${lonely.id}`}`,
    )
  }

  /* ---- §34, R1-15 and §34.1d: the REST auth doors, and who may change a credential ---- */

  {
    const customers = payload.collections.customers
    const SELF_PASSWORD = 'A-self-chosen-passphrase-for-verify-7'
    const ADMIN_PASSWORD = 'An-admin-set-passphrase-for-verify-5'

    const signInAs = (email: string, password: string) =>
      payload.login({ collection: 'customers', data: { email, password } })

    /*
     * Each group below has its own customer, so a guard that fails to refuse changes only its own
     * group's account, and the harness still reaches the report and names what broke.
     *
     * `beforeOperation` refuses these three to anything but the Local API. Each call would succeed
     * without that guard: the credentials are right, the reset token is live and its password meets
     * the policy, and the address exists. The reset runs before forgot-password so a forgot-password
     * that got through cannot replace the token first. `disableEmail` is not something the guard
     * reads; it only keeps a guard that failed to refuse from trying to send mail.
     */
    await makeCustomer('gatekeeper')

    const gatekeeperEmail = `${PREFIX}-gatekeeper@example.test`
    const liveToken = await payload.forgotPassword({
      collection: 'customers',
      data: { email: gatekeeperEmail },
      disableEmail: true,
    })

    await denied(
      '§34 R1-15: **`POST /api/customers/login` is refused**, even with the right password',
      async () =>
        loginOperation({
          collection: customers,
          data: { email: gatekeeperEmail, password: PASSWORD },
          req: await restReq(),
        }),
      ['Forbidden'],
    )

    await denied(
      '§34 R1-15: **`POST /api/customers/reset-password` is refused**, with a live token and a valid password',
      async () =>
        resetPasswordOperation({
          collection: customers,
          data: { password: SELF_PASSWORD, token: String(liveToken) },
          req: await restReq(),
        }),
      ['Forbidden'],
    )

    await denied(
      '§34 R1-15: **`POST /api/customers/forgot-password` is refused** for a real address',
      async () =>
        forgotPasswordOperation({
          collection: customers,
          // Payload's generated type demands a `password` the operation never reads; the handler sends none.
          data: { email: gatekeeperEmail } as never,
          disableEmail: true,
          req: await restReq(),
        }),
      ['Forbidden'],
    )

    await allowed(
      '§34 R1-15: …while the Local API sign-in the storefront uses still works, on the unchanged password',
      () => signInAs(gatekeeperEmail, PASSWORD),
    )

    /* §34.1d: a customer's own row, through REST — credentials refused, the profile still editable. */

    const keyholder = await makeCustomer('keyholder')
    const keyholderEmail = `${PREFIX}-keyholder@example.test`
    const keyholderUser = asUser(keyholder, 'customers')

    await denied(
      "§34.1d: **a customer's own REST `PATCH` of a new password is refused** — a stolen cookie is not a takeover",
      async () =>
        updateByIDOperation({
          collection: customers,
          data: { password: SELF_PASSWORD },
          id: keyholder.id,
          req: await restReq(keyholderUser),
        }),
      ['Forbidden'],
    )

    await denied(
      "§34.1d: **a customer's own REST `PATCH` of a new sign-in email is refused**",
      async () =>
        updateByIDOperation({
          collection: customers,
          data: { email: `${PREFIX}-keyholder-hijacked@example.test` },
          id: keyholder.id,
          req: await restReq(keyholderUser),
        }),
      ['Forbidden'],
    )

    const afterSelfEdits = await payload.findByID({
      collection: 'customers',
      id: keyholder.id,
      overrideAccess: true,
    })
    const oldPasswordOutcome = await outcomeOf(signInAs(keyholderEmail, PASSWORD))

    check(
      '§34.1d: …neither landed — the email is unchanged and the old password still signs in',
      afterSelfEdits.email === keyholderEmail && oldPasswordOutcome === 'done',
      `${afterSelfEdits.email}, sign-in ${oldPasswordOutcome}`,
    )

    // The account form sends the address back unchanged, so the unchanged email rides along here.
    const ownEdit = await outcomeOf(
      updateByIDOperation({
        collection: customers,
        data: { email: keyholderEmail, firstName: 'Keyholder' },
        id: keyholder.id,
        req: await restReq(keyholderUser),
      }),
    )
    const edited = await payload.findByID({
      collection: 'customers',
      id: keyholder.id,
      overrideAccess: true,
    })

    check(
      "§34.1d: a customer's own REST edit of `firstName`, with their email sent back unchanged, still succeeds",
      ownEdit === 'done' && edited.firstName === 'Keyholder',
      `${ownEdit}, firstName ${edited.firstName}`,
    )

    /* An admin sets the password — and every session on the account ends (Phase 36, R1-13). */

    const supported = await makeCustomer('supported')
    const supportedEmail = `${PREFIX}-supported@example.test`

    await signInAs(supportedEmail, PASSWORD)

    const heldCookie = await signInAs(supportedEmail, PASSWORD)
    const sessionsBeforeReset = (await sessionsOf(supported.id)).length

    const adminSetPassword = await outcomeOf(
      updateByIDOperation({
        collection: customers,
        data: { password: ADMIN_PASSWORD },
        id: supported.id,
        req: await restReq(adminUser),
      }),
    )
    const sessionsAfterReset = (await sessionsOf(supported.id)).length
    const heldCookieLives = await authenticates(heldCookie.token)

    check(
      "R1-13: **an admin setting a customer's password ends every session on that account**",
      adminSetPassword === 'done' &&
        sessionsBeforeReset > 0 &&
        sessionsAfterReset === 0 &&
        !heldCookieLives,
      `${adminSetPassword}; ${sessionsBeforeReset} session(s) before, ${sessionsAfterReset} after; old cookie ${heldCookieLives ? 'still authenticates' : 'refused'}`,
    )

    await allowed(
      "§34.1d: an admin's REST edit can set a customer's password — the new one signs in",
      () => signInAs(supportedEmail, ADMIN_PASSWORD),
    )

    const keptCookie = await signInAs(supportedEmail, ADMIN_PASSWORD)
    const sessionsBeforeProfileEdit = (await sessionsOf(supported.id)).length
    const adminProfileEdit = await outcomeOf(
      updateByIDOperation({
        collection: customers,
        data: { firstName: 'Supported' },
        id: supported.id,
        req: await restReq(adminUser),
      }),
    )
    const sessionsAfterProfileEdit = (await sessionsOf(supported.id)).length

    check(
      'R1-13: …while an admin profile edit that sets no password keeps the sessions',
      adminProfileEdit === 'done' &&
        sessionsBeforeProfileEdit > 0 &&
        sessionsAfterProfileEdit === sessionsBeforeProfileEdit &&
        (await authenticates(keptCookie.token)),
      `${adminProfileEdit}; ${sessionsBeforeProfileEdit} session(s) before, ${sessionsAfterProfileEdit} after`,
    )

    const movedEmail = `${PREFIX}-supported-moved@example.test`
    const adminSetEmail = await outcomeOf(
      updateByIDOperation({
        collection: customers,
        data: { email: movedEmail },
        id: supported.id,
        req: await restReq(adminUser),
      }),
    )
    const moved = await payload.findByID({
      collection: 'customers',
      id: supported.id,
      overrideAccess: true,
    })

    check(
      "§34.1d: an admin's REST edit can change a customer's sign-in email",
      adminSetEmail === 'done' && moved.email === movedEmail,
      `${adminSetEmail}, email ${moved.email}`,
    )
  }

  /* ---- §34.1d, R1-18: Payload's own collections are staff-only, set in `onInit` ---- */

  /*
   * `restrictInternalCollections` runs from the real config's `onInit`, which `getPayload` above
   * called. Without it both collections answer `Boolean(user)`, which a signed-in customer satisfies:
   * every refusal below would be a success. Mallory is still an active customer here.
   */
  await denied(
    'R1-18: **a signed-in customer cannot read `payload-locked-documents`**',
    () =>
      payload.find({
        collection: 'payload-locked-documents',
        overrideAccess: false,
        user: malloryUser,
      }),
    ['Forbidden'],
  )

  await denied(
    'R1-18: **a signed-in customer cannot create a `payload-locked-documents` row**',
    () =>
      payload.create({
        collection: 'payload-locked-documents',
        data: {
          globalSlug: `${PREFIX}-customer-lock`,
          user: { relationTo: 'customers', value: mallory.id },
        },
        overrideAccess: false,
        user: malloryUser,
      }),
    ['Forbidden'],
  )

  await denied(
    'R1-18: **a signed-in customer cannot read `payload-preferences`**',
    () =>
      payload.find({ collection: 'payload-preferences', overrideAccess: false, user: malloryUser }),
    ['Forbidden'],
  )

  await denied(
    'R1-18: **a signed-in customer cannot create a `payload-preferences` row**',
    () =>
      payload.create({
        collection: 'payload-preferences',
        data: {
          key: `${PREFIX}-customer-preference`,
          user: { relationTo: 'customers', value: mallory.id },
          value: { planted: true },
        },
        overrideAccess: false,
        user: malloryUser,
      }),
    ['Forbidden'],
  )

  await allowed(
    'R1-18: …while staff can read and create `payload-locked-documents` rows',
    async () => {
      await payload.find({
        collection: 'payload-locked-documents',
        overrideAccess: false,
        user: editorUser,
      })
      await payload.create({
        collection: 'payload-locked-documents',
        data: {
          globalSlug: `${PREFIX}-staff-lock`,
          user: { relationTo: 'users', value: editor.id },
        },
        overrideAccess: false,
        user: editorUser,
      })
    },
  )

  await allowed('R1-18: …and read and create their own `payload-preferences`', async () => {
    await payload.find({
      collection: 'payload-preferences',
      overrideAccess: false,
      user: editorUser,
    })
    await payload.create({
      collection: 'payload-preferences',
      data: {
        key: `${PREFIX}-staff-preference`,
        user: { relationTo: 'users', value: editor.id },
        value: { verified: true },
      },
      overrideAccess: false,
      user: editorUser,
    })
  })

  /* ---- Password policy, on every path ---- */

  await denied(
    'a short password is refused on registration',
    () =>
      payload.create({
        collection: 'customers',
        /*
         * **The Turnstile evidence — Phase 26.** `customers.create` is `verifiedPublicWrite`, so an
         * unauthenticated create without this key is refused *before* validation runs. These two
         * checks are about the **password policy**, so they have to get past the new gate to reach
         * the thing they are testing — otherwise they would keep passing while testing nothing.
         */
        context: { turnstileVerified: true },
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
        context: { turnstileVerified: true },
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
  /* ---- Phase 26: the REST door the registration form's Turnstile is not in front of ---- */

  await denied(
    'an unauthenticated create with no Turnstile evidence is refused — §26.1a at `POST /api/customers`',
    () =>
      payload.create({
        collection: 'customers',
        overrideAccess: false,
        data: {
          email: `${PREFIX}-unverified@example.test`,
          password: 'A-strong-passphrase-9',
          firstName: 'Un',
          lastName: 'Verified',
          accountStatus: 'active',
        },
      }),
    ['Forbidden'],
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
