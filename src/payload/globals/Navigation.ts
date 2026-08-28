import type { GlobalConfig } from 'payload'

import { anyone, isStaff } from '../access'
import { linkFields } from '../fields/link'
import { revalidateGlobal } from '../hooks/revalidateTags'

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
 * ### The primary navigation is six items, and the schema says so
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
                  'Six at most: NEW, SHOP, COLLECTIONS, EDIT, LOOKBOOK, ABOUT. The limit is the rule, not a suggestion — see DEV-07.',
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
                      'Leave empty for a plain link. One or more columns turns this item into a mega menu.',
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
                      'Optional image beside the columns. The mega menu is a merchandising surface, not a sitemap.',
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
                description:
                  'Structure §20: Shop, Help, About/editorial, and the legal links. The newsletter column is a form rather than navigation, so it is not edited here — it was built in Phase 10 (DEV-42).',
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
