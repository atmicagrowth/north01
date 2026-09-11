import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CartSummary } from '@/components/cart/cart-summary'
import { DiscountForm } from '@/components/cart/discount-form'
import { CheckoutForm } from '@/components/checkout/checkout-form'
import { cartTotals, shippingProgress } from '@/lib/cart/rules'
import type { CheckoutActionState } from '@/lib/checkout/action-state'
import { startCheckoutAction } from '@/lib/checkout/actions'
import type { PromotionActionState } from '@/lib/promotions/action-state'
import { applyCodeAction, removeCodeAction } from '@/lib/promotions/actions'
import type { ResolvedPromotion } from '@/lib/promotions/promotions'
import { PROMOTION_COPY, type PromotionInput } from '@/lib/promotions/rules'
import type { ShippingRate } from '@/lib/shipping/rules'
import { TAX_COPY } from '@/lib/tax/rules'

/**
 * **The checkout page's three moving parts — plan §27.1b's *"checkout form"*.**
 *
 * `CartSummary`, `DiscountForm` and `CheckoutForm` are the whole of what a customer touches between
 * the bag and Stripe's page. None of them decides a price, a discount or a delivery charge; what they
 * decide is **what a number means when it is missing**, and that is what is asserted here.
 *
 * 1. **`null` is UNKNOWN and `0` is NONE, and the summary must never blur them.** A delivery cost
 *    that has not been quoted draws *no row at all* — not `Free`, not `£0.00`, not `—`. A delivery
 *    cost quoted at zero draws `Free`. Both facts render from the same field, `totals.shippingMinor`,
 *    which is why every row below is asserted in both states: this is the conflation §14.1d names
 *    most often, and a summary that says *Free* about something nobody has priced is the most
 *    persuasive kind of fake UI, because the customer has no way to tell a computed zero from a
 *    placeholder.
 * 2. **The word *Total* is withheld until nothing is unknown.** `isFinal` is the switch, and while it
 *    is false the bottom figure is labelled *Subtotal* and one sentence says where the rest arrives.
 * 3. **The discount form shows the server's refusal reason**, verbatim from `PROMOTION_COPY`, and an
 *    applied code that has *since* stopped working stays on screen with its reason beside it — §15.1c's
 *    *"expired code during checkout"*. Silently charging full price is the failure mode.
 * 4. **The checkout form collects an address and a method and nothing else.** No card field, no total,
 *    no amount: §17.1b's *"never accept a client-provided total"* is visible here as an absence.
 * 5. **DEV-62 is split across two files, and only half of it is a component's.** The *"payment is not
 *    connected"* state belongs to the route, which is the only thing holding `isStripeConfigured()`.
 *    What lives in `CheckoutForm` is the other half — the promise that the card is collected by
 *    Stripe and never by this site — and the assertions below check the seam in both directions.
 *
 * Everything is queried by role, label or rendered sentence, and every submission is asserted through
 * the real `FormData` React built from the real inputs.
 *
 * **Two things this file deliberately does not assert**, both reported as defects instead: the submit
 * button is neither `disabled` nor `loading` while pending, and a refused checkout comes back with
 * every address field emptied — React resets an uncontrolled form once its action resolves, which is
 * the lesson `login-form.tsx` records and `CheckoutActionState` is the one form state that does not
 * carry the `values` needed to survive it. Pinning either behaviour in a test would make the fix look
 * like a regression.
 */

/*
 * Both action modules are `'use server'`: importing them for real drags in Payload, the database,
 * `next/headers` and `next/navigation`'s `redirect`, and a Server Action cannot execute in jsdom
 * regardless. Mocked at exactly the boundary each component imports and nowhere deeper — the
 * `FormData` that arrives in these mocks is the one React built from the real fields.
 */
vi.mock('@/lib/checkout/actions', () => ({
  startCheckoutAction: vi.fn(),
}))

vi.mock('@/lib/promotions/actions', () => ({
  applyCodeAction: vi.fn(),
  removeCodeAction: vi.fn(),
}))

const LOCALE = 'en-GB'

/** Two of an £85.00 shirt: a £170.00 subtotal, and every figure below is checkable against it. */
const LINES = [{ quantity: 2, unitPriceMinor: 8500 }]

