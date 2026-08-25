import localFont from 'next/font/local'

/**
 * NORTH / 01 — typefaces. Plan §3.1b.
 *
 * Both faces are **self-hosted**: the `.woff2` files sit next to this module and are
 * served from our own origin, content-hashed and immutably cached by Next. Nothing is
 * fetched from Google at build time or at runtime, so the build has no network
 * dependency and the browser makes no third-party font request.
 *
 * `next/font/google` was rejected for exactly that reason — it self-hosts the *browser*
 * request but performs a **build-time** fetch of fonts.googleapis.com, which fails on an
 * egress-restricted or offline build. Plan §3.1b says "self-host where practical"; with
 * two files totalling 76 KB, committing them is entirely practical.
 *
 * Both are licensed **SIL Open Font License 1.1** with **no Reserved Font Name**, so
 * commercial use, embedding, subsetting and redistribution are all permitted. The full
 * licence text for each is committed beside its font file, as the OFL requires:
 *
 *   Bodoni Moda     — Copyright 2020 The Bodoni Moda Project Authors
 *                     https://github.com/indestructible-type/Bodoni  · BodoniModa-OFL.txt
 *   Instrument Sans — Copyright 2022 The Instrument Sans Project Authors
 *                     https://github.com/Instrument/instrument-sans  · InstrumentSans-OFL.txt
 *
 * Each file is the `latin` subset of the upstream **variable** font, so one file covers
 * the whole weight range instead of one file per weight.
 *
 * Why these two, what was rejected, and the traps avoided here are recorded in
 * NORTH01_Implementation_Notes_and_Deviations.md §1.8.3.
 */

/*
 * A note on the `unicode-range` declaration that appears in both loaders below.
 *
 * These files are the `latin` subset — roughly 250 glyphs each — and `next/font/local`
 * never emits a `unicode-range` descriptor of its own. Without one the browser assumes
 * the file covers every character, uses it for anything it is asked to render, and draws
 * `.notdef` tofu instead of falling through to the fallback stack. A customer name or a
 * product description containing anything outside Latin-1 would come out as boxes. This
 * is the range Google serves with the same files.
 *
 * The range is written out at both call sites rather than shared through a constant,
 * and it has to be: Next's font loader reads these options **statically at build time**,
 * so every value must be a literal. A `const` reference fails the build with
 * `missing field 'value'` — verified, not assumed.
 */

/**
 * Display — Bodoni Moda, a Didone.
 *
 * The visual guide (§03) asks for a serif that is "elegant, high contrast,
 * fashion-oriented, slightly dramatic, never playful". The Didone lineage *is* the
 * typographic language of fashion mastheads — vertical stress, unbracketed hairline
 * serifs, extreme thick/thin modulation — and this is the closest libre face to it.
 *
 * **The file matters more than the family here.** Google serves two different Bodoni
 * Moda variable fonts. The default one (25,884 B) is `BodoniModa11pt-Regular`: the
 * 11-point *text* cut, with the optical-size axis physically absent. The one committed
 * here (46,260 B) is `BodoniModa-Regular`, carrying `wght 400-900` **and `opsz 6-96`**.
 * Since `font-optical-sizing: auto` is the browser default, a 72px campaign headline
 * automatically gets the fine display cut and a 24px section title gets a sturdier one —
 * for free, but only because the axis is in the file. Ship the wrong 26 KB and the
 * headlines quietly become a competent serif instead of a fashion Didone.
 *
 * Note its small x-height (0.46 em) and loose default line box (1.525 em): the type
 * scale sets explicit tight line-heights for every display level rather than inheriting.
 */
export const displaySerif = localFont({
  src: './BodoniModa-Variable-latin.woff2',
  /*
   * Required, even though the font is variable. The loader emits a `font-weight`
   * descriptor only when one is supplied; omit it and the @font-face has none, the
   * browser pins the face to `normal`, and the entire weight axis is silently dead.
   */
  weight: '400 900',
  style: 'normal',
  variable: '--font-north-display',
  /*
   * `swap` means no FOIT and a brief FOUT. `adjustFontFallback` is what removes the
   * cost of that FOUT: next/font reads the real file's metrics and generates a
   * size-adjusted fallback @font-face, so the swap does not move the layout. It is the
   * combination, not `display` alone, that answers §3.1b's "avoid FOIT/FOUT".
   */
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
  fallback: ['Didot', 'Bodoni MT', 'Georgia', 'serif'],
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
})

/**
 * UI sans — Instrument Sans, a grotesque.
 *
 * The guide (§03) asks for "neutral, precise, highly legible, contemporary, minimal",
 * used for navigation, labels, product metadata, pricing and controls — which in this
 * design is overwhelmingly small tracked uppercase sitting against serif cap lines.
 *
 * Two measurable reasons it beat the alternatives:
 *
 *   - **Cap height.** Uppercase labels align on caps, not x-height. Bodoni Moda's cap is
 *     0.750 em; Instrument Sans is 0.720 (≈4% off), Inter 0.7275, Archivo 0.686 — nearly
 *     9% short, which makes a nav label look visibly smaller than the serif beside it at
 *     the same pixel size.
 *   - **Its weight range is 400-700.** The guide says "avoid excessive font-weight
 *     variation"; a face that only offers four weights enforces that structurally rather
 *     than leaving it to discipline. Inter, Archivo and Geist all offer 100-900.
 *
 * The upstream family also carries a width axis (75-100). The wght-only file is
 * committed deliberately: nothing in the guide needs condensed type, and a wdth-axis
 * file additionally requires a `font-stretch` descriptor that this loader never emits —
 * omit it and the axis silently clamps.
 */
export const uiSans = localFont({
  src: './InstrumentSans-Variable-latin.woff2',
  weight: '400 700',
  style: 'normal',
  variable: '--font-north-sans',
  display: 'swap',
  adjustFontFallback: 'Arial',
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
})

/**
 * Applied to `<html>` so both custom properties are in scope for portalled overlays,
 * which Radix renders into `document.body`.
 *
 * Called from the (frontend) root layout only. The Payload admin has its own root layout
 * and keeps Payload's own typography — see D-08.
 */
export const fontVariables = `${displaySerif.variable} ${uiSans.variable}`
