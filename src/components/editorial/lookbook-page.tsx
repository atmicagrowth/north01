import type { LookbookView } from '@/lib/editorial/read'

import { AddEntireLook } from '@/components/editorial/add-entire-look'
import { Hotspot } from '@/components/editorial/hotspot'
import { Prose } from '@/components/editorial/prose'
import { Reveal } from '@/components/editorial/reveal'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section, SectionHeading } from '@/components/layout/section'
import { MediaImage } from '@/components/media/media-image'
import { HOME_IMAGE_SIZES } from '@/lib/home/sizes'
import { EDITORIAL_GALLERY_TWO_UP } from '@/lib/media/grid'

/**
 * **The lookbook** — structure §11's flow: Lookbook, Chapter, full-screen content, shop a look,
 * product.
 *
 * Phase 22 built every shoppable part of this page and could not build the page, because §22 names no
 * route. It said so plainly — the lookbook link 404'd deliberately — and this closes it. The hotspots
 * are Phase 22's components unchanged.
 *
 * ### Chapters are prescribed, not composed
 *
 * A lookbook has no `body` blocks. `Lookbooks.ts` chose an array of chapters instead, each with a
 * title, a hero image, some text, a gallery and up to eight hotspots — because a lookbook has a
 * *shape*, and letting an editor rebuild that shape every season is how a lookbook stops looking like
 * one. The page renders that shape and nothing else.
 *
 * ### A chapter with no image still renders
 *
 * `heroImage` is optional, so a chapter can legally be text and a gallery. The hotspots hang off the
 * image, so with no image there are none — the honest outcome rather than a crash, and one of the
 * phase prompt's named cases: *"missing hero media"*.
 *
 * The image context is `editorial` because it carries hotspots, and `cloudinary-url.ts` states the
 * rule: it crops nothing, and *"any surface carrying hotspots must use it"* — a `c_fill` would move
 * every marker off its garment.
 */
export function LookbookPage({ lookbook }: { lookbook: LookbookView }) {
  return (
    <>
      <Section spacing="tight">
        <PageContainer>
          <PageTitle
            eyebrow={
              lookbook.season && lookbook.season !== lookbook.title ? lookbook.season : 'Lookbook'
            }
            size="display-l"
          >
            {lookbook.title}
          </PageTitle>

          {lookbook.intro ? (
            <Prose className="mt-m max-w-measure" tone="lede" value={lookbook.intro} />
          ) : null}

          {/* P35-02: the cover was chosen in the admin and shown only on the index card. */}
          {lookbook.cover ? (
            <div className="mt-l">
              <MediaImage
                context="editorial"
                media={lookbook.cover}
                sizes={HOME_IMAGE_SIZES.shopTheLook}
              />
            </div>
          ) : null}
        </PageContainer>
      </Section>

      {lookbook.chapters.map((chapter, index) => (
        <Reveal key={`${chapter.title}-${index}`}>
          <Section divider="top" spacing="tight">
            <PageContainer>
              <SectionHeading className="mb-l">{chapter.title}</SectionHeading>

              {chapter.heroImage ? (
                <>
                  <div className="relative">
                    <MediaImage
                      context="editorial"
                      media={chapter.heroImage}
                      sizes={HOME_IMAGE_SIZES.shopTheLook}
                    />

                    {chapter.hotspots.map((hotspot, hotspotIndex) => (
                      <Hotspot hotspot={hotspot} key={hotspotIndex} />
                    ))}
                  </div>

                  {/* §22.1d, on the surface the plan wrote it for. */}
                  <AddEntireLook
                    productIds={chapter.hotspots.map((hotspot) => hotspot.product.id)}
                  />
                </>
              ) : null}

              {chapter.editorialText ? (
                <Prose className="mt-l max-w-measure" value={chapter.editorialText} />
              ) : null}

              {chapter.gallery.length > 0 ? (
                <ul className="mt-l grid gap-m sm:grid-cols-2">
                  {chapter.gallery.map((frame, frameIndex) => (
                    <li key={frameIndex}>
                      <figure className="flex flex-col gap-s">
                        <MediaImage
                          context="editorial"
                          media={frame.media}
                          sizes={EDITORIAL_GALLERY_TWO_UP}
                        />

                        {frame.caption ? (
                          <figcaption className="font-sans text-body-sm text-foreground-muted">
                            {frame.caption}
                          </figcaption>
                        ) : null}
                      </figure>
                    </li>
                  ))}
                </ul>
              ) : null}
            </PageContainer>
          </Section>
        </Reveal>
      ))}
    </>
  )
}
