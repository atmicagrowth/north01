import { formatMinorUnits } from '@/lib/money'
import type { CurrencyCode } from '@/payload/fields/money'

/**
 * **Plan §13.1c's variant logic, as pure functions.**
 *
 * *"Variant selection must be authoritative."* That sentence is the whole phase, and this module is
 * where it is enforced — not in a component, not in a click handler, and not in the browser.
 *
 * Pure: no Next, nothing runnable from Payload, nothing `server-only`. `pnpm verify:product`
 * exercises every combination §13.1c enumerates as a fixture, including the one the plan spells out
 * by name — *"if Black / M exists but Cream / M does not"* — because a rule about which combinations
 * are impossible is exactly the kind of rule that is easy to write, easy to break, and invisible in
 * a screenshot of a page where the customer happened to pick a combination that works.
 *
 * ---
 *
 * ### One matrix, three questions
 *
 * A customer asks three things of a variant selector and they are not the same question:
 *
 * 1. **Which colours exist at all?** — the swatch row.
 * 2. **Given this colour, which sizes can I have?** — the size row, with the impossible ones
 *    disabled rather than hidden, because a size that vanishes when you change colour reads as a
 *    rendering bug.
 * 3. **Given this colour and this size, what exactly am I buying?** — one variant row, or nothing.
 *
 * `buildVariantMatrix` answers all three from one pass, so the swatches, the sizes and the resolved
 * variant can never disagree about the same catalogue.
 */

/** The minimum a caller must supply. Structural rather than a Payload type, so fixtures are cheap. */
export type SelectableVariant = {
  active?: boolean | null
  color?: null | string
  colorHex?: null | string
  compareAtPriceMinor?: null | number
  id: number
  /** A variant-specific photograph, or `null` to use the product gallery. */
  image?: unknown
  inventoryQuantity?: null | number
  priceMinor?: null | number
  size?: null | string
  sizeSortOrder?: null | number
  sku?: null | string
}

export type VariantAvailability = 'available' | 'lowStock' | 'soldOut'

/** One purchasable row, resolved. */
export type ResolvedVariant = {
  availability: VariantAvailability
  color: string
  /** Struck-through former price, or `null` when the saving is not real. */
  compareAtLabel: null | string
  id: number
  image: unknown
  inventoryQuantity: number
  priceLabel: string
  priceMinor: number
  size: string
  sku: null | string
}

export type ColorOption = {
  /** True when at least one size in this colour can be bought. */
  available: boolean
  hex: null | string
  value: string
}

export type SizeOption = {
  /**
   * Whether this size can be bought **in the currently selected colour**.
   *
   * §13.1c: *"Disable impossible options where appropriate."* Disabled, never removed — a size that
   * disappears when the customer changes colour looks like the page is broken, and it hides the
   * fact that the garment is made in that size at all.
   */
  available: boolean
  /** True when the combination does not exist at all, as opposed to existing and being sold out. */
  missing: boolean
  sortOrder: number
  value: string
}

export type VariantMatrix = {
  colors: ColorOption[]
  /** Every distinct size across the product, in the merchandiser's order. */
  sizes: SizeOption[]
  /** The variant for the current selection, or `null` when the combination is not purchasable. */
  selected: ResolvedVariant | null
  /** The colour actually in effect after falling back. */
  selectedColor: null | string
  /** The size actually in effect after falling back, or `null` when none was chosen. */
  selectedSize: null | string
  /** True when the URL asked for a combination that does not exist — feature matrix §7. */
  invalidSelection: boolean
}

const text = (value: null | string | undefined): null | string => value?.trim() || null

const isMinor = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/**
 * A variant is *offerable* when the merchandiser has not switched it off.
 *
 * Sold out is **not** the same as inactive, and this is the distinction `ProductVariants.ts` draws:
 * an inactive variant is withdrawn and must not appear at all; a sold-out one is a temporary state
 * the customer is told about. Hiding a sold-out size would remove the information that the garment
 * is made in it.
 */
