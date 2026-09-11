import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FilterPanel, SortControl } from '@/components/catalog/filter-controls'
import { trackEvent } from '@/lib/analytics/track'
import { EMPTY_VOCABULARY, type CatalogVocabulary } from '@/lib/catalog/query'

/**
 * **Plan §27.1b — the filter controls.**
 *
 * These are the only controls on the shop page that *change* state rather than following a link, so
 * they are the only place the catalogue's URL contract can be broken from the client. What is worth
 * asserting here is therefore not markup but the contract itself:
 *
 * - **Every write resets the page.** Ticking Black on page 3 of Jackets must not keep `?page=3`,
 *   or the customer applies a filter and lands on an empty grid that says nothing matched.
 * - **An empty selection serialises to nothing.** The last box unticked writes `null`, never `[]` —
 *   a lingering `?color=` is a filter that reads as applied to anything parsing the URL and narrows
 *   nothing.
 * - **An emptied price box means "no bound", not zero.** `Number('')` is `0`, and a `0` written as a
 *   maximum silently filters the shop down to items costing nothing. The source carries a comment
 *   about exactly this; it is the single most important assertion in this file.
 * - **The price facet is a form.** Enter applies; a keystroke does not, because applying per digit
 *   makes "1", "12", "120" three searches on the way to one.
 * - **A facet group is a `fieldset`/`legend`.** It is what tells a screen-reader user that "M" is a
 *   size and not a colour, and it is invisible to a sighted review.
 * - **A facet with no options is not rendered at all**, because an empty heading reads as breakage.
 *
 * ### What is mocked, and why
 *
 * `@/components/url-state` — `useUrlState` wraps nuqs's `useQueryStates`, which needs a real
 * `NuqsAdapter` and an App Router above it. The mock below is a working miniature of the contract
 * the components rely on: state that reads back, and `null` clearing a key to its parser default
 * (which is what makes the serializer drop it from the URL). Every write is recorded, so the tests
 * assert the exact object the component asked the URL to become.
 *
 * `@/lib/analytics/track` — `trackEvent` is fire-and-forget and would be silently inert in jsdom, so
 * mocking it is what makes §25.1a's "`filter_applied` only when one *is* applied" observable.
 *
 * Nothing else is stubbed: Radix's Checkbox and Label are the real ones, because the label binding
 * and the `role="checkbox"`/`aria-checked` wiring are part of what is being tested.
 */

const urlState = vi.hoisted(() => ({
  /** Seeded per test to stand for the parameters already in the address bar. */
  seed: {} as Record<string, unknown>,
  /** Every object handed to `setFilters`, in order. */
  writes: [] as Record<string, unknown>[],
}))

vi.mock('@/components/url-state', async () => {
  const { useState } = await import('react')

  /* The defaults from `CATALOG_PARSERS`. `null` clears a key back to these, exactly as nuqs does. */
  const DEFAULTS: Record<string, unknown> = {
    availability: null,
    category: [],
    collection: [],
    color: [],
    page: 1,
    priceMax: null,
    priceMin: null,
    q: null,
    size: [],
    sort: 'featured',
  }

  return {
    useUrlState: () => {
      const [values, setValues] = useState<Record<string, unknown>>(() => ({
        ...DEFAULTS,
        ...urlState.seed,
      }))

      const commit = (next: Record<string, unknown>) => {
        urlState.writes.push(next)

        setValues((current) => {
          const merged = { ...current }

          for (const [key, value] of Object.entries(next)) {
            merged[key] = value === null ? DEFAULTS[key] : value
          }

          return merged
        })

        return Promise.resolve(null)
      }

      return [values, commit, false] as const
    },
  }
})

vi.mock('@/lib/analytics/track', () => ({ trackEvent: vi.fn() }))

const VOCABULARY: CatalogVocabulary = {
  categories: [
    { label: 'Hoodies', parent: 'clothing', value: 'hoodies' },
    { label: 'Jackets', parent: 'clothing', value: 'jackets' },
  ],
  collections: [{ label: 'Winter 01', value: 'winter-01' }],
  colors: [
    { label: 'Black', value: 'black' },
    { label: 'Bone', value: 'bone' },
  ],
  priceCeilingMinor: 24000,
  priceFloorMinor: 4500,
  sizes: [
    { label: 'S', value: 'S' },
    { label: 'M', value: 'M' },
  ],
}

/** The most recent object the component asked the URL to become. */
function lastWrite(): Record<string, unknown> {
  const write = urlState.writes.at(-1)

  if (write === undefined) {
    throw new Error('Expected the control to have written URL state, and it wrote nothing.')
  }

  return write
}

