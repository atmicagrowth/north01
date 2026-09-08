/**
 * **Cloudinary delivery URLs, built as strings.**
 *
 * This module has no imports, reads no environment, and holds no secret. That is not a stylistic
 * choice — it is the finding the whole delivery layer rests on. A Cloudinary delivery URL is pure
 * concatenation: the SDK's own `generate_transformation_string` is `key + '_' + value`, sorted and
 * joined, and nothing else. Measured against the live CDN with no credentials, every transformation
 * this project needs returns 200 unsigned.
 *
 * So the browser needs no SDK, the server needs no round trip to produce a URL, and
 * `CLOUDINARY_API_SECRET` never comes within reach of either. Plan §8's prompt — *"Never expose
 * Cloudinary server secrets to the browser"* — is satisfied by the shape of this file rather than by
 * a rule someone has to keep obeying. The `cloudinary` SDK is imported in exactly one place,
 * `payload/storage/cloudinary.ts`, which the client graph cannot reach.
 *
 * It is deliberately **not** built on that SDK even where it could be, because the SDK appends a
 * `?_a=<token>` analytics parameter to every URL it generates unless `analytics: false` is passed. A
 * URL builder that phones home is the wrong thing to put in an `img` tag on every page.
 *
 * The parallel is `lib/password-policy.ts`: a rule that two very different callers must agree on, so
 * it lives alone with nothing to disagree about.
 */

/* -------------------------------------------------------------------------------------------------
 * The delivery contexts of plan §8.1c
 * ---------------------------------------------------------------------------------------------- */

/**
 * **The aspect ratios below are this project's invention. The widths are not.**
 *
 * A sweep of all six specification documents for image dimensions and ratios returns nothing: the
 * only numbers in the corpus are the type scale, the spacing scale and a 1px divider. §8.1c names six
 * contexts and gives geometry for none of them, so every ratio here is a decision recorded in the
 * notes rather than compliance with a line somebody wrote.
 *
 * The **widths** are different, and an earlier draft of this file got that wrong by inventing them
 * too. Plan §30.1a names the breakpoints this design is built and tested at — *320, 375, 430, 768,
 * 1024, 1280, 1440, 1920* — and every width below is one of those or a device-pixel-ratio multiple of
 * one. A `srcset` whose candidates line up with the layout's own breakpoints is the difference
 * between a browser picking the intended file and picking one 40% too large.
 *
 * Three rules in the corpus constrain the shape of the answer, and only three:
 *
 * - §30.1b, verbatim: *"Fixed/known image aspect ratios."* — listed under **Layout shift
 *   prevention**, which is the same requirement §8.1d states from the other end. A context that
 *   declares its ratio is what lets a box be reserved before anything is fetched.
 * - Visual guide §10: *"Use intentional mobile crops instead of simply squeezing desktop images into
 *   a smaller box."* — so `heroDesktop` and `heroMobile` are different **ratios**, not one ratio at
 *   two widths. Art direction, not resizing.
 * - Visual guide §07: *"Consistent product photography"* beside *"Strong crop"* — the product
 *   contexts take one enforced ratio so a grid reads as a grid.
 *
 * §08 (*"Imagery Direction"*) and §09 (*"Page-Level Art Direction"*) are **not** used, even though
 * they sound like the relevant sections. Each is explicitly scoped by its own preamble — *"the
 * photography language to use when assets are added"*, *"This section describes composition only"* —
 * and neither names a ratio, a crop or a width. Deriving geometry from them was tried and rejected as
 * an over-reach.
 */
