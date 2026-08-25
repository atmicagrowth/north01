'use client'

import { Plus } from 'lucide-react'
import { Accordion as AccordionPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * Accordion — the product page's Description / Details / Size & Fit / Shipping & Returns
 * stack, and the FAQ.
 *
 * Guide §06 "Dividers: 1px, low contrast, used to structure space." Rows are separated
 * by hairlines and nothing else — no card, no fill, no rounded container. The indicator
 * is a thin plus that rotates 45° into a cross rather than a chevron that flips, which
 * keeps the icon geometry constant.
 *
 * Radix supplies `role="region"`, `aria-labelledby`, `aria-expanded`, `aria-controls`,
 * Home/End and all four arrow keys, and the `--radix-accordion-content-height` custom
 * property that the open/close keyframes animate against.
 *
 * The header level is a real `<h3>` (Radix's `AccordionPrimitive.Header` renders one),
 * which matters for the plan's "correct heading structure" requirement — pass
 * `headingLevel` if the surrounding page needs a different rank.
 */
export const Accordion = AccordionPrimitive.Root

export function AccordionItem({
  className,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('border-b border-border', className)}
      {...props}
    />
  )
}

export function AccordionTrigger({
  className,
  children,
  headingLevel = 3,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Trigger> & { headingLevel?: 2 | 3 | 4 }) {
  return (
    <AccordionPrimitive.Header asChild>
      {/* Radix defaults to h3; `asChild` lets the page choose a rank that fits its
          outline instead of forcing one. */}
      {createHeading(
        headingLevel,
        <AccordionPrimitive.Trigger
          data-slot="accordion-trigger"
          className={cn(
            'group flex w-full items-center justify-between gap-m',
            'py-m text-left',
            'font-sans text-meta uppercase text-foreground-muted',
            'transition-colors duration-(--duration-fast) ease-entrance',
            'hover:text-foreground',
            'data-[state=open]:text-foreground',
            'disabled:pointer-events-none disabled:text-foreground-disabled',
            className,
          )}
          {...props}
        >
          {children}
          <Plus
            aria-hidden
            strokeWidth={1.25}
            className={cn(
              'size-4 shrink-0',
              'transition-transform duration-(--duration-base) ease-editorial',
              'group-data-[state=open]:rotate-45',
            )}
          />
        </AccordionPrimitive.Trigger>,
      )}
    </AccordionPrimitive.Header>
  )
}

function createHeading(level: 2 | 3 | 4, child: ReactNode) {
  const Tag = `h${level}` as const
  return <Tag className="m-0 font-sans">{child}</Tag>
}

export function AccordionContent({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className={cn(
        'overflow-hidden',
        'data-[state=open]:animate-accordion-open data-[state=closed]:animate-accordion-close',
      )}
      {...props}
    >
      <div className={cn('pb-m font-sans text-body-sm text-foreground-muted', className)}>
        {children}
      </div>
    </AccordionPrimitive.Content>
  )
}
