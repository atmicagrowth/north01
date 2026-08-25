import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * Input — visual guide §06.
 *
 * "Dark surfaces. Thin graphite borders. Generous internal padding. Quiet labels.
 * Clear focus states. Minimal decoration."
 *
 * The one place this departs from the guide's literal text is the border colour. A
 * Graphite (#33312D) border is 1.53:1 against the page — below the 3:1 that WCAG 1.4.11
 * requires for the boundary of a control the user must be able to find. Graphite stays
 * the colour of structural rules and dividers, which are decorative and exempt; a field
 * that the customer has to locate and type into gets Muted Stone (4.15:1). Still a
 * palette colour, still quiet, and now findable. Recorded in notes §1.8.2.
 */
export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'peer flex h-11 w-full min-w-0',
        'rounded-sm border border-border-control bg-surface',
        'px-4 py-2.5',
        'font-sans text-body text-foreground',
        'transition-colors duration-(--duration-fast) ease-entrance',
        'placeholder:text-foreground-muted',
        'hover:border-foreground-muted',
        // The global :focus-visible outline supplies the ring; the border shift is the
        // quiet part of the focus state that the guide asks for.
        'focus-visible:border-border-strong',
        // Error. Paired with FieldMessage, never on its own — colour alone would fail
        // WCAG 1.4.1.
        'aria-invalid:border-error aria-invalid:hover:border-error',
        'disabled:cursor-not-allowed disabled:border-border disabled:text-foreground-disabled',
        'disabled:placeholder:text-foreground-disabled',
        // File inputs are styled by the browser; strip it back to the field's own type.
        'file:mr-3 file:border-0 file:bg-transparent file:font-sans file:text-meta',
        'file:uppercase file:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Textarea — the same field, sized for prose. Gift messages, order notes, support forms.
 */
export function Textarea({ className, rows = 4, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      rows={rows}
      data-slot="textarea"
      className={cn(
        'peer flex w-full min-w-0 resize-y',
        'rounded-sm border border-border-control bg-surface',
        'px-4 py-3',
        'font-sans text-body text-foreground',
        'transition-colors duration-(--duration-fast) ease-entrance',
        'placeholder:text-foreground-muted',
        'hover:border-foreground-muted',
        'focus-visible:border-border-strong',
        'aria-invalid:border-error aria-invalid:hover:border-error',
        'disabled:cursor-not-allowed disabled:border-border disabled:text-foreground-disabled',
        className,
      )}
      {...props}
    />
  )
}
