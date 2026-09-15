import { sql } from '@payloadcms/db-postgres'
import type {
  AccessResult,
  CollectionBeforeOperationHook,
  CollectionSlug,
  PayloadRequest,
  Where,
} from 'payload'
import { combineQueries, executeAccess, validateQueryPaths } from 'payload'

import { bypassesAccessControl } from '@/lib/auth/customer-revision'

/**
 * **A Payload write reads its rows only once it holds their locks** — the concurrency review of
 * 2026-09-15, generalising `Customers.ts`'s sweep-1 fix (finding S02) to the commerce tables.
 *
 * `lib/concurrency/stale-writes.ts` describes the defect: Payload reads a row without a lock, refills
 * every unsent field from that read, and writes the whole row back, so a raw-SQL write that commits
 * in between is undone. The raw writers are all in `lib/checkout/fulfil.ts` — the stock decrement,
 * the payment and refund claims, the promotion count, the bag conversion. Taking `SELECT … FOR …` in
 * `beforeOperation`, after Payload has opened the operation's transaction and before it reads
 * anything, moves the lock in front of the read: a Payload write that meets an uncommitted raw write
 * now waits for it to commit and then reads what it wrote.
 *
 * ### Which rows: the ones the operation's own access rule will permit
 *
 * The same rule `Customers.ts` settled in its recheck, for the same reason. This hook runs before the
 * operation checks access, so it must not act on the request as sent. Unless the call is the Local API
 * with `overrideAccess: true`, the collection's `update` (or `delete`) rule is evaluated here first,
 * exactly as the operation will evaluate it; a caller's `where` goes through the same
 * `validateQueryPaths`; and only the rows the rule allows are locked, by id. An anonymous REST
 * `PATCH /api/orders?where[id][exists]=true` therefore locks nothing before `update` refuses it.
 *
 * ### How strong a lock, and why it differs by table
 *
 * **`FOR NO KEY UPDATE` by default** — exactly the lock the operation's own `UPDATE` takes (it rewrites
 * no key column). Taking it earlier changes *when* the row is locked, not *how*, and between this hook
 * and that `UPDATE` a Payload update takes no other lock, so the order in which one operation acquires
 * its locks is unchanged. It still conflicts with every raw writer it has to wait for — each of those
 * is an `UPDATE` too — and it does not conflict with the key-share lock a foreign-key insert takes, so
 * adding a bag line or an order line referencing a variant does not queue behind an admin save.
 *
 * **`FOR UPDATE` for orders**, because `hooks/orderTransitions.ts` has always taken that strength on
 * the order row inside the operation. Taking the weaker lock here and upgrading there would hold one
 * lock while waiting for a stronger one on the same row, which is a new way to deadlock; taking the
 * stronger one first is the lock the hook already took, only sooner.
 *
 * **Deletes lock only where a collection asks** (orders). A delete writes no stale column, so the lock
 * buys nothing for data; and for a table whose delete cascades into rows a payment holds — a bag or a
 * promotion (`ON DELETE SET NULL` on the order), a variant (the order lines) — locking the parent first
 * would widen the lock-order inversion with `fulfil.ts` (orders first) from one statement to the whole
 * operation.
 *
 * Rows are locked in id order, so two writers of several rows cannot deadlock on each other. Like the
 * customer lock, this is a no-op when there is no transaction to hold the lock in — which on this
 * adapter does not happen.
 */

export type RowLockStrength = 'NO KEY UPDATE' | 'UPDATE'

export type WriteArgs = {
  data?: unknown
  id?: unknown
  overrideAccess?: boolean
  trash?: boolean
  where?: Where
}

type SqlHandle = { execute: (query: unknown) => Promise<{ rowCount?: number; rows?: unknown[] }> }

/**
 * The raw handle of the operation's transaction, or `null` when the request carries none.
 *
 * `payload` is taken separately because checkout builds a bare `{ transactionID }` request, which has
 * no `payload` on it until some Local API call has completed it.
 */
export async function transactionOf(
  req: PayloadRequest | undefined,
  payload = req?.payload,
): Promise<SqlHandle | null> {
  const raw = req?.transactionID
  const transactionID = raw instanceof Promise ? await raw : raw

  if (transactionID === undefined || transactionID === null || !payload) {
    return null
  }

  return (
    (payload.db as unknown as { sessions?: Record<string, { db: SqlHandle }> }).sessions?.[
      String(transactionID)
    ]?.db ?? null
  )
}

/**
 * **Lock the rows this `update` or `delete` may write, and return their ids.**
 *
 * The ids are returned whether or not a lock could be taken, so a caller that needs to read those rows
 * next (the variant stock rule) reads the same set.
 */
