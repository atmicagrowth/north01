'use client'

import { Separator as SeparatorPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * Separator — visual guide §06: "1px. Low contrast. Used to structure space. Never used
 * as decorative noise."
 *
 * Graphite, and Graphite is correct here: a divider is decorative under WCAG 1.4.11, so
 * the 3:1 floor that pushes control borders up to Muted Stone does not apply to it. This
 * is the "usually low-contrast graphite" the guide asks for.
 *
 * Radix defaults to `decorative`, which renders `role="none"` — right for a rule that
 * only groups things visually. Pass `decorative={false}` when the rule carries real
 * separation an assistive technology should hear.
 */
export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      orientation={orientation}
      decorative={decorative}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}
