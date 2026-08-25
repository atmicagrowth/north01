'use client'

import { CircleAlert } from 'lucide-react'
import { Label as LabelPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * Label — visual guide §06: "quiet labels".
 *
 * Meta type: 12px, uppercase, tracked. Radix's Label handles the click-to-focus
 * association and the `htmlFor` plumbing; the styling is entirely ours.
 */
export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'font-sans text-meta uppercase text-foreground-muted',
        'select-none',
        // Radix marks a label whose control is disabled; the label should recede with it.
        'peer-disabled:text-foreground-disabled',
        className,
      )}
      {...props}
    />
  )
}

/**
 * FieldMessage — the hint or error line beneath a control.
 *
 * Not in the plan's §3.1c list, but its acceptance criteria require an **error** state
 * for every primitive, and an error that is only a red border fails WCAG 1.4.1: colour
 * cannot be the sole carrier. This is the text half of that pair, and it exists so the
 * pattern is defined once rather than re-improvised in Phase 7's forms.
 *
 * Wire it up with `aria-describedby` on the control pointing at this element's `id`.
 * `role="alert"` on the error tone announces the message when it appears.
 */
export function FieldMessage({
  className,
  tone = 'hint',
  children,
  ...props
}: ComponentProps<'p'> & { tone?: 'hint' | 'error' }) {
  const isError = tone === 'error'

  return (
    <p
      data-slot="field-message"
      data-tone={tone}
      role={isError ? 'alert' : undefined}
      className={cn(
        'flex items-start gap-1.5 font-sans text-body-sm',
        isError ? 'text-error' : 'text-foreground-muted',
        className,
      )}
      {...props}
    >
      {/* The icon is what stops this being colour-only. */}
      {isError ? <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" /> : null}
      <span>{children}</span>
    </p>
  )
}
