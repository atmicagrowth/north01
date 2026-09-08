import { Prose } from '@/components/editorial/prose'
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
 * ### The composition is split, and still no type sits over the photograph — DEV-44, revised
 *
 * The statement occupies the left of the grid and the campaign frame the right, both inside one
 * band. This is the composition the visual reference draws, asked for by the project owner, and it
 * arrives *without* conceding the three reasons DEV-44 originally stacked the two:
 *
 * 1. **Guide §10 opens its responsive priority list with *"Preserve headline hierarchy."*** Below
 *    `lg` the grid collapses and the frame goes back above the statement, so the 320px case is the
 *    stacked one it always was. Display XL never has to compete with a photograph for width. The
 *    breakpoint is 768px because that is the one `MediaImage` already switches *geometry* on, and a
 *    layout that split at a different width than the frame re-crops at would have spent the band
 *    between them showing an upright crop across the whole viewport.
 * 2. **Guide §11 lists *"Excessive gradients"* under Avoid.** There is still no scrim, because the
 *    type is not over the picture — it is beside it, on `canvas`, at the palette's own 17.10:1.
 *    Whatever an editor uploads next season, the headline's contrast is unchanged.
 * 3. **§10.1b's *"Text too long for selected crop"* stays impossible by construction.** The copy is
 *    in a measured column whose length is bounded by the measure rather than by the crop.
 *
 * What the split does change is the frame's *shape*: `heroSplit` is upright, because a 16:9 crop in
 * a two-fifths column is a letterbox. The band also carries a desktop minimum height, so a campaign
 * with a short headline still reads as a hero rather than as a strip.
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
      {/*
        One band, two cells, and the page's own max width — so the statement's left gutter lines up
        with every section below it. Full-bleed to the viewport would put the headline out of step
        with the rest of the page at any width past `max-w-page`, which reads as a bug rather than
        as a composition.

        The frame is written first so that it is *above* the statement once the grid collapses, and
        `order` moves it to the right on desktop. Source order is the mobile order; that is the one
        that has to be right without a media query.
      */}
      <div className="mx-auto grid w-full max-w-page md:min-h-[clamp(30rem,44vw,44rem)] md:grid-cols-[minmax(0,1fr)_minmax(0,44%)]">
        <div className="md:order-2">
          {/*
            The reserved frame is what stops the band shifting, so it stays exactly as it is below
            `lg`. Above it the cell's height is the band's and the picture fills it — `aspect-auto`
            hands geometry to the grid at precisely the breakpoint the layout changes.
          */}
          <MediaImage
            media={section.media}
            mobileMedia={section.mobileMedia}
            context="heroSplit"
            mobileContext="heroMobile"
            sizes={HOME_IMAGE_SIZES.heroSplit}
            priority={section.lcp}
            className="md:h-full md:aspect-auto"
          />
        </div>

        <div className="flex items-center md:order-1">
          <div className="w-full px-[clamp(1.25rem,4vw,4rem)] py-l md:py-xl">
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
        </div>
      </div>
    </Section>
  )
}
