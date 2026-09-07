import { createLoader, parseAsString } from 'nuqs/server'

/**
 * **The product page's URL contract.**
 *
 * Two parameters, one parser map, imported by both the server route and the client selector — the
 * same arrangement `lib/catalog/query.ts` keeps and for the same reason. If the two sides parsed
 * separately they would disagree the first time somebody changed a default, and the page would
 * render one colourway while the control claimed another.
 *
 * Feature matrix §7 lists *"invalid variant query"* as an edge case, which is only an edge case if
 * the variant is in the query. It is: `?color=Bone&size=M`.
 *
 * **Values are the stored ones, not slugs.** A colour is `Bone` and a size is `M`, because those are
 * what `ProductVariants` stores and what the customer reads. `buildVariantMatrix` matches them
 * case-insensitively, so a hand-typed `?color=bone` resolves — and canonicalising the case is the
 * route's job rather than the parser's.
 *
 * `nuqs/server` rather than `nuqs`, because the main entry carries `'use client'` and this map is
 * imported on both sides of the boundary.
 */
export const PRODUCT_PARSERS = {
  color: parseAsString,
  size: parseAsString,
}

export type ProductParams = {
  color: null | string
  size: null | string
}

export const loadProductParams = createLoader(PRODUCT_PARSERS) as (
  input: Promise<Record<string, string | string[] | undefined>>,
) => Promise<ProductParams>
