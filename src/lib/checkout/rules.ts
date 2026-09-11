import { toMinorAmount, toWholeCount } from '@/lib/money'

/**
 * **Plan §17's decisions, as pure functions.**
 *
 * The phase prompt asks for *"tests for webhook idempotency and impossible payment states"* by name,
 * which is only possible if those decisions are reachable without Stripe, a network or a database.
 * Everything here is: the order state machine (§17.1c), the two idempotency barriers (§17.1d), the
 * preflight failure vocabulary (§17.1a), and the rule that decides whether a paid order can actually
 * be fulfilled (§17.1f).
 *
 * `lib/checkout/*.ts` next door does the reads, the writes, the Stripe calls and the transaction.
 * None of them decides anything.
 *
 * ---
 *
 * ### The rule the whole phase exists to enforce
 *
 * `AGENTS.md`: *"Only a signature-verified Stripe webhook marks an order paid. Reaching the success
 * page is not payment."* Nothing in this module can be reached from a browser, and nothing in it
 * takes an amount, a total or a status from a request. The only inputs are what the server already
 * knows and what Stripe has cryptographically signed.
 */

/* -------------------------------------------------------------------------------------------------
 * The state machine — plan §17.1c
 * ---------------------------------------------------------------------------------------------- */

/** §17.1c's allowed states, in the plan's own order. `Orders.paymentStatus` holds the payment half. */
export type PaymentStatus =
  | 'cancelled'
  | 'checkout_started'
  | 'draft'
  | 'paid'
  | 'payment_failed'
  | 'pending_payment'
  | 'refunded'

/**
 * **Which transitions are legal.**
 *
 * §17.1c lists the states and not the edges, so the edges are a decision. Three properties are worth
 * stating because each rules out a class of bug:
 *
 * 1. **`paid` is terminal for the payment half.** Nothing here moves an order out of `paid` except a
 *    refund. A duplicate `checkout.session.completed` therefore cannot re-pay an order, and a late
 *    `payment_intent.payment_failed` for a superseded attempt cannot un-pay one — which is §17.1d's
 *    second barrier expressed as data rather than as a check somebody has to remember to write.
 * 2. **`cancelled` and `payment_failed` are not terminal.** A customer whose card is declined may try
 *    again in the same session, and Stripe will send a second `checkout.session.completed`. Refusing
 *    that transition would lose a real payment.
 * 3. **Nothing may reach `paid` from `draft`.** A draft has never been through preflight, so an order
 *    that arrived at `paid` from `draft` is one whose totals were never recalculated.
 */
const ALLOWED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  cancelled: ['checkout_started', 'pending_payment', 'paid'],
  checkout_started: ['pending_payment', 'paid', 'payment_failed', 'cancelled'],
  draft: ['checkout_started', 'cancelled'],
  paid: ['refunded'],
  payment_failed: ['checkout_started', 'pending_payment', 'paid', 'cancelled'],
  /*
   * `checkout_started` since Phase 36 (R1-06): a customer who comes back from Stripe and checks out
   * again reuses this order, once preflight has expired the session it was waiting on.
   */
  pending_payment: ['checkout_started', 'paid', 'payment_failed', 'cancelled'],
  refunded: [],
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/**
 * Whether this order still needs to be finalised as paid.
 *
 * **§17.1d's second barrier.** The first is the unique event id, which stops the *same* event being
 * processed twice. This stops a *different* event driving the same transition — a
 * `checkout.session.completed` and a `checkout.session.async_payment_succeeded` can both describe
 * one payment, and a handler that acted on both would decrement inventory twice from two perfectly
 * legitimate, non-duplicate events. (`payment_intent.succeeded` is **not** handled — Phase 36
 * corrected docblocks that said it was.)
 *
 * An order that is already `paid` is not owed anything, and saying so here rather than at the call
 * site means every path that finalises has to ask.
 */
export function needsPaymentFinalisation(status: PaymentStatus): boolean {
  return status !== 'paid' && status !== 'refunded' && canTransition(status, 'paid')
}

