import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CartActionState } from '@/lib/cart/action-state'
import { QUANTITY_HARD_CAP } from '@/lib/cart/rules'

/**
 * **Plan §27.1b's "Quantity control"** — `AddToBag` in `src/components/cart/add-to-bag.tsx`, which
 * is the only control on the site that turns browsing into buying.
 *
 * Three properties are worth a test here, and none of them is markup.
 *
 * 1. **The ceiling is derived, not stored.** §13.1b's stepper is bounded by live stock capped by
 *    policy, and both can move under a customer between renders — a size change, or someone else
 *    buying the last two. The component clamps during render rather than reconciling in an effect,
 *    so the assertions below drive `maxQuantity` down *and back up*: a stored-and-corrected value
 *    cannot come back, a derived one must.
 * 2. **Disabled means cannot be bought.** No size chosen and zero stock are the two states where
 *    pressing the button cannot succeed, and the project's spine is *"never build UI that looks
 *    functional but does nothing"*. So the tests assert the control is inert *and* that the reason
 *    is somewhere assistive technology reads, not only somewhere sighted eyes land.
 * 3. **The browser is never authoritative.** What the form posts is a variant id and a whole
 *    number — §13.1d's *"never trust a client-submitted price"* is satisfied by there being nothing
 *    to trust — so one test asserts the *complete* set of posted field names, not merely the
 *    presence of the two that should be there.
 *
 * Everything is queried by role and accessible name. There is no snapshot: §27.1 asks for
 * business-critical logic and user flows over superficial coverage.
 */

/*
 * `addToBagAction` is a `'use server'` module: it imports `next/cache`, the session and the Payload
 * client, and it cannot run in jsdom. It is replaced by a mock that records the `FormData` React
 * hands it and returns a `CartActionState` — the same two-field contract the real action returns —
 * which is the whole of what this component is allowed to know about the server.
 *
 * `trackEvent` is mocked because §25.1a's `add_to_cart` firing *only* on a server yes is a rule this
 * component owns, and the real dispatcher deliberately no-ops when no vendor is registered, so it
 * would swallow the assertion rather than answer it.
 */
const { addToBagAction, trackEvent } = vi.hoisted(() => ({
  addToBagAction:
    vi.fn<(previous: CartActionState, formData: FormData) => Promise<CartActionState>>(),
  trackEvent: vi.fn<(event: string, payload: Record<string, unknown>) => void>(),
}))

vi.mock('@/lib/cart/actions', () => ({ addToBagAction }))
vi.mock('@/lib/analytics/track', () => ({ trackEvent }))
/*
 * `AddToBag` opens the cart drawer on a successful add (structure §13, Phase 30), so it lives inside
 * `ShellOverlayProvider` — which reads the pathname to close overlays on navigation.
 */
vi.mock('next/navigation', () => ({ usePathname: () => '/product/rolled-neck-sweater' }))

const { AddToBag } = await import('@/components/cart/add-to-bag')
const { ShellOverlayProvider, useShellOverlay } = await import('@/components/shell/overlay-context')

/** Reports whether the bag is open, so a test can see the drawer being asked for without the drawer. */
function CartOpenProbe() {
  const { isOpen } = useShellOverlay()

  return <output data-testid="cart-open">{isOpen('cart') ? 'open' : 'closed'}</output>
}

type AddToBagProps = ComponentProps<typeof AddToBag>

const BASE: AddToBagProps = {
  currency: 'GBP',
  disabledReason: null,
  item: {
    itemId: '18',
    itemName: 'Rolled Neck Sweater',
    priceMinor: 24000,
    variant: 'Bone / M',
  },
  maxQuantity: 10,
  variantId: 42,
}

function renderControl(overrides: Partial<AddToBagProps> = {}) {
  const props = { ...BASE, ...overrides }
  const tree = (extra: Partial<AddToBagProps> = {}) => (
    <ShellOverlayProvider>
      <AddToBag {...props} {...extra} />
      <CartOpenProbe />
    </ShellOverlayProvider>
  )
  const view = render(tree())

  return {
    ...view,
    rerenderWith: (next: Partial<AddToBagProps>) => view.rerender(tree(next)),
  }
}

/** The stepper, addressed the way a screen reader addresses it. */
const quantityField = () => screen.getByRole('spinbutton', { name: 'Qty' })