beforeEach(() => {
  urlState.seed = {}
  urlState.writes.length = 0
  vi.mocked(trackEvent).mockClear()
})

/* -------------------------------------------------------------------------------------------------
 * Sort
 * ---------------------------------------------------------------------------------------------- */

describe('SortControl', () => {
  it('binds its visible "Sort" label to the select, so the control has an accessible name', () => {
    render(<SortControl value="featured" />)

    /* A native <select> exposes role "combobox"; finding it *by name* is the proof of the binding. */
    expect(screen.getByRole('combobox', { name: 'Sort' })).toBeInTheDocument()
  })

  it('offers exactly the five sorts of §11.1e, and no rating sort, because reviews are Phase 21', () => {
    render(<SortControl value="featured" />)

    const options = within(screen.getByRole('combobox', { name: 'Sort' })).getAllByRole('option')

    expect(options.map((option) => option.textContent)).toEqual([
      'Featured',
      'Newest',
      'Best sellers',
      'Price: low to high',
      'Price: high to low',
    ])
  })

  it('shows the sort the URL already carries as the selected option, not the default', () => {
    render(<SortControl value="price-desc" />)

    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('price-desc')
  })

  it('writes the chosen sort and clears the page, because a re-sort of page 3 is not page 3', async () => {
    const user = userEvent.setup()

    render(<SortControl value="featured" />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'price-asc')

    /* `page: null` — not `page: 1` — so the serializer omits the parameter entirely. */
    expect(lastWrite()).toEqual({ page: null, sort: 'price-asc' })
  })

  it('reports §25.1a sort_changed on the change itself, since the URL is the authority', async () => {
    const user = userEvent.setup()

    render(<SortControl value="featured" />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'newest')

    expect(trackEvent).toHaveBeenCalledWith('sort_changed', { sort: 'newest' })
  })
})

/* -------------------------------------------------------------------------------------------------
 * Facet groups
 * ---------------------------------------------------------------------------------------------- */

