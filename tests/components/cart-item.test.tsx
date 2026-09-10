import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CartLineRow } from '@/components/cart/cart-lines'
import { trackEvent } from '@/lib/analytics/track'
import type { CartActionState } from '@/lib/cart/action-state'
import { removeLineAction, setQuantityAction } from '@/lib/cart/actions'
import type { CartLineView } from '@/lib/cart/cart'
import { CART_COPY } from '@/lib/cart/rules'

/**
 * **`CartLineRow` — plan §27.1b's *"Cart item"*.**
 *
 * One row of the bag, in both places it renders (`/cart` and the drawer). What is worth asserting
 * here is not that it draws a photograph and a name; it is the four things §14.1e asks of a line
 * whose world changed under it, each of which the component decides rather than the server.
 *
 * 1. **The effective quantity is the one on screen.** `CartLineView` stores what the customer asked
 *    for *and* what the warehouse can still meet, and the subtotal is computed from the second. The
 *    source comment calls rendering the first *"a page that contradicts itself"* — a defect Phase
 *    14's first sweep found by dropping stock to 1 under a line holding 2. That is the headline, and
 *    it has a second half nobody looks at: the **steppers step from the effective number too**, so a
 *    line reduced to 1 asks for 2 when `+` is pressed, not 4.
 * 2. **An unbuyable line is shown, not hidden, and loses its controls.** §14.1e's *"product becomes
 *    unavailable"*. Hiding the row removes the evidence; leaving a live stepper on it is the
 *    project's cardinal sin — *"never build UI that looks functional but does nothing"*.
 * 3. **Every control names its product.** Three icon-only buttons in a list of six lines are three
 *    identical "Remove" announcements unless the name is in the label.
 * 4. **`+` at the ceiling is genuinely `disabled`**, not `aria-disabled`, and the source explains why
 *    the size selector's opposite choice does not transfer. A test that only checks the attribute
 *    would miss the point, so this one also checks that pressing it posts nothing.
 *
 * Everything below is queried by role and accessible name, and every mutation is asserted through
 * the `FormData` the component actually posts — because the browser is never authoritative here
 * either, and the only thing this component genuinely decides is *what to ask the server for*.
 */

/*
 * `@/lib/cart/actions` is a `'use server'` module: importing it for real drags in Payload, the
 * database and `next/headers`, and a Server Action cannot execute in jsdom regardless. Mocked at the
 * boundary the component imports, and nowhere deeper — the FormData that arrives here is the real
 * one React built from the real hidden inputs.
 */
vi.mock('@/lib/cart/actions', () => ({
  addToBagAction: vi.fn(),
  removeLineAction: vi.fn(),
  setQuantityAction: vi.fn(),
}))

/*
 * `trackEvent` is real-safe in jsdom (it guards, catches, and dispatches to nothing), but §25.1a's
 * `remove_from_cart` is a *behaviour* of this row — it fires on the server's answer, not on the
 * click — and the only way to assert that is to hold the dispatcher.
 */
vi.mock('@/lib/analytics/track', () => ({
  trackEvent: vi.fn(),
}))

const PRODUCT = 'The Merino Crew'

/** A healthy line. Every test names only the fields it is actually about. */
function makeLine(overrides: Partial<CartLineView> = {}): CartLineView {
  return {
    availability: {
      active: true,
      inventoryQuantity: 10,
      priceMinor: 8500,
      productPublished: true,
    },
    color: 'Ash',
    effectiveQuantity: 1,
    id: 41,
    image: null,
    maxQuantity: 10,
    productId: 7,
    productName: PRODUCT,
    productSlug: 'the-merino-crew',
    quantity: 1,
    size: 'M',
    sku: 'MC-ASH-M',
    unitPriceLabel: '£85.00',
    unitPriceMinor: 8500,
    variantId: 512,
    ...overrides,
  }
}

function renderRow(overrides: Partial<CartLineView> = {}) {
  return render(
    <ul>
      <CartLineRow currency="GBP" line={makeLine(overrides)} />
    </ul>,
  )
}

