'use client'

import { Check, ChevronRight } from 'lucide-react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * DropdownMenu — sort order, account menu, admin-style actions.
 *
 * Radix supplies roving focus, typeahead, Escape, `onCloseAutoFocus` restoration, the
 * focus scope, scroll locking, `aria-haspopup="menu"`, `aria-expanded` and
 * `aria-controls` on the trigger, and the `menu`/`menuitem`/`menuitemcheckbox`/
 * `menuitemradio`/`group`/`separator` roles.
 *
 * Guide §06: solid charcoal surface, strong alignment, minimal shadowing. The panel
 * fades and moves 4px — enough to read as arriving, not enough to notice.
 */
export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group
export const DropdownMenuSub = DropdownMenuPrimitive.Sub
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const itemClasses = [
  'relative flex cursor-default select-none items-center gap-2',
  'rounded-sm px-3 py-2',
  'font-sans text-body-sm text-foreground-muted outline-none',
  'transition-colors duration-(--duration-instant) ease-entrance',
  'data-highlighted:bg-surface-raised data-highlighted:text-foreground',
  'data-disabled:pointer-events-none data-disabled:text-foreground-disabled',
  "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
]

export function DropdownMenuContent({
  className,
  sideOffset = 8,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[10rem] overflow-hidden p-1',
          'rounded-md border border-border bg-surface shadow-overlay',
          'max-h-(--radix-dropdown-menu-content-available-height)',
          'data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(itemClasses, className)}
      {...props}
    />
  )
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(itemClasses, 'pr-8', className)}
      {...props}
    >
      {children}
      <span className="absolute right-3 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check aria-hidden className="size-3.5" strokeWidth={2} />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(itemClasses, 'pr-8', className)}
      {...props}
    >
      {children}
      <span className="absolute right-3 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <span className="size-1.5 rounded-full bg-foreground" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
    </DropdownMenuPrimitive.RadioItem>
  )
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn('px-3 py-2 font-sans text-micro uppercase text-foreground-muted', className)}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(itemClasses, 'data-[state=open]:bg-surface-raised', className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        className={cn(
          'z-50 min-w-[10rem] overflow-hidden p-1',
          'rounded-md border border-border bg-surface shadow-overlay',
          'data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}
