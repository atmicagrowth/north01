/**
 * **Plan §27.1a — "Order state transitions".**
 *
 * The module under test is `src/lib/orders/rules.ts`: §18.1b's fulfilment machine, §18.1c's
 * conditions on marking an order shipped, §18.1d's frozen order-line columns, and DEV-03's derived
 * `displayStatus`. It is the whole of the decision — `payload/hooks/orderTransitions.ts` only
 * enforces what this file says — so a hole here is a hole in the admin panel and in the webhook.
 *
 * ### The failure modes these tests exist for
 *
 * 1. **An illegal step that is merely *undrawn* rather than *refused*.** §18.1b draws a happy path
 *    and says only "do not let arbitrary transitions happen from the admin UI". Every test below
 *    that matters is therefore a refusal: un-dispatching a parcel whose shipment email has gone,
 *    cancelling after dispatch, skipping the pick, or moving an order that is already finished.
 *    The legal edges are restated here as their own table, so the test asserts §18.1b rather than
 *    agreeing with whatever the source happens to contain.
 * 2. **Reaching `paid` by accident.** Only a signature-verified Stripe webhook marks an order paid.
 *    Nothing in this pure module may write, imply or display a payment it did not see: the
 *    fulfilment axis has no `paid` state at all, `planFulfillmentChange` returns no payment field,
 *    and `displayStatus` may answer `'paid'` only when the payment column already says so.
 * 3. **Terminal states that are not terminal.** A delivered parcel and a cancelled order are facts.
 *    A cancellation that can be un-cancelled is a cancellation nobody can rely on.
 * 4. **`null` (UNKNOWN) confused with `0` (NONE), or a value coerced on the way past.**
 *    `frozenFieldsTouched` compares by identity precisely so that `null`, `0` and `'0'` are three
 *    different answers, and so that a minor-units price never quietly matches a major-units one.
 * 5. **Refusal copy that exists but is unreachable, or a status with no sentence to explain it.**
 *    A message nobody can trigger is the string equivalent of a control that does nothing, so both
 *    copy tables are swept for dead entries and for missing ones.
 */

import { describe, expect, it } from 'vitest'

import type { PaymentStatus } from '@/lib/checkout/rules'
import type {
  DisplayStatus,
  FulfillmentPlan,
  FulfillmentRefusal,
  FulfillmentStamps,
  FulfillmentStatus,
} from '@/lib/orders/rules'

import {
  canFulfillmentTransition,
  DISPLAY_STATUS_COPY,
  displayStatus,
  FROZEN_ORDER_LINE_FIELDS,
  frozenFieldsTouched,
  FULFILLMENT_COPY,
  planFulfillmentChange,
  TERMINAL_FULFILLMENT_STATUSES,
} from '@/lib/orders/rules'

/* ------------------------------------------------------------------------------------------------
 * Fixtures — §18.1b restated, not imported
 * --------------------------------------------------------------------------------------------- */

const FULFILLMENT_STATUSES: readonly FulfillmentStatus[] = [
  'cancelled',
  'delivered',
  'processing',
  'shipped',
  'unfulfilled',
]

const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'cancelled',
  'checkout_started',
  'draft',
  'paid',
  'payment_failed',
  'pending_payment',
  'refunded',
]

/**
 * §18.1b's machine, written out independently of the source's own table. If the two ever disagree,
 * one of them changed without the plan changing, and that is the thing worth being told about.
 */
const LEGAL_EDGES: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
  cancelled: [],
  delivered: [],
  processing: ['cancelled', 'shipped'],
  shipped: ['delivered'],
  unfulfilled: ['cancelled', 'processing'],
}

const AT = new Date('2026-03-04T09:15:00.000Z')
const AT_ISO = '2026-03-04T09:15:00.000Z'

type PlanInput = Parameters<typeof planFulfillmentChange>[0]

/** The default is a dispatchable order: paid, picked, with a real carrier and tracking number. */
function step(overrides: Partial<PlanInput>): FulfillmentPlan {
  return planFulfillmentChange({
    carrier: 'DHL',
    from: 'processing',
    now: AT,
    payment: 'paid',
    to: 'shipped',
    trackingNumber: 'TRK-000123',
    ...overrides,
  })
}

