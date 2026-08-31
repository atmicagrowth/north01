import { z } from 'zod'

import { PublicEnvSchema, parseEnv } from './env.public'

/**
 * The server-side environment: schemas, validation, the §4.1c environment discriminator, and the
 * **D-10** schema-push guard.
 *
 * **Import `env.server.ts`, not this file.** This is the unguarded core, and it exists as a separate
 * module for exactly one reason: `payload.config.ts` is loaded by the `payload` CLI through tsx,
 * outside Next, where `import 'server-only'` cannot resolve. `env.server.ts` is this module plus that
 * import, which turns a client-component import into a **build error**. Only `payload.config.ts` may
 * reach past it to here.
 *
 * **This module must stay runnable outside Next.** It is evaluated by Turbopack during `next build`
 * and `next dev`, by the Next server at runtime, and by tsx for `pnpm payload`, `pnpm generate:types`
 * and `pnpm generate:importmap`. So: no `next/*` imports, no top-level await, and no side effects
 * beyond validation.
 *
 * Replaces the `requireServerEnv` helper Phase 2 left in `payload.config.ts` as a placeholder.
 */

/**
 * A runtime backstop, not the guard.
 *
 * `server-only` in `env.server.ts` is what actually fails the build. This catches the residue: a
 * direct import of *this* module from browser code, which the build cannot see. It fires only once
 * the code is already running in a browser, so treat it as a smoke alarm, not a lock.
 */
if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/env.core.ts was imported into browser code. It carries server-only secrets. ' +
      'Import @/lib/env.public instead — see docs/ENVIRONMENT.md.',
  )
}

/**
 * Server-only variables, extending the browser-safe set — on the server every variable is readable,
 * so one schema validates both tiers and there is a single source of truth for the shape. The split
 * is enforced by which module a file imports, not by two divergent schemas.
 *
 * Only `DATABASE_URL` and `PAYLOAD_SECRET` are required. Every integration below is optional until
 * the phase that consumes it arrives; see `requireIntegration`.
 */
