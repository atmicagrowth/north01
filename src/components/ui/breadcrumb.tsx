import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * Breadcrumb — "Where am I?", the first of the structure document's four information-
 * hierarchy questions (§23).
 *
 * Micro type so it sits under the page title without competing with it. The separator is
 * a typographic slash rather than a chevron icon, which echoes the wordmark's own
 * `NORTH / 01` and keeps the trail as pure type.
 *
 * Structure follows the accessible pattern exactly: `<nav aria-label="Breadcrumb">`
 * wrapping an ordered list, separators hidden from assistive technology, and the current
 * page marked with `aria-current="page"` on a non-link element — a link to where you
 * already are is a dead control.
 */
export function Breadcrumb({ className, ...props }: ComponentProps<'nav'>) {
  return <nav data-slot="breadcrumb" aria-label="Breadcrumb" className={cn(className)} {...props} />
}

export function BreadcrumbList({ className, ...props }: ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1',
        'font-sans text-micro uppercase text-foreground-muted',
        className,
      )}
      {...props}
    />
  )
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn('inline-flex items-center', className)}
      {...props}
    />
  )
}

export function BreadcrumbLink({
  className,
  asChild = false,
  ...props
}: ComponentProps<'a'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'a'

  return (
    <Comp
      data-slot="breadcrumb-link"
      className={cn(
        'rounded-sm text-foreground-muted transition-colors',
        'duration-(--duration-fast) ease-entrance',
        'hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** The current page. Not a link, and announced as the current location. */
export function BreadcrumbPage({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn('text-foreground', className)}
      {...props}
    />
  )
}

export function BreadcrumbSeparator({ className, children, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden
      className={cn('select-none text-foreground-muted', className)}
      {...props}
    >
      {children ?? '/'}
    </li>
  )
}
