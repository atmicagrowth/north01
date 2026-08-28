import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { MediaImage } from '@/components/media/media-image'
import { Button } from '@/components/ui/button'
import { Link, NewTabHint } from '@/components/ui/link'
import { HOME_IMAGE_SIZES } from '@/lib/home/sizes'
import type { SectionOf } from '@/lib/home/resolve'

/**
 * *"Collection feature"* — plan §10.1a — the homepage's largest bridge into a merchandising page.
 *
 * Visual guide §09 describes a Collection as a *"campaign-led composition. Large opening image or
 * colour field. Restrained introduction."* This is that composition compressed into one homepage
 * section: full-bleed opener, then a title and two or three lines, then one way in.
 *
 * ### §10.1c is satisfied structurally, not by editor discipline
 *
 * *"Every commerce-driven editorial block should have an explicit CTA or linked product/collection
 * path."* The resolver guarantees the path exists — the section's subject is a reference to a
 * collection, so `/collections/<slug>` is always available and the editor's CTA is an override for
 * the *words*. There is no state in which this section renders without a route out of it.
 *
 * The title is `as="h2"`: the hero owns the page's `<h1>`, and when no hero survived `page.tsx`
 * supplies a visually hidden one, so this is never the top of the outline.
 */
export function CollectionFeature({ section }: { section: SectionOf<'collectionFeature'> }) {
  return (
    <Section spacing="none" data-section="collection-feature">
      <MediaImage
        media={section.media}
        mobileMedia={section.mobileMedia}
        context="heroDesktop"
        mobileContext="heroMobile"
        sizes={HOME_IMAGE_SIZES.collectionFeature}
        priority={section.lcp}
      />

      <PageContainer>
        <div className="py-l lg:py-xl">
          <PageTitle eyebrow={section.eyebrow} size="display-l" as="h2">
            {section.title}
          </PageTitle>

          {section.body ? (
            <p className="mt-m max-w-measure font-sans text-body text-foreground-muted">
              {section.body}
            </p>
          ) : null}

          <div className="mt-l">
            <Button asChild variant="secondary" size="lg">
              <Link href={section.cta.href} variant="unstyled" external={section.cta.external}>
                {section.cta.label}
                {section.cta.external ? <NewTabHint /> : null}
              </Link>
            </Button>
          </div>
        </div>
      </PageContainer>
    </Section>
  )
}