export async function lockRowsForWrite(
  req: PayloadRequest,
  target: {
    args: WriteArgs
    collection: CollectionSlug
    operation: 'delete' | 'update'
    strength: RowLockStrength
    table: string
  },
): Promise<number[]> {
  const ids = await rowsThisWriteMayTouch(target.collection, target.operation, target.args, req)
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))].sort((a, b) => a - b)
  const transaction = await transactionOf(req)

  if (unique.length > 0 && transaction) {
    await transaction.execute(
      sql`SELECT "id" FROM ${sql.identifier(target.table)}
          WHERE "id" IN (${sql.join(
            unique.map((id) => sql`${id}`),
            sql`, `,
          )})
          ORDER BY "id"
          ${sql.raw(target.strength === 'UPDATE' ? 'FOR UPDATE' : 'FOR NO KEY UPDATE')}`,
    )
  }

  return unique
}

/**
 * **The `beforeOperation` hook**, for a collection whose rows a raw-SQL writer also changes.
 *
 * `update` is always locked, at the strength given; `delete` only when a strength is given for it. See
 * the module docblock for which strength each table uses and why.
 */
export function lockRowsBeforeWrite(options: {
  collection: CollectionSlug
  delete?: RowLockStrength
  table: string
  update: RowLockStrength
}): CollectionBeforeOperationHook {
  return async ({ args, operation, req }) => {
    if (operation === 'update') {
      await lockRowsForWrite(req, {
        args: args as WriteArgs,
        collection: options.collection,
        operation,
        strength: options.update,
        table: options.table,
      })
    }

    if (operation === 'delete' && options.delete) {
      await lockRowsForWrite(req, {
        args: args as WriteArgs,
        collection: options.collection,
        operation,
        strength: options.delete,
        table: options.table,
      })
    }

    return args
  }
}

/**
 * **The rows an `update` or `delete` will actually be allowed to write** — decided before the
 * operation decides, but by the same rule. Ported from `Customers.ts` (`rowsThisWriteMayTouch`), which
 * keeps its own copy because its lock also stamps a revision marker.
 *
 * - **The Local API with `overrideAccess: true`** is server code: it locks the id it names, or the
 *   rows its own `where` matches.
 * - **Everyone else** has the collection's access rule evaluated as the operation will evaluate it. A
 *   refusal locks nothing and leaves the operation to refuse; a `Where` result is combined with the
 *   request; a caller's `where` is validated before it is used.
 *
 * An `update` that sets `deletedAt` is a move to the trash, and Payload holds it to the `delete` rule
 * as well, so this does too. Trashed rows are excluded unless the call asks for them, as the operation
 * excludes them.
 */
async function rowsThisWriteMayTouch(
  collection: CollectionSlug,
  operation: 'delete' | 'update',
  args: WriteArgs,
  req: PayloadRequest,
): Promise<number[]> {
  const collectionConfig = req.payload.collections[collection].config
  const trusted = bypassesAccessControl({
    overrideAccess: args.overrideAccess,
    payloadAPI: req.payloadAPI,
  })
  const hasId = args.id !== undefined && args.id !== null
  const id = hasId ? Number(args.id) : null

  if (hasId && !Number.isInteger(id)) {
    return []
  }

  let access: AccessResult = true

  if (!trusted) {
    access = await executeAccess(
      { data: args.data, disableErrors: true, id: id ?? undefined, req },
      operation === 'update' ? collectionConfig.access.update : collectionConfig.access.delete,
    )

    const trashing =
      operation === 'update' &&
      typeof args.data === 'object' &&
      args.data !== null &&
      (args.data as { deletedAt?: unknown }).deletedAt != null

    if (access && trashing) {
      const deleteAccess = await executeAccess(
        { data: args.data, disableErrors: true, id: id ?? undefined, req },
        collectionConfig.access.delete,
      )

      access = !deleteAccess
        ? false
        : access === true
          ? deleteAccess
          : combineQueries(access, deleteAccess)
    }

    if (!access) {
      return []
    }
  }

  let where: Where

  if (id !== null) {
    if (access === true) {
      return [id]
    }

    where = combineQueries({ id: { equals: id } }, access)
  } else {
    if (!args.where) {
      return []
    }

    if (!trusted) {
      await validateQueryPaths({ collectionConfig, overrideAccess: false, req, where: args.where })
    }

    where = combineQueries(args.where, access)
  }

  const trashEnabled = Boolean(collectionConfig.trash)

  const { docs } = await req.payload.db.find({
    collection,
    limit: 0,
    pagination: false,
    req,
    select: { id: true },
    where: args.trash || !trashEnabled ? where : { and: [where, { deletedAt: { exists: false } }] },
  })

  return docs.map((doc) => Number(doc.id))
}
