import { ProductCard, ProductCardSkeleton } from '@/components/catalog/product-card'
import { Link } from '@/components/ui/link'
import { CATALOG_PAGE_SIZE, catalogHref, type CatalogParams } from '@/lib/catalog/query'
import { SEARCH_COPY, unavailableCopy } from '@/lib/catalog/search'
import type { CatalogResult, ProductCard as ProductCardModel } from '@/lib/catalog/resolve'
import type { CategoryOption } from '@/lib/catalog/query'
import { cn } from '@/lib/cn'

/**
 * **The grid, and the three things that are not a grid.**
 *
 * Plan §11.1a asks for a product grid and an empty state; §11.1d adds a fourth outcome nothing else
 * in the corpus has — *"if Algolia is unavailable, render a graceful error state and provide a
 * 'Browse categories' fallback."* Those are three genuinely different screens and they are three
 * components here, rather than one grid with two `if`s in it:
 *
 * | Outcome | Component | What the customer is told |
 * |---|---|---|
 * | Products | `ProductGrid` | — |
 * | None matched | `CatalogEmpty` | their filters are too narrow, and how to widen them |
 * | Filters unavailable | `CatalogUnavailable` | **the shop is fine, the filter is not** |
 *
 * Collapsing the last two is the defect worth naming: an outage rendered as "no products match your
 * filters" tells a customer their taste is the problem, hides a fault from the operator, and invites
 * them to keep removing filters that were never the cause.
 *
 * ### The grid is a list, and the columns are the `sizes` string's columns
 *
 * `<ul>`/`<li>` because it is a list of products — a screen reader announces "list, 24 items", which
 * is the count plan §11.1a puts on the page rendered for a customer who cannot see it. The column
 * counts here and the breakpoints in `CATALOG_IMAGE_SIZES.productCardGrid` are the same numbers; if
 * one changes the other must, and the browser pass measures delivered image width against rendered
 * box to catch it when it does not.
 */
export function ProductGrid({
  cards,
  eager = false,
}: {
  cards: ProductCardModel[]
  /**
   * Whether the first card may be the LCP element. True only on page 1 of an unfiltered shop, where
   * the grid is the first thing below the header — plan §10.1d's rule that *"proper priority"*
   * belongs to exactly one image, applied to this route.
   */
  eager?: boolean
}) {
  return (
    <ul
      className="grid grid-cols-2 gap-x-m gap-y-l lg:grid-cols-3 xl:grid-cols-4"
      data-slot="product-grid"
    >
      {cards.map((card, index) => (
        <li key={card.id}>
          <ProductCard card={card} priority={eager && index === 0} />
        </li>
      ))}
    </ul>
  )
}

/**
 * The loading grid — §11.1b state 3.
 *
 * A full page of skeletons rather than a spinner, because the shape of the answer is already known:
 * twenty-four cards in the same grid. Rendering the real geometry means the page does not reflow
 * when the products arrive, which is the whole difference between a skeleton and a placeholder.
 */
export function ProductGridSkeleton({ count = CATALOG_PAGE_SIZE }: { count?: number }) {
  return (
    <ul
      className="grid grid-cols-2 gap-x-m gap-y-l lg:grid-cols-3 xl:grid-cols-4"
      aria-hidden="true"
      data-slot="product-grid-skeleton"
    >
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>
          <ProductCardSkeleton />
        </li>
      ))}
    </ul>
  )
}

/**
 * **Zero results — a designed state, which feature matrix §5 requires by name.**
 *
 * Two things it must do and one it must not. It must say plainly that nothing matched, and it must
 * offer a way out that is one click rather than a hunt back up the panel. It must **not** apologise
 * or imply an error: an empty result for a narrow filter is the system working.
 *
 * The escape hatches are ordinary links, so they work with JavaScript disabled and can be opened in
 * a new tab. "Clear filters" keeps the customer where they are — same route, same sort — and drops
 * only what narrowed the grid, which is why it is built from `catalogHref` with the facets omitted
 * rather than pointing at a bare `/shop`.
 */
