import { PageContainer } from '@/components/layout/page-container'
import { Section } from '@/components/layout/section'
import { Link, NewTabHint } from '@/components/ui/link'
import type { SectionOf } from '@/lib/home/resolve'

/**
 * The quiet band of promises. Plan §10.1a's *"Promotional strip"*.
 *
 * Two hairline rules and evenly divided Meta-sized statements — guide §06: *"Dividers: 1px, low
 * contrast, used to structure space, never used as decorative noise."* There is no fill, no icon and
 * no colour, because a promotional band that shouts is the *"nothing should feel promotional unless
 * the design intentionally calls for it"* of guide §01 being ignored.
 *
 * It **is** a list, and the markup says so: these are two to four peer statements, which is exactly
 * what `<ul>` means, and a screen reader announcing "list, 3 items" before them is more useful than
 * three unannounced sentences. (An earlier version of this comment claimed the opposite of the
 * markup directly beneath it — the kind of drift Phase 10's audit went looking for.)
 */
export function PromoStrip({ section }: { section: SectionOf<'promoStrip'> }) {
  return (
    <Section spacing="tight" divider="top" data-section="promo-strip">
      <PageContainer>
        <ul className="grid gap-m sm:grid-cols-2 lg:grid-cols-4">
          {section.items.map((item, index) => (
            <li key={index} className="font-sans text-meta uppercase text-foreground-muted">
              {item.link ? (
                <Link href={item.link.href} variant="meta" external={item.link.external}>
                  {item.text}
                  {item.link.external ? <NewTabHint /> : null}
                </Link>
              ) : (
                item.text
              )}
            </li>
          ))}
        </ul>
      </PageContainer>
    </Section>
  )
}