const ServerEnvSchema = PublicEnvSchema.extend({
  /**
   * Neon Postgres connection string for THIS environment. Required everywhere.
   *
   * Validated as a URL rather than a non-empty string so a truncated or quoted value fails here,
   * with a name attached, instead of inside `pg` several seconds later. Use `sslmode=verify-full`;
   * see notes §1.7.4 for why `require` is the wrong spelling.
   *
   * The `error` callback distinguishes absent from malformed. A single string would override every
   * issue the schema raises, so a missing variable would report a format complaint.
   */
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: (issue) =>
      issue.input === undefined
        ? 'DATABASE_URL is required.'
        : 'DATABASE_URL must be a postgres:// or postgresql:// connection string.',
  }),

  /**
   * Signs and encrypts Payload session tokens and encrypted fields. Required everywhere, and a
   * different value in each environment.
   *
   * Payload itself only checks that this is truthy. The 32-character floor is this project's,
   * matching the 32 random bytes `.env.example` tells you to generate: a short secret is a weak one,
   * and there is no reason to accept one.
   */
  PAYLOAD_SECRET: z
    .string({ error: 'PAYLOAD_SECRET is required.' })
    .min(32, 'PAYLOAD_SECRET must be at least 32 characters — generate 32 random bytes as hex.'),

  /**
   * **The D-10 guard.** The one database Drizzle's development schema push may modify, written as
   * `host[:port]/database` — for example `ep-cool-name-123456.us-east-2.aws.neon.tech/neondb`.
   *
   * Optional, and push is off when it is absent. See `resolveSchemaPush` for what it prevents.
   */
  DATABASE_PUSH_TARGET: z.string().min(1).optional(),

  /**
   * Canonical origin of the deployment, no trailing slash. Used for Stripe redirect URLs,
   * transactional email links, canonical tags and the sitemap.
   *
   * Still optional, and now read — **Phase 7** is the phase that needed an absolute URL first, for
   * the password-reset link. See `siteUrl` below for how it is resolved when this is absent, and why
   * the request's own `Host` header is not one of the answers.
   */
  SITE_URL: z.url({ protocol: /^https?$/ }).optional(),

  /**
   * Supplied by Vercel alongside `VERCEL_ENV`, as the production deployment's own hostname with no
   * scheme. Used only as the fallback for `SITE_URL`; never written into a `.env`.
   */
  VERCEL_PROJECT_PRODUCTION_URL: z.string().min(1).optional(),

  /**
   * Set by the Next CLI, never written into a `.env`. Defaulted rather than required because the
   * `payload` CLI leaves it undefined: it loads `.env` through `@next/env` but never assigns
   * `NODE_ENV`, so a required enum here would break `pnpm generate:types`.
   *
   * **The push guard does not read this field.** It reads `process.env.NODE_ENV` directly, because a
   * default of `development` is the wrong answer for a check that authorises writes. See `IS_DEVELOPMENT`.
   */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * Supplied by Vercel when the project exposes system environment variables. Absent locally by
   * design, so it must never be required. This is the only reliable way to tell a preview deployment
   * from a production one: both build with `NODE_ENV=production`.
   */
  VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),

  /**
   * Vercel sets this whenever the project exposes system environment variables. It is used only to
   * detect the case where `VERCEL_ENV` is missing but we are plainly on Vercel — see `resolveAppEnv`.
   */
  VERCEL: z.string().min(1).optional(),

  /** Phase 8 — Cloudinary. */
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),

  /**
   * **Three variables this project does not use, refused rather than ignored.**
   *
   * The `cloudinary` SDK reads `CLOUDINARY_URL`, `CLOUDINARY_ACCOUNT_URL` and `CLOUDINARY_API_PROXY`
   * straight out of `process.env` on its first `config()` call, merging them *underneath* whatever
   * the caller passes. `CLOUDINARY_URL` is the interesting one: it is a single string of the form
   * `cloudinary://<key>:<secret>@<cloud>`, so its presence silently supplies a write credential
   * behind this module's deliberate three-variable scheme — and a malformed one throws inside the SDK
   * at boot, far from anything that names it.
   *
   * Refusing them is the only control that works, because an allowlist here cannot stop a library
   * reading `process.env` directly. Anyone who sets one gets an error naming the variable and the
   * three that replace it, at startup, instead of a mystery.
   */
  CLOUDINARY_URL: z
    .undefined({
      error:
        'CLOUDINARY_URL is refused. The Cloudinary SDK reads it directly and it carries an API secret, ' +
        "which would bypass this project's NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / " +
        'CLOUDINARY_API_SECRET scheme. Set those three instead — see docs/ENVIRONMENT.md.',
    })
    .optional(),
  CLOUDINARY_ACCOUNT_URL: z
    .undefined({
      error: 'CLOUDINARY_ACCOUNT_URL is refused — this project configures Cloudinary explicitly.',
    })
    .optional(),
  CLOUDINARY_API_PROXY: z
    .undefined({
      error: 'CLOUDINARY_API_PROXY is refused — this project configures Cloudinary explicitly.',
    })
    .optional(),

  /**
   * Phase 11 — Algolia write key. Never exposed to the browser. *(named here — DEV-26)*
   *
   * **Write, not admin, and the distinction is the point.** Algolia's signup screen issues a
   * pre-scoped *Write API Key* alongside the search key. It can add and delete objects, edit
   * settings and delete indices — everything indexing needs — and it **cannot list or create API
   * keys**, which the Admin key can. Measured against a live application: `GET /1/keys` with this
   * key returns **403**. Putting an Admin key in this variable would hand account-root to anything
   * that reads the environment, for no capability the indexer uses.
   *
   * This variable was called `ALGOLIA_ADMIN_API_KEY` until Phase 11. The name was wrong twice over
   * — against Algolia's own label and against the key's actual ACLs — and it was corrected before
   * anything read it.
   */
  ALGOLIA_WRITE_API_KEY: z.string().min(1).optional(),

  /**
   * Phase 17 — Stripe. Restricted keys (`rk_…`) are accepted alongside secret keys (`sk_…`): Stripe
   * issues both for server use and recommends restricted keys for production.
   */
  STRIPE_SECRET_KEY: z
    .string()
    .regex(
      /^(sk|rk)_(test|live)_/,
      'STRIPE_SECRET_KEY must start with sk_test_, sk_live_, rk_test_ or rk_live_.',
    )
    .optional(),
  /** Phase 17 — the signing secret for the webhook endpoint. Without it, no order is paid. */
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_/, 'STRIPE_WEBHOOK_SECRET must start with whsec_.')
    .optional(),

  /** Phase 19 — Resend. */
  RESEND_API_KEY: z.string().min(1).optional(),

  /** Phase 25 — Sentry source-map upload; build-time only, never needed at runtime. */
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
  /** Phase 25 — PostHog server-side key, where a server event is warranted. *(DEV-26)* */
  POSTHOG_API_KEY: z.string().min(1).optional(),

  /** Phase 26 — Cloudflare Turnstile verification key. */
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
})

