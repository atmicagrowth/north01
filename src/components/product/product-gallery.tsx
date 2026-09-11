'use client'

import { useRef, useState } from 'react'

import { MediaImage, toAsset } from '@/components/media/media-image'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/cn'
import { publicEnv } from '@/lib/env.public'
import { buildCloudinaryUrl } from '@/lib/media/cloudinary-url'
import { isRovingKey, rovingIndex } from '@/lib/product/roving'
import { PRODUCT_IMAGE_SIZES } from '@/lib/product/sizes'
import type { Media } from '@/payload-types'

/**
 * **Plan §13.1a's gallery.** Desktop, mobile swipe, thumbnails, full-screen, zoom, video.
 *
 * ### One scroller, two layouts, no duplicated markup
 *
 * The desktop gallery and the mobile swipe gallery are **the same list**, laid out differently by
 * CSS: a horizontal snap scroller below `lg`, a vertical stack above it. Rendering the frames twice
 * and hiding one would double the images the browser downloads on the route whose LCP is a
 * photograph — and it is exactly how two galleries drift into showing different things.
 *
 * `snap-x` sits on the **scroller**, not on the list inside it. Phase 10's audit found that mistake
 * in the homepage rail: on a non-scrolling `<ul>` the property is inert, so the snapping the
 * docblock described did nothing for a whole phase.
 *
 * ### Zoom is the full-screen viewer, not a hover lens
 *
 * §13.1a asks for a full-screen viewer *and* zoom "where appropriate". They are one control here.
 * A hover-magnifier is a pointer-only affordance — no keyboard path, nothing on a phone, and the
 * thing it magnifies is a crop of an image the customer can already see. Opening the frame at
 * `productZoom` (Phase 8's largest context) gives every input the same capability and gives a phone
 * the pinch-zoom its own operating system already provides.
 *
 * ### The thumbnails are radios, and that is not decoration
 *
 * Choosing which of several photographs is showing is a single-choice control, so `role="radiogroup"`
 * with roving `tabIndex` is the pattern that says so. A row of buttons announces "button, button,
 * button" and never tells a screen-reader user which one is current or how many there are.
 *
 * Roving `tabIndex` is only half of that pattern, and the half that takes something away: it leaves
 * one tab stop, so without arrow keys every thumbnail but the current one becomes unreachable. The
 * `onKeyDown` below is the other half, and `lib/product/roving.ts` holds its arithmetic.
 */
