import type { GlobalConfig } from 'payload'

import { anyone, isAdminField, isStaff } from '../access'
import { revalidateGlobal } from '../hooks/revalidateTags'
import { isSameSitePath } from '../../lib/same-site-path'
import { CURRENCY_OPTIONS, DEFAULT_CURRENCY, minorUnits } from '../fields/money'

/**
 * Plan §6.1a — *"create globals or equivalent configuration for"* a list of thirteen things. Eleven
 * of them are here; navigation and social links are the other global, because they are a different
 * job with a different editor (see `Navigation.ts`), and two of the thirteen are deliberately absent
 * for reasons worth writing down:
 *
 * **Analytics configuration is not here.** §6.1a qualifies it — *"analytics configuration **where
 * appropriate**"* — and it is not appropriate. Measurement IDs and keys are environment
 * configuration, and this project settled where that lives in Phase 4: three tiered modules with a
 * trust boundary that is a *file* boundary (decision **D-14**), validated at build and at startup
 * (**D-15**). Moving a PostHog key into a database row would put a deployment concern behind a CMS
 * login and route it around every guard those decisions installed. Worse, a toggle here that no code
 * reads is plan §0.1.17's fake functionality wearing an admin field.
 *
 * **Maintenance mode is not here either** — only the banner. A maintenance *switch* that nothing
 * enforces is the same fake control, and one with real consequences: an editor who flips it and sees
 * the shop still trading has been lied to by the interface. The announcement bar below is the honest
 * half of §6.1a's *"maintenance/banner messaging"* — a message an editor writes and Phase 9 renders,
 * which is the only part of it that is content rather than infrastructure.
 *
 * ---
 *
 * **Every field here is read by a later phase.** That is what a data-model phase produces: Phase 9
 * renders the announcement and the logo, Phase 11 the low-stock threshold, Phase 14 the free-shipping
 * progress bar, Phase 24 the SEO defaults. Nothing on this screen does anything today, and the field
 * descriptions say which phase changes that.
 *
 * **One currency, recorded rather than implied.** `defaultCurrency` names the currency catalogue
 * prices are held in; it is not a switch that converts them. Carts and orders snapshot their own
 * currency code so a historical order still reads correctly if this is ever changed, and changing it
 * reprices nothing. No document in the corpus asks for multi-currency pricing, and the schema should
 * not look like it offers it.
 */