/**
 * **Every status a given status is reachable *from*.**
 *
 * Exported because every payment transition in `fulfil.ts` is a single conditional SQL statement, and
 * each one needs its own list in the `WHERE`. Deriving them here rather than writing them out in SQL
 * is what stops the two from drifting: add a state to the machine and the statements follow, instead
 * of silently refusing to move orders that are in it.
 *
 * The conditional `UPDATE` is not decoration. A `canTransition` check followed by a write is a read
 * and then a write, and Phase 17's sweeps established what that costs on this table: two events
 * arriving at once both read the old status and both act on it. The failure case is not hypothetical
 * — a `payment_intent.payment_failed` for a superseded attempt, racing the `checkout.session.completed`
 * that paid the order, would read `pending_payment`, find the transition legal, and write
 * `payment_failed` over a payment that had just succeeded. The machine forbids `paid → payment_failed`
 * and the read-then-write never asked it about the state the row was actually in.
 */
export function statusesThatCanReach(to: PaymentStatus): readonly PaymentStatus[] {
  return (Object.keys(ALLOWED_TRANSITIONS) as PaymentStatus[]).filter((from) =>
    canTransition(from, to),
  )
}

/**
 * **Every status from which an order may still become paid**, derived from the machine above.
 *
 * Identical to `statusesThatCanReach('paid')` — `needsPaymentFinalisation` adds only the exclusions
 * the machine already makes, since neither `paid` nor `refunded` has an edge to `paid`. Kept as its
 * own name because `fulfil.ts` reads better asking for the finalisable set than for a graph query,
 * and because the harness asserts the two agree.
 */
export const FINALISABLE_STATUSES: readonly PaymentStatus[] = (
  Object.keys(ALLOWED_TRANSITIONS) as PaymentStatus[]
).filter(needsPaymentFinalisation)

/* -------------------------------------------------------------------------------------------------
 * Preflight — plan §17.1a
 * ---------------------------------------------------------------------------------------------- */

/**
 * Why checkout cannot proceed. One member per way the eleven steps can fail, because a customer who
 * is stopped deserves to know which thing to fix and the harness should assert the *decision* rather
 * than the wording.
 */
export type PreflightFailure =
  | 'addressUnsupported'
  | 'alreadyPaid'
  | 'checkoutFailed'
  | 'emptyCart'
  | 'invalidAddress'
  | 'lineUnavailable'
  | 'noShippingMethod'
  | 'promotionInvalid'
  | 'sessionExpired'
  | 'stripeUnconfigured'
  | 'taxUnavailable'
  | 'totalMismatch'

export const PREFLIGHT_COPY: Record<PreflightFailure, string> = {
  addressUnsupported: 'We cannot deliver to that address.',
  /*
   * Phase 36 (R1-01): the previous Stripe checkout for this bag was completed — paid, or a bank
   * payment still clearing. Rewriting the order now would re-price something already bought.
   */
  alreadyPaid:
    'This bag has already been paid for, or its payment is still being processed. Check your email before trying again.',
  /* Phase 36 (R1-03): anything unexpected, instead of an error page on the last click. */
  checkoutFailed:
    'Something went wrong before you were sent to payment, and nothing was charged. Please try again in a moment.',
  emptyCart: 'Your bag is empty.',
  invalidAddress: 'Check the delivery address — something is missing.',
  lineUnavailable:
    'Something in your bag is no longer available. Your bag has been updated — please review it.',
  noShippingMethod: 'No delivery option is available for that address.',
  promotionInvalid: 'Your discount code is no longer valid. Remove it to continue.',
  sessionExpired: 'Your session has ended. Sign in to continue — your bag is saved.',
  stripeUnconfigured: 'Payment is not available right now. Please try again shortly.',
  taxUnavailable: 'We could not calculate tax just now. Please try again in a moment.',
  totalMismatch: 'Your bag changed while you were checking out. Please review it.',
}

/**
 * **The total, recomputed from parts the server owns.**
 *
 * §17.1b: *"Never accept a client-provided total. Use trusted server-derived values."* This function
 * is the only place a total is produced for Stripe, it takes four numbers the server calculated, and
 * there is no parameter through which a browser could reach it.
 *
 * Order matters: the discount comes off the goods, then delivery and tax are added. A discount that
 * could reach delivery would let a large enough code make a shop pay to send a parcel.
 */
