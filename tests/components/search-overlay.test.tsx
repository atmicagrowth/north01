import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellOverlayProvider } from '@/components/shell/overlay-context'
import { SearchOverlay, SearchTrigger } from '@/components/shell/search-overlay'
import { SearchPanel } from '@/components/shell/search-panel'
import { trackEvent } from '@/lib/analytics/track'
import {
  RECENT_SEARCH_KEY,
  SEARCH_COPY,
  SEARCH_PATH,
  SUGGEST_DEBOUNCE_MS,
} from '@/lib/catalog/search'
import type { SuggestionPayload } from '@/lib/catalog/suggest'
import type { ProductCard } from '@/lib/catalog/resolve'

/**
 * **The search overlay — plan §27.1b's component tests for §12.1c's panel.**
 *
 * The panel is the one surface in the shell that turns a typed sentence into a URL, so almost
 * nothing worth asserting here is markup. It is the set of decisions the browser is allowed to make
 * on the way to `/search?q=…`, and the one decision it is *not* allowed to make at all.
 *
 * 1. **It is a real `<form method="get" action="/search">` with `name="q"`.** This is the headline
 *    and it is deliberate rather than incidental: the source docblock ends with *"the form works
 *    without JavaScript … everything below is enhancement."* With scripting off, the combobox, the
 *    debounce, the recent searches and the arrow keys all disappear and the customer still reaches a
 *    real results page, because the markup alone already submits. Asserting the three attributes is
 *    the only way that promise can be held to — a `<div>` with an `onKeyDown` would look identical in
 *    every screenshot and be a dead box for anyone whose JavaScript failed to load.
 * 2. **A term that is not a search does not navigate.** Blank, whitespace and punctuation-only all
 *    normalise to `null`, and §12.1d wants them answered *before* a request exists. Every one of
 *    these tests carries a positive control in the same body — the same keystroke, on a real term,
 *    must navigate — so "nothing happened" can never pass because the submit never fired.
 * 3. **The term is normalised before it becomes a URL, and the URL is what is measured.**
 *    `"  Merino   Crew "` and `"Merino Crew"` are one search, one recent entry and one analytics
 *    row; case survives because the term is echoed back to the customer.
 * 4. **`aria-activedescendant` resolves to an element that is on the page.** The source calls a
 *    dangling id *"silent — it announces nothing at all"*, which is precisely the failure no visual
 *    review can see. Every keyboard assertion below therefore resolves the id through
 *    `document.getElementById` rather than trusting the attribute's text.
 * 5. **An active option wins over the typed term.** Arrowing to *Knitwear* and pressing Enter must
 *    go to the category, not run a text search for what is still sitting in the input.
 * 6. **Recent searches are the device's, never the server's.** Read through `useSyncExternalStore`
 *    from `localStorage`, written on submit, and — asserted directly — never attached to a suggest
 *    request. Sending them would ship one person's browsing history to a log for nothing.
 * 7. **The debounce is real.** Six keystrokes are one request, not six. §12.1c's floor means the
 *    first character asks the server nothing at all.
 * 8. **An outage is not an empty result.** A suggest request that fails renders
 *    `SEARCH_COPY.unavailable`, never `SEARCH_COPY.empty` — the project's rule that the shop being
 *    broken and the shop having nothing are different sentences to a customer.
 *
 * ### What is mocked, and why
 *
 * - **`next/navigation`** — `useRouter` is the boundary the panel navigates through, so holding it is
 *   how "did this term become that URL" is observed at all; `usePathname` is read by the real
 *   `ShellOverlayProvider`, which every test wraps because `useShellOverlay` throws without it. The
 *   provider itself is **not** mocked: whether the panel closes its own overlay is one of the things
 *   under test.
 * - **`@/lib/analytics/track`** — `trackEvent` is fire-and-forget and inert in jsdom, so mocking it
 *   is what makes §25.1a's *`search_submitted` on the normalised term* observable.
 * - **`fetch`** — the suggest endpoint is a route handler backed by Algolia and Postgres. Stubbed at
 *   the global, one reply per query string, so the fixtures are the payload shape the endpoint
 *   really returns and every request the panel makes is recorded exactly as it was sent.
 *
 * Nothing else is stubbed. Radix's Dialog, `MediaImage` and `suggestionOptions`/`suggestionGroups`
 * are the real ones — the flat keyboard order and the rendered grouping being *one* derivation is
 * the property the arrow-key tests depend on.
 */