function approved(result: FulfillmentPlan): FulfillmentStamps {
  if (!result.ok) {
    throw new Error(`expected the step to be allowed, but it was refused: ${result.reason}`)
  }
  return result.stamps
}

function refusedBecause(result: FulfillmentPlan): FulfillmentRefusal {
  if (result.ok) {
    throw new Error('expected the step to be refused, but it was allowed')
  }
  return result.reason
}

/** Every shape of dispatch paperwork worth sweeping: absent, half-filled, blank, and real. */
const PAPERWORK: readonly { carrier: null | string; trackingNumber: null | string }[] = [
  { carrier: null, trackingNumber: null },
  { carrier: 'DHL', trackingNumber: null },
  { carrier: null, trackingNumber: 'TRK-000123' },
  { carrier: '   ', trackingNumber: '\t\n ' },
  { carrier: 'DHL', trackingNumber: 'TRK-000123' },
]

function isPresent(value: null | string): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/* ------------------------------------------------------------------------------------------------
 * The machine itself
 * --------------------------------------------------------------------------------------------- */

describe('the fulfilment machine (plan §18.1b)', () => {
  it('walks the happy path one step at a time: picked, dispatched, arrived', () => {
    expect(canFulfillmentTransition('unfulfilled', 'processing')).toBe(true)
    expect(canFulfillmentTransition('processing', 'shipped')).toBe(true)
    expect(canFulfillmentTransition('shipped', 'delivered')).toBe(true)
  })

  it('refuses to skip the pick, because nobody confirmed the order could be picked', () => {
    expect(canFulfillmentTransition('unfulfilled', 'shipped')).toBe(false)
    expect(canFulfillmentTransition('unfulfilled', 'delivered')).toBe(false)
  })

  it('refuses to un-dispatch a parcel, because the shipment email cannot be unsent', () => {
    expect(canFulfillmentTransition('shipped', 'processing')).toBe(false)
    expect(canFulfillmentTransition('shipped', 'unfulfilled')).toBe(false)
  })

  it('allows cancellation up to dispatch and not after — after that it is a return', () => {
    expect(canFulfillmentTransition('unfulfilled', 'cancelled')).toBe(true)
    expect(canFulfillmentTransition('processing', 'cancelled')).toBe(true)
    expect(canFulfillmentTransition('shipped', 'cancelled')).toBe(false)
    expect(canFulfillmentTransition('delivered', 'cancelled')).toBe(false)
  })

  it('never lets an order return to unfulfilled, because an order cannot be un-picked', () => {
    for (const from of FULFILLMENT_STATUSES) {
      expect(canFulfillmentTransition(from, 'unfulfilled')).toBe(false)
    }
  })

  it('has no self-edges: a status is never a step to itself', () => {
    for (const status of FULFILLMENT_STATUSES) {
      expect(canFulfillmentTransition(status, status)).toBe(false)
    }
  })

  it('answers for every pair exactly as §18.1b draws it, and for no other pair', () => {
    for (const from of FULFILLMENT_STATUSES) {
      for (const to of FULFILLMENT_STATUSES) {
        expect([from, to, canFulfillmentTransition(from, to)]).toEqual([
          from,
          to,
          LEGAL_EDGES[from].includes(to),
        ])
      }
    }
  })

  it('names delivered and cancelled as the ends, derived from the edges rather than listed twice', () => {
    expect([...TERMINAL_FULFILLMENT_STATUSES].sort()).toEqual(['cancelled', 'delivered'])

    // Derived, not hand-maintained: a status is terminal exactly when nothing is reachable from it.
    for (const status of FULFILLMENT_STATUSES) {
      const hasAnyExit = FULFILLMENT_STATUSES.some((to) => canFulfillmentTransition(status, to))
      expect(TERMINAL_FULFILLMENT_STATUSES.includes(status)).toBe(!hasAnyExit)
    }
  })

  it('refuses a status it has never been taught, rather than throwing on it', () => {
    /*
     * The fulfilment machine and the payment machine are separate columns (DEV-03), so a payment
     * word is exactly the kind of thing that can arrive here by mistake.
     *
     * **This used to throw**, and Phase 27's first sweep changed it. The type says an unknown
     * status cannot reach this function, and the type is not what reaches it: `planFulfillmentChange`
     * is handed a status read from the **database**, so a column that gains an option in a migration
     * before this table does was a crash rather than a refusal. `false` is both the safe answer and
     * the one the caller already renders — `unreachable`.
     *
     * The other direction was always `false` and still is: a destination nobody gave it is not
     * silently granted.
     */
    const notAFulfilmentStatus = 'paid' as unknown as FulfillmentStatus

    expect(canFulfillmentTransition(notAFulfilmentStatus, 'shipped')).toBe(false)
    expect(canFulfillmentTransition('processing', notAFulfilmentStatus)).toBe(false)

    /* And the caller turns that into its own vocabulary rather than propagating an exception. */
    expect(
      planFulfillmentChange({
        carrier: 'DPD',
        from: notAFulfilmentStatus,
        now: new Date('2026-01-01T00:00:00.000Z'),
        payment: 'paid',
        to: 'shipped',
        trackingNumber: 'TRACK-1',
      }),
    ).toEqual({ ok: false, reason: 'unreachable' })
  })
})

