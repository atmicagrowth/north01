import type { EditorialSection } from '@/lib/editorial/resolve'

import { ProductCard } from '@/components/catalog/product-card'
import {
  EditorialTextSection,
  FigureSection,
  ShopTheLookSection,
  SplitFeatureSection,
} from '@/components/editorial/editorial-blocks'
import { Reveal } from '@/components/editorial/reveal'
import { PageContainer } from '@/components/layout/page-container'
import { Section, SectionHeading } from '@/components/layout/section'
import { MediaImage } from '@/components/media/media-image'
import { HOME_IMAGE_SIZES } from '@/lib/home/sizes'
import { cn } from '@/lib/cn'

/**
 * **The editorial body, for any page that composes one.**
 *
 * Collections and Edits both carry a `body` over the shared editorial block vocabulary, and until
 * Phase 23 neither had a route, so neither had a dispatcher. This is it.
 *
 * Modelled on `home-sections.tsx` and deliberately **not** shared with it: that file imports `Hero`,
 * `PromoStrip`, `CategoryTiles`, `CollectionFeature` and `SocialGallery`, none of which are in the
 * editorial vocabulary, and its exhaustive `never` default is what keeps its own three lists in step.
 *
 * Every section is wrapped in `Reveal`, which is the pattern the homepage established — except that
 * here there is no LCP section to exempt, because an editorial page's LCP is its hero, and the hero
 * is not part of the body.
 */
export function EditorialBody({ sections }: { sections: EditorialSection[] }) {
  if (sections.length === 0) {
    return null
  }

  return (
    <>
      {sections.map((section) => (
        <Reveal key={section.key}>
          <EditorialSectionBody section={section} />
        </Reveal>
      ))}
    </>
  )
}

function EditorialSectionBody({ section }: { section: EditorialSection }) {
  switch (section.type) {
    case 'editorial':
      return <EditorialTextSection section={section as never} />

    case 'figure':
      return <FigureSection section={section as never} />

    case 'gallery':
      return <GallerySection section={section} />

    case 'productGroup':
      return <ProductGroupSection section={section} />

    case 'pullQuote':
      return <PullQuoteSection section={section} />

    case 'shopTheLook':
      return <ShopTheLookSection section={section as never} />

    case 'splitFeature':
      return <SplitFeatureSection section={section as never} />

    default:
      /*
       * Not an exhaustive `never` guard, deliberately — see the resolver. The vocabulary is shared
       * with the homepage, and a block added there should cost this page that section rather than a
       * compile error.
       */
      return null
  }
}

/**
 * **The gallery — built in Phase 23 because nothing had rendered it.**
 *
 * The block has been authorable since Phase 6 and had no component and no resolver case anywhere. An
 * editor could compose one and publish a page where it simply was not there.
 *
 * Three layouts, and the difference between them is only how many columns the images sit in — the
 * frames are the asset's own, because `editorial` crops nothing. A gallery of portraits and a gallery
 * of landscapes therefore look like what the photographer shot rather than like a grid of squares,
 * which is the whole reason an editorial gallery is not a product grid.
 */
function GallerySection({ section }: { section: Extract<EditorialSection, { type: 'gallery' }> }) {
  return (
    <Section data-section="gallery">
      <PageContainer>
        <ul
          className={cn(
            'grid gap-m',
            section.layout === 'triptych' && 'sm:grid-cols-3',
            section.layout === 'grid' && 'grid-cols-2 lg:grid-cols-3',
            section.layout === 'pair' && 'sm:grid-cols-2',
          )}
        >
          {section.images.map((image, index) => (
            <li key={index}>
              <figure className="flex flex-col gap-s">
                <MediaImage
                  context="editorial"
                  media={image.media}
                  sizes={HOME_IMAGE_SIZES.figureContained}
                />

                {image.caption ? (
                  <figcaption className="font-sans text-body-sm text-foreground-muted">
                    {image.caption}
                  </figcaption>
                ) : null}
              </figure>
            </li>
          ))}
        </ul>
      </PageContainer>
    </Section>
  )
}

/**
 * **The pull quote — the other block nothing rendered.**
 *
 * A `<blockquote>` with a `<cite>`, because that is what it is. The display serif at heading scale
 * rather than display scale: visual guide §01 asks for *"oversized type with tiny metadata"*, and a
 * pull quote inside an article is a change of voice rather than a second headline competing with the
 * page title.
 *
 * The attribution is optional and renders nothing when absent — an empty `<cite>` would be a dash
 * hanging under a sentence.
 */
function PullQuoteSection({
  section,
}: {
  section: Extract<EditorialSection, { type: 'pullQuote' }>
}) {
  return (
    <Section data-section="pull-quote">
      <PageContainer>
        <blockquote className="max-w-measure border-l border-border pl-l">
          <p className="font-display text-heading-m text-balance text-foreground-bright">
            {section.quote}
          </p>

          {section.attribution ? (
            <cite className="mt-s block font-sans text-meta uppercase not-italic text-foreground-muted">
              {section.attribution}
            </cite>
          ) : null}
        </blockquote>
      </PageContainer>
    </Section>
  )
}

/**
 * A captioned set of products inside an editorial page — §23.1b's *"what products belong here?"*.
 *
 * The resolver drops the whole section when nothing resolves, so this never renders a heading above
 * an empty row. That is the prompt's *"empty product relationships"* handled by absence rather than
 * by an empty state, which is right here and wrong on a search page: a customer who searched expects
 * an answer, and a reader scrolling an editorial page never asked this question.
 */
function ProductGroupSection({
  section,
}: {
  section: Extract<EditorialSection, { type: 'productGroup' }>
}) {
  return (
    <Section data-section="product-group">
      <PageContainer>
        {section.heading ? (
          <SectionHeading className="mb-s">{section.heading}</SectionHeading>
        ) : null}

        {section.intro ? (
          <p className="mb-l max-w-measure font-sans text-body text-foreground-muted">
            {section.intro}
          </p>
        ) : null}

        <ul className="grid grid-cols-2 gap-x-m gap-y-l lg:grid-cols-4">
          {section.products.map((product) => (
            <li key={product.id}>
              <ProductCard
                card={{
                  compareAtLabel: null,
                  href: product.href,
                  id: product.id,
                  image: product.image,
                  isLimitedEdition: false,
                  isNew: false,
                  lowStockLabel: null,
                  name: product.name,
                  priceLabel: product.priceLabel,
                  state: product.soldOut ? 'soldOut' : 'available',
                }}
              />
            </li>
          ))}
        </ul>
      </PageContainer>
    </Section>
  )
}