/*
 * The panel pushes; the provider reads the pathname to decide whether to close on navigation. Both
 * come from the same module, so both are supplied here, and nothing deeper is faked: the hrefs
 * asserted below are the ones the component built.
 */
const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => router,
}))

vi.mock('@/lib/analytics/track', () => ({ trackEvent: vi.fn() }))

/* -------------------------------------------------------------------------------------------------
 * The suggest endpoint, as a stub
 * ---------------------------------------------------------------------------------------------- */

/** Every suggest request the panel made, path and query, in order. */
const requests: string[] = []

/** Replies keyed by the `q` the panel asked for. Anything unregistered answers an empty result. */
const replies = new Map<string, { body: SuggestionPayload; ok: boolean }>()

function payload(overrides: Partial<SuggestionPayload> = {}): SuggestionPayload {
  return {
    categories: [],
    collections: [],
    popular: [],
    products: [],
    recent: [],
    state: 'idle',
    ...overrides,
  }
}

function answerSuggest(term: string, body: SuggestionPayload): void {
  replies.set(term, { body, ok: true })
}

/** A suggest request the server could not answer — a 500, not a result. */
function failSuggest(term: string): void {
  replies.set(term, { body: payload(), ok: false })
}

/** The `q` of every request made, which is what the debounce assertions count. */
function queries(): string[] {
  return requests.map((url) => new URL(url, 'http://localhost').searchParams.get('q') ?? '')
}

function card(overrides: Partial<ProductCard> = {}): ProductCard {
  return {
    compareAtLabel: null,
    href: '/product/the-merino-crew',
    id: 7,
    /* No asset: `MediaImage` renders its reserved placeholder, which is the state the catalogue is
     * committed in and keeps these tests off Cloudinary entirely. */
    image: null,
    isLimitedEdition: false,
    isNew: false,
    lowStockLabel: null,
    name: 'The Merino Crew',
    priceLabel: '£85.00',
    state: 'available',
    ...overrides,
  }
}

/* -------------------------------------------------------------------------------------------------
 * Harness
 * ---------------------------------------------------------------------------------------------- */

function renderPanel() {
  return render(
    <ShellOverlayProvider>
      <SearchPanel />
    </ShellOverlayProvider>,
  )
}

/**
 * Wait for the idle request the panel fires on open to land.
 *
 * It is not debounced — the source says so, because waiting 200ms to show the popular list makes the
 * one interaction with no typing in it feel slow — so a single macrotask plus the promise chain is
 * enough. Settling it explicitly keeps a later assertion from racing a `setState` that arrives
 * mid-query.
 */
async function settleIdle(): Promise<void> {
  await waitFor(() => expect(requests).toHaveLength(1))
  await act(async () => {
    await Promise.resolve()
  })
}

/** What `localStorage` holds for §12.1c's recent searches, parsed. */
function storedRecent(): unknown {
  return JSON.parse(window.localStorage.getItem(RECENT_SEARCH_KEY) ?? 'null')
}

function seedRecent(terms: string[]): void {
  window.localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(terms))
}

/**
 * The option the combobox is currently pointing assistive technology at, **resolved through the
 * document**.
 *
 * Reading the attribute back would prove nothing: `aria-activedescendant` naming an id that is not
 * in the page is not an error, it is silence. Resolving it is the assertion.
 */