const ok: CartActionState = { notice: null, ok: true }

/** The `quantity` field of the nth `setQuantityAction` submission, as the server would read it. */
function submittedQuantity(call = 0): null | string {
  const formData = vi.mocked(setQuantityAction).mock.calls[call]?.[1]

  return formData instanceof FormData ? (formData.get('quantity') as null | string) : null
}

beforeEach(() => {
  vi.clearAllMocks()
  /*
   * Implementations are (re)installed per test rather than in the `vi.mock` factory: the shared
   * setup file calls `vi.restoreAllMocks()` after every test, and a mock left without an
   * implementation returns `undefined`, which `useActionState` would then store as the state.
   */
  vi.mocked(setQuantityAction).mockImplementation(async () => ({ ...ok }))
  vi.mocked(removeLineAction).mockImplementation(async () => ({ ...ok }))
})

describe('CartLineRow — the quantity a customer is actually shown', () => {
  it('renders the effective quantity, not the stored one, because a row reading 3 beside a subtotal charging for 1 is a page contradicting itself', () => {
    renderRow({ effectiveQuantity: 1, maxQuantity: 1, quantity: 3 })

    /*
     * The stepper's readout is the whole assertion. `1` is the number the bag will charge for; `3`
     * survives only inside the sentence that explains the difference, never as the quantity.
     */
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('3')).not.toBeInTheDocument()
  })

  it('explains the reduction in words rather than silently changing the number', () => {
    renderRow({ effectiveQuantity: 1, maxQuantity: 1, quantity: 3 })

    expect(
      screen.getByText('You asked for 3. Only 1 left, so that is what this line is for.'),
    ).toBeInTheDocument()
  })

  it('prefers the reduction sentence over the ceiling sentence, because a reduced line is always also at its ceiling', () => {
    renderRow({ effectiveQuantity: 2, maxQuantity: 2, quantity: 5 })

    expect(screen.getByText(/You asked for 5\./)).toBeInTheDocument()
    /* Two sentences saying the same thing twice would be noise; §14.1e wants the specific one. */
    expect(screen.queryByText(/That is all we have/)).not.toBeInTheDocument()
  })

  it('says how much is left on a line that reached the ceiling without being reduced', () => {
    renderRow({ effectiveQuantity: 4, maxQuantity: 4, quantity: 4 })

    expect(screen.getByText('That is all we have — 4 in stock.')).toBeInTheDocument()
  })

  it('says nothing extra about a line nowhere near its ceiling, because an unprompted stock sentence is pressure, not information', () => {
    renderRow({ effectiveQuantity: 2, maxQuantity: 10, quantity: 2 })

    expect(screen.queryByText(/That is all we have/)).not.toBeInTheDocument()
    expect(screen.queryByText(/You asked for/)).not.toBeInTheDocument()
  })

  it('announces the quantity in a polite live region, so a mutation that changes it is heard and not just seen', () => {
    renderRow({ effectiveQuantity: 2, quantity: 2 })

    /* The readout is the row's only live region; §3.1d asks for async status to be announced. */
    expect(screen.getByText('2')).toHaveAttribute('aria-live', 'polite')
  })
})

