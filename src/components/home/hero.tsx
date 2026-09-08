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
 * ### The statement is set over the photograph — DEV-44, revised again
 *
 * The picture runs edge to edge and the statement sits over its right half, which is the composition
 * the project owner asked for. Of DEV-44's three arguments, two still hold and one is now a cost
 * paid on purpose:
 *
 * 1. **Guide §10 opens its responsive priority list with *"Preserve headline hierarchy."*** Below
 *    768px nothing is overlaid at all — the statement returns beneath the frame on `canvas`, so the
 *    320px case is the stacked one DEV-44 built. 768px is also the width `MediaImage` switches
 *    *geometry* on, so the layout and the crop change at the same place rather than leaving a band
 *    of widths between them.
 * 2. **Guide §11 lists *"Excessive gradients"* under Avoid — and there is now a scrim.** This is the
 *    concession. Bone over a bright sky is illegible without one, and the composition was chosen
 *    knowing that. It is held to the minimum that works: 88% at the very edge rather than opaque,
 *    because a solid edge would undo the edge-to-edge picture it is drawn over, and gone entirely by
 *    70% of the width — well clear of the subject. Rendered only where the type is, and only above
 *    768px.
 * 3. **§10.1b's *"Text too long for selected crop"* stays impossible by construction.** The copy is
 *    in a measured column whose length is bounded by the measure rather than by the picture.
 *
 * **The statement is on the right because the subject is on the left.** The frame this was built for
 * is a 2.5:1 panorama with the model in its left third; left-aligned type would have been set on his
 * face. `heroWide` is 5:2 rather than 16:9 for the same reason — a 16:9 crop cuts both ends off a
 * photograph chosen for its width. An editor who uploads a frame composed the other way round should
 * move the statement with it, and that is a code change rather than a setting, which is honest about
 * what it is.
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
        One full-bleed band. The picture is the band; the statement is set over it, held to the right
        because that is the half of this photograph the subject is not standing in.

        Source order is the mobile order — frame, then statement — and it is the order that has to be
        right without a media query. At `md` the statement is lifted out of flow and placed over the
        picture, which is the only point at which any of this becomes an overlay.
      */}
      <div className="relative mx-auto w-full max-w-page md:min-h-[clamp(26rem,40vw,38rem)]">
        <MediaImage
          media={section.media}
          mobileMedia={section.mobileMedia}
          context="heroWide"
          mobileContext="heroMobile"
          sizes={HOME_IMAGE_SIZES.heroWide}
          priority={section.lcp}
          className="md:absolute md:inset-0 md:h-full md:aspect-auto"
        />

        {/*
          **The one gradient in this project, and it is here under protest.**

          Guide §11 lists *"excessive gradients"* under Avoid, and DEV-44 spent three arguments not
          needing one. A statement set over a photograph needs a scrim or it is illegible over a
          bright sky, and this composition was chosen deliberately with that cost understood.

          It is kept to the minimum that does the job: opaque only at the very edge, gone by 62% of
          the width, and present only where the type is. Below `md` the statement is not over the
          picture at all, so the scrim is not rendered.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden bg-gradient-to-l from-canvas/88 from-0% via-canvas/62 via-42% to-transparent to-70% md:block"
        />

        <div className="md:absolute md:inset-y-0 md:right-0 md:flex md:w-[54%] md:items-center">
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
