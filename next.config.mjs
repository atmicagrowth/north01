import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Media, image remote patterns, redirects and headers are added by the phases that
  // introduce them. Keep this surface minimal - see docs/ARCHITECTURE.md.
}

// Payload must wrap the Next config: it injects the aliases and server-external packages
// the CMS needs in order to run inside the same Next.js deployable.
export default withPayload(nextConfig, { devBundleServerPackages: false })
