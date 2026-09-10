import type { Metadata } from 'next'

import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { MediaImage } from '@/components/media/media-image'
import { Link } from '@/components/ui/link'
import { getJournalIndex } from '@/lib/editorial/read'
import { EDITORIAL_GRID_THREE_UP } from '@/lib/media/grid'

export const metadata: Metadata = { title: 'Journal' }

/**
 * **`/journal`** — the index.
 *
 * Newest first, by `publishedAt`, which is the field whose hook stamps the first transition to
 * published and never touches it again — so a backdated article sorts where the editor put it rather
 * than where the database happened to write it.
 *
 * `heroImage` serves both this card and the article opener; `Journal.ts` says so, and one field for
 * both is what stops an editor having to supply two images that are almost always the same one.
 */
export default async function JournalIndexPage() {
  const articles = await getJournalIndex()

  return (
    <Section spacing="tight">
      <PageContainer>
        <PageTitle eyebrow="Journal" size="display-l">
          Notes
        </PageTitle>

        {articles.length === 0 ? (
          <div className="mt-l flex flex-col items-start gap-s">
            <p className="font-sans text-body text-foreground-muted">Nothing published yet.</p>
            <Link className="font-sans text-meta uppercase" href="/shop">
              Browse the shop
            </Link>
          </div>
        ) : (
          <ul className="mt-l grid gap-l sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((article) => (
              <li key={article.href}>
                <Link className="group block" href={article.href} variant="unstyled">
                  {article.heroImage ? (
                    <MediaImage
                      context="editorial"
                      imageClassName="transition-opacity duration-(--duration-base) ease-editorial group-hover:opacity-85"
                      media={article.heroImage}
                      sizes={EDITORIAL_GRID_THREE_UP}
                    />
                  ) : null}

                  {article.category ? (
                    <p className="mt-s font-sans text-micro uppercase text-foreground-muted">
                      {article.category}
                    </p>
                  ) : null}

                  <p className="mt-1 font-display text-heading-s text-balance">{article.title}</p>

                  {article.excerpt ? (
                    <p className="mt-1 font-sans text-body-sm text-foreground-muted">
                      {article.excerpt}
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
