import { PageContainer } from '@/components/layout/page-container'
import { Section, SectionHeading } from '@/components/layout/section'
import { MediaImage } from '@/components/media/media-image'
import { Link, NewTabHint } from '@/components/ui/link'
import { HOME_IMAGE_SIZES } from '@/lib/home/sizes'
import type { SectionOf } from '@/lib/home/resolve'

/**
 * *"Social/community gallery"* — feature matrix §3, structure §4 step 7.
 *
 * **Everything here is content an editor uploaded.** No network request is made to any social
 * platform, nothing is fetched at render, and no customer submitted any of it. Both exclusions are
 * recorded on the block (`blocks/home.ts`): a feed would need an integration no document approves
 * and the tech stack does not list, and user-generated content was ruled out of scope as **DEV-09**
 * for having no entity and no moderation path.
 *
 * The `handle` is therefore a **credit line an editor typed**, not a link to an account and not a
 * claim that the person posted anything. It is rendered as quiet Micro-sized metadata under the
 * frame, and it is not itself a link — the optional `link` on each item is, and it usually points at
 * a product or a lookbook rather than off-site.
 *
 * A tile with a link is a link; a tile without one is a picture. Neither is a button that does
 * nothing, which is the shape this section takes in most storefronts.
 */
export function SocialGallery({ section }: { section: SectionOf<'socialGallery'> }) {
  return (
    <Section data-section="social-gallery">
      <PageContainer>
        {section.heading ? (
          <SectionHeading className="mb-l">{section.heading}</SectionHeading>
        ) : null}

        <ul className="grid grid-cols-2 gap-s lg:grid-cols-4 lg:gap-m">
          {section.items.map((item, index) => {
            const frame = (
              <>
                <MediaImage
                  media={item.image}
                  context="productCard"
                  sizes={HOME_IMAGE_SIZES.socialTile}
                  priority={section.lcp && index === 0}
                  imageClassName="object-cover transition-opacity duration-(--duration-base) ease-editorial group-hover:opacity-85"
                />

                {item.handle ? (
                  <p className="mt-s font-sans text-micro uppercase text-foreground-muted">
                    {item.handle}
                  </p>
                ) : null}
              </>
            )

            return (
              <li key={index}>
                {item.link ? (
                  <Link
                    href={item.link.href}
                    variant="unstyled"
                    external={item.link.external}
                    className="group block focus-visible:outline-offset-4"
                  >
                    {frame}
                    <span className="sr-only">{item.link.label}</span>
                    {item.link.external ? <NewTabHint /> : null}
                  </Link>
                ) : (
                  <div className="group">{frame}</div>
                )}
              </li>
            )
          })}
        </ul>
      </PageContainer>
    </Section>
  )
}