export function ProductGallery({
  alt,
  frames,
  video,
}: {
  /** The product name. The gallery is not decorative — it is the product. */
  alt: string
  frames: (Media | null)[]
  video: Media | null
}) {
  const [active, setActive] = useState(0)
  const [zoomed, setZoomed] = useState<null | number>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const thumbnails = useRef<(HTMLButtonElement | null)[]>([])

  /*
   * Which frame opened the viewer, and the button it was opened from.
   *
   * Radix returns focus to the element that triggered a dialog — but only when it knows what that
   * was, which means a `DialogTrigger`. This dialog has none: it is opened from whichever frame the
   * customer activated, so there are as many triggers as there are photographs. Without these, close
   * put focus on `<body>`, and a keyboard customer who opened the zoom and pressed Escape landed at
   * the top of the document with the whole page to tab through again. Found in Phase 13's first
   * sweep; the size guide never had it, because that one does have a trigger.
   */
  const frameButtons = useRef<(HTMLButtonElement | null)[]>([])
  const openedFrom = useRef(0)

  const usable = frames.filter((frame): frame is Media => frame !== null)

  /*
   * A product with no photographs still renders a frame: `MediaImage` reserves the box from the
   * delivery context and paints its placeholder, so the page has the same shape whether or not an
   * editor has uploaded anything. §8.1d, and the reason `frames` is allowed to be empty.
   */
  const shown = usable.length > 0 ? usable : [null]

  const show = (index: number) => {
    setActive(index)

    const scroller = scrollerRef.current
    const target = scroller?.children[index] as HTMLElement | undefined

    /* `nearest` so the desktop column does not jump when a thumbnail is clicked. */
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  return (
    /*
     * **Phase 35 (P35-30): below `lg` the gallery is at most 52svh wide, centred.** A full-width 4:5
     * frame on a phone is 125% of the screen's width tall, so the name, the price and Add to bag
     * began below the fold. Capping the width caps the height at 65svh.
     *
     * The cap is on the whole gallery rather than on each frame. The swipe scroller works out which
     * photograph is showing by dividing `scrollLeft` by its own width, which is only right while a
     * frame and the scroller are the same width — a narrower frame would put the next photograph in
     * view and the thumbnails out of step.
     */
    <div
      className="flex flex-col gap-m max-lg:mx-auto max-lg:w-[min(100%,52svh)]"
      data-slot="product-gallery"
    >
      <div
        aria-label={`${alt} — photographs`}
        className={cn(
          'flex snap-x snap-mandatory gap-2 overflow-x-auto',
          'lg:snap-none lg:flex-col lg:gap-m lg:overflow-visible',
        )}
        /*
         * **A swipe moves the thumbnails too.** `active` was set only by `show()` — a thumbnail click
         * or an arrow key — so a customer who swiped to the second photograph saw the first
         * thumbnail still selected, and a screen reader was told the same. The frame width is the
         * scroller's `clientWidth`, so the nearest index is a division. The desktop stack never
         * scrolls sideways and returns at once.
         */
        onScroll={(event) => {
          const scroller = event.currentTarget

          if (scroller.scrollWidth <= scroller.clientWidth) return

          const nearest = Math.min(
            shown.length - 1,
            Math.round(scroller.scrollLeft / scroller.clientWidth),
          )

          if (nearest !== active) setActive(nearest)
        }}
        ref={scrollerRef}
        role="group"
        tabIndex={0}
      >
        {/*
          `relative` is load-bearing and invisible. `sr-only` is `position: absolute`, so without a
          positioned ancestor its containing block is the *initial* one — the document — and an
          absolutely positioned box is **not clipped by an `overflow-x: auto` ancestor that is not
          its containing block**. Both spans below therefore escaped their scrollers and extended
          `documentElement.scrollWidth`, giving the product page a horizontal scrollbar at 320, 375,
          430 and 768px: measured 448px of scroll width in a 320px viewport, from two 1px spans.

          Scoping the containing block to the button puts them back inside the scroller, which does
          clip them. Nothing moves; the page simply stops being 128px wider than the phone.
        */}
        {shown.map((frame, index) => (
          <button
            /*
             * The ring is drawn INSIDE the frame below `lg`: the frame fills the snap scroller
             * exactly, and the scroller clipped the outer ring on all four sides, so a keyboard user
             * tabbing through the photographs on a phone saw no focus at all.
             */
            className="relative w-full shrink-0 snap-start max-lg:focus-visible:outline-offset-[-4px] lg:cursor-zoom-in"
            /*
             * **Keyed by position, not by media id.** Choosing a size prepends the variant's own
             * photograph (`product-page.tsx`), and it arrives with the server render about a second
             * after the tap — outside the 500ms input window, so it counts as layout shift. Keyed by
             * id, React inserted a NEW leading frame and pushed the rest down: one entry of **0.36
             * CLS** at 1440, on the most important interaction on the page. Keyed by index, the
             * leading 4:5 box is the same node and only its image changes; the displaced frame lands
             * at the end, below the fold on desktop and off-screen in the phone scroller.
             */
            key={index}
            onClick={() => {
              openedFrom.current = index
              setZoomed(index)
            }}
            ref={(node) => {
              frameButtons.current[index] = node
            }}
            type="button"
          >
            <span className="sr-only">View larger</span>
            <MediaImage
              alt={index === 0 ? alt : ''}
              context="productGallery"
              media={frame}
              priority={index === 0}
              sizes={PRODUCT_IMAGE_SIZES.gallery}
            />
          </button>
        ))}
      </div>

      {shown.length > 1 ? (
        <div
          aria-label="Choose a photograph"
          /* `-m-1 p-1`: room for the focus ring inside the row that scrolls, as `product-rail` does. */
          className="-m-1 flex gap-2 overflow-x-auto p-1"
          onKeyDown={(event) => {
            if (!isRovingKey(event.key)) {
              return
            }

            event.preventDefault()

            /*
             * Selection follows focus here, unlike the variant selector. Changing which photograph
             * is shown is client state and costs nothing, which is the case ARIA 1.2 describes the
             * radio pattern for; the selector opts out only because each of its selections is a
             * server navigation.
             */
            const from = thumbnails.current.findIndex((node) => node === document.activeElement)
            const next = rovingIndex(from, shown.length, event.key)

            thumbnails.current[next]?.focus()
            show(next)
          }}
          role="radiogroup"
        >
          {shown.map((frame, index) => (
            <button
              aria-checked={index === active}
              className={cn(
                'relative w-16 shrink-0 border transition-colors duration-(--duration-fast)',
                index === active
                  ? 'border-border-strong'
                  : 'border-transparent hover:border-border',
              )}
              /* By position, for the reason on the frames above. */
              key={index}
              onClick={() => show(index)}
              ref={(node) => {
                thumbnails.current[index] = node
              }}
              role="radio"
              tabIndex={index === active ? 0 : -1}
              type="button"
            >
              <span className="sr-only">{`Photograph ${index + 1} of ${shown.length}`}</span>
              <MediaImage
                alt=""
                context="thumbnail"
                media={frame}
                sizes={PRODUCT_IMAGE_SIZES.thumbnail}
              />
            </button>
          ))}
        </div>
      ) : null}

      {video ? (
        /*
         * §13.1a's "optional video", and plan §6.1b's rule for it: an ADDITION to the gallery, never
         * a replacement. No autoplay and no loop — `controls` puts it under the customer's thumb,
         * and a garment video that starts itself is the thing visual guide §08 means by keeping
         * motion slow and deliberate.
         *
         * **No `<track>`.** It carried an empty `<track kind="captions" />` until Phase 13's first
         * sweep: `src` is required on that element, so the markup was invalid, nothing was ever
         * loaded, and it asserted the existence of a caption track that does not exist. `Media` has
         * no captions field for one to point at. Shipping no track is the honest state; a product
         * video carrying speech would fail WCAG 1.2.2, and closing that needs a field on the
         * collection rather than an empty element here.
         */
        <video
          aria-label={`${alt} — video`}
          className="w-full"
          controls
          preload="none"
          poster={posterUrl(shown[0])}
          src={video.url ?? undefined}
        />
      ) : null}

      <Dialog open={zoomed !== null} onOpenChange={(open) => setZoomed(open ? zoomed : null)}>
        <DialogContent
          /*
           * `p-s`, not `p-0`: the dialog's Close is pulled out by `-mr-2 -mt-2`, which assumes padding
           * to pull into. With none, the auto-focused Close was cut 12px on two sides — its ring
           * entirely, and some of the button.
           */
          className="max-w-none bg-canvas p-s"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            frameButtons.current[openedFrom.current]?.focus()
          }}
          title={`${alt} — full screen`}
          titleHidden
        >
          <div className="max-h-[90vh] overflow-auto">
            <MediaImage
              alt={alt}
              context="productZoom"
              media={zoomed === null ? null : shown[zoomed]}
              sizes={PRODUCT_IMAGE_SIZES.zoom}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * **The video's poster, through the CDN like every other image.** It was `media.url` — the untransformed
 * Cloudinary original, which for the seeded field jacket is a **696 KB PNG** where the `f_auto`
 * derivative at a gallery width is 21 KB of WebP. A browser fetches `poster` eagerly even with
 * `preload="none"`, so the first product given a video would have put the PNG on its page. Latent
 * today — no seeded product has a video — and one line to get wrong later.
 *
 * Without Cloudinary the stored same-origin URL is the only thing there is, which is `MediaImage`'s
 * own fallback.
 */
function posterUrl(frame: Media | null | undefined): string | undefined {
  if (!frame) return undefined

  const cloudName = publicEnv.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  const asset = toAsset(frame)

  return cloudName && asset
    ? buildCloudinaryUrl({ asset, cloudName, context: 'productGallery', width: 1024 })
    : (frame.url ?? undefined)
}