describe('CartLineRow — what the steppers post', () => {
  it('steps up from the effective quantity, so a line reduced to 3 asks the server for 4 and not 6', async () => {
    const user = userEvent.setup()
    renderRow({ effectiveQuantity: 3, maxQuantity: 4, quantity: 5 })

    await user.click(screen.getByRole('button', { name: `One more ${PRODUCT}` }))

    await waitFor(() => expect(setQuantityAction).toHaveBeenCalledTimes(1))
    /*
     * The half of the effective-quantity rule that is invisible on screen: posting `quantity + 1`
     * here would ask for 6 of something the warehouse has 4 of, and be clamped straight back to 4 —
     * a round trip that ends where it started, from a button the customer saw as `+`.
     */
    expect(submittedQuantity()).toBe('4')
  })

  it('steps down from the effective quantity too', async () => {
    const user = userEvent.setup()
    renderRow({ effectiveQuantity: 3, maxQuantity: 4, quantity: 5 })

    await user.click(screen.getByRole('button', { name: `One fewer ${PRODUCT}` }))

    await waitFor(() => expect(setQuantityAction).toHaveBeenCalledTimes(1))
    expect(submittedQuantity()).toBe('2')
  })

  it('posts the line id, because which row moves is the server’s decision and not the browser’s', async () => {
    const user = userEvent.setup()
    renderRow({ effectiveQuantity: 2, id: 41, quantity: 2 })

    await user.click(screen.getByRole('button', { name: `One more ${PRODUCT}` }))

    await waitFor(() => expect(setQuantityAction).toHaveBeenCalledTimes(1))
    const formData = vi.mocked(setQuantityAction).mock.calls[0]?.[1] as FormData
    expect(formData.get('lineId')).toBe('41')
  })

  it('renames minus to "Remove <product>" at a quantity of one, because submitting zero is what it actually does', () => {
    renderRow({ effectiveQuantity: 1, quantity: 1 })

    expect(screen.queryByRole('button', { name: `One fewer ${PRODUCT}` })).not.toBeInTheDocument()
    /* Two controls now carry that name — the stepper's minus and the row's X. Both remove. */
    expect(screen.getAllByRole('button', { name: `Remove ${PRODUCT}` })).toHaveLength(2)
  })

  it('submits a quantity of 0 from minus at one, which is the removal the server treats it as', async () => {
    const user = userEvent.setup()
    renderRow({ effectiveQuantity: 1, quantity: 1 })

    /*
     * Both buttons are named `Remove <product>` at this quantity, so they are told apart by which
     * action they post to rather than by their position: the stepper reaches `setQuantityAction`,
     * the X reaches `removeLineAction`. Clicking each in turn proves both really do remove.
     */
    const controls = screen.getAllByRole('button', { name: `Remove ${PRODUCT}` })
    for (const control of controls) {
      await user.click(control)
    }

    await waitFor(() => expect(setQuantityAction).toHaveBeenCalledTimes(1))
    expect(submittedQuantity()).toBe('0')
    expect(removeLineAction).toHaveBeenCalledTimes(1)
  })

  it('disables + at the ceiling genuinely, rather than aria-disabled, because a + that cannot go higher withholds nothing', async () => {
    const user = userEvent.setup()
    renderRow({ effectiveQuantity: 4, maxQuantity: 4, quantity: 4 })

    const plus = screen.getByRole('button', { name: `One more ${PRODUCT}` })
    expect(plus).toBeDisabled()

    await user.click(plus)

    /*
     * The assertion the attribute alone does not make. `aria-disabled` would leave a control that
     * looks inert and still posts — the round trip spent only to be clamped back to where it
     * started. Nothing may reach the server from here.
     */
    expect(setQuantityAction).not.toHaveBeenCalled()
  })

  it('leaves minus enabled at the ceiling, because a full line is one you may still want less of', () => {
    renderRow({ effectiveQuantity: 4, maxQuantity: 4, quantity: 4 })

    expect(screen.getByRole('button', { name: `One fewer ${PRODUCT}` })).toBeEnabled()
  })

  it('offers no free-text quantity box, because in the bag minus and plus are the whole vocabulary', () => {
    renderRow({ effectiveQuantity: 2, quantity: 2 })

    /* A number field here is a way to type 40 and be told no; the product page is where it belongs. */
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows the pending marker in the live region while a quantity mutation is in flight', async () => {
    const user = userEvent.setup()
    let settle: (state: CartActionState) => void = () => {}
    vi.mocked(setQuantityAction).mockImplementation(
      () =>
        new Promise<CartActionState>((resolve) => {
          settle = resolve
        }),
    )

    renderRow({ effectiveQuantity: 2, maxQuantity: 9, quantity: 2 })

    await user.click(screen.getByRole('button', { name: `One more ${PRODUCT}` }))

    /* The number is replaced, not merely dimmed, so the readout never asserts a total that is being
     * renegotiated on the server. */
    await waitFor(() => expect(screen.getByText('…')).toBeInTheDocument())
    expect(screen.queryByText('2')).not.toBeInTheDocument()

    settle({ ...ok })

    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
  })

  it('shows the server’s notice once the action answers, rather than inventing one on click', async () => {
    const user = userEvent.setup()
    vi.mocked(setQuantityAction).mockImplementation(async () => ({
      notice: 'Only 4 left, so that is what we added.',
      ok: true,
    }))

    renderRow({ effectiveQuantity: 2, maxQuantity: 9, quantity: 2 })

    /* Nothing before the round trip: the browser does not know what the warehouse will say. */
    expect(screen.queryByText(/Only 4 left/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: `One more ${PRODUCT}` }))

    expect(await screen.findByText('Only 4 left, so that is what we added.')).toBeInTheDocument()
  })

  it('shows a refused quantity mutation as a notice, so a stepper that did nothing says so', async () => {
    const user = userEvent.setup()
    vi.mocked(setQuantityAction).mockImplementation(async () => ({
      notice: CART_COPY.mutationFailed,
      ok: false,
    }))

    renderRow({ effectiveQuantity: 2, maxQuantity: 9, quantity: 2 })

    await user.click(screen.getByRole('button', { name: `One more ${PRODUCT}` }))

    expect(await screen.findByText(CART_COPY.mutationFailed)).toBeInTheDocument()
  })
})

