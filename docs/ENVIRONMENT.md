# NORTH / 01 — Environment and secrets

> Phase 4's deliverable. Plan §4.1a–§4.1c: a typed environment module validated with Zod, a
> hard split between browser-safe and server-only values, clear failure when a required secret
> is missing, and three environments kept apart.
>
> **Never commit a real value.** `.env` and every `.env.*` variant are git-ignored;
> `.env.example` is the one exception and it holds names only.

## The two tiers

The trust boundary is a **file boundary**, so getting it wrong is visible in the import line.

| Module | Holds | Importable from |
|---|---|---|
| [`src/lib/env.public.ts`](../src/lib/env.public.ts) | `NEXT_PUBLIC_*` only — compiled into the browser bundle | anywhere, server or client |
| [`src/lib/env.server.ts`](../src/lib/env.server.ts) | everything, secrets included | **server only** |
| [`src/lib/env.core.ts`](../src/lib/env.core.ts) | the same, without the guard | `payload.config.ts` and `instrumentation.ts` only |

`env.server.ts` is `env.core.ts` plus `import 'server-only'`, and that one line is the guard: a
client component importing it **fails the build**, naming the offending chain.

```text
Error: You're importing a module that depends on "server-only".
  Client Component Browser:
    ./src/lib/env.server.ts [Client Component Browser]
    ./src/app/(frontend)/some-component.tsx [Client Component Browser]
```

**Why a third module exists.** `server-only` is not an installed package — Next aliases the bare
specifier to a vendored copy, and that alias exists only inside Next's bundler. The `payload` CLI
loads `payload.config.ts` through tsx, outside Next, where the import fails to resolve at all. So
the config imports the unguarded core, and **ESLint forbids anyone else from doing the same** —
`no-restricted-imports` for the static form and `no-restricted-syntax` for `import()`, with
`env.server.ts`, `payload.config.ts` and `instrumentation.ts` exempted.

Both rules are needed. `no-restricted-imports` registers no `ImportExpression` visitor, so it cannot
see a dynamic import at all — and a client component doing `use(import('@/lib/env.core'))` passed
typecheck, lint and build and leaked `PAYLOAD_SECRET` into prerendered HTML. Found by the second
Phase 4 audit.

**Which gate catches what.** A static import of `env.server.ts` from a client component fails
`pnpm build`. Reaching `env.core.ts` fails `pnpm lint`, not the build. Both are in the phase gate,
but a lint rule is the weaker instrument — a computed specifier would evade it.

The `typeof window` check in `env.core.ts` is only a runtime backstop. It cannot fire during a
build, because prerendering runs on the server where `window` is undefined — which is exactly how,
before this was fixed, a client component could import the environment, build cleanly, and ship a
secret inside prerendered HTML.

Anything behind a `NEXT_PUBLIC_` prefix **is published**. It is in the JavaScript every visitor
downloads. Treat the prefix as a publication decision, not a convenience.

## Where validation happens, and what each hook actually catches

Four contexts evaluate this code — three loaders, one of them at two different moments — and none
of them covers everything.

| Hook | Catches | Does **not** catch |
|---|---|---|
| `src/payload.config.ts` → `env.core.ts` | **build** — `next build` evaluates the Payload config while collecting page data, so a bad environment fails the build with exit 1 | a server that starts later with a different environment |
| `src/instrumentation.ts` | **startup** — `next dev` and `next start` | the build; Next skips `register()` when `NEXT_PHASE` is `phase-production-build` |
| `env.public.ts` | malformed public values, in the browser | anything server-only |

Two consequences worth knowing:

- **`instrumentation.ts` is not a build hook.** It is skipped during builds, in the prerender
  workers too. Do not move the build-time validation there — it would silently stop running.
- **A startup failure behaves differently in the two commands**, and both were measured:
  - `next dev` — the process **exits with code 1**. Nothing is served.
  - `next start` — the process **stays up**. Next logs `Failed to prepare server` and an
    `unhandledRejection`, and *every* route then returns HTTP 500, the prerendered storefront
    included, not just `/admin` and `/api/*`.

  The `next start` case is the one that matters: without this hook a broken production deployment
  serves `/` with a 200 and passes a health check while its CMS and API are dead.

The 500 body is a bare `Internal Server Error`. The missing variable's name appears in the
server log and never in the response, which is what §4.1b requires.

