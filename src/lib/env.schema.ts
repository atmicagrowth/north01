import { z } from 'zod'

import { compactEnv } from './env.public'

/*
 * The backstop `env.core.ts` also carries. ESLint keeps this module out of `env.public.ts`; if some
 * other path ever drags it into a client bundle, the first page load says so rather than quietly
 * shipping the parser again.
 */
if (typeof window !== 'undefined') {
  throw new Error(
    'env.schema.ts was evaluated in a browser. It imports Zod; only env.core.ts may import it.',
  )
}

/**
 * **The browser-safe environment's schema — kept out of the browser.**
 *
 * This lived in `env.public.ts` until Phase 30, and that file is imported by client components —
 * `MediaImage` alone is rendered by four of them. So `import { z } from 'zod'` at its head put **all
 * of Zod** into every storefront route: one scope-hoisted chunk, 267 KB raw and 65 KB gzip, requested
 * before any interaction on every page measured — about 18% of the JavaScript a first visit downloads.
 * All of it to validate ten optional strings the server had already validated at boot.
 *
 * It had already been validated because `instrumentation.ts` imports `env.core.ts` on every server
 * start, and `ServerEnvSchema` *extends* this schema. An invalid public variable therefore still fails
 * fast — on the server, at boot, with every problem listed at once, which is where §4.1b's *"fail
 * clearly"* was ever going to be read. Validating the same values a second time in each visitor's
 * browser caught nothing the server had not, and cost every one of them the parser.
 *
 * **Only `env.core.ts` imports this.** `env.public.ts` takes the `PublicEnv` *type* from here, which
 * TypeScript erases. ESLint enforces the direction: `env.public.ts` may not import `zod`, nor this
 * file as a value.
 */

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