export function orderTotalMinor(parts: {
  discountMinor: number
  shippingMinor: number
  subtotalMinor: number
  taxMinor: number
}): number {
  const goods = Math.max(0, toMinorAmount(parts.subtotalMinor) - toMinorAmount(parts.discountMinor))

  return goods + toMinorAmount(parts.shippingMinor) + toMinorAmount(parts.taxMinor)
}

/* -------------------------------------------------------------------------------------------------
 * Inventory — plan §17.1f
 * ---------------------------------------------------------------------------------------------- */

export type StockLine = {
  quantity: number
  /** Live stock, read inside the same transaction that will write it. */
  stock: number
  variantId: number
}

export type StockOutcome = {
  /** Lines that cannot be met, with how many were actually available. */
  short: { available: number; quantity: number; variantId: number }[]
  /** What each variant's inventory should become. Only meaningful when `short` is empty. */
  decrements: { quantity: number; variantId: number }[]
  ok: boolean
}

/**
 * **§17.1f: two customers may buy the last unit.**
 *
 * > *"At order finalization: re-check inventory transactionally. Atomically decrement or otherwise
 * > reserve/commit stock. If stock is unavailable, do not mark an impossible order as fulfilled."*
 *
 * The decision is all-or-nothing: if **any** line cannot be met, none is decremented. A partially
 * fulfilled order is a worse outcome than a flagged one — the customer has paid for a set of things
 * and shipping some of them silently is a decision nobody made, whereas an order that cannot be met
 * is a human problem with a human answer, which is what §17.1f's *"refund/exception path"* is for.
 *
 * The plan's own preference is honoured: stock moves **only after confirmed payment**, never when
 * something is added to a bag. That means the race is real and this is where it is resolved, rather
 * than being hidden by reserving stock nobody has paid for.
 */
export function planStockDecrements(lines: StockLine[]): StockOutcome {
  const short: StockOutcome['short'] = []
  const decrements: StockOutcome['decrements'] = []

  /* Two lines for one variant would each pass a naive check and fail together. Sum first. */
  const wanted = new Map<number, number>()

  for (const line of lines) {
    wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + toWholeCount(line.quantity))
  }

  const available = new Map<number, number>()

  for (const line of lines) {
    available.set(line.variantId, toWholeCount(line.stock))
  }

  for (const [variantId, quantity] of wanted) {
    const stock = available.get(variantId) ?? 0

    if (quantity > stock) {
      short.push({ available: stock, quantity, variantId })
    } else {
      decrements.push({ quantity, variantId })
    }
  }

  return { decrements: short.length > 0 ? [] : decrements, ok: short.length === 0, short }
}

/* -------------------------------------------------------------------------------------------------
 * Webhook events — plan §17.1d and §17.1h
 * ---------------------------------------------------------------------------------------------- */

/**
 * The event types this application acts on.
 *
 * Everything else is **acknowledged and recorded as ignored**, which §17.1h requires: *"Unknown
 * events should be safely acknowledged/logged without crashing the webhook handler."* A Stripe
 * account emits dozens of types; treating an unrecognised one as an error would make the endpoint
 * fail on events that are none of its business, and Stripe would retry them forever.
 */
export const HANDLED_EVENT_TYPES = [
  /*
   * §18.1b's `PAID → REFUNDED`, added in Phase 18. A refund is a payment fact and arrives the same
   * way every other one does: signed by Stripe, never typed into the panel. Note that a `charge`
   * object carries the *charge's* metadata rather than the Checkout Session's, so this is the event
   * that made `applyStripeEvent` resolve an order by payment intent as well as by reference.
   */
  'charge.refunded',
  'checkout.session.async_payment_failed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.payment_failed',
] as const

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number]

export function isHandledEventType(type: string): type is HandledEventType {
  return (HANDLED_EVENT_TYPES as readonly string[]).includes(type)
}