/**
 * Real totals from the real rule, rather than a hand-built object.
 *
 * `cartTotals` is what the server calls, so its `isFinal` and its `totalMinor` arrive here exactly as
 * the page would produce them — a fixture that set `isFinal: true` beside a `null` would be asserting
 * a state the application cannot reach.
 */
function totals({
  discount = null,
  shipping = null,
  tax = null,
}: { discount?: null | number; shipping?: null | number; tax?: null | number } = {}) {
  return cartTotals(LINES, discount, shipping, tax)
}

/**
 * The `<dd>` beside a totals `<dt>`, or `null` when that row is **not drawn at all**.
 *
 * The distinction the whole first describe block rests on: a row that is missing and a row reading
 * `£0.00` are different claims, and a query that only asked "is `Free` on screen?" would pass for
 * both. Rows are `<dt>`/`<dd>` siblings, so the value is the term's next element.
 */
function totalsRow(label: string): null | string {
  const term = screen.queryByText(label, { selector: 'dt' })

  return term?.nextElementSibling?.textContent ?? null
}

function makePromotion(overrides: Partial<PromotionInput> = {}): PromotionInput {
  return {
    active: true,
    code: 'WELCOME10',
    currency: null,
    eligibleCollectionIds: [],
    eligibleProductIds: [],
    endsAt: null,
    id: 3,
    minimumSubtotalMinor: null,
    percentage: 10,
    perCustomerLimit: null,
    startsAt: null,
    timesUsed: 0,
    type: 'percentage',
    usageLimit: null,
    valueMinor: null,
    ...overrides,
  }
}

/** A code decided against this bag. `reason: null` is applied; anything else is applied-and-failing. */
function makeDiscount(
  result: Partial<ResolvedPromotion['result']> = {},
  promotion: Partial<PromotionInput> = {},
): ResolvedPromotion {
  return {
    code: 'WELCOME10',
    id: 3,
    promotion: makePromotion(promotion),
    result: {
      discountMinor: 1700,
      eligibleSubtotalMinor: 17000,
      finalSubtotalMinor: 15300,
      freeShipping: false,
      reason: null,
      ...result,
    },
  }
}

function makeRate(overrides: Partial<ShippingRate> = {}): ShippingRate {
  return {
    amountMinor: 0,
    currency: 'GBP',
    eligible: true,
    estimate: '3–5 business days',
    id: 'standard',
    ineligibleReason: null,
    maxDays: 5,
    minDays: 3,
    name: 'Standard',
    waived: false,
    ...overrides,
  }
}

function renderCheckoutForm(rates: ShippingRate[] = [makeRate()]) {
  return render(<CheckoutForm currency="GBP" defaultEmail="" locale={LOCALE} rates={rates} />)
}

/** The `FormData` of the nth checkout submission, as the server would read it. */
function submitted(call = 0): FormData {
  return vi.mocked(startCheckoutAction).mock.calls[call]?.[1] as FormData
}

/** Everything the server marks `required`, filled the way a customer would fill it. */
async function fillAddress(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'ada@example.com')
  await user.type(screen.getByLabelText('First name'), 'Ada')
  await user.type(screen.getByLabelText('Last name'), 'Lovelace')
  await user.type(screen.getByLabelText('Address'), '12 Marylebone Road')
  await user.type(screen.getByLabelText('City'), 'London')
  await user.type(screen.getByLabelText('Postcode'), 'NW1 5LS')
  await user.type(screen.getByLabelText('Country'), 'GB')
}

const idle: CheckoutActionState = { error: null, field: null }
const promotionIdle: PromotionActionState = { notice: null, ok: true }

beforeEach(() => {
  vi.clearAllMocks()
  /*
   * Implementations are installed per test rather than in the `vi.mock` factory: the shared setup
   * file calls `vi.restoreAllMocks()` after every test, and a mock left without one returns
   * `undefined`, which `useActionState` would then store as the state.
   */
  vi.mocked(startCheckoutAction).mockImplementation(async () => ({ ...idle }))
  vi.mocked(applyCodeAction).mockImplementation(async () => ({ ...promotionIdle }))
  vi.mocked(removeCodeAction).mockImplementation(async () => {})
})

