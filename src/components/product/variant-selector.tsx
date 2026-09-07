'use client'

import { useId, useRef, type ReactNode } from 'react'

import { useUrlState } from '@/components/url-state'
import { cn } from '@/lib/cn'
import { PRODUCT_PARSERS } from '@/lib/product/params'
import { isRovingKey, rovingIndex, tabbableIndex } from '@/lib/product/roving'
import type { ColorOption, SizeOption } from '@/lib/product/variants'

/**
 * **Plan §13.1c's selector.** Colour and size, with the impossible combinations disabled.
 *
 * The rules are **not** here. `buildVariantMatrix` decides which sizes exist, which are purchasable
 * in the selected colour and which combination resolves to a variant, and it does so on the server
 * before this renders. This component writes two URL parameters and paints what it was handed.
 *
 * That split is the phase's central requirement — *"variant selection must be authoritative"* — made
 * structural. A selector that computed availability in the browser would be a second implementation
 * of the rule, and the browser's copy is the one that can be edited by whoever is looking at it.
 *
 * ### Why the selection lives in the URL
 *
 * Feature matrix §7 lists *"invalid variant query"* among the page's edge cases, which is only an
 * edge case if the variant is **in** the query. So it is: `?color=Bone&size=M`. That makes a
 * specific colourway shareable, makes Back work between colours, and means the server resolves the
 * selection — the same reason plan §11.1d put the shop's filters there.
 *
 * `useUrlState` supplies the three options every URL-backed control in the storefront shares, and the
 * rule that a selection made before the server has answered the previous one **replaces** rather than
 * pushes — see that file for the defect it closes, which was found by walking this page's own
 * history.
 *
 * ### Disabled, never hidden
 *
 * §13.1c: *"Disable impossible options where appropriate."* A size that vanishes when the customer
 * changes colour reads as a rendering fault, and it destroys the one piece of information a shopper
 * most wants — whether the garment is made in their size at all. `aria-disabled` rather than the
 * `disabled` attribute keeps the control focusable, so a keyboard user can read the size and hear
 * that it is unavailable instead of having it skipped silently.
 *
 * ### Focus moves; only Space and Enter commit
 *
 * ARIA 1.2's radio group ordinarily **selects on arrow** — focus and selection travel together. This
 * one does not, and the reason is `shallow: false`: every selection is a server round-trip that
 * re-resolves the variant, the price and the stock message. Arrowing across six sizes to reach the
 * seventh would fire six navigations and leave the customer looking at whichever one landed last.
 *
 * So arrows move focus, and Space or Enter commits — the manual-activation variant ARIA describes
 * for controls whose selection has a real cost. `aria-checked` therefore tracks the **selection**,
 * never the focus, which is what a screen reader needs it to mean.
 */