export const MEDIA_CONTEXTS = {
  /** Full-bleed campaign frame at the top of a page. Cinematic, text laid over it. */
  heroDesktop: {
    aspectRatio: 16 / 9,
    crop: 'fill',
    widths: [768, 1024, 1280, 1440, 1920, 2560],
  },
  /**
   * The campaign frame when the statement is set *over* it — the full-bleed hero.
   *
   * 5:2 rather than 16:9, because the frame this was built for is a 2.5:1 panorama and a 16:9 crop
   * of it would cut both ends off a photograph chosen for its width. The band's height follows the
   * same ratio at the widths that matter, so the picture is very nearly uncropped.
   */
  heroWide: {
    aspectRatio: 5 / 2,
    crop: 'fill',
    widths: [768, 1024, 1280, 1440, 1920, 2560],
  },
  /** The same moment, re-framed upright — §10's "intentional mobile crop". */
  heroMobile: {
    aspectRatio: 4 / 5,
    crop: 'fill',
    widths: [320, 375, 430, 640, 750, 860],
  },
  /** A tile in a listing grid. One ratio for every product, so the grid is a grid. */
  productCard: {
    aspectRatio: 4 / 5,
    crop: 'fill',
    widths: [320, 375, 430, 640, 768, 860],
  },
  /** The main image on a product page. Same ratio as the card, so nothing jumps on navigation. */
  productGallery: {
    aspectRatio: 4 / 5,
    crop: 'fill',
    widths: [640, 768, 1024, 1280, 1440],
  },
  /**
   * The zoom / full-screen view. **Uncropped**, and that is the point: zooming into the cropped
   * gallery frame would magnify the crop rather than reveal the parts of the garment it removed.
   */
  productZoom: {
    aspectRatio: null,
    crop: 'limit',
    widths: [1280, 1440, 1920, 2560],
  },
  /**
   * Editorial and lookbook imagery, at the photographer's own framing.
   *
   * **Uncropped for a structural reason, not only an aesthetic one.** Phase 6 put shop-the-look
   * hotspots on lookbook images and recorded that their positions are *"percentages, so they survive
   * every crop and breakpoint"* (`Lookbooks.ts`). That guarantee only holds while the delivered image
   * has the same framing as the one the editor placed the hotspots on — a `c_fill` here would move
   * every hotspot off its garment. So this context crops nothing, and any surface carrying hotspots
   * must use it.
   */
  editorial: {
    aspectRatio: null,
    crop: 'limit',
    widths: [640, 768, 1024, 1280, 1920],
  },
  /** Square, small, and used wherever an image refers to something rather than being the thing. */
  thumbnail: {
    aspectRatio: 1,
    crop: 'fill',
    widths: [96, 160, 192, 320],
  },
  /**
   * The Open Graph / social share card.
   *
   * **This one has a dimension the repository already committed to.** `fields/seo.ts` — written in
   * Phase 6 — tells editors *"Social share card. Landscape, roughly 1200 × 630"*, so Phase 8 either
   * honours that or makes a Phase 6 field description a lie. 1200 × 630 is also the size every social
   * platform documents, and a single fixed size is correct here: a crawler fetches one URL and does
   * no negotiation, which is why there is exactly one width and why `f_auto` is inappropriate for it
   * (see `buildSocialCardUrl`).
   */
  socialCard: {
    aspectRatio: 1200 / 630,
    crop: 'fill',
    widths: [1200],
  },
} as const satisfies Record<string, ContextDefinition>

type ContextDefinition = {
  /** `null` means "deliver at the source's own framing" — see `editorial`. */
  aspectRatio: null | number
  crop: 'fill' | 'limit'
  widths: readonly number[]
}

export type MediaContext = keyof typeof MEDIA_CONTEXTS

/* -------------------------------------------------------------------------------------------------
 * Building one URL
 * ---------------------------------------------------------------------------------------------- */

export type CloudinaryAsset = {
  /** Cloudinary's own identifier for the asset, folder path included. No file extension. */
  publicId: string
  /**
   * Which delivery namespace the asset lives in. **Read from the stored column, never derived from
   * `mimeType`** — see `Media.ts`, where `cloudinaryResourceType` explains why the stored MIME type
   * cannot be trusted for this.
   */
  resourceType?: 'image' | 'video'
  /** The upload version. Included in the URL so a replaced asset busts every cache at once. */
  version?: null | number
  /** The stored pixel width of the **original**. The clamp below is the reason this matters. */
  width?: null | number
  height?: null | number
  /** Payload's focal point, 0–100 on each axis. */
  focalX?: null | number
  focalY?: null | number
}

export type BuildUrlOptions = {
  cloudName: string
  asset: CloudinaryAsset
  context: MediaContext
  /** One of the context's widths, or any width — it is clamped either way. */
  width: number
}

