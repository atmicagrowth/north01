import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * Section — the unit of vertical rhythm. Visual guide §05.
 *
 * "Large editorial sections should have significant breathing room. Do not remove
 * whitespace simply to fit more content. Avoid random spacing values that create visual
 * drift."
 *
 * Section spacing is fluid between two of the guide's named steps — XL (80px) on mobile
 * up to XXL (144px) on desktop — so §10's "reduce oversized spacing where necessary, but
 * never remove the breathing room that creates the premium feeling" is handled by the
 * scale rather than by per-page overrides.
 *
 * The optional hairline is the guide's structural divider (§06), not decoration: it
 * marks where one chapter ends and the next begins.
 */
const sectionVariants = cva('', {
  variants: {
    spacing: {
      /** Guide XL→XXL. The default separation between editorial chapters. */
      default: 'py-[clamp(5rem,8vw,9rem)]',
      /** Guide L→XL. Sub-sections inside a chapter, and utility pages. */
      tight: 'py-[clamp(2.5rem,5vw,5rem)]',
      /** Guide XXL, held. A single moment given the whole viewport. */
      loose: 'py-[clamp(9rem,12vw,11.25rem)]',
      /** For sections whose child supplies its own rhythm — full-bleed imagery. */
      none: 'py-0',
    },
    divider: {
      top: 'border-t border-border',
      bottom: 'border-b border-border',
      none: '',
    },
  },
  defaultVariants: {
    spacing: 'default',
    divider: 'none',
  },
})

export function Section({
  className,
  spacing,
  divider,
  asChild = false,
  ...props
}: ComponentProps<'section'> & VariantProps<typeof sectionVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'section'

  return (
    <Comp
      data-slot="section"
      className={cn(sectionVariants({ spacing, divider }), className)}
      {...props}
    />
  )
}

/**
 * SectionHeading — the small tracked label that opens a section, optionally with an
 * action on the far right ("NEW ARRIVALS … VIEW ALL").
 *
 * Guide §01 Visual Tension: "oversized type with tiny metadata". This is the tiny half,
 * and it stays tiny — §03's rule is "avoid making every section headline enormous".
 */
export function SectionHeading({
  className,
  children,
  action,
  as: Tag = 'h2',
  ...props
}: ComponentProps<'h2'> & { action?: React.ReactNode; as?: 'h2' | 'h3' }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-m', className)}>
      <Tag data-slot="section-heading" className="font-sans text-meta uppercase" {...props}>
        {children}
      </Tag>
      {action}
    </div>
  )
}

export { sectionVariants }