function activeOption(): HTMLElement | null {
  const id = screen.getByRole('combobox').getAttribute('aria-activedescendant')

  return id === null ? null : document.getElementById(id)
}

function optionLabels(): string[] {
  return screen.queryAllByRole('option').map((option) => option.textContent?.trim() ?? '')
}

beforeEach(() => {
  vi.clearAllMocks()
  requests.length = 0
  replies.clear()

  /*
   * Seeded as an explicit empty list rather than cleared. The panel memoises its parse against the
   * raw string it came from, and `null` is both "storage is empty" and its cache-busting sentinel —
   * so an empty *string* keeps each test's read unambiguous instead of relying on that overlap.
   */
  window.localStorage.setItem(RECENT_SEARCH_KEY, '[]')

  /* §12.1d's "repeated query submission" is decided against the current URL, so pin it. */
  window.history.replaceState({}, '', '/')

  /*
   * Implementations are installed per test: the shared setup file calls `vi.restoreAllMocks()` after
   * every one, and a stub left without an implementation answers `undefined`.
   */
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      requests.push(`${url.pathname}${url.search}`)

      const q = url.searchParams.get('q') ?? ''
      const reply = replies.get(q) ?? {
        body: payload({ state: q === '' ? 'idle' : 'empty' }),
        ok: true,
      }

      return { json: async () => reply.body, ok: reply.ok } as unknown as Response
    }),
  )
})

afterEach(() => {
  /* Only the debounce block fakes them; restoring unconditionally keeps a failure there from
   * leaking a frozen clock into every test that follows. */
  vi.useRealTimers()
})

/* -------------------------------------------------------------------------------------------------
 * §12.1c — the form, before any JavaScript runs
 * ---------------------------------------------------------------------------------------------- */

describe('SearchPanel — the form works with JavaScript disabled', () => {
  it('submits as a plain GET form to /search with a field named q, because everything else in the panel is enhancement over that', async () => {
    renderPanel()
    await settleIdle()

    const form = screen.getByRole('search')
    const input = screen.getByRole('combobox', { name: 'Search' })

    /*
     * The three facts that make the panel work with scripting off, and the reason they are asserted
     * as markup rather than behaviour: with no JavaScript there is no handler to observe. A `<div>`
     * wired to `onKeyDown` would be indistinguishable in a screenshot and dead for a customer whose
     * bundle failed to load.
     */
    expect(form.tagName).toBe('FORM')
    expect(form).toHaveAttribute('method', 'get')
    expect(form).toHaveAttribute('action', SEARCH_PATH)
    expect(input).toHaveAttribute('name', 'q')

    /* And the field belongs to that form, rather than merely sitting near it. */
    expect((input as HTMLInputElement).form).toBe(form)
  })

  it('names the field with a label rather than only a placeholder, because a placeholder is gone the moment anything is typed', async () => {
    renderPanel()
    await settleIdle()

    expect(screen.getByRole('combobox', { name: 'Search' })).toHaveAttribute(
      'placeholder',
      'Hoodie, merino, Graphite…',
    )
  })

  it('declares the ARIA 1.2 combobox wiring, with aria-controls pointing at a listbox that is really in the document', async () => {
    renderPanel()
    await settleIdle()

    const input = screen.getByRole('combobox', { name: 'Search' })
    const listbox = screen.getByRole('listbox', { name: 'Search suggestions' })

    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    /* Radix cannot wire this pair up — the panel is hand-built — so the id is checked end to end. */
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)
    expect(listbox.id).not.toBe('')
  })

  it('reports the combobox as collapsed while there is nothing to arrow through', async () => {
    renderPanel()
    await settleIdle()

    /* Nothing was registered for the idle key, so the panel has no options at all. */
    expect(optionLabels()).toEqual([])
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
  })
})

/* -------------------------------------------------------------------------------------------------
 * §12.1d — terms that are not searches
 * ---------------------------------------------------------------------------------------------- */