/**
 * **What an event asks of the order** — Phase 36, audit R1-05.
 *
 * Until Phase 36 this was decided by the event *type* alone, so `checkout.session.completed` meant
 * paid. It does not: Stripe sends `completed` when the customer finishes the Checkout page, and the
 * session's own `payment_status` says whether money has actually moved. For a card it is `paid`; for
 * a delayed method (ACH, SEPA, Bacs) it is `unpaid`, and the money settles — or does not — days later
 * as `async_payment_succeeded` or `async_payment_failed`. Acting on the type shipped goods for a
 * payment that could still fail, and the state machine then refused the failure (`paid` has no edge
 * to `payment_failed`).
 *
 * - `completed` + `paid` → finalise. `completed` + `unpaid` → wait at `pending_payment`, no stock,
 *   no email. `completed` + `no_payment_required` → a **mismatch**: this shop has no free orders, so
 *   a session that needed no payment is not one this code created. Anything else → mismatch.
 * - `async_payment_succeeded` → finalise; `async_payment_failed` → `payment_failed`;
 *   `expired` → `cancelled`.
 * - `payment_intent.payment_failed` → **record only**. A declined card inside Stripe Checkout does
 *   not end the session — the customer is still on Stripe's page and can use another card — so
 *   writing `payment_failed` on it told the success page and the account page that a payment had
 *   failed while a payment was still being made. The session events are the authority: a session
 *   that ends unpaid ends as `expired` or `async_payment_failed`, and those move the order.
 * - `charge.refunded` → a refund, decided by amount (see `isFullRefund`).
 */
export type StripeEventPlan =
  | { kind: 'awaitPayment' }
  | { kind: 'finalise' }
  | { kind: 'ignore' }
  | { kind: 'mismatch'; reason: string }
  | { kind: 'record' }
  | { kind: 'refund' }
  | { kind: 'transition'; to: 'cancelled' | 'payment_failed' }

export function planStripeEvent(
  type: string,
  sessionPaymentStatus: null | string,
): StripeEventPlan {
  switch (type) {
    case 'checkout.session.completed':
      if (sessionPaymentStatus === 'paid') {
        return { kind: 'finalise' }
      }

      if (sessionPaymentStatus === 'unpaid') {
        return { kind: 'awaitPayment' }
      }

      return {
        kind: 'mismatch',
        reason:
          sessionPaymentStatus === 'no_payment_required'
            ? 'The session needed no payment, and this shop has no free orders.'
            : `The session reported payment_status "${sessionPaymentStatus ?? 'missing'}".`,
      }
    case 'checkout.session.async_payment_succeeded':
      return { kind: 'finalise' }
    case 'checkout.session.async_payment_failed':
      return { kind: 'transition', to: 'payment_failed' }
    case 'checkout.session.expired':
      return { kind: 'transition', to: 'cancelled' }
    case 'payment_intent.payment_failed':
      return { kind: 'record' }
    case 'charge.refunded':
      return { kind: 'refund' }
    default:
      return { kind: 'ignore' }
  }
}

/** Whether an event type is one whose object is a Checkout Session. */
export function isSessionEvent(type: string): boolean {
  return type.startsWith('checkout.session.')
}

/**
 * **The session facts an order is checked against** — Phase 36, audit R1-01.
 *
 * An order is reused across checkout attempts, so a signed event naming the order proves only that
 * *some* session for it completed. Each difference is returned as a sentence for the event row and
 * the alert; an empty list means this is the session the order is currently waiting on, for exactly
 * the amount and currency the order records.
 */
export function describeSessionMismatch(
  order: { currency: string; sessionId: null | string; totalMinor: number },
  session: { amountTotal: null | number; currency: null | string; id: string },
): string[] {
  const differences: string[] = []

  if (order.sessionId !== session.id) {
    differences.push(
      `session ${session.id} is not the order's current session (${order.sessionId ?? 'none'})`,
    )
  }

  if (session.amountTotal !== order.totalMinor) {
    differences.push(
      `amount ${session.amountTotal ?? 'missing'} does not match the order total ${order.totalMinor}`,
    )
  }

  if ((session.currency ?? '').toLowerCase() !== order.currency.toLowerCase()) {
    differences.push(
      `currency ${session.currency ?? 'missing'} does not match the order currency ${order.currency}`,
    )
  }

  return differences
}

