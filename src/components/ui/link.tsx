import { cva, type VariantProps } from 'class-variance-authority'
import NextLink from 'next/link'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * Link — visual guide §06.
 *
 * "Text-first. Precise. Often underlined or paired with a subtle rule. Hover states
 * should be subtle and controlled."
 *
 * Underlines are drawn with `underline-offset-4` and a `decoration-1` hairline rather
 * than the browser default, which sits too close to a Didone's descenders and too heavy
 * against Bone on near-black.
 */
const linkVariants = cva(
  [
    'transition-colors duration-(--duration-fast) ease-entrance',
    'rounded-sm', // so the focus outline follows the control, not a bare text box
  ],
  {
    variants: {
      variant: {
        /** Body copy. Underlined at rest, because inside a paragraph nothing else marks it. */
        inline: [
          'text-foreground underline decoration-border-control decoration-1 underline-offset-4',
          'hover:decoration-foreground',
        ],
        /** Standalone navigation and footer links. The rule appears on hover. */
        quiet: [
          'text-foreground-muted no-underline',
          'hover:text-foreground hover:underline hover:decoration-1 hover:underline-offset-4',
        ],
        /** Uppercase utility links: "SHOP THE COLLECTION", breadcrumb tails, footer heads. */
        meta: [
          'font-sans text-meta uppercase text-foreground-muted no-underline',
          'hover:text-foreground',
        ],
        /**
         * No colour, no underline — for a link whose appearance belongs to the component
         * wrapping it, such as an `IconButton asChild`.
         *
         * This variant exists because Radix's `Slot` **concatenates** class strings; it
         * does not run `tailwind-merge`. So when a styled parent wraps a styled child,
         * both sets of classes land on one element and the winner is decided by
         * Tailwind's stylesheet order rather than by either author. Passing `unstyled`
         * removes the conflict at the source instead of hoping the order stays favourable.
         */
        unstyled: '',
      },
    },
    defaultVariants: {
      variant: 'inline',
    },
  },
)

export type LinkProps = ComponentProps<typeof NextLink> &
  VariantProps<typeof linkVariants> & {
    /**
     * Leaves the site. Adds `target="_blank"` and `rel="noreferrer noopener"`, and
     * requires the caller to say so in the link text — an unannounced new tab is a
     * WCAG 3.2.5 problem, and this component cannot write the copy for you.
     */
    external?: boolean
  }

export function Link({ className, variant, external = false, rel, ...props }: LinkProps) {
  /*
   * `rel` is merged rather than overwritten. Spreading the external defaults before
   * `{...props}` let a caller who passed any `rel` of their own — `nofollow`, say —
   * silently drop `noreferrer noopener` from an external link. Modern browsers imply
   * `noopener` for `target="_blank"`, so nothing was exploitable today; it was a trap
   * waiting for the one caller who needed a custom `rel`.
   */
  const externalRel = external
    ? [...new Set(['noreferrer', 'noopener', ...(rel?.split(/\s+/) ?? [])].filter(Boolean))].join(
        ' ',
      )
    : rel

  return (
    <NextLink
      data-slot="link"
      className={cn(linkVariants({ variant }), className)}
      {...(external ? { target: '_blank' } : {})}
      rel={externalRel}
      {...props}
    />
  )
}

export { linkVariants }