describe('SearchPanel — a term that is not a search never becomes a URL', () => {
  it('does nothing for a whitespace-only term, and the same keystroke on a real term navigates', async () => {
    const user = userEvent.setup()
    renderPanel()
    await settleIdle()

    const input = screen.getByRole('combobox')
    await user.type(input, '   {Enter}')

    expect(router.push).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
    /* Nothing worth remembering either — an empty recent entry is a row that searches for nothing. */
    expect(storedRecent()).toEqual([])

    /*
     * The positive control, in the same body. Without it "nothing happened" would also pass if Enter
     * never reached the form at all, which is the one way this assertion could be vacuous.
     */
    await user.clear(input)
    await user.type(input, 'merino{Enter}')

    expect(router.push).toHaveBeenCalledWith(`${SEARCH_PATH}?q=merino`)
  })

  it('does nothing for a term of punctuation alone, because "!!!" matches nothing and is answered before a request exists', async () => {
    const user = userEvent.setup()
    renderPanel()
    await settleIdle()

    await user.type(screen.getByRole('combobox'), '!!!{Enter}')

    expect(router.push).not.toHaveBeenCalled()
    /* And it never reached the network: the only request is the idle one from opening the panel. */
    expect(queries()).toEqual([''])
  })

  it('does nothing on an empty submit, so Enter in an untouched field is not a search for everything', async () => {
    renderPanel()
    await settleIdle()

    /* Submitted at the form rather than through the keyboard, so the handler definitely ran. */
    fireEvent.submit(screen.getByRole('search'))

    expect(router.push).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })
})

/* -------------------------------------------------------------------------------------------------
 * The URL a term becomes
 * ---------------------------------------------------------------------------------------------- */

describe('SearchPanel — the term is normalised before it becomes a URL', () => {
  it('collapses and trims whitespace, so "  Merino   Crew " and "Merino Crew" are one search rather than three', async () => {
    const user = userEvent.setup()
    renderPanel()
    await settleIdle()

    await user.type(screen.getByRole('combobox'), '  Merino   Crew {Enter}')

    expect(router.push).toHaveBeenCalledWith(`${SEARCH_PATH}?q=Merino%20Crew`)
  })

  it('preserves the customer’s capitals, because the term is echoed back as a title and a chip', async () => {
    const user = userEvent.setup()
    renderPanel()
    await settleIdle()

    await user.type(screen.getByRole('combobox'), 'JACKET{Enter}')

    /* Folding here would show somebody something they did not type, and buy nothing: matching is
     * case-insensitive at the engine. */
    expect(router.push).toHaveBeenCalledWith(`${SEARCH_PATH}?q=JACKET`)
  })

  it('drops wrapping quotes, because they are a query operator rather than text anybody meant', async () => {
    const user = userEvent.setup()
    renderPanel()
    await settleIdle()

    await user.type(screen.getByRole('combobox'), '"jacket"{Enter}')

    expect(router.push).toHaveBeenCalledWith(`${SEARCH_PATH}?q=jacket`)
  })

  it('reports §25.1a search_submitted on the normalised term, so one search is one row in the report', async () => {
    const user = userEvent.setup()
    renderPanel()
    await settleIdle()

    await user.type(screen.getByRole('combobox'), '  Merino   Crew {Enter}')

    /* The raw input would file "  Merino   Crew " and "Merino Crew" as two different searches. */
    expect(trackEvent).toHaveBeenCalledWith('search_submitted', { term: 'Merino Crew' })
  })

  it('replaces rather than pushes when the same term is submitted from its own results, because Back must not need pressing twice', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', `${SEARCH_PATH}?q=merino`)

    renderPanel()
    await settleIdle()

    await user.type(screen.getByRole('combobox'), 'merino{Enter}')

    /* §12.1d's "repeated query submission": the URL is already this one, so no new history entry. */
    expect(router.replace).toHaveBeenCalledWith(`${SEARCH_PATH}?q=merino`)
    expect(router.push).not.toHaveBeenCalled()
  })
})

