import type { GlobalConfig } from 'payload'

import { anyone, isStaff } from '../access'
import { linkFields } from '../fields/link'
import { revalidateGlobal } from '../hooks/revalidateTags'

/**
 * **Which parts of the footer are content, and which are not** — plan §28.1c lists *"footer"* among
 * the surfaces a non-technical client manages, and the honest answer is "most of it, from three
 * different screens, and two pieces from none of them".
 *
 * Phase 28 audited `components/layout/site-footer.tsx` against this global and found the split
 * below. Nothing is *changed* by writing it down; what changes is that an editor hunting for the
 * copyright line or the Privacy link stops hunting, instead of concluding the admin is broken.
 *
 * | Part of the footer | Where it is edited |
 * |---|---|
 * | The link columns | here |
 * | Social links | here, on the Social tab |
 * | The wordmark and the line under it | Site Settings → Identity (`siteName`, `tagline`) |
 * | The © line | nowhere — it is the site name again, so it follows Site Settings |
 * | The newsletter column | nowhere — it is a form, not navigation (**DEV-42**) |
 * | Privacy and Terms | nowhere — `lib/navigation/utility.ts` (**see below**) |
 *
 * **The legal row is deliberately not content, and this is the one entry worth defending.** It is a
 * two-item array in code because a legal notice is not merchandising: it must be present on every
 * page of a trading storefront, and a footer column an editor can reorder is a footer column an
 * editor can empty. Making it editable would put "can this shop legally trade" behind a drag handle.
 * An editor who needs different legal wording is asking for a development change, and the
 * description says so rather than leaving them to look for a field that does not exist.
 */
const FOOTER_GUIDE = [
  'Structure §20: Shop, Help, About/editorial. Four columns at most.',
  'A column needs a heading and at least one working link or the whole column is left off the footer — and a link whose page has been unpublished or deleted is dropped silently, so a column can empty itself without anyone editing it here.',
  'Three parts of the footer are not edited on this screen.',
  'The shop name and the line beneath it, and therefore the copyright line, come from Site Settings → Identity.',
  'The newsletter column is a signup form rather than navigation, so its wording is set in code (DEV-42).',
  'The Privacy and Terms row is fixed in code on purpose: legal links have to be on every page, and a column that can be reordered is a column that can be emptied. Changing those two needs a developer.',
].join(' ')

/**
 * Header navigation, footer navigation and social links — the other three items on plan §6.1a's
 * list. They are a separate global from Site Settings because they are a separate editing job: one
 * screen is "what is this shop", the other is "how do you move around it", and putting eight nested
 * arrays beside the free-shipping threshold makes both harder to find.
 *
 * Feature matrix §1 requires the header to be data: *"mega menu content driven from Payload"*, with
 * *"missing navigation item"*, *"unpublished collection"* and *"broken internal route"* among its
 * edge cases. All three are why navigation items are the `link` field group from `fields/link.ts`
 * rather than text and a URL — a reference knows when its target is unpublished or gone, a string
 * never does.
 *
 * ---
 *
 * ### The primary navigation is at most six items, and the schema says so
 *
 * *As built it is five — ABOUT was withdrawn in Phase 30 because no page exists (DEV-07, amended).*
 *
 * **NEW · SHOP · COLLECTIONS · EDIT · LOOKBOOK · ABOUT** — plan's canonical naming section,
 * structure document §2's Simplicity rule, and the visual guide, against a reference image that
 * draws five (**C-08**, **DEV-07**: the written guide beats the image). `maxRows: 6` makes that a
 * property of the data rather than a note someone reads later, and it is the direct expression of
 * the plan's own instruction:
 *
 * > "Do not add another top-level navigation category merely because a backend collection exists."
 *
 * Journal is deliberately not among them. Structure §2 lists it in the site map and the same
 * document's Simplicity rule keeps it out of the top navigation; the more specific statement wins
 * (**C-07**), so it is reached from the footer — which is what the `footer` columns below are for.
 *
 * Wishlist, account, search and bag are not here either. They are fixed header affordances (structure
 * §3), not editable navigation, and modelling them as content would let an editor delete the bag.
 */
