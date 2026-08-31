import { X } from 'lucide-react'

import { Link } from '@/components/ui/link'
import {
  catalogHref,
  type CatalogHrefValues,
  type CatalogParams,
  type CatalogQuery,
  type CatalogVocabulary,
} from '@/lib/catalog/query'
import { activeFilterChips } from '@/lib/catalog/resolve'

/**
 * **The applied filters, as removable chips.**
 *
 * A filter panel alone is not enough on a listing. On a phone the panel is behind a drawer, and on
 * desktop it is a column a customer has scrolled past — in both cases the only thing on screen
 * saying *why* the grid has six products in it is this row. Without it the commonest complaint about
 * a shop page ("it's empty and I can't tell why") has no answer available.
 *
 * ### They are links, not buttons
 *
 * Each chip's href is the current URL **minus that one value**, built by the same serializer
 * pagination uses. So removal costs no JavaScript, survives a disabled-JS session, can be opened in
 * a new tab, and needs no client component at all — this file ships zero bytes to the browser.
 *
 * That also makes the removal *exact*. A button would have to reconstruct the query from client
 * state; a link is computed on the server from the query that actually produced the page in front of
 * the customer, so the two can never disagree.
 *
 * ### The accessible name carries the verb
 *
 * The visible text is `Size M`, which is what a sighted customer needs; the accessible name is
 * *"Remove filter: Size M"*, because a screen-reader user meeting a link labelled "Size M" has no
 * way to know it removes rather than applies. The `×` is `aria-hidden` — it is a picture of the verb
 * that is already in the label.
 */
export function ActiveFilters({
  basePath,
  formatPrice,
  params,
  query,
  routeCategory,
  vocabulary,
}: {
  basePath: string
  formatPrice: (minor: number) => null | string
  params: CatalogParams
  query: CatalogQuery
  routeCategory?: null | string
  vocabulary: CatalogVocabulary
}) {
  const chips = activeFilterChips(query, vocabulary, formatPrice, routeCategory)

  if (chips.length === 0) {
    return null
  }

  /**
   * The URL with one value removed.
   *
   * `price` is the one chip that is not a member of a list — it stands for both bounds, so removing
   * it clears both. A chip per bound would be two controls for one idea, and "remove the maximum"
   * is not a thought anybody has.
   */
  const removeHref = (facet: string, value: string): string => {
    const next: CatalogHrefValues = { ...params, page: null }

    if (facet === 'price') {
      next.priceMax = null
      next.priceMin = null
    } else if (facet === 'availability') {
      next.availability = null
    } else {
      const key = facet as 'category' | 'collection' | 'color' | 'size'
      const remaining = params[key].filter((entry) => entry !== value)

      next[key] = remaining.length > 0 ? remaining : null
    }

    return catalogHref(basePath, next)
  }

  return (
    <div className="flex flex-wrap items-center gap-s" data-slot="active-filters">
      <h2 className="sr-only">Applied filters</h2>

      <ul className="flex flex-wrap items-center gap-s">
        {chips.map((chip) => (
          <li key={`${chip.facet}:${chip.value}`}>
            <Link
              href={removeHref(chip.facet, chip.value)}
              variant="unstyled"
              aria-label={`Remove filter: ${chip.label}`}
              className="inline-flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 font-sans text-meta text-foreground-muted transition-colors duration-(--duration-fast) hover:border-border-strong hover:text-foreground"
            >
              {chip.label}
              <X aria-hidden="true" className="size-3" />
            </Link>
          </li>
        ))}
      </ul>

      {chips.length > 1 ? (
        <Link href={catalogHref(basePath, { sort: params.sort })} variant="meta">
          Clear all
        </Link>
      ) : null}
    </div>
  )
}
