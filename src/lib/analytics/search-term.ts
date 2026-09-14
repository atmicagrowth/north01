/**
 * **The search terms no measurement vendor is told** — one rule, read by both places that report a
 * term.
 *
 * Plan §34: *"a search box is where people paste an email address or an order number"*. A term that
 * contains an `@` or a run of six or more digits is reported as `[redacted]`:
 *
 * - `components/shell/search-panel.tsx` applies it to the `search_submitted` event's `term`;
 * - `lib/analytics/redact-for-vendors.ts` applies it to the `q` parameter of the `/search?q=<term>`
 *   page the search then navigates to, so the page view cannot carry what the event withheld.
 *
 * The pattern used to be written out in both files, which is how two copies of a privacy rule drift.
 *
 * ### Why this file imports nothing
 *
 * The search panel is in the shell, so whatever it imports is in the first-load bundle of every page.
 * `redact-for-vendors.ts` is loaded only by dynamic `import()` from `analytics.tsx`, because it pulls
 * in `redact.ts`'s pattern tables; the panel importing the rule from there would have put them back
 * into first load. `private-paths.ts` is the same arrangement for the private-path list.
 *
 * No `g` flag: `.test()` on a global regex keeps `lastIndex` between calls, and a shared constant
 * would then answer differently for the same term on alternate calls.
 */
export const PERSONAL_SEARCH = /@|\d{6,}/
