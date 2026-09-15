/**
 * **The decisions behind the stale-write locks** — the concurrency review of 2026-09-15.
 *
 * ### The defect these guard against
 *
 * A Payload update is read-modify-write, and none of it is locked. `updateByID` reads the row
 * (`collections/operations/updateByID.js`; a bulk `update` reads every matched row first), the field
 * pass refills every field the request did not send — including fields closed by field access such as
 * `update: nobodyField` — from that read (`fields/hooks/beforeValidate/promise.js`,
 * `getFallbackValue`), and the Postgres adapter then writes **every column** of the merged document
 * (`@payloadcms/drizzle` `upsertRow`: *"replaces the entire row"*). Postgres locks the row only at that
 * final `UPDATE`. So any Payload write whose read came before a concurrent raw-SQL write committed, and
 * whose `UPDATE` came after, puts the old value back — a sale's stock decrement, a webhook's `paid`, a
 * code's redemption count, a bag's `converted`.
 *
 * There are two windows, and they need different answers:
 *
 * 1. **The operation window** — Payload's own read versus a transaction that has not committed yet.
 *    Closed by taking the row lock *before* the read (`payload/hooks/lockRowsForWrite.ts`), so the
 *    read waits for the other writer and sees what it wrote. That is a lock and needs no rule here.
 * 2. **The form window** — the admin panel posts every field with the value it had when the page was
 *    opened (`@payloadcms/ui` `Form`, `reduceFieldsToValues`). No lock can help: the stale value is in
 *    the request, sent minutes after the read that produced it. Fields the browser may not write are
 *    safe, because field access deletes the key and the post-lock read refills it. The rest need a
 *    rule, and the rules are below.
 *
 * Everything here is pure, so `tests/unit/stale-writes.test.ts` pins it; `pnpm verify:concurrency`
 * proves the locks and the hooks around it against Postgres.
 */

/* -------------------------------------------------------------------------------------------------
 * Variant stock — the form window on `inventoryQuantity`
 * ---------------------------------------------------------------------------------------------- */

/**
 * The hidden, virtual field on `product-variants` that carries **the stock the editor's page was
 * opened with**. Filled on every read from `inventoryQuantity`, so the admin form holds it beside the
 * visible Stock input and posts it back on save; never stored (`virtual: true` has no column).
 */
export const STOCK_WHEN_OPENED = 'stockWhenOpened'

/**
 * A number as Payload's field pass will read it: a finite number, or a numeric string (REST form
 * data), parsed the way `beforeValidate` parses one. Anything else — absent, empty, `null`, not a
 * number — is `null`, which the rule reads as "not sent".
 */
export function readSubmittedNumber(value: unknown): null | number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = parseFloat(value.trim())

    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

export type StockEditDecision =
  /** Write what the request says — or, when it says nothing about stock, what the row already holds. */
  | { kind: 'asSent' }
  /** The editor did not touch stock: drop the submitted figure so the live one is kept. */
  | { kind: 'keepLive' }
  /** The editor changed stock that has itself changed since they opened the page. */
  | { kind: 'conflict'; live: number; loaded: number }

/**
 * **What a save does with the stock it carries** — optimistic concurrency on one column.
 *
 * `submitted` is the `inventoryQuantity` in the request, `loaded` the {@link STOCK_WHEN_OPENED} value
 * in the same request, and `live` the row's stock read under its lock.
 *
 * - **No `loaded` value** — a script, the seed, a harness, a REST client that never read the form's
 *   hidden field: the request is taken at its word. An `inventoryQuantity` it sends is a stock count
 *   and is written; one it does not send is refilled from the live row. That is what an explicit
 *   Local API or REST write of a number has always meant, and it is the only reading available to a
 *   caller that cannot say what it last saw.
 * - **`submitted === loaded`** — the editor left Stock as the page showed it. Whatever the row holds
 *   now is kept, so a sale that landed while the page was open is not undone by a save of the price.
 * - **`submitted !== loaded`, and the row still holds `loaded`** — a deliberate recount against an
 *   unchanged figure. Written.
 * - **`submitted !== loaded`, and the row has moved** — the editor typed a count over a number that
 *   is no longer true, and neither figure can be trusted to be the right one: refused, so they reload
 *   and count again.
 *
 * `live === null` means the row was not found (or not permitted); the operation itself says so, so
 * the rule steps aside.
 */