/**
 * **Replace what the field holds** — and `userEvent` cannot express this here.
 *
 * The input is a **controlled** `type="number"`. `user.clear()` fires a change carrying `''`, the
 * component reads `Number('') === 0`, the floor turns that into `1`, and React re-renders the field
 * showing "1" **before the next keystroke lands**. Typing then appends to that 1, so
 * `clear()` + `type('8')` produces **18**, not 8 — a fact about a controlled value, not about the
 * component being wrong. Two of the tests below passed under that mistake for entirely the wrong
 * reason (`type('9')` against a ceiling of 3 clamps to 3 whether the field held 9 or 19), which is
 * worse than failing.
 *
 * A real replacement — select-all then type, or a paste — delivers **one** change event carrying the
 * final string. That is what this sends. Selection APIs are not an option: jsdom throws on
 * `setSelectionRange` for a number input.
 */
const setQuantity = (value: string) => fireEvent.change(quantityField(), { target: { value } })

const addButton = (name: RegExp | string = 'Add to bag') => screen.getByRole('button', { name })

/** Field names only — the assertion built on this is about what does *not* cross the boundary. */
function fieldNamesOf(formData: FormData): string[] {
  return [...formData.keys()]
}

function valueOf(formData: FormData, name: string): string {
  return String(formData.get(name))
}

beforeEach(() => {
  addToBagAction.mockReset()
  addToBagAction.mockResolvedValue({ notice: null, ok: true })
  trackEvent.mockReset()
})