describe('CartSummary — an unquoted cost is not a free one', () => {
  it('draws no delivery row at all when nothing has been quoted, because null is unknown and "Free" is a promise', () => {
    render(<CartSummary currency="GBP" locale={LOCALE} shipping={null} totals={totals()} />)

    /*
     * The headline. Three separate wrong answers are ruled out in one breath — the row is absent
     * rather than present-and-zero, present-and-empty, or present-and-hedged. A customer cannot
     * check a delivery charge nobody has quoted, so none is shown.
     */
    expect(totalsRow('Delivery')).toBeNull()
    expect(totalsRow('Delivery (estimated)')).toBeNull()
    expect(screen.queryByText('Free')).not.toBeInTheDocument()
    expect(screen.queryByText('£0.00')).not.toBeInTheDocument()
  })

  it('says Free only when a quote actually came back at zero, which is a number the shop is standing behind', () => {
    render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={null}
        totals={totals({ shipping: 0 })}
      />,
    )

    expect(totalsRow('Delivery')).toBe('Free')
  })

  it('renders a quoted delivery charge as money', () => {
    render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={null}
        totals={totals({ shipping: 1500 })}
      />,
    )

    expect(totalsRow('Delivery')).toBe('£15.00')
  })

  it('calls the row an estimate while the destination is unknown, because the price is right and the eligibility is unchecked', () => {
    render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={null}
        shippingQuote={{ defaultRateId: 'standard', destinationKnown: false, rates: [] }}
        totals={totals({ shipping: 1500 })}
      />,
    )

    /* Not hedging: the static provider prices from the cart and has checked no address. */
    expect(totalsRow('Delivery (estimated)')).toBe('£15.00')
    expect(totalsRow('Delivery')).toBeNull()
  })

  it('drops the estimate qualifier once the quote knows where it is going', () => {
    render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={null}
        shippingQuote={{ defaultRateId: 'standard', destinationKnown: true, rates: [] }}
        totals={totals({ shipping: 1500 })}
      />,
    )

    expect(totalsRow('Delivery')).toBe('£15.00')
    expect(totalsRow('Delivery (estimated)')).toBeNull()
  })

  it('draws no tax row while tax is unknown, and never a zero standing in for one', () => {
    render(<CartSummary currency="GBP" locale={LOCALE} shipping={null} totals={totals()} />)

    /* A `0` here would undercharge every order in a taxable jurisdiction and look correct doing it. */
    expect(totalsRow('Tax')).toBeNull()
  })

  it('renders a calculated tax of zero as a formatted zero rather than as "Free", because no tax owed is a figure and not a gift', () => {
    render(
      <CartSummary currency="GBP" locale={LOCALE} shipping={null} totals={totals({ tax: 0 })} />,
    )

    expect(totalsRow('Tax')).toBe('£0.00')
  })

  it('draws no discount row when no code is applied, because null there means there is nothing to say', () => {
    render(<CartSummary currency="GBP" locale={LOCALE} shipping={null} totals={totals()} />)

    expect(totalsRow('Discount')).toBeNull()
  })

  it('draws a discount row for a code that currently takes nothing off, because that is surprising and must be visible', () => {
    render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={null}
        totals={totals({ discount: 0 })}
      />,
    )

    /* The one row where `0` is louder than `null`: a code is applied and it is worth nothing today. */
    expect(totalsRow('Discount')).toBe('−£0.00')
  })

  it('signs the discount row as a subtraction', () => {
    render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={null}
        totals={totals({ discount: 1700 })}
      />,
    )

    expect(totalsRow('Discount')).toBe('−£17.00')
  })

  it('always shows the subtotal, which is the one figure this page computed from live prices', () => {
    render(<CartSummary currency="GBP" locale={LOCALE} shipping={null} totals={totals()} />)

    expect(totalsRow('Subtotal')).toBe('£170.00')
  })
})