export type ServerEnv = z.infer<typeof ServerEnvSchema>

/**
 * On the server, `process.env` genuinely carries every variable at runtime — Turbopack inlines only
 * `NODE_ENV`, `NEXT_PUBLIC_*` and `next.config`'s `env` block, and leaves other server reads alone.
 * So parsing the whole object here is real validation, not a frozen snapshot.
 */
export const serverEnv: ServerEnv = parseEnv(ServerEnvSchema, process.env, 'server')

/**
 * The raw `NODE_ENV`, read as a literal member expression and deliberately **not** defaulted.
 *
 * Two reasons, both load-bearing:
 *
 * 1. **Unset must not mean development.** The schema defaults `NODE_ENV` to `development` so the
 *    `payload` CLI can run, but that default is the least safe answer for a check that authorises
 *    writing to a database. A server started with no `NODE_ENV` would otherwise be treated as a
 *    development sandbox.
 * 2. **It is what lets the bundler settle the question at build time.** Turbopack substitutes this
 *    exact expression with a literal, so in a production bundle this constant folds to `false` and
 *    the push decision below is decided before the code ever runs.
 */
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development'

/**
 * Local, Preview, Production — the three environments plan §4.1c requires be kept distinct.
 *
 * `NODE_ENV` cannot express this: Vercel builds preview deployments with `NODE_ENV=production`, so
 * it collapses two of the three. `VERCEL_ENV` is the discriminator.
 */
export type AppEnv = 'local' | 'preview' | 'production'

function resolveAppEnv(env: ServerEnv): AppEnv {
  if (env.VERCEL_ENV === 'production') return 'production'
  if (env.VERCEL_ENV === 'preview') return 'preview'
  if (env.VERCEL_ENV === 'development') return 'local'

  /*
   * On Vercel, but `VERCEL_ENV` is absent — the project has "Automatically expose System Environment
   * Variables" turned off. The deployment could be either preview or production and nothing here can
   * tell them apart, so answer `preview`, the one that withholds privilege.
   *
   * The only thing `production` unlocks is live payment credentials, and a production deployment that
   * hides its system variables will fail loudly at startup if it carries them rather than quietly
   * accepting them on a preview branch. Re-enable the setting; the message says so.
   */
  if (env.VERCEL) return 'preview'

  return env.NODE_ENV === 'production' ? 'production' : 'local'
}

export const appEnv: AppEnv = resolveAppEnv(serverEnv)

