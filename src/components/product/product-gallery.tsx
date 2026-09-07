'use client'

import { useRef, useState } from 'react'

import { MediaImage } from '@/components/media/media-image'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/cn'
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
    <div className="flex flex-col gap-m" data-slot="product-gallery">
      <div
        aria-label={`${alt} — photographs`}
        className={cn(
          'flex snap-x snap-mandatory gap-2 overflow-x-auto',
          'lg:snap-none lg:flex-col lg:gap-m lg:overflow-visible',
        )}
        ref={scrollerRef}
        role="group"
        tabIndex={0}
      >
        {shown.map((frame, index) => (
          <button
            className="w-full shrink-0 snap-start lg:cursor-zoom-in"
            key={frame?.id ?? index}
            onClick={() => setZoomed(index)}
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
          className="flex gap-2 overflow-x-auto"
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
                'w-16 shrink-0 border transition-colors duration-(--duration-fast)',
                index === active
                  ? 'border-border-strong'
                  : 'border-transparent hover:border-border',
              )}
              key={frame?.id ?? index}
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
         */
        <video
          className="w-full"
          controls
          preload="none"
          poster={shown[0]?.url ?? undefined}
          src={video.url ?? undefined}
        >
          <track kind="captions" />
        </video>
      ) : null}

      <Dialog open={zoomed !== null} onOpenChange={(open) => setZoomed(open ? zoomed : null)}>
        <DialogContent
          className="max-w-none bg-canvas p-0"
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
