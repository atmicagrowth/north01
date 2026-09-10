import type { Access, FieldAccess, TypedUser } from 'payload'

import type { Customer, User } from '../../payload-types'

/**
 * **The access vocabulary.** Plan §7.1a–§7.1d expressed once, here, and applied by name in every
 * collection rather than restated as an inline closure twenty-three times.
 *
 * Phase 6 left every collection on Payload's default — `Boolean(user)`, which refuses everyone
 * without a session — and recorded that opening it is the first thing Phase 7 does (notes §1.11.9).
 * This is that opening, and it is deliberately narrow: each rule below names the smallest set of
 * requests that must succeed, and everything else fails.
 *
 * ### The three roles, and where each one lives
 *
 * | §7.1a role | Where it is | How it is recognised |
 * |---|---|---|
 * | Customer | the `customers` collection | `user.collection === 'customers'` |
 * | Editor | `users.role === 'editor'` | `staffUser(user)?.role` |
 * | Admin | `users.role === 'admin'` | `staffUser(user)?.role` |
 *
 * Customer is a *collection*, not a role column — decision **D-21**. That is what makes §7.1b's
 * *"customers may NOT access Payload Admin"* structural: `admin.user` points at `users`, so a
 * customer has nowhere to sign in to. Nothing below has to defend that boundary, and nothing below
 * could re-open it by accident.
 *
 * ### Why the discriminator is a cast
 *
 * `TypedUser` is generated as `Customer | User`, and Payload does not put `collection` into that
 * generated shape even though the auth layer always sets it on the object bound to `req.user`
 * (`auth/strategies/jwt.js` assigns `user.collection = collection.config.slug` before returning).
 * Narrowing on a *field* instead — `'role' in user` — would be a structural guess that silently
 * changes meaning the day a customer field is named `role`. The runtime fact is the collection, so
 * the discriminator reads the collection.
 */

/** The staff roles of §7.1c and §7.1d. Editor first: it is the default for a new account. */
export const STAFF_ROLE_OPTIONS = [
  { label: 'Editor', value: 'editor' },
  { label: 'Admin', value: 'admin' },
] as const

export type StaffRole = (typeof STAFF_ROLE_OPTIONS)[number]['value']

/** The `customers.accountStatus` vocabulary — the §7.1e "account is disabled" edge case. */
export const ACCOUNT_STATUS_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Disabled', value: 'disabled' },
] as const

export type AccountStatus = (typeof ACCOUNT_STATUS_OPTIONS)[number]['value']

/** What Payload actually binds to `req.user`: the document, plus the collection it came from. */
type AuthenticatedUser = TypedUser & { collection?: string }

/**
 * The signed-in staff account, or `null` for a customer, an anonymous request, or server code.
 *
 * Returns the document rather than a boolean so a caller can go on to read `role` without a second
 * narrowing step.
 */
export function staffUser(user: null | TypedUser | undefined): null | User {
  if (!user) {
    return null
  }

  return (user as AuthenticatedUser).collection === 'users' ? (user as User) : null
}

/**
 * The signed-in **and active** customer, or `null`.
 *
 * The `accountStatus` test is what makes disabling an account mean something to data access rather
 * than only to login. Disabling also revokes the account's sessions (see `Customers.ts`), so in
 * practice a disabled customer is signed out within a request — but a rule that depends on the
 * revocation having already happened is a rule with a race in it. Both, and neither alone.
 */
export function activeCustomer(user: null | TypedUser | undefined): Customer | null {
  if (!user || (user as AuthenticatedUser).collection !== 'customers') {
    return null
  }

  const customer = user as Customer

  return customer.accountStatus === 'active' ? customer : null
}

export function isAdminUser(user: null | TypedUser | undefined): boolean {
  return staffUser(user)?.role === 'admin'
}

/* -------------------------------------------------------------------------------------------------
 * Collection-level rules
 * ---------------------------------------------------------------------------------------------- */

/**
 * Public. The storefront reads this without a session.
 *
 * Used only on collections that carry nothing private *at all* — never as a shortcut for "the
 * storefront needs it", because the storefront reads through the same rules as everyone else and
 * `publishedOnly` is the answer for anything with a draft state.
 */
export const anyone: Access = () => true

/**
 * Nobody, through the API. Not even an admin.
 *
 * For the two operations that must only ever happen server-side: creating an order, and creating an
 * order line. Plan §17.1a and the standing rule that the browser is never authoritative mean an
 * order is written by the checkout and by the Stripe webhook, both of which run in server code with
 * the Local API's default `overrideAccess: true` and are unaffected by this. What it forbids is
 * `POST /api/orders` — a request that could only ever be someone inventing a purchase.
 */
export const nobody: Access = () => false

/** Signed-in staff — editor or admin. §7.1c's merchandising and content remit. */
export const isStaff: Access = ({ req: { user } }) => staffUser(user) !== null

/** Admin only. §7.1d, and the deletions and financial fields §7.1c withholds from editors. */
export const isAdmin: Access = ({ req: { user } }) => isAdminUser(user)

