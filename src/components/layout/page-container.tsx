import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * PageContainer — visual guide §04: "a disciplined max-width grid", "generous outer
 * margins", "consistent gutters".
 *
 * The outer margin is fluid — 20px on a phone, 64px from roughly 1600px up — so the
 * gutter grows with the viewport instead of the content sliding to the screen edge on
 * a laptop and floating in the middle of a large display.
 *
 * Every page-level surface goes through this. Nothing sets its own `max-width` and
 * `padding-inline` inline; that is how gutters drift apart between routes.
 */
const pageContainerVariants = cva(['mx-auto w-full', 'px-[clamp(1.25rem,4vw,4rem)]'], {
  variants: {
    width: {
      /** 1440px. Editorial and merchandising pages. */
      page: 'max-w-page',
      /** 1024px. Account, checkout, support — guide §09 "simpler and calmer". */
      narrow: 'max-w-narrow',
      /** 672px. Reading measure for long-form copy; guide §04 "narrow text columns". */
      prose: 'max-w-prose',
      /** No maximum, but keep the gutters. Full-bleed imagery with aligned captions. */
      full: 'max-w-none',
    },
  },
  defaultVariants: {
    width: 'page',
  },
})

export function PageContainer({
  className,
  width,
  asChild = false,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof pageContainerVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div'

  return (
    <Comp
      data-slot="page-container"
      className={cn(pageContainerVariants({ width }), className)}
      {...props}
    />
  )
}

export { pageContainerVariants }
