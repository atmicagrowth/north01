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
  pending_payment: ['paid', 'payment_failed', 'cancelled'],
  refunded: [],
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/**
 * Whether this order still needs to be finalised as paid.
 *
 * **§17.1d's second barrier.** The first is the unique event id, which stops the *same* event being
 * processed twice. This stops a *different* event driving the same transition — Stripe sends both
 * `checkout.session.completed` and `payment_intent.succeeded` for one payment, and a handler that
 * acted on both would decrement inventory twice from two perfectly legitimate, non-duplicate events.
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
  | 'emptyCart'
  | 'invalidAddress'
  | 'lineUnavailable'
  | 'noShippingMethod'
  | 'promotionInvalid'
  | 'stripeUnconfigured'
  | 'taxUnavailable'
  | 'totalMismatch'

export const PREFLIGHT_COPY: Record<PreflightFailure, string> = {
  addressUnsupported: 'We cannot deliver to that address.',
  emptyCart: 'Your bag is empty.',
  invalidAddress: 'Check the delivery address — something is missing.',
  lineUnavailable:
    'Something in your bag is no longer available. Your bag has been updated — please review it.',
  noShippingMethod: 'No delivery option is available for that address.',
  promotionInvalid: 'Your discount code is no longer valid. Remove it to continue.',
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

/** What an event asks the order to become, or `null` when it asks for nothing. */
export function intendedStatusFor(type: string): null | PaymentStatus {
  switch (type) {
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.completed':
      return 'paid'
    case 'checkout.session.async_payment_failed':
    case 'payment_intent.payment_failed':
      return 'payment_failed'
    case 'charge.refunded':
      return 'refunded'
    case 'checkout.session.expired':
      return 'cancelled'
    default:
      return null
  }
}

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