/* -------------------------------------------------------------------------------------------------
 * The keyboard
 * ---------------------------------------------------------------------------------------------- */

describe('SearchPanel — the arrow keys walk one list across every group', () => {
  beforeEach(() => {
    /*
     * Products, then a category, then a collection — the three groups in the order they render, so
     * the flat keyboard order can be told apart from the visual one if they ever drift.
     */
    answerSuggest(
      'mer',
      payload({
        categories: [{ href: '/shop/knitwear', label: 'Knitwear' }],
        collections: [{ href: '/shop?collection=winter-01', label: 'Winter 01' }],
        products: [
          card(),
          card({ href: '/product/the-merino-tee', id: 8, name: 'The Merino Tee' }),
        ],
        state: 'results',
      }),
    )
  })

  async function typeMer() {
    const user = userEvent.setup()
    renderPanel()
    await settleIdle()

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, 'mer')

    /* The debounced request has to land before there is anything to arrow through. */
    await screen.findByRole('option', { name: /The Merino Crew/ })

    return { input, user }
  }

  it('points aria-activedescendant at an option that is genuinely in the document, because a dangling id announces nothing at all', async () => {
    const { user } = await typeMer()

    await user.keyboard('{ArrowDown}')

    const option = activeOption()
    expect(option).not.toBeNull()
    expect(option).toHaveTextContent('The Merino Crew')
    expect(option).toHaveAttribute('aria-selected', 'true')
  })

  it('crosses from the last product into the first category on one ArrowDown, because the customer sees a single list', async () => {
    const { user } = await typeMer()

    /* Two products, then the category. Three presses lands on the first thing in the next group. */
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')

    expect(activeOption()).toHaveTextContent('Knitwear')
  })

  it('wraps ArrowUp from nothing selected to the last option, which is what a native listbox does', async () => {
    const { user } = await typeMer()

    await user.keyboard('{ArrowUp}')

    expect(activeOption()).toHaveTextContent('Winter 01')
  })

  it('sends Home to the first option and End to the last, across every group at once', async () => {
    const { user } = await typeMer()

    await user.keyboard('{End}')
    expect(activeOption()).toHaveTextContent('Winter 01')

    await user.keyboard('{Home}')
    expect(activeOption()).toHaveTextContent('The Merino Crew')
  })

  it('leaves exactly one option selected at a time', async () => {
    const { user } = await typeMer()

    await user.keyboard('{ArrowDown}{ArrowDown}')

    expect(screen.getAllByRole('option', { selected: true })).toHaveLength(1)
  })

  it('drops the active option the moment another character is typed, because typing is what invalidates a selection', async () => {
    const { input, user } = await typeMer()

    await user.keyboard('{ArrowDown}')
    expect(activeOption()).not.toBeNull()

    await user.type(input, 'i')

    /* Held across the keystroke, the index could point past a list that has since become shorter. */
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-activedescendant')
    expect(screen.queryAllByRole('option', { selected: true })).toHaveLength(0)
  })

  it('leaves Home and End to the text cursor when there is nothing to select, rather than swallowing them', async () => {
    const user = userEvent.setup()
    renderPanel()
    await settleIdle()

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('{ArrowDown}{End}{Home}')

    /* No options: the handler returns before `preventDefault`, so the keys stay the input's. */
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })
})

/* -------------------------------------------------------------------------------------------------
 * What Enter follows
 * ---------------------------------------------------------------------------------------------- */

