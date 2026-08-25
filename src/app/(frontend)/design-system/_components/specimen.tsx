import type { ReactNode } from 'react'

import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/cn'

/**
 * Layout helpers for the specimen sheet.
 *
 * These are deliberately local to the design-system route — they are documentation
 * furniture, not part of the design system, and nothing in the storefront should import
 * them.
 */

/** One primitive: a heading, a note about what to look at, and its state matrix. */
export function Specimen({
  name,
  note,
  children,
  id,
}: {
  name: string
  note?: ReactNode
  children: ReactNode
  id: string
}) {
  return (
    <section id={id} className="scroll-mt-24 py-l">
      <div className="flex flex-col gap-2">
        <h3 className="font-sans text-meta uppercase text-foreground">{name}</h3>
        {note ? (
          <p className="max-w-prose font-sans text-body-sm text-foreground-muted">{note}</p>
        ) : null}
      </div>
      <div className="mt-m">{children}</div>
      <Separator className="mt-l" />
    </section>
  )
}

/**
 * A labelled cell. Each primitive state gets its own bordered box so that a broken
 * layout primitive disturbs one cell rather than the whole page — the isolation a
 * component workbench would otherwise provide.
 */
export function Cell({
  label,
  children,
  className,
  wide = false,
}: {
  label: string
  children: ReactNode
  className?: string
  wide?: boolean
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-sm border border-border p-m',
        wide && 'sm:col-span-2 lg:col-span-3',
        className,
      )}
    >
      <p className="font-sans text-micro uppercase text-foreground-muted">{label}</p>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-m">{children}</div>
    </div>
  )
}

/** The grid the cells sit in. Collapses to one column on mobile. */
export function Matrix({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 gap-s sm:grid-cols-2 lg:grid-cols-3', className)}>
      {children}
    </div>
  )
}

/** A titled group of specimens. */
export function SpecimenGroup({
  title,
  description,
  children,
  id,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  id: string
}) {
  return (
    <section id={id} className="scroll-mt-24 py-xl">
      <header className="flex flex-col gap-m border-b border-border pb-m">
        <h2 className="font-display text-heading-m">{title}</h2>
        {description ? (
          <p className="max-w-prose font-sans text-body text-foreground-muted">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  )
}
