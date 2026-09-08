import type { PaymentStatus } from '@/lib/checkout/rules'

/**
 * **Plan §18's order system, as pure functions.**
 *
 * The phase prompt asks for *"tests for valid/invalid status transitions and order-history
 * immutability after product edits"* by name, which is only possible if the transitions are decidable
 * without a database, a session or an admin panel. Everything here is: §18.1b's fulfilment machine,
 * §18.1c's conditions on marking an order shipped, §18.1d's list of columns that may never change,
 * and **DEV-03's derived single axis** — the one the plan draws and this schema does not store.
 *
 * `payload/hooks/orderTransitions.ts` enforces these on every write. It decides nothing.
 *
 * ---
 *
 * ### Two axes, one diagram — DEV-03, confirmed here
 *
 * §18.1b draws one line: `DRAFT → CHECKOUT_STARTED → PAID → PROCESSING → SHIPPED → DELIVERED`. Feature
 * matrix §21 stores *"payment status"* and *"fulfillment status"* as two fields. **DEV-03** chose two
 * columns and promised the plan's single line would be *derived* — `displayStatus` is that promise
 * kept, and the phase the deviation said would confirm it is this one.
 *
 * The reason two axes are not an over-complication: a single column cannot hold *"refunded, but it
 * shipped last week"*. One axis would have to choose which fact to forget, and both are true.
 */

/* -------------------------------------------------------------------------------------------------
 * The fulfilment machine — plan §18.1b
 * ---------------------------------------------------------------------------------------------- */

export type FulfillmentStatus = 'cancelled' | 'delivered' | 'processing' | 'shipped' | 'unfulfilled'

/**
 * **Which fulfilment transitions are legal.**
 *
 * §18.1b gives the happy path and one instruction about everything else: *"Do not let arbitrary
 * transitions happen from the admin UI."* The edges below are therefore a decision, and four of them
 * are worth stating because each refuses something a careless click would otherwise do:
 *
 * 1. **`delivered` and `cancelled` are terminal.** A delivered parcel is a fact, and a cancelled order
 *    that could be un-cancelled is a cancellation nobody can rely on. Both are ends.
 * 2. **`shipped` cannot go back to `processing`.** This is the expensive one and it is deliberate: by
 *    §18.1c, marking an order shipped *"triggers shipment email"*, and moving the column back does not
 *    unsend it. The customer's world already contains a dispatch notice. Correcting a mistaken
 *    dispatch is a support conversation, not a state edit — and the cost of pretending otherwise is
 *    an order whose history says it was never shipped and a customer holding a tracking number.
 * 3. **`shipped` cannot be cancelled.** §18.1b permits `PAID → CANCELLED` *"only where business rules
 *    allow"*, and the business rule this shop states is: **cancellation is available until dispatch.**
 *    After that it is a return, which is a different process with a different refund.
 * 4. **`unfulfilled → shipped` is refused.** Not because skipping a step is unthinkable, but because
 *    `processing` is where a human picked the order — an order that reached `shipped` without it is
 *    one nobody confirmed could be picked.
 */
const ALLOWED_FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
  cancelled: [],
  delivered: [],
  processing: ['cancelled', 'shipped'],
  shipped: ['delivered'],
  unfulfilled: ['cancelled', 'processing'],
}

export function canFulfillmentTransition(from: FulfillmentStatus, to: FulfillmentStatus): boolean {
  return ALLOWED_FULFILLMENT_TRANSITIONS[from].includes(to)
}

/** The states from which nothing further can happen. Exported so a UI can stop offering actions. */
export const TERMINAL_FULFILLMENT_STATUSES: readonly FulfillmentStatus[] = (
  Object.keys(ALLOWED_FULFILLMENT_TRANSITIONS) as FulfillmentStatus[]
).filter((status) => ALLOWED_FULFILLMENT_TRANSITIONS[status].length === 0)

/* -------------------------------------------------------------------------------------------------
 * Where the two axes meet — plan §18.1b's `PAID → PROCESSING`
 * ---------------------------------------------------------------------------------------------- */

/**
 * Why a fulfilment change was refused. One member per rule, so the harness asserts the **decision**
 * and the admin panel can say something a person can act on.
 */