/* ------------------------------------------------------------------------------------------------
 * planFulfillmentChange — §18.1c
 * --------------------------------------------------------------------------------------------- */

describe('planning a fulfilment change (plan §18.1c)', () => {
  it('calls a no-op a no-op, so resaving a document is not an error about state', () => {
    expect(refusedBecause(step({ from: 'processing', to: 'processing' }))).toBe('unchanged')
    // Checked before terminality: a cancelled order being resaved has not been asked to move.
    expect(refusedBecause(step({ from: 'cancelled', to: 'cancelled' }))).toBe('unchanged')
  })

  it('tells a finished order it is finished, ahead of any advice it could not act on', () => {
    // `terminal` outranks `trackingRequired` deliberately: adding a tracking number cannot help a
    // delivered order, so the one sentence the admin reads must be the one they can act on.
    expect(refusedBecause(step({ from: 'delivered', to: 'shipped' }))).toBe('terminal')
    expect(refusedBecause(step({ from: 'delivered', to: 'processing' }))).toBe('terminal')
    expect(refusedBecause(step({ from: 'cancelled', to: 'processing' }))).toBe('terminal')
  })

  it('refuses every step out of a terminal state, whatever else is true of the order', () => {
    for (const from of TERMINAL_FULFILLMENT_STATUSES) {
      for (const to of FULFILLMENT_STATUSES) {
        for (const payment of PAYMENT_STATUSES) {
          const result = step({ from, payment, to })
          expect(result.ok).toBe(false)
          expect(refusedBecause(result)).toBe(from === to ? 'unchanged' : 'terminal')
        }
      }
    }
  })

  it('refuses a step the machine has no edge for, even with everything else in order', () => {
    expect(refusedBecause(step({ from: 'unfulfilled', to: 'shipped' }))).toBe('unreachable')
    expect(refusedBecause(step({ from: 'unfulfilled', to: 'delivered' }))).toBe('unreachable')
    expect(refusedBecause(step({ from: 'shipped', to: 'processing' }))).toBe('unreachable')
    expect(refusedBecause(step({ from: 'shipped', to: 'cancelled' }))).toBe('unreachable')
  })

  it('will not pick or dispatch an order that was never paid for — §18.1b puts payment first', () => {
    for (const payment of PAYMENT_STATUSES.filter((status) => status !== 'paid')) {
      expect(refusedBecause(step({ from: 'unfulfilled', payment, to: 'processing' }))).toBe(
        'notPaid',
      )
      expect(refusedBecause(step({ from: 'processing', payment, to: 'shipped' }))).toBe('notPaid')
    }
  })

  it('treats a refunded order as unpaid for anything still to be done', () => {
    // Money already returned is not payment in hand: nothing new may be picked against it.
    expect(
      refusedBecause(step({ from: 'unfulfilled', payment: 'refunded', to: 'processing' })),
    ).toBe('notPaid')
  })

  it('asks about payment before paperwork, because tracking cannot rescue an unpaid order', () => {
    const result = step({
      carrier: null,
      from: 'processing',
      payment: 'pending_payment',
      to: 'shipped',
      trackingNumber: null,
    })
    expect(refusedBecause(result)).toBe('notPaid')
  })

  it('still records the arrival of a parcel refunded while in transit (DEV-03s own example)', () => {
    // `shipped → delivered` is exempt from the payment condition: it records a fact about a parcel
    // that has already gone. A refund must not make its arrival unrecordable.
    const stamps = approved(step({ from: 'shipped', payment: 'refunded', to: 'delivered' }))
    expect(stamps.deliveredAt).toBe(AT_ISO)
  })

  it('lets an order nobody paid for be cancelled, which is the ordinary case', () => {
    for (const payment of PAYMENT_STATUSES) {
      expect(step({ from: 'unfulfilled', payment, to: 'cancelled' }).ok).toBe(true)
    }
  })

  it('requires both halves of the paperwork before an order counts as dispatched', () => {
    expect(refusedBecause(step({ carrier: null, trackingNumber: null }))).toBe('trackingRequired')
    expect(refusedBecause(step({ carrier: 'DHL', trackingNumber: null }))).toBe('trackingRequired')
    expect(refusedBecause(step({ carrier: null, trackingNumber: 'TRK-1' }))).toBe(
      'trackingRequired',
    )
    expect(step({ carrier: 'DHL', trackingNumber: 'TRK-1' }).ok).toBe(true)
  })

  it('does not accept whitespace as a carrier or a tracking number', () => {
    // A tracking number typed as a space is not a tracking number, and the customer would get a
    // dispatch email pointing at nothing.
    expect(refusedBecause(step({ carrier: '   ', trackingNumber: 'TRK-1' }))).toBe(
      'trackingRequired',
    )
    expect(refusedBecause(step({ carrier: 'DHL', trackingNumber: '\t\n ' }))).toBe(
      'trackingRequired',
    )
    expect(refusedBecause(step({ carrier: '', trackingNumber: '' }))).toBe('trackingRequired')
  })

  it('demands paperwork only for dispatch, not for picking, cancelling or delivering', () => {
    expect(
      step({ carrier: null, from: 'unfulfilled', to: 'processing', trackingNumber: null }).ok,
    ).toBe(true)
    expect(
      step({ carrier: null, from: 'processing', to: 'cancelled', trackingNumber: null }).ok,
    ).toBe(true)
    expect(step({ carrier: null, from: 'shipped', to: 'delivered', trackingNumber: null }).ok).toBe(
      true,
    )
  })

  it('stamps only the column the step is about, and leaves the other alone with null', () => {
    // `null` here means UNKNOWN-and-untouched — "leave whatever is there" — not "clear it". A
    // delivery must not blank the dispatch date the row already holds.
    expect(approved(step({ from: 'processing', to: 'shipped' }))).toEqual({
      deliveredAt: null,
      shippedAt: AT_ISO,
    })
    expect(approved(step({ from: 'shipped', to: 'delivered' }))).toEqual({
      deliveredAt: AT_ISO,
      shippedAt: null,
    })
    expect(approved(step({ from: 'unfulfilled', to: 'processing' }))).toEqual({
      deliveredAt: null,
      shippedAt: null,
    })
    expect(approved(step({ from: 'unfulfilled', to: 'cancelled' }))).toEqual({
      deliveredAt: null,
      shippedAt: null,
    })
  })

  it('takes the time from its caller rather than the clock, and does not mutate it', () => {
    const epoch = new Date(0)
    expect(approved(step({ now: epoch })).shippedAt).toBe('1970-01-01T00:00:00.000Z')
    expect(epoch.getTime()).toBe(0)
    // Pure: the same input twice gives the same answer, which is what makes the hook testable.
    expect(approved(step({}))).toEqual(approved(step({})))
  })

  it('never returns a payment status of its own — only the Stripe webhook may write one', () => {
    for (const from of FULFILLMENT_STATUSES) {
      for (const to of FULFILLMENT_STATUSES) {
        for (const payment of PAYMENT_STATUSES) {
          const result = step({ from, payment, to })
          if (result.ok) {
            // An approved plan carries two timestamps and nothing else: no payment column, no
            // total, no `paid`. A fulfilment edit cannot become a payment event by accident.
            expect(Object.keys(result.stamps).sort()).toEqual(['deliveredAt', 'shippedAt'])
            expect(Object.keys(result).sort()).toEqual(['ok', 'stamps'])
            expect(JSON.stringify(result)).not.toContain('paid')
          }
        }
      }
    }
  })

  it('approves a step only when the machine, the payment and the paperwork all allow it', () => {
    let approvals = 0

    for (const from of FULFILLMENT_STATUSES) {
      for (const to of FULFILLMENT_STATUSES) {
        for (const payment of PAYMENT_STATUSES) {
          for (const { carrier, trackingNumber } of PAPERWORK) {
            const shouldPass =
              from !== to &&
              LEGAL_EDGES[from].includes(to) &&
              (to === 'processing' || to === 'shipped' ? payment === 'paid' : true) &&
              (to === 'shipped' ? isPresent(carrier) && isPresent(trackingNumber) : true)

            const result = step({ carrier, from, payment, to, trackingNumber })
            // The tuple carries the inputs so a failure names the combination that broke.
            expect([from, to, payment, carrier, trackingNumber, result.ok]).toEqual([
              from,
              to,
              payment,
              carrier,
              trackingNumber,
              shouldPass,
            ])
            if (result.ok) {
              approvals += 1
            }
          }
        }
      }
    }

    // A guard against the sweep quietly agreeing with itself: the matrix has to contain approvals
    // as well as refusals, or "everything was refused" would pass it.
    expect(approvals).toBeGreaterThan(0)
  })

  it('gives every refusal a sentence a person can act on, and keeps no sentence it cannot reach', () => {
    const reached = new Set<FulfillmentRefusal>()

    for (const from of FULFILLMENT_STATUSES) {
      for (const to of FULFILLMENT_STATUSES) {
        for (const payment of PAYMENT_STATUSES) {
          for (const { carrier, trackingNumber } of PAPERWORK) {
            const result = step({ carrier, from, payment, to, trackingNumber })
            if (!result.ok) {
              reached.add(result.reason)
              expect(FULFILLMENT_COPY[result.reason].trim().length).toBeGreaterThan(0)
            }
          }
        }
      }
    }

    // Dead copy is the string equivalent of a control that does nothing: every message the table
    // holds must be one some real input can produce.
    expect([...reached].sort()).toEqual(Object.keys(FULFILLMENT_COPY).sort())
  })
})

