'use client'

import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * RadioGroup — one choice from a set. Shipping method, sort order, payment option.
 *
 * A circle is one of the two things in this system allowed `rounded-full`; the guide's
 * ban on pills is about controls pretending to be circles, not about radios.
 *
 * Radix supplies roving tabindex (the group is one tab stop, arrows move within it),
 * `role="radiogroup"`, `aria-checked`, and the hidden native inputs. Arrow-key selection
 * is Radix's, not ours.
 */
export function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-s', className)}
      {...props}
    />
  )
}

export function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'peer size-5 shrink-0',
        'flex items-center justify-center',
        'rounded-full border border-border-control bg-transparent',
        'transition-colors duration-(--duration-fast) ease-entrance',
        'hover:border-foreground-muted',
        'data-[state=checked]:border-foreground',
        'aria-invalid:border-error',
        'disabled:cursor-not-allowed disabled:border-border',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className={cn(
          'block size-2.5 rounded-full bg-foreground',
          'peer-disabled:bg-foreground-disabled',
        )}
      />
    </RadioGroupPrimitive.Item>
  )
}
