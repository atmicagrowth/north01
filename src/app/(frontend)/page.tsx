import { HomeSections } from '@/components/home/home-sections'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { getHome } from '@/lib/home/home'

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
 * ### No metadata export, on purpose
 *
 * The layout's title template already resolves the homepage to `NORTH / 01`. A page-level `title`
 * string here would render *"NORTH / 01 · NORTH / 01"* through that template, and a page-level
 * `openGraph` **replaces** rather than merges with the layout's. Titles, descriptions, canonicals,
 * OG images and structured data are **Phase 24**'s system, and `site-settings` already holds the
 * `defaultSeoTitle`, `defaultSeoDescription` and `defaultOgImage` fields it will read.
 *
 * (The Phase 3 placeholder that stood here exported `title: 'Foundation'`. Deleting it, rather than
 * replacing it, is the correct change.)
 *
 * ### No Suspense, no skeleton, no `loading.tsx`
 *
 * §10.1d asks for *"skeletons for asynchronous product data **where needed**"*, and here it is not.
 * This route is **statically prerendered** — every query resolves at build time and the HTML is
 * complete before a visitor exists — and all of the reads happen inside one cached loader, so there
 * is no second async boundary for a `<Suspense>` to sit on. A `loading.tsx` would be actively
 * harmful: Next's own streaming documentation notes that an LCP element inside a Suspense boundary
 * cannot paint until the boundary resolves, which would put the hero behind a full-page skeleton and
 * defeat §10.1d's own priority requirement.
 *
 * The absence is a decision, not an oversight. Phase 11's shop page has real filter-driven streaming
 * and is where `Skeleton` earns its place.
 *
 * ### Two states that are not errors
 *
 * An **empty** homepage — no sections, or every section dropped because its subject was unpublished
 * — and a **degraded** one, where the global could not be read at all, both render the brand and the
 * tagline and nothing else. Plan §31: *"never display a generic blank page when a known business
 * state can be communicated clearly."* There is no apology and no "coming soon": an unconfigured
 * store legitimately looks like this, and the header and footer still offer every route.
 *
 * `degraded` is **never rendered**. It exists so an operator, and `verify-home.ts`, can tell a
 * database failure from an editor who emptied the page — which are identical on screen and could not
 * be more different in a log. Same contract as `Shell.degraded`.
 */
export default async function HomePage() {
  const { content, siteName } = await getHome()

  if (content.sections.length === 0) {
    return (
      <Section spacing="loose">
        <PageContainer width="narrow">
          <PageTitle size="display-xl">{siteName}</PageTitle>
        </PageContainer>
      </Section>
    )
  }

  return (
    <>
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
