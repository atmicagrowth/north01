'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * **The editorial reveal.** Visual guide §08: *"Keep it slow. Keep it subtle. Prefer crossfades and
 * gentle reveals."*
 *
 * This is the whole of Phase 10's motion, and it is what **DEV-40** ships instead of the animation
 * library **DEV-24** deferred to this phase. The argument is in that deviation; the two facts that
 * decided it are that `motion` costs ~40 KB gzip on the site's LCP route, and that it defaults to
 * `reducedMotion: "never"` and animates opacity through the Web Animations API — which does not read
 * the duration tokens, so `prefers-reduced-motion` would have needed a *second* implementation
 * beside the one `globals.css` already has. Decision **D-13** exists to prevent exactly that second
 * place where motion is defined.
 *
 * ### Content is never stranded invisible
 *
 * The hidden state exists **only inside this effect**. No server markup, no stylesheet and no other
 * component can produce `data-reveal="closed"`, so every one of these renders the content:
 * JavaScript disabled, before hydration, a failed hydration, a browser without
 * `IntersectionObserver`, and print. This is the property that ruled out CSS scroll-driven
 * animation (`animation-timeline: view()`), where a subject inside an `overflow: hidden` ancestor
 * binds its timeline to an unscrollable container and sits at `opacity: 0` permanently.
 *
 * The second guard is `boundingClientRect.top > 0`: only a section **below** the reader's current
 * position is ever hidden. A block already on screen at load — which on a short page may be all of
 * them — is left alone rather than faded in over content the reader is looking at.
 *
 * `disconnect()` on first intersection makes it one-shot. Scrolling back up does not fade a section
 * out again; §08's *"avoid motion that competes with the subject"* rules that out, and it is the
 * other reason a scroll-linked timeline is wrong here — a scrub un-reveals.
 *
 * ### Why the attribute is written imperatively
 *
 * React never owns `data-reveal`. Setting it through state would re-render a large server-rendered
 * subtree on scroll and put a hydration mismatch between the server's markup (no attribute) and the
 * client's first paint. Writing it on the node touches one attribute and re-renders nothing.
 *
 * `children` crosses the boundary as a **prop**, so everything inside stays a server component. This
 * is one of only two client components on the homepage.
 *
 * ### The one rule for callers
 *
 * Wrap a block-level section in normal document flow. `IntersectionObserver` clips against the
 * nearest scrollable ancestor, so a `Reveal` inside an `overflow: hidden` or `overflow: auto`
 * container measures against that box rather than the viewport. The `top > 0` guard covers the
 * common case; nothing covers a caller who nests one inside a horizontal rail.
 *
 * The LCP section is never wrapped — see `home-sections.tsx`. Fading in the largest contentful paint
 * would be a self-inflicted LCP regression on the one route plan §37 measures.
 */
export function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current

    if (!element || typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) {
          return
        }

        /*
         * Open when the section is in view — **or when the reader has already passed it**.
         *
         * The second half is not belt-and-braces, it is the fix for a measured defect. An
         * `IntersectionObserver` only reports a *threshold crossing*, so a section that goes from
         * below the viewport to above it in one jump — the End key, a scrollbar drag, an anchor
         * link, a browser restoring a scroll position — moves from ratio 0 to ratio 0 and **fires
         * no callback at all**. Measured before the fix: scrolling straight to the foot of the
         * homepage left six sections armed `closed` and stranded at `opacity: 0` for the rest of
         * the session, which is precisely what this component's docblock claims cannot happen.
         *
         * The `rootMargin` is what makes it reportable: extending the root upwards means anything
         * above the viewport *is* intersecting, so the skipped sections get a callback and open.
         * The explicit `top <= 0` branch then covers the remaining case — a section further above
         * than the margin reaches.
         */
        if (entry.isIntersecting || entry.boundingClientRect.top <= 0) {
          element.dataset.reveal = 'open'
          observer.disconnect()

          return
        }

        /*
         * Still below the reader. `dataset.reveal` being unset is what makes this happen at most
         * once: after the first observation the section is either open or armed, and a later
         * callback must never re-hide it.
         */
        if (!element.dataset.reveal) {
          element.dataset.reveal = 'closed'
        }
      },
      {
        // A little of the section has to be in view. Not 0, or it opens while still off-screen.
        threshold: 0.08,
        // Upwards only. The bottom edge stays at the viewport, so what is *below* still arms.
        rootMargin: '100000px 0px 0px 0px',
      },
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return <div ref={ref}>{children}</div>
}
