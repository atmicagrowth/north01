import type { EditView } from '@/lib/editorial/read'

import { ProductGrid } from '@/components/catalog/product-grid'
import { EditorialBody } from '@/components/editorial/editorial-body'
import { Prose } from '@/components/editorial/prose'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section, SectionHeading } from '@/components/layout/section'
import { MediaImage } from '@/components/media/media-image'
import { Link } from '@/components/ui/link'
import { HOME_IMAGE_SIZES } from '@/lib/home/sizes'

/**
 * **The edit page** — plan §23.1b.
 *
 * §23.1b does not give a layout. It gives **four questions** the page must answer, and the
 * composition answers them in that order:
 *
 * 1. *"What is this edit?"* — the hero and the title.
 * 2. *"Why should I care?"* — the intro, in the editor's own words.
 * 3. *"What products belong here?"* — the captioned product groups, which are the structural
 *    difference between an Edit and a Collection: a Collection is one ordered list, an Edit is
 *    *several named sets*, and the naming is the argument. "Layers for a cold platform" says
 *    something that a flat grid of the same garments does not.
 * 4. *"Where do I shop?"* — every group is itself a way to shop, and the lookbooks at the foot are
 *    the editorial exit the phase prompt asks for.
 */
export function EditPage({ edit }: { edit: EditView }) {
  return (
    <>
      {edit.hero ? (
        <Section spacing="none">
          <MediaImage
            context="heroDesktop"
            media={edit.hero}
            priority
            sizes={HOME_IMAGE_SIZES.figureFullBleed}
          />
        </Section>
      ) : null}

      <Section spacing="tight">
        <PageContainer>
          <PageTitle eyebrow="Edit" size="display-l">
            {edit.title}
          </PageTitle>

          {edit.intro ? (
            <Prose className="mt-m max-w-measure" tone="lede" value={edit.intro} />
          ) : null}
        </PageContainer>
      </Section>

      <EditorialBody sections={edit.body} />

      {/*
        The groups. Each is a heading, an optional sentence and a grid — and a group whose products
        all became unavailable was dropped by the reader, so a caption never stands above nothing.
      */}
      {edit.groups.map((group) => (
        <Section divider="top" key={group.title} spacing="tight">
          <PageContainer>
            <SectionHeading className="mb-s">{group.title}</SectionHeading>

            {group.intro ? (
              <p className="mb-l max-w-measure font-sans text-body text-foreground-muted">
                {group.intro}
              </p>
            ) : null}

            <ProductGrid cards={group.products} list={{ id: 'edit', name: 'Edit' }} />
          </PageContainer>
        </Section>
      ))}

      {edit.groups.length === 0 ? (
        <Section divider="top" spacing="tight">
          <PageContainer>
            <div className="flex flex-col items-start gap-s">
              <p className="font-sans text-body text-foreground-muted">
                Nothing in this edit is available right now.
              </p>
              <Link className="font-sans text-meta uppercase" href="/shop">
                Browse the shop
              </Link>
            </div>
          </PageContainer>
        </Section>
      ) : null}

      {edit.lookbooks.length > 0 ? (
        <Section divider="top" spacing="tight">
          <PageContainer>
            <SectionHeading className="mb-m">See it styled</SectionHeading>

            <ul className="flex flex-wrap gap-l">
              {edit.lookbooks.map((entry) => (
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
