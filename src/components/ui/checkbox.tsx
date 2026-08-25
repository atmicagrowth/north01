'use client'

import { Check, Minus } from 'lucide-react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * Checkbox — the filter control. Squared at 2px, never a rounded toggle.
 *
 * Selection is carried by **contrast**, not by colour: unchecked is a Muted Stone
 * outline on the page, checked is a solid Bone fill with an Obsidian mark. That is the
 * G-14 resolution applied — the palette forbids a saturated accent, and 17:1 of contrast
 * is a louder signal than any hue would be anyway. See notes §1.8.2.
 *
 * Radix supplies the roving state, the `role="checkbox"`, `aria-checked` (including
 * `mixed` for indeterminate), Space activation, and a hidden native input for form
 * submission. None of that is reimplemented here.
 */
export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-5 shrink-0',
        'flex items-center justify-center',
        'rounded-sm border border-border-control bg-transparent',
        'transition-colors duration-(--duration-fast) ease-entrance',
        'hover:border-foreground-muted',
        'data-[state=checked]:border-foreground data-[state=checked]:bg-foreground',
        'data-[state=checked]:text-canvas',
        'data-[state=indeterminate]:border-foreground data-[state=indeterminate]:bg-foreground',
        'data-[state=indeterminate]:text-canvas',
        'aria-invalid:border-error',
        'disabled:cursor-not-allowed disabled:border-border',
        'disabled:data-[state=checked]:border-border disabled:data-[state=checked]:bg-border',
        'disabled:data-[state=checked]:text-foreground-disabled',
        className,
      )}
      {...props}
    >
      {/*
        Which mark shows is decided by the `data-state` Radix writes on the indicator, not
        by reading `props.checked`. Reading the prop only works while the checkbox is
        controlled: an uncontrolled one set to `defaultChecked="indeterminate"`, or flipped
        to indeterminate from inside Radix, would have gone on rendering a tick.
      */}
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="group/indicator flex items-center justify-center text-current"
      >
        <Check
          aria-hidden
          strokeWidth={2}
          className="size-3.5 group-data-[state=indeterminate]/indicator:hidden"
        />
        <Minus
          aria-hidden
          strokeWidth={2}
          className="hidden size-3.5 group-data-[state=indeterminate]/indicator:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
