import { Link } from '@/components/ui/link'
import { catalogHref, type CatalogParams } from '@/lib/catalog/query'
import { productCountLabel } from '@/lib/catalog/resolve'
import type { IgnoredFilter } from '@/lib/catalog/query'

/**
 * **The control row.** Plan §11.1a's product count and sort, plus the mobile filter trigger.
 *
 * Visual guide §09, Shop / Listing: *"controls stay compact and visually secondary"*, *"the top of
 * the page should feel calm and structured."* So this is one line — a count on the left, sort on the
 * right, and on a phone the filter trigger beside it — with no boxes, no fills and no icons beyond
 * the ones the controls need to work.
 *
 * It is a **server** component that renders two client islands. The count, the chips and the ignored
 * notice are all static markup derived from the query the server already resolved; only the sort and
 * the drawer need JavaScript. Making the whole row a client component would ship the formatting of
 * "24 products" to the browser for no reason.
 */
export function CatalogToolbar({
  basePath,
  exhaustive = true,
  ignored,
  params,
  total,
  unavailable = false,
}: {
  basePath: string
  /** False when the engine stopped counting precisely — the label then says "About …". */
  exhaustive?: boolean
  ignored: IgnoredFilter[]
  params: CatalogParams
  total: number
  /**
   * The engine failed, so there is no count. The polite live region announced "No products" above
   * the unavailable panel, and a screen reader heard that first — a service outage read as an
   * empty shop, which §11.1d forbids.
   */
  unavailable?: boolean
}) {
  return (
    <div className="flex flex-col gap-m" data-slot="catalog-toolbar">
      <div className="border-b border-border pb-m">
        {/*
          `aria-live="polite"` so the count is announced after a filter changes. Without it a
          keyboard or screen-reader user ticks "Black", the grid silently replaces itself, and
          nothing tells them whether anything happened — the same class of miss as Phase 10's
          newsletter form, which announced nothing on a failed submit.
        */}
        <p aria-live="polite" className="font-sans text-meta uppercase text-foreground-muted">
          {unavailable ? null : productCountLabel(total, exhaustive)}
        </p>

        {/*
          The Filter trigger and the sort select are not here any more: they are client islands that
          read the URL, and inside the results' keyed boundary every filter write remounted them —
          the mobile drawer closed after each tick. `CatalogPage` renders them above the boundary.
        */}
      </div>

      <IgnoredNotice basePath={basePath} ignored={ignored} params={params} />
    </div>
  )
}

/**
 * **What the URL asked for and the shop could not give.**
 *
 * `normaliseCatalogQuery` drops an unknown facet value rather than returning an empty grid, which is
 * feature matrix §5's *"invalid filter values are ignored safely"*. This is the *safely* half:
 * without it, a customer following a link to `?color=puce` sees a perfectly ordinary shop and has no
 * way to know the link they were sent was narrower than what they are looking at.
 *
 * Plan §11.1d's *"filter references deleted value"* is the case that makes this worth the space — a
 * colour retired last week, a category renamed, a bookmark from a month ago. The message names the
 * value so the customer can recognise it, and does not blame them for it.
 *
 * A reversed price range is reported here too, and it is the one case that was *corrected* rather
 * than dropped, so the wording says so.
 */
function IgnoredNotice({
  basePath,
  ignored,
  params,
}: {
  basePath: string
  ignored: IgnoredFilter[]
  params: CatalogParams
}) {
  if (ignored.length === 0) {
    return null
  }

  const unknown = ignored.filter((entry) => entry.reason === 'unknown')
  const reversed = ignored.filter((entry) => entry.reason === 'reversed')
  const truncated = ignored.filter((entry) => entry.reason === 'truncated')

  return (
    <p
      className="font-sans text-body-sm text-foreground-muted"
      /*
       * `role="status"` and not `alert`. Nothing is broken and nothing needs interrupting — this is
       * a note about a URL, announced once when the page settles.
       */
      role="status"
    >
      {unknown.length > 0 ? (
        <>
          {unknown.length === 1 ? 'One filter was' : `${unknown.length} filters were`} ignored
          because the shop no longer has {unknown.length === 1 ? 'that value' : 'those values'}:{' '}
          <span className="text-foreground">
            {unknown.map((entry) => `${entry.facet} “${entry.value}”`).join(', ')}
          </span>
          .{' '}
        </>
      ) : null}

      {reversed.length > 0 ? (
        <>The price range was the wrong way round, so it was swapped. </>
      ) : null}

      {/*
        §12.1d's "very long query". A paste of a whole paragraph is clamped to 256 BYTES, and the
        customer is told the shop used the first part of it — rather than being shown results for a
        sentence they cannot see in the address bar.
      */}
      {truncated.length > 0 ? (
        <>That search was very long, so only the first part of it was used. </>
      ) : null}

      <Link href={catalogHref(basePath, { q: params.q, sort: params.sort })} variant="meta">
        Clear filters
      </Link>
    </p>
  )
}