describe('CartSummary — the word Total, and when it is withheld', () => {
  it('withholds Total while anything is unknown, so the bottom figure never claims to be the whole bill', () => {
    render(<CartSummary currency="GBP" locale={LOCALE} shipping={null} totals={totals()} />)

    expect(totalsRow('Total')).toBeNull()
    /* And the sentence that says where the rest arrives, rather than a silent omission. */
    expect(screen.getByText(TAX_COPY.pending)).toBeInTheDocument()
  })

  it('names the bottom figure Total once shipping and tax are both known, and drops the footnote', () => {
    render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={null}
        totals={totals({ discount: 1700, shipping: 1500, tax: 300 })}
      />,
    )

    /* £170.00 − £17.00 + £15.00 + £3.00. The arithmetic is the rule's; the label is the component's. */
    expect(totalsRow('Total')).toBe('£171.00')
    expect(screen.queryByText(TAX_COPY.pending)).not.toBeInTheDocument()
    expect(screen.queryByText(TAX_COPY.unavailable)).not.toBeInTheDocument()
  })

  it('still withholds Total when only tax is missing, because a bill missing one component is not a bill', () => {
    render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={null}
        totals={totals({ shipping: 1500 })}
      />,
    )

    expect(totalsRow('Delivery')).toBe('£15.00')
    expect(totalsRow('Total')).toBeNull()
    expect(totalsRow('Subtotal')).toBe('£170.00')
  })

  it('says the tax service could not answer, rather than that tax is merely pending, when that is what happened', () => {
    render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={null}
        tax={{ amountMinor: null, providerRef: null, status: 'unavailable' }}
        totals={totals({ shipping: 1500 })}
      />,
    )

    /* §16.1d: "we could not calculate" and "not yet asked" are different states of the same null. */
    expect(screen.getByText(TAX_COPY.unavailable)).toBeInTheDocument()
    expect(screen.queryByText(TAX_COPY.pending)).not.toBeInTheDocument()
  })
})