const isOffered = (variant: SelectableVariant): boolean =>
  variant.active !== false &&
  !!text(variant.color) &&
  !!text(variant.size) &&
  isMinor(variant.priceMinor)

function availabilityOf(quantity: number, lowStockThreshold: number): VariantAvailability {
  if (quantity <= 0) {
    return 'soldOut'
  }

  return quantity <= Math.max(1, Math.floor(lowStockThreshold)) ? 'lowStock' : 'available'
}

/**
 * Resolve one variant into what the page renders.
 *
 * `compareAtLabel` is `null` unless the saving is **real** — strictly greater than the price, on the
 * minor units, before formatting. `ProductVariants.ts` states the rule in the field description
 * (*"an equal or lower value is not a sale and must not be displayed as one"*), and Phase 11 applied
 * the identical test to the card.
 */
export function resolveVariant(
  variant: SelectableVariant,
  currency: CurrencyCode,
  locale: string,
  lowStockThreshold: number,
): ResolvedVariant | null {
  const color = text(variant.color)
  const size = text(variant.size)

  if (!color || !size || !isMinor(variant.priceMinor)) {
    return null
  }

  const priceLabel = formatMinorUnits(variant.priceMinor, currency, locale)

  if (priceLabel === null) {
    return null
  }

  const quantity = typeof variant.inventoryQuantity === 'number' ? variant.inventoryQuantity : 0

  const hasRealSaving =
    isMinor(variant.compareAtPriceMinor) && variant.compareAtPriceMinor > variant.priceMinor

  return {
    availability: availabilityOf(quantity, lowStockThreshold),
    color,
    compareAtLabel: hasRealSaving
      ? formatMinorUnits(variant.compareAtPriceMinor as number, currency, locale)
      : null,
    id: variant.id,
    image: variant.image ?? null,
    inventoryQuantity: Math.max(0, quantity),
    priceLabel,
    priceMinor: variant.priceMinor,
    size,
    sku: text(variant.sku),
  }
}

/**
 * **The whole selector, from one pass over the variants.**
 *
 * ### Falling back is a decision, not a convenience
 *
 * A customer can arrive at `/product/x?color=cream&size=m` from a stale link, a bookmark, or a
 * combination that was withdrawn this morning. Feature matrix §7 lists *"invalid variant query"* and
 * *"selected variant becomes unavailable"* as separate edge cases, and both land here.
 *
 * The rule: **fall back, and say so.** An unknown colour falls back to the first colour that has
 * something purchasable in it — because showing a product page with no colour selected is a page
 * that cannot be bought from. An unknown *size* does **not** fall back to a different size: picking
 * a size on a customer's behalf is how somebody ends up buying the wrong one. It resolves to no
 * selection, and `invalidSelection` says the URL asked for something that is not there.
 *
 * That asymmetry is deliberate. A colour is a way of looking at the product; a size is a commitment.
 *
 * ### The one exception: a product made in one size — Phase 35 (P35-31)
 *
 * When the product has exactly **one** size, no size was asked for, and that size is made in the
 * selected colour, it is selected. There is no choice to get wrong: a cap in ONE SIZE asked the
 * customer to "choose" from a row of one before Add to bag would wake up. An explicitly requested
 * size that does not exist still resolves to nothing, and a size not made in this colour is still
 * never selected, so the rule above holds everywhere there is more than one answer.
 */
