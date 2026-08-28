import { Prose } from '@/components/editorial/prose'
import { EditorialBlock } from '@/components/layout/editorial-block'
import { PageContainer } from '@/components/layout/page-container'
import { Section } from '@/components/layout/section'
import { MediaImage } from '@/components/media/media-image'
import { Link, NewTabHint } from '@/components/ui/link'
import { cn } from '@/lib/cn'
import { HOME_IMAGE_SIZES } from '@/lib/home/sizes'
import type { HomeCta, SectionOf } from '@/lib/home/resolve'

/**
 * **The four editorial blocks, rendered.**
 *
 * These live in `components/editorial/` rather than `components/home/` because the same block
 * definitions are already wired into `collections.body` and `edits.body` (Phase 6), and **Phase 23**
 * builds the pages that render them. Phase 10 owns the content of these components; the directory
 * says who else will need them.
 *
 * Visual guide §09 for Home: *"Editorial blocks alternating between image-led and typography-led
 * sections. Strong visual pacing from section to section."* `splitFeature` and `figure` are the
 * image-led half, `editorial` the typography-led one, and `shopTheLook` is the bridge from the story
 * to the merchandise.
 *
 * `EditorialBlock` — the Phase 3 layout primitive — supplies the asymmetry. Its docblock reserved
 * this exact use: *"Phase 10 builds the homepage block system on top of this — that phase owns the
 * content, this one owns the proportions."* The ratios are 7:5, never 6:6, and on mobile the media
 * always leads regardless of desktop side.
 */

/** The shared call-to-action treatment: a quiet Meta link with a rule, never a third button style. */
function Cta({ cta }: { cta: HomeCta }) {
  return (
    <Link href={cta.href} variant="meta" external={cta.external} className="mt-s inline-block">
      {cta.label}
      {cta.external ? <NewTabHint /> : null}
    </Link>
  )
}

/**
 * A photograph given room. Guide §09's *"occasional full-bleed moments"* — the `fullBleed` treatment
 * is deliberately the non-default, because occasional is the instruction.
 *
 * The caption is a real `<figcaption>` inside a real `<figure>`, which is what makes it a caption
 * to assistive technology rather than a stray paragraph that happens to sit underneath.
 */