describe('CartSummary — the free-delivery progress message', () => {
  it('says nothing about free delivery when no threshold is configured, because there is no bar to be near', () => {
    /* The real rule decides: no threshold means `null`, and `null` means the message does not exist. */
    render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={shippingProgress(17000, null)}
        totals={totals()}
      />,
    )

    expect(screen.queryByText(/free standard delivery/)).not.toBeInTheDocument()
    expect(screen.queryByText(/free on this order/)).not.toBeInTheDocument()
  })

  it('says how much more is needed when a threshold exists and the bag is under it', () => {
    render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={shippingProgress(17000, 20000)}
        totals={totals()}
      />,
    )

    /* £200.00 − £170.00, formatted in the bag's own currency rather than as a bare number. */
    expect(screen.getByText('£30.00 away from free standard delivery.')).toBeInTheDocument()
  })

  it('switches to the qualified sentence once the bag clears the threshold', () => {
    render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={shippingProgress(17000, 15000)}
        totals={totals()}
      />,
    )

    expect(screen.getByText('Standard delivery is free on this order.')).toBeInTheDocument()
  })

  it('qualifies on a threshold of zero, which is a shop deciding everything ships free', () => {
    render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={shippingProgress(0, 0)}
        totals={totals()}
      />,
    )

    expect(screen.getByText('Standard delivery is free on this order.')).toBeInTheDocument()
  })

  it('keeps the progress bar out of the accessibility tree, because a percentage is not something a listener can act on', () => {
    const { container } = render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={shippingProgress(17000, 20000)}
        totals={totals()}
      />,
    )

    /* The sentence carries the whole message; the bar is the same fact drawn for people who can see it. */
    expect(container.querySelector('[aria-hidden]')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('offers the code field on the bag page and withholds it in the drawer, because one place to type a code is enough', () => {
    const { rerender } = render(
      <CartSummary
        currency="GBP"
        locale={LOCALE}
        shipping={null}
        showDiscountForm
        totals={totals()}
      />,
    )

    expect(screen.getByLabelText('Discount code')).toBeInTheDocument()

    rerender(<CartSummary currency="GBP" locale={LOCALE} shipping={null} totals={totals()} />)

    expect(screen.queryByLabelText('Discount code')).not.toBeInTheDocument()
  })

  it('shows an applied code even where the field is withheld, because a code is information and the field is a control', () => {
    render(
      <CartSummary
        currency="GBP"
        discount={makeDiscount()}
        locale={LOCALE}
        shipping={null}
        totals={totals({ discount: 1700 })}
      />,
    )

    expect(screen.getByText(/WELCOME10/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Discount code')).not.toBeInTheDocument()
  })
})

describe('DiscountForm — the server refuses, and the field says why', () => {
  it('says nothing before a code has been tried, and keeps the region that will say it', () => {
    const { container } = render(<DiscountForm discount={null} />)

    /*
     * The live region is rendered empty rather than created on the first failure: a region inserted
     * at the moment it has something to say is a region a screen reader was not watching.
     */
    const region = container.querySelector('[aria-live="polite"]')
    expect(region).toBeInTheDocument()
    expect(region?.textContent).toBe('')
  })

  it('shows the server’s own reason for refusing a code, rather than a sentence the browser invented', async () => {
    const user = userEvent.setup()
    vi.mocked(applyCodeAction).mockImplementation(async () => ({
      notice: PROMOTION_COPY.expired,
      ok: false,
    }))

    render(<DiscountForm discount={null} />)

    await user.type(screen.getByLabelText('Discount code'), 'WELCOME10')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    /* Verbatim from `PROMOTION_COPY`, which is the only place this wording exists. */
    expect(await screen.findByText(PROMOTION_COPY.expired)).toBeInTheDocument()
  })

  it('posts the code and nothing else, because whether it is valid is not the browser’s to decide', async () => {
    const user = userEvent.setup()
    render(<DiscountForm discount={null} />)

    await user.type(screen.getByLabelText('Discount code'), 'welcome10')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(applyCodeAction).toHaveBeenCalledTimes(1))
    const formData = vi.mocked(applyCodeAction).mock.calls[0]?.[1] as FormData
    /* Sent as typed. Trimming and upper-casing is `normalisePromotionCode`, on the server. */
    expect(formData.get('code')).toBe('welcome10')
    expect([...formData.keys()]).toEqual(['code'])
  })

  it('reports a successful apply in the same region, so the two outcomes are heard in the same place', async () => {
    const user = userEvent.setup()
    vi.mocked(applyCodeAction).mockImplementation(async () => ({
      notice: 'WELCOME10 applied.',
      ok: true,
    }))

    render(<DiscountForm discount={null} />)

    await user.type(screen.getByLabelText('Discount code'), 'WELCOME10')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('WELCOME10 applied.')).toBeInTheDocument()
  })

  it('marks the button busy while the server decides, because a code check is a round trip', async () => {
    const user = userEvent.setup()
    let settle: (state: PromotionActionState) => void = () => {}
    vi.mocked(applyCodeAction).mockImplementation(
      () =>
        new Promise<PromotionActionState>((resolve) => {
          settle = resolve
        }),
    )

    render(<DiscountForm discount={null} />)

    await user.type(screen.getByLabelText('Discount code'), 'WELCOME10')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    /*
     * Busy, and the SAME button. Phase 30 dropped the "Checking…" label swap: the longer word widened
     * the button and narrowed the field the customer had just typed in, then shrank it again on the
     * answer. The name stays "Apply" — `Button` keeps its label in the tree while the spinner shows —
     * and the busy state is carried by `aria-busy` and `disabled`, which is what a screen reader and
     * a second click both read.
     */
    const button = screen.getByRole('button', { name: 'Apply' })

    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'))
    expect(button).toBeDisabled()

    settle({ ...promotionIdle })

    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'))
    expect(button).toBeEnabled()
  })
})

