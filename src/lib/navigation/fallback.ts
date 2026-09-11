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
 * **Structure, not merchandising.** The primary destinations (**DEV-07**, which named six including
 * NEW) and the structural footer columns are facts about this site's information architecture, fixed
 * by structure document §2 and §20 and not by an editor. Reproducing them is not inventing content.
 *
 * **Five, not six, since Phase 30.** DEV-07's sixth was ABOUT, and `/about` is a route no phase
 * builds — so it was a 404 in the one header that renders when everything else has already gone
 * wrong. And NEW pointed at `/new`, which was *also* a 404: the live navigation has always sent it to
 * `/shop?sort=newest` (see `scripts/seed.ts`), and this copy invented a route instead of repeating
 * that one. Neither was visible, because this list renders only when the CMS read fails — which is
 * why `verify:shell` now resolves every href here against the route tree rather than trusting it.
 *
 * **No mega menu, no featured panel, no social links.** Those *are* merchandising — a column of
 * categories or a campaign image is a choice someone made in the CMS — and fabricating them would
 * put words in an editor's mouth. When the database is unreachable the header degrades to five plain
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
    { label: 'New', href: '/shop?sort=newest', external: false, columns: [], feature: null },
    { label: 'Shop', href: '/shop', external: false, columns: [], feature: null },
    { label: 'Collections', href: '/collections', external: false, columns: [], feature: null },
    { label: 'Edit', href: '/edit', external: false, columns: [], feature: null },
    { label: 'Lookbook', href: '/lookbook', external: false, columns: [], feature: null },
  ],
  footer: [
    {
      heading: 'Shop',
      links: [
        { label: 'New', href: '/shop?sort=newest', external: false },
        { label: 'Shop All', href: '/shop', external: false },
        { label: 'Collections', href: '/collections', external: false },
        { label: 'Edit', href: '/edit', external: false },
      ],
    },
    /*
     * **Phase 28's audit: every link here has to be a route that exists.**
     *
     * This list shipped pointing at `/help/faq`, `/help/contact`, `/help/shipping`, `/help/returns`,
     * `/order-tracking` and `/about` — and **none of those routes existed**. A degraded footer is
     * already a bad moment; a degraded footer whose every Help link 404s is worse than a shorter one.
     *
     * Phase 28 built `/help/faq`, `/help/shipping` and `/help/returns`, which is why those three stay.
     * Contact is gap **G-08** — the form, and the caller Phase 19's contact-confirmation template is
     * still waiting for. Order tracking and About have no route and no phase claiming them. They come
     * back when they exist, and not before.
     */
    {
      heading: 'Help',
      links: [
        { label: 'FAQ', href: '/help/faq', external: false },
        { label: 'Shipping', href: '/help/shipping', external: false },
        { label: 'Returns', href: '/help/returns', external: false },
      ],
    },
    {
      heading: 'Brand',
      links: [
        { label: 'Lookbook', href: '/lookbook', external: false },
        { label: 'Journal', href: '/journal', external: false },
      ],
    },
  ],
  social: [],
}
