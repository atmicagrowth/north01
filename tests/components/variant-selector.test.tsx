/**
 * **Plan §27.1b — the variant selector.**
 *
 * `VariantSelector` paints a matrix it did not compute. `buildVariantMatrix` decides, on the server,
 * which sizes exist, which are purchasable in the chosen colour and which combination resolves to a
 * variant; the component writes two URL parameters and renders what it was handed. So the tests
 * worth having here are about the promises the *rendering* makes to a customer, and there are four
 * of them:
 *
 * 1. **It never picks a size.** §13.1c and `buildVariantMatrix`'s own docblock draw the asymmetry —
 *    *"a colour is a way of looking at the product; a size is a commitment"*. A preselected size is
 *    how somebody buys the wrong one, and it is a defect no screenshot shows, because the page looks
 *    finished either way.
 * 2. **Impossible options are disabled, never hidden.** A size that vanishes on a colour change
 *    reads as a rendering fault and destroys the one thing a shopper wants to know — whether the
 *    garment is made in their size at all. The distinction between *sold out in this colour* and
 *    *not made in this colour* has to survive into the accessible name, because the strike-through
 *    that carries it visually carries nothing to a screen reader.
 * 3. **It refuses what it says it refuses.** An `aria-disabled` option is still clickable in a
 *    browser — nothing in the DOM stops it. If the click handler did not check, the row would be the
 *    exact thing AGENTS.md forbids: UI that looks functional and does nothing (or worse, does
 *    something).
 * 4. **Arrows move focus; only Space and Enter commit.** Selection here is a server round-trip, so
 *    the group uses ARIA's manual-activation pattern. Selection-follows-focus would fire one
 *    navigation per arrow press.
 *
 * Everything is queried by role and accessible name — never by class — because the strike-through,
 * the muted colour and the swatch chip are all invisible to the customers this wiring exists for.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VariantSelector } from '@/components/product/variant-selector'
import {
  buildVariantMatrix,
  type ColorOption,
  type SelectableVariant,
  type SizeOption,
} from '@/lib/product/variants'

/*
 * The only mock in the file. `useUrlState` is nuqs' `useQueryStates` plus a `useTransition`, and
 * both need a live App Router — there is none in jsdom. Stubbing it at this seam keeps the
 * component's real work (which options render, which are refused, what gets written) under test and
 * replaces only the navigation. `commit` is the assertion surface: what the selector asks the URL
 * for is what the server will resolve.
 */
const { commit } = vi.hoisted(() => ({ commit: vi.fn() }))

vi.mock('@/components/url-state', () => ({
  useUrlState: () => [{ color: null, size: null }, commit, false],
}))

const COLORS: ColorOption[] = [
  { available: true, hex: '#111111', value: 'Black' },
  /* Nothing in stock in any size — the matrix's `available: false`, not a missing colour. */
  { available: false, hex: '#efe7d8', value: 'Cream' },
]

/** The size row as the matrix builds it *for Black*: one sold out, two buyable, one never made. */
const SIZES: SizeOption[] = [
  { available: false, missing: false, sortOrder: 0, value: 'XS' },
  { available: true, missing: false, sortOrder: 1, value: 'S' },
  { available: true, missing: false, sortOrder: 2, value: 'M' },
  { available: false, missing: true, sortOrder: 3, value: 'L' },
]

/** §13.1c's own example: Black / M exists, Cream / M does not. */
const VARIANTS: SelectableVariant[] = [
  {
    active: true,
    color: 'Black',
    colorHex: '#111111',
    id: 1,
    inventoryQuantity: 0,
    priceMinor: 24000,
    size: 'XS',
    sizeSortOrder: 0,
  },
  {
    active: true,
    color: 'Black',
    colorHex: '#111111',
    id: 2,
    inventoryQuantity: 5,
    priceMinor: 24000,
    size: 'S',
    sizeSortOrder: 1,
  },
  {
    active: true,
    color: 'Black',
    colorHex: '#111111',
    id: 3,
    inventoryQuantity: 2,
    priceMinor: 24000,
    size: 'M',
    sizeSortOrder: 2,
  },
  {
    active: true,
    color: 'Cream',
    colorHex: '#efe7d8',
    id: 4,
    inventoryQuantity: 0,
    priceMinor: 24000,
    size: 'L',
    sizeSortOrder: 3,
  },
]