describe('SearchPanel — an active option outranks the typed term', () => {
  it('follows the active option’s href instead of searching for what is still in the input', async () => {
    const user = userEvent.setup()
    answerSuggest(
      'mer',
      payload({
        categories: [{ href: '/shop/knitwear', label: 'Knitwear' }],
        state: 'results',
      }),
    )

    renderPanel()
    await settleIdle()

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, 'mer')
    await screen.findByRole('option', { name: 'Knitwear' })

    await user.keyboard('{ArrowDown}{Enter}')

    expect(router.push).toHaveBeenCalledWith('/shop/knitwear')
    /* The half that matters: the typed term must not also run as a text search. */
    expect(router.push).not.toHaveBeenCalledWith(`${SEARCH_PATH}?q=mer`)
  })

  it('searches for an active option that is a term rather than a link, even though the input is empty', async () => {
    const user = userEvent.setup()
    answerSuggest('', payload({ popular: ['Overshirt'], state: 'idle' }))

    renderPanel()
    await screen.findByRole('option', { name: 'Overshirt' })

    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{ArrowDown}{Enter}')

    /* §12.1c's popular searches carry no href — activating one is a search for its label. */
    expect(router.push).toHaveBeenCalledWith(`${SEARCH_PATH}?q=Overshirt`)
  })

  it('searches for the typed term when nothing is active, because -1 is a real state and not an absence', async () => {
    const user = userEvent.setup()
    answerSuggest('mer', payload({ categories: [{ href: '/shop/knitwear', label: 'Knitwear' }] }))

    renderPanel()
    await settleIdle()

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, 'mer')
    await screen.findByRole('option', { name: 'Knitwear' })

    /* An option is on screen and none was chosen: Enter belongs to the term, not to the list. */
    await user.keyboard('{Enter}')

    expect(router.push).toHaveBeenCalledWith(`${SEARCH_PATH}?q=mer`)
  })

  it('follows an option that is clicked as well as one that is arrowed to', async () => {
    const user = userEvent.setup()
    answerSuggest('mer', payload({ products: [card()], state: 'results' }))

    renderPanel()
    await settleIdle()

    const input = screen.getByRole('combobox')
    await user.type(input, 'mer')

    await user.click(await screen.findByRole('option', { name: /The Merino Crew/ }))

    expect(router.push).toHaveBeenCalledWith('/product/the-merino-crew')
  })

  it('offers "View all results" only once there are products to see all of', async () => {
    const user = userEvent.setup()
    answerSuggest('mer', payload({ products: [card()], state: 'results' }))

    renderPanel()
    await settleIdle()

    /* Absent while the panel is idle: a control that promises a page of nothing is fake UI. */
    expect(screen.queryByRole('button', { name: 'View all results' })).not.toBeInTheDocument()

    await user.type(screen.getByRole('combobox'), 'mer')
    await screen.findByRole('option', { name: /The Merino Crew/ })

    await user.click(screen.getByRole('button', { name: 'View all results' }))

    expect(router.push).toHaveBeenCalledWith(`${SEARCH_PATH}?q=mer`)
  })
})

/* -------------------------------------------------------------------------------------------------
 * Recent searches
 * ---------------------------------------------------------------------------------------------- */

