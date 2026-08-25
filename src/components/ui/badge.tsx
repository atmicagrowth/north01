import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * Badge — visual guide §06: "Small. Typographic. Quiet. Monochrome or very restrained.
 * Avoid colourful sticker-like badges."
 *
 * Micro type, 10px, tracked, uppercase, in a 1px outline. Nothing here is filled, and
 * nothing is a pill.
 *
 * `accent` is the one place Soft Taupe appears as type in this system. It exists for the
 * markers that must be findable in a grid of otherwise identical product tiles — SALE,
 * NEW, LIMITED — and the G-14 rule that governs it is: **a 1px rule or a ≤10px label,
 * never a fill**. See notes §1.8.2.
 */
const badgeVariants = cva(
  [
    'inline-flex items-center justify-center whitespace-nowrap',
    'rounded-sm border px-2 py-1',
    'font-sans text-micro uppercase',
  ],
  {
    variants: {
      variant: {
        /** The default marker: outlined, secondary text. */
        default: 'border-border text-foreground-muted',
        /** Merchandising markers that must be found at a glance. */
        accent: 'border-accent text-accent',
        /** Sold out, unavailable, discontinued. Recedes on purpose. */
        muted: 'border-border text-foreground-muted',
        /** A genuine problem with the item — payment failed, address invalid. */
        error: 'border-error text-error',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { badgeVariants }
