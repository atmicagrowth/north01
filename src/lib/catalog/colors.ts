/**
 * **The colour vocabulary, in one place, because two places would drift.**
 *
 * `ProductVariants.colorFamily` is a `select` whose options *are* the values the colour facet
 * filters on, and the shop's filter panel has to render their labels. Copying the list into the
 * catalogue layer would mean a colour added to the CMS silently missing from the filter — an editor
 * fills in a field and nothing happens, which is `§0.1.17`'s fake control arriving from the other
 * direction.
 *
 * So the collection imports this and so does the vocabulary reader. The `label` is what a customer
 * reads; the `value` is what is stored, indexed, and put in the URL.
 *
 * **The order is the palette's, not the alphabet's** — visual guide §02 describes near-black through
 * bone with colour as the exception, and the filter list reads down that gradient. It is also the
 * Postgres enum's order: changing it would be a schema change, so it is kept exactly as Phase 6
 * shipped it.
 */
export const COLOR_FAMILY_OPTIONS = [
  { label: 'Black', value: 'black' },
  { label: 'Charcoal', value: 'charcoal' },
  { label: 'Grey', value: 'grey' },
  { label: 'Bone', value: 'bone' },
  { label: 'White', value: 'white' },
  { label: 'Tan', value: 'tan' },
  { label: 'Brown', value: 'brown' },
  { label: 'Navy', value: 'navy' },
  { label: 'Blue', value: 'blue' },
  { label: 'Green', value: 'green' },
  { label: 'Rust', value: 'rust' },
] as const

export type ColorFamily = (typeof COLOR_FAMILY_OPTIONS)[number]['value']

export const COLOR_FAMILY_LABELS: Record<string, string> = Object.fromEntries(
  COLOR_FAMILY_OPTIONS.map((option) => [option.value, option.label]),
)