describe('CartLineRow — a line that cannot be bought', () => {
  it('renders its state instead of a stepper when the variant ran out, because hiding the line removes the evidence', () => {
    renderRow({ effectiveQuantity: 0, maxQuantity: 0, quantity: 2 })

    expect(screen.getByText(CART_COPY.lineUnavailable)).toBeInTheDocument()
    /*
     * The whole of §14.1e's *"product becomes unavailable"*: the row keeps its identity and loses
     * exactly the controls that would lie. Counting the buttons is the assertion — a stepper whose
     * minus happens to be renamed `Remove <product>` would otherwise slip past a name-based query.
     */
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: `Remove ${PRODUCT}` })).toBeInTheDocument()
  })

  it('treats a variant with stock but no usable price as unbuyable, because a price the browser invents is not a price', () => {
    renderRow({ maxQuantity: 5, unitPriceLabel: null, unitPriceMinor: null })

    expect(screen.getByText(CART_COPY.lineUnavailable)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `One more ${PRODUCT}` })).not.toBeInTheDocument()
    /* An em dash where the price was, rather than a stale or zero figure. */
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('keeps the name and the removal control on an unavailable line, so the customer can act on it', () => {
    renderRow({ effectiveQuantity: 0, maxQuantity: 0, quantity: 2 })

    expect(screen.getByText(PRODUCT)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Remove ${PRODUCT}` })).toBeEnabled()
  })

  it('suppresses the stock sentences on an unavailable line, because "that is all we have" of nothing is nonsense', () => {
    renderRow({ effectiveQuantity: 0, maxQuantity: 0, quantity: 2 })

    expect(screen.queryByText(/That is all we have/)).not.toBeInTheDocument()
    expect(screen.queryByText(/You asked for/)).not.toBeInTheDocument()
  })
})

describe('CartLineRow — the link, and where it refuses to go', () => {
  it('links a published product to its own page', () => {
    renderRow()

    expect(screen.getByRole('link', { name: PRODUCT })).toHaveAttribute(
      'href',
      '/product/the-merino-crew',
    )
  })

  it('does not link an unpublished product, because /product/<slug> 404s the moment it stops being listable', () => {
    renderRow({
      availability: {
        active: true,
        inventoryQuantity: 10,
        priceMinor: 8500,
        productPublished: false,
      },
    })

    /* A dead link inside the bag is the one place a shopper is least willing to be sent nowhere. */
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText(PRODUCT)).toBeInTheDocument()
  })

  it('does not link a line whose availability could not be read at all', () => {
    renderRow({ availability: null, maxQuantity: 0 })

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText(PRODUCT)).toBeInTheDocument()
  })

  it('does not link a line with no slug, even when the product is still published', () => {
    renderRow({ productSlug: '' })

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('CartLineRow — variant identity and removal', () => {
  it('joins colour and size for the screen reader, and falls back to an em dash when the variant has neither', () => {
    const { rerender } = renderRow({ color: 'Ash', size: 'M' })
    expect(screen.getByText('Ash · M')).toBeInTheDocument()

    rerender(
      <ul>
        <CartLineRow currency="GBP" line={makeLine({ color: null, size: null })} />
      </ul>,
    )
    /* Never an empty line: the row's shape must not change with the data in it. */
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('names the product in the remove control, so a bag of six does not announce "Remove" six times', () => {
    renderRow({ effectiveQuantity: 2, quantity: 2 })

    expect(screen.getByRole('button', { name: `Remove ${PRODUCT}` })).toBeInTheDocument()
  })

  it('reports §25.1a remove_from_cart only after the server says the removal happened', async () => {
    const user = userEvent.setup()
    renderRow({ effectiveQuantity: 2, quantity: 2 })

    /* Instrumenting the click would report a removal that a rejected action never performed. */
    expect(trackEvent).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: `Remove ${PRODUCT}` }))

    await waitFor(() => expect(trackEvent).toHaveBeenCalledTimes(1))
    expect(trackEvent).toHaveBeenCalledWith('remove_from_cart', {
      currency: 'GBP',
      items: [
        {
          itemId: '7',
          itemName: PRODUCT,
          priceMinor: 8500,
          quantity: 2,
          variant: 'Ash / M',
        },
      ],
      valueMinor: 17000,
    })
  })

  it('reports nothing when the removal was refused, because a removal that did not happen is not one to report', async () => {
    const user = userEvent.setup()
    vi.mocked(removeLineAction).mockImplementation(async () => ({
      notice: CART_COPY.mutationFailed,
      ok: false,
    }))

    renderRow({ effectiveQuantity: 2, quantity: 2 })

    await user.click(screen.getByRole('button', { name: `Remove ${PRODUCT}` }))

    await waitFor(() => expect(removeLineAction).toHaveBeenCalledTimes(1))
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('reports the effective quantity to analytics, not the stored one, because that is what the bag was charging for', async () => {
    const user = userEvent.setup()
    /* Stepped down to 2 rather than 1, so the row's minus keeps its own name and the removal
     * control stays unambiguous — the reduction is what is under test, not the naming. */
    renderRow({ effectiveQuantity: 2, maxQuantity: 2, quantity: 5 })

    await user.click(screen.getByRole('button', { name: `Remove ${PRODUCT}` }))

    await waitFor(() => expect(trackEvent).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(trackEvent).mock.calls[0]?.[1] as {
      items: { quantity: number }[]
      valueMinor: number
    }
    /* 2 × £85.00, not 5 × £85.00 — the funnel must agree with the invoice. */
    expect(payload.items[0]?.quantity).toBe(2)
    expect(payload.valueMinor).toBe(17000)
  })

  it('reports a null value rather than zero for an unpriced line, because "free" and "unknown" are different facts', async () => {
    const user = userEvent.setup()
    renderRow({
      effectiveQuantity: 2,
      quantity: 2,
      unitPriceLabel: null,
      unitPriceMinor: null,
    })

    await user.click(screen.getByRole('button', { name: `Remove ${PRODUCT}` }))

    await waitFor(() => expect(trackEvent).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(trackEvent).mock.calls[0]?.[1] as { valueMinor: null | number }
    expect(payload.valueMinor).toBeNull()
  })
})
