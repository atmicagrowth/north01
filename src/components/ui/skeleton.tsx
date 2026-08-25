import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * Skeleton — the shape of content that has not arrived.
 *
 * It pulses in **opacity**. The moving-gradient "shimmer" every component library ships
 * is a gradient sweeping across a surface, and guide §11 lists both gradients and
 * excessive animation under Avoid. An opacity pulse says the same thing quietly.
 *
 * `aria-hidden` because a skeleton is not content. Announce loading on the region that
 * owns it — `aria-busy` on the container, or a visually hidden status line — so a screen
 * reader hears "loading" once rather than a run of empty boxes.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-skeleton rounded-sm bg-surface-raised', className)}
      {...props}
    />
  )
}