/**
 * **Why a session event's conditional claim changed nothing.**
 *
 * The claims in `fulfil.ts` are single statements that also require the session id (and, to pay,
 * the amount and currency), so zero rows can mean three different things and only one of them is
 * harmless:
 *
 * - **`alreadyFinal`** — the session is the order's own and the order has moved past the point this
 *   event could act on: a redelivery, or the second of two events for one payment.
 * - **`superseded`** — an expiry or failure for a session the order has since replaced. Expected:
 *   preflight expires the old session itself before creating a new one. Recorded, not alerted.
 * - **`mismatch`** — a session that says money moved (or will) and is *not* the order's current
 *   session at its current amount. Money may have been taken for something this order no longer
 *   describes, and no retry can fix that, so it is recorded and alerted rather than applied.
 */
export function classifyUnclaimedSessionEvent(input: {
  kind: 'awaitPayment' | 'finalise' | 'transition'
  order: { currency: string; sessionId: null | string; status: PaymentStatus; totalMinor: number }
  session: { amountTotal: null | number; currency: null | string; id: string }
}):
  | { outcome: 'alreadyFinal' }
  | { outcome: 'mismatch'; reason: string }
  | { outcome: 'superseded' } {
  const { kind, order, session } = input

  if (kind === 'transition') {
    return order.sessionId === session.id ? { outcome: 'alreadyFinal' } : { outcome: 'superseded' }
  }

  if (order.sessionId === session.id && !FINALISABLE_STATUSES.includes(order.status)) {
    return { outcome: 'alreadyFinal' }
  }

  const differences = describeSessionMismatch(order, session)

  return differences.length === 0
    ? { outcome: 'alreadyFinal' }
    : { outcome: 'mismatch', reason: differences.join('; ') }
}

/**
 * **A refund is full only when it covers the total** — Phase 36, audit R1-09.
 *
 * Stripe sends `charge.refunded` for partial refunds too, carrying the **cumulative**
 * `amount_refunded`. Marking every one `refunded` blocked fulfilment of what remained and made the
 * next refund's event match nothing. A partial refund keeps the order `paid` and records the amount.
 */
export function isFullRefund(amountRefundedMinor: number, totalMinor: number): boolean {
  return amountRefundedMinor >= totalMinor
}

/* -------------------------------------------------------------------------------------------------
 * Redelivery — Phase 36, audit R1-04
 * ---------------------------------------------------------------------------------------------- */

/** How long a `received` row may sit before its delivery is presumed to have died mid-flight. */
export const STALE_RECEIVED_SECONDS = 60

/**
 * **What to do with an event id this application has already stored.**
 *
 * The unique `eventId` used to be answered with `200 Already processed` whatever the row said — so a
 * delivery that *failed* was acknowledged on retry and never processed, and the 500 that exists to
 * make Stripe retry was dead code. The row's status is what says whether the work was done:
 *
 * - `processed` / `ignored` → **acknowledge** (200). The work is done, or there was none.
 * - `failed`, or `received` for longer than {@link STALE_RECEIVED_SECONDS} → **reprocess**. The
 *   earlier attempt threw, or died between the insert and the outcome. Safe because every business
 *   write downstream is a conditional claim: reprocessing cannot pay, decrement or refund twice.
 * - `received` more recently → **retryLater** (409). Another delivery is probably working on it
 *   right now; Stripe retries a non-2xx, and by then the row will say how it went.
 *
 * `events.ts` enforces the same predicate atomically in SQL, so two retries cannot both reclaim.
 */
export function decideDuplicateDelivery(input: {
  now: Date
  receivedAt: null | string | undefined
  status: null | string | undefined
}): 'acknowledge' | 'reprocess' | 'retryLater' {
  if (input.status === 'processed' || input.status === 'ignored') {
    return 'acknowledge'
  }

  if (input.status === 'failed') {
    return 'reprocess'
  }

  const received = input.receivedAt ? Date.parse(input.receivedAt) : Number.NaN

  if (Number.isNaN(received)) {
    return 'reprocess'
  }

  return input.now.getTime() - received > STALE_RECEIVED_SECONDS * 1000 ? 'reprocess' : 'retryLater'
}