export function FigureSection({ section }: { section: SectionOf<'figure'> }) {
  const fullBleed = section.treatment === 'fullBleed'

  const figure = (
    <figure>
      <MediaImage
        media={section.media}
        mobileMedia={section.mobileMedia}
        context="editorial"
        // A full-bleed frame gets an upright mobile crop; a contained one keeps its own proportions.
        mobileContext={fullBleed ? 'heroMobile' : undefined}
        sizes={fullBleed ? HOME_IMAGE_SIZES.figureFullBleed : HOME_IMAGE_SIZES.figureContained}
        priority={section.lcp}
      />

      {section.caption || section.cta ? (
        <figcaption
          className={cn(
            'mt-s font-sans text-body-sm text-foreground-muted',
            fullBleed && 'px-[clamp(1.25rem,4vw,4rem)]',
          )}
        >
          {section.caption}
          {section.cta ? (
            <span className="ml-m">
              <Cta cta={section.cta} />
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  )

  return (
    <Section spacing={fullBleed ? 'none' : 'default'} data-section="figure">
      {fullBleed ? figure : <PageContainer>{figure}</PageContainer>}
    </Section>
  )
}

/**
 * Image beside text — plan §10.1a's *"Editorial split"*, and also its *"Brand story"*. **DEV-43**:
 * they are one shape, and the difference between them is what an editor writes, not what the schema
 * holds.
 */
export function SplitFeatureSection({ section }: { section: SectionOf<'splitFeature'> }) {
  return (
    <Section data-section="split-feature">
      <PageContainer>
        <EditorialBlock
          layout={section.imageSide === 'right' ? 'media-end' : 'media-start'}
          media={
            <MediaImage
              media={section.media}
              context="editorial"
              sizes={HOME_IMAGE_SIZES.splitFeature}
              priority={section.lcp}
            />
          }
        >
          {section.eyebrow ? (
            <p className="font-sans text-meta uppercase text-foreground-muted">{section.eyebrow}</p>
          ) : null}

          {section.heading ? (
            <h2 className="font-display text-heading-m text-balance">{section.heading}</h2>
          ) : null}

          <Prose value={section.body} />

          {section.cta ? <Cta cta={section.cta} /> : null}
        </EditorialBlock>
      </PageContainer>
    </Section>
  )
}

/**
 * The typography-led section — no image at all.
 *
 * `width` is the block's one compositional option: a narrow measure reads, a full measure makes a
 * statement. Guide §04 asks for *"narrow text columns"* against *"full-bleed imagery"*, and this is
 * the narrow half of that tension.
 */
export function EditorialTextSection({ section }: { section: SectionOf<'editorial'> }) {
  return (
    <Section data-section="editorial">
      <PageContainer width={section.width === 'wide' ? 'page' : 'measure'}>
        {section.eyebrow ? (
          <p className="font-sans text-meta uppercase text-foreground-muted">{section.eyebrow}</p>
        ) : null}

        {section.heading ? (
          <h2
            className={cn(
              'mt-s font-display text-balance',
              section.width === 'wide' ? 'text-display-l' : 'text-heading-m',
            )}
          >
            {section.heading}
          </h2>
        ) : null}

        <Prose value={section.body} className="mt-m" />

        {section.cta ? <Cta cta={section.cta} /> : null}
      </PageContainer>
    </Section>
  )
}

/**
 * **Shop the look.** Structure §4 path C — *Home → Campaign → Lookbook → Shop the Look → Product* —
 * and the editorial-to-commerce bridge §10.1c asks every editorial block to have.
 *
 * ### The image context is `editorial`, and it is not a style choice
 *
 * `lib/media/cloudinary-url.ts` states the rule outright: hotspot positions are *"percentages, so
 * they survive every crop and breakpoint"* — but only while the delivered image has the framing the
 * editor placed them on. *"Any surface carrying hotspots must use"* the uncropped context, because a
 * `c_fill` would move every marker off its garment. That is why there is no `mobileContext` here
 * either; the mobile coordinates re-position the markers on the *same* frame.
 *
 * ### What a hotspot is in Phase 10, and what it is not
 *
 * It is **a link to the product**, positioned over the photograph. Plan §22.1c's behaviour — tap to
 * open a product preview, "add the entire look" — belongs to **Phase 22**, and the preview needs a
 * PDP (Phase 13) and a cart (Phase 14) to be worth opening. A marker that opened an empty dialog
 * would be §0.1.17's fake control.
 *
 * So each marker is an anchor with a real accessible name — the product's name and price, visually
 * hidden — which means the whole look is operable by keyboard today and reads correctly to a screen
 * reader, rather than being a decorative dot that only a mouse can use.
 *
 * The markers are positioned with inline `style` because the coordinates are per-hotspot data, not
 * design tokens; Tailwind cannot express an arbitrary runtime percentage without generating a class
 * per value. The two coordinate pairs are switched by a custom property at the same 768px breakpoint
 * the rest of the system uses.
 */
export function ShopTheLookSection({ section }: { section: SectionOf<'shopTheLook'> }) {
  return (
    <Section data-section="shop-the-look">
      <PageContainer>
        {section.heading ? (
          <h2 className="mb-l font-display text-heading-m text-balance">{section.heading}</h2>
        ) : null}

        <div className="relative">
          <MediaImage
            media={section.media}
            context="editorial"
            sizes={HOME_IMAGE_SIZES.shopTheLook}
            priority={section.lcp}
          />

          {section.hotspots.map((hotspot, index) => (
            <Link
              key={index}
              href={hotspot.product.href}
              variant="unstyled"
              className={cn(
                'absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full',
                'left-[var(--x-mobile)] top-[var(--y-mobile)]',
                'md:left-[var(--x)] md:top-[var(--y)]',
                'transition-transform duration-(--duration-base) ease-entrance hover:scale-110',
                hotspot.tone === 'dark'
                  ? 'bg-canvas/80 text-foreground ring-1 ring-foreground/30'
                  : 'bg-foreground/85 text-canvas ring-1 ring-canvas/20',
              )}
              style={
                {
                  '--x': `${hotspot.x}%`,
                  '--y': `${hotspot.y}%`,
                  '--x-mobile': `${hotspot.xMobile}%`,
                  '--y-mobile': `${hotspot.yMobile}%`,
                } as React.CSSProperties
              }
            >
              {/* A plus, drawn rather than iconised — guide §06's "simple geometry, small footprint". */}
              <span aria-hidden className="text-body-sm leading-none">
                +
              </span>

              <span className="sr-only">
                {hotspot.label ?? hotspot.product.name} — {hotspot.product.priceLabel}
              </span>
            </Link>
          ))}
        </div>
      </PageContainer>
    </Section>
  )
}