export function buildVariantMatrix(
  variants: SelectableVariant[],
  requested: { color?: null | string; size?: null | string },
  currency: CurrencyCode,
  locale: string,
  lowStockThreshold: number,
): VariantMatrix {
  const offered = variants.filter(isOffered)

  /*
   * **Colour order is alphabetical, and that is a decision rather than a default.**
   *
   * `ProductVariants.ts` gives sizes a `sizeSortOrder` and gives colours nothing, so there is no
   * merchandiser's colour order to follow. Taking first appearance from a `sizeSortOrder`-sorted
   * read — which is what this did until Phase 13's second sweep — makes a colour's position in the
   * swatch row depend on **which sizes it happens to come in**: a colour made only in XL sorts after
   * one made in XS, for a reason no customer can see. Worse, two colours sharing the smallest size
   * are a tie the query does not break, so the row's order was whatever Postgres returned.
   *
   * That order is not cosmetic. `selectedColor` falls back to the first colour with stock, so an
   * unstable row means the **default colourway of the page** can change between requests.
   *
   * Alphabetical is stable, explicable to an editor, and independent of stock. A real merchandised
   * order needs a field on the collection, which is recorded as owed rather than faked here.
   */
  const colors: ColorOption[] = []
  const sizeRanks = new Map<string, number>()

  for (const variant of offered) {
    const color = text(variant.color) as string
    const size = text(variant.size) as string
    const rank = typeof variant.sizeSortOrder === 'number' ? variant.sizeSortOrder : 0

    if (!colors.some((entry) => entry.value === color)) {
      colors.push({ available: false, hex: text(variant.colorHex), value: color })
    }

    const existing = sizeRanks.get(size)
    sizeRanks.set(size, existing === undefined ? rank : Math.min(existing, rank))
  }

  colors.sort((a, b) => a.value.localeCompare(b.value))

  const byCombination = new Map<string, SelectableVariant>()
  const key = (color: string, size: string) => `${color} ${size}`

  for (const variant of offered) {
    byCombination.set(key(text(variant.color) as string, text(variant.size) as string), variant)
  }

  /* A colour is selectable when anything in it is in stock. */
  for (const entry of colors) {
    entry.available = offered.some(
      (variant) =>
        text(variant.color) === entry.value &&
        (typeof variant.inventoryQuantity === 'number' ? variant.inventoryQuantity : 0) > 0,
    )
  }

  const requestedColor = text(requested.color)
  const requestedSize = text(requested.size)

  const matchColor = colors.find(
    (entry) => entry.value.toLowerCase() === requestedColor?.toLowerCase(),
  )

  /*
   * The fallback prefers a colour with stock, then any colour. A product whose every colour is sold
   * out still renders — plan §11.1b's sold-out state is a state, not a removal.
   */
  const selectedColor =
    matchColor?.value ?? colors.find((entry) => entry.available)?.value ?? colors[0]?.value ?? null

  const sizes: SizeOption[] = [...sizeRanks.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([value, sortOrder]) => {
      const variant = selectedColor ? byCombination.get(key(selectedColor, value)) : undefined
      const quantity =
        variant && typeof variant.inventoryQuantity === 'number' ? variant.inventoryQuantity : 0

      return { available: !!variant && quantity > 0, missing: !variant, sortOrder, value }
    })

  const matchSize = sizes.find(
    (entry) => entry.value.toLowerCase() === requestedSize?.toLowerCase(),
  )

  /* A row of one is not a choice — see the docblock's exception. Never for a requested size. */
  const onlySize = sizes.length === 1 && !sizes[0]?.missing ? sizes[0].value : null

  const selectedSize = matchSize?.value ?? (requestedSize === null ? onlySize : null)

  const selectedVariant =
    selectedColor && selectedSize ? byCombination.get(key(selectedColor, selectedSize)) : undefined

  return {
    colors,
    /**
     * **Feature matrix §7's "invalid variant query" — and it never fired for the case the matrix
     * names.** Phase 27's first sweep.
     *
     * The first two clauses catch a colour or a size that does not exist **on the product at all**.
     * They missed the ordinary version of the problem: `?color=Cream&size=M` where Cream/M was never
     * made but **Black/M was**. `sizes` is every size across the whole product — each entry carrying
     * `missing` for the selected colour — so `matchSize` found "M", the flag stayed false, and the
     * live region that exists to say *"that combination is not available — showing what we do have"*
     * said nothing. The customer saw M apparently selected, Add to bag disabled, and no explanation
     * of why.
     *
     * The third clause states the rule the other two were approximating: they asked for a specific
     * combination and it does not exist. It cannot fire when no size was requested — the clause
     * checks `requestedSize` — so a one-size product's automatic selection never reads as invalid.
     */
    invalidSelection:
      (requestedColor !== null && matchColor === undefined) ||
      (requestedSize !== null && matchSize === undefined) ||
      (requestedSize !== null && selectedSize !== null && selectedVariant === undefined),
    selected: selectedVariant
      ? resolveVariant(selectedVariant, currency, locale, lowStockThreshold)
      : null,
    selectedColor,
    selectedSize,
    sizes,
  }
}