### Empty is missing

A variable declared with no value — `SENTRY_DSN=` in a `.env`, a blank field in the Vercel
dashboard — arrives as `''`, and `@next/env` will not fall back to a lower-priority file once
the key exists at all. The module drops empty values before validating, so `''` and absent mean
the same thing and the error says "required" rather than "too small".

### `.env.local` loads in production builds too

`@next/env` loads `.env.local` for `next build` and `next start`, not only for `next dev` — it
is skipped only when `NODE_ENV=test`. A stray `.env.local` on a developer's machine will
therefore override `.env` during a production build. It is git-ignored; keep it that way, and
prefer `.env` unless you specifically want a local-only override.

## The three environments

Plan §4.1c requires Local, Preview and Production be kept distinct. `NODE_ENV` cannot express
that — Vercel builds preview deployments with `NODE_ENV=production`, collapsing two of the three.

`appEnv` is derived, never set by hand:

| `VERCEL_ENV` | `NODE_ENV` | → `appEnv` |
|---|---|---|
| `production` | — | `production` |
| `preview` | — | `preview` |
| `development` | — | `local` |
| absent, but `VERCEL` is set | — | `preview` |
| absent, not on Vercel | `production` | `production` |
| absent, not on Vercel | anything else | `local` |

The fourth row is the one that took a fix. A Vercel project with "Automatically expose System
Environment Variables" turned off has no `VERCEL_ENV`, and both preview and production build with
`NODE_ENV=production` — so inferring production from `NODE_ENV` alone silently granted a preview
branch the one privilege `production` carries: live payment credentials. It now answers `preview`,
which withholds it. A real production deployment in that state fails loudly at startup if it
carries live keys, and the error says to re-enable the setting.

The last two rows cover deployments that are not on Vercel at all, where a production build is
production.

**Live Stripe credentials outside production are a hard error**, not a warning. `sk_live_…`,
`rk_live_…` (a restricted key is still a live key) or `pk_live_…` in local or preview throws at
startup. §4.1c states the rule; charging a real card
from a preview branch is bad enough to enforce it rather than advise it.

## The schema-push guard — D-10

**The hazard.** Payload uses Drizzle's schema *push* in development (plan §5.1d), which rewrites
the schema of whatever `DATABASE_URL` points at. Disabling push outright was tried in Phase 2 and
withdrawn — see **DEV-17** — so it has to stay available. What it must not do is reach a database
that is not the development one.

**How narrow the hazard actually is.** A production build cannot push, and this is verifiable in
the emitted output rather than inferred: the guard reads `process.env.NODE_ENV` as a literal
member expression, Turbopack substitutes it at build time, and the whole decision constant-folds.
The production server chunk contains

```js
let dY = { allowed:!1, reason:'NODE_ENV is "production", not "development"', mismatch:!1 }
```

with no surviving `==="development"` comparison anywhere. `PAYLOAD_MIGRATING` covers the migrate
CLI. What remains is exactly two paths — `next dev`, and the unbundled `payload` CLI, which reads
`NODE_ENV` at true runtime. Both read `DATABASE_URL` from the same `.env`, so the realistic
accident is specific: someone points `.env` at a non-development database to look at something,
runs `pnpm dev`, and Drizzle rewrites that database's schema.

**The guard.** `DATABASE_PUSH_TARGET` names the one database push may modify, as
`host[:port]/database`. The port defaults to 5432 on both sides:

```bash
DATABASE_PUSH_TARGET=ep-cool-name-123456.us-east-2.aws.neon.tech/neondb
```

Push runs only when **all** of these hold:

1. `process.env.NODE_ENV` is exactly `development` — **unset does not count**, because a default of
   "development" is the wrong answer for a check that authorises writing to a database
2. `appEnv` is `local`
3. `DATABASE_PUSH_TARGET` is set, and is a bare `host[:port]/database` — a pasted connection string
   is rejected rather than parsed, both because it is the obvious slip and because it would put
   credentials into a log line
4. the database `DATABASE_URL` actually addresses matches it

Two independent facts now have to agree, and the second names the database explicitly. Swapping
`DATABASE_URL` alone therefore **disarms** push rather than aiming it somewhere new; re-arming it
is a deliberate second edit. That is what makes this structural rather than a reminder.

**"Actually addresses" is doing real work in point 4.** The identity is resolved the way `pg`
resolves it, not the way the URL reads:

