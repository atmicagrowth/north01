import { ProductTile } from '@/components/home/product-tile'
import { PageContainer } from '@/components/layout/page-container'
import { Section, SectionHeading } from '@/components/layout/section'
import { Link, NewTabHint } from '@/components/ui/link'
import { cn } from '@/lib/cn'
import type { SectionOf } from '@/lib/home/resolve'

/**
 * **The product interruption.** Visual guide §09: *"Product areas should feel like interruptions in
 * a fashion story, not the entire page."*
 *
 * One component for both product blocks. `productRail` is a **query** — "New arrivals" stays true
 * without an editor re-curating it — and `productGroup` is a **curation**, a dragged list whose
 * order is the merchandising decision. The resolver normalises both to `{ heading, intro, layout,
 * cta, products }`, so there is one renderer rather than two that drift.
 *
 * ### The horizontal rail is keyboard-operable, and that is not optional
 *
 * A `overflow-x-auto` container holds content a keyboard user must be able to reach. Without
 * `tabIndex={0}` the region is scrollable by pointer and by nothing else — **WCAG 2.1.1 (Keyboard),
 * Level A**. Browsers do focus a scrollable box natively in some cases, but not reliably across the
 * ones this project tests, so it is declared. `role="group"` plus `aria-label` is what stops that
 * focus stop being an unlabelled mystery when it receives focus.
 *
 * This is the single most likely accessibility miss in the phase and axe-core does **not** catch it:
 * a static tree cannot tell that a `div` scrolls.
 *
 * The grid layout has no such wrapper — it is a plain list, and every tile is already a tab stop.
 *
 * ### `snap-x` and no scrollbar hiding
 *
 * Scroll snapping makes the rail settle on a tile rather than mid-garment. The scrollbar is left
 * alone: hiding it removes the only affordance that tells a pointer user the row continues, and
 * guide §11's restraint is about decoration, not about removing controls.
 */
export function ProductRail({ section }: { section: SectionOf<'productRail'> }) {
  const isRail = section.layout === 'rail'

  const tiles = section.products.map((product, index) => (
    <li
      key={product.id}
      className={cn(isRail && 'w-[72vw] shrink-0 snap-start sm:w-[40vw] lg:w-[22vw]')}
    >
      <ProductTile
        product={product}
        layout={section.layout}
        // At most one image on the whole page is eager, and only when this section is the LCP.
        priority={section.lcp && index === 0}
      />
    </li>
  ))

  return (
    <Section data-section="product-rail">
      <PageContainer>
        {/*
          `SectionHeading` always renders its tag, so passing it an absent heading emitted an
          **empty `<h2>`** — a real axe `empty-heading` violation, reachable simply by an editor
          adding a "View all" link and no title. The 0-violation sweep missed it because the seeded
          composition happens to give every rail a heading. Found by Phase 10's audit.
        */}
        {section.heading ? (
          <SectionHeading
            className="mb-l"
            action={
              section.cta ? (
                <Link href={section.cta.href} variant="meta" external={section.cta.external}>
                  {section.cta.label}
                  {section.cta.external ? <NewTabHint /> : null}
                </Link>
              ) : undefined
            }
          >
            {section.heading}
          </SectionHeading>
        ) : section.cta ? (
          <div className="mb-l flex justify-end">
            <Link href={section.cta.href} variant="meta" external={section.cta.external}>
              {section.cta.label}
              {section.cta.external ? <NewTabHint /> : null}
            </Link>
          </div>
        ) : null}

        {section.intro ? (
          <p className="mb-l max-w-measure font-sans text-body text-foreground-muted">
            {section.intro}
          </p>
        ) : null}
      </PageContainer>

      {isRail ? (
        /*
         * Full-bleed on purpose: the rail runs to the edge of the viewport so the next tile is
         * visibly cut, which is what tells a reader it scrolls. The left inset matches the page
         * gutter so the first tile still aligns with everything above it.
         */
        <div
          tabIndex={0}
          role="group"
          aria-label={section.heading ? `${section.heading} — scrollable` : 'Products — scrollable'}
          /*
            `snap-x` belongs on the SCROLLER, not on the list inside it — on a non-scrolling `<ul>`
            it is inert, so the snapping the docblock describes did nothing until Phase 10's audit
            measured it. The `-my-1 py-1` gives the focus ring vertical room: without it
            `overflow-x-auto` clipped the ring to two disconnected vertical bars.
          */
          className="-my-1 snap-x overflow-x-auto py-1 focus-visible:outline-offset-4"
        >
          <ul className="flex gap-m px-[clamp(1.25rem,4vw,4rem)] lg:gap-l">{tiles}</ul>
        </div>
      ) : (
        <PageContainer>
          <ul className="grid grid-cols-2 gap-m lg:grid-cols-4 lg:gap-l">{tiles}</ul>
        </PageContainer>
      )}
    </Section>
  )
}
