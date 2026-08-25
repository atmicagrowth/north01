/**
 * The navigation model.
 *
 * **Phase 3 owns the shape, not the content.** These constants exist so the shell
 * components have something real and correct to render; plan §9.1a makes navigation
 * editable through Payload site settings, and that phase replaces this module's data
 * while keeping its types. Nothing here should grow into a content system.
 *
 * Two decisions from earlier phases are encoded here and must not be quietly changed:
 *
 *   - **Six primary items, including NEW** — DEV-07. The reference image draws five and
 *     omits NEW; three written documents specify six, and the written guide beats the
 *     image.
 *   - **The Edit set is four, and Essentials is not one of them** — DEV-01. Essentials is
 *     a Collection at `/collections/essentials`. The same merchandising page cannot live
 *     in two URL namespaces.
 *
 * Journal is deliberately absent from the primary navigation and present in the footer —
 * C-07, the structure document's own Simplicity rule: "do not expose every content type
 * in the primary navigation."
 */

export type NavItem = {
  label: string
  href: string
  /** Second-level items, shown in the mega menu (Phase 9) and the mobile drawer. */
  children?: NavItem[]
}

/** Structure doc §2 — the shop tree. */
const shopChildren: NavItem[] = [
  { label: 'All', href: '/shop' },
  { label: 'Clothing', href: '/shop/clothing' },
  { label: 'Accessories', href: '/shop/accessories' },
  { label: 'New Arrivals', href: '/shop/new-arrivals' },
  { label: 'Best Sellers', href: '/shop/best-sellers' },
]

/** Structure doc §2. Essentials sits here, not under Edit — DEV-01. */
const collectionChildren: NavItem[] = [
  { label: 'Current Season', href: '/collections/current-season' },
  { label: 'Essentials', href: '/collections/essentials' },
  { label: 'Limited', href: '/collections/limited' },
  { label: 'Archive', href: '/collections/archive' },
]

/** Four items. Structure doc §2, confirmed by DEV-01. */
const editChildren: NavItem[] = [
  { label: 'Weekend', href: '/edit/weekend' },
  { label: 'Travel', href: '/edit/travel' },
  { label: 'Everyday', href: '/edit/everyday' },
  { label: 'Gifts', href: '/edit/gifts' },
]

export const primaryNav: NavItem[] = [
  { label: 'New', href: '/new' },
  { label: 'Shop', href: '/shop', children: shopChildren },
  { label: 'Collections', href: '/collections', children: collectionChildren },
  { label: 'Edit', href: '/edit', children: editChildren },
  { label: 'Lookbook', href: '/lookbook' },
  { label: 'About', href: '/about' },
]

/**
 * Header utility destinations. Structure doc §3.
 *
 * These are links, not buttons, on purpose. Phase 9 turns Search and Bag into overlays
 * (§9.1b, §9.1d) and Phase 12 builds the search experience; until those exist, a link to
 * the eventual route is an honest control, whereas a button wired to nothing would be
 * the "looks functional but does nothing" UI the plan forbids.
 */
export const utilityNav = {
  search: { label: 'Search', href: '/search' },
  wishlist: { label: 'Wishlist', href: '/account/wishlist' },
  account: { label: 'Account', href: '/account' },
  bag: { label: 'Bag', href: '/cart' },
} as const

/**
 * Footer columns. Structure doc §20 — "Shop. Help. About/editorial. Newsletter.
 * Social/legal." — and §19 for the support surface.
 *
 * The **newsletter** column is not here. It is a form that would post nowhere until
 * Phase 6 defines the subscriber collection and Phase 19 sends the mail; rendering the
 * input now would be exactly the fake UI the plan forbids. `SiteFooter` takes a
 * `newsletter` slot so the layout is ready for it, and the phase that can make it work
 * fills it in.
 */
export const footerNav: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Shop',
    items: [
      { label: 'New', href: '/new' },
      { label: 'Shop All', href: '/shop' },
      { label: 'Collections', href: '/collections' },
      { label: 'Edit', href: '/edit' },
    ],
  },
  {
    heading: 'Help',
    items: [
      { label: 'FAQ', href: '/help/faq' },
      { label: 'Contact', href: '/help/contact' },
      { label: 'Shipping', href: '/help/shipping' },
      { label: 'Returns', href: '/help/returns' },
      { label: 'Track Order', href: '/order-tracking' },
    ],
  },
  {
    heading: 'Brand',
    items: [
      { label: 'About', href: '/about' },
      { label: 'Lookbook', href: '/lookbook' },
      // Reachable from the footer and editorial surfaces, never the primary nav — C-07.
      { label: 'Journal', href: '/journal' },
    ],
  },
]