/**
 * **The one origin this application will call its own**, no trailing slash.
 *
 * Everything that has to name itself in a link somebody else follows reads this: the password-reset
 * mail (**Phase 7**), Stripe's success and cancel URLs (**Phase 17**), canonical tags and the
 * sitemap (**Phase 24**). It is set on the Payload config as `serverURL`, which is where Payload's
 * own helpers look.
 *
 * **What is deliberately not a source: the request.** Deriving an origin from the incoming `Host`
 * header is the standard shape of host-header injection, and password reset is its textbook victim —
 * an attacker triggers a reset for someone else's address with a forged `Host`, and the mail that
 * arrives in the victim's inbox carries a real token pointed at the attacker's server. A value that
 * comes from configuration cannot be steered by a request, which is the whole property being bought.
 *
 * The localhost fallback is for development only in practice, but it is not *conditioned* on the
 * environment, because a wrong-but-harmless link on a laptop is a better failure than a config
 * module that throws during `next build`. Preview and production are expected to set `SITE_URL`
 * explicitly; `VERCEL_PROJECT_PRODUCTION_URL` covers the case where nobody has yet, and it names the
 * production deployment even when read from a preview — which is why it is the fallback and not the
 * first choice.
 */
function resolveSiteUrl(env: ServerEnv): string {
  const explicit =
    env.SITE_URL ??
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined)

  return (explicit ?? 'http://localhost:3000').replace(/\/+$/, '')
}

export const siteUrl: string = resolveSiteUrl(serverEnv)

/**
 * §4.1c: "Never use production Stripe credentials in local or preview."
 *
 * Stated as a rule, enforced as one. Stripe's key prefixes make the check exact, and the consequence
 * of getting it wrong — charging a real card from a preview branch — is bad enough that a warning
 * would be the wrong response. `rk_live_` counts: a restricted key is still a live key.
 */
function assertNoLiveStripeOutsideProduction(env: ServerEnv, current: AppEnv): void {
  if (current === 'production') return

  const live = [
    /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? '') ? 'STRIPE_SECRET_KEY' : null,
    env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_live_')
      ? 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'
      : null,
  ].filter((name): name is string => name !== null)

  if (live.length > 0) {
    const ambiguous =
      current === 'preview' && !env.VERCEL_ENV
        ? ' If this IS production, enable "Automatically expose System Environment Variables" on the ' +
          'Vercel project so VERCEL_ENV is set — without it a deployment cannot prove it is production.'
        : ''

    throw new Error(
      `Live Stripe credentials in the ${current} environment: ${live.join(', ')}. ` +
        'Plan §4.1c forbids production payment credentials outside production. Use the test-mode keys.' +
        ambiguous,
    )
  }
}

assertNoLiveStripeOutsideProduction(serverEnv, appEnv)

type Identity = { ok: true; id: string } | { ok: false; reason: string }

/**
 * Which database a connection string actually addresses, as `host:port/database`.
 *
 * **This has to agree with `pg`, not with intuition.** `pg-connection-string` copies query parameters
 * into the config first and only then falls back to the URL's own hostname and port, so
 * `?host=` and `?port=` *override* what the URL appears to say. Reading `url.hostname` alone would let
 * `postgres://…@dev-host/db?host=prod-host` connect to production while the guard inspected `dev-host`.
 *
 * The port is part of the identity: two Postgres servers on one host are two databases, and a local
 * container on 5433 is not the one on 5432. Missing means the Postgres default.
 *
 * `options` is refused rather than interpreted. Neon documents `?options=endpoint%3D<id>` for clients
 * that cannot use SNI, and it reroutes the connection to a different compute while the hostname stays
 * put — the guard cannot resolve that, so it declines to arm rather than guess.
 */
