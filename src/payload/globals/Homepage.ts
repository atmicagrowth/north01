import type { GlobalConfig } from 'payload'

import { anyone, isStaff } from '../access'
import { homeBlocks } from '../blocks/home'
import { revalidateGlobal } from '../hooks/revalidateTags'

/**
 * What each section needs in order to appear on the page — one sentence per block, in the order the
 * block picker offers them, naming each block by the label the picker shows.
 *
 * Assembled from an array purely so it stays readable in source; Payload renders it as one
 * paragraph under the field.
 */
const SECTION_GUIDE = [
  'The order here is the order on the page — drag to rearrange.',
  'Structure §4 composes it as: hero, categories, new arrivals, an editorial moment, best sellers or limited edition, the brand story, community.',
  'A section with nothing to show is left off the page rather than rendered half-empty, and nothing warns you when you save — so open the homepage afterwards and check that everything you expected is there.',
  'What each section needs in order to appear:',
  'CAMPAIGN HERO — a campaign that is published, has a title and is not dated in the future. It will still appear with no picture; the space is held rather than collapsed.',
  'PROMISE STRIP — at least one statement with words in it.',
  'CATEGORY TILES — at least one tile whose category is published. Tiles whose category is a draft or has been deleted drop out one by one; when the last one goes, so does the section.',
  'PRODUCT RAIL — at least one published product carrying the flag this rail is set to. Sold out is fine and still shows; a product with no active variant has no price and is skipped.',
  'PRODUCT GROUP — the same rule, among the products you picked.',
  'IMAGE — a picture.',
  'IMAGE AND TEXT — a picture, and either a heading or some body text.',
  'SHOP THE LOOK — a picture, and at least one hotspot that is both placed on the image and pointed at a published product.',
  'EDITORIAL TEXT — a heading or some body text. Deleting the text leaves an empty paragraph behind, which does not count as text.',
  'COLLECTION FEATURE — a collection that is published and has a title.',
  'COMMUNITY GALLERY — at least one entry with a picture. The credit alone is not enough.',
].join(' ')

/**
 * **The homepage, as a composition an editor arranges.** Plan §10.1a: *"Create reorderable, typed
 * blocks"*; the §10 prompt: *"Do not hard-code production-like product content into React
 * components."*
 *
 * ### Why a global rather than a collection
 *
 * There is exactly one homepage. A collection would need a slug, a publish status, a rule deciding
 * *which* row is live, and a route resolver — four mechanisms to express a singleton, and four
 * places for it to be ambiguous. `SiteSettings` and `Navigation` set the precedent for site-wide
 * singletons, and Phase 9 proved the whole pipeline against exactly that shape: a cached loader, a
 * pure resolver, and tag revalidation on save. This copies it.
 *
 * Feature matrix §25 lists *"Homepage content"* among the things an editor manages in the admin
 * panel, which is the only place the corpus says where it lives, and it says a CMS rather than a
 * route.
 *
 * ### One field, no tabs
 *
 * `Navigation` uses tabs because it holds three unrelated editing jobs. This holds one, and a tab
 * bar over a single field is chrome.
 *
 * ### Three things that look like improvements and are not
 *
 * **No `versions: { drafts: true }`.** A draft homepage needs a preview route to be worth anything
 * and no phase owns one; worse, enabling drafts sets `disableNotNull`, which strips `NOT NULL` from
 * every column of every block table beneath this field. Editors compose live, as they already do for
 * the navigation that appears on every page.
 *
 * **No `admin.condition` on `sections`.** Payload propagates a condition down the field tree as
 * `disableNotNull` for the same reason, so a cosmetic "show this when…" would silently make every
 * required column in every block nullable.
 *
 * **No second `blocks` field, ever.** Payload's relational read keys its join arguments by block
 * table name; two `blocks` fields on one entity offering the same block overwrite each other's read
 * arguments. One field, eleven types.
 *
 * ### Access
 *
 * `read: anyone` — the homepage is the front door, and it must render for a signed-out visitor. The
 * public REST route is not a leak: a `GET /api/globals/homepage` runs with `overrideAccess: false`,
 * so a populated reference still honours its own collection's read rule and an unpublished product
 * comes back as a bare id. The *storefront's* read is a different matter and is re-checked at render
 * — see `lib/home/resolve.ts`.
 *
 * `update: isStaff` — this is merchandising, which §7.1c gives editors outright. No `create` or
 * `delete`; a global has neither.
 *
 * ### Phase 28: the drop rules are written down where the editor is standing
 *
 * §28.1c makes homepage blocks something a *non-technical client* manages, and Phase 10 left one
 * thing about them illegible. `lib/home/resolve.ts` **drops** a section it cannot render — a figure
 * with no image, a rail whose query returned nothing, a hero whose campaign is still a draft — and
 * that is the right behaviour, argued at length in that module: a dead link is the broken internal
 * route the feature matrix asks us to avoid, and a *disabled* section is §0.1.17's fake control with
 * an apology attached.
 *
 * What it is not is visible. The editor arranges eleven sections, saves without an error, opens the
 * homepage and finds nine — with nothing anywhere saying which two went or why. `SECTION_GUIDE`
 * above is that missing sentence, and it is deliberately a plain string on this field rather than a
 * validator or a custom panel:
 *
 * - **Not a validator.** A section that cannot render *yet* is the normal state of a homepage being
 *   composed — the picture is uploaded on Tuesday, the campaign goes live on Friday. Refusing the
 *   save would make the admin unusable to prevent something that is not an error.
 * - **Not a dashboard component.** The §28 prompt forbids exactly that: *"keep the admin useful to a
 *   non-technical client without introducing unnecessary custom dashboard complexity."* A live
 *   "this section will not appear" badge would have to re-run the resolver's rules against
 *   half-saved form state, in a second implementation that could disagree with the first — and a
 *   guardrail that disagrees with the renderer is worse than no guardrail.
 *
 * **It has one maintenance obligation, so it is stated here rather than discovered later:** the text
 * paraphrases `resolveSection` in `lib/home/resolve.ts`, block by block. A change to a drop
 * condition there is a change to this string. Nothing enforces that — the alternative was per-block
 * descriptions, and Payload's `Block` type has no `admin.description` at all (only `components`,
 * `custom`, `disableBlockName`, `group`, `images`, `jsx`), so a per-block sentence has to hang off a
 * *field* inside the block, in `blocks/home.ts` and `blocks/editorial.ts`.
 */
export const Homepage: GlobalConfig = {
  slug: 'homepage',

  label: 'Homepage',

  admin: {
    group: 'Editorial',
    description: 'The composition of the homepage. Drag sections to reorder them.',
  },

  /**
   * The storefront caches this global under one tag and revalidates on save, exactly as the shell
   * does — see `lib/home/home.ts`. Without the hook an editor's change would wait out the
   * 300-second floor.
   */
  hooks: {
    afterChange: [revalidateGlobal('home')],
  },

  access: {
    read: anyone,
    update: isStaff,
  },

  fields: [
    {
      name: 'sections',
      type: 'blocks',
      labels: { singular: 'Section', plural: 'Sections' },
      blocks: homeBlocks,
      admin: {
        description: SECTION_GUIDE,
      },
    },
  ],
}
