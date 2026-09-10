/**
 * **The wishlist heart** — plan §27.1b's *"Wishlist button"*, over `components/wishlist/wishlist-button.tsx`.
 *
 * This file is one component's name and two entirely different machines, which is the whole reason it
 * is worth a test. Signed in, the heart is a real `<form>` posting to a server action against
 * `wishlist-items`. Signed out, it is a client control writing to `localStorage`, because §20.1a gives
 * a guest an *"optional local wishlist"* and `WishlistItems` declined to build a guest table. A test
 * that only mounted one of them would leave half the feature unasserted.
 *
 * What is actually worth asserting here, in the order it matters:
 *
 * 1. **The first render is already correct.** The source is explicit that a heart which is briefly
 *    empty reads as *"it did not save"*, so `savedForCustomer` (signed in) and the device list
 *    (signed out) must both be pressed on the very first paint, with nothing awaited.
 * 2. **The guest branch is not a form.** §0.1.17 forbids a control that submits and achieves nothing,
 *    and a signed-out wishlist post has no server to reach. A form here would be that fake control.
 * 3. **The server's answer wins, not the click.** A refused save must leave the heart unpressed and
 *    must emit no `add_to_wishlist` — the browser is never authoritative, including about its own
 *    optimism.
 * 4. **The control refuses a second submission while one is in flight**, and says so with `disabled`.
 * 5. **State lives in `aria-pressed`, not in a changing accessible name**, which is the decision the
 *    source records against relabelling the button under the cursor.
 *
 * Mocked: `@/lib/wishlist/actions` (a `'use server'` module — it reaches Payload, a Postgres pool and
 * `next/cache`, none of which exist in jsdom) and `@/lib/analytics/track` (so the events §25.1a wants
 * can be asserted instead of dispatched into a vendor that is not configured). Everything else —
 * `IconButton`, `createLocalList`, `lib/wishlist/rules`, `useActionResult` — is the real module, because
 * each one is part of what is being tested.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WishlistButton, WishlistControl } from '@/components/wishlist/wishlist-button'
import type { WishlistActionState } from '@/lib/wishlist/action-state'
import { GUEST_WISHLIST_KEY, WISHLIST_COPY } from '@/lib/wishlist/rules'

/*
 * `'use server'` modules cannot run in jsdom: they open a Payload client and call `revalidatePath`.
 * The mock keeps the only contract the component depends on — `(previousState, formData) => state` —
 * so what is asserted is how the control reacts to the server's answer, which is the part that lives
 * in this file.
 */
const actions = vi.hoisted(() => ({
  removeFromWishlistAction: vi.fn(),
  saveToWishlistAction: vi.fn(),
}))

vi.mock('@/lib/wishlist/actions', () => actions)

/* Mocked to be asserted, not to be silenced: §25.1a's events are half of what this control owes. */
const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }))

vi.mock('@/lib/analytics/track', () => analytics)

const PRODUCT_ID = 42
const ITEM_NAME = 'Merino Crew'
const ITEM = { itemId: '42', itemName: ITEM_NAME }

const SAVED: WishlistActionState = { notice: null, ok: true, saved: true }
const REMOVED: WishlistActionState = { notice: WISHLIST_COPY.removed, ok: true, saved: false }
const UNAVAILABLE: WishlistActionState = {
  notice: WISHLIST_COPY.unavailable,
  ok: false,
  saved: false,
}

/** Each call returns a fresh object: `useActionResult` compares by identity, as its docblock explains. */
const answers = (state: WishlistActionState) => async () => ({ ...state })

const seedDevice = (ids: unknown) =>
  window.localStorage.setItem(GUEST_WISHLIST_KEY, JSON.stringify(ids))

const readDevice = (): unknown =>
  JSON.parse(window.localStorage.getItem(GUEST_WISHLIST_KEY) ?? 'null')

const heart = () => screen.getByRole('button')

beforeEach(() => {
  window.localStorage.clear()
  analytics.trackEvent.mockReset()
  actions.saveToWishlistAction.mockReset().mockImplementation(answers(SAVED))
  actions.removeFromWishlistAction.mockReset().mockImplementation(answers(REMOVED))
})