export function decideStockEdit(input: {
  live: null | number
  loaded: null | number
  submitted: null | number
}): StockEditDecision {
  const { live, loaded, submitted } = input

  if (loaded === null || submitted === null) {
    return { kind: 'asSent' }
  }

  if (submitted === loaded) {
    return { kind: 'keepLive' }
  }

  if (live === null || live === loaded) {
    return { kind: 'asSent' }
  }

  return { kind: 'conflict', live, loaded }
}

/** The refusal, on the Stock field, in words that tell the editor what to do next. */
export function stockChangedCopy(conflict: { live: number; loaded: number }): string {
  return (
    `Stock for this size changed while you were editing (a sale may have happened): it was ` +
    `${conflict.loaded} when you opened this page and is ${conflict.live} now. Reload and enter the ` +
    `new count.`
  )
}

/* -------------------------------------------------------------------------------------------------
 * Orders — a cancellation of a paid order
 * ---------------------------------------------------------------------------------------------- */

/**
 * **A paid order is not cancelled from the panel or the REST API.**
 *
 * The fulfilment machine lets `unfulfilled` and `processing` move to `cancelled` whatever the payment
 * says, because cancelling an order nobody paid for is ordinary. For a *paid* order that select box
 * would record a cancellation while the customer's money stays taken — a cancellation of a paid order
 * is a refund, and a refund starts in Stripe and arrives signed (the Orders Stripe tab). A refunded
 * order is already settled: `processing` requires `paid`, so it will not be picked either way.
 *
 * It is also the form window on the payment axis. The payment columns are closed to the browser and
 * refilled from the locked row, so a stale form cannot un-pay an order; but the *decision* to cancel
 * was made on the page as it was opened, and a payment that landed since would turn "cancel this
 * abandoned checkout" into "cancel a paid order". Deciding against the locked row's payment refuses
 * exactly that.
 *
 * **Only requests that are not the Local API.** Server code that cancels — `fulfil.ts` on an expired
 * session — never meets a paid order there (its claim requires an unpaid one), and a server-side
 * cancellation of a paid order would be a deliberate flow with its own refund, which this rule should
 * not pre-empt. `pnpm verify:admin` also drives a paid `processing → cancelled` through the Local API
 * as an allowed edge of the machine, and that stays true.
 */
export function refusesPaidCancellation(input: {
  payment: string
  to: string
  viaLocalApi: boolean
}): boolean {
  return (
    input.to === 'cancelled' &&
    (input.payment === 'paid' || input.payment === 'refunded') &&
    !input.viaLocalApi
  )
}

export const PAID_CANCELLATION_COPY =
  'This order has been paid for, so it is not cancelled here: cancelling a paid order means giving ' +
  'the money back, and a refund starts in Stripe (see the Stripe tab). A refunded order is already ' +
  'settled and will not be picked. If the payment arrived while this page was open, reload to see it.'

/* -------------------------------------------------------------------------------------------------
 * Carts — `converted` is history
 * ---------------------------------------------------------------------------------------------- */

/**
 * **A converted bag does not become active again.**
 *
 * `converted` is written by the payment (`fulfil.ts`, raw SQL) and means the bag became an order. A
 * write that moves it back — an admin form opened before the payment, posting the `active` it loaded
 * — would reopen a paid bag for new lines and a second checkout. Nothing in the application reopens a
 * bag, so the rule holds for every caller. A write that does not change the status (the ordinary case,
 * with the status refilled from the locked row) is not a move.
 */
export function reopensConvertedBag(input: { from: unknown; to: unknown }): boolean {
  return input.from === 'converted' && input.to !== undefined && input.to !== 'converted'
}

export const CONVERTED_BAG_COPY =
  'This bag has already been paid for and turned into an order, so it cannot be made active again. ' +
  'If this page was opened before the payment, reload it.'