function databaseIdentity(connectionString: string): Identity {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    return { ok: false, reason: 'DATABASE_URL could not be parsed' }
  }

  if (url.searchParams.has('options')) {
    return {
      ok: false,
      reason:
        'DATABASE_URL carries an "options" parameter, which can redirect the connection to a ' +
        'different compute than its hostname names',
    }
  }

  // `||`, not `??`. pg-connection-string falls back on *truthiness* (`if (!config.port)`), so an
  // empty `?port=` there means "use the URL's port". With `??` the guard would keep the empty string,
  // resolve it to 5432, and authorise push for a different server than pg actually connects to.
  const host = (url.searchParams.get('host') || url.hostname).trim().toLowerCase()
  const port = (url.searchParams.get('port') || url.port).trim() || '5432'

  let database: string
  try {
    database = decodeURIComponent(url.pathname.replace(/^\/+/, '').replace(/\/+$/, ''))
  } catch {
    return { ok: false, reason: 'DATABASE_URL has a malformed percent-escape in its database name' }
  }

  if (!host) return { ok: false, reason: 'DATABASE_URL names no host' }
  if (!database) return { ok: false, reason: 'DATABASE_URL names no database' }

  return { ok: true, id: `${host}:${port}/${database}` }
}

/**
 * The same identity, parsed from what the operator declared.
 *
 * Both sides go through a matching normalisation — host lowercased and defaulted to port 5432, the
 * database name left exactly as written. Postgres folds *unquoted* identifiers to lower case but a
 * quoted name is case-sensitive, so comparing the database name case-insensitively would make the
 * guard more permissive than the database is. Hostnames are case-insensitive by DNS, so those fold.
 *
 * A pasted connection string is rejected rather than parsed: the value is derived from `DATABASE_URL`,
 * so pasting the whole thing is the obvious slip, and it would put credentials into a log line.
 */
function normalisePushTarget(value: string): Identity {
  const raw = value.trim().replace(/^\/+|\/+$/g, '')

  if (raw.includes('://') || raw.includes('@')) {
    return {
      ok: false,
      reason:
        'DATABASE_PUSH_TARGET looks like a connection string — it must be host[:port]/database, ' +
        'with no scheme and no credentials',
    }
  }

  const separator = raw.indexOf('/')
  if (separator < 1) {
    return { ok: false, reason: 'DATABASE_PUSH_TARGET must be host[:port]/database' }
  }

  // Bracket-aware, because a bare `.split(':')` mangles an IPv6 literal: `'[::1]:5432'.split(':')`
  // is `['[', '', '1]', '5432']`, so the host became `[` and no spelling of the variable could ever
  // arm push for an IPv6 database. Brackets are kept, because that is what `url.hostname` produces
  // and therefore what the other side of the comparison holds.
  //
  // Anchoring also rejects two forms the old split silently accepted: `host:5432:extra` (the extra
  // was dropped and push armed anyway) and `host:abc` (a non-numeric port).
  const hostAndPort = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(raw.slice(0, separator).toLowerCase())
  const database = raw.slice(separator + 1).replace(/\/+$/, '')

  if (!hostAndPort) {
    return { ok: false, reason: 'DATABASE_PUSH_TARGET must be host[:port]/database' }
  }
  if (!database) return { ok: false, reason: 'DATABASE_PUSH_TARGET names no database' }

  return { ok: true, id: `${hostAndPort[1]}:${hostAndPort[2] || '5432'}/${database}` }
}

export type SchemaPushDecision = {
  allowed: boolean
  /** Why, phrased for a developer reading it in a terminal. */
  reason: string
  /** True only for the case worth shouting about: push was armed, but for a different database. */
  mismatch: boolean
}

/**
 * **D-10 — the environment guard Phase 4 owes.**
 *
 * Plan §5.1d wants Drizzle's push workflow in the development sandbox and committed migrations
 * everywhere else, and DEV-17 records that disabling push outright was tried in Phase 2 and withdrawn.
 * So push must stay available in development; what it must not do is reach a database that is not the
 * development one.
 *
 * **What the hazard is, after measuring it.** `PAYLOAD_MIGRATING` covers the migrate CLI, and
 * `IS_DEVELOPMENT` folds to `false` in a production bundle, so a deployed server's push decision is
 * settled before it runs. What remains is `next dev` and the unbundled `payload` CLI, both of which
 * read `DATABASE_URL` from the same `.env`. The realistic accident is therefore narrow and human:
 * point `.env` at another database to look at something, run `pnpm dev`, and Drizzle rewrites that
 * database's schema.
 *
 * **Why this is structural rather than a reminder.** `DATABASE_PUSH_TARGET` names the one database
 * push may modify. Two independent facts have to agree, and the second names the database explicitly —
 * so repointing `DATABASE_URL` *disarms* push instead of aiming it somewhere new. Re-arming is a
 * deliberate second edit.
 *
 * Fail-closed throughout: anything unparseable, ambiguous or absent means no push.
 */