describe('WishlistButton, signed out — the device-local list', () => {
  it('is named by its label and not by its icon, because §06 says an icon is not a name', () => {
    render(
      <WishlistButton
        itemName={ITEM_NAME}
        productId={PRODUCT_ID}
        savedForCustomer={false}
        signedIn={false}
      />,
    )

    /*
     * An exact accessible name, not a substring: it proves the `<Heart>` inside contributes nothing to
     * the name, which is what `aria-hidden` on the icon is for.
     */
    expect(heart()).toHaveAccessibleName(WISHLIST_COPY.save)
  })

  it('starts unpressed on a device that has saved nothing', () => {
    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn={false} />)

    expect(heart()).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders the device saved state in the first render, because a heart that starts empty reads as "it did not save"', () => {
    seedDevice([PRODUCT_ID])

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn={false} />)

    /* Asserted synchronously — no `waitFor`, no `findBy`. A second paint would already be too late. */
    expect(heart()).toHaveAttribute('aria-pressed', 'true')
    expect(heart()).toHaveAccessibleName(WISHLIST_COPY.saved)
  })

  it('ignores savedForCustomer when nobody is signed in, because that flag describes an account this visitor does not have', () => {
    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer signedIn={false} />)

    expect(heart()).toHaveAttribute('aria-pressed', 'false')
  })

  it('is not a form for a guest, because a wishlist post with no session would submit and achieve nothing (§0.1.17)', async () => {
    const user = userEvent.setup()

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn={false} />)

    expect(heart()).toHaveAttribute('type', 'button')
    /* Nothing to post to: the guest branch must not be wrapped in a form at all. */
    expect(heart().closest('form')).toBeNull()

    await user.click(heart())

    expect(actions.saveToWishlistAction).not.toHaveBeenCalled()
    expect(actions.removeFromWishlistAction).not.toHaveBeenCalled()
  })

  it('flips aria-pressed and the label when a guest saves, so the state lives on the control', async () => {
    const user = userEvent.setup()

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn={false} />)

    await user.click(heart())

    expect(heart()).toHaveAttribute('aria-pressed', 'true')
    expect(heart()).toHaveAccessibleName(WISHLIST_COPY.saved)
  })

  it('writes the product id to the namespaced key, which is what the merge on sign-in reads', async () => {
    const user = userEvent.setup()

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn={false} />)

    await user.click(heart())

    /* §20.1b's merge is fed from exactly this key; a write anywhere else would be lost on sign-in. */
    expect(readDevice()).toEqual([PRODUCT_ID])
  })

  it('un-saves on a second press and leaves the stored list empty rather than stale', async () => {
    const user = userEvent.setup()

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn={false} />)

    await user.click(heart())
    await user.click(heart())

    expect(heart()).toHaveAttribute('aria-pressed', 'false')
    expect(readDevice()).toEqual([])
  })

  it('reports the guest toggle to analytics at the moment of the write, because a device write is its own outcome', async () => {
    const user = userEvent.setup()

    render(
      <WishlistButton
        itemName={ITEM_NAME}
        productId={PRODUCT_ID}
        savedForCustomer={false}
        signedIn={false}
      />,
    )

    await user.click(heart())

    expect(analytics.trackEvent).toHaveBeenCalledWith('add_to_wishlist', { items: [ITEM] })

    await user.click(heart())

    /* The pair matters: an add that is never balanced by a remove makes the §25.1a report a wish. */
    expect(analytics.trackEvent).toHaveBeenLastCalledWith('remove_from_wishlist', { items: [ITEM] })
  })

  it('renders unpressed rather than failing when the stored list is not JSON, because a corrupt store is a shorter list and not a broken page', () => {
    window.localStorage.setItem(GUEST_WISHLIST_KEY, '{not json')

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn={false} />)

    expect(heart()).toHaveAttribute('aria-pressed', 'false')
  })

  it('does not treat a hand-edited string id as a match, because a store the customer can edit is an untrusted input', () => {
    /* `"42"` is what somebody typing into devtools produces. `readGuestWishlist` drops it. */
    seedDevice(['42', -PRODUCT_ID, PRODUCT_ID + 0.5])

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn={false} />)

    expect(heart()).toHaveAttribute('aria-pressed', 'false')
  })

  it('follows the same device list when another tab writes it, because two tabs showing different wishlists are both wrong', async () => {
    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn={false} />)

    expect(heart()).toHaveAttribute('aria-pressed', 'false')

    /* What a second tab's save looks like from here: storage already changed, then the event lands. */
    await act(async () => {
      seedDevice([PRODUCT_ID])
      window.dispatchEvent(new StorageEvent('storage', { key: GUEST_WISHLIST_KEY }))
    })

    expect(heart()).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('WishlistButton, signed in — the server action', () => {
  it('shows the server-resolved saved state in the first render, before anything is pressed', () => {
    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer signedIn />)

    /* `savedForCustomer` is the page's own answer; the control must open with it, not converge on it. */
    expect(heart()).toHaveAttribute('aria-pressed', 'true')
    expect(heart()).toHaveAccessibleName(WISHLIST_COPY.saved)
  })

  it('submits a real form, so the id travels as form data and nothing in it names the customer', async () => {
    const user = userEvent.setup()

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn />)

    expect(heart()).toHaveAttribute('type', 'submit')
    expect(heart().closest('form')).not.toBeNull()

    await user.click(heart())

    await waitFor(() => expect(actions.saveToWishlistAction).toHaveBeenCalledTimes(1))

    const formData = actions.saveToWishlistAction.mock.calls[0][1] as FormData

    expect(formData.get('productId')).toBe(String(PRODUCT_ID))
    /*
     * The whole surface the browser may touch is a product id. A customer id in this payload would be
     * a parameter for "whose list", which the action's docblock says must not exist.
     */
    expect([...formData.keys()]).toEqual(['productId'])
  })

  it('sends an unsaved product to saveToWishlistAction and never to remove', async () => {
    const user = userEvent.setup()

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn />)

    await user.click(heart())

    await waitFor(() => expect(actions.saveToWishlistAction).toHaveBeenCalledTimes(1))
    expect(actions.removeFromWishlistAction).not.toHaveBeenCalled()
  })

  it('sends an already-saved product to removeFromWishlistAction, because the same heart is both controls', async () => {
    const user = userEvent.setup()

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn />)

    await user.click(heart())
    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'true'))

    await user.click(heart())

    /* The form's `action` swaps with the pressed state; a second save would be the wrong mutation. */
    await waitFor(() => expect(actions.removeFromWishlistAction).toHaveBeenCalledTimes(1))
    expect(actions.saveToWishlistAction).toHaveBeenCalledTimes(1)
  })

  it('returns to unpressed once the server confirms the removal', async () => {
    const user = userEvent.setup()

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn />)

    await user.click(heart())
    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'true'))

    await user.click(heart())

    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'false'))
    expect(heart()).toHaveAccessibleName(WISHLIST_COPY.save)
  })

  it('disables itself while a write is in flight and refuses the second press', async () => {
    const user = userEvent.setup()
    let settle: (state: WishlistActionState) => void = () => {}

    actions.saveToWishlistAction.mockImplementation(
      () =>
        new Promise<WishlistActionState>((resolve) => {
          settle = resolve
        }),
    )

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn />)

    await user.click(heart())

    await waitFor(() => expect(heart()).toBeDisabled())

    await user.click(heart())

    /*
     * Refusal, not a queue. Both actions are checked because the pending heart renders *pressed*, so
     * an un-refused second press would post the opposite mutation and undo the write in flight.
     */
    expect(actions.saveToWishlistAction).toHaveBeenCalledTimes(1)
    expect(actions.removeFromWishlistAction).not.toHaveBeenCalled()

    await act(async () => {
      settle({ ...SAVED })
    })

    expect(heart()).toBeEnabled()
  })

  it('shows the pending write as pressed, so the heart does not lag behind the press it is answering', async () => {
    const user = userEvent.setup()
    let settle: (state: WishlistActionState) => void = () => {}

    actions.saveToWishlistAction.mockImplementation(
      () =>
        new Promise<WishlistActionState>((resolve) => {
          settle = resolve
        }),
    )

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn />)

    await user.click(heart())

    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'true'))
    expect(heart()).toBeDisabled()

    await act(async () => {
      settle({ ...SAVED })
    })
  })

  it('reports the server answer and not the click: a refused save leaves the heart unpressed', async () => {
    const user = userEvent.setup()

    actions.saveToWishlistAction.mockImplementation(answers(UNAVAILABLE))

    render(<WishlistButton productId={PRODUCT_ID} savedForCustomer={false} signedIn />)

    await user.click(heart())

    await waitFor(() => expect(actions.saveToWishlistAction).toHaveBeenCalledTimes(1))

    /*
     * The product was unpublished between render and press. The browser is never authoritative, so the
     * optimistic pressed state must unwind rather than persist.
     */
    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'false'))
    expect(heart()).toHaveAccessibleName(WISHLIST_COPY.save)
  })

  it('fires no add_to_wishlist for a save the server refused, because an event is emitted where it is true', async () => {
    const user = userEvent.setup()

    actions.saveToWishlistAction.mockImplementation(answers(UNAVAILABLE))

    render(
      <WishlistButton
        itemName={ITEM_NAME}
        productId={PRODUCT_ID}
        savedForCustomer={false}
        signedIn
      />,
    )

    await user.click(heart())

    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'false'))
    expect(analytics.trackEvent).not.toHaveBeenCalled()
  })

  it('fires add_to_wishlist once the server confirms the save, and once only', async () => {
    const user = userEvent.setup()

    render(
      <WishlistButton
        itemName={ITEM_NAME}
        productId={PRODUCT_ID}
        savedForCustomer={false}
        signedIn
      />,
    )

    await user.click(heart())

    await waitFor(() =>
      expect(analytics.trackEvent).toHaveBeenCalledWith('add_to_wishlist', { items: [ITEM] }),
    )
    expect(analytics.trackEvent).toHaveBeenCalledTimes(1)
  })

  it('fires remove_from_wishlist only after the server has confirmed the removal', async () => {
    const user = userEvent.setup()

    render(
      <WishlistButton
        itemName={ITEM_NAME}
        productId={PRODUCT_ID}
        savedForCustomer={false}
        signedIn
      />,
    )

    await user.click(heart())
    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'true'))

    await user.click(heart())

    await waitFor(() =>
      expect(analytics.trackEvent).toHaveBeenLastCalledWith('remove_from_wishlist', {
        items: [ITEM],
      }),
    )
    /* One add, one remove — REMOVED carries `saved: false`, which is the fact being reported. */
    expect(analytics.trackEvent).toHaveBeenCalledTimes(2)
  })
})

