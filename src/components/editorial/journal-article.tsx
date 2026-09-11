import type { JournalView } from '@/lib/editorial/read'

import { ProductGrid } from '@/components/catalog/product-grid'
import { CATALOG_IMAGE_SIZES } from '@/lib/catalog/sizes'
import { Prose } from '@/components/editorial/prose'
import { PageBreadcrumb } from '@/components/layout/page-breadcrumb'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section, SectionHeading } from '@/components/layout/section'
import { MediaImage } from '@/components/media/media-image'
import { Link } from '@/components/ui/link'
import { HOME_IMAGE_SIZES } from '@/lib/home/sizes'

/**
 * **A journal article** — plan §23.1c.
 *
 * The section is one sentence and a warning: *"journal content should support links to products and
 * collections. Avoid creating an editorial dead end."*
 *
 * ### The dead end is the thing being designed against
 *
 * An article that ends is an article a reader leaves the site from. So the foot of every one carries
 * three exits — the products it is about, the collections it belongs to, and other articles — and
 * each is resolved through the same published rules as everything else, so a withdrawn product is
 * **not offered** rather than offered as a link to a 404. The phase prompt names that case: *"deleted
 * related products without broken pages."*
 *
 * An article with no relationships at all still gets one exit: the shop. A dead end is a dead end
 * whether it was authored or inherited.
 *
 * ### The body is `Prose`, and that is a security decision as much as a typographic one
 *
 * **D-35**: `Prose` writes its converter map out explicitly rather than spreading Lexical's defaults,
 * because the editor auto-creates `autolink` nodes that no field hook validates. Every href goes
 * through `safeHref`, and a failing one degrades to plain text so the words survive. Headings render
 * as h2/h3 only, so an article body can never emit a second `<h1>` competing with the title.
 */
export function JournalArticlePage({ article }: { article: JournalView }) {
  return (
    <>
      {article.heroImage ? (
        <Section spacing="none">
          <MediaImage
            context="heroDesktop"
            media={article.heroImage}
            mobileContext="heroMobile"
            priority
            sizes={HOME_IMAGE_SIZES.figureFullBleed}
          />
        </Section>
      ) : null}

      <Section spacing="tight">
        <PageContainer width="narrow">
          {/* Phase 35 (P35-18). The way back to the journal, before the article begins. */}
          <PageBreadcrumb
            className="mb-s"
            items={[
              { name: 'Journal', path: '/journal' },
              { name: article.title, path: article.href },
            ]}
          />

          <PageTitle eyebrow={article.category ?? 'Journal'} size="display-l">
            {article.title}
          </PageTitle>

          {/* A byline and a date, small — guide §01's "tiny metadata" against oversized type. */}
          <p className="mt-s font-sans text-meta uppercase text-foreground-muted">
            {[article.author, formatDate(article.publishedAt)].filter(Boolean).join(' · ')}
          </p>

          {article.excerpt ? (
            <p className="mt-m max-w-measure font-sans text-body text-foreground-muted">
              {article.excerpt}
            </p>
          ) : null}

          {article.body ? <Prose className="mt-l" value={article.body} /> : null}
        </PageContainer>
      </Section>

      {article.relatedProducts.length > 0 ? (
        <Section divider="top" spacing="tight">
          <PageContainer>
            <SectionHeading className="mb-l">In this story</SectionHeading>
            <ProductGrid
              sizes={CATALOG_IMAGE_SIZES.productCardGridFull}
              cards={article.relatedProducts}
              list={{ id: 'journal_related', name: 'Journal related products' }}
            />
          </PageContainer>
        </Section>
      ) : null}

      <Section divider="top" spacing="tight">
        <PageContainer>
          <SectionHeading className="mb-m">Keep reading</SectionHeading>

          <ul className="flex flex-wrap gap-l">
            {article.relatedCollections.map((entry) => (
              <li key={entry.href}>
                <Link className="font-sans text-heading-s" href={entry.href}>
                  {entry.title}
                </Link>
              </li>
            ))}

            {article.relatedArticles.map((entry) => (
              <li key={entry.href}>
                <Link className="font-sans text-heading-s" href={entry.href}>
                  {entry.title}
                </Link>
              </li>
            ))}

            {/*
              The backstop. §23.1c's "avoid creating an editorial dead end" is not conditional on an
              editor having filled in the relationships, so there is always at least one way on.
            */}
            {article.relatedCollections.length === 0 && article.relatedArticles.length === 0 ? (
              <li>
                <Link className="font-sans text-heading-s" href="/journal">
                  More from the journal
                </Link>
              </li>
            ) : null}
          </ul>
        </PageContainer>
      </Section>
    </>
  )
}

/**
 * A date a person reads.
 *
 * Wrapped, because `Intl` throws on a malformed locale and a stored one that a validator let through
 * once should not be able to empty an article — the same backstop `formatMinorUnits` carries.
 */
function formatDate(iso: null | string): null | string {
  if (!iso) {
    return null
  }

  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}
