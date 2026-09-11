import type { Metadata } from 'next'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { HelpNav } from '@/components/help/policy-page'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Prose } from '@/components/editorial/prose'
import { Section, SectionHeading } from '@/components/layout/section'
import { Link } from '@/components/ui/link'
import { getFaqGroups } from '@/lib/help/read'
import { pageMetadata } from '@/lib/seo/site'

/**
 * **`/help/faq`** — §28.1c's *"FAQs"*, and the route the footer has linked to since Phase 9.
 *
 * Phase 28's audit found the whole Help column pointing at pages that do not exist. This is the
 * first of them, and it is the one worth building first because the content was already there: the
 * `faqs` collection has been editable, published and **rendered nowhere** — a CMS surface that
 * silently discarded an editor's work, which is exactly the defect Phase 23 found in the `gallery`
 * and `pullQuote` blocks.
 *
 * ### An accordion, and the same one the product page uses
 *
 * Twenty questions as twenty open paragraphs is a wall; twenty as a list of headings is scannable.
 * `Accordion` is already built, already keyboard-operable and already the vocabulary a customer met
 * on the product page — a second disclosure pattern for the same job would be a second thing to get
 * right.
 *
 * `type="multiple"` deliberately: somebody comparing the returns window against the shipping window
 * should not have one close as the other opens.
 *
 * ### An empty page is a state, not a failure
 *
 * A shop with no published FAQs renders the empty state and a way onward rather than a bare heading.
 * A topic with nothing in it is not rendered at all — see `getFaqGroups` for why an empty heading is
 * worse than an absent one.
 */
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    description: 'Answers to the questions customers ask most about orders, delivery and returns.',
    path: '/help/faq',
    title: 'Frequently asked questions',
  })
}

export default async function FaqPage() {
  const groups = await getFaqGroups()

  return (
    <Section spacing="tight">
      <PageContainer width="narrow">
        <PageTitle eyebrow="Help" size="display-l">
          Frequently asked questions
        </PageTitle>

        <HelpNav current="FAQ" />

        {groups.length === 0 ? (
          <div className="mt-l flex flex-col items-start gap-s">
            <p className="font-sans text-body text-foreground-muted">
              There are no published answers here yet.
            </p>
            <Link className="font-sans text-meta uppercase" href="/shop">
              Browse the shop
            </Link>
          </div>
        ) : (
          <div className="mt-l flex flex-col gap-l">
            {groups.map((group) => (
              <section key={group.topic}>
                <SectionHeading className="mb-s">{group.label}</SectionHeading>

                <Accordion className="border-t border-border" type="multiple">
                  {group.entries.map((entry) => (
                    <AccordionItem key={entry.id} value={String(entry.id)}>
                      <AccordionTrigger>{entry.question}</AccordionTrigger>
                      <AccordionContent>
                        <Prose value={entry.answer} />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </section>
            ))}
          </div>
        )}
      </PageContainer>
    </Section>
  )
}