function resolveSchemaPush(env: ServerEnv, current: AppEnv): SchemaPushDecision {
  if (!IS_DEVELOPMENT) {
    return {
      allowed: false,
      reason: `NODE_ENV is ${process.env.NODE_ENV ? `"${process.env.NODE_ENV}"` : 'not set'}, not "development"`,
      mismatch: false,
    }
  }

  if (current !== 'local') {
    return {
      allowed: false,
      reason: `the app environment is "${current}", not "local"`,
      mismatch: false,
    }
  }

  if (!env.DATABASE_PUSH_TARGET) {
    return { allowed: false, reason: 'DATABASE_PUSH_TARGET is not set', mismatch: false }
  }

  const permitted = normalisePushTarget(env.DATABASE_PUSH_TARGET)
  if (!permitted.ok) return { allowed: false, reason: permitted.reason, mismatch: false }

  const actual = databaseIdentity(env.DATABASE_URL)
  if (!actual.ok) return { allowed: false, reason: actual.reason, mismatch: false }

  if (actual.id !== permitted.id) {
    return {
      allowed: false,
      mismatch: true,
      reason: `DATABASE_URL names "${actual.id}" and DATABASE_PUSH_TARGET permits "${permitted.id}"`,
    }
  }

  return {
    allowed: true,
    reason: `DATABASE_URL matches DATABASE_PUSH_TARGET ("${actual.id}")`,
    mismatch: false,
  }
}

export const schemaPush: SchemaPushDecision = resolveSchemaPush(serverEnv, appEnv)

/**
 * **The database-identity half of D-10, on its own.**
 *
 * `schemaPush` answers "may Drizzle rewrite this schema", and it is deliberately narrower than the
 * identity question: it also requires `NODE_ENV === 'development'`, which `next dev` sets and the
 * `payload` CLI does not. That is right for push — a CLI run should never push — and wrong as a guard
 * for a *script*, which is run from the CLI on purpose and still needs to know it is talking to the
 * development database.
 *
 * So this exposes the comparison alone: does `DATABASE_URL` address the database that
 * `DATABASE_PUSH_TARGET` names? It is the check `scripts/` uses before doing anything destructive —
 * seeding over a catalogue, writing migration ledger rows — because the alternative, testing
 * `appEnv`, cannot see the connection string at all and reads `local` on a laptop pointed at
 * production.
 *
 * Fail-closed like everything else here: unset, unparseable or mismatched all mean no.
 */
export function resolveDevelopmentDatabase(): { ok: boolean; reason: string } {
  if (!serverEnv.DATABASE_PUSH_TARGET) {
    return {
      ok: false,
      reason: 'DATABASE_PUSH_TARGET is not set, so no database is nominated as the development one',
    }
  }

  const permitted = normalisePushTarget(serverEnv.DATABASE_PUSH_TARGET)
  if (!permitted.ok) return { ok: false, reason: permitted.reason }

  const actual = databaseIdentity(serverEnv.DATABASE_URL)
  if (!actual.ok) return { ok: false, reason: actual.reason }

  if (actual.id !== permitted.id) {
    return {
      ok: false,
      reason: `DATABASE_URL names "${actual.id}" and DATABASE_PUSH_TARGET nominates "${permitted.id}"`,
    }
  }

  return { ok: true, reason: `DATABASE_URL matches DATABASE_PUSH_TARGET ("${actual.id}")` }
}