export function CatalogEmpty({
  basePath,
  categories,
  curated = [],
  isFiltered,
  params,
  stale = false,
  term = null,
}: {
  basePath: string
  /** A handful of top-level categories, as the way back into a catalogue that is not empty. */
  categories: CategoryOption[]
  /** Structure §12: "offer popular/curated products when available". Postgres-backed. */
  curated?: ProductCardModel[]
  isFiltered: boolean
  params: CatalogParams
  /**
   * The engine found hits and Postgres refused them all.
   *
   * A **different sentence** from "nothing matched", because "nothing matched" would be false —
   * something matched and has just gone. This replaced an inference from a non-zero total, which was
   * the same guess made less reliably.
   */
  stale?: boolean
  /** The search term, when this is a search rather than a filtered browse. */
  term?: null | string
}) {
  const copy = stale ? SEARCH_COPY.stale : SEARCH_COPY.empty

  const title = stale
    ? copy.title
    : term
      ? `Nothing matched \u201C${term}\u201D.`
      : isFiltered
        ? 'Nothing matches those filters.'
        : 'Nothing here yet.'

  const body = stale
    ? copy.body
    : term
      ? copy.body
      : isFiltered
        ? 'Try removing a filter, or start from a category below.'
        : 'This part of the shop has no published products at the moment.'

  return (
    <div className="flex flex-col items-start gap-m py-xl" data-slot="catalog-empty">
      <p className="font-display text-heading-m text-foreground">{title}</p>

      <p className="max-w-measure font-sans text-body text-foreground-muted">{body}</p>

      <div className="flex flex-wrap items-center gap-m">
        {isFiltered || stale ? (
          /*
           * `q` is preserved. All four "clear" affordances in this phase used to build a fresh
           * object carrying only `sort`, which on /search silently erased the search itself —
           * offering a customer who found nothing a link that throws away what they were looking
           * for.
           */
          <Link href={catalogHref(basePath, { q: params.q, sort: params.sort })} variant="meta">
            Clear filters
          </Link>
        ) : null}

        {categories.slice(0, 6).map((category) => (
          <Link key={category.value} href={`/shop/${category.value}`} variant="meta">
            {category.label}
          </Link>
        ))}
      </div>

      {curated.length > 0 ? (
        <div className="mt-l w-full">
          <p className="mb-l font-sans text-meta uppercase text-foreground-muted">Worth a look</p>
          <ProductGrid cards={curated} />
        </div>
      ) : null}
    </div>
  )
}

/**
 * **Plan §11.1d's fallback policy, rendered.**
 *
 * Reached only when a filter needed the search index and the index could not answer — never for an
 * ordinary browse, because `requiresSearchIndex` sends those to Postgres and Postgres is not
 * optional. So the copy can be specific rather than a generic apology: the shop is open, *this
 * filter* is not, and here is the catalogue by category.
 *
 * §11.1d also says what must **not** happen here: *"do not attempt an expensive full-catalog scan on
 * every request."* There is deliberately no silent second query behind this screen. The alternative
 * — quietly re-running the search as an unfiltered listing — would answer a different question from
 * the one in the URL and look, to the customer, exactly like a filter that does nothing.
 */
