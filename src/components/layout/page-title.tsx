import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * PageTitle — the opening statement of a page.
 *
 * Visual guide §01 "Visual Tension": oversized type set against tiny metadata. The
 * eyebrow is Meta (12px, tracked, uppercase, Stone); the title is the display serif at
 * Display XL or Display L. That size gap *is* the composition — §03 asks for serif/sans
 * contrast used intentionally and for large headlines to be given room.
 *
 * §03 also says "prefer strong left alignment over default centered alignment", so
 * there is no centred variant. Left is the only option.
 */
export function PageTitle({
  className,
  eyebrow,
  lede,
  size = 'display-l',
  as: Tag = 'h1',
  children,
  ...props
}: Omit<ComponentProps<'h1'>, 'title'> & {
  /** Tiny tracked label above the title — a section, a season, a collection name. */
  eyebrow?: ReactNode
  /** One short paragraph beneath. Kept to a reading measure. */
  lede?: ReactNode
  /** `display-xl` for campaign moments; `display-l` for everything else. */
  size?: 'display-xl' | 'display-l'
  /** The heading rank. Widened past h1/h2 so a specimen or a nested composition can sit
   *  at the right depth instead of injecting a second h1 into the document. */
  as?: 'h1' | 'h2' | 'h3' | 'h4'
}) {
  return (
    <header data-slot="page-title" className={cn('flex flex-col gap-m', className)}>
      {eyebrow ? (
        <p className="font-sans text-meta uppercase text-foreground-muted">{eyebrow}</p>
      ) : null}

      <Tag
        className={cn(
          'font-display text-balance',
          size === 'display-xl' ? 'text-display-xl' : 'text-display-l',
        )}
        {...props}
      >
        {children}
      </Tag>

      {lede ? (
        <p className="max-w-measure font-sans text-body text-foreground-muted">{lede}</p>
      ) : null}
    </header>
  )
}
