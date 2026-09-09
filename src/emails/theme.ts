/**
 * **The visual guide, inlined.**
 *
 * `NORTH01_Visual_Guide_OnlineOnly.md` is the source of truth for anything visual, and an email
 * cannot reach `globals.css` — no stylesheet link survives Gmail, and no custom property survives
 * Outlook. So every token the app resolves from CSS is restated here as a literal, and the two are
 * kept in step by hand.
 *
 * Two departures from the app's own tokens, both forced by the medium rather than chosen:
 *
 * 1. **The typefaces are the fallbacks, not the faces.** Bodoni Moda and Instrument Sans are
 *    self-hosted `.woff2` files; a mail client will not fetch them. The guide's documented fallback
 *    stacks therefore become the real stacks, which is why the display face reads as Didot or Georgia
 *    in an inbox and as Bodoni Moda on the site. That is a fidelity loss with no fix short of
 *    shipping images of text, which would be worse in every other way.
 * 2. **The type scale is fixed pixels.** The app's scale is `clamp()`-based; `clamp` is unsupported
 *    across most clients, and a size that silently collapses to its minimum is worse than one chosen
 *    for the medium. These are the middle of each of the guide's ranges.
 */

/** Visual guide §02, verbatim. */
export const COLOR = {
  /** Rules and borders. Low contrast on purpose — the guide forbids bright white borders. */
  border: '#33312D',
  /** Page background. */
  canvas: '#0A0A0A',
  /** Primary text. 17.10:1 on canvas. */
  foreground: '#F1EEE8',
  /** Bright text, for the wordmark and the one figure that matters. 18.67:1. */
  foregroundBright: '#FAF8F4',
  /** Tertiary text — legal lines, the unsubscribe rubric. */
  foregroundFaint: '#77726B',
  /** Secondary text. 7.91:1 — still AA at body size. */
  foregroundMuted: '#A9A39A',
  /** The signal colour, DEV-21. Used for one thing: a refund figure. */
  signal: '#C0745F',
  /** Primary surface, for the panel a receipt sits on. */
  surface: '#151515',
  /** Elevated surface. */
  surfaceRaised: '#1D1C1A',
} as const

/**
 * The guide's fallback stacks, promoted to primary. Quoted family names carry their quotes inside the
 * string because these are written straight into a `style` attribute.
 */
export const FONT = {
  sans: "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  serif: "Didot, 'Bodoni MT', Georgia, 'Times New Roman', serif",
} as const

/** Visual guide §03, resolved to fixed pixels. */
export const TYPE = {
  body: { fontSize: '16px', lineHeight: '26px' },
  bodySmall: { fontSize: '14px', lineHeight: '22px' },
  displayL: { fontSize: '40px', letterSpacing: '-0.015em', lineHeight: '44px' },
  headingM: { fontSize: '26px', letterSpacing: '-0.01em', lineHeight: '32px' },
  headingS: { fontSize: '18px', lineHeight: '24px' },
  /** Uppercase, wide-tracked. The guide's "tiny metadata" against oversized type. */
  meta: { fontSize: '12px', letterSpacing: '0.12em', lineHeight: '17px' },
  micro: { fontSize: '10px', letterSpacing: '0.18em', lineHeight: '13px' },
} as const

/** The app's spacing scale. */
export const SPACE = {
  l: 40,
  m: 24,
  s: 12,
  xl: 64,
  xs: 6,
} as const

/**
 * 600px, under the app's 672px reading measure and under the 640px at which several clients begin
 * scaling a message down. The guide's rule that copy sits in a measured column applies here too.
 */
export const CONTAINER_WIDTH = 600
