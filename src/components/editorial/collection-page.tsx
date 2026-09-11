import type { CollectionView } from '@/lib/editorial/read'

import { ProductGrid } from '@/components/catalog/product-grid'
import { CATALOG_IMAGE_SIZES } from '@/lib/catalog/sizes'
import { EditorialBody } from '@/components/editorial/editorial-body'
import { Prose } from '@/components/editorial/prose'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section, SectionHeading } from '@/components/layout/section'
import { MediaImage } from '@/components/media/media-image'
import { Link } from '@/components/ui/link'
import { HOME_IMAGE_SIZES } from '@/lib/home/sizes'

/**
 * **The collection page** — plan §23.1a's flow, in order.
 *
 * > Collection Hero → Intro → Editorial blocks → Featured products → Full collection product grid →
 * > Related collections.
 *
 * ---
 *
 * ### It is not a filterable grid, and that is a recorded decision rather than a preference
 *
 * **DEV-09** rules out *"a collection page drawn as a plain filterable grid, contradicting the
 * guide's campaign-led composition"*, and structure §9 says collections *"should feel like campaigns,
 * not category dumps."* So `CatalogPage` — the component behind `/shop`, `/shop/[category]` and
 * `/search` — is deliberately **not** reused, despite fitting one chapter of this page perfectly.
 *
 * There is a second, harder reason, and it would have been a real defect. `requiresSearchIndex()`
 * sends any query carrying a collection to Algolia, because membership lives on `collections.products`
 * and the reverse side on the product is a Payload `join` — virtual, no column, unfilterable in
 * Postgres. A collection page built on `getCatalog` would therefore render **nothing at all** whenever
 * Algolia was unconfigured or down, while every other listing in the shop survived it. Plan §A.5 asks
 * the opposite: the catalogue must stay usable through curated navigation.
 *
 * Reading the ordered id list and asking Postgres for those products keeps the page working with no
 * search service, and keeps the curator's order, which a relevance-ranked index would not.
 *
 * ### The grid is unfiltered on purpose
 *
 * No facets, no sort, no pagination controls. A collection is a finite curated set — the merchandiser
 * decided both its contents and its order — and offering to re-sort it would be offering to undo the
 * curation. `/shop` is one click away for anybody who wants that.
 */
export function CollectionPage({ collection }: { collection: CollectionView }) {
  return (
    <>
      {/* Hero. Missing media is one of the prompt's named cases: the title carries the page alone. */}
      {collection.heroMedia ? (
        <Section spacing="none">
          <MediaImage
            context="heroDesktop"
            media={collection.heroMedia}
            mobileContext="heroMobile"
            priority
            sizes={HOME_IMAGE_SIZES.figureFullBleed}
          />
        </Section>
      ) : null}

      <Section spacing="tight">
        <PageContainer>
          <PageTitle eyebrow="Collection" size="display-l">
            {collection.title}
          </PageTitle>

          {collection.description ? (
            <Prose className="mt-m max-w-measure" tone="lede" value={collection.description} />
          ) : null}

          {collection.introMedia ? (
            <div className="mt-l">
              <MediaImage
                context="editorial"
                media={collection.introMedia}
                sizes={HOME_IMAGE_SIZES.figureContained}
              />
            </div>
          ) : null}
        </PageContainer>
      </Section>

      <EditorialBody sections={collection.body} />

      {/*
        Featured, then everything. The first four of the curated order are shown again in the grid
        below — that repetition is deliberate: §23.1a asks for both steps, and a customer scrolling
        past the feature should not have to remember which four they were.

        Only when the collection holds MORE than four. At four or fewer, "featured" is the whole
        collection and the section would be the grid below it printed twice, one after the other, so
        `read.ts` returns an empty `featured` and this section does not render.
      */}
      {collection.featured.length > 0 ? (
        <Section divider="top" spacing="tight">
          <PageContainer>
            <SectionHeading className="mb-l">Featured</SectionHeading>
            <ProductGrid
              sizes={CATALOG_IMAGE_SIZES.productCardGridFull}
              cards={collection.featured}
              list={{ id: 'collection_featured', name: 'Collection featured' }}
            />
          </PageContainer>
        </Section>
      ) : null}

      <Section divider="top" spacing="tight">
        <PageContainer>
          <SectionHeading className="mb-l">Everything in {collection.title}</SectionHeading>

          {collection.products.length > 0 ? (
            <ProductGrid
              sizes={CATALOG_IMAGE_SIZES.productCardGridFull}
              cards={collection.products}
              list={{ id: 'collection', name: 'Collection' }}
            />
          ) : (
            /*
              The prompt's "empty product relationships". A collection with nothing published in it is
              a real state — a drop that has not landed — and the honest answer is a sentence and a way
              on, not a blank grid.
            */
            <div className="flex flex-col items-start gap-s">
              <p className="font-sans text-body text-foreground-muted">
                Nothing in this collection is available right now.
              </p>
              <Link className="font-sans text-meta uppercase" href="/shop">
                Browse the shop
              </Link>
            </div>
          )}
        </PageContainer>
      </Section>

      {/* §23.1a's last step, and the prompt's "clear way back to shopping" for this page shape. */}
      {collection.related.length > 0 ? (
        <Section divider="top" spacing="tight">
          <PageContainer>
            <SectionHeading className="mb-m">More collections</SectionHeading>

            <ul className="flex flex-wrap gap-l">
              {collection.related.map((entry) => (
                <li key={entry.href}>
                  <Link className="font-sans text-heading-s" href={entry.href}>
                    {entry.title}
                  </Link>
                </li>
              ))}
            </ul>
          </PageContainer>
        </Section>
      ) : null}
    </>
  )
}