/* ------------------------------------------------------------------------------------------------
 * Order-history immutability — §18.1d
 * --------------------------------------------------------------------------------------------- */

describe('the order line columns that never change (plan §18.1d)', () => {
  const before = {
    productName: 'The Overshirt',
    sku: 'NRT-OVS-BLK-M',
    unitPriceMinor: 24_000,
    variantLabel: 'Black / M',
  }

  it('freezes exactly the four snapshots the plan names', () => {
    expect([...FROZEN_ORDER_LINE_FIELDS].sort()).toEqual([
      'productName',
      'sku',
      'unitPriceMinor',
      'variantLabel',
    ])
  })

  it('lets the admin panel resave the whole document unchanged', () => {
    // The panel posts every field on every save. A rule that could not tell a resubmission from an
    // edit would make every order line unsaveable.
    expect(frozenFieldsTouched(before, { ...before })).toEqual([])
  })

  it('reports a product edit that tries to reach back into a placed order', () => {
    expect(frozenFieldsTouched(before, { productName: 'The Overshirt (2027)' })).toEqual([
      'productName',
    ])
    expect(frozenFieldsTouched(before, { unitPriceMinor: 19_000 })).toEqual(['unitPriceMinor'])
    expect(frozenFieldsTouched(before, { sku: 'NRT-OVS-BLK-L' })).toEqual(['sku'])
    expect(frozenFieldsTouched(before, { variantLabel: 'Black / L' })).toEqual(['variantLabel'])
  })

  it('reports the touched columns in one fixed order, whatever order they arrived in', () => {
    // The hook builds an error message from this list, and a message that reorders itself between
    // saves is a message nobody trusts.
    const scrambled = {
      variantLabel: 'Ecru / L',
      unitPriceMinor: 1,
      sku: 'X',
      productName: 'Y',
    }
    expect(frozenFieldsTouched(before, scrambled)).toEqual([
      'productName',
      'sku',
      'unitPriceMinor',
      'variantLabel',
    ])
  })

  it('treats an absent key as untouched and a present undefined as an attempt to clear it', () => {
    expect(frozenFieldsTouched(before, {})).toEqual([])
    // `undefined` sent explicitly is still a write, and erasing a snapshot is what §18.1d forbids.
    expect(frozenFieldsTouched(before, { sku: undefined })).toEqual(['sku'])
    expect(frozenFieldsTouched(before, { unitPriceMinor: null })).toEqual(['unitPriceMinor'])
  })

  it('never coerces: a price is compared as an integer, not as whatever looks equal', () => {
    // Money is integer minor units everywhere. '24000' arriving from a form is not 24000, and 240
    // (major units, mistaken for minor) is not 24000 either.
    expect(frozenFieldsTouched(before, { unitPriceMinor: '24000' })).toEqual(['unitPriceMinor'])
    expect(frozenFieldsTouched(before, { unitPriceMinor: 240 })).toEqual(['unitPriceMinor'])
    expect(frozenFieldsTouched(before, { unitPriceMinor: 24_000 })).toEqual([])
  })

  it('keeps null and zero apart, because UNKNOWN and NONE are different answers', () => {
    const free = { ...before, unitPriceMinor: 0 }
    // A free line (NONE) replaced by an unknown price, and the reverse: both are changes.
    expect(frozenFieldsTouched(free, { unitPriceMinor: null })).toEqual(['unitPriceMinor'])
    expect(frozenFieldsTouched({ ...before, unitPriceMinor: null }, { unitPriceMinor: 0 })).toEqual(
      ['unitPriceMinor'],
    )
    expect(frozenFieldsTouched(free, { unitPriceMinor: 0 })).toEqual([])
  })

  it('leaves quantity and line total alone, because a partial refund must be able to adjust them', () => {
    // Deliberately absent from the frozen list — §18.1d closes those to the browser by field access
    // instead. A rule that forbade the case the schema was designed for is a rule that gets deleted
    // the first time it is inconvenient.
    const touched = frozenFieldsTouched(before, {
      ...before,
      lineTotalMinor: 0,
      quantity: 1,
    } as Record<string, unknown>)
    expect(touched).toEqual([])
  })

  it('reports every frozen column when a whole line is swapped for another product', () => {
    expect(
      frozenFieldsTouched(before, {
        productName: 'The Field Jacket',
        sku: 'NRT-FJK-OLV-M',
        unitPriceMinor: 42_000,
        variantLabel: 'Olive / M',
      }),
    ).toHaveLength(4)
  })

  it('survives an empty row on either side without inventing a change', () => {
    expect(frozenFieldsTouched({}, {})).toEqual([])
    // Nothing known before, something written now: that is still a write to a frozen column.
    expect(frozenFieldsTouched({}, { sku: 'NRT-OVS-BLK-M' })).toEqual(['sku'])
  })
})