describe('WishlistControl — the guest device caveat', () => {
  it('says nothing about devices before a guest has saved anything, because the caveat is noise until it applies', () => {
    render(<WishlistControl productId={PRODUCT_ID} savedForCustomer={false} signedIn={false} />)

    expect(screen.queryByText(WISHLIST_COPY.guestNotice)).not.toBeInTheDocument()
  })

  it('explains where the save went, in a live region, once a guest has actually saved', async () => {
    const user = userEvent.setup()

    render(<WishlistControl productId={PRODUCT_ID} savedForCustomer={false} signedIn={false} />)

    await user.click(heart())

    const notice = await screen.findByText(WISHLIST_COPY.guestNotice)

    /* Polite, because it appears after a press the customer made and must not interrupt them. */
    expect(notice).toHaveAttribute('aria-live', 'polite')
  })

  it('withdraws the caveat if the guest un-saves, so the page never explains a save that no longer exists', async () => {
    const user = userEvent.setup()

    render(<WishlistControl productId={PRODUCT_ID} savedForCustomer={false} signedIn={false} />)

    await user.click(heart())
    await screen.findByText(WISHLIST_COPY.guestNotice)

    await user.click(heart())

    expect(screen.queryByText(WISHLIST_COPY.guestNotice)).not.toBeInTheDocument()
  })

  it('never shows the device caveat to a signed-in customer, whose list is on the server', () => {
    render(<WishlistControl productId={PRODUCT_ID} savedForCustomer signedIn />)

    expect(heart()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(WISHLIST_COPY.guestNotice)).not.toBeInTheDocument()
  })
})
