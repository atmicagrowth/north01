'use client'

import { useQueryStates } from 'nuqs'
import { useId, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  CATALOG_PARSERS,
  CATALOG_SORTS,
  CATALOG_SORT_LABELS,
  type CatalogSort,
  type CatalogVocabulary,
  type FacetOption,
} from '@/lib/catalog/query'
import { cn } from '@/lib/cn'

/**
 * **The controls that write to the URL.** Plan §11.1d: *"Use URL parameters through nuqs."*
 *
 * This is the only client JavaScript the shop page ships, and everything in it exists because the
 * customer is *changing* state rather than following a link. Pagination, the filter chips' remove
 * links and the empty state's escape hatches are all real anchors built by `catalogHref`, because a
 * link that navigates has no reason to be a component.
 *
 * ---
 *
 * ### The three options passed to every write, and why each is not the default
 *
 * ```ts
 * { history: 'push', scroll: false, shallow: false }
 * ```
 *
 * - **`shallow: false`.** nuqs defaults to a client-only URL update, which is right for a control
 *   whose effect is client-side. Here the grid is rendered on the server from these exact
 *   parameters, so a shallow write would change the address bar and **nothing else** — the classic
 *   fake control. This is the single most important line in the file.
 * - **`history: 'push'`.** Feature matrix §5 requires that *"browser back/forward restores state"*,
 *   and the default `replace` makes Back leave the shop entirely after a customer has ticked four
 *   filters. Push costs a history entry per change; that is the price of the requirement.
 * - **`scroll: false`.** The default jumps to the top of the document. A customer ticking "M" three
 *   facets down the panel does not want to be thrown back to the page title; the grid updating in
 *   place is what they expect.
 *
 * ### Every write resets the page, and forgetting that is a real defect
 *
 * Standing on page 3 of "Jackets" and ticking Black keeps `?page=3` unless something clears it — and
 * the new result set almost certainly has fewer than three pages, so the customer applies a filter
 * and lands on an empty grid that says nothing matched. `setFilters` therefore always writes
 * `page: null`, which the serializer omits entirely rather than writing `page=1`.
 */

const WRITE_OPTIONS = { history: 'push', scroll: false, shallow: false } as const

/* -------------------------------------------------------------------------------------------------
 * Sort
 * ---------------------------------------------------------------------------------------------- */

/**
 * The sort control.
 *
 * A native `<select>`, not the design system's `Select`. That is a deliberate departure and it is
 * the accessible choice on the surface that needs it most: a native select on a phone opens the
 * platform's own wheel picker, which is operable one-handed, respects the system font size, and
 * needs no JavaScript to be usable at all. Radix's listbox is the right primitive when an option
 * needs rich content — it does not here, because every option is four words of plain text.
 *
 * Guide §06's input styling is applied to it directly so it does not read as an unstyled browser
 * control in the middle of a considered page.
 */
export function SortControl({ value }: { value: CatalogSort }) {
  const [, setFilters] = useQueryStates(CATALOG_PARSERS, WRITE_OPTIONS)
  const id = useId()

  return (
    /*
     * `min-w-0 flex-1` on a phone and `flex-none` from `sm` up. A flex item's default `min-width` is
     * `auto`, which refuses to shrink below its content — so a fixed `min-w-[11rem]` on the select
     * pushed the whole control row past a 320px viewport rather than narrowing. The select keeps its
     * comfortable width wherever there is room and gives it up where there is not.
     */
    <div className="flex min-w-0 flex-1 items-center gap-s sm:flex-none">
      <Label htmlFor={id} className="whitespace-nowrap text-meta uppercase text-foreground-muted">
        Sort
      </Label>

      <select
        id={id}
        value={value}
        onChange={(event) => {
          void setFilters({ page: null, sort: event.target.value as CatalogSort })
        }}
        className={cn(
          'h-10 w-full min-w-0 rounded-sm border border-border-control bg-transparent px-3 sm:w-auto sm:min-w-[11rem]',
          'font-sans text-body-sm text-foreground',
          'transition-colors duration-(--duration-fast)',
          'hover:border-border-strong',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        )}
      >
        {CATALOG_SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {CATALOG_SORT_LABELS[sort]}
          </option>
        ))}
      </select>
    </div>
  )
}

/* -------------------------------------------------------------------------------------------------
 * Facets
 * ---------------------------------------------------------------------------------------------- */

function FacetGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <fieldset className="border-t border-border pt-m">
      {/*
        A `<legend>` rather than a styled `<p>`. The grouping is what tells a screen-reader user that
        "M" is a size and not a colour — without it the panel announces sixteen unrelated check
        boxes. It is the one piece of markup here that axe cannot miss and a sighted review cannot
        see.
      */}
      <legend className="mb-s font-sans text-meta uppercase text-foreground">{label}</legend>
      {children}
    </fieldset>
  )
}

