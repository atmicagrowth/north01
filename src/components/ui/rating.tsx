import { Star } from 'lucide-react'

import { cn } from '@/lib/cn'
import { MAX_RATING } from '@/lib/reviews/rules'

/**
 * **A rating, shown as stars and said in words.**
 *
 * The stars are `aria-hidden` and the accessible name is a sentence. That is the whole point of the
 * component: a screen reader announcing "star star star star star" five times is worse than useless,
 * and a row of glyphs is not a number. `Badge`'s docblock records the same rule from the other
 * direction — state must reach a screen-reader user through the same words a sighted customer reads,
 * not through a colour or a shape they cannot perceive.
 *
 * Filled stars are Bone; empty ones are Graphite, the border tone. Not the accent: visual guide §02
 * reserves Soft Taupe for *"very limited"* use, and every product card carrying five taupe stars is
 * the opposite of limited.
 */
export function Rating({
  className,
  label,
  size = 'sm',
  value,
}: {
  className?: string
  /** Overrides the default sentence, for a summary that says how many reviews it averages. */
  label?: string
  size?: 'lg' | 'sm'
  value: number
}) {
  const rounded = Math.round(value)
  const pixels = size === 'lg' ? 18 : 14

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span aria-hidden="true" className="inline-flex items-center gap-0.5">
        {Array.from({ length: MAX_RATING }, (_, index) => (
          <Star
            className={index < rounded ? 'text-foreground' : 'text-border'}
            fill={index < rounded ? 'currentColor' : 'none'}
            key={index}
            size={pixels}
            strokeWidth={1.5}
          />
        ))}
      </span>

      <span className="sr-only">{label ?? `${value} out of ${MAX_RATING} stars`}</span>
    </span>
  )
}