describe('DiscountForm — a code that is applied, and one that stopped working', () => {
  it('replaces the field with the applied code, because carts hold one code and a second field implies two', () => {
    render(<DiscountForm discount={makeDiscount()} />)

    expect(screen.queryByLabelText('Discount code')).not.toBeInTheDocument()
    expect(screen.getByText(/WELCOME10/)).toBeInTheDocument()
    expect(screen.getByText(/10% off/)).toBeInTheDocument()
  })

  it('keeps an expired code on screen with its reason, because silently charging full price is the failure §15.1c names', () => {
    render(<DiscountForm discount={makeDiscount({ discountMinor: 0, reason: 'expired' })} />)

    /*
     * §15.1c's first edge case. The code was applied and is no longer valid: removing the row would
     * drop the price back to full with nothing on screen accounting for the change.
     */
    expect(screen.getByText(/WELCOME10/)).toBeInTheDocument()
    expect(screen.getByText(PROMOTION_COPY.expired)).toBeInTheDocument()
  })

  it('shows the failing reason as a status, so the change is announced and not only coloured', () => {
    render(<DiscountForm discount={makeDiscount({ discountMinor: 0, reason: 'usageLimit' })} />)

    expect(screen.getByRole('status')).toHaveTextContent(PROMOTION_COPY.usageLimit)
  })

  it('says the same thing about an unknown code and a switched-off one, because the difference leaks an unreleased campaign', () => {
    const { rerender } = render(<DiscountForm discount={makeDiscount({ reason: 'inactive' })} />)
    expect(screen.getByText(PROMOTION_COPY.inactive)).toBeInTheDocument()

    rerender(<DiscountForm discount={makeDiscount({ reason: 'unknownCode' })} />)
    expect(screen.getByText(PROMOTION_COPY.unknownCode)).toBeInTheDocument()

    /* One sentence, two decisions — asserted as an equality rather than as two lookups. */
    expect(PROMOTION_COPY.inactive).toBe(PROMOTION_COPY.unknownCode)
  })

  it('names the code in the removal control, so a page carrying one does not announce a bare X', () => {
    render(<DiscountForm discount={makeDiscount()} />)

    expect(screen.getByRole('button', { name: 'Remove code WELCOME10' })).toBeInTheDocument()
  })

  it('removes through its own form and its own action, so the code can be dropped without JavaScript', async () => {
    const user = userEvent.setup()
    render(<DiscountForm discount={makeDiscount()} />)

    await user.click(screen.getByRole('button', { name: 'Remove code WELCOME10' }))

    /* The apply path is untouched by a removal: two mutations, two actions, no shared state. */
    await waitFor(() => expect(removeCodeAction).toHaveBeenCalledTimes(1))
    expect(applyCodeAction).not.toHaveBeenCalled()
  })

  it('comes back to an empty field once the server re-renders without the code, carrying no stale refusal', () => {
    const { rerender } = render(
      <DiscountForm discount={makeDiscount({ discountMinor: 0, reason: 'expired' })} />,
    )
    expect(screen.getByText(PROMOTION_COPY.expired)).toBeInTheDocument()

    /* What the customer sees after `removeCodeAction` revalidates: the bag now has no promotion. */
    rerender(<DiscountForm discount={null} />)

    expect(screen.getByLabelText('Discount code')).toHaveValue('')
    /* The reason belonged to the removed code. Leaving it up would refuse a code nobody has typed. */
    expect(screen.queryByText(PROMOTION_COPY.expired)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove code WELCOME10' })).not.toBeInTheDocument()
  })

  it('explains a free-delivery code in words instead of a discount row of zero', () => {
    render(
      <DiscountForm
        discount={makeDiscount(
          { discountMinor: 0, freeShipping: true },
          { percentage: null, type: 'free_shipping' },
        )}
      />,
    )

    /* DEV-60: the effect lands where shipping is calculated, and `−£0.00` would misdescribe it. */
    expect(
      screen.getByText('Applies to delivery, which is calculated at checkout.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Free delivery/)).toBeInTheDocument()
  })

  it('does not promise free delivery from a free-delivery code that is currently refused', () => {
    render(
      <DiscountForm
        discount={makeDiscount(
          { discountMinor: 0, freeShipping: false, reason: 'minimumSubtotal' },
          { percentage: null, type: 'free_shipping' },
        )}
      />,
    )

    expect(screen.getByText(PROMOTION_COPY.minimumSubtotal)).toBeInTheDocument()
    expect(
      screen.queryByText('Applies to delivery, which is calculated at checkout.'),
    ).not.toBeInTheDocument()
  })
})

describe('CheckoutForm — what reaches the server, and what never does', () => {
  it('posts the address and the chosen method, and no amount of any kind', async () => {
    const user = userEvent.setup()
    renderCheckoutForm([
      makeRate({ amountMinor: 0, id: 'standard', name: 'Standard' }),
      makeRate({
        amountMinor: 1200,
        estimate: '1–2 business days',
        id: 'express',
        name: 'Express',
      }),
    ])

    await fillAddress(user)
    await user.click(screen.getAllByRole('radio')[1] as HTMLElement)
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }))

    await waitFor(() => expect(startCheckoutAction).toHaveBeenCalledTimes(1))
    const form = submitted()
    expect(form.get('email')).toBe('ada@example.com')
    expect(form.get('postalCode')).toBe('NW1 5LS')
    expect(form.get('shippingMethod')).toBe('express')
    /*
     * §17.1b's *"never accept a client-provided total"* asserted as an absence: the browser sends the
     * id of a method, and preflight re-quotes and re-prices it from the database. A form that also
     * posted the amount would be offering a number the server would have to decide whether to trust.
     */
    expect([...form.keys()]).not.toContain('amount')
    expect([...form.keys()]).not.toContain('total')
    expect([...form.keys()]).not.toContain('shippingAmount')
  })

  it('preselects the first delivery method, because an order must leave by some method and none is not a choice', () => {
    renderCheckoutForm([
      makeRate({ id: 'standard', name: 'Standard' }),
      makeRate({ amountMinor: 1200, id: 'express', name: 'Express' }),
    ])

    const [standard, express] = screen.getAllByRole('radio') as HTMLInputElement[]
    /*
     * The opposite of §13.1c's rule about size, and deliberately so: a size the shop picks is a guess
     * about the customer's body, while a delivery method the shop picks is the cheapest eligible one,
     * visible, changeable, and re-validated on the server before anything is charged.
     */
    expect(standard).toBeChecked()
    expect(express).not.toBeChecked()
  })

  it('prices a zero-cost delivery method as Free, which here is a quote and not an absence', () => {
    renderCheckoutForm([makeRate({ amountMinor: 0, name: 'Standard' })])

    const label = (screen.getByRole('radio') as HTMLElement).closest('label') as HTMLElement
    /* The mirror image of the summary: this zero came back from the provider, so it may say Free. */
    expect(within(label).getByText('Free')).toBeInTheDocument()
  })

  it('prices a charged method in the bag’s currency, beside its own estimate', () => {
    renderCheckoutForm([
      makeRate({
        amountMinor: 1200,
        estimate: '1–2 business days',
        id: 'express',
        name: 'Express',
      }),
    ])

    const label = (screen.getByRole('radio') as HTMLElement).closest('label') as HTMLElement
    expect(within(label).getByText('£12.00')).toBeInTheDocument()
    expect(within(label).getByText('1–2 business days')).toBeInTheDocument()
  })

  it('pre-fills a signed-in customer’s email', () => {
    render(
      <CheckoutForm
        currency="GBP"
        defaultEmail="ada@example.com"
        locale={LOCALE}
        rates={[makeRate()]}
      />,
    )

    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com')
  })

  it('leaves a guest’s email empty rather than showing an address they have not given', () => {
    /* Rendered fresh rather than re-rendered: `defaultValue` seeds an uncontrolled input once, so a
     * rerender would assert React's reconciliation rather than what a guest actually sees. */
    renderCheckoutForm()

    expect(screen.getByLabelText('Email')).toHaveValue('')
  })

  it('asks for a two-letter country code rather than a country name, because "United Kingdom" is not a destination a rate engine can read', () => {
    renderCheckoutForm()

    const country = screen.getByLabelText('Country')
    expect(country).toHaveAttribute('maxLength', '2')
    expect(country).toHaveAttribute('placeholder', 'US')
  })
})

