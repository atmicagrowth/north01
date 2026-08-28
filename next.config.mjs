import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Media, image remote patterns, redirects and headers are added by the phases that
  // introduce them. Keep this surface minimal - see docs/ARCHITECTURE.md.

  experimental: {
    /**
     * The one experimental flag in this project, and it is here because decision D-08 put it here.
     *
     * Two root layouts means there is no single layout from which a root `app/not-found.tsx` can be
     * composed, and Next's own not-found documentation names that as the case `global-not-found.js`
     * exists for. Without it, every URL the storefront navigation points at before its phase is
     * built lands on Next's built-in 404 - no header, no footer, no way back into the shop.
     *
     * Phase 9, decision D-31. `src/app/global-not-found.tsx` is the whole of it: delete the file and
     * this flag together and the behaviour reverts, losing nothing else.
     */
    globalNotFound: true,
  },
}

// Payload must wrap the Next config: it injects the aliases and server-external packages
// the CMS needs in order to run inside the same Next.js deployable.
export default withPayload(nextConfig, { devBundleServerPackages: false })
