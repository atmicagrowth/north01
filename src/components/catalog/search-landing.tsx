import { ProductGrid } from '@/components/catalog/product-grid'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section, SectionHeading } from '@/components/layout/section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Link } from '@/components/ui/link'
import { SEARCH_COPY } from '@/lib/catalog/search'
import type { CategoryOption } from '@/lib/catalog/query'
import type { ProductCard } from '@/lib/catalog/resolve'

/**
 * **`/search` with no term.** A landing page, not an empty result.
 *
 * Reached three ways: typing the URL, submitting an empty form, and — the one that matters —
 * arriving with JavaScript disabled or still loading. It runs **no query**: reporting "no products"
 * for a search nobody made would be answering a question that was never asked, and it is the
 * distinction `searchState` draws between `idle` and `empty`.
 *
 * ### The form is real, and that is the point
 *
 * A plain `<form method="get" action="/search">` with `name="q"`. No JavaScript, no client
 * component, no hydration. The overlay's combobox is an *enhancement* over this path rather than the
 * only way in, which is what keeps §12.1c's panel from being load-bearing for a core journey.
 *
 * The categories come from the same cached vocabulary the filter rail uses, and the curated row from
 * Postgres — so this page renders identically whether or not the search service is reachable.
 * Structure §12 asks a dead end to *"offer category alternatives"* and *"popular/curated products
 * when available"*; this offers both before the customer has hit one.
 */
export function SearchLanding({
  categories,
  curated,
}: {
  categories: CategoryOption[]
  curated: ProductCard[]
}) {
  const topLevel = categories.filter((category) => category.parent === null)

  return (
    <Section spacing="tight">
      <PageContainer>
        <PageTitle eyebrow="Search" lede={SEARCH_COPY.idle.body} className="mb-l">
          {SEARCH_COPY.idle.title}
        </PageTitle>

        <form
          action="/search"
          method="get"
          className="flex max-w-measure flex-wrap items-end gap-s"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Label htmlFor="search-landing-q">Search</Label>
            <Input
              autoComplete="off"
              id="search-landing-q"
              name="q"
              placeholder="Hoodie, merino, Graphite…"
              type="search"
            />
          </div>

          <Button type="submit" variant="primary">
            Search
          </Button>
        </form>

        {topLevel.length > 0 ? (
          <div className="mt-xl">
            <SectionHeading className="mb-m">Browse</SectionHeading>
            <ul className="flex flex-wrap items-center gap-m">
              {topLevel.map((category) => (
                <li key={category.value}>
                  <Link href={`/shop/${category.value}`} variant="meta">
                    {category.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {curated.length > 0 ? (
          <div className="mt-xl">
            <SectionHeading className="mb-l">Worth a look</SectionHeading>
            <ProductGrid cards={curated} />
          </div>
        ) : null}
      </PageContainer>
    </Section>
  )
}
