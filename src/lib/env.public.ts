import type { PublicEnv } from './env.schema'

/**
 * The browser-safe half of the environment (plan §4.1a, "Public/browser-safe").
 *
 * **This module may be imported from client components. `env.server.ts` may not.** That is
 * the whole point of the split: the trust boundary is a file boundary, so importing the
 * wrong one is visible in the import line rather than buried in a value.
 *
 * Everything declared here is compiled into the JavaScript sent to browsers. Treat every
 * value as published. A key that must stay secret does not belong in this file, and does
 * not belong behind a `NEXT_PUBLIC_` prefix at all.
 *
 * **Why the values are read one literal at a time.** Next inlines environment variables into
 * the client bundle by textually substituting the member expression `process.env.NEXT_PUBLIC_X`
 * at build time — it is a define, not a runtime lookup. `process.env` itself is an empty shim
 * in the browser, so a dynamic read (`process.env[name]`), a spread, or handing the whole
 * object to Zod all yield nothing client-side. The literal table below is not verbosity for
 * its own sake; it is the only form that survives the bundler.
 *
 * Verified against Next 16.3.2 with Turbopack, which is what `next build` uses here.
 */

/**
 * Empty is missing.
 *
 * A variable declared with no value — `SENTRY_DSN=` in a `.env`, or a blank field in the
 * Vercel dashboard — arrives as `''`, and `@next/env` will not fall back to a lower-priority
 * file once a key exists at all. Left alone, `''` would satisfy an `.optional()` string and a
 * blank required one would fail with "too small" rather than "missing". Both are confusing.
 *
 * Dropping empty keys before parsing makes `''` and absent the same thing, which matches the
 * fail-fast check Phase 2 used (`if (!value)`) and keeps the error messages honest.
 */
export function compactEnv(source: Record<string, string | undefined>): Record<string, string> {
  const compacted: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.length > 0) compacted[key] = value
  }
  return compacted
}

/**
 * The literal reads Next's bundler substitutes at build time. Keep one line per key, and keep
 * each one a plain `process.env.NEXT_PUBLIC_…` member expression — see the note at the top of
 * this file for what happens otherwise.
 */
const publicEnvSource = {
  NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  NEXT_PUBLIC_ALGOLIA_APP_ID: process.env.NEXT_PUBLIC_ALGOLIA_APP_ID,
  NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY: process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
}

/**
 * The browser-safe environment. Safe to import from anywhere, server or client.
 *
 * **Validated on the server, not here.** Until Phase 30 this line ran Zod in every visitor's browser
 * — which meant shipping Zod to every visitor, 65 KB gzip on every route, to re-check ten optional
 * strings. `instrumentation.ts` imports `env.core.ts` on every server start, and `ServerEnvSchema`
 * extends `PublicEnvSchema`, so a malformed value that *is* set (a GA id that is not a GA id) fails
 * the deployment at boot, before any page is served. The browser receives values that have already
 * passed; the cast below records that, rather than performing it a second time.
 *
 * `export type { PublicEnv }` keeps every existing `import type { PublicEnv }` from this module working.
 */
export const publicEnv = compactEnv(publicEnvSource) as PublicEnv

export type { PublicEnv }

/**
 * **The deployment this browser is talking to** — the client-side mirror of `appEnv`.
 *
 * The mapping is deliberately identical to `resolveAppEnv`'s, including that Vercel's
 * `development` means *"a local `vercel dev`"* and is reported as `local`. Two functions naming the
 * same three environments differently would be worse than one that is only mostly right.
 *
 * Off Vercel the answer is `local`, whatever `NODE_ENV` says — the same rule as `resolveAppEnv`
 * (audit R1-19): a production-mode build on a laptop is still a laptop.
 */
export function publicAppEnv(): 'local' | 'preview' | 'production' {
  switch (publicEnv.NEXT_PUBLIC_VERCEL_ENV) {
    case 'production':
      return 'production'
    case 'preview':
      return 'preview'
    case 'development':
      return 'local'
    default:
      return 'local'
  }
}
