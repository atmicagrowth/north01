import { withSentryConfig } from '@sentry/nextjs'
import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /** Plan §34 (audit R3-10): no `X-Powered-By: Next.js` advertising the framework on every response. */
  poweredByHeader: false,

  /**
   * **Security headers** — plan §34, audit R3-10. Before this, the only one any response carried was
   * Vercel's HSTS. All of them apply to every route, the admin panel included.
   *
   * - `X-Content-Type-Options: nosniff` — a response is the type it says it is.
   * - `Referrer-Policy: strict-origin-when-cross-origin` — another site learns the origin, never the
   *   path (and so never an order number or a reset token in a query string).
   * - `X-Frame-Options: SAMEORIGIN` — no other site can frame the shop or the admin (clickjacking);
   *   a same-origin frame (a future Payload live preview) stays allowed.
   * - `Permissions-Policy` — the shop needs no camera, microphone, location or topics.
   * - **CSP in Report-Only.** Enforcing a policy first would risk breaking Stripe, Turnstile, GA,
   *   PostHog, Sentry, Cloudinary and the admin panel on a guess; report-only surfaces every
   *   violation in the browser console without blocking anything. Enforcing it is the recorded next
   *   step (docs/SECURITY.md §6), once a release has run clean against it.
   */
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self' https://checkout.stripe.com",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "img-src 'self' data: blob: https://res.cloudinary.com https://*.google-analytics.com https://*.googletagmanager.com",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://www.googletagmanager.com https://*.posthog.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://api.stripe.com https://api.cloudinary.com https://*.algolia.net https://*.algolianet.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.posthog.com https://*.sentry.io https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
      "frame-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://checkout.stripe.com",
    ].join('; ')

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
          { key: 'Content-Security-Policy-Report-Only', value: csp },
        ],
      },
    ]
  },

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
 *
 * There is no `disableLogger` (Phase 36, audit R3-23): the SDK deprecated it and it did nothing under
 * this build, so it read as a setting that was not in effect.
 */
export default withSentryConfig(withPayloadConfig, {
  silent: true,
  sourcemaps: { disable: true },
  telemetry: false,
  tunnelRoute: false,
  widenClientFileUpload: false,
})