function CheckboxFacet({
  name,
  onToggle,
  options,
  selected,
}: {
  name: string
  onToggle: (value: string, checked: boolean) => void
  options: FacetOption[]
  selected: string[]
}) {
  const prefix = useId()

  return (
    <ul className="flex flex-col gap-s">
      {options.map((option) => {
        const id = `${prefix}-${option.value}`

        return (
          <li key={option.value} className="flex items-center gap-s">
            <Checkbox
              id={id}
              name={name}
              checked={selected.includes(option.value)}
              onCheckedChange={(checked) => onToggle(option.value, checked === true)}
            />
            <Label htmlFor={id} className="cursor-pointer text-body-sm normal-case tracking-normal">
              {option.label}
            </Label>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The price facet: two numbers and an Apply.
 *
 * **Not a two-handle slider**, and that is a decision rather than a shortcut. A slider needs a drag
 * interaction that is hostile on a phone, an ARIA pattern that is easy to get wrong, and a
 * JavaScript dependency for a control whose entire output is two integers. Two `type="number"`
 * inputs are operable by keyboard, by screen reader and by thumb, and they let a customer type "200"
 * instead of hunting for it — which is what someone with a budget in mind actually wants.
 *
 * It is a small `<form>` with a submit button, so Enter in either field applies the range. Applying
 * on every keystroke would fire a server round trip per digit and make "1", "12", "120" three
 * separate searches on the way to one.
 *
 * The empty string is written as `null`, not `0`. Clearing the box means *"no upper bound"*, and
 * `Number('')` is `0` — which would silently filter the shop down to items costing nothing.
 */
function PriceFacet({
  max,
  min,
  onApply,
  placeholderMax,
  placeholderMin,
}: {
  max: null | number
  min: null | number
  onApply: (next: { max: null | number; min: null | number }) => void
  placeholderMax: string
  placeholderMin: string
}) {
  const [draftMin, setDraftMin] = useState(min === null ? '' : String(min))
  const [draftMax, setDraftMax] = useState(max === null ? '' : String(max))
  const minId = useId()
  const maxId = useId()

  const toValue = (raw: string): null | number => {
    const trimmed = raw.trim()

    if (trimmed === '') {
      return null
    }

    const parsed = Number(trimmed)

    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
  }

  return (
    <form
      className="flex flex-wrap items-end gap-s"
      onSubmit={(event) => {
        event.preventDefault()
        onApply({ max: toValue(draftMax), min: toValue(draftMin) })
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Label htmlFor={minId} className="text-micro normal-case tracking-normal">
          Min
        </Label>
        <Input
          id={minId}
          inputMode="numeric"
          min={0}
          onChange={(event) => setDraftMin(event.target.value)}
          placeholder={placeholderMin}
          type="number"
          value={draftMin}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Label htmlFor={maxId} className="text-micro normal-case tracking-normal">
          Max
        </Label>
        <Input
          id={maxId}
          inputMode="numeric"
          min={0}
          onChange={(event) => setDraftMax(event.target.value)}
          placeholder={placeholderMax}
          type="number"
          value={draftMax}
        />
      </div>

      <Button type="submit" variant="secondary" size="sm">
        Apply
      </Button>
    </form>
  )
}

/**
 * **The whole filter panel.**
 *
 * One component for the desktop rail and the mobile drawer, because they are the same controls in a
 * different box — structure §5 asks for both (*"desktop filter area, mobile filter drawer"*) and
 * two implementations would be two things to keep in step.
 *
 * `routeCategory` suppresses the category group on `/shop/<category>`. Offering "Clothing" as a tick
 * box on the Clothing page is offering a customer a control whose only effect is to leave the page
 * they asked for.
 */
export function FilterPanel({
  routeCategory,
  vocabulary,
}: {
  routeCategory?: null | string
  vocabulary: CatalogVocabulary
}) {
  const [filters, setFilters] = useQueryStates(CATALOG_PARSERS, WRITE_OPTIONS)

  const toggle =
    (key: 'category' | 'collection' | 'color' | 'size') => (value: string, checked: boolean) => {
      const current = filters[key]
      const next = checked ? [...current, value] : current.filter((entry) => entry !== value)

      /*
       * An empty array is written as `null` so the serializer drops the key. Leaving `?color=` in the
       * URL is a filter that looks applied, reads as applied to anything parsing the URL, and narrows
       * nothing.
       */
      void setFilters({ [key]: next.length > 0 ? next : null, page: null })
    }

  const groups: {
    key: 'category' | 'collection' | 'color' | 'size'
    label: string
    options: FacetOption[]
  }[] = [
    ...(routeCategory
      ? []
      : [{ key: 'category' as const, label: 'Category', options: vocabulary.categories }]),
    { key: 'collection', label: 'Collection', options: vocabulary.collections },
    { key: 'size', label: 'Size', options: vocabulary.sizes },
    { key: 'color', label: 'Colour', options: vocabulary.colors },
  ]

  return (
    <div className="flex flex-col gap-l" data-slot="filter-panel">
      {groups
        /*
         * A facet with nothing in it is not rendered. An empty "Collection" heading over no options
         * tells a customer the shop is broken; omitting it tells them nothing is missing, which is
         * true — there are no published collections to filter by.
         */
        .filter((group) => group.options.length > 0)
        .map((group) => (
          <FacetGroup key={group.key} label={group.label}>
            <CheckboxFacet
              name={group.key}
              onToggle={toggle(group.key)}
              options={group.options}
              selected={filters[group.key]}
            />
          </FacetGroup>
        ))}

      <FacetGroup label="Availability">
        <div className="flex items-center gap-s">
          <Checkbox
            id="availability-in-stock"
            checked={filters.availability === 'in-stock'}
            onCheckedChange={(checked) => {
              void setFilters({ availability: checked === true ? 'in-stock' : null, page: null })
            }}
          />
          <Label
            htmlFor="availability-in-stock"
            className="cursor-pointer text-body-sm normal-case tracking-normal"
          >
            In stock only
          </Label>
        </div>
      </FacetGroup>

      <FacetGroup label="Price">
        <PriceFacet
          max={filters.priceMax}
          min={filters.priceMin}
          onApply={({ max, min }) => {
            void setFilters({ page: null, priceMax: max, priceMin: min })
          }}
          placeholderMax={
            vocabulary.priceCeilingMinor === null
              ? 'Any'
              : String(Math.ceil(vocabulary.priceCeilingMinor / 100))
          }
          placeholderMin={
            vocabulary.priceFloorMinor === null
              ? '0'
              : String(Math.floor(vocabulary.priceFloorMinor / 100))
          }
        />
      </FacetGroup>
    </div>
  )
}
