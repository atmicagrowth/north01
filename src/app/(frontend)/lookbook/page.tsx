import type { Metadata } from 'next'

import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { MediaImage } from '@/components/media/media-image'
import { Link } from '@/components/ui/link'
import { getLookbookIndex } from '@/lib/editorial/read'
import { HOME_IMAGE_SIZES } from '@/lib/home/sizes'

export const metadata: Metadata = { title: 'Lookbook' }

/**
 * **`/lookbook`** — the index, and the reason the navigation has been broken since Phase 9.
 *
 * The header and the mobile menu have linked here since the shell was built, and `documentHref` maps
 * a lookbook to `/lookbook/<slug>`. Neither route existed, so **every one of those links 404'd** —
 * accepted at the time and recorded, because the page belonged to this phase.
 *
 * Building only `/lookbook/[slug]` would have left the nav still broken; building only `/lookbook`
 * would have left `documentHref` pointing at nothing. Both, together, is what closes it.
 *
 * `coverImage` on the collection is described as *"the index-page cover"*, which is this page — the
 * field was authored for a page that did not exist yet.
 */
export default async function LookbookIndexPage() {
  const lookbooks = await getLookbookIndex()

  return (
    <Section spacing="tight">
      <PageContainer>
        <PageTitle eyebrow="Lookbook" size="display-l">
          Seasons
        </PageTitle>

        {lookbooks.length === 0 ? (
          <div className="mt-l flex flex-col items-start gap-s">
            <p className="font-sans text-body text-foreground-muted">
              No lookbooks are published yet.
            </p>
            <Link className="font-sans text-meta uppercase" href="/shop">
              Browse the shop
            </Link>
          </div>
        ) : (
          <ul className="mt-l grid gap-l sm:grid-cols-2">
            {lookbooks.map((lookbook) => (
              <li key={lookbook.href}>
                <Link className="group block" href={lookbook.href} variant="unstyled">
                  {/*
                    A cover is optional, and a season with none is still a season. The title carries
                    the card alone rather than the card being dropped — the phase prompt's "missing
                    hero media", answered without losing the destination.
                  */}
                  {lookbook.coverImage ? (
                    <MediaImage
                      context="editorial"
                      imageClassName="transition-opacity duration-(--duration-base) ease-editorial group-hover:opacity-85"
                      media={lookbook.coverImage}
                      sizes={HOME_IMAGE_SIZES.figureContained}
                    />
                  ) : null}

                  <p className="mt-s font-display text-heading-m">{lookbook.title}</p>

                  {lookbook.season ? (
                    <p className="font-sans text-meta uppercase text-foreground-muted">
                      {lookbook.season}
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