describe('SearchPanel — recent searches belong to the device, not to the shop', () => {
  it('reads them out of local storage and offers them as options', async () => {
    seedRecent(['Merino crew', 'Overshirt'])

    renderPanel()
    await settleIdle()

    const group = screen.getByRole('group', { name: 'Recent searches' })
    expect(
      within(group)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Merino crew', 'Overshirt'])
  })

  it('writes the normalised term on submit, most recent first', async () => {
    const user = userEvent.setup()
    seedRecent(['Overshirt'])

    renderPanel()
    await settleIdle()

    await user.type(screen.getByRole('combobox'), '  Merino   Crew {Enter}')

    /* What is stored is what was searched for, not what was typed — otherwise the list fills with
     * three spellings of one term. */
    await waitFor(() => expect(storedRecent()).toEqual(['Merino Crew', 'Overshirt']))
  })

  it('does not grow a second entry when the same term is searched twice', async () => {
    const user = userEvent.setup()
    renderPanel()
    await settleIdle()

    const input = screen.getByRole('combobox')
    await user.type(input, 'merino{Enter}')
    await waitFor(() => expect(storedRecent()).toEqual(['merino']))

    await user.type(input, '{Enter}')

    /* The panel writes on every submit, so the write itself has to be idempotent. */
    await waitFor(() => expect(storedRecent()).toEqual(['merino']))
  })

  it('runs a search for an address without remembering it, because a paste is not a thing to keep in front of somebody', async () => {
    const user = userEvent.setup()
    seedRecent(['Overshirt'])

    renderPanel()
    await settleIdle()

    await user.type(screen.getByRole('combobox'), 'me@example.com{Enter}')

    expect(router.push).toHaveBeenCalledWith(`${SEARCH_PATH}?q=me%40example.com`)
    /* The search still runs. The list is simply not the place for it. */
    expect(storedRecent()).toEqual(['Overshirt'])
  })

  it('hides them the moment a term is typed, because two answers to one question is one too many', async () => {
    const user = userEvent.setup()
    seedRecent(['Overshirt'])

    renderPanel()
    await settleIdle()
    expect(screen.getByRole('group', { name: 'Recent searches' })).toBeInTheDocument()

    await user.type(screen.getByRole('combobox'), 'mer')

    expect(screen.queryByRole('group', { name: 'Recent searches' })).not.toBeInTheDocument()
  })

  it('never attaches them to a suggest request, because that would ship one person’s history to a log for nothing', async () => {
    const user = userEvent.setup()
    seedRecent(['Merino crew', 'Overshirt'])

    renderPanel()
    await settleIdle()

    await user.type(screen.getByRole('combobox'), 'mer')
    await waitFor(() => expect(queries()).toEqual(['', 'mer']))

    /* One parameter, and it is the query. Asserted on the URL as sent rather than on intent. */
    for (const request of requests) {
      expect(request).toMatch(new RegExp(`^${SEARCH_PATH}/suggest\\?q=[^&]*$`))
    }
  })
})

/* -------------------------------------------------------------------------------------------------
 * The suggest request
 * ---------------------------------------------------------------------------------------------- */

describe('SearchPanel — the suggest request', () => {
  it('asks for the idle payload as soon as the panel opens, so §12.1c’s popular searches are not dead markup', async () => {
    answerSuggest('', payload({ popular: ['Overshirt', 'Merino crew'], state: 'idle' }))

    renderPanel()

    expect(await screen.findByRole('group', { name: 'Popular searches' })).toBeInTheDocument()
    /* The empty key is a real request, not a skipped one: without it the section can never fill. */
    expect(queries()).toEqual([''])
  })

  it('collapses a burst of keystrokes into one request, on the term the customer settled on', async () => {
    vi.useFakeTimers()

    renderPanel()
    await act(async () => {
      vi.advanceTimersByTime(0)
    })
    expect(queries()).toEqual([''])

    const input = screen.getByRole('combobox')

    /*
     * Typed with `fireEvent.change` and a faked clock rather than `userEvent`, for two reasons: a
     * debounce measured against a real one is a race on a loaded machine, and each event carries the
     * whole accumulated value, which is exactly what a keystroke produces on a controlled input.
     */
    for (const value of ['h', 'ho', 'hoo', 'hood', 'hoodi', 'hoodie']) {
      fireEvent.change(input, { target: { value } })
      await act(async () => {
        vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS - 50)
      })
    }

    /* Six characters, and the server has still been asked nothing beyond the idle payload. */
    expect(queries()).toEqual([''])

    await act(async () => {
      vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS)
    })

    expect(queries()).toEqual(['', 'hoodie'])
  })

  it('asks nothing at all for a single character, because §12.1c’s floor is two', async () => {
    vi.useFakeTimers()

    renderPanel()
    await act(async () => {
      vi.advanceTimersByTime(0)
    })

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'h' } })
    await act(async () => {
      vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS * 4)
    })

    /* Not "a request that returns nothing" — no request. */
    expect(queries()).toEqual([''])
  })

  it('says search is unavailable rather than "nothing matched" when the request fails, because those are different sentences to a customer', async () => {
    const user = userEvent.setup()
    failSuggest('zzz')

    renderPanel()
    await settleIdle()

    await user.type(screen.getByRole('combobox'), 'zzz')

    expect(await screen.findByText(SEARCH_COPY.unavailable.title)).toBeInTheDocument()
    /* An outage rendered as an empty result tells somebody the shop has nothing for them. */
    expect(screen.queryByText(SEARCH_COPY.empty.title)).not.toBeInTheDocument()
  })

  it('says nothing matched when the server really did answer with nothing', async () => {
    const user = userEvent.setup()
    answerSuggest('zzz', payload({ state: 'empty' }))

    renderPanel()
    await settleIdle()

    await user.type(screen.getByRole('combobox'), 'zzz')

    expect(await screen.findByText(SEARCH_COPY.empty.title)).toBeInTheDocument()
  })

  it('keeps the categories a failed request never needed, because they come from the shop’s own vocabulary', async () => {
    const user = userEvent.setup()
    /* §A.5: the panel's navigation must survive the search engine being unreachable. */
    replies.set('zzz', {
      body: payload({
        categories: [{ href: '/shop/knitwear', label: 'Knitwear' }],
        state: 'unavailable',
      }),
      ok: true,
    })

    renderPanel()
    await settleIdle()

    await user.type(screen.getByRole('combobox'), 'zzz')

    expect(await screen.findByRole('option', { name: 'Knitwear' })).toBeInTheDocument()
    expect(screen.getByText(SEARCH_COPY.unavailable.title)).toBeInTheDocument()
  })
})