export type FulfillmentRefusal =
  'notPaid' | 'terminal' | 'trackingRequired' | 'unchanged' | 'unreachable'

export const FULFILLMENT_COPY: Record<FulfillmentRefusal, string> = {
  notPaid:
    'This order has not been paid for, so it cannot be picked or dispatched. Cancel it instead.',
  terminal: 'This order is finished. Delivered and cancelled orders do not change again.',
  trackingRequired: 'Add the carrier and the tracking number before marking this order shipped.',
  unchanged: 'That is the status it already has.',
  unreachable: 'That is not a step this order can take from where it is.',
}

/** What the transition writes besides the status itself. `null` means "leave whatever is there". */
export type FulfillmentStamps = {
  deliveredAt: null | string
  shippedAt: null | string
}

export type FulfillmentPlan =
  { ok: false; reason: FulfillmentRefusal } | { ok: true; stamps: FulfillmentStamps }

/**
 * **§18.1c, decided in one place.**
 *
 * > *"Server-side authorization is required. When marking shipped: require tracking where appropriate.
 * > Store carrier. Store tracking number. Trigger shipment email."*
 *
 * Authorisation is not here — that is `Orders.access.update`, and a rule that returns a `Where` cannot
 * be a pure function. Everything else is: what may follow what, when payment permits it, and what a
 * dispatch has to carry before it counts as one.
 *
 * The order of the checks matters, and it runs from *least* actionable to *most*: an order that is
 * finished cannot be helped by adding a tracking number, so `terminal` is reported before
 * `trackingRequired`. A person reading one sentence should be reading the one they can act on.
 *
 * ### The payment condition, and its exception
 *
 * §18.1b's line is `PAID → PROCESSING`: picking and dispatch follow payment. So advancing **into**
 * `processing` or `shipped` requires a paid order.
 *
 * `shipped → delivered` is exempt, because it records a fact about a parcel that has already gone.
 * A refund issued while it was in transit — **DEV-03's own example** — must not make its arrival
 * unrecordable. And `cancelled` is exempt in the other direction: cancelling an order nobody paid for
 * is the ordinary case, not an exception.
 */
export function planFulfillmentChange(input: {
  carrier: null | string
  from: FulfillmentStatus
  now: Date
  payment: PaymentStatus
  to: FulfillmentStatus
  trackingNumber: null | string
}): FulfillmentPlan {
  const { carrier, from, now, payment, to, trackingNumber } = input

  if (from === to) {
    return { ok: false, reason: 'unchanged' }
  }

  if (TERMINAL_FULFILLMENT_STATUSES.includes(from)) {
    return { ok: false, reason: 'terminal' }
  }

  if (!canFulfillmentTransition(from, to)) {
    return { ok: false, reason: 'unreachable' }
  }

  const advancing = to === 'processing' || to === 'shipped'

  if (advancing && payment !== 'paid') {
    return { ok: false, reason: 'notPaid' }
  }

  if (to === 'shipped' && !(isPresent(carrier) && isPresent(trackingNumber))) {
    return { ok: false, reason: 'trackingRequired' }
  }

  const stamp = now.toISOString()

  return {
    ok: true,
    stamps: {
      deliveredAt: to === 'delivered' ? stamp : null,
      shippedAt: to === 'shipped' ? stamp : null,
    },
  }
}