/**
 * **The public-read rule for everything an editor publishes.**
 *
 * Staff see every document, including drafts, because that is what the admin panel is for. Everyone
 * else — anonymous or customer — gets a `Where` rather than a boolean, so Payload narrows the query
 * instead of refusing it: a draft is not *forbidden*, it does not *exist*, which is the correct
 * answer to "does this product page 404".
 *
 * `publishedAt` is deliberately **not** part of this. A scheduled document is published with a
 * future date, and whether a listing hides it is a query concern belonging to the page that renders
 * the listing (feature matrix §12) — not an access rule. Making it one would mean a scheduled
 * campaign could not be reached by its own URL for review, and would hide the row from the editor's
 * own storefront preview without explaining why.
 *
 * `statusPath` may traverse a relationship, which is how a row with no status of its own inherits
 * one: a product variant is public exactly when its product is, and `publishedOn('product.status')`
 * says so without adding a second column that could disagree with the first.
 */
export const publishedOn =
  (statusPath: string): Access =>
  ({ req: { user } }) => {
    if (staffUser(user)) {
      return true
    }

    return { [statusPath]: { equals: 'published' } }
  }

export const publishedOnly: Access = publishedOn('status')

/**
 * Records a customer owns: their addresses, their wishlist, their bag, their orders.
 *
 * §7.1b in one function — *"customers may read their own orders"*, *"may NOT read another
 * customer's order"*. The result is a `Where` constrained to the requester's own id, so a cross-user
 * read does not 403, it returns nothing; and because Payload applies the same constraint to `update`
 * and `delete`, a request for someone else's row is a "not found" rather than a "forbidden", which
 * is also the answer that leaks least.
 *
 * `path` may traverse a relationship — `'cart.customer'`, `'order.customer'` — which is how a cart
 * line inherits the ownership of its cart without duplicating the column. Payload's Postgres adapter
 * resolves the dotted path to a join.
 */
export const ownedByCustomer =
  (path: string): Access =>
  ({ req: { user } }) => {
    if (staffUser(user)) {
      return true
    }

    const customer = activeCustomer(user)

    return customer ? { [path]: { equals: customer.id } } : false
  }

/**
 * A customer acting on their own records, with no ownership `Where` because there is no row yet.
 *
 * Ownership of a *new* row cannot be checked by a query, so this only asks whether the requester is
 * an active customer, and `enforceCustomerOwnership` is what makes the row theirs. The two are
 * always used together; either alone is a hole.
 */
export const isActiveCustomer: Access = ({ req: { user } }) => activeCustomer(user) !== null

/** Staff, or an active customer. For the collections both may write to. */
export const isStaffOrActiveCustomer: Access = ({ req: { user } }) =>
  staffUser(user) !== null || activeCustomer(user) !== null

/**
 * **The key a Server Action sets once it has verified a Turnstile challenge.**
 *
 * Local API only. Payload populates `req.context` from the `context` option on a *local* call —
 * `createLocalReq` is the only thing that writes it — and the REST route never sets it. That
 * asymmetry is the whole mechanism: a value the network cannot supply.
 */
export const VERIFIED_PUBLIC_WRITE = 'turnstileVerified' as const

/**
 * **Plan §26.1a, closed on the door the form does not use — Phase 26, second sweep.**
 *
 * Registration is guarded by Turnstile in `lib/auth/actions.ts`. It was **not** guarded at
 * `POST /api/customers`, because `create` was `() => true` and Payload's REST surface is public.
 * A bot never had to load the form: the same write was one unauthenticated request away, with no
 * challenge, no widget and no round trip to Cloudflare.
 *
 * That is exactly the shape §26.1a warns about — *"client-side widget alone is not security"* — one
 * level further out than the sentence is usually read. Verifying in the Server Action is necessary
 * and, on its own, still not sufficient: what matters is whether **every** path to the write is
 * covered.
 *
 * ### Why a context flag rather than staff-only plus `overrideAccess: true`
 *
 * `register` deliberately writes with `overrideAccess: false`, and `Customers.ts` records why: *"the
 * storefront gets no privilege the REST API does not have… one rule, auditable in one file."* That
 * is worth keeping. Switching to `overrideAccess: true` would delete the property rather than
 * enforce it.
 *
 * So the rule itself gets stricter, and stays one rule: **a request that has passed verification, or
 * staff.** The storefront still has no privilege the REST API lacks — the REST API simply cannot
 * produce the evidence, because `context` is not part of an HTTP request.
 *
 * When Turnstile is unconfigured `verifyTurnstile` skips and the action sets the flag anyway. That
 * is correct and is the point: the flag means *"this went through the guard"*, not *"a challenge was
 * solved"*. The guard is what decides whether a challenge was required.
 */
export const verifiedPublicWrite: Access = ({ req }) =>
  staffUser(req.user) !== null || req.context?.[VERIFIED_PUBLIC_WRITE] === true

/* -------------------------------------------------------------------------------------------------
 * Field-level rules
 * ---------------------------------------------------------------------------------------------- */

/**
 * Field access denies by *removing the field*, not by failing the request — so these are how a
 * privileged column survives an otherwise-permitted write. `accountStatus` is the clearest case: a
 * customer may update their own profile, and must not be able to re-enable a disabled account by
 * sending one extra key.
 */
export const isStaffField: FieldAccess = ({ req: { user } }) => staffUser(user) !== null

export const isAdminField: FieldAccess = ({ req: { user } }) => isAdminUser(user)

/** Read-only through the API for everyone. Written by server code, past access control. */
export const nobodyField: FieldAccess = () => false
