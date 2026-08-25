'use client'

import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { Select as SelectPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * Select — visual guide §06 "Drawers / Dropdowns": solid charcoal surfaces, strong
 * alignment, clear hierarchy, restrained motion, minimal shadowing.
 *
 * Radix supplies `role="combobox"`/`listbox`/`option`, `aria-expanded`, typeahead,
 * arrow-key navigation, Escape, the focus scope, scroll locking, and a hidden native
 * `<select>` so the value participates in form submission and autofill.
 *
 * **What Radix does NOT supply, and the caller therefore owes:** an accessible name on
 * the trigger. Radix puts no `aria-label` or `aria-labelledby` on it. Associate a
 * `<Label htmlFor>` with the trigger's `id`, or pass `aria-label` — otherwise the
 * control is announced with only its current value and no indication of what it sets.
 */
export const Select = SelectPrimitive.Root
export const SelectGroup = SelectPrimitive.Group
export const SelectValue = SelectPrimitive.Value

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'flex h-11 w-full items-center justify-between gap-2',
        'rounded-sm border border-border-control bg-surface',
        'px-4 py-2.5',
        'font-sans text-body text-foreground',
        'transition-colors duration-(--duration-fast) ease-entrance',
        'data-placeholder:text-foreground-muted',
        'hover:border-foreground-muted',
        'data-[state=open]:border-border-strong',
        'aria-invalid:border-error aria-invalid:hover:border-error',
        'disabled:cursor-not-allowed disabled:border-border disabled:text-foreground-disabled',
        '[&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-foreground-muted',
            'transition-transform duration-(--duration-fast) ease-entrance',
          )}
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          'relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem]',
          'overflow-hidden rounded-md border border-border bg-surface',
          'shadow-overlay',
          'data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out',
          position === 'popper' && 'w-full min-w-(--radix-select-trigger-width)',
          className,
        )}
        {...props}
      >
        <SelectScrollButton direction="up" />
        <SelectPrimitive.Viewport className={cn('p-1', position === 'popper' && 'h-auto')}>
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollButton direction="down" />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectScrollButton({ direction }: { direction: 'up' | 'down' }) {
  const Comp =
    direction === 'up' ? SelectPrimitive.ScrollUpButton : SelectPrimitive.ScrollDownButton
  const Icon = direction === 'up' ? ChevronUp : ChevronDown

  return (
    <Comp className="flex cursor-default items-center justify-center py-1 text-foreground-muted">
      <Icon aria-hidden className="size-4" />
    </Comp>
  )
}

export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn('px-3 py-2 font-sans text-micro uppercase text-foreground-muted', className)}
      {...props}
    />
  )
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-default select-none items-center',
        'gap-2 rounded-sm py-2 pl-3 pr-8',
        'font-sans text-body-sm text-foreground-muted outline-none',
        'transition-colors duration-(--duration-instant) ease-entrance',
        // Radix drives highlight from keyboard AND pointer, so one attribute covers both.
        'data-highlighted:bg-surface-raised data-highlighted:text-foreground',
        'data-[state=checked]:text-foreground',
        'data-disabled:pointer-events-none data-disabled:text-foreground-disabled',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-3 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check aria-hidden className="size-3.5" strokeWidth={2} />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  )
}

export function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}