- `?host=` and `?port=` **override** the URL's own hostname and port — `pg-connection-string`
  applies query parameters first. Reading `url.hostname` alone would let
  `postgres://…@dev-host/db?host=prod-host` connect to production while the guard inspected
  `dev-host`.
- The **port is part of the identity**. Two Postgres servers on one host are two databases.
- `?options=` is **refused, not interpreted**. Neon documents `?options=endpoint%3D<id>` for
  clients that cannot use SNI, and it reroutes to a different compute while the hostname stays put.
  The guard cannot resolve that, so it declines to arm rather than guess.
- Hostnames fold to lower case (DNS is case-insensitive); the **database name does not**, because a
  quoted Postgres identifier is case-sensitive and folding it would make the guard more permissive
  than the database is.

**One thing it does not cover.** Neon's pooled endpoint (`…-pooler.…`) and direct endpoint are
different hostnames for the same logical database, so pointing at one while the target names the
other reads as a mismatch. Use the direct endpoint locally, as `.env.example` says.

It is fail-closed. An unset `DATABASE_PUSH_TARGET` means no push — the safe default for an
operation that rewrites schemas is not to perform it. When push is off, `pnpm dev` says so and
tells you what to set:

```
[env] Schema push is disabled: DATABASE_PUSH_TARGET is not set.
      Payload will not create or alter tables, so /admin cannot build the schema.
```

On a mismatch it is more pointed, because that is the case worth noticing:

```
[env] Schema push is DISABLED: DATABASE_URL names "ep-prod-999.…:5432/northprod" and
      DATABASE_PUSH_TARGET permits "ep-dev-111.…:5432/neondb".
```

Neon gives each branch its own endpoint hostname, so branches of the same project are
distinguishable. If you ever run two databases on one host, the port and database name separate
them.

**What the guard does not cover.** It governs Drizzle's development schema push and nothing else.
Payload has other destructive paths, each gated differently: `PAYLOAD_DROP_DATABASE=true` drops the
schema, `payload migrate:fresh` rebuilds it, and the adapter will issue a real `CREATE DATABASE` if
a connection fails because the database does not exist. That last one is switched off here —
`disableCreateDatabase: true` in the Payload config — because an online-only storefront never wants
a database conjured by a typo. The other two are explicit commands, not accidents, and stay as they
are.

## Optional integrations

Plan §4.1b: an optional service that is absent must warn and degrade, never take the store down.
Stripe and Postgres are the only business-critical integrations.

Variables are grouped per provider, and a group is **all-or-nothing** — a Cloudinary cloud name
with no API secret is not a working Cloudinary, it is one that fails at the first upload.

| State | Meaning | Behaviour |
|---|---|---|
| `unconfigured` | no key present | normal before that phase lands; silent |
| `partial` | some keys present | **warned at every startup, in every environment**; treated as unavailable |
| `configured` | every key present | usable |

Two calls, for two situations:

```ts
integrationStatus('algolia')   // 'configured' | 'partial' | 'unconfigured' — degrade on this
requireIntegration('stripe')   // typed values, or throws naming what is missing
```

Use `integrationStatus` to decide whether a feature is available at all; use `requireIntegration`
only where the code genuinely cannot proceed — a Stripe webhook handler, a reindex job.

**Both are server-side.** Several groups have browser-safe members, but the functions read the
server tier and live behind the `server-only` guard, so a client component cannot call them.
Resolve availability in a server component and pass the answer down as a prop.

Two variables deliberately belong to no group: `SENTRY_AUTH_TOKEN`, consumed by the build to upload
source maps and absent at runtime by design, and `POSTHOG_API_KEY`, an optional extra even when
PostHog is configured. Grouping either would report a correctly configured server as
half-configured.

## The variables

Only `DATABASE_URL` and `PAYLOAD_SECRET` are required today. Everything else is declared but
optional until the phase that consumes it arrives, at which point that phase tightens its own
group — it does not get to rename it. Names marked **†** had no convention fixed by any canonical
document; Phase 4 chose them, recorded as **DEV-26**.

### Required now

| Variable | Tier | Environments | Source |
|---|---|---|---|
| `DATABASE_URL` | server | all three, a **different value in each** | Neon console → the **direct** (non-pooled) endpoint locally, the **pooled** (`-pooler`) one in a deployed environment. End it with `sslmode=verify-full`, not `require`. [`DATABASE.md`](DATABASE.md) §2 |
| `PAYLOAD_SECRET` | server | all three, a different value in each | self-generated: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Minimum 32 characters |

