import {
  EditorialTextSection,
  FigureSection,
  ShopTheLookSection,
  SplitFeatureSection,
} from '@/components/editorial/editorial-blocks'
import { Reveal } from '@/components/editorial/reveal'
import { CategoryTiles } from '@/components/home/category-tiles'
import { CollectionFeature } from '@/components/home/collection-feature'
import { Hero } from '@/components/home/hero'
import { ProductRail } from '@/components/home/product-rail'
import { PromoStrip } from '@/components/home/promo-strip'
import { SocialGallery } from '@/components/home/social-gallery'
import type { HomeSection } from '@/lib/home/resolve'

/**
 * **The block dispatcher.** Plan §10.1a's *"reorderable, typed blocks"*, on the render side.
 *
 * Every component below is a **server component**. Only the `Reveal` wrapper is a client component,
 * and it takes its subtree as `children` — a prop — so nothing inside it crosses the boundary.
 * Together with the newsletter form in the footer, that is two client components on the entire
 * homepage, which is §30.1c's *"avoid unnecessary client components"* taken literally.
 *
 * ### The LCP section is never wrapped in `Reveal`
 *
 * Fading in the largest contentful paint would be a self-inflicted LCP regression on the one route
 * plan §37 measures — and the resolver has already identified which section that is, so this needs
 * no guesswork. Everything after it reveals; it does not.
 */
export function HomeSections({ sections }: { sections: HomeSection[] }) {
  return sections.map((section) =>
    section.lcp ? (
      <SectionBody key={section.key} section={section} />
    ) : (
      <Reveal key={section.key}>
        <SectionBody section={section} />
      </Reveal>
    ),
  )
}

/**
 * One section.
 *
 * The `switch` is **exhaustive at compile time**: `unhandledSection` takes `never`, so adding a
 * block to `blocks/home.ts` and to the resolver without adding a case here fails `tsc`. That is the
 * only mechanism that keeps three lists — the schema, the resolver and this file — in step, and it
 * is the same argument `RAIL_FLAG` makes for being a `Record` over a union.
 *
 * It deliberately does **not** throw in the default branch. One unrecognised block — a row written
 * by a newer deployment, a rollback caught mid-migration — must cost that section and not the
 * homepage.
 */
function SectionBody({ section }: { section: HomeSection }) {
  switch (section.type) {
    case 'hero':
      return <Hero section={section} />
    case 'promoStrip':
      return <PromoStrip section={section} />
    case 'categoryTiles':
      return <CategoryTiles section={section} />
    case 'productRail':
      return <ProductRail section={section} />
    case 'collectionFeature':
      return <CollectionFeature section={section} />
    case 'socialGallery':
      return <SocialGallery section={section} />
    case 'figure':
      return <FigureSection section={section} />
    case 'splitFeature':
      return <SplitFeatureSection section={section} />
    case 'editorial':
      return <EditorialTextSection section={section} />
    case 'shopTheLook':
      return <ShopTheLookSection section={section} />
    default:
      return unhandledSection(section)
  }
}

/**
 * Compile-time exhaustiveness, runtime silence.
 *
 * A `const _exhaustive: never = section` sentinel would have done the same job and would not
 * compile here — `noUnusedLocals` is on and TypeScript does not exempt an underscore prefix. A
 * function parameter is the form that works.
 */
function unhandledSection(section: never): null {
  console.error('[home] Unhandled section type', (section as { type?: unknown })?.type)

  return null
}