/* -------------------------------------------------------------------------------------------------
 * Reusing an order — Phase 36, audits R1-01 and R1-06
 * ---------------------------------------------------------------------------------------------- */

/**
 * **What to do with the Stripe session a reused order still points at.**
 *
 * Preflight rewrites a reused order's lines and total. While the order's previous Checkout Session is
 * still payable, that rewrite lets an older, smaller session pay for a newer, larger bag. So before
 * reusing, preflight asks Stripe about the old session:
 *
 * - **`paid`** → **refuse**. Money has moved against this order; rewriting it now would re-price a
 *   purchase. The webhook will finalise it.
 * - **`expired`** → **proceed**. Nothing can pay it any more.
 * - **`open`** → **expire** it, then proceed. If the expiry itself fails, it may have just been
 *   paid, and the caller refuses.
 * - **`complete`** (not paid) → a delayed bank payment is clearing, so **refuse** — unless the order
 *   is already `payment_failed`, which is that payment having definitively failed; then proceed.
 * - Anything else → **refuse**. An unknown state is not one to rewrite an order in.
 */
export function decidePriorSession(input: {
  orderStatus: PaymentStatus
  sessionPaymentStatus: null | string
  sessionStatus: null | string
}): 'expire' | 'proceed' | 'refuse' {
  if (input.sessionPaymentStatus === 'paid') {
    return 'refuse'
  }

  switch (input.sessionStatus) {
    case 'expired':
      return 'proceed'
    case 'open':
      return 'expire'
    case 'complete':
      return input.orderStatus === 'payment_failed' ? 'proceed' : 'refuse'
    default:
      return 'refuse'
  }
}

/**
 * **The statuses a new checkout attempt may reuse an order from.**
 *
 * `pending_payment` is included (R1-06): it is the status every order is in once its customer has
 * been sent to Stripe, so leaving it out gave every "back, and try again" a second order and a
 * second live session. It is safe only because preflight now expires the old session first.
 *
 * `cancelled` is excluded (R1-03): an expired session cancels the fulfilment axis too, which is
 * terminal, so reusing that row made every later checkout of the bag fail in the transition hook.
 * The next attempt gets a new order on the same cart instead.
 */
export const REUSABLE_ORDER_STATUSES: readonly PaymentStatus[] = [
  'checkout_started',
  'draft',
  'payment_failed',
  'pending_payment',
]

/**
 * **§17.1h: *"invalid metadata."***
 *
 * §17.1b attaches internal references through metadata so the webhook can find its way back. That
 * metadata arrives inside a signed payload, so it is not forged — but it can still be **wrong**: an
 * event from another application sharing the account, a session created by an older deploy, a
 * hand-made test event. So it is parsed rather than trusted, and an unusable reference makes the
 * event `ignored` rather than crashing the handler.
 */
export function parseOrderReference(metadata: unknown): null | number {
  if (typeof metadata !== 'object' || metadata === null) {
    return null
  }

  const raw = (metadata as Record<string, unknown>).orderId

  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return null
  }

  const id = Number(raw)

  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * **A human-readable order number.**
 *
 * Not the database id: an id is a count of every order ever placed, which a customer can read off
 * their confirmation and use to estimate the shop's volume. Not random either — an order number is
 * read aloud, typed into a support form and compared against a bank statement, so it needs to be
 * short and unambiguous.
 *
 * The alphabet omits `I`, `O`, `0` and `1`, which are the pairs that get misread in exactly that
 * situation. The date prefix makes an order findable by when it happened, which is how a customer
 * describes it when they cannot find the number at all.
 */
const ORDER_NUMBER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export function formatOrderNumber(now: Date, randomBytes: Uint8Array): string {
  const year = now.getUTCFullYear().toString().slice(-2)
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')

  const suffix = Array.from(randomBytes.slice(0, 6), (byte) =>
    ORDER_NUMBER_ALPHABET.charAt(byte % ORDER_NUMBER_ALPHABET.length),
  ).join('')

  return `N1-${year}${month}-${suffix}`
}