export function VariantSelector({
  colors,
  selectedColor,
  selectedSize,
  sizes,
}: {
  colors: ColorOption[]
  selectedColor: null | string
  selectedSize: null | string
  sizes: SizeOption[]
}) {
  const [, commit] = useUrlState(PRODUCT_PARSERS)

  const colorLabelId = useId()
  const sizeLabelId = useId()

  return (
    <div className="flex flex-col gap-l" data-slot="variant-selector">
      {colors.length > 0 ? (
        <div>
          <p className="mb-s font-sans text-meta uppercase text-foreground-muted" id={colorLabelId}>
            Colour
            {selectedColor ? <span className="text-foreground"> — {selectedColor}</span> : null}
          </p>

          <RadioRow
            labelledBy={colorLabelId}
            onSelect={(value) => {
              /*
               * Changing colour clears the size. The same size in a different colour may not exist,
               * and carrying a stale selection across is how a customer ends up looking at a "sold
               * out" message for a combination they never chose. §13.1c's example is exactly this
               * case: Black / M exists, Cream / M does not.
               */
              void commit({ color: value, size: null })
            }}
            options={colors.map((color) => ({
              className: cn(
                'flex h-10 items-center gap-2 rounded-sm border px-3',
                'font-sans text-body-sm transition-colors duration-(--duration-fast)',
                color.value === selectedColor
                  ? 'border-border-strong text-foreground'
                  : 'border-border-control text-foreground-muted hover:border-border-strong',
              ),
              content: (
                <>
                  {color.hex ? (
                    <span
                      aria-hidden="true"
                      className="size-4 rounded-full ring-1 ring-inset ring-border"
                      style={{ backgroundColor: color.hex }}
                    />
                  ) : null}
                  {color.value}
                  {color.available ? null : <span className="sr-only"> — sold out</span>}
                </>
              ),
              /* A colour with no stock anywhere is still selectable — it is how you look at it. */
              disabled: false,
              value: color.value,
            }))}
            selected={selectedColor}
          />
        </div>
      ) : null}

      {sizes.length > 0 ? (
        <div>
          <p className="mb-s font-sans text-meta uppercase text-foreground-muted" id={sizeLabelId}>
            Size
          </p>

          <RadioRow
            labelledBy={sizeLabelId}
            onSelect={(value) => {
              void commit({ size: value })
            }}
            options={sizes.map((size) => ({
              className: cn(
                'h-10 min-w-12 rounded-sm border px-3',
                'font-sans text-body-sm transition-colors duration-(--duration-fast)',
                size.value === selectedSize
                  ? 'border-border-strong text-foreground'
                  : 'border-border-control text-foreground-muted hover:border-border-strong',
                !size.available &&
                  'text-foreground-disabled line-through hover:border-border-control',
              ),
              content: (
                <>
                  {size.value}
                  <span className="sr-only">
                    {size.missing
                      ? ' — not made in this colour'
                      : size.available
                        ? ''
                        : ' — sold out in this colour'}
                  </span>
                </>
              ),
              disabled: !size.available,
              value: size.value,
            }))}
            selected={selectedSize}
          />
        </div>
      ) : null}
    </div>
  )
}

type RowOption = {
  className: string
  content: ReactNode
  disabled: boolean
  value: string
}

/**
 * One radio group: a single tab stop, arrow keys between the options, Space or Enter to commit.
 *
 * Unavailable options are **visited** by the arrow keys rather than skipped. That is the whole point
 * of `aria-disabled` over `disabled` — a keyboard user arrives at XS, hears *"XS, sold out in this
 * colour"*, and learns the same thing a sighted customer learns from the strike-through. Skipping it
 * would hide the fact that the garment is made in that size, which is the information the row exists
 * to carry.
 */
function RadioRow({
  labelledBy,
  onSelect,
  options,
  selected,
}: {
  labelledBy: string
  onSelect: (value: string) => void
  options: RowOption[]
  selected: null | string
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const roving = tabbableIndex(options.findIndex((option) => option.value === selected))

  return (
    <div
      aria-labelledby={labelledBy}
      className="flex flex-wrap gap-s"
      onKeyDown={(event) => {
        if (!isRovingKey(event.key)) {
          return
        }

        /*
         * Preventing the default stops Home/End scrolling the document and the arrows scrolling it
         * sideways — both of which would move the page out from under the option that just took
         * focus.
         */
        event.preventDefault()

        const from = buttons.current.findIndex((node) => node === document.activeElement)

        buttons.current[rovingIndex(from, options.length, event.key)]?.focus()
      }}
      role="radiogroup"
    >
      {options.map((option, index) => (
        <button
          aria-checked={option.value === selected}
          aria-disabled={option.disabled}
          className={option.className}
          key={option.value}
          onClick={() => {
            if (!option.disabled) {
              onSelect(option.value)
            }
          }}
          ref={(node) => {
            buttons.current[index] = node
          }}
          role="radio"
          tabIndex={index === roving ? 0 : -1}
          type="button"
        >
          {option.content}
        </button>
      ))}
    </div>
  )
}
