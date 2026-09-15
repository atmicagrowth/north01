/**
 * **The two small decisions behind the customer row locks** — sweep 1, finding S02, and its recheck.
 *
 * `payload/collections/Customers.ts` does the locking and the SQL; what is decided here is pure, so
 * `tests/unit/customer-revision.test.ts` pins it without a database. `pnpm verify:access` is what
 * proves the SQL around it against Postgres.
 */

/**
 * The `payload_kv` key prefix for a customer's **revision marker**: `customer-revision:<id>`.
 *
 * Every write that takes a customer row's lock also stamps this key, in the same statement and the
 * same transaction, with that transaction's id. Payload's key-value table is used because the marker
 * must live *outside* the `customers` row: a sign-in writes that whole row back from what it read, so
 * anything stored on the row itself is exactly what a stale sign-in would overwrite.
 */
export const CUSTOMER_REVISION_KEY_PREFIX = 'customer-revision:'

/**
 * **Does this call skip access control?** Only the Local API with `overrideAccess: true` does.
 *
 * Payload's REST handlers never pass `overrideAccess` at all, so a test for `overrideAccess === false`
 * classified every REST request as trusted server code — which is how an anonymous `PATCH` was able
 * to lock the whole table before `update` refused it. An absent flag means access control runs, and
 * so does anything that did not come through the Local API, whatever flag it carries.
 */
export function bypassesAccessControl(call: {
  overrideAccess?: boolean | undefined
  payloadAPI?: string | undefined
}): boolean {
  return call.payloadAPI === 'local' && call.overrideAccess === true
}

/** What a sign-in saw before it read the account: the row it will find, and that row's marker. */
export type RevisionSnapshot = { id: number; revision: null | string } | null

/**
 * **Was this sign-in overtaken?** True unless the account it signed in to is the one the snapshot
 * found and its marker has not moved since.
 *
 * `current` is read inside the sign-in's own transaction after its write holds the row lock, so no
 * locking writer can commit in between; a marker that differs from the snapshot means one committed
 * after the snapshot, which was taken before the sign-in read the row. No snapshot, or a snapshot of
 * a different row, cannot vouch for anything and fails closed.
 */
export function signInOvertaken(
  before: RevisionSnapshot | undefined,
  signedInId: number | string,
  current: null | string,
): boolean {
  if (!before || before.id !== Number(signedInId)) {
    return true
  }

  return before.revision !== current
}