/**
 * The price shown before a size is chosen.
 *
 * A product whose variants are all one price shows that price; one with a range shows `From £95.00`.
 * The comparison is on minor units before formatting, so two amounts that format identically under a
 * zero-decimal currency do not produce a "From" that says nothing — the same rule `lib/money.ts`
 * applies to the card.
 *
 * Only the **selected colour** is considered, because that is what the customer is looking at. A
 * product where black costs more than bone should not advertise bone's price under a black swatch.
 */
export function priceRangeForColor(
  variants: SelectableVariant[],
  color: null | string,
  currency: CurrencyCode,
  locale: string,
): null | string {
  const prices = variants
    .filter((variant) => isOffered(variant) && (color === null || text(variant.color) === color))
    .map((variant) => variant.priceMinor as number)

  if (prices.length === 0) {
    return null
  }

  const low = Math.min(...prices)
  const high = Math.max(...prices)
  const label = formatMinorUnits(low, currency, locale)

  if (label === null) {
    return null
  }

  return high > low ? `From ${label}` : label
}

/**
 * The struck-through former price shown before a size is chosen, or `null` — Phase 35 (P35-12).
 *
 * `compareAtLabel` exists only on a *resolved* variant, so until a size was picked a product on sale
 * looked full price. This answers the same question for the **selected colour**, with the rule
 * `resolveVariant` applies: a compare-at counts only when it is strictly greater than that variant's
 * own price, on minor units.
 *
 * It is shown only when **every** offered size of the colour carries a saving, and all quote the
 * **same** former price. A former price is a pricing claim: if one size were reduced and the rest
 * were not — sweep 1 of Phase 35 found the first version allowed exactly that, even when the reduced
 * size was sold out — the page would quote a saving no buyable size has. Anything short of uniform
 * waits for a size instead.
 */
export function compareAtForColor(
  variants: SelectableVariant[],
  color: null | string,
  currency: CurrencyCode,
  locale: string,
): null | string {
  const offered = variants.filter(
    (variant) => isOffered(variant) && (color === null || text(variant.color) === color),
  )

  const everyReduced = offered.every(
    (variant) =>
      isMinor(variant.compareAtPriceMinor) &&
      variant.compareAtPriceMinor > (variant.priceMinor as number),
  )

  const former = new Set(offered.map((variant) => variant.compareAtPriceMinor as number))

  if (offered.length === 0 || !everyReduced || former.size !== 1) {
    return null
  }

  return formatMinorUnits([...former][0] as number, currency, locale)
}

/**
 * What to tell the customer about stock, or `null` when there is nothing worth saying.
 *
 * Plan §13.1b requires *"inventory messaging"*. Three states earn a sentence and one does not: a
 * comfortably stocked variant is the normal case, and announcing it would be noise on every product
 * page in the catalogue.
 *
 * The low-stock number is the real count rather than a vague "only a few left", because
 * `Products.ts` stores a count precisely so the shop can be specific — and a specific number is
 * harder to disbelieve.
 */
export function inventoryMessage(variant: ResolvedVariant | null): null | string {
  if (!variant) {
    return null
  }

  if (variant.availability === 'soldOut') {
    return 'Sold out in this size'
  }

  if (variant.availability === 'lowStock') {
    return variant.inventoryQuantity === 1 ? 'Last one' : `Only ${variant.inventoryQuantity} left`
  }

  return null
}
