import { Prose } from '@/components/editorial/prose'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { MediaImage } from '@/components/media/media-image'
import { Button } from '@/components/ui/button'
import { Link, NewTabHint } from '@/components/ui/link'
import { HOME_IMAGE_SIZES } from '@/lib/home/sizes'
import type { SectionOf } from '@/lib/home/resolve'

/**
 * **The campaign hero.** Plan §10.1b, visual guide §09: *"Hero-first composition. Large campaign
 * statement."*
 *
 * ### The composition is stacked, and no type sits over the photograph — DEV-44
 *
 * Full-bleed media, then the campaign statement beneath it on the canvas, strongly left-aligned.
 * Three reasons, in the order they decided it:
 *
 * 1. **Guide §10's responsive priority list opens with *"Preserve headline hierarchy"***, and an
 *    overlay is the first thing that breaks at 320px — the headline either shrinks out of its own
 *    type scale or covers the subject of the photograph.
 * 2. **Guide §11 lists *"Excessive gradients"* under Avoid**, and legible type over *arbitrary*
 *    campaign photography needs a scrim or a gradient. A crop an art director controls can carry
 *    text; a crop an editor uploads next season cannot be relied on to.
 * 3. **It removes §10.1b's *"Text too long for selected crop"* edge case by construction** rather
 *    than by hoping. The copy lives in a measured column on `canvas`, so its contrast is the
 *    palette's own 17.10:1 at every breakpoint and its length is bounded by the measure, not by the
 *    picture.
 *
 * The result is still unmistakably a hero: a full-bleed campaign frame followed by Display XL in
 * Bone on Obsidian is guide §01's *"high-contrast black surfaces with soft bone typography"* and
 * §01's *"visual tension — oversized type with tiny metadata"*, which the season eyebrow supplies.
 *
 * ### Everything here comes from the campaign document
 *
 * The `hero` block holds one field, a reference. Title, season, story, both images and both calls to
 * action are the campaign's own, so an editor who updates the campaign updates the homepage — see
 * `blocks/home.ts`.
 *
 * ### The one prioritised image on the page
 *
 * `priority` is passed through from the resolver's `lcp` flag, and the resolver sets it on exactly
 * one section. Plan §10.1d: *"Proper priority only for the main hero/LCP image."* Note the hero is
 * usually but **not always** that section — a homepage that opens with a promise strip has its LCP
 * further down, which is why the flag is computed from the content rather than from the position.
 *
 * ### Art direction
 *
 * `mobileMedia` is `campaign.mobileHero`, a genuinely different photograph for the phone; when it is
 * absent `MediaImage` re-crops the desktop asset to 4:5, which is §10.1b's *"Mobile image omitted:
 * use safe fallback"*. Both boxes are reserved before any byte arrives, so neither path shifts.
 *
 * **There is no video**, here or on `Campaigns` — **DEV-41**. §30.1c forbids autoplaying video on
 * exactly this route, Payload probes no dimensions from a video container so the frame could not be
 * reserved, and §10.1b's *"Video unavailable: image fallback"* is satisfied permanently by the image
 * being the hero.
 */
export function Hero({ section }: { section: SectionOf<'hero'> }) {
  const ctas = [section.primary, section.secondary].filter((cta) => cta !== null)

  return (
    <Section spacing="none" data-section="hero">
      <MediaImage
        media={section.media}
        mobileMedia={section.mobileMedia}
        context="heroDesktop"
        mobileContext="heroMobile"
        sizes={HOME_IMAGE_SIZES.hero}
        priority={section.lcp}
      />

      <PageContainer>
        <div className="py-l lg:py-xl">
          {/*
            `as` comes from the resolver, which demotes every hero after the first. A component
            cannot know how many siblings it has, and an editor may add a second campaign hero.
          */}
          <PageTitle eyebrow={section.season} size="display-xl" as={section.headingLevel}>
            {section.headline}
          </PageTitle>

          {section.story ? (
            <Prose value={section.story} tone="lede" className="mt-m max-w-measure" />
          ) : null}

          {/*
            No buttons at all is a legitimate state — §10.1b's "CTA omitted", and a campaign is a
            statement before it is a route. The navigation above still offers every destination.
          */}
          {ctas.length > 0 ? (
            <div className="mt-l flex flex-wrap items-center gap-s">
              {ctas.map((cta, index) => (
                <Button
                  key={`${cta.href}-${index}`}
                  asChild
                  // One strong fill per page — guide §06's "restrained fills". The second is outline.
                  variant={index === 0 ? 'primary' : 'secondary'}
                  size="lg"
                >
                  {/*
                    `variant="unstyled"` is mandatory inside `Button asChild`: Radix's Slot
                    concatenates class strings without running tailwind-merge, so a styled Link
                    would fight the button's own classes and the winner would be stylesheet order.
                  */}
                  <Link href={cta.href} variant="unstyled" external={cta.external}>
                    {cta.label}
                    {cta.external ? <NewTabHint /> : null}
                  </Link>
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </PageContainer>
    </Section>
  )
}
