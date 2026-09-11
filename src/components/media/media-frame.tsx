'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/**
 * **The frame around a delivered image, and the one piece of `MediaImage` that runs in the browser**
 * — Phase 36, audit R1-29.
 *
 * When delivery fails (Cloudinary down, a 404, a blocked host) a bare `<img>` shows the browser's
 * broken-image icon. This frame covers it with the same neutral box `MediaImage` renders when there is
 * no asset at all, inside the rectangle already reserved by `aspect-ratio` — so a failure changes what
 * is painted and never the layout.
 *
 * The `<picture>`/`<img>` markup arrives as `children` and is still rendered on the server, so `src`,
 * `srcset` and `fetchpriority` are in the HTML and a priority (LCP) image starts downloading exactly
 * as before. Only the failure listener is client code.
 *
 * An `error` event does not bubble, so it is caught in the **capture** phase on this element. An image
 * that failed before hydration fired its event before any listener existed; the mount check catches
 * that one (`complete` with no `naturalWidth` is the broken state — a lazy image not yet requested is
 * not `complete`).
 *
 * The `<img>` stays in the tree underneath: its `alt` is still the accessible name of what should have
 * been there, and the cover is `aria-hidden` like the placeholder it copies.
 */
export function MediaFrame({
  children,
  className,
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const frame = ref.current

    if (!frame) return

    const onError = (event: Event) => {
      if (event.target instanceof HTMLImageElement) setFailed(true)
    }

    frame.addEventListener('error', onError, true)

    const img = frame.querySelector('img')

    if (img && img.complete && img.naturalWidth === 0 && img.currentSrc !== '') {
      setFailed(true)
    }

    return () => frame.removeEventListener('error', onError, true)
  }, [])

  return (
    <div
      ref={ref}
      data-slot="media-image"
      data-failed={failed ? '' : undefined}
      className={className}
      style={failed ? { ...style, backgroundImage: 'none' } : style}
    >
      {children}
      {failed ? (
        <span
          aria-hidden
          data-slot="media-placeholder"
          className="absolute inset-0 bg-surface ring-1 ring-inset ring-border"
        />
      ) : null}
    </div>
  )
}
