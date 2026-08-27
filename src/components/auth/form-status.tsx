'use client'

import { CircleAlert, CircleCheck } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { AuthFormState } from '@/lib/auth/form-state'
import { cn } from '@/lib/cn'

/**
 * **The form-level result, announced and focused.**
 *
 * Phase 3 left this exact obligation here. `Button` uses a real `disabled` attribute for its busy
 * state rather than `aria-disabled` plus a click guard, because an unconditional `onClick` makes the
 * component unrenderable from a Server Component — and it recorded the consequence: *"a `<button>`
 * that becomes disabled while focused loses focus to the document body… the surrounding form has to
 * move focus somewhere deliberate and announce the result. **Phase 7 owns that**."* This is that.
 *
 * Moving focus is what makes the message reach a screen-reader user *and* a sighted keyboard user in
 * one mechanism, and it puts the caret where the next Tab is useful. `role="alert"` covers the
 * remaining case — a submit that fails without focus ever having been on the button, such as Enter
 * pressed inside a text field.
 *
 * `submissionCount` is the dependency rather than the message, and that is the whole trick: two
 * identical failures produce an identical `message`, React sees no state change, and the effect
 * would never re-run — leaving a customer who pressed the button twice with no evidence that
 * anything happened at all.
 *
 * `tabIndex={-1}` makes it programmatically focusable without adding a stop to the tab order, and
 * `outline-none` is safe here for the same reason: the element is never reached by keyboard, only
 * given focus deliberately, so suppressing its ring hides nothing the customer was navigating to.
 */
export function FormStatus({ state }: { state: AuthFormState }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (state.submissionCount > 0) {
      ref.current?.focus()
    }
  }, [state.submissionCount])

  if (!state.message) {
    return null
  }

  const isError = state.status === 'error'

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      data-slot="form-status"
      className={cn(
        'flex items-start gap-2 rounded-sm border px-4 py-3 outline-none',
        'font-sans text-body-sm',
        isError
          ? 'border-error/40 bg-error/5 text-error'
          : 'border-border-control bg-surface text-foreground',
      )}
    >
      {/* Never colour alone — WCAG 1.4.1. The icon carries the same distinction. */}
      {isError ? (
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      ) : (
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      )}
      <p>{state.message}</p>
    </div>
  )
}

/**
 * A standing notice that is not a submit result — "your password has been changed, now sign in".
 *
 * Deliberately not `role="alert"` and deliberately not focused: it is present on first paint, and an
 * alert that fires on page load is announced before the page has been read, over the top of whatever
 * the customer was listening to.
 */
export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-sm border border-border-control bg-surface px-4 py-3 font-sans text-body-sm text-foreground">
      {children}
    </p>
  )
}