describe('AddToBag — the quantity control (§27.1b)', () => {
  describe('the field, and how it is described', () => {
    it('gives the number box the accessible name "Qty", because an unlabelled stepper is a number a screen reader cannot place', () => {
      renderControl()

      expect(quantityField()).toBeInTheDocument()
    })

    it('opens at one and never preselects more, because §13.1c does not choose on the customer behalf', () => {
      renderControl()

      expect(quantityField()).toHaveValue(1)
    })

    it('wires the "up to N available" hint with aria-describedby, so the ceiling is heard and not only seen', () => {
      renderControl({ maxQuantity: 4 })

      /*
       * `toHaveAccessibleDescription` resolves `aria-describedby` the way a screen reader does — a
       * hint that exists in the DOM but is not referenced would fail here, which is the point.
       */
      expect(quantityField()).toHaveAccessibleDescription('Up to 4 available')
    })

    it('publishes the same bounds as HTML attributes, so a browser with no JavaScript enforces the ceiling too', () => {
      renderControl({ maxQuantity: 4 })

      /*
       * Load-bearing rather than cosmetic: the component is a real `<form>` posting to a Server
       * Action precisely so it still works before React arrives, and before React arrives `min` and
       * `max` are the only clamp there is.
       */
      const field = quantityField()

      expect(field).toHaveAttribute('min', '1')
      expect(field).toHaveAttribute('max', '4')
      expect(field).toHaveAttribute('step', '1')
    })
  })

  describe('the ceiling is derived from props, not stored', () => {
    it('lowers the displayed quantity as soon as maxQuantity drops beneath it, with no effect to wait for', async () => {
      const { rerenderWith } = renderControl({ maxQuantity: 10 })

      setQuantity('8')
      expect(quantityField()).toHaveValue(8)

      /* Stock moved under the customer. No `waitFor`: the corrected value is in this render. */
      rerenderWith({ maxQuantity: 3 })

      expect(quantityField()).toHaveValue(3)
      expect(quantityField()).toHaveAttribute('max', '3')
    })

    it('restores the number the customer asked for when the ceiling rises again, which a stored-and-corrected value could not', async () => {
      const { rerenderWith } = renderControl({ maxQuantity: 10 })

      setQuantity('8')

      rerenderWith({ maxQuantity: 3 })
      expect(quantityField()).toHaveValue(3)

      /*
       * This is the assertion that tells derived from stored. An effect that wrote 3 back into
       * state would have destroyed the 8; deriving it keeps the request intact and clamps only the
       * view.
       */
      rerenderWith({ maxQuantity: 10 })

      expect(quantityField()).toHaveValue(8)
    })

    it('caps the ceiling at QUANTITY_HARD_CAP however much stock the caller reports, because a larger quantity cannot be stored', async () => {
      renderControl({ maxQuantity: 5000 })

      expect(quantityField()).toHaveAttribute('max', String(QUANTITY_HARD_CAP))

      setQuantity('5000')

      expect(quantityField()).toHaveValue(QUANTITY_HARD_CAP)
    })

    it('clamps a typed number down to the ceiling rather than posting one the server would only refuse', async () => {
      renderControl({ maxQuantity: 3 })

      setQuantity('9')

      expect(quantityField()).toHaveValue(3)
    })

    it('holds the floor at one, because stepping below one is a removal and removal belongs to the bag', async () => {
      renderControl()

      setQuantity('0')

      expect(quantityField()).toHaveValue(1)
    })

    it('falls back to one when what the field holds is not a number, so the form can never post a blank quantity', async () => {
      renderControl()

      /*
       * Emptying it is the reachable form: `Number('')` is `0`, which the floor turns back into 1.
       */
      setQuantity('')
      expect(quantityField()).toHaveValue(1)

      /*
       * And the defensive half. A `type="number"` input reports unparseable content to a real
       * browser as `''`, so `Number.isFinite` looks unreachable — but it is the guard that holds if
       * anything ever writes a non-numeric string into this field, and a change event is how that
       * would arrive.
       */
      setQuantity('abc')
      expect(quantityField()).toHaveValue(1)
    })
  })

  describe('what it refuses to do', () => {
    it('disables both the stepper and Add to bag until a size is chosen, because variantId is null until §13.1c gets an answer', () => {
      renderControl({ variantId: null })

      expect(quantityField()).toBeDisabled()
      expect(addButton()).toBeDisabled()
    })

    it('disables both when the chosen size is sold out, because a control that cannot succeed must not look like one that can', () => {
      renderControl({ disabledReason: 'Sold out in this size.', maxQuantity: 0 })

      expect(quantityField()).toBeDisabled()
      expect(addButton()).toBeDisabled()
    })

    it('does not reach the server when the disabled button is clicked, so nothing is left to the styling', async () => {
      const user = userEvent.setup()
      renderControl({ maxQuantity: 0 })

      await user.click(addButton())

      /*
       * jsdom applies no Tailwind, so `disabled:pointer-events-none` is not what stops this — the
       * real `disabled` attribute is. That is the property worth pinning: the refusal survives a
       * stylesheet that failed to load.
       */
      expect(addToBagAction).not.toHaveBeenCalled()
    })

    it('drops the "up to N available" description when nothing can be added, because a ceiling on a dead control is noise', () => {
      renderControl({ maxQuantity: 0 })

      expect(quantityField()).toHaveAccessibleDescription('')
      expect(screen.queryByText(/available/i)).not.toBeInTheDocument()
    })

    it('puts the reason it cannot be bought in a polite live region, so the refusal is announced and not merely displayed', () => {
      renderControl({ disabledReason: 'Sold out in this size.', maxQuantity: 0 })

      const reason = screen.getByText('Sold out in this size.')

      expect(reason).toHaveAttribute('aria-live', 'polite')
    })

    it('shows the disabled reason in preference to the last server notice, because the current state outranks the previous answer', async () => {
      const user = userEvent.setup()
      addToBagAction.mockResolvedValue({ notice: 'Only 2 left, so we added 2.', ok: true })
      const { rerenderWith } = renderControl()

      await user.click(addButton())
      expect(await screen.findByText('Only 2 left, so we added 2.')).toBeInTheDocument()

      /* The last two just went. The stale clamp notice must not survive the sell-out. */
      rerenderWith({ disabledReason: 'Sold out in this size.', maxQuantity: 0 })

      expect(screen.getByText('Sold out in this size.')).toBeInTheDocument()
      expect(screen.queryByText('Only 2 left, so we added 2.')).not.toBeInTheDocument()
    })
  })

  describe('what it posts', () => {
    it('posts the variant id and a whole number and nothing else, because no price crosses the boundary (§13.1d)', async () => {
      const user = userEvent.setup()
      renderControl({ maxQuantity: 10, variantId: 42 })

      await user.click(addButton())

      await waitFor(() => expect(addToBagAction).toHaveBeenCalledTimes(1))

      const posted = addToBagAction.mock.calls[0][1]

      /*
       * Asserted as the *complete* field list rather than by picking out the two expected names: a
       * price, a product name or an availability flag added to this form would still satisfy a
       * `toHaveBeenCalledWith` on variantId and quantity, and would fail here.
       */
      expect(fieldNamesOf(posted)).toEqual(['variantId', 'quantity'])
      expect(valueOf(posted, 'variantId')).toBe('42')
      expect(valueOf(posted, 'quantity')).toBe('1')
    })

    it('posts the clamped quantity, never the larger one that was typed over the ceiling', async () => {
      const user = userEvent.setup()
      renderControl({ maxQuantity: 3 })

      setQuantity('9')
      await user.click(addButton())

      await waitFor(() => expect(addToBagAction).toHaveBeenCalledTimes(1))

      expect(valueOf(addToBagAction.mock.calls[0][1], 'quantity')).toBe('3')
    })

    it('changes the label to "Adding…" while the action is in flight, so the wait is visible', async () => {
      const user = userEvent.setup()
      let settle: (state: CartActionState) => void = () => {}
      addToBagAction.mockImplementation(
        () =>
          new Promise<CartActionState>((resolve) => {
            settle = resolve
          }),
      )

      renderControl()

      await user.click(addButton())

      expect(await screen.findByRole('button', { name: 'Adding…' })).toBeInTheDocument()

      settle({ notice: null, ok: true })

      await waitFor(() => expect(addButton()).toBeInTheDocument())
    })

    it('keeps Add to bag pressable while pending, because a second deliberate click is a second item and not a mis-click', async () => {
      const user = userEvent.setup()
      let settle: (state: CartActionState) => void = () => {}
      addToBagAction.mockImplementation(
        () =>
          new Promise<CartActionState>((resolve) => {
            settle = resolve
          }),
      )

      renderControl()

      await user.click(addButton())

      /*
       * A deliberate trade recorded in the component's own docblock: adding is not idempotent, and
       * disabling mid-flight would drop the second of two intended clicks on the one control whose
       * job is to accept them. The sum is clamped server-side either way.
       */
      expect(await screen.findByRole('button', { name: 'Adding…' })).toBeEnabled()

      settle({ notice: null, ok: true })

      await waitFor(() => expect(addButton()).toBeInTheDocument())
    })

    it('announces the server refusal in the same live region, because a rejected add must be heard and not only seen', async () => {
      const user = userEvent.setup()
      addToBagAction.mockResolvedValue({ notice: 'That size just sold out.', ok: false })

      renderControl()

      await user.click(addButton())

      const notice = await screen.findByText('That size just sold out.')

      expect(notice).toHaveAttribute('aria-live', 'polite')
    })
  })

  describe('§25.1a — the event is fired where it is true', () => {
    it('reports add_to_cart only after the server said yes', async () => {
      const user = userEvent.setup()
      renderControl({ maxQuantity: 10 })

      setQuantity('3')
      await user.click(addButton())

      await waitFor(() => expect(trackEvent).toHaveBeenCalledTimes(1))

      expect(trackEvent).toHaveBeenCalledWith('add_to_cart', {
        currency: 'GBP',
        items: [{ ...BASE.item, quantity: 3 }],
        /* Minor units, multiplied here rather than trusted from anywhere: 24000 x 3. */
        valueMinor: 72000,
      })
    })

    it('reports nothing when the server refused, because an event fired on the click would report an add that never happened', async () => {
      const user = userEvent.setup()
      addToBagAction.mockResolvedValue({ notice: 'That size just sold out.', ok: false })

      renderControl()

      await user.click(addButton())

      await waitFor(() => expect(addToBagAction).toHaveBeenCalledTimes(1))
      await screen.findByText('That size just sold out.')

      expect(trackEvent).not.toHaveBeenCalled()
    })

    it('reports the quantity that was asked for, not the one the server may have clamped it to', async () => {
      const user = userEvent.setup()
      /* The server took two of the three asked for and said so; the event still says three. */
      addToBagAction.mockResolvedValue({ notice: 'Only 2 left, so we added 2.', ok: true })

      renderControl({ maxQuantity: 10 })

      setQuantity('3')
      await user.click(addButton())

      await waitFor(() => expect(trackEvent).toHaveBeenCalledTimes(1))

      const payload = trackEvent.mock.calls[0][1] as { items: Array<{ quantity: number }> }

      /*
       * A discrepancy worth having rather than a number invented to hide it: the component is not
       * told what the server clamped to, so reporting anything but the request would be a guess.
       */
      expect(payload.items[0].quantity).toBe(3)
    })
  })

  describe('structure §13 — "Add to Bag → Cart drawer"', () => {
    it('opens the bag when the server said yes, so the customer sees what they just added', async () => {
      const user = userEvent.setup()
      renderControl()

      expect(screen.getByTestId('cart-open')).toHaveTextContent('closed')

      await user.click(addButton())

      await waitFor(() => expect(screen.getByTestId('cart-open')).toHaveTextContent('open'))
    })

    it('leaves the bag closed when the server refused, because an open bag would show an add that never happened', async () => {
      const user = userEvent.setup()
      addToBagAction.mockResolvedValue({ notice: 'That size just sold out.', ok: false })

      renderControl()

      await user.click(addButton())
      await screen.findByText('That size just sold out.')

      expect(screen.getByTestId('cart-open')).toHaveTextContent('closed')
    })
  })
})