/**
 * **The clamp is the load-bearing line in this file, and the naive version of it is wrong.**
 *
 * Measured against the live CDN with an 864×576 source:
 *
 * | asked for | delivered |
 * |---|---|
 * | `c_fill,ar_4:5,w_400` | 400×500 — correct |
 * | `c_fill,ar_4:5,w_2000` | **2000×2500** — upscaled; 302 KB of soft pixels |
 * | `c_lfill,ar_4:5,w_2000` | **864×576** — the aspect ratio is silently abandoned |
 *
 * `c_lfill` is Cloudinary's documented "fill but do not enlarge" mode and it is a trap: when the
 * request exceeds the source it returns the original untouched, ratio and all. A box reserved at 4:5
 * that receives a 3:2 image is exactly the layout shift §8.1d and §30.1b forbid, arriving through the
 * option that looks like the safe one. So neither mode is used blind; the width is clamped here and
 * plain `c_fill` then always holds its contract.
 *
 * **Clamping to the source width alone is not enough**, which the first version got wrong and a
 * delivered image caught: asking that same 864×576 landscape for the 4:5 mobile hero at its own width
 * returned **864×1080** — inside the width budget and nearly double the source *height*.
 *
 * When a crop changes the aspect ratio, the binding constraint moves. `c_fill` first cuts the largest
 * region of ratio `R` that fits, then scales it. From a source `W×H` that region is `H·R × H` when
 * `R < W/H` and `W × W/R` otherwise, so the largest output width that never enlarges anything is
 * `min(W, H·R)`. For 864×576 at 4:5 that is **460**, not 864.
 *
 * When the stored dimensions are unknown the request is left unclamped. That is not hypothetical:
 * Payload's dimension probe reads no video container, so **every video row has null width and
 * height**. An upscale is a cosmetic problem; refusing to render is not an improvement on it.
 */
function clampWidth(
  requested: number,
  asset: Pick<CloudinaryAsset, 'height' | 'width'>,
  aspectRatio: null | number,
): number {
  const { width, height } = asset

  if (!width || width <= 0) {
    return requested
  }

  if (aspectRatio === null || !height || height <= 0) {
    return Math.min(requested, width)
  }

  return Math.min(requested, width, Math.floor(height * aspectRatio))
}

/**
 * Where Cloudinary should crop from, when it has to choose.
 *
 * An editor-set focal point wins, because a person looked at the picture. Payload stores it as two
 * 0–100 percentages; Cloudinary's `x_`/`y_` want **pixels**.
 *
 * **`fl_relative` is not the bridge between them, and finding that out cost a 400.** The flag reads
 * plausibly — "make the coordinates relative" — and the first version of this function used it with
 * fractional `x_0.2000,y_0.8000`. Measured against the live CDN, that request returns
 * `400 Maximum image width/height is 65500. Requested 345600x432000`: `fl_relative` makes the values
 * *multiply* the source dimensions rather than address a point within them, so a focal point at 20%
 * asked Cloudinary for an image four hundred times too large. `fl_region_relative` fails identically.
 * Plain pixel coordinates with no flag return 200.
 *
 * So the percentages are converted here, against the dimensions stored at upload. When those are
 * unknown there is nothing to convert against and the honest answer is `g_auto` rather than a
 * coordinate that means nothing.
 *
 * `50,50` is Payload's default for an untouched image, so it is read as "nobody chose" and also
 * handed to `g_auto`. That is deliberately a small lie: an editor who genuinely wants dead centre
 * gets content-aware gravity instead. It is the better failure — `g_auto` on a centred subject
 * returns the centre anyway, whereas treating every default as a deliberate choice would disable
 * content-aware cropping across the whole library.
 */
function gravity(asset: CloudinaryAsset): string {
  const { focalX, focalY, width, height } = asset

  const chosen =
    typeof focalX === 'number' && typeof focalY === 'number' && !(focalX === 50 && focalY === 50)

  if (!chosen || !width || !height) {
    return 'g_auto'
  }

  const x = Math.round((Math.min(100, Math.max(0, focalX as number)) / 100) * width)
  const y = Math.round((Math.min(100, Math.max(0, focalY as number)) / 100) * height)

  return `g_xy_center,x_${x},y_${y}`
}

