import { z } from 'zod'

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
 * Parse or fail loudly, naming every problem at once rather than one per restart.
 *
 * Plan §4.1b: fail clearly, and never silently substitute a fake value. `z.prettifyError`
 * renders the whole issue list as readable lines, so a misconfigured deployment reports all
 * of its missing variables in one pass.
 *
 * The thrown message names the offending variables. That is safe **because this only ever
 * runs server-side or at build time, and the message is never returned to a caller** — a
 * config-load failure surfaces to the browser as a bare HTTP 500 with no body. §4.1b's rule
 * is about API responses, not about server logs, which need the name to be actionable.
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
  tier: string,
): z.infer<T> {
  const parsed = schema.safeParse(compactEnv(source))

  if (!parsed.success) {
    throw new Error(
      `Invalid ${tier} environment.\n\n${z.prettifyError(parsed.error)}\n\n` +
        'Copy .env.example to .env and fill it in. Every variable, where its value comes ' +
        'from, and which environments require it are documented in docs/ENVIRONMENT.md.',
    )
  }

  return parsed.data
}

/**
 * Every browser-safe variable the project will use, with the phase that activates each.
 *
 * All of them are optional here. Only `DATABASE_URL` and `PAYLOAD_SECRET` are consumed today,
 * and both are server-only; the entries below are declared now because plan §4.1a makes the
 * *inventory* Phase 4's deliverable, and because `.env.example` has to list them either way.
 * A later phase tightens its own group from optional to required when it starts reading it —
 * it does not get to invent a new name at that point. See `requireIntegration` in
 * `env.server.ts` for how a phase asserts that its group is actually configured.
 *
 * Names marked *(named here)* had no convention settled by any canonical document; Phase 4
 * chose them, and the choice is recorded in the notes and deviations document as **DEV-26**.
 */
export const PublicEnvSchema = z.object({
  /**
   * Phase 25 — which deployment this is, **in the browser**.
   *
   * Vercel exposes it automatically when *"Automatically expose System Environment Variables"* is
   * on, which is the same setting `resolveAppEnv` already depends on server-side. Nobody sets it by
   * hand.
   *
   * It exists because the browser and the server were reporting **different Sentry environments for
   * the same deployment**: the server resolves `preview` from `VERCEL_ENV`, and the browser had only
   * `NODE_ENV`, which is `production` for every built deployment. A preview's errors therefore
   * landed in the production project beside real ones.
   */
  NEXT_PUBLIC_VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),

  /** Phase 8 — Cloudinary. The delivery cloud name is public by design; it appears in URLs. */
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),

  /** Phase 12 — Algolia application id. Public: it is half of every search request. */
  NEXT_PUBLIC_ALGOLIA_APP_ID: z.string().min(1).optional(),
  /** Phase 12 — Algolia **search-only** key. Never the admin key. *(named here)* */
  NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY: z.string().min(1).optional(),

  /** Phase 17 — Stripe publishable key. `pk_test_…` everywhere until launch; see §4.1c. */
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .min(1)
    .regex(
      /^pk_(test|live)_/,
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must start with pk_test_ or pk_live_.',
    )
    .optional(),

  /** Phase 25 — PostHog project key. *(named here)* */
  NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
  /** Phase 25 — PostHog ingestion host, e.g. https://eu.i.posthog.com. *(named here)* */
  NEXT_PUBLIC_POSTHOG_HOST: z.url({ protocol: /^https?$/ }).optional(),
  /** Phase 25 — GA4 measurement id, `G-XXXXXXXXXX`. *(named here)* */
  NEXT_PUBLIC_GA_MEASUREMENT_ID: z
    .string()
    .regex(/^G-[A-Z0-9]+$/, 'NEXT_PUBLIC_GA_MEASUREMENT_ID must look like G-XXXXXXXXXX.')
    .optional(),
  /** Phase 25 — Sentry DSN for the browser SDK. A DSN is public by design. */
  NEXT_PUBLIC_SENTRY_DSN: z.url({ protocol: /^https?$/ }).optional(),

  /** Phase 26 — Cloudflare Turnstile **site** key. The secret key is server-only. */
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
})

export type PublicEnv = z.infer<typeof PublicEnvSchema>

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
 * Validated browser-safe environment. Safe to import from anywhere, server or client.
 *
 * Validation runs when this module is first evaluated, which on the client is during page
 * load. Nothing here is required today, so it cannot fail today — but a malformed value that
 * *is* set (a GA id that is not a GA id) is caught rather than shipped.
 */
export const publicEnv: PublicEnv = parseEnv(PublicEnvSchema, publicEnvSource, 'browser-safe')

/**
 * **The deployment this browser is talking to** — the client-side mirror of `appEnv`.
 *
 * The mapping is deliberately identical to `resolveAppEnv`'s, including that Vercel's
 * `development` means *"a local `vercel dev`"* and is reported as `local`. Two functions naming the
 * same three environments differently would be worse than one that is only mostly right.
 *
 * The fallback is `NODE_ENV`, which is what a `pnpm dev` or a self-hosted build has.
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
      return process.env.NODE_ENV === 'production' ? 'production' : 'local'
  }
}