export const Navigation: GlobalConfig = {
  slug: 'navigation',

  label: 'Navigation',

  admin: {
    group: 'Settings',
    description: 'Header, mega menu, footer and social links. Rendered on every storefront page.',
  },

  /**
   * Saving this global drops the cached shell, so the change reaches the storefront on the next
   * request rather than on the five-minute floor. See `hooks/revalidateTags.ts`.
   */
  hooks: {
    afterChange: [revalidateGlobal('shell', 'navigation')],
  },

  /**
   * Public read: every page renders the header and footer from this, including for a signed-out
   * visitor. Editors may change it — navigation is merchandising, which §7.1c gives them outright.
   */
  access: {
    read: anyone,
    update: isStaff,
  },

  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Header',
          fields: [
            {
              name: 'primary',
              type: 'array',
              maxRows: 6,
              labels: { singular: 'Primary item', plural: 'Primary items' },
              admin: {
                description:
                  'Five: NEW, SHOP, COLLECTIONS, EDIT, LOOKBOOK (six at most — DEV-07, amended in Phase 30 when ABOUT was withdrawn for want of a page). A link to a page that does not exist is dropped too. An item pointing at a page that is a draft, dated in the future, or deleted is left out of the header entirely rather than shown as a dead link, and nothing warns you here — so after unpublishing a page, look at the header.',
              },
              fields: [
                ...linkFields({ required: true }),
                {
                  name: 'columns',
                  type: 'array',
                  maxRows: 4,
                  labels: { singular: 'Mega menu column', plural: 'Mega menu columns' },
                  admin: {
                    description:
                      'Leave empty for a plain link. One or more columns turns this item into a mega menu. A column whose links have all been unpublished or deleted is dropped rather than shown as a heading over nothing — so a mega menu can quietly become a plain link without anyone editing it.',
                  },
                  fields: [
                    {
                      name: 'heading',
                      type: 'text',
                      admin: {
                        description: 'Optional column heading — "Clothing", "By collection".',
                      },
                    },
                    {
                      name: 'links',
                      type: 'array',
                      maxRows: 8,
                      labels: { singular: 'Link', plural: 'Links' },
                      fields: linkFields({ required: true }),
                    },
                  ],
                },
                {
                  name: 'feature',
                  type: 'group',
                  label: 'Featured panel',
                  admin: {
                    description:
                      'Optional image beside the columns. The mega menu is a merchandising surface, not a sitemap. The panel needs a picture or a caption to appear at all — a link on its own renders nothing, because there would be nothing to click.',
                  },
                  fields: [
                    {
                      name: 'image',
                      type: 'upload',
                      relationTo: 'media',
                    },
                    { name: 'caption', type: 'text' },
                    ...linkFields({ required: false }),
                  ],
                },
              ],
            },
          ],
        },
        {
          label: 'Footer',
          fields: [
            {
              name: 'footer',
              type: 'array',
              maxRows: 4,
              labels: { singular: 'Footer column', plural: 'Footer columns' },
              admin: {
                description: FOOTER_GUIDE,
              },
              fields: [
                { name: 'heading', type: 'text', required: true },
                {
                  name: 'links',
                  type: 'array',
                  maxRows: 8,
                  labels: { singular: 'Link', plural: 'Links' },
                  fields: linkFields({ required: true }),
                },
              ],
            },
          ],
        },
        {
          label: 'Social',
          fields: [
            {
              name: 'social',
              type: 'array',
              maxRows: 6,
              labels: { singular: 'Social link', plural: 'Social links' },
              admin: {
                description:
                  'Rendered as text links in the footer, not icons — lucide-react 1.x ships no brand marks, and drawing six logos by hand is not a design system. Kept quiet either way — visual guide §06.',
              },
              fields: [
                {
                  type: 'row',
                  fields: [
                    {
                      /**
                       * A closed list, because each value has a display name the application
                       * ships — "TikTok" and "YouTube" are not their own slugs in print, and a free
                       * text platform would render however it was typed, in a row where every other
                       * label is set consistently.
                       */
                      name: 'platform',
                      type: 'select',
                      required: true,
                      options: [
                        { label: 'Instagram', value: 'instagram' },
                        { label: 'TikTok', value: 'tiktok' },
                        { label: 'Pinterest', value: 'pinterest' },
                        { label: 'YouTube', value: 'youtube' },
                        { label: 'X', value: 'x' },
                        { label: 'LinkedIn', value: 'linkedin' },
                      ],
                      admin: { width: '40%' },
                    },
                    {
                      name: 'url',
                      type: 'text',
                      required: true,
                      admin: { width: '60%', description: 'The full https:// profile address.' },
                      validate: (value: unknown) =>
                        typeof value === 'string' && /^https:\/\/\S+$/.test(value)
                          ? true
                          : 'A full https:// address.',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
