import type { CurrencyCode } from '@/payload/fields/money'

/**
 * **Minor units, turned into the string a customer reads.**
 *
 * Decision **D-20** stores every price as an integer count of minor units, and
 * `payload/fields/money.ts` says where the other half belongs: *"Formatting … belongs to the
 * presentation layer."* This is that layer, and it is the one piece of the reuse audit that
 * genuinely did not exist before Phase 10.
 *
 * Three properties worth stating, because each is a bug this module exists to not have:
 *
 * - **Integer division is never done here.** `minor / 100` happens once, at the boundary, and
 *   `Intl.NumberFormat` does the rounding and the symbol placement. Hand-formatting
 *   `` `$${(minor/100).toFixed(2)}` `` is how a store ends up showing `$1234.5` and `€1,234.50`
 *   with the wrong separator in the wrong place.
 * - **The currency and locale are arguments, not constants.** They come from `site-settings`
 *   (`defaultCurrency`, `defaultLocale`), which `SiteSettings.ts` describes as *"a BCP 47 tag, used
 *   for date and number formatting"* — a field that would otherwise be a column nothing reads.
 * - **`null` in, `null` out.** A product with no active variant has `derived.priceFromMinor === null`
 *   (`syncProductDerived`'s `DERIVED_EMPTY`), and the honest rendering of that is *no price line*,
 *   not `$0.00`. Callers must handle the `null`; the type makes them.
 *
 * These run on the server only — every surface that formats a price is a server component — so
 * there is no `Intl` hydration mismatch to worry about. If a client component ever needs one, it
 * must receive the formatted string as a prop rather than importing this.
 */

/** A whole, non-negative, safe integer. Anything else is not a price. */
const isMinorUnits = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/**
 * `$240.00`, or `null` when there is no price to show.
 *
 * An unknown currency or locale would make `Intl.NumberFormat` throw, which on a homepage rail
 * would take out the whole page for one bad row in `site-settings`. It is caught and treated as
 * "no price" — the same outcome as a missing one, and the same drop-rather-than-crash posture the
 * navigation resolver takes.
 */
export function formatMinorUnits(
  minor: null | number | undefined,
  currency: CurrencyCode,
  locale: string,
): null | string {
  if (!isMinorUnits(minor)) {
    return null
  }

  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100)
  } catch {
    return null
  }
}

/**
 * The price line for a product whose variants are not all one price.
 *
 * `From $95.00` when the range is real, a single formatted price when it is not. The comparison is
 * on the **minor units**, before formatting, so two prices that format identically under a
 * zero-decimal currency do not produce a `From` that says nothing.
 *
 * `derived.priceToMinor` is the highest active price and `priceFromMinor` the lowest, both
 * maintained by `syncProductDerived`; a product with one variant has them equal.
 */
export function formatPriceRange(
  fromMinor: null | number | undefined,
  toMinor: null | number | undefined,
  currency: CurrencyCode,
  locale: string,
): null | string {
  const from = formatMinorUnits(fromMinor, currency, locale)

  if (from === null) {
    return null
  }

  if (isMinorUnits(fromMinor) && isMinorUnits(toMinor) && toMinor > fromMinor) {
    return `From ${from}`
  }

  return from
}
