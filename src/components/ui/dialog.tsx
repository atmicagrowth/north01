'use client'

import { X } from 'lucide-react'
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'
import { IconButton } from '@/components/ui/icon-button'

/**
 * Dialog — visual guide §06: solid surfaces, strong alignment, clear hierarchy,
 * restrained motion, minimal shadowing.
 *
 * Radix supplies every behaviour the plan's §3.1d accessibility list asks for, and none
 * of it is reimplemented here: focus trap (`FocusScope trapped`), focus restoration to
 * the trigger on close (`onCloseAutoFocus`), Escape to dismiss, scroll locking
 * (`RemoveScroll`), `aria-hidden` on the rest of the page (`hideOthers`), and
 * `aria-expanded` / `aria-controls` on the trigger.
 *
 * ---
 *
 * **The one thing you must not forget.** `@radix-ui/react-dialog@1.1.23` — the version
 * inside `radix-ui@1.6.7` — **removed the development warning for a missing
 * `DialogTitle`.** Earlier versions logged an error; this one does not. It emits
 * `aria-labelledby` only when a title is present, so a dialog without one is simply
 * announced with no name at all, silently, in every environment.
 *
 * `DialogContent` therefore takes `title` as a **required prop** rather than trusting a
 * child to supply one. Pass `titleHidden` when the design has no visible heading — the
 * title is then rendered inside Radix's VisuallyHidden and still names the dialog.
 */
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-scrim',
        'data-[state=open]:animate-scrim-in data-[state=closed]:animate-scrim-out',
        className,
      )}
      {...props}
    />
  )
}

export type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  /** The dialog's accessible name. Required — see the note above. */
  title: string
  /** Render the title for assistive technology only, when the design shows no heading. */
  titleHidden?: boolean
  /** Optional supporting line, wired to `aria-describedby` by Radix. */
  description?: string
  /** Hide the built-in close control when the dialog supplies its own. */
  hideCloseButton?: boolean
}

export function DialogContent({
  className,
  children,
  title,
  titleHidden = false,
  description,
  hideCloseButton = false,
  ...props
}: DialogContentProps) {
  const heading = (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className="font-display text-heading-m text-foreground"
    >
      {title}
    </DialogPrimitive.Title>
  )

  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'flex w-[calc(100%-2rem)] max-w-dialog flex-col gap-m',
          'max-h-[calc(100dvh-4rem)] overflow-y-auto',
          'rounded-md border border-border bg-surface-raised',
          'p-l shadow-overlay',
          'data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-m">
          <div className="flex flex-col gap-2">
            {titleHidden ? <VisuallyHidden.Root>{heading}</VisuallyHidden.Root> : heading}
            {description ? (
              <DialogPrimitive.Description
                data-slot="dialog-description"
                className="font-sans text-body-sm text-foreground-muted"
              >
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {hideCloseButton ? null : (
            <DialogPrimitive.Close asChild>
              <IconButton label="Close" size="sm" className="-mr-2 -mt-2">
                <X aria-hidden />
              </IconButton>
            </DialogPrimitive.Close>
          )}
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

/** Action row. Right-aligned on desktop, stacked and full-width on mobile. */
export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-s sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}
