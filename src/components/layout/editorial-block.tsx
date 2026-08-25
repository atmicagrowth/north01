import { cva } from 'class-variance-authority'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * EditorialBlock — the alternating image-led / typography-led unit that gives a page its
 * pacing. Visual guide §09: "editorial blocks alternating between image-led and
 * typography-led sections", "strong visual pacing from section to section".
 *
 * It is a **layout wrapper and nothing else**. It knows about asymmetry, alignment and
 * gutters; it knows nothing about products, campaigns or CMS blocks. Phase 10 builds the
 * homepage block system on top of this — that phase owns the content, this one owns the
 * proportions.
 *
 * Two guide rules are built into the geometry:
 *
 *   - **Asymmetry, not halves.** §04 asks for "intentional asymmetry" and "asymmetric
 *     whitespace". The ratios are 7:5 and 5:7 on a 12-column grid, never 6:6, so the
 *     composition has a dominant side.
 *   - **Media and text swap sides, not stacking order.** On mobile the media always
 *     comes first regardless of desktop side, because §10's priority list protects
 *     imagery and hierarchy before decorative arrangement.
 */
/**
 * Only the two side-by-side layouts live here. The stacked case is a different box —
 * a flex column, not a twelve-column grid — and the component returns early for it, so a
 * `stacked` entry in this cva was unreachable: it and the shared grid base were dead
 * config that looked like the source of the stacked styling.
 */
const editorialBlockVariants = cva(['grid items-center gap-l', 'lg:grid-cols-12 lg:gap-xl'], {
  variants: {
    layout: {
      /** Media on the left, text on the right. */
      'media-start': '',
      /** Text on the left, media on the right. */
      'media-end': '',
    },
  },
  defaultVariants: {
    layout: 'media-start',
  },
})

export type EditorialBlockProps = ComponentProps<'div'> & {
  /** Imagery, video, or a colour field. Omit for a typography-led block. */
  media?: ReactNode
  /**
   * `stacked` is a single typography-led column; the other two are asymmetric splits.
   * Passing no `media` produces the stacked shape whatever this says.
   */
  layout?: 'media-start' | 'media-end' | 'stacked'
}

export function EditorialBlock({
  className,
  layout = 'media-start',
  media,
  children,
  ...props
}: EditorialBlockProps) {
  // One column. Not expressed through the cva above — see the note on it.
  if (layout === 'stacked' || !media) {
    return (
      <div
        data-slot="editorial-block"
        data-layout="stacked"
        className={cn('flex flex-col gap-m', className)}
        {...props}
      >
        {children}
      </div>
    )
  }

  const mediaFirst = layout === 'media-start'

  return (
    <div
      data-slot="editorial-block"
      data-layout={layout}
      className={cn(editorialBlockVariants({ layout }), className)}
      {...props}
    >
      {/* Source order puts media first so it leads on mobile; `lg:order-*` restores the
          intended desktop side without touching the small-screen reading order. */}
      <div
        data-slot="editorial-block-media"
        className={cn('lg:col-span-7', mediaFirst ? 'lg:order-1' : 'lg:order-2')}
      >
        {media}
      </div>

      <div
        data-slot="editorial-block-body"
        className={cn(
          'flex flex-col gap-m lg:col-span-5',
          mediaFirst ? 'lg:order-2' : 'lg:order-1',
        )}
      >
        {children}
      </div>
    </div>
  )
}

export { editorialBlockVariants }
