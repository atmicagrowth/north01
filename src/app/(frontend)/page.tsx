import type { Metadata } from 'next'

import { HomeSections } from '@/components/home/home-sections'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { JsonLd } from '@/components/seo/json-ld'
import { getHome } from '@/lib/home/home'
import { absoluteImageUrl } from '@/lib/seo/metadata'
import { getSeoDefaults, getSiteUrl, pageMetadata } from '@/lib/seo/site'
import { organisationStructuredData } from '@/lib/seo/structured-data'

/**
 * **The homepage.** Plan §10 — a CMS-driven editorial commerce page.
 *
 * Every section on this page comes from the `homepage` global, in the order an editor arranged it.
 * Nothing below hard-codes a product, a campaign or a heading, which is the §10 prompt's explicit
 * requirement: *"Do not hard-code production-like product content into React components."*
 *
 * ### What this route deliberately does not declare
 *
 * No `<main>`, no `<header>` or `<footer>` landmark, no skip link, no overlay provider, no second
 * wordmark. The storefront root layout owns all of it, and its own docblock states the contract:
 * *"`<main id="main-content">` is declared exactly once, by this layout."* Phase 3's audit found the
 * two-`<h1>` version of this mistake on the design-system page, and Phase 9 found the second-`<main>`
 * version; this page reproduces neither.
 *
 * ### Metadata arrived in Phase 24, and it had to be absolute
 *
 * There was no metadata export here at all, on purpose: the layout's title template resolves `%s` to
 * *"… · NORTH / 01"*, so a page-level `title` string on the homepage renders *"NORTH / 01 · NORTH /
 * 01"*. The old note recorded that trap and answered it by exporting nothing — which also cost the
 * page its canonical URL and its Open Graph card, on the one route most likely to be shared.
 *
 * `absoluteTitle` is the answer instead: `title: { absolute: … }` bypasses the template, and
 * everything else — description, canonical, OG, Twitter — is built from `site-settings`, whose
 * `defaultSeoTitle`, `defaultSeoDescription` and `defaultOgImage` fields had never been read by
 * anything until this phase.
 *
 * ### No Suspense, no skeleton, no `loading.tsx`
 *
 * §10.1d asks for *"skeletons for asynchronous product data **where needed**"*, and here it is not.
 * All of the reads happen inside one cached loader, so there is no second async boundary for a
 * `<Suspense>` to sit on, and `getHome` is `unstable_cache`d — the render waits on a cache entry,
 * not on a query.
 *
 * (This paragraph used to say the route was *statically prerendered*. It is not, and has not been
 * since Phase 9: the storefront layout awaits `cookies()` through `getCustomer()` for the header's
 * bag badge, which makes every route beneath it dynamic. The caching argument below still holds —
 * it rests on the **data** cache, which is what `unstable_cache` and the 300-second revalidate
 * actually control — but the claim about prerendering was stale and is corrected rather than
 * repeated.) A `loading.tsx` would be actively
 * harmful: Next's own streaming documentation notes that an LCP element inside a Suspense boundary
 * cannot paint until the boundary resolves, which would put the hero behind a full-page skeleton and
 * defeat §10.1d's own priority requirement.
 *
 * The absence is a decision, not an oversight. Phase 11's shop page has real filter-driven streaming
 * and is where `Skeleton` earns its place.
 *
 * ### An empty homepage renders; a broken one does not
 *
 * These are two different states and Phase 10's audit found that treating them alike was a real
 * defect.
 *
 * **Empty** — no sections, or every section dropped because its subject was unpublished — renders
 * the brand and nothing else. Plan §31: *"never display a generic blank page when a known business
 * state can be communicated clearly."* There is no apology and no "coming soon": an unconfigured
 * store legitimately looks like this, and the header and footer still offer every route.
 *
 * **Degraded** — the homepage global could not be read at all — **throws**, and that is the whole
 * point of the flag. The homepage read is cached for 300 seconds, so a refresh of that entry runs
 * this loader and stores whatever comes back. Returning a valid empty homepage would therefore have
 * written **an empty page into the cache**, replacing the good content for five minutes and
 * outliving the database blip that caused it. Throwing fails the refresh, and the last good entry
 * keeps being served.
 *
 * At build time the same throw fails `pnpm build`, which decision **D-32** already names as the
 * correct behaviour: *"a deploy against a broken database fails loudly rather than silently baking a
 * fallback site."*
 *
 * (Phase 31 owns error states as a system. Until then this is Next's own error boundary, which is a
 * correct 500 rather than a convincing blank page.)
 */
export async function generateMetadata(): Promise<Metadata> {
  const defaults = await getSeoDefaults()

  return pageMetadata({
    absoluteTitle: true,
    description: defaults.description,
    image: defaults.ogImage,
    path: '/',
    title: defaults.title ?? defaults.siteName,
  })
}

export default async function HomePage() {
  const { content, siteName } = await getHome()

  /*
   * The shop itself, once, on the front page — and deliberately minimal. Every extra field an
   * `Organization` can declare is a claim, and this shop is online-only with no address, no hours
   * and no telephone number established. An empty `address` would be the structured-data version of
   * the store locator `AGENTS.md` forbids.
   */
  const defaults = await getSeoDefaults()
  const siteUrl = getSiteUrl()

  const organisation = (
    <JsonLd
      data={organisationStructuredData({
        logo: absoluteImageUrl(siteUrl, defaults.logo?.url),
        name: defaults.siteName,
        siteUrl,
      })}
    />
  )

  if (content.degraded) {
    throw new Error(
      'The homepage could not be read. Refusing to render an empty page that would be cached in its place.',
    )
  }

  if (content.sections.length === 0) {
    return (
      <>
        {organisation}

        <Section spacing="loose">
          <PageContainer width="narrow">
            <PageTitle size="display-xl">{siteName}</PageTitle>
          </PageContainer>
        </Section>
      </>
    )
  }

  return (
    <>
      {organisation}

      {/*
        The document needs exactly one `<h1>`. A surviving hero carries it; when none did — an
        editor's composition that opens with a collection feature, or a campaign that was
        unpublished this morning — this supplies one, so the outline stays valid in every reachable
        state rather than only in the expected one.
      */}
      {content.hasHeading ? null : <h1 className="sr-only">{siteName}</h1>}

      <HomeSections sections={content.sections} />
    </>
  )
}
