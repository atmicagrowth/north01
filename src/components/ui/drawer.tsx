'use client'

import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/cn'
import { IconButton } from '@/components/ui/icon-button'

/**
 * Drawer — a panel anchored to an edge. The cart (Phase 9), mobile navigation, and the
 * mobile filter sheet (Phase 11) are all this component.
 *
 * **Built on Radix Dialog, deliberately not on `vaul`.** The current shadcn drawer
 * abstraction wraps `vaul`, which adds a dependency to provide drag-to-dismiss and
 * iOS-style bottom-sheet physics. Neither is asked for anywhere in the corpus, and the
 * guide's §06 "restrained motion" argues against momentum gestures. Radix Dialog already
 * gives the focus trap, focus restoration, Escape, scroll containment and `aria-hidden`
 * management that plan §9.1c requires of the mobile drawer, and the slide is six lines
 * of CSS. One fewer dependency, and one behaviour model instead of two.
 *
 * The required-title rule from `dialog.tsx` applies here identically — same Radix
 * version, same removed warning.
 */
export const Drawer = DialogPrimitive.Root
export const DrawerTrigger = DialogPrimitive.Trigger
export const DrawerClose = DialogPrimitive.Close

const drawerVariants = cva(
  ['fixed z-50 flex flex-col gap-0', 'border-border bg-surface shadow-overlay'],
  {
    variants: {
      side: {
        right: [
          'inset-y-0 right-0 h-dvh w-full max-w-drawer border-l',
          'data-[state=open]:animate-drawer-in-right',
          'data-[state=closed]:animate-drawer-out-right',
        ],
        left: [
          'inset-y-0 left-0 h-dvh w-full max-w-drawer border-r',
          'data-[state=open]:animate-drawer-in-left',
          'data-[state=closed]:animate-drawer-out-left',
        ],
        bottom: [
          'inset-x-0 bottom-0 max-h-[85dvh] w-full rounded-t-md border-t',
          'data-[state=open]:animate-drawer-in-bottom',
          'data-[state=closed]:animate-drawer-out-bottom',
        ],
      },
    },
    defaultVariants: {
      side: 'right',
    },
  },
)

export type DrawerContentProps = ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof drawerVariants> & {
    /** The drawer's accessible name. Required. */
    title: string
    titleHidden?: boolean
    description?: string
    hideCloseButton?: boolean
    /**
     * Pinned below the scrolling body — "View bag", "Checkout", a subtotal line.
     * A separate prop rather than a child, because a footer placed among the children
     * would scroll away with them, which is exactly what a pinned action must not do.
     */
    footer?: ReactNode
  }

export function DrawerContent({
  className,
  children,
  side,
  title,
  titleHidden = false,
  description,
  hideCloseButton = false,
  footer,
  ...props
}: DrawerContentProps) {
  const heading = (
    <DialogPrimitive.Title
      data-slot="drawer-title"
      className="font-sans text-meta uppercase text-foreground"
    >
      {title}
    </DialogPrimitive.Title>
  )

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="drawer-overlay"
        className={cn(
          'fixed inset-0 z-50 bg-scrim',
          'data-[state=open]:animate-scrim-in data-[state=closed]:animate-scrim-out',
        )}
      />
      <DialogPrimitive.Content
        data-slot="drawer-content"
        className={cn(drawerVariants({ side }), className)}
        {...props}
      >
        {/*
          A <div>, not a <header>. Per HTML-AAM, `header` maps to `role="banner"` unless
          it descends from article/aside/main/nav/section — `role="dialog"` is not on
          that list, so an open drawer announced a second banner landmark for the page.
        */}
        <div
          className={cn(
            'flex shrink-0 items-start justify-between gap-m',
            'border-b border-border px-m py-m',
          )}
        >
          <div className="flex flex-col gap-1">
            {titleHidden ? <VisuallyHidden.Root>{heading}</VisuallyHidden.Root> : heading}
            {description ? (
              <DialogPrimitive.Description
                data-slot="drawer-description"
                className="font-sans text-body-sm text-foreground-muted"
              >
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {hideCloseButton ? null : (
            <DialogPrimitive.Close asChild>
              {/*
                44px, the size of every other primary control in a drawer. The negative margins keep
                the X optically on the title line and the panel edge; `-mb-1` stops the larger box
                growing the header row, which it sets on the mobile menu.
              */}
              <IconButton label="Close" size="md" className="-mb-1 -mr-3 -mt-2.5">
                <X aria-hidden />
              </IconButton>
            </DialogPrimitive.Close>
          )}
        </div>

        {/* Only the body scrolls, so the header and any footer stay put — plan §9.1c
            asks for scroll containment in the mobile drawer specifically. */}
        {/* `scroll-py-2`: Tab scrolls a control 8px inside the edge, so its ring is not cut. */}
        <div
          data-slot="drawer-body"
          className="min-h-0 flex-1 scroll-py-2 overflow-y-auto overscroll-contain"
        >
          {children}
        </div>

        {footer ? (
          <div
            data-slot="drawer-footer"
            className="flex shrink-0 flex-col gap-s border-t border-border px-m py-m"
          >
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