### Set by the platform — never write these into a `.env`

| Variable | Tier | Notes |
|---|---|---|
| `NODE_ENV` | ambient | Set by the Next CLI. Undefined under the `payload` CLI, so the schema defaults it to `development` |
| `VERCEL_ENV` | server | Supplied by Vercel when the project exposes system environment variables. Absent locally by design |
| `VERCEL` | server | Set by Vercel alongside `VERCEL_ENV`. Used only to detect the awkward case: plainly on Vercel, but `VERCEL_ENV` missing — which resolves to `preview`, not `production` |
| `VERCEL_PROJECT_PRODUCTION_URL` | server | Set by Vercel. The production deployment's hostname, no scheme. Read **only** as the fallback for `SITE_URL` |

### Project-owned

| Variable | Tier | First needed | Source |
|---|---|---|---|
| `DATABASE_PUSH_TARGET` | server | **Phase 4** — local development only | Derived from your own `DATABASE_URL`: `host[:port]/database`, credentials stripped |
| `SITE_URL` | server | **Phase 7** | The deployment's canonical origin, no trailing slash |

`SITE_URL` earned a paragraph of its own in Phase 7, because it stopped being a value nothing reads.

It resolves to `SITE_URL`, then `https://$VERCEL_PROJECT_PRODUCTION_URL`, then `http://localhost:3000`,
and the result is set on the Payload config as `serverURL`. Everything that has to name this
application in a link somebody else follows reads it: the password-reset email (Phase 7), Stripe's
success and cancel URLs (Phase 17), canonical tags and the sitemap (Phase 24).

**What it is deliberately not derived from is the request.** Building an absolute URL from the
incoming `Host` header is the standard shape of host-header injection, and password reset is its
textbook victim: an attacker triggers a reset for somebody else's address with a forged `Host`, and
the email that lands in the victim's inbox carries a real, valid token pointing at the attacker's
server. A value that comes from configuration cannot be steered by a request, and that is the whole
property being bought.

The practical consequence locally: if you run `next dev` on a port other than 3000, set `SITE_URL` to
match or the reset link in the server log will point at the wrong one.

### Per provider — optional until the phase lands

Every one of these is blocked on the project owner, and every one has a free or test tier.

| Variable | Tier | Phase | Source |
|---|---|---|---|
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | **public** | **8 — read now** | Cloudinary → Dashboard → Product Environment Credentials. Public by construction: it is a path segment of every delivery URL |
| `CLOUDINARY_API_KEY` | server | **8 — read now** | same |
| `CLOUDINARY_API_SECRET` | server | **8 — read now** | same. Read by exactly one file, `payload/storage/cloudinary.ts`, which the client graph cannot reach |

**Three Cloudinary variables are refused outright**, and the schema throws if any is set:
`CLOUDINARY_URL`, `CLOUDINARY_ACCOUNT_URL` and `CLOUDINARY_API_PROXY`. The `cloudinary` SDK reads all
three straight from `process.env` on its first `config()` call, merging them *underneath* whatever the
caller passes. `CLOUDINARY_URL` is the dangerous one: it is a single string of the form
`cloudinary://<key>:<secret>@<cloud>`, so its presence supplies a write credential behind this
project's deliberate three-variable scheme — and a malformed one throws inside the SDK at boot, far
from anything that names it. An allowlist cannot stop a library reading `process.env` directly, so
refusal is the only control that works.

**Phase 8 leaves Cloudinary optional, and says so loudly when that is wrong.** With the group
unconfigured, Payload keeps local-disk storage and the storefront renders every image as its
placeholder — correct for development, and *broken* on a serverless platform whose filesystem is
ephemeral and often read-only. `reportEnvironment` therefore warns whenever `appEnv` is not `local` and
the group is unconfigured. It warns rather than throws: `ARCHITECTURE.md` §2 requires an unavailable
optional service to degrade rather than stop the shop.
| `NEXT_PUBLIC_ALGOLIA_APP_ID` | **public** | 11 | Algolia → API Keys (shown at signup) |
| `NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY` **†** | **public** | 11 | Algolia → **Search API Key**. Read-only; a write through it is 403 |
| `ALGOLIA_WRITE_API_KEY` **†** | server | 11 | Algolia → **Write API Key**, *not* the Admin key. Development index only — see below |