describe('CheckoutForm — the refusal, and the submit that cannot fire twice', () => {
  it('says nothing before the first attempt, because the browser does not know what preflight will find', () => {
    renderCheckoutForm()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the server’s refusal as an alert rather than an error page, because every preflight failure is one a customer can act on', async () => {
    const user = userEvent.setup()
    vi.mocked(startCheckoutAction).mockImplementation(async () => ({
      error: 'We do not deliver to that address.',
      field: 'address',
    }))

    renderCheckoutForm()

    await fillAddress(user)
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }))

    /*
     * `role="alert"` rather than a status: a refusal arrives after the customer has stopped reading
     * and pressed a button, and it is the reason nothing happened.
     */
    expect(await screen.findByRole('alert')).toHaveTextContent('We do not deliver to that address.')
  })

  it('marks the address fields invalid and points them at the refusal when the server names the address', async () => {
    const user = userEvent.setup()
    vi.mocked(startCheckoutAction).mockImplementation(async () => ({
      error: 'We do not deliver to that address.',
      field: 'address',
    }))

    renderCheckoutForm()

    await fillAddress(user)
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }))

    const alert = await screen.findByRole('alert')
    const country = screen.getByLabelText('Country')

    expect(country).toHaveAttribute('aria-invalid', 'true')
    expect(country).toHaveAttribute('aria-describedby', alert.id)
    /* The contact field is not what was refused. */
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid')
  })

  it('swaps the submit label while the handoff is in flight, so the wait is accounted for', async () => {
    const user = userEvent.setup()
    let settle: (state: CheckoutActionState) => void = () => {}
    vi.mocked(startCheckoutAction).mockImplementation(
      () =>
        new Promise<CheckoutActionState>((resolve) => {
          settle = resolve
        }),
    )

    renderCheckoutForm()

    await fillAddress(user)
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }))

    expect(
      await screen.findByRole('button', { name: 'Taking you to payment…' }),
    ).toBeInTheDocument()

    settle({ ...idle })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeInTheDocument(),
    )
  })

  it('never has two checkouts in flight at once, because two Stripe sessions for one bag are two things that can be paid', async () => {
    const user = userEvent.setup()
    let settle: (state: CheckoutActionState) => void = () => {}
    vi.mocked(startCheckoutAction).mockImplementation(
      () =>
        new Promise<CheckoutActionState>((resolve) => {
          settle = resolve
        }),
    )

    renderCheckoutForm()

    await fillAddress(user)
    const submit = screen.getByRole('button', { name: 'Continue to payment' })
    await user.click(submit)

    await waitFor(() => expect(startCheckoutAction).toHaveBeenCalledTimes(1))

    /*
     * An impatient second press while the first is still out. Nothing new leaves *while the first is
     * in flight* — `useActionState` runs its submissions one after another rather than concurrently,
     * so preflight can never be reading the bag twice at the same moment.
     *
     * What this deliberately does **not** claim is that the second press is discarded. It is queued,
     * and it is dispatched the moment the first settles — this button is neither `disabled` nor
     * `loading` while pending, unlike every other submit in the project. That is reported as a defect
     * rather than asserted here, because a test that pinned the current behaviour would make the fix
     * look like a regression.
     */
    await user.click(screen.getByRole('button', { name: 'Taking you to payment…' }))
    expect(startCheckoutAction).toHaveBeenCalledTimes(1)

    settle({ ...idle })
  })
})

describe('CheckoutForm — DEV-62, and the half of it that is not this component’s', () => {
  it('collects no card details, which is why this integration has no PCI surface at all', () => {
    renderCheckoutForm()

    /* Payment happens on Stripe's page. There is no field here to hold a number, now or later. */
    expect(screen.queryByLabelText(/card/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/cvc/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/expiry/i)).not.toBeInTheDocument()
  })

  it('says where the card is collected, which is the half of DEV-62 that belongs to the form', () => {
    renderCheckoutForm()

    expect(
      screen.getByText('Payment is handled by Stripe. Card details are never sent to this site.'),
    ).toBeInTheDocument()
  })

  it('does not itself claim payment is unavailable, because whether Stripe is configured is the route’s question', () => {
    renderCheckoutForm()

    /*
     * The other half of DEV-62 lives in `/checkout/page.tsx`, which holds the only call to
     * `isStripeConfigured()` and renders this form or the *"Online checkout isn't open yet"* panel —
     * never both. A form that also tried to say it would be a second source of that truth, drifting
     * from the first the moment keys were added.
     */
    expect(screen.queryByText(/not connected/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument()
    /* And the label names the handoff rather than the charge: this button takes nobody's money. */
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeInTheDocument()
  })
})
