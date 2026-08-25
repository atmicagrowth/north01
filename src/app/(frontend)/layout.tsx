import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { fontVariables } from './fonts'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'NORTH / 01',
    template: '%s · NORTH / 01',
  },
  description: 'An online-only direct-to-consumer premium apparel storefront.',
}

/**
 * Root layout for the storefront route group.
 *
 * The Payload admin lives in a sibling route group with its own root layout, so the two
 * document shells — and their stylesheets and typefaces — stay completely independent.
 * That separation is what keeps Tailwind's Preflight and these fonts out of `/admin`,
 * and it is load-bearing: see D-08.
 *
 * The font custom properties go on `<html>` rather than `<body>` so they are also in
 * scope for Radix's portalled overlays, which mount into `document.body`.
 *
 * The global header and footer are **not** mounted here. Phase 3 builds and proves those
 * components; plan §9.1a mounts them, together with the mega menu, the search overlay
 * and the cart drawer that make their controls do something.
 */
export default function FrontendLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>{children}</body>
    </html>
  )
}