export const developmentDatabase = resolveDevelopmentDatabase()

/**
 * Optional integrations, as groups (plan §4.1b).
 *
 * A group is all-or-nothing: a Cloudinary cloud name with no API secret is not a working Cloudinary,
 * it is a half-configured one that will fail at the first upload. Declaring the membership here lets a
 * partly-filled group be reported at startup rather than discovered later, and gives each phase one
 * call to assert its own dependency.
 *
 * Keep these in step with the provider blocks in `.env.example` and the table in
 * `docs/ENVIRONMENT.md`. Two variables are omitted on purpose: `SENTRY_AUTH_TOKEN`, consumed by the
 * build to upload source maps and absent at runtime by design, and `POSTHOG_API_KEY`, which is an
 * optional extra even when PostHog is configured. Grouping either would report a correctly
 * configured server as half-configured.
 */
const INTEGRATIONS = {
  cloudinary: {
    phase: 8,
    keys: ['NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
  },
  algolia: {
    /*
     * Phase 11, not 12. The search *UI* is Phase 12, but plan §11.1d makes the shop's colour, size
     * and collection filters run on the index — those three facets live on `product-variants` and
     * `collections`, where no product column can answer them. See `lib/catalog/catalog.ts`.
     */
    phase: 11,
    keys: [
      'NEXT_PUBLIC_ALGOLIA_APP_ID',
      'NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY',
      'ALGOLIA_WRITE_API_KEY',
    ],
  },
  stripe: {
    phase: 17,
    keys: ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  },
  resend: { phase: 19, keys: ['RESEND_API_KEY'] },
  posthog: { phase: 25, keys: ['NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST'] },
  sentry: { phase: 25, keys: ['NEXT_PUBLIC_SENTRY_DSN'] },
  ga4: { phase: 25, keys: ['NEXT_PUBLIC_GA_MEASUREMENT_ID'] },
  turnstile: { phase: 26, keys: ['NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'] },
} as const satisfies Record<string, { phase: number; keys: readonly (keyof ServerEnv)[] }>

export type IntegrationName = keyof typeof INTEGRATIONS

type IntegrationValues<K extends IntegrationName> = {
  [P in (typeof INTEGRATIONS)[K]['keys'][number]]: string
}

function missingKeys(name: IntegrationName): string[] {
  return INTEGRATIONS[name].keys.filter((key) => serverEnv[key] === undefined)
}

/**
 * `configured` — every key present. `unconfigured` — none present, which is the normal state for a
 * phase that has not landed. `partial` — some but not all, which is always a mistake.
 *
 * Use this to degrade gracefully: an unconfigured optional service means hide the feature, not crash
 * the store. `docs/ARCHITECTURE.md` §2: analytics, monitoring, search and email may all be
 * unavailable and a customer must still be able to buy.
 *
 * **Server-side only.** All but one of these groups have browser-safe members, but the function reads
 * the server tier and lives behind the `server-only` guard; a client component cannot call it. Decide availability on the server and pass the
 * answer down as a prop.
 */
export function integrationStatus(
  name: IntegrationName,
): 'configured' | 'partial' | 'unconfigured' {
  const missing = missingKeys(name)
  if (missing.length === 0) return 'configured'
  return missing.length === INTEGRATIONS[name].keys.length ? 'unconfigured' : 'partial'
}

/**
 * Assert an integration is fully configured and hand back its values, typed as present.
 *
 * For the code path that genuinely cannot proceed without the service — a Stripe webhook handler, an
 * Algolia reindex job. For anything a customer can reach, check `integrationStatus` and degrade.
 */
export function requireIntegration<K extends IntegrationName>(name: K): IntegrationValues<K> {
  const missing = missingKeys(name)

  if (missing.length > 0) {
    throw new Error(
      `The ${name} integration is not configured: ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} missing. See docs/ENVIRONMENT.md.`,
    )
  }

  return Object.fromEntries(
    INTEGRATIONS[name].keys.map((key) => [key, serverEnv[key]]),
  ) as IntegrationValues<K>
}

/**
 * Report what the environment resolved to. Called once, from `instrumentation.ts`.
 *
 * **Why this is a function and not module-scope side effects.** Importing this module is pure apart
 * from throwing on an invalid environment, which matters because it is imported far more often than a
 * server starts: `next build` evaluates it in seven page-data workers, and `next dev` evaluates it in
 * two separate processes — the main server, which runs the instrumentation hook, and the render worker
 * that compiles the Payload config. Warning at module scope printed every message twice on a plain
 * `pnpm dev`, and deduplicating on `globalThis` does not help, because those are different processes
 * and do not share one.
 *
 * Startup is also simply the right place for it: it is where an operator looks, it happens once, and
 * it happens before any request is served.
 *
 * The trade-off, recorded so it is not a surprise: the `payload` CLI does not run instrumentation, so
 * `pnpm payload …` validates the environment but prints none of this. The guards still apply.
 */
export function reportEnvironment(): void {
  // Outside development the push branch is already decided, so reporting on it would describe a
  // decision that was never taken.
  if (IS_DEVELOPMENT && !schemaPush.allowed) {
    if (schemaPush.mismatch) {
      console.warn(
        `\n[env] Schema push is DISABLED: ${schemaPush.reason}.\n` +
          '      They name different databases, so Payload will not alter this one. If you meant to\n' +
          '      develop against it, update DATABASE_PUSH_TARGET deliberately. If you did not, this\n' +
          '      guard just did its job. See docs/ENVIRONMENT.md.\n',
      )
    } else {
      console.warn(
        `\n[env] Schema push is disabled: ${schemaPush.reason}.\n` +
          '      Payload will not create or alter tables, so /admin cannot build the schema.\n' +
          '      Set DATABASE_PUSH_TARGET to "host[:port]/database" of your development branch — see\n' +
          '      .env.example and docs/ENVIRONMENT.md.\n',
      )
    }
  }

  // §4.1b: "For optional integrations, log a clear server-side warning." A fully absent group stays
  // silent — its phase has not arrived, and naming every unbuilt integration on every start would
  // train people to ignore the channel. A half-configured one is reported in every environment,
  // because it is a real defect that otherwise surfaces much later and much further from its cause.
  for (const name of Object.keys(INTEGRATIONS) as IntegrationName[]) {
    if (integrationStatus(name) === 'partial') {
      console.warn(
        `[env] The ${name} integration is partly configured — missing ${missingKeys(name).join(', ')}. ` +
          'It will be treated as unavailable. See docs/ENVIRONMENT.md.',
      )
    }
  }

  /**
   * **The one integration whose absence is no longer "its phase has not arrived".**
   *
   * Silence on an unconfigured group is right while the phase that consumes it is still ahead. Phase
   * 8 is where that stops being true for Cloudinary, and the failure it hides is not graceful: with
   * no cloud configured Payload keeps local-disk storage, and a serverless filesystem is ephemeral
   * and usually read-only — so the first upload on a deployed environment fails, and every file
   * written before a restart disappears. Locally the same state is entirely correct and needs no
   * comment, which is why this warns on `appEnv` rather than on configuration alone.
   *
   * It warns rather than throws. Refusing to boot would take a storefront offline over a feature
   * nobody may be using that day, and `docs/ARCHITECTURE.md` §2 is explicit that an unavailable
   * optional service must degrade rather than stop the shop.
   */
  if (appEnv !== 'local' && integrationStatus('cloudinary') === 'unconfigured') {
    console.warn(
      `\n[env] Cloudinary is not configured, and this is the ${appEnv} environment.\n` +
        '      Media uploads will fall back to the local filesystem, which on a serverless platform is\n' +
        '      ephemeral and often read-only: uploads will fail or silently vanish between requests.\n' +
        '      Set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.\n' +
        '      The storefront renders without them — every image falls back to its placeholder.\n',
    )
  }
}
