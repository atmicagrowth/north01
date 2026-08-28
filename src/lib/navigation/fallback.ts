import type { ShellNavigation } from '@/lib/navigation/resolve'

/**
 * **What the header and footer render when the CMS cannot be read.**
 *
 * The global shell is in the root layout, so a failed globals read would otherwise take out *every*
 * storefront route rather than the one piece of content it belongs to. The plan's own instruction
 * for third-party dependencies — *"provide graceful failure behavior"* — applies with more force to
 * the one component that is on every page.
 *
 * ### What is in here, and what is deliberately not
 *
 * **Structure, not merchandising.** The six primary destinations (**DEV-07**: six, including NEW)
 * and the structural footer columns are facts about this site's information architecture, fixed by
 * structure document §2 and §20 and not by an editor. Reproducing them is not inventing content.
 *
 * **No mega menu, no featured panel, no social links.** Those *are* merchandising — a column of
 * categories or a campaign image is a choice someone made in the CMS — and fabricating them would
 * put words in an editor's mouth. When the database is unreachable the header degrades to six plain
 * links, which is a quieter header, not a wrong one.
 *
 * **No Journal in the primary set** — C-07, the structure document's own Simplicity rule. It is in
 * the Brand footer column, where the CMS also puts it.
 *
 * This is a *fallback*, not a default: `shell.ts` reaches for it only after a read has actually
 * failed, and logs when it does. It is never the source of a normally-rendered header, which is why
 * a difference between these labels and the seeded ones is not a bug — the seed is content and this
 * is scaffolding.
 */
export const FALLBACK_NAVIGATION: ShellNavigation = {
  primary: [
    { label: 'New', href: '/new', external: false, columns: [], feature: null },
    { label: 'Shop', href: '/shop', external: false, columns: [], feature: null },
    { label: 'Collections', href: '/collections', external: false, columns: [], feature: null },
    { label: 'Edit', href: '/edit', external: false, columns: [], feature: null },
    { label: 'Lookbook', href: '/lookbook', external: false, columns: [], feature: null },
    { label: 'About', href: '/about', external: false, columns: [], feature: null },
  ],
  footer: [
    {
      heading: 'Shop',
      links: [
        { label: 'New', href: '/new', external: false },
        { label: 'Shop All', href: '/shop', external: false },
        { label: 'Collections', href: '/collections', external: false },
        { label: 'Edit', href: '/edit', external: false },
      ],
    },
    {
      heading: 'Help',
      links: [
        { label: 'FAQ', href: '/help/faq', external: false },
        { label: 'Contact', href: '/help/contact', external: false },
        { label: 'Shipping', href: '/help/shipping', external: false },
        { label: 'Returns', href: '/help/returns', external: false },
        { label: 'Track Order', href: '/order-tracking', external: false },
      ],
    },
    {
      heading: 'Brand',
      links: [
        { label: 'About', href: '/about', external: false },
        { label: 'Lookbook', href: '/lookbook', external: false },
        { label: 'Journal', href: '/journal', external: false },
      ],
    },
  ],
  social: [],
}