/* ------------------------------------------------------------------------------------------------
 * The derived single axis — DEV-03
 * --------------------------------------------------------------------------------------------- */

describe('the one status a customer is shown (DEV-03)', () => {
  it('answers with the payment half while nothing has been picked', () => {
    for (const payment of PAYMENT_STATUSES) {
      expect(displayStatus(payment, 'unfulfilled')).toBe(payment)
    }
  })

  it('lets fulfilment outrank payment once picking has started, because it is newer news', () => {
    expect(displayStatus('paid', 'processing')).toBe('processing')
    expect(displayStatus('paid', 'shipped')).toBe('shipped')
    expect(displayStatus('paid', 'delivered')).toBe('delivered')
  })

  it('puts a refund above everything, including a parcel that already arrived', () => {
    // The customer needs to know their money is coming back before they need a fulfilment step.
    expect(displayStatus('refunded', 'delivered')).toBe('refunded')
    expect(displayStatus('refunded', 'shipped')).toBe('refunded')
    expect(displayStatus('refunded', 'processing')).toBe('refunded')
  })

  it('reads a cancelled-then-refunded order as refunded, the one of two true answers that helps', () => {
    // Both words are true; only one tells the customer where the money went. Nothing was
    // dispatched, so no tracking is left unexplained.
    expect(displayStatus('refunded', 'cancelled')).toBe('refunded')
  })

  it('reports a cancellation from either axis, and above any fulfilment step', () => {
    expect(displayStatus('paid', 'cancelled')).toBe('cancelled')
    expect(displayStatus('cancelled', 'unfulfilled')).toBe('cancelled')
    expect(displayStatus('draft', 'cancelled')).toBe('cancelled')
  })

  it('never reads as paid unless the payment column says paid — nothing else may imply it', () => {
    // The webhook is the only thing that writes `paid`. This is the display half of the same rule:
    // no fulfilment step, and no combination of the two axes, may produce the word on its own.
    for (const payment of PAYMENT_STATUSES) {
      for (const fulfilment of FULFILLMENT_STATUSES) {
        const shown = displayStatus(payment, fulfilment)
        if (shown === 'paid') {
          expect(payment).toBe('paid')
          expect(fulfilment).toBe('unfulfilled')
        }
      }
    }
    // And a paid order that has moved on shows the step, not the payment.
    expect(displayStatus('paid', 'unfulfilled')).toBe('paid')
    expect(displayStatus('pending_payment', 'processing')).not.toBe('paid')
    expect(displayStatus('payment_failed', 'processing')).not.toBe('paid')
  })

  it('never hides a failed or pending payment behind another word while nothing is picked', () => {
    expect(displayStatus('payment_failed', 'unfulfilled')).toBe('payment_failed')
    expect(displayStatus('pending_payment', 'unfulfilled')).toBe('pending_payment')
    expect(displayStatus('draft', 'unfulfilled')).toBe('draft')
    expect(displayStatus('checkout_started', 'unfulfilled')).toBe('checkout_started')
  })

  it('answers every combination of the two axes with a status the copy table can explain', () => {
    const shownAtLeastOnce = new Set<DisplayStatus>()

    for (const payment of PAYMENT_STATUSES) {
      for (const fulfilment of FULFILLMENT_STATUSES) {
        const shown = displayStatus(payment, fulfilment)
        shownAtLeastOnce.add(shown)
        // A status with no sentence is a support email, so no combination may reach one.
        expect(DISPLAY_STATUS_COPY[shown]).toBeDefined()
      }
    }

    // Derived, never stored: every word the table holds is one the two columns can actually produce.
    expect([...shownAtLeastOnce].sort()).toEqual(Object.keys(DISPLAY_STATUS_COPY).sort())
  })

  it('gives every shown status both a label and a sentence, neither of them blank', () => {
    for (const [status, copy] of Object.entries(DISPLAY_STATUS_COPY)) {
      expect(copy.label.trim().length, `label for ${status}`).toBeGreaterThan(0)
      expect(copy.detail.trim().length, `detail for ${status}`).toBeGreaterThan(0)
    }
  })

  it('is a pure derivation: the same two columns always read the same way', () => {
    expect(displayStatus('paid', 'processing')).toBe(displayStatus('paid', 'processing'))
  })
})
