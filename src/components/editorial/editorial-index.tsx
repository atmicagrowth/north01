import type { EditorialCard } from '@/lib/editorial/read'

import { MediaImage } from '@/components/media/media-image'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { Link } from '@/components/ui/link'
import { EDITORIAL_GRID_TWO_UP } from '@/lib/media/grid'

/**
 * **The index page `/collections` and `/edit` both needed, and neither had.**
 *
 * The header has linked to both since Phase 9 and both answered **404** until Phase 30's responsive
 * pass asked the browser for every navigation href. Phase 23 built the detail pages and recorded the
 * indexes as owed; Phase 28's audit repeated it. A link in the primary navigation that 404s is
 * §0.1.17's fake control on the one surface that appears on every page of the shop.
 *
 * One component for both, for the same reason `getCollectionIndex` and `getEditIndex` share a reader:
 * the two differ in what their *detail* pages do, and not at all in what an index shows. `/lookbook`
 * and `/journal` deliberately keep their own — a lookbook card carries a season and a journal card a
 * category and an excerpt, which is a different card rather than the same one with a prop.
 *
 * **A missing cover is a card without a picture, not a missing card.** §8.1d's rule, and the same
 * choice `/lookbook` makes: the title carries the row alone rather than the row being dropped.
 */
export function EditorialIndex({
  emptyMessage,
  entries,
  eyebrow,
  title,
}: {
  emptyMessage: string
  entries: EditorialCard[]
  eyebrow: string
  title: string
}) {
  return (
    <Section spacing="tight">
      <PageContainer>
        <PageTitle eyebrow={eyebrow} size="display-l">
          {title}
        </PageTitle>

        {entries.length === 0 ? (
          <div className="mt-l flex flex-col items-start gap-s">
            <p className="font-sans text-body text-foreground-muted">{emptyMessage}</p>
            <Link className="font-sans text-meta uppercase" href="/shop">
              Browse the shop
            </Link>
          </div>
        ) : (
          <ul className="mt-l grid gap-l sm:grid-cols-2">
            {entries.map((entry) => (
              <li key={entry.href}>
                <Link className="group block" href={entry.href} variant="unstyled">
                  {entry.heroImage ? (
                    <MediaImage
                      context="editorial"
                      imageClassName="transition-opacity duration-(--duration-base) ease-editorial group-hover:opacity-85"
                      media={entry.heroImage}
                      sizes={EDITORIAL_GRID_TWO_UP}
                    />
                  ) : null}

                  <p className="mt-s font-display text-heading-m">{entry.title}</p>

                  {entry.description ? (
                    <p className="mt-1 font-sans text-body-sm text-foreground-muted">
                      {entry.description}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageContainer>
    </Section>
  )
}
