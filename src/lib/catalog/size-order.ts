/**
 * **The order the shop's size filter lists sizes in — Phase 35 (P35-11).**
 *
 * Pure, and in its own module so it can be tested without the Payload client `catalog.ts` imports.
 *
 * ### Why the merchandiser's number alone was not enough
 *
 * `sizeSortOrder` is per **variant**, and each product's editor numbers its own run: a tee's XS is
 * 10, a trouser's 30 is also 10, a cap's ONE SIZE is 0. Within one product that is exactly right —
 * `buildVariantMatrix` still uses it for the product page's size row. Across the whole catalogue,
 * which is what the filter panel lists, the numbers come from different scales and interleave: the
 * panel read `ONE SIZE / XS / 30 / S / 32 …`.
 *
 * So the filter sorts by **(scale, position)**: the letter scale in garment order, then numeric
 * sizes by value, then anything this file does not recognise (by the old lowest-`sizeSortOrder`
 * rank, then alphabetically), and `ONE SIZE` last — it is the size a customer filtering by size is
 * least likely to be looking for.
 *
 * Category scoping — showing only the sizes the current category is made in — is **deferred**: the
 * vocabulary is one cached read for the whole shop, and scoping it is a query change, not an
 * ordering one.
 */

/** The letter scale, smallest first. Split sizes sit between the two sizes they span. */
const LETTER_SCALE = ['XXS', 'XS', 'S', 'S/M', 'M', 'M/L', 'L', 'L/XL', 'XL', 'XXL'] as const

const NUMERIC = /^\d+(?:\.\d+)?$/

type SizeKey = { position: number; scale: number }

function sizeKey(value: string, rank: number): SizeKey {
  const normalised = value.trim().toUpperCase()
  const letter = (LETTER_SCALE as readonly string[]).indexOf(normalised)

  if (letter !== -1) {
    return { position: letter, scale: 0 }
  }

  if (NUMERIC.test(normalised)) {
    return { position: Number(normalised), scale: 1 }
  }

  if (normalised === 'ONE SIZE') {
    return { position: 0, scale: 3 }
  }

  return { position: rank, scale: 2 }
}

/**
 * Compare two `[size, rank]` entries, where `rank` is the lowest `sizeSortOrder` any variant gives
 * that size. A total order: ties on the key fall through to `localeCompare`, so the panel cannot
 * reshuffle between reads.
 */
export function compareSizeEntries(a: [string, number], b: [string, number]): number {
  const left = sizeKey(a[0], a[1])
  const right = sizeKey(b[0], b[1])

  return left.scale - right.scale || left.position - right.position || a[0].localeCompare(b[0])
}
