import { createLoader } from 'nuqs/server'

import { CATALOG_PARSERS, type CatalogParams } from './query'

/**
 * **The server's reader for `?…`.**
 *
 * One line of code and a file of its own, because of what it must *not* import. `query.ts` is pure
 * and is imported by client components; `createLoader` belongs to the server side of nuqs. Keeping
 * the loader here means the parser map stays shared while the loader stays out of the browser
 * bundle.
 *
 * It is built from `CATALOG_PARSERS` — the identical object `useQueryStates` is given in
 * `components/catalog/filter-controls.tsx`. That is the whole point of the arrangement: the value
 * the server renders from and the value the controls write are produced by one definition, so
 * they cannot disagree about a separator, a default or a clamp.
 *
 * The loader is deliberately **not** strict. `strict: true` throws on a value a parser cannot read,
 * which for a *URL* means an unparseable query string takes the page down with a 500 — and feature
 * matrix §5 requires the opposite: *"invalid filter values are ignored safely."* Non-strict parsing
 * yields the parser's default, and `normaliseCatalogQuery` then does the real validation against the
 * catalogue's vocabulary, where a dropped value can be reported to the customer rather than thrown.
 */
export const loadCatalogParams = createLoader(CATALOG_PARSERS) as (
  input: Promise<Record<string, string | string[] | undefined>>,
) => Promise<CatalogParams>
