'use client'

import type { ComponentProps } from 'react'

import { Input } from '@/components/ui/input'
import { FieldMessage, Label } from '@/components/ui/label'

/**
 * A labelled text field with its error and hint wired up.
 *
 * The wiring is the point, and it is the part that is quietly got wrong everywhere: the control
 * carries `aria-invalid` so assistive technology knows it is in error, and `aria-describedby`
 * pointing at both the hint and the message so the reason is read out with the field rather than
 * being a red sentence only sighted users can associate with it. `FieldMessage` supplies the icon
 * that keeps the error from being colour-only (WCAG 1.4.1); `Input` supplies the `aria-invalid`
 * border. Both come from Phase 3, which built them for this.
 *
 * The id is the field name rather than `useId`. These forms carry one of each field, the name is
 * already unique within the document, and a readable id is worth having in a DOM someone will debug.
 */
export function Field({
  name,
  label,
  error,
  hint,
  ...props
}: ComponentProps<typeof Input> & {
  error?: string
  hint?: string
  label: string
  name: string
}) {
  const hintId = hint ? `${name}-hint` : undefined
  const errorId = error ? `${name}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>

      <Input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />

      {hint ? (
        <FieldMessage id={hintId} tone="hint">
          {hint}
        </FieldMessage>
      ) : null}

      {error ? (
        /*
         * `role` is cleared deliberately. `FieldMessage` announces itself as an alert, which is right
         * for a message that appears on its own — a field validating as you leave it. It is wrong
         * inside a submitted form: three invalid fields would queue three alerts on top of the
         * summary that `FormStatus` has just moved focus to, and the customer hears the same failure
         * four times. Summary announces, fields describe. It is the pattern the GOV.UK Design System
         * arrived at for the same reason, and `aria-describedby` above is what keeps each message
         * attached to its control.
         */
        <FieldMessage id={errorId} tone="error" role={undefined}>
          {error}
        </FieldMessage>
      ) : null}
    </div>
  )
}
