import type { Metadata } from 'next'
import type { ReactNode } from 'react'

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
 * document shells - and their stylesheets - stay completely independent.
 *
 * Typography, the global header/footer shell and the design system land in Phase 3.
 */
export default function FrontendLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