function renderSelector(
  overrides: Partial<Parameters<typeof VariantSelector>[0]> = {},
): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup()

  render(
    <VariantSelector
      colors={COLORS}
      selectedColor="Black"
      selectedSize={null}
      sizes={SIZES}
      {...overrides}
    />,
  )

  return user
}

const colourRow = () => screen.getByRole('radiogroup', { name: /^Color/ })
const sizeRow = () => screen.getByRole('radiogroup', { name: 'Size' })

/*
 * The suffixes are separate text nodes (`XS` + an `sr-only` ` — sold out in this colour`), and name
 * computation joins them without preserving the leading space. The assertions below are about which
 * words reach assistive technology, not about that whitespace, so the matchers tolerate it rather
 * than pinning a detail of the name algorithm.
 */
const named = (value: string, suffix: string) => new RegExp(`^${value}\\s*—\\s*${suffix}$`)

beforeEach(() => {
  commit.mockClear()
})

describe('VariantSelector', () => {
  it('does not preselect a size, because §13.1c never chooses the commitment on the customer behalf', () => {
    renderSelector()

    /*
     * The single most important assertion in this file. Every arrival from the shop has no `?size=`,
     * and a row that helpfully checked the first buyable size would send somebody towards checkout
     * holding a size they never read.
     */
    expect(within(sizeRow()).queryAllByRole('radio', { checked: true })).toHaveLength(0)

    for (const value of ['XS', 'S', 'M', 'L']) {
      expect(
        within(sizeRow()).getByRole('radio', { name: new RegExp(`^${value}\\b`) }),
      ).toHaveAttribute('aria-checked', 'false')
    }
  })

  it('exposes the current selection through aria-checked, so exactly one option per row is announced as chosen', () => {
    renderSelector({ selectedSize: 'M' })

    /*
     * `aria-checked` tracks the selection and never the focus — the component is deliberately not
     * selection-follows-focus, so this is the only signal a screen reader has for what is chosen.
     */
    const checkedColours = within(colourRow()).getAllByRole('radio', { checked: true })
    const checkedSizes = within(sizeRow()).getAllByRole('radio', { checked: true })

    expect(checkedColours).toHaveLength(1)
    expect(checkedColours[0]).toHaveAccessibleName('Black')
    expect(checkedSizes).toHaveLength(1)
    expect(checkedSizes[0]).toHaveAccessibleName('M')
  })

  it('names the chosen colour in the row label, because a swatch is a colour a screen reader cannot see', () => {
    renderSelector({ selectedColor: 'Cream' })

    /* The group label is the only place the colourway is spelled out; the chip itself is decorative. */
    expect(screen.getByRole('radiogroup', { name: named('Color', 'Cream') })).toBeInTheDocument()
  })

  it('names each swatch by its colour alone, with the colour chip hidden from assistive technology', () => {
    renderSelector()

    /*
     * An exact accessible name proves the `aria-hidden` chip contributes nothing. A swatch announced
     * as "image Black" or with a stray label would be the same control with a worse name.
     */
    expect(within(colourRow()).getByRole('radio', { name: 'Black' })).toBeInTheDocument()
  })

  it('marks a size that is sold out in this colour rather than hiding it', () => {
    renderSelector()

    const xs = within(sizeRow()).getByRole('radio', {
      name: named('XS', 'sold out in this colour'),
    })

    /*
     * `aria-disabled`, not `disabled`: the option must stay in the tab/arrow order so a keyboard user
     * arrives at it and hears why. The native attribute would remove it from the row silently, which
     * is the hiding this rule exists to prevent.
     */
    expect(xs).toHaveAttribute('aria-disabled', 'true')
    expect(xs).not.toBeDisabled()
  })

  it('distinguishes a size never made in this colour from one that is merely out of stock', () => {
    renderSelector()

    /*
     * Two different facts a shopper acts on differently: come back later, versus this garment is not
     * made for you in this colourway. Visually they share a strike-through, so the accessible name is
     * where the difference has to live.
     */
    expect(
      within(sizeRow()).getByRole('radio', { name: named('L', 'not made in this colour') }),
    ).toBeInTheDocument()
    expect(within(sizeRow()).getByRole('radio', { name: 'M' })).toBeInTheDocument()
  })

  it('refuses to commit a size that is unavailable in this colour, even though nothing in the DOM stops the click', async () => {
    const user = renderSelector()

    await user.click(within(sizeRow()).getByRole('radio', { name: /^XS/ }))
    await user.click(within(sizeRow()).getByRole('radio', { name: /^L/ }))

    /* The refusal is the point: an aria-disabled button is fully clickable, so the handler must check. */
    expect(commit).not.toHaveBeenCalled()
  })

  it('commits only the size when a size is chosen, leaving the colour in the URL untouched', async () => {
    const user = renderSelector()

    await user.click(within(sizeRow()).getByRole('radio', { name: 'S' }))

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith({ size: 'S' })
  })

  it('clears the size when the colour changes, because Black / M existing does not mean Cream / M does', async () => {
    const user = renderSelector({ selectedSize: 'M' })

    await user.click(within(colourRow()).getByRole('radio', { name: /^Cream/ }))

    /*
     * Carrying `size=M` across to Cream is how a customer lands on a "sold out" message for a
     * combination they never chose. The write is explicit about the null rather than relying on the
     * server to notice.
     */
    expect(commit).toHaveBeenCalledWith({ color: 'Cream', size: null })
  })

  it('lets a colour with nothing in stock be selected, because a colour is a way of looking at the product', async () => {
    const user = renderSelector()

    /* Phase 35: the suffix is visible now, not `sr-only`, so sighted customers see it too. */
    const cream = within(colourRow()).getByRole('radio', { name: /^Cream\s*·\s*Sold out$/ })

    expect(within(cream).getByText('· Sold out', { exact: false })).toBeVisible()

    /* Sold out everywhere is still browsable — plan §11.1b treats sold out as a state, not a removal. */
    expect(cream).toHaveAttribute('aria-disabled', 'false')

    await user.click(cream)

    expect(commit).toHaveBeenCalledWith({ color: 'Cream', size: null })
  })

  it('gives each row one tab stop, and parks the size row tab stop on the first option when nothing is chosen', async () => {
    const user = renderSelector()

    await user.tab()
    /* The selected colour carries the colour row's only tab stop. */
    expect(within(colourRow()).getByRole('radio', { name: 'Black' })).toHaveFocus()

    await user.tab()
    /*
     * With no size selected every option would otherwise be `tabIndex={-1}` and Tab would skip the
     * whole control — the exact case `tabbableIndex` exists for, and the default state of every
     * product page opened from the shop.
     */
    expect(within(sizeRow()).getByRole('radio', { name: /^XS/ })).toHaveFocus()
  })

  it('moves the tab stop onto the chosen size once one has been chosen', async () => {
    const user = renderSelector({ selectedSize: 'M' })

    await user.tab()
    await user.tab()

    expect(within(sizeRow()).getByRole('radio', { name: 'M' })).toHaveFocus()
  })

  it('moves focus with the arrow keys without committing, because every selection is a server round-trip', async () => {
    const user = renderSelector()

    await user.tab()
    await user.tab()
    await user.keyboard('{ArrowRight}')

    expect(within(sizeRow()).getByRole('radio', { name: 'S' })).toHaveFocus()

    /*
     * Selection-follows-focus would fire one navigation per press, and the customer would be looking
     * at whichever of six re-resolutions landed last.
     */
    expect(commit).not.toHaveBeenCalled()
  })

  it('commits on Enter, the manual activation ARIA describes for a selection with a real cost', async () => {
    const user = renderSelector()

    await user.tab()
    await user.tab()
    await user.keyboard('{ArrowRight}{Enter}')

    expect(commit).toHaveBeenCalledWith({ size: 'S' })
  })

  it('commits on Space as well, so the row behaves like the radio group it claims to be', async () => {
    const user = renderSelector()

    await user.tab()
    await user.tab()
    await user.keyboard('{ArrowRight}{ArrowRight}[Space]')

    expect(commit).toHaveBeenCalledWith({ size: 'M' })
  })

  it('visits an unavailable size with the arrow keys instead of skipping past it', async () => {
    const user = renderSelector()

    await user.tab()
    await user.tab()
    await user.keyboard('{ArrowLeft}')

    /*
     * Backwards from the first option wraps to the last, which here is the size that is not made in
     * this colour. Landing on it is what lets a keyboard user learn that fact at all — skipping
     * disabled options would hide it, which is the same failure as hiding the option.
     */
    const last = within(sizeRow()).getByRole('radio', { name: /^L/ })

    expect(last).toHaveFocus()
    expect(last).toHaveAttribute('aria-disabled', 'true')
  })

  it('wraps forward from the last option to the first, because a radio group is a closed set', async () => {
    const user = renderSelector()

    await user.tab()
    await user.tab()
    await user.keyboard('{End}')

    expect(within(sizeRow()).getByRole('radio', { name: /^L/ })).toHaveFocus()

    await user.keyboard('{ArrowRight}')

    /* Dead-ending on the last size gives no signal that the row has ended. */
    expect(within(sizeRow()).getByRole('radio', { name: /^XS/ })).toHaveFocus()
  })

  it('renders no colour row when the product has no colours, rather than an empty labelled group', () => {
    renderSelector({ colors: [] })

    expect(screen.queryByRole('radiogroup', { name: /^Color/ })).not.toBeInTheDocument()
    expect(sizeRow()).toBeInTheDocument()
  })

  it('asks for a size once, under the size row, while none is chosen', () => {
    renderSelector()

    expect(screen.getAllByText('Choose a size.')).toHaveLength(1)
  })

  it('stops asking once a size is chosen', () => {
    renderSelector({ selectedSize: 'M' })

    expect(screen.queryByText('Choose a size.')).not.toBeInTheDocument()
  })

  it('does not ask for a size when no size in this colour can be bought', () => {
    /* Every size struck through: the prompt would be an instruction the customer cannot follow. */
    renderSelector({
      selectedColor: 'Cream',
      sizes: SIZES.map((size) => ({ ...size, available: false })),
    })

    expect(screen.queryByText('Choose a size.')).not.toBeInTheDocument()
  })

  it('shows the chosen size as selected at once, before the server has answered', async () => {
    /* A commit that never settles is a server that has not answered yet. */
    commit.mockReturnValueOnce(new Promise(() => {}))

    const user = renderSelector()

    await user.click(within(sizeRow()).getByRole('radio', { name: 'S' }))

    expect(within(sizeRow()).getByRole('radio', { name: 'S' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.queryByText('Choose a size.')).not.toBeInTheDocument()
    expect(commit).toHaveBeenCalledWith({ size: 'S' })
  })

  it('renders nothing at all when there is no choice to make', () => {
    renderSelector({ colors: [], selectedColor: null, sizes: [] })

    /* An empty radiogroup is a control that looks functional and does nothing. */
    expect(screen.queryAllByRole('radiogroup')).toHaveLength(0)
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })
})

/**
 * The selector paints what `buildVariantMatrix` resolved, so the URL edge cases feature matrix §7
 * names are only really tested as the pair. These render the component from a real matrix rather
 * than a hand-written fixture, which is the only way to see that neither half quietly corrects the
 * customer.
 */
describe('VariantSelector, fed by buildVariantMatrix from the URL', () => {
  const matrixFor = (requested: { color?: null | string; size?: null | string }) =>
    buildVariantMatrix(VARIANTS, requested, 'USD', 'en-US', 3)

  it('leaves a size the URL asked for and does not exist unselected, instead of substituting one that does', () => {
    const matrix = matrixFor({ color: 'Black', size: 'XXL' })

    /* Flagged rather than fixed: `product-page.tsx` renders the notice in its polite live region. */
    expect(matrix.invalidSelection).toBe(true)
    expect(matrix.selectedSize).toBeNull()

    render(
      <VariantSelector
        colors={matrix.colors}
        selectedColor={matrix.selectedColor}
        selectedSize={matrix.selectedSize}
        sizes={matrix.sizes}
      />,
    )

    expect(within(sizeRow()).queryAllByRole('radio', { checked: true })).toHaveLength(0)
    /* And the size that was asked for is not invented into the row either. */
    expect(within(sizeRow()).queryByRole('radio', { name: /^XXL/ })).not.toBeInTheDocument()
  })

  it('falls back to a real colour when the URL names one that does not exist, and still reports the URL as invalid', () => {
    const matrix = matrixFor({ color: 'Neon', size: null })

    /*
     * The asymmetry `buildVariantMatrix` argues for: a page with no colour cannot be bought from, so
     * a colour falls back — but it says so, so the page can tell the customer instead of pretending
     * they asked for Black.
     */
    expect(matrix.invalidSelection).toBe(true)
    expect(matrix.selectedColor).toBe('Black')

    render(
      <VariantSelector
        colors={matrix.colors}
        selectedColor={matrix.selectedColor}
        selectedSize={matrix.selectedSize}
        sizes={matrix.sizes}
      />,
    )

    expect(within(colourRow()).getAllByRole('radio', { checked: true })[0]).toHaveAccessibleName(
      'Black',
    )
    expect(within(sizeRow()).queryAllByRole('radio', { checked: true })).toHaveLength(0)
  })

  it('accepts a hand-typed lower-case colour from the URL without flagging it as invalid', () => {
    const matrix = matrixFor({ color: 'black', size: 'm' })

    /* `PRODUCT_PARSERS` carries stored values, and the matrix matches them case-insensitively. */
    expect(matrix.invalidSelection).toBe(false)

    render(
      <VariantSelector
        colors={matrix.colors}
        selectedColor={matrix.selectedColor}
        selectedSize={matrix.selectedSize}
        sizes={matrix.sizes}
      />,
    )

    expect(screen.getByRole('radiogroup', { name: named('Color', 'Black') })).toBeInTheDocument()
    expect(within(sizeRow()).getAllByRole('radio', { checked: true })[0]).toHaveAccessibleName('M')
  })

  it('marks the sizes that exist only in another colour as not made in this one, keeping the full size run visible', () => {
    const matrix = matrixFor({ color: 'Black', size: null })

    render(
      <VariantSelector
        colors={matrix.colors}
        selectedColor={matrix.selectedColor}
        selectedSize={matrix.selectedSize}
        sizes={matrix.sizes}
      />,
    )

    /*
     * L is only made in Cream. It stays in Black's row, marked — that is the whole "disabled, never
     * hidden" rule arriving from the server rather than being asserted against a fixture.
     */
    expect(
      within(sizeRow()).getByRole('radio', { name: named('L', 'not made in this colour') }),
    ).toBeInTheDocument()
    expect(
      within(sizeRow()).getByRole('radio', { name: named('XS', 'sold out in this colour') }),
    ).toBeInTheDocument()
    expect(within(sizeRow()).getByRole('radio', { name: 'S' })).toBeInTheDocument()
  })
})
