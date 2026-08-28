import type { GlobalConfig } from 'payload'

import { anyone, isStaff } from '../access'
import { homeBlocks } from '../blocks/home'
import { revalidateGlobal } from '../hooks/revalidateTags'

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
        description:
          'The order here is the order on the page. Structure §4 composes it as: hero, categories, new arrivals, an editorial moment, best sellers or limited edition, the brand story, community. A section whose subject is unpublished or deleted is dropped rather than rendered empty.',
      },
    },
  ],
}