/* -------------------------------------------------------------------------------------------------
 * §9 — the dialog the panel lives in
 * ---------------------------------------------------------------------------------------------- */

describe('SearchOverlay — the dialog around it', () => {
  function renderOverlay() {
    return render(
      <ShellOverlayProvider>
        <SearchTrigger />
        <SearchOverlay />
      </ShellOverlayProvider>,
    )
  }

  it('announces on the trigger that it opens a dialog, and whether that dialog is open', async () => {
    const user = userEvent.setup()
    renderOverlay()

    const trigger = screen.getByRole('button', { name: 'Search' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    /* Omitted while closed on purpose: Radix unmounts the panel, and an aria-controls pointing at an
     * id that is not in the document is a worse failure than the omission. */
    expect(trigger).not.toHaveAttribute('aria-controls')

    await user.click(trigger)

    /*
     * Held by reference rather than re-queried. Radix marks the rest of the page `aria-hidden` while
     * a modal is open, so a role query would no longer find the header control at all.
     */
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', 'shell-search-panel')
  })

  it('puts the real search form inside the dialog, so the panel opened from any route is the same form', async () => {
    const user = userEvent.setup()
    renderOverlay()

    await user.click(screen.getByRole('button', { name: 'Search' }))

    const dialog = await screen.findByRole('dialog', { name: 'Search' })
    const form = within(dialog).getByRole('search')

    expect(form).toHaveAttribute('action', SEARCH_PATH)
    expect(within(form).getByRole('combobox', { name: 'Search' })).toHaveAttribute('name', 'q')
  })

  it('closes itself when a suggestion is followed, because the shell only closes on a change of pathname', async () => {
    const user = userEvent.setup()
    answerSuggest('mer', payload({ products: [card()], state: 'results' }))

    renderOverlay()
    await user.click(screen.getByRole('button', { name: 'Search' }))

    const dialog = await screen.findByRole('dialog', { name: 'Search' })
    await user.type(within(dialog).getByRole('combobox'), 'mer')

    await user.click(await screen.findByRole('option', { name: /The Merino Crew/ }))

    /*
     * A query-only navigation is not a pathname change, so nothing above the panel would have
     * dismissed it — re-searching from /search?q=a would leave the dialog sitting over its own
     * results.
     */
    expect(router.push).toHaveBeenCalledWith('/product/the-merino-crew')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