export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',

  label: 'Site Settings',

  admin: {
    group: 'Settings',
    description:
      'Brand identity, commerce defaults and SEO fallbacks. Rendered from Phase 9 onward — see each field.',
  },

  /**
   * **Public read, staff update — and the Commerce tab is admin-only at the field level.**
   *
   * §7.1c withholds "financial administration" and "full system configuration" from editors, and
   * this global straddles that line: the announcement bar, the policies and the SEO defaults are
   * plainly editorial, while the currency, the free-shipping threshold, the low-stock threshold and
   * the per-line quantity cap are commerce configuration that changes what customers are charged and
   * what they can buy.
   *
   * Splitting the global in two would express that in the schema, at the cost of a second migration
   * and a settings screen an editor has to know is elsewhere. Field access expresses the same
   * boundary in the same place: a `PATCH` that names those fields has them dropped rather than
   * applied. The admin panel needs no separate instruction — Payload sends field permissions to the
   * client with the document and renders a field the user cannot update as read-only, so an editor
   * is never offered an edit that would be silently discarded.
   */
  access: {
    read: anyone,
    update: isStaff,
  },

  /**
   * The header reads `siteName`, `logo` and `announcement` on every page. See `Navigation.ts`.
   *
   * **`home` is in the list too**, and it has to be: from Phase 10 the homepage's own cached read
   * takes `defaultCurrency`, `defaultLocale` and `siteName` from this global. Without the tag the
   * shell re-rendered with the new values while the page body underneath it kept formatting prices
   * with the old ones, for up to five minutes. Found by Phase 10's audit.
   */
  hooks: {
    afterChange: [revalidateGlobal('shell', 'site-settings', 'home')],
  },

  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Identity',
          fields: [
            {
              name: 'siteName',
              type: 'text',
              required: true,
              defaultValue: 'NORTH / 01',
              admin: { description: 'Used in the page title suffix and in transactional email.' },
            },
            {
              name: 'logo',
              type: 'upload',
              relationTo: 'media',
              admin: { description: 'The header mark. Falls back to the wordmark when empty.' },
            },
            {
              name: 'tagline',
              type: 'text',
              admin: { description: 'Optional. One line, used in metadata and the footer.' },
            },
          ],
        },
        {
          label: 'Contact',
          fields: [
            {
              name: 'contactEmail',
              type: 'email',
              admin: { description: 'The address on the contact and support surfaces (Phase 23).' },
            },
            {
              name: 'contactPhone',
              type: 'text',
              admin: {
                description:
                  'Optional. Customer support only — this is an online-only business with no retail location.',
              },
            },
          ],
        },
        {
          label: 'Commerce',
          fields: [
            {
              name: 'defaultCurrency',
              access: { update: isAdminField },
              type: 'select',
              required: true,
              defaultValue: DEFAULT_CURRENCY,
              options: [...CURRENCY_OPTIONS],
              admin: {
                description:
                  'The currency catalogue prices are held in. Changing it does not convert anything, and does not touch existing orders.',
              },
            },
            {
              name: 'defaultLocale',
              access: { update: isAdminField },
              type: 'text',
              required: true,
              defaultValue: 'en-US',
              admin: {
                description:
                  'A BCP 47 tag, used for date and number formatting. This build is single-locale; Payload localisation is not enabled.',
              },
              /**
               * Validated by *constructing a formatter with it*, because that is the only thing that
               * knows whether `Intl` accepts it.
               *
               * A malformed tag makes `Intl.NumberFormat` throw, `formatMinorUnits` returns `null`,
               * every product loses its price, and the resolver — correctly — drops every product
               * from the homepage. The store would have emptied its merchandise silently, with
               * `degraded: false` and nothing in the log. One typo in a text field, and the failure
               * surfaces nowhere near its cause. Refusing the save is where this belongs.
               */
              validate: (value: unknown) => {
                if (typeof value !== 'string' || value.trim() === '') {
                  return 'A BCP 47 tag, such as en-US.'
                }

                try {
                  new Intl.NumberFormat(value, { style: 'currency', currency: 'USD' }).format(1)

                  return true
                } catch {
                  return 'Not a locale this runtime recognises. Use a BCP 47 tag such as en-US or en-GB.'
                }
              },
            },
            minorUnits({
              name: 'freeShippingThresholdMinor',
              access: { update: isAdminField },
              label: 'Free shipping threshold',
              admin: {
                description:
                  "The subtotal at which standard delivery is free. Drives the bag's shipping-progress message (plan §14.1e) and is re-evaluated server-side at checkout.",
              },
            }),
            {
              /**
               * The boundary between "Low stock" and "In stock" on a product card (plan §11.1b.6)
               * and in the PDP's inventory messaging (plan §13.1b). It is a merchandising judgement
               * — how urgent the shop wants to sound — so it belongs to an editor rather than to a
               * constant in the render layer.
               *
               * It is deliberately *not* baked into `products.derived`: a stored `lowStock` flag
               * computed against this number would be stale on every product the moment it changed.
               * `derived.inventoryTotal` is the fact; this is the threshold applied to it at render.
               */
              name: 'lowStockThreshold',
              access: { update: isAdminField },
              type: 'number',
              required: true,
              defaultValue: 5,
              min: 1,
              admin: {
                step: 1,
                description:
                  'At or below this many units, a variant reads as low stock rather than in stock.',
              },
            },
            {
              /**
               * Plan §13.1d requires the server to check that a quantity *"does not exceed allowed
               * bounds/inventory policy"*, and plan §14.1b's merge sums duplicate lines *"subject to
               * stock/max limits"*. Both name a bound that no document supplies, so it is defined
               * here — a merchandising decision (how many of one thing a shopper may buy at once),
               * not a constant.
               *
               * `cart-items.quantity` carries a hard cap of 99 as well. The two are different jobs:
               * that one is a sanity bound in the schema that stops an absurd row existing at all,
               * this one is policy that the cart service in Phase 14 applies and can be changed
               * without a migration.
               */
              name: 'maxQuantityPerLine',
              access: { update: isAdminField },
              type: 'number',
              required: true,
              defaultValue: 10,
              min: 1,
              max: 99,
              admin: {
                step: 1,
                description:
                  'The most units of a single variant one bag may hold. Enforced server-side.',
              },
            },
          ],
        },
        {
          label: 'Policies',
          /**
           * Plan §13.1e puts a **Shipping & Returns** accordion on every product page, and no
           * product owns that text — it is one policy for the whole shop. Plan §6.1o is the
           * instruction that decides where it lives: *"use structured content rather than
           * hard-coded text when client editing is a requirement."*
           *
           * Note this is the *policy prose*, not the shipping *rates*. Rates come from the
           * `ShippingProvider` boundary in Phase 16 and are never editable content, because a price
           * an editor can type is a price the browser could be told (plan §16.1b).
           *
           * The dedicated `/help/shipping` and `/help/returns` pages are gap **G-08**, assigned to
           * Phase 23. When they arrive they should render these same fields rather than a second
           * copy — one policy, one source.
           */
          fields: [
            {
              name: 'shippingPolicy',
              type: 'richText',
              admin: {
                description:
                  'The Shipping half of the PDP accordion, and the shipping support page.',
              },
            },
            {
              name: 'returnsPolicy',
              type: 'richText',
              admin: {
                description:
                  'The Returns half. Online-only: returns are initiated through the account or support flow, never in a store.',
              },
            },
          ],
        },
        {
          label: 'SEO defaults',
          fields: [
            {
              name: 'defaultSeoTitle',
              type: 'text',
              admin: {
                description:
                  'The title for pages that derive none of their own. Per-document SEO fields override it (Phase 24).',
              },
            },
            {
              name: 'defaultSeoDescription',
              type: 'textarea',
              maxLength: 320,
              admin: { description: 'The fallback meta description.' },
            },
            {
              name: 'defaultOgImage',
              type: 'upload',
              relationTo: 'media',
              admin: {
                description:
                  'The social card image used when a page supplies none. Roughly 1200 × 630.',
              },
            },
          ],
        },
        {
          label: 'Announcement',
          fields: [
            {
              name: 'announcement',
              type: 'group',
              label: false,
              fields: [
                {
                  name: 'enabled',
                  type: 'checkbox',
                  defaultValue: false,
                  admin: {
                    description:
                      'Shows the bar above the header. It scrolls away with the page — only the header itself is sticky.',
                  },
                },
                {
                  name: 'message',
                  type: 'text',
                  maxLength: 120,
                  admin: {
                    description: 'One short line. The bar is quiet by design — visual guide §06.',
                    condition: (_data, siblingData: { enabled?: unknown }) =>
                      Boolean(siblingData?.enabled),
                  },
                },
                {
                  name: 'href',
                  type: 'text',
                  admin: {
                    description: 'Optional. A site path such as /collections/limited.',
                    condition: (_data, siblingData: { enabled?: unknown }) =>
                      Boolean(siblingData?.enabled),
                  },
                  /*
                   * The path half is `lib/same-site-path.ts`, not a `startsWith` written out here.
                   * The version written out here accepted `/\t/evil.example`, which a browser
                   * resolves off-site — see that module, and Phase 9's audit.
                   */
                  validate: (value: unknown) =>
                    value === null || value === undefined || value === ''
                      ? true
                      : isSameSitePath(value) ||
                          (typeof value === 'string' && /^https?:\/\/\S+$/.test(value))
                        ? true
                        : 'A site path beginning with / or a full https:// URL.',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
