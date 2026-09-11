import { Fragment } from 'react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

/** One crumb. The same shape `breadcrumbStructuredData` takes, so a page can hand both one list. */
export type Crumb = { name: string; path: string }

/**
 * **A page's trail, from a list — Phase 35 (P35-18).**
 *
 * The UI primitives in `components/ui/breadcrumb.tsx` are the markup; this is the one way pages use
 * them. Every crumb but the last is a link, and the last is the current page — `BreadcrumbPage`,
 * never a link to where the customer already is.
 *
 * The item shape is deliberately `breadcrumbStructuredData`'s. The product page builds one list and
 * passes it to both, so the trail a customer sees and the one a search result shows cannot drift.
 *
 * A trail of one crumb says nothing the page title does not, so it renders nothing.
 */
export function PageBreadcrumb({ className, items }: { className?: string; items: Crumb[] }) {
  if (items.length < 2) {
    return null
  }

  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        {items.map((item, index) => (
          <Fragment key={item.path}>
            {index > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {index === items.length - 1 ? (
                <BreadcrumbPage>{item.name}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={item.path}>{item.name}</BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