export function CatalogUnavailable({
  basePath,
  categories,
  curated = [],
  params,
  scope = 'filters',
}: {
  basePath: string
  categories: CategoryOption[]
  curated?: ProductCardModel[]
  params: CatalogParams
  /**
   * What the customer was doing when it broke.
   *
   * On `/shop` a colour filter failed and only the filter is broken; on `/search` the search itself
   * is. The shipped copy told everyone to "clear the filters to see everything", which on a search
   * results page offers to erase the thing they came for.
   */
  scope?: 'filters' | 'search'
}) {
  const copy = unavailableCopy(scope)

  return (
    <div
      className="flex flex-col items-start gap-m py-xl"
      data-slot="catalog-unavailable"
      /*
       * `role="status"` rather than `alert`: this replaces the grid on a navigation the customer
       * initiated, so it is announced politely once focus settles, not as an interruption.
       */
      role="status"
    >
      <p className="font-display text-heading-m text-foreground">{copy.title}</p>

      <p className="max-w-measure font-sans text-body text-foreground-muted">{copy.body}</p>

      <div className="flex flex-wrap items-center gap-m">
        <Link href={catalogHref(basePath, { q: params.q, sort: params.sort })} variant="meta">
          {scope === 'search' ? 'Clear filters' : 'Clear filters'}
        </Link>

        {categories.slice(0, 6).map((category) => (
          <Link key={category.value} href={`/shop/${category.value}`} variant="meta">
            {category.label}
          </Link>
        ))}
      </div>

      {curated.length > 0 ? (
        <div className="mt-l w-full">
          <p className="mb-l font-sans text-meta uppercase text-foreground-muted">Worth a look</p>
          <ProductGrid cards={curated} />
        </div>
      ) : null}
    </div>
  )
}

/**
 * **Pagination, as links.** Plan §11.1a: *"pagination or load-more."*
 *
 * Pagination is chosen over load-more for reasons that are all the same reason. Feature matrix §5
 * requires the URL to be shareable and Back/Forward to restore state; a load-more button accumulates
 * results in client memory, so page 3 is a state no URL describes, Back returns to an empty list,
 * and a crawler sees the first twenty-four products and stops. Numbered pages are server-rendered,
 * addressable, indexable, and work with JavaScript switched off.
 *
 * ### The window, and why it is not simply "every page"
 *
 * Rendering a link per page is fine for three pages and absurd for eighty. The window is the first
 * page, the last page, and the two either side of the current one, with a gap marker where numbers
 * were skipped. That keeps the control a fixed size at any catalogue size.
 *
 * `aria-current="page"` on the current number is what tells a screen-reader user where they are;
 * without it the control is a row of numbers with one styled differently, which is invisible to
 * them. The whole thing is a `<nav>` with a label because a page has more than one navigation
 * landmark and "Pagination" is how this one is told apart from the header's.
 */
export function CatalogPagination({
  basePath,
  params,
  result,
}: {
  basePath: string
  params: CatalogParams
  result: CatalogResult
}) {
  if (result.totalPages <= 1) {
    return null
  }

  const current = Math.min(Math.max(result.page, 1), result.totalPages)

  const href = (page: number): string =>
    catalogHref(basePath, { ...params, page: page === 1 ? null : page })

  const pages = new Set<number>([1, result.totalPages])

  for (let page = current - 1; page <= current + 1; page += 1) {
    if (page >= 1 && page <= result.totalPages) {
      pages.add(page)
    }
  }

  const ordered = [...pages].sort((a, b) => a - b)

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-s pt-xl">
      {current > 1 ? (
        <Link href={href(current - 1)} variant="meta" rel="prev">
          Previous
        </Link>
      ) : null}

      <ul className="flex items-center gap-1">
        {ordered.map((page, index) => {
          const previous = ordered[index - 1]
          const isGap = previous !== undefined && page - previous > 1

          return (
            <li key={page} className="flex items-center gap-1">
              {isGap ? (
                <span aria-hidden="true" className="px-1 text-meta text-foreground-disabled">
                  &hellip;
                </span>
              ) : null}

              <Link
                href={href(page)}
                variant="unstyled"
                aria-current={page === current ? 'page' : undefined}
                aria-label={`Page ${page}`}
                className={cn(
                  'flex h-9 min-w-9 items-center justify-center px-2',
                  'font-sans text-meta transition-colors duration-(--duration-fast)',
                  page === current
                    ? 'border-b border-border-strong text-foreground'
                    : 'text-foreground-muted hover:text-foreground',
                )}
              >
                {page}
              </Link>
            </li>
          )
        })}
      </ul>

      {current < result.totalPages ? (
        <Link href={href(current + 1)} variant="meta" rel="next">
          Next
        </Link>
      ) : null}
    </nav>
  )
}
