'use client'

import { Tabs as TabsPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * Tabs — visual guide §06: links and controls are "often underlined or paired with a
 * subtle rule".
 *
 * The tab list is a hairline rule; the active tab sits on a 1px Bone segment of it. No
 * pills, no filled backgrounds, no card. Selection is contrast — Stone label to Bone
 * label plus the rule beneath — which is the G-14 answer applied again.
 *
 * Radix supplies roving tabindex, arrow-key navigation, `role="tablist"`/`tab`/
 * `tabpanel`, `aria-selected`, `aria-controls`, and `aria-orientation`.
 *
 * **What Radix does not supply:** an accessible name for the tab list. It puts no
 * `aria-label` on `TabsList`, so `label` is a required prop here — a screen-reader user
 * who lands on a tablist with no name has no idea what the tabs switch between.
 */
export const Tabs = TabsPrimitive.Root

export function TabsList({
  className,
  label,
  ...props
}: ComponentProps<typeof TabsPrimitive.List> & { label: string }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      aria-label={label}
      className={cn(
        'relative flex items-stretch gap-l overflow-x-auto',
        'border-b border-border',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'relative -mb-px shrink-0 whitespace-nowrap',
        'border-b border-transparent pb-3 pt-1',
        'font-sans text-meta uppercase text-foreground-muted',
        'transition-colors duration-(--duration-fast) ease-entrance',
        'hover:text-foreground',
        'data-[state=active]:border-border-strong data-[state=active]:text-foreground',
        'disabled:pointer-events-none disabled:text-foreground-disabled',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('pt-m outline-none', 'data-[state=active]:animate-fade-in', className)}
      {...props}
    />
  )
}