/**
 * A public id is ours, not the caller's — but it reaches this function as data, so it is treated as
 * untrusted.
 *
 * The public id occupies the final path segment, *after* the transformation components, so it cannot
 * introduce a transformation. What it can do is climb: a `..` segment in a URL path is resolved by
 * the fetching agent, not by Cloudinary, so `folder/../../other` is a request for something else
 * entirely. Segments are therefore filtered, and each is percent-encoded — with `/` preserved,
 * because Cloudinary folders are genuinely path segments.
 *
 * The adapter sanitises on the way in as well (`payload/storage/cloudinary.ts`). Both ends, because
 * this function is also reached with ids from rows written before that sanitiser existed.
 */
function encodePublicId(publicId: string): string {
  return publicId
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function deliveryPrefix(cloudName: string, asset: CloudinaryAsset): string {
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/${asset.resourceType ?? 'image'}/upload`
}

/**
 * `ar_` accepts either a decimal or a `w:h` pair. The pair is used where one exists, because
 * `ar_4:5` is legible in a URL and `ar_0.8` is not — and because a decimal is a rounding argument
 * waiting to happen.
 */
function ratioToken(ratio: number): string {
  const known: Record<string, string> = {
    [String(16 / 9)]: '16:9',
    [String(4 / 5)]: '4:5',
    [String(3 / 2)]: '3:2',
    [String(1)]: '1:1',
    [String(1200 / 630)]: '1200:630',
  }

  return known[String(ratio)] ?? ratio.toFixed(4)
}

/**
 * One delivery URL for one asset in one context at one width.
 *
 * The transformation is emitted as two chained components — geometry, then encoding — because that is
 * how it reads to a person debugging a URL in an address bar, and because Cloudinary applies chained
 * components in order. `f_auto` and `q_auto` come last so they act on the resized result.
 *
 * `f_auto` is `fetch_format`, **not** `format`: `format` sets the file extension on the public id and
 * emits no `f_` token at all, which is a silent way to lose modern-format delivery entirely.
 * Measured: with `f_auto` and a browser `Accept` header the CDN returns AVIF at roughly 72% of the
 * JPEG bytes.
 */
export function buildCloudinaryUrl({ cloudName, asset, context, width }: BuildUrlOptions): string {
  const definition = MEDIA_CONTEXTS[context]
  const targetWidth = clampWidth(width, asset, definition.aspectRatio)

  const geometry: string[] = [`c_${definition.crop}`, `w_${Math.round(targetWidth)}`]

  if (definition.aspectRatio !== null) {
    // `ar_` rather than a computed `h_`: Cloudinary rounds the derived height itself, so the two
    // never disagree about an odd pixel — the sort of one-pixel drift that shows up as a hairline
    // gap under an object-cover image.
    geometry.push(`ar_${ratioToken(definition.aspectRatio)}`)
    geometry.push(gravity(asset))
  }

  const version = asset.version ? [`v${asset.version}`] : []

  return [
    deliveryPrefix(cloudName, asset),
    geometry.join(','),
    'f_auto,q_auto',
    ...version,
    encodePublicId(asset.publicId),
  ].join('/')
}

/**
 * The `srcset` for a context: every width the context declares, clamped, deduplicated.
 *
 * Deduplication matters *because* of the clamp. A 900px-wide original asked for the product-card
 * widths is fine, but asked for the gallery widths it clamps several to 900 — and a `srcset` listing
 * `900w` three times is both wasteful and, to some parsers, ambiguous. Under a ratio change the clamp
 * bites harder still: a landscape source cropped to 4:5 can be narrower than every width the context
 * lists, leaving a single entry, which is correct.
 */
export function buildSrcSet(options: Omit<BuildUrlOptions, 'width'>): string {
  const definition = MEDIA_CONTEXTS[options.context]
  const seen = new Set<number>()
  const entries: string[] = []

  for (const width of definition.widths) {
    const clamped = Math.round(clampWidth(width, options.asset, definition.aspectRatio))

    if (seen.has(clamped)) {
      continue
    }

    seen.add(clamped)
    entries.push(`${buildCloudinaryUrl({ ...options, width: clamped })} ${clamped}w`)
  }

  return entries.join(', ')
}

/**
 * A 24-pixel, heavily blurred copy of the image.
 *
 * Measured at **120 bytes** as WebP against the live CDN — small enough to inline as a `data:` URI,
 * which is what `components/media/media-image.tsx` does with it: rendered as the CSS background of
 * the box the real image will occupy, so the picture fades in over its own colours rather than over a
 * grey rectangle, and no second network request is made.
 *
 * Returned as a URL rather than a data URI because turning it into one requires a fetch, and that
 * belongs to the server component that has somewhere to cache the result.
 */
export function buildLqipUrl(options: Omit<BuildUrlOptions, 'width'>): string {
  const definition = MEDIA_CONTEXTS[options.context]
  const geometry = [`c_${definition.crop}`, 'w_24']

  if (definition.aspectRatio !== null) {
    geometry.push(`ar_${ratioToken(definition.aspectRatio)}`)
  }

  const version = options.asset.version ? [`v${options.asset.version}`] : []

  return [
    deliveryPrefix(options.cloudName, options.asset),
    geometry.join(','),
    'e_blur:400,f_auto,q_auto:low',
    ...version,
    encodePublicId(options.asset.publicId),
  ].join('/')
}

/**
 * The Open Graph card, which is the one image on the site fetched by something that negotiates
 * nothing.
 *
 * `f_jpg` rather than `f_auto`, deliberately. A social crawler sends no meaningful `Accept` header,
 * and several will not render AVIF or WebP at all; `f_auto` would hand them whatever Cloudinary
 * guesses. A card that fails to render is worse than a card that is 30% larger.
 *
 * **It is clamped like everything else**, which the first version was not — it emitted a flat
 * `w_1200` and was caught upscaling an 864-pixel source into a soft 1200 × 630. The ratio is always
 * exact, so no platform crops the card unpredictably; the *size* follows the source. An editor who
 * uploads a proper card at 1200 or wider gets exactly 1200 × 630, and one who uploads something
 * smaller gets a sharp card at the same shape rather than a blurred one at the nominal size.
 */
export function buildSocialCardUrl(options: Omit<BuildUrlOptions, 'context' | 'width'>): string {
  const definition = MEDIA_CONTEXTS.socialCard
  const version = options.asset.version ? [`v${options.asset.version}`] : []
  const width = Math.round(clampWidth(definition.widths[0], options.asset, definition.aspectRatio))

  return [
    deliveryPrefix(options.cloudName, options.asset),
    [
      `c_${definition.crop}`,
      `w_${width}`,
      `ar_${ratioToken(definition.aspectRatio)}`,
      gravity(options.asset),
    ].join(','),
    'f_jpg,q_auto',
    ...version,
    encodePublicId(options.asset.publicId),
  ].join('/')
}

/**
 * The box an image will occupy, known **before** anything is fetched and before it is known whether
 * the asset exists at all.
 *
 * This is what makes §8.1d's *"preserve layout dimensions"* and §30.1b's *"fixed/known image aspect
 * ratios"* achievable: the geometry comes from the **context**, which is a property of the page, not
 * from the **asset**, which may be absent. A placeholder and a photograph occupy the same rectangle
 * because neither one decides its size.
 *
 * For the natural-ratio contexts the asset's own dimensions are used when they exist. When they do
 * not — an unreadable format, or a **video**, for which Payload's probe reads no container at all —
 * the fallback is 16:9 rather than the source's true shape, because 16:9 is what a video almost
 * always is and being approximately right beats collapsing to zero and then jumping.
 */
export function reserveBox(
  context: MediaContext,
  asset?: Pick<CloudinaryAsset, 'height' | 'width'> | null,
): { height: number; width: number } {
  const definition = MEDIA_CONTEXTS[context]
  const width = definition.widths[definition.widths.length - 1]

  if (definition.aspectRatio !== null) {
    return { width, height: Math.round(width / definition.aspectRatio) }
  }

  if (asset?.width && asset?.height) {
    return { width: asset.width, height: asset.height }
  }

  return { width, height: Math.round(width / (16 / 9)) }
}
