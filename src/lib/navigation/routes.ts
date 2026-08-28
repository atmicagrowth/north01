/**
 * **Where a CMS document lives on the public site.**
 *
 * Plan §9.1a makes the header *"driven from Payload"*, and `payload/fields/link.ts` models a
 * navigation item as a *reference* to a document precisely so that renaming that document cannot
 * break the link — *"the href is derived from its current slug at render time, not stored."* This
 * module is the derivation. Nothing else in the application may build a document URL by hand.
 *
 * ### The gap this closes
 *
 * The corpus names the browsing namespaces — structure document §2 draws `SHOP`, `COLLECTIONS`,
 * `EDIT`, `LOOKBOOK`, `JOURNAL`, `ABOUT` — but **never gives a URL for an individual document**.
 * There is no path anywhere for a single product, and the site map has no `CAMPAIGN` node at all.
 * That is recorded as gap **G-15** and settled here as decision **D-30**; the shape follows the
 * namespaces the structure document does give, so nothing below is invented where a document spoke.
 *
 * Two consequences worth stating plainly:
 *
 * - **The namespace is the structure document's word, not the Payload collection slug.** The
 *   collection is `edits` and the route is `/edit/…`; the collection is `lookbooks` and the route is
 *   `/lookbook/…`. Structure §2 owns user-facing IA (contradiction C-03's authority ruling), and a
 *   URL is user-facing.
 * - **A category is a shop route, not a namespace of its own.** `/shop/clothing`, matching the SHOP
 *   subtree the structure document draws and the paths Phase 3 already committed to.
 *
 * ### `campaigns` deliberately resolves to nothing
 *
 * A campaign is a *statement* rendered inside another page — the homepage hero, per `Campaigns.ts`
 * and structure §22's Journey E (*Home → Campaign → Lookbook*). No document gives it a page of its
 * own, so inventing `/campaign/<slug>` would be inventing a route, and pointing every campaign at
 * `/` would be a lie for the second one. A navigation item aimed at a campaign therefore resolves to
 * `null` and is **dropped from the rendered navigation** rather than rendered as a dead link — which
 * is the same treatment a deleted or unpublished target gets, and the honest one.
 *
 * It stays *linkable* in the schema because removing it from `LINKABLE_COLLECTIONS` is a foreign-key
 * change and a migration, and because the phase that builds campaign pages — if one ever does — only
 * has to fill in the entry below.
 */

/** The `relationTo` values `payload/fields/link.ts` permits. Kept in step with `LINKABLE_COLLECTIONS`. */
export type LinkableCollection =
  'products' | 'categories' | 'collections' | 'edits' | 'lookbooks' | 'journal' | 'campaigns'

/**
 * Slug → path, per collection. `null` means *this document has no page*, and the caller must drop
 * the link rather than render it.
 *
 * `/product/<slug>` is singular, matching the plan's canonical naming ("Product.") and the singular
 * namespaces the structure document already uses for `/edit`, `/lookbook` and `/journal`. The plural
 * `/collections` is the structure document's own spelling and is kept exactly as written.
 */
const DOCUMENT_ROUTES: Record<LinkableCollection, ((slug: string) => string) | null> = {
  products: (slug) => `/product/${slug}`,
  categories: (slug) => `/shop/${slug}`,
  collections: (slug) => `/collections/${slug}`,
  edits: (slug) => `/edit/${slug}`,
  lookbooks: (slug) => `/lookbook/${slug}`,
  journal: (slug) => `/journal/${slug}`,
  campaigns: null,
}

/** The public path for a document, or `null` when its collection has no public page. */
export function documentHref(collection: string, slug: string): string | null {
  const route = DOCUMENT_ROUTES[collection as LinkableCollection]

  return route ? route(slug) : null
}

/**
 * Whether an href leaves this site.
 *
 * `payload/fields/link.ts` already refuses anything that is neither a single-slash-rooted path nor an
 * absolute `http(s)` URL — `javascript:` and protocol-relative `//host` are rejected at save time —
 * so this only has to tell the two surviving shapes apart. It re-checks the leading `//` anyway,
 * because a value written before that validator existed would still be in the column.
 */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

/** A path this application will route: rooted, and not protocol-relative. */
export function isInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\')
}
