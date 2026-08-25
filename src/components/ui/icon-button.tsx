import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * IconButton — a square, icon-only control. Header utilities, dialog close buttons,
 * quantity steppers.
 *
 * Guide §06: "thin line icons, consistent stroke weight, simple geometry, small visual
 * footprint. Never use oversized decorative icons." The icon is 16px inside a 40-44px
 * target, which keeps the footprint small while the hit area stays comfortable.
 *
 * **`label` is required, not optional.** An icon-only control has no accessible name,
 * and the plan's §3.1d accessibility list calls for `aria-label` on icon-only buttons.
 * Making it a required prop moves that from a review item to a compile error.
 */
const iconButtonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center',
    'rounded-sm border transition-colors',
    'duration-(--duration-fast) ease-entrance',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-foreground-disabled',
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        // The header default: no chrome at rest, so a row of utility icons reads as
        // typography rather than as a toolbar.
        ghost: [
          'border-transparent bg-transparent text-foreground-muted',
          'hover:text-foreground',
          'active:text-foreground-muted',
        ],
        outline: [
          'border-border-control bg-transparent text-foreground',
          'hover:border-border-strong hover:bg-surface',
          'active:bg-surface-raised',
          'disabled:border-border',
        ],
      },
      size: {
        sm: 'size-9',
        md: 'size-11',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
    },
  },
)

export type IconButtonProps = Omit<ComponentProps<'button'>, 'aria-label'> &
  VariantProps<typeof iconButtonVariants> & {
    /** The control's accessible name. Required — an icon is not a name. */
    label: string
    asChild?: boolean
  }

export function IconButton({
  className,
  variant,
  size,
  label,
  asChild = false,
  children,
  ...props
}: IconButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="icon-button"
      aria-label={label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </Comp>
  )
}

export { iconButtonVariants }
