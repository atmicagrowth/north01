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
 * ### Campaigns are not here, and are expected back
 *
 * A campaign has no public URL in any document — the reasoning is written out in full at
 * `payload/fields/link.ts`, beside the list this map has to stay in step with. Phase 9 removed
 * `campaigns` from *both*, because a route map entry of `null` and a schema that still offered the
 * target added up to an editor trap: the admin panel accepted the link and the header silently
 * dropped it.
 *
 * The map is therefore total — every collection a link may point at has a route — and the `null`
 * branch below is kept for the collection that arrives without one, not for a case that exists today.
 * Restoring campaigns is one entry here, one in `LINKABLE_COLLECTIONS`, and a migration. **DEV-39.**
 */

import { isSameSitePath } from '@/lib/same-site-path'

/** The `relationTo` values `payload/fields/link.ts` permits. Kept in step with `LINKABLE_COLLECTIONS`. */
export type LinkableCollection =
  'products' | 'categories' | 'collections' | 'edits' | 'lookbooks' | 'journal'

/**
 * Slug → path, per collection. `null` means *this document has no page*, and the caller must drop
 * the link rather than render it.
 *
 * `/product/<slug>` is singular, matching the plan's canonical naming ("Product.") and the singular
 * namespaces the structure document already uses for `/edit`, `/lookbook` and `/journal`. The plural
 * `/collections` is the structure document's own spelling and is kept exactly as written.
 */
const DOCUMENT_ROUTES = new Map<LinkableCollection, (slug: string) => string>([
  ['products', (slug) => `/product/${slug}`],
  ['categories', (slug) => `/shop/${slug}`],
  ['collections', (slug) => `/collections/${slug}`],
  ['edits', (slug) => `/edit/${slug}`],
  ['lookbooks', (slug) => `/lookbook/${slug}`],
  ['journal', (slug) => `/journal/${slug}`],
])

/**
 * The public path for a document, or `null` when its collection has no public page.
 *
 * ### Two things here are not incidental
 *
 * **A `Map`, not an object literal.** This takes a `string` — it is called with whatever `relationTo`
 * a database row holds — and an object literal inherits `Object.prototype`, so the lookup answered
 * for names that are not routes at all. Measured, before the change:
 *
 * | `collection` | returned |
 * |---|---|
 * | `'toString'` | `'[object Undefined]'` — a string, so the link rendered |
 * | `'constructor'` | `'x'` — the **slug**, as a *relative* href resolved against the current page |
 * | `'isPrototypeOf'` | `false` — a boolean, from a function typed `string \| null` |
 * | `'__proto__'` | **threw**, which `getShell` catches, degrading the whole shell to the fallback |
 *
 * A `Map` has no prototype chain to walk, so every one of those is now `null`. The values were never
 * reachable through the CMS — Payload constrains `relationTo` — but this function's contract is
 * "a path, or nothing", and it was returning three other things.
 *
 * **The slug is encoded.** `slugField` allows `[a-z0-9-]` only, and `encodeURIComponent` leaves every
 * such slug byte-identical, so this costs nothing on real data. What it stops is a value that never
 * went through that validator — written before it existed, by a script, or by a future collection
 * with a different field — becoming a path: an unencoded `../../admin` interpolates to
 * `/product/../../admin`, which a browser resolves to `/admin`.
 */
export function documentHref(collection: string, slug: string): string | null {
  const route = DOCUMENT_ROUTES.get(collection as LinkableCollection)

  return route ? route(encodeURIComponent(slug)) : null
}

/**
 * Whether an href leaves this site.
 *
 * `payload/fields/link.ts` refuses anything that is neither a rooted path nor an absolute `http(s)`
 * URL at save time, so this mostly has to tell the two surviving shapes apart. It re-checks anyway,
 * because a value written before that validator existed is still in the column — and because the
 * validator and this function were separately wrong in the same way until Phase 9's audit.
 */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

/**
 * A path this application will route: rooted, and not resolvable off-site.
 *
 * The rule is `lib/same-site-path.ts`. It used to be three `startsWith` calls written out here, and
 * they accepted `/\t/evil.example` — which a browser strips to `//evil.example` before resolving it.
 * See that module for the measurement.
 */
export function isInternalHref(href: string): boolean {
  return isSameSitePath(href)
}
