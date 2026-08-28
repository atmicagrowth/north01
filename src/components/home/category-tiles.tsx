import { PageContainer } from '@/components/layout/page-container'
import { Section, SectionHeading } from '@/components/layout/section'
import { MediaImage } from '@/components/media/media-image'
import { Link } from '@/components/ui/link'
import { HOME_IMAGE_SIZES } from '@/lib/home/sizes'
import type { SectionOf } from '@/lib/home/resolve'

/**
 * *"Featured categories"* — the homepage's routes into the shop. Feature matrix §3, structure §4
 * step 2, plan §10.1a.
 *
 * Photography does the work and the label sits under it, quietly — guide §07's *"large image area,
 * quiet typography beneath or beside imagery"*, and §11's *"keep product presentation visually
 * open"*. There is no card, no border and no overlay caption: a tracked Meta label under a 4:5 frame
 * is the whole component.
 *
 * The label is a heading-free `<p>`. These tiles are navigation, and marking four category names as
 * `<h3>` would put four headings into the document outline that describe destinations rather than
 * sections of this page. The section's own `SectionHeading` is the heading; the tiles are links.
 *
 * Every href comes from `documentHref` in the resolver, so a renamed category keeps working and a
 * slug can never climb out of `/shop/`. These routes 404 until Phase 11 builds the shop.
 */
export function CategoryTiles({ section }: { section: SectionOf<'categoryTiles'> }) {
  return (
    <Section data-section="category-tiles">
      <PageContainer>
        {section.heading ? (
          <SectionHeading className="mb-l">{section.heading}</SectionHeading>
        ) : null}

        <ul className="grid grid-cols-2 gap-m sm:grid-cols-3 lg:grid-cols-4 lg:gap-l">
          {section.tiles.map((tile, index) => (
            <li key={index}>
              <Link
                href={tile.href}
                variant="unstyled"
                className="group block focus-visible:outline-offset-4"
              >
                <MediaImage
                  media={tile.image}
                  context="productCard"
                  sizes={HOME_IMAGE_SIZES.categoryTile}
                  priority={section.lcp && index === 0}
                  alt=""
                  imageClassName="object-cover transition-opacity duration-(--duration-base) ease-editorial group-hover:opacity-85"
                />

                <p className="mt-s font-sans text-meta uppercase text-foreground transition-colors duration-(--duration-fast) group-hover:text-foreground-bright">
                  {tile.name}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </PageContainer>
    </Section>
  )
}
