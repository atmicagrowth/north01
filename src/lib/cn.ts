import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Class-name composition for the NORTH / 01 design system.
 *
 * `clsx` flattens conditionals; `tailwind-merge` resolves conflicts so that a `className`
 * passed into a primitive genuinely overrides the primitive's own class rather than
 * landing beside it and losing on source order.
 *
 * **Why this is configured rather than used bare.** tailwind-merge resolves conflicts by
 * recognising Tailwind's *default* scales. This project replaced them: the colour, type,
 * radius and shadow scales were cleared in `globals.css` and rebuilt with semantic names.
 * Left unconfigured, tailwind-merge cannot tell that `text-meta` is a font size while
 * `text-foreground` is a colour — it would treat them as the same group and silently drop
 * one. Every scale that was overridden there is declared here.
 *
 * Keep the two files in step. A token added to `globals.css` and not added here still
 * works; it just stops participating in conflict resolution, which fails quietly.
 */
const twMerge = extendTailwindMerge({
  override: {
    theme: {
      // Mirrors `--color-*` in globals.css.
      color: [
        'canvas',
        'surface',
        'surface-raised',
        'foreground',
        'foreground-bright',
        'foreground-muted',
        'foreground-disabled',
        'border',
        'border-control',
        'border-strong',
        'accent',
        'error',
        'focus',
        'scrim',
      ],
      // Mirrors `--text-*`. These are font sizes, not colours.
      text: [
        'display-xl',
        'display-l',
        'heading-m',
        'heading-s',
        'body',
        'body-sm',
        'meta',
        'micro',
      ],
      font: ['display', 'sans', 'mono'],
      radius: ['none', 'sm', 'md', 'full'],
      shadow: ['overlay'],
    },
  },
  extend: {
    theme: {
      // Added alongside Tailwind's numeric scale rather than replacing it, because
      // both remain in use: named steps for editorial rhythm, numbers for internals.
      spacing: ['xs', 's', 'm', 'l', 'xl', 'xxl'],
      ease: ['entrance', 'exit', 'editorial'],
      container: ['page', 'narrow', 'prose'],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