/** A carrier or a tracking number typed as a space is not a tracking number. */
function isPresent(value: null | string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/* -------------------------------------------------------------------------------------------------
 * §18.1d — the columns that never change
 * ---------------------------------------------------------------------------------------------- */

/**
 * **§18.1d, named rather than remembered.**
 *
 * > *"Order item name/price/variant/SKU snapshots remain unchanged after a product is edited later."*
 *
 * `OrderItems` already stores these as columns rather than reading through the product relationship,
 * which is what makes a product edit unable to reach them. This list is the *other* half: it is what
 * `payload/hooks/freezeOrderLines.ts` refuses to let **any** write change, including a server one.
 *
 * The plan names four things and this list is exactly those four. `quantity` and `lineTotalMinor` are
 * deliberately **absent**, because `OrderItems`' own docblock reserves them for a per-line adjustment
 * — a partial refund — and a rule that forbade the case the schema was designed for would be a rule
 * that gets deleted the first time it is inconvenient. They are closed to the *browser* by field
 * access instead, which is the door §18.1d is actually about.
 */
export const FROZEN_ORDER_LINE_FIELDS = [
  'productName',
  'sku',
  'unitPriceMinor',
  'variantLabel',
] as const

export type FrozenOrderLineField = (typeof FROZEN_ORDER_LINE_FIELDS)[number]

/**
 * Which frozen columns a proposed update would change. Empty means the write is allowed through.
 *
 * Comparison is by identity against the row as it stands, so re-submitting the same values — which is
 * what the admin panel does on every save, because it posts the whole document — is not a change.
 * A hook that could not tell those apart would make every order line unsaveable.
 */
export function frozenFieldsTouched(
  before: Partial<Record<FrozenOrderLineField, unknown>>,
  incoming: Partial<Record<FrozenOrderLineField, unknown>>,
): FrozenOrderLineField[] {
  return FROZEN_ORDER_LINE_FIELDS.filter(
    (field) => field in incoming && incoming[field] !== before[field],
  )
}

/* -------------------------------------------------------------------------------------------------
 * DEV-03's derived single axis
 * ---------------------------------------------------------------------------------------------- */

/**
 * The one status a customer is shown, derived from the two the database keeps.
 *
 * This is the machine §18.1b draws, reconstructed rather than stored — which is the whole of DEV-03.
 * Storing it would make a third column that can disagree with the two that are true.
 *
 * **Precedence, and why it runs this way round.** Cancellation and refund are what a customer needs to
 * know first: they are the states where money is owed or returned, and burying them under a fulfilment
 * step would be a shop reporting *"shipped"* to somebody it has just refunded. Below those, fulfilment
 * outranks payment, because an order being picked is newer news than an order being paid for. Payment
 * answers only when fulfilment has not started, which is exactly the window §18.1b's first three
 * states describe.
 */
export type DisplayStatus =
  | 'cancelled'
  | 'checkout_started'
  | 'delivered'
  | 'draft'
  | 'paid'
  | 'payment_failed'
  | 'pending_payment'
  | 'processing'
  | 'refunded'
  | 'shipped'

export function displayStatus(
  payment: PaymentStatus,
  fulfilment: FulfillmentStatus,
): DisplayStatus {
  /*
   * **Refund outranks cancellation**, and the case that settles it is an order that is both: cancelled
   * before dispatch, then refunded. Both words are true and only one of them tells the customer their
   * money is coming back, which is the thing they would otherwise write in to ask. The cancellation is
   * not lost — nothing was dispatched, so there is no tracking to explain, and the refund copy says
   * what happened to the money.
   *
   * Phase 18's second sweep found this corner untested and landing on the less useful of two true
   * answers.
   */
  if (payment === 'refunded') {
    return 'refunded'
  }

  if (fulfilment === 'cancelled' || payment === 'cancelled') {
    return 'cancelled'
  }

  if (fulfilment === 'delivered' || fulfilment === 'shipped' || fulfilment === 'processing') {
    return fulfilment
  }

  return payment
}

/** What a customer reads. One sentence each, because a status with no explanation is a support email. */
export const DISPLAY_STATUS_COPY: Record<DisplayStatus, { detail: string; label: string }> = {
  cancelled: { detail: 'This order was cancelled. Nothing was dispatched.', label: 'Cancelled' },
  checkout_started: {
    detail: 'Checkout is open. Nothing has been charged yet.',
    label: 'Checkout started',
  },
  delivered: { detail: 'Delivered.', label: 'Delivered' },
  draft: { detail: 'Not placed yet.', label: 'Draft' },
  paid: { detail: 'Paid. We are getting it ready to send.', label: 'Paid' },
  payment_failed: {
    detail: 'The payment did not go through. Nothing was charged.',
    label: 'Payment failed',
  },
  pending_payment: {
    detail: 'Waiting for the payment to confirm. This is usually quick.',
    label: 'Pending payment',
  },
  processing: { detail: 'We are picking and packing this order.', label: 'Processing' },
  refunded: { detail: 'Refunded. The money is on its way back to you.', label: 'Refunded' },
  shipped: { detail: 'On its way.', label: 'Shipped' },
}
