import { withSentryConfig } from '@sentry/nextjs'
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
const withPayloadConfig = withPayload(nextConfig, { devBundleServerPackages: false })

/**
 * Sentry wraps the result — plan §25.1d, Phase 25.
 *
 * **Order matters and it is Sentry outermost.** Payload's wrapper injects module aliases and the
 * server-external package list the CMS cannot run without; Sentry's adds build-time instrumentation
 * on top of a finished config. Wrapping the other way round would hand Payload a config Sentry had
 * already rewritten, which is not the input it validates against.
 *
 * **Source maps are not uploaded**, and that is a decision rather than an omission. Upload needs
 * `SENTRY_AUTH_TOKEN`, which this project deliberately does not set — `pnpm-workspace.yaml` denies
 * `@sentry/cli`'s postinstall for the same reason, so the ~20 MB binary is never fetched in CI
 * either. The consequence is stated plainly so nobody is surprised by it: **production stack traces
 * will be minified.** Turning it on is three coordinated changes — the token, the `allowBuilds`
 * entry, and `sourcemaps` below — and it belongs to whoever owns the Sentry organisation.
 *
 * `telemetry: false` stops the build reporting itself to Sentry, which is unrelated to error
 * reporting and is not something a build should do without being asked.
 */
export default withSentryConfig(withPayloadConfig, {
  disableLogger: true,
  silent: true,
  sourcemaps: { disable: true },
  telemetry: false,
  tunnelRoute: false,
  widenClientFileUpload: false,
})