**There is deliberately no fourth Algolia variable.** The index name is derived from `appEnv`
(`catalogIndexName`), because a name that can be set by hand can be set to the production index by
hand. Adding one to `INTEGRATIONS.algolia` would also make every currently-working three-key
environment report `partial`, which `getCatalog` treats as unconfigured — instantly disabling colour,
size and collection filtering across the whole shop.

Note that `integrationStatus('algolia')` requires the **write** key even on the read path. That is
intentional: a half-configured integration is reported at startup rather than discovered at the first
query, and the read path degrades gracefully either way.

The public search key's ACL is `['search','listIndexes','settings','browse']` with no index
restriction. `browse` is what makes `pnpm reindex:check` possible without the write key. Narrowing
the key to a single index is a reasonable tightening and is not done here.
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | **public** | 17 | Stripe → Developers → API keys. `pk_test_…` |
| `STRIPE_SECRET_KEY` | server | 17 | same. `sk_test_…` or a restricted `rk_test_…`; **never a `_live_` key outside production** |
| `STRIPE_WEBHOOK_SECRET` | server | 17 | Stripe → Webhooks → signing secret, `whsec_…` |
| `RESEND_API_KEY` | server | 19 | Resend → API Keys. Verified sending domain before any production send |
| `EMAIL_FROM` | server | 19 | Resend → Domains. The verified sending identity, `you@domain` or `Name <you@domain>` |
| `EMAIL_DEV_ALLOWLIST` | server | 19 | Yours to choose. **The dev safeguard** — outside production, mail goes only to these addresses; empty means none |
| `NEXT_PUBLIC_SENTRY_DSN` | **public** | 25 | Sentry → Project Settings → Client Keys. A DSN is public by design |
| `NEXT_PUBLIC_VERCEL_ENV` | **public** | 25 | **Set by Vercel, never by hand.** Present when *Automatically expose System Environment Variables* is on — the same setting `appEnv` depends on. Without it the browser reports `production` for a preview, splitting one deployment across two Sentry environments |
| `SENTRY_AUTH_TOKEN` | server | 25 | Sentry → Auth Tokens. Build-time only, for source-map upload |
| `NEXT_PUBLIC_POSTHOG_KEY` **†** | **public** | 25 | PostHog → Project Settings |
| `NEXT_PUBLIC_POSTHOG_HOST` **†** | **public** | 25 | PostHog region host, e.g. `https://eu.i.posthog.com` |
| `POSTHOG_API_KEY` **†** | server | 25 | PostHog, for server-side events where warranted |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` **†** | **public** | 25 | GA4 → Admin → Data Streams. `G-XXXXXXXXXX` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | **public** | 26 | Cloudflare → Turnstile |
| `TURNSTILE_SECRET_KEY` | server | 26 | same |

## Per-environment rules

**Local.** Neon *development* branch, direct endpoint (not the `-pooler` one). Stripe test mode.
Development Algolia index and Cloudinary folder. `DATABASE_PUSH_TARGET` set to that same branch.

**Preview.** A non-production database or an isolated Neon branch. Stripe test mode only.
Non-production credentials throughout. Push is off — `appEnv` is `preview`.

**Production.** Production database — the **pooled** (`-pooler`) endpoint, because a serverless
deployment is many processes each holding a pool — its own Payload secret, production media
namespace and search index, email from a verified domain. Stripe stays in test mode until real
payments are explicitly required. Push cannot run: the decision is constant-folded to `false` in the
build, and schema changes arrive through migrations applied by the build command (**D-16**,
[`DATABASE.md`](DATABASE.md) §6).

Never use production customer data in development.

## Adding a variable

1. Add it to the right schema — `env.public.ts` for browser-safe, `env.core.ts` for server-only — with the phase in a comment.
   Public entries also need a literal `process.env.NEXT_PUBLIC_…` line in `publicEnvSource` —
   Next substitutes that member expression textually at build time, so a dynamic read or a
   spread yields nothing in the browser.
2. Add it to `.env.example` with a comment, and no value.
3. Add it to the table above.
4. If it belongs to a provider group, add it to `INTEGRATIONS` so a half-filled group is caught.
5. If it is required, make sure the failure message tells someone how to fix it.