describe('FilterPanel structure', () => {
  it('wraps each facet in a fieldset/legend, so a screen reader knows "M" is a size', () => {
    render(<FilterPanel vocabulary={VOCABULARY} />)

    /*
     * A <fieldset> exposes role "group" and takes its accessible name from the <legend>. Without it
     * the panel announces seven unrelated check boxes and "M" means nothing.
     */
    const sizes = screen.getByRole('group', { name: 'Size' })

    expect(within(sizes).getByRole('checkbox', { name: 'M' })).toBeInTheDocument()
    expect(within(sizes).queryByRole('checkbox', { name: 'Black' })).not.toBeInTheDocument()
  })

  it('does not render a facet that has no options, because an empty heading reads as breakage', () => {
    render(<FilterPanel vocabulary={{ ...VOCABULARY, collections: [] }} />)

    expect(screen.queryByRole('group', { name: 'Collection' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Size' })).toBeInTheDocument()
  })

  it('renders no facet groups at all on an empty catalogue, leaving only Availability and Price', () => {
    render(<FilterPanel vocabulary={EMPTY_VOCABULARY} />)

    expect(screen.getAllByRole('group')).toHaveLength(2)
    expect(screen.getByRole('group', { name: 'Availability' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Price' })).toBeInTheDocument()
  })

  it('lists each child category straight after its parent, so the tree reads as a tree', () => {
    render(
      <FilterPanel
        vocabulary={{
          ...VOCABULARY,
          categories: [
            { label: 'Hoodies', parent: 'clothing', value: 'hoodies' },
            { label: 'Bags', parent: null, value: 'bags' },
            { label: 'Clothing', parent: null, value: 'clothing' },
          ],
        }}
      />,
    )

    const rows = within(screen.getByRole('group', { name: 'Category' })).getAllByRole('listitem')

    expect(rows.map((row) => row.textContent)).toEqual(['Bags', 'Clothing', 'Hoodies'])
    /* The child is indented under its parent; the roots are not. */
    expect(rows[2]).toHaveClass('pl-6')
    expect(rows[1]).not.toHaveClass('pl-6')
  })

  it('suppresses the Category group on /shop/<category>, where ticking it can only leave the page', () => {
    render(<FilterPanel routeCategory="clothing" vocabulary={VOCABULARY} />)

    expect(screen.queryByRole('group', { name: 'Category' })).not.toBeInTheDocument()
    /* The other groups are untouched — only the redundant one goes. */
    expect(screen.getByRole('group', { name: 'Color' })).toBeInTheDocument()
  })
})

/* -------------------------------------------------------------------------------------------------
 * Ticking and unticking
 * ---------------------------------------------------------------------------------------------- */

describe('FilterPanel facets', () => {
  it('writes the ticked value and resets the page, so a filter never lands on an empty page 3', async () => {
    const user = userEvent.setup()

    urlState.seed = { page: 3 }
    render(<FilterPanel vocabulary={VOCABULARY} />)

    await user.click(screen.getByRole('checkbox', { name: 'Black' }))

    expect(lastWrite()).toEqual({ color: ['black'], page: null })
  })

  it('adds a second value to the facet rather than replacing the first', async () => {
    const user = userEvent.setup()

    urlState.seed = { color: ['black'] }
    render(<FilterPanel vocabulary={VOCABULARY} />)

    await user.click(screen.getByRole('checkbox', { name: 'Bone' }))

    expect(lastWrite()).toEqual({ color: ['black', 'bone'], page: null })
  })

  it('shows a value already in the URL as checked, so the panel cannot lie about what is applied', () => {
    urlState.seed = { size: ['M'] }
    render(<FilterPanel vocabulary={VOCABULARY} />)

    expect(screen.getByRole('checkbox', { name: 'M' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'S' })).not.toBeChecked()
  })

  it('writes null rather than an empty array when the last value is unticked', async () => {
    const user = userEvent.setup()

    urlState.seed = { color: ['black'] }
    render(<FilterPanel vocabulary={VOCABULARY} />)

    await user.click(screen.getByRole('checkbox', { name: 'Black' }))

    /*
     * The assertion is `null`, not `[]`. An empty array would serialise to `?color=` — a filter that
     * looks applied, parses as applied, and narrows nothing.
     */
    expect(lastWrite()).toEqual({ color: null, page: null })
  })

  it('keeps the remaining values when one of several is unticked', async () => {
    const user = userEvent.setup()

    urlState.seed = { size: ['S', 'M'] }
    render(<FilterPanel vocabulary={VOCABULARY} />)

    await user.click(screen.getByRole('checkbox', { name: 'S' }))

    expect(lastWrite()).toEqual({ page: null, size: ['M'] })
  })

  it('reports filter_applied on a tick and stays silent on an untick, because §25.1a has no removal event', async () => {
    const user = userEvent.setup()

    render(<FilterPanel vocabulary={VOCABULARY} />)

    await user.click(screen.getByRole('checkbox', { name: 'Hoodies' }))

    expect(trackEvent).toHaveBeenCalledWith('filter_applied', {
      filter: 'category',
      value: 'hoodies',
    })
    expect(trackEvent).toHaveBeenCalledTimes(1)

    /* Unticking is not a filter being applied; reporting it would make the event unactionable. */
    await user.click(screen.getByRole('checkbox', { name: 'Hoodies' }))

    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it('binds each option label to its box, so clicking the word "M" ticks the size', async () => {
    const user = userEvent.setup()

    render(<FilterPanel vocabulary={VOCABULARY} />)

    await user.click(screen.getByText('M'))

    expect(lastWrite()).toEqual({ page: null, size: ['M'] })
  })
})

/* -------------------------------------------------------------------------------------------------
 * Availability
 * ---------------------------------------------------------------------------------------------- */

describe('FilterPanel availability', () => {
  it('offers only the in-stock side of availability, since nobody filters down to what they cannot buy', () => {
    render(<FilterPanel vocabulary={VOCABULARY} />)

    const availability = screen.getByRole('group', { name: 'Availability' })

    expect(within(availability).getAllByRole('checkbox')).toHaveLength(1)
    expect(within(availability).getByRole('checkbox', { name: 'In stock only' })).not.toBeChecked()
  })

  it('writes the literal in-stock value on, and null off, rather than a boolean', async () => {
    const user = userEvent.setup()

    render(<FilterPanel vocabulary={VOCABULARY} />)

    const box = screen.getByRole('checkbox', { name: 'In stock only' })

    await user.click(box)
    expect(lastWrite()).toEqual({ availability: 'in-stock', page: null })

    /* Off is `null`, not `false` — the parser is a string literal and `?availability=false` is junk. */
    await user.click(box)
    expect(lastWrite()).toEqual({ availability: null, page: null })
  })
})

/* -------------------------------------------------------------------------------------------------
 * Price
 * ---------------------------------------------------------------------------------------------- */

describe('FilterPanel price facet', () => {
  it('labels both boxes and leaves them empty, offering the catalogue range only as a placeholder', () => {
    render(<FilterPanel vocabulary={VOCABULARY} />)

    const min = screen.getByRole('spinbutton', { name: 'Min' })
    const max = screen.getByRole('spinbutton', { name: 'Max' })

    /* Empty with a hint, not prefilled: the shop's floor and ceiling are not a bound the customer set. */
    expect(min).toHaveValue(null)
    expect(min).toHaveAttribute('placeholder', '45')
    expect(max).toHaveValue(null)
    expect(max).toHaveAttribute('placeholder', '240')
  })

  it('does not write a thing while the customer is typing, because "1", "12", "120" is one search', async () => {
    const user = userEvent.setup()

    render(<FilterPanel vocabulary={VOCABULARY} />)

    await user.type(screen.getByRole('spinbutton', { name: 'Min' }), '120')

    expect(urlState.writes).toHaveLength(0)
  })

  it('applies the range on Enter in a box, because it is a form and Enter submits a form', async () => {
    const user = userEvent.setup()

    render(<FilterPanel vocabulary={VOCABULARY} />)

    await user.type(screen.getByRole('spinbutton', { name: 'Min' }), '120{Enter}')

    expect(lastWrite()).toEqual({ page: null, priceMax: null, priceMin: 120 })
  })

  it('applies both bounds on Apply and resets the page with them', async () => {
    const user = userEvent.setup()

    urlState.seed = { page: 4 }
    render(<FilterPanel vocabulary={VOCABULARY} />)

    await user.type(screen.getByRole('spinbutton', { name: 'Min' }), '50')
    await user.type(screen.getByRole('spinbutton', { name: 'Max' }), '200')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(lastWrite()).toEqual({ page: null, priceMax: 200, priceMin: 50 })
  })

  it('writes null and NOT zero for an emptied box, because Number("") is 0 and would hide the shop', async () => {
    const user = userEvent.setup()

    urlState.seed = { priceMax: 200, priceMin: 100 }
    render(<FilterPanel vocabulary={VOCABULARY} />)

    await user.clear(screen.getByRole('spinbutton', { name: 'Max' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    /*
     * The one assertion this file exists for. `priceMax: 0` would filter the catalogue down to items
     * costing nothing while the customer believes they removed the upper bound.
     */
    expect(lastWrite()).toEqual({ page: null, priceMax: null, priceMin: 100 })
    expect(lastWrite().priceMax).not.toBe(0)
  })

  it('seeds the boxes from the URL and follows it when it changes, so no cleared bound is re-applied', async () => {
    const user = userEvent.setup()

    urlState.seed = { priceMax: 200, priceMin: 100 }
    render(<FilterPanel vocabulary={VOCABULARY} />)

    expect(screen.getByRole('spinbutton', { name: 'Min' })).toHaveValue(100)
    expect(screen.getByRole('spinbutton', { name: 'Max' })).toHaveValue(200)

    await user.clear(screen.getByRole('spinbutton', { name: 'Max' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    /*
     * The `key` on PriceFacet remounts it when the URL values change. Without that the draft goes
     * stale, and a customer who edits only the minimum silently re-applies a maximum they cleared.
     */
    expect(screen.getByRole('spinbutton', { name: 'Max' })).toHaveValue(null)
    expect(screen.getByRole('spinbutton', { name: 'Min' })).toHaveValue(100)
  })

  it('refuses to apply a negative minimum at all, because the field is bound at 0', async () => {
    const user = userEvent.setup()

    render(<FilterPanel vocabulary={VOCABULARY} />)

    const min = screen.getByRole('spinbutton', { name: 'Min' })

    await user.click(min)
    await user.paste('-5')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    /*
     * `min={0}` is a real constraint, not decoration: the value is in the box and the form still
     * does not submit, so a negative price never reaches the URL. Nothing was written at all —
     * which is the strongest form of "the control refuses", and the reason `toValue`'s `parsed >= 0`
     * guard is a second line rather than the only one.
     */
    expect(min).toHaveValue(-5)
    expect(urlState.writes).toHaveLength(0)
  })

  it('refuses to apply a fractional bound, because a price filter is whole major units', async () => {
    const user = userEvent.setup()

    render(<FilterPanel vocabulary={VOCABULARY} />)

    const max = screen.getByRole('spinbutton', { name: 'Max' })

    await user.click(max)
    await user.paste('12.5')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    /* A `type="number"` with no `step` accepts integers only, so "12.50" is rejected before submit. */
    expect(max).toHaveValue(12.5)
    expect(urlState.writes).toHaveLength(0)
  })
})
