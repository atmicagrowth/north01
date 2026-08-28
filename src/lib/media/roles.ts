import type { MediaContext } from './cloudinary-url'

/**
 * **Plan §8.1a's "Media role" — a term the corpus uses exactly once and never defines.**
 *
 * The string appears in one place across all six specification documents (the §8.1a bullet list) and
 * nothing anywhere says what a role is, what its values are, or what reads one. It is a specification
 * gap of the same kind as the ones recorded as **G-01**–**G-14** in `docs/ARCHITECTURE.md` §3.2, and
 * it is recorded as one.
 *
 * ### The reading taken, and the one rejected
 *
 * **Taken:** a role names the delivery context an asset is framed for *by default*. An editor uploads
 * a campaign frame, marks it `campaign`, and every consumer that does not care gets hero framing
 * without being told; a consumer that does care passes an explicit context and wins. The role is
 * therefore read on every single render, by `resolveContext` below.
 *
 * **Rejected:** a taxonomy label for organising the media library. It sounds harmless and it is the
 * more obvious reading, but nothing would ever read it — and a column that exists only to be filled
 * in is the fake-functionality rule (§0.1.17) in database form. If browsing the library by kind is
 * wanted later, that is a filter over this same column, added by the phase that builds the screen.
 *
 * The values map one-to-one onto the delivery contexts in `cloudinary-url.ts`, plus `logo`, which
 * has no crop at all — a wordmark cropped to a ratio is a wordmark with its ends cut off.
 */
export const MEDIA_ROLE_OPTIONS = [
  { label: 'Product', value: 'product' },
  { label: 'Campaign', value: 'campaign' },
  { label: 'Editorial', value: 'editorial' },
  { label: 'Logo / mark', value: 'logo' },
] as const

export type MediaRole = (typeof MEDIA_ROLE_OPTIONS)[number]['value']

/**
 * The context an asset is delivered in when its consumer expresses no preference.
 *
 * `logo` maps to `editorial` — the natural-ratio, `c_limit` preset — because that is the one that
 * crops nothing. It is named separately in the role list even though it shares a context, because
 * "this is the mark" is a fact about the asset that a future phase (a favicon, an OG image, an email
 * header) will want to select on, and collapsing it into `editorial` would throw that away.
 */
const DEFAULT_CONTEXT: Record<MediaRole, MediaContext> = {
  product: 'productCard',
  campaign: 'heroDesktop',
  editorial: 'editorial',
  logo: 'editorial',
}

export function resolveContext(
  explicit: MediaContext | undefined,
  role: MediaRole | null | undefined,
): MediaContext {
  if (explicit) {
    return explicit
  }

  return role ? DEFAULT_CONTEXT[role] : 'editorial'
}
