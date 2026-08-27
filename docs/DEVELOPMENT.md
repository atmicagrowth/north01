# NORTH / 01 — Development

> Kept in step with the implementation as each phase lands. Sections marked **(pending)** describe work
> that has not been built yet and will be filled in by the phase that builds it.

## Prerequisites

| Requirement | Minimum | Verified locally |
|---|---|---|
| Node.js | 20.9.0 | 22.14.0 |
| pnpm | 9+ | 11.21.0 |
| Git | 2.x | 2.47.1 |

TypeScript is **not** installed globally — it is a pinned project devDependency. Do not rely on a global `tsc`.

If pnpm is missing: `corepack enable && corepack prepare pnpm@latest --activate`.

## Getting started

```bash
git clone <repository-url>
cd "apparel store"
pnpm install
cp .env.example .env
```

Then fill in `.env`. Two variables are required, and a third is needed for local schema work:

```bash
# 32 random bytes, hex. Server-only.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- `PAYLOAD_SECRET` — the value from that command. Minimum 32 characters.
- `DATABASE_URL` — a **Neon development branch** connection string. Never production, never a branch
  anyone else is using.
- `DATABASE_PUSH_TARGET` — the `host[:port]/database` of that same branch, e.g.
  `ep-cool-name-123456.us-east-2.aws.neon.tech/neondb`. Host and database only, never the whole
  connection string. Without it Payload will not create or alter tables, so a fresh database stays
  empty. See **the schema-push guard** below.

> **Use PostgreSQL 17 when creating the Neon project, not the default 18**, use the **direct**
> (non-pooled) endpoint locally, and end the string with **`sslmode=verify-full`** rather than
> `sslmode=require` — `pg` v9 redefines `require` as *skip certificate verification*. A Neon project's
> major version cannot be changed afterwards. Reasoning: notes §1.7.2 and §1.7.4.
>
> A missing or malformed required variable fails immediately with a named error — at build time, and
> at server startup. Every variable, where its value comes from, and which environments require it:
> **[`docs/ENVIRONMENT.md`](ENVIRONMENT.md)**.

### The schema-push guard

In development Payload pushes schema changes straight into whatever `DATABASE_URL` points at. That is
plan §5.1d's intended workflow and it stays — but it is aimed, not trusted.

`DATABASE_PUSH_TARGET` names the one database push may modify. Push runs only when `NODE_ENV` is
exactly `development` (unset does not count), the environment resolves to `local`, and the database
`DATABASE_URL` actually addresses matches that variable. Repointing `DATABASE_URL` therefore *disarms*
push rather than aiming it at the new database; re-arming is a deliberate second edit. It is
fail-closed — unset, ambiguous or unparseable all mean no push.

`pnpm dev` prints why push is off whenever it is. Full reasoning: [`docs/ENVIRONMENT.md`](ENVIRONMENT.md)
and `docs/ARCHITECTURE.md` → **D-10**.

```bash
pnpm dev
```

- Storefront → http://localhost:3000
- Payload admin → http://localhost:3000/admin

The first visit to `/admin` creates the schema and prompts you to create the first user.

> `pnpm install` runs postinstall scripts for `esbuild` and `unrs-resolver` only — pnpm 11 denies build
> scripts by default and those two are allowed explicitly in `pnpm-workspace.yaml`. Both fetch native
> binaries and both are required. If you see `ERR_PNPM_IGNORED_BUILDS`, that file did not get committed.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Local development server |
| `pnpm build` | Production build |
| `pnpm build:deploy` | `payload migrate && next build` — **the deployment build command**. See [`DATABASE.md`](DATABASE.md) §6 |
| `pnpm start` | Serve the production build |
| `pnpm typecheck` | TypeScript, no emit, strict |
| `pnpm lint` | ESLint — **fails on warnings** (`--max-warnings 0`) |
| `pnpm lint:fix` | ESLint with autofix |
| `pnpm format` | Prettier write (code only; Markdown is excluded) |
| `pnpm format:check` | Prettier check — use this in CI |
| `pnpm migrate:create <name>` | Generate the next migration from the config. Connects to no database |
| `pnpm migrate` | Apply every pending migration as one batch |
| `pnpm migrate:status` | Which migrations exist and which have run |
| `pnpm migrate:down` | Roll back the most recent batch |
| `pnpm migrate:fresh` | Drop every table and re-run every migration. **Development only** |
| `pnpm generate:types` | Regenerate `src/payload-types.ts` from the Payload config |
| `pnpm generate:importmap` | Regenerate the admin import map |
| `pnpm test` | Vitest unit/component tests *(pending — Phase 27)* |
| `pnpm test:e2e` | Playwright *(pending — Phase 27)* |

**Run `pnpm generate:types` after any change to a collection, global, or field.** The generated types are
committed and the build assumes they are current.

### Changing the schema

Local development uses Drizzle's push: edit a collection, restart `pnpm dev`, and the development
branch is altered in place. Every other environment gets committed migrations, so a schema change is
not finished until `pnpm migrate:create` has run and its three files are committed alongside the
config change.

The full workflow, the commit policy, the production procedure, the rollback path and the schema
conventions Phase 6 has to follow: **[`docs/DATABASE.md`](DATABASE.md)**.

One thing that catches everyone once: a generated migration destructures `{ db, payload, req }` and
uses only `db`. This project compiles with `noUnusedParameters`, so trim both signatures to `{ db }`
or `pnpm typecheck` fails. It is the only hand-edit a migration ever gets.

## Project layout

```text
src/
├─ app/
│  ├─ (frontend)/        storefront — its own root layout, imports Tailwind
│  │  ├─ globals.css     the design-token layer (Phase 3)
│  │  ├─ fonts/          self-hosted .woff2 + their OFL licence texts
│  │  └─ design-system/  the specimen sheet — see below
│  └─ (payload)/         admin panel + Payload REST API — its own root layout
├─ components/
│  ├─ ui/                primitives (button, input, dialog, drawer, …)
│  └─ layout/            global shell (header, nav, footer, containers)
├─ instrumentation.ts    startup environment validation (Phase 4)
├─ lib/
│  ├─ cn.ts              class composition, configured for this project's scales
│  ├─ env.public.ts      browser-safe environment — importable anywhere
│  ├─ env.server.ts      server-only environment — what application code imports
│  └─ env.core.ts        the same without the `server-only` guard; config and instrumentation only
├─ payload.config.ts     aliased as @payload-config
└─ payload/
   ├─ collections/       one file per collection
   └─ migrations/        generated, committed, applied in order (Phase 5)
```

**`env.server.ts` must never be imported from a client component** — and it cannot be: it imports
`server-only`, so doing that is a build error. Client code imports `env.public.ts`, which holds only
`NEXT_PUBLIC_*` values, and every one of those is compiled into the bundle every visitor downloads.
The prefix is a decision to publish.

`env.core.ts` is the same module without that guard, and exists only because the `payload` CLI runs
outside Next, where `server-only` cannot resolve. ESLint blocks importing it from anywhere but
`payload.config.ts` and `instrumentation.ts`. See [`docs/ENVIRONMENT.md`](ENVIRONMENT.md).

Two things must stay true, or the Payload admin panel starts inheriting Tailwind's Preflight reset:

1. `src/app/(payload)/layout.tsx` never imports the storefront stylesheet.
2. No shared `src/app/layout.tsx` is added above the two route groups.

See `docs/ARCHITECTURE.md` → **D-08**.

**`/api/` is shared with Payload.** The app can own routes there — a static segment beats Payload's
catch-all — but a handler at `(frontend)/api/<name>` shadows the Payload collection endpoint of the same
name. Keep app handlers on names no collection would claim, such as `/api/stripe/*`.

Also: a folder starting with `_` is a Next.js *private folder* and is excluded from routing with no
warning. `api/_webhook/route.ts` will simply never exist.

## The design system

Everything visual is governed by `src/app/(frontend)/globals.css`. Read the comments in it before
changing anything there — several of the choices are load-bearing and were made against measurements
recorded in `NORTH01_Implementation_Notes_and_Deviations.md` §1.8.

**`/design-system` is the specimen sheet.** It renders every primitive and shell component in
default / hover / focus / active / disabled / error / loading and at mobile width. It is the project's
answer to plan §3.1d, in place of Storybook — see **DEV-20**. It is `noindex, nofollow` and is not
linked from the storefront navigation. Open it after any visual change.

Four rules that are easy to break by accident:

1. **Do not use a raw palette colour.** There is no `bg-obsidian` — only `bg-canvas`. Tailwind's
   default colour, type, radius and shadow scales are cleared, so `bg-red-500`, `text-lg`,
   `rounded-2xl` and `shadow-xl` are compile errors rather than style bugs. That is deliberate.
2. **Add a token to `globals.css` and to `src/lib/cn.ts` together.** The second file teaches
   `tailwind-merge` which scale a class belongs to. Miss it and class overrides start failing
   silently.
3. **Use a duration token, never a bare `duration-200`.** `prefers-reduced-motion` is honoured by
   overriding the tokens in one media query; a hard-coded duration escapes it.
4. **Every `border-*` width needs a `border-<colour>` beside it.** Tailwind v4's Preflight resets
   borders to `currentColor`, so a bare `border` inherits the text colour. Use `border-border` for
   rules and dividers, `border-border-control` for anything interactive — the second is the one that
   meets WCAG 1.4.11, see **DEV-22**.
5. **Every page that renders `SiteHeader` must give its `<main>` `id="main-content"`.** The header
   carries the skip link (WCAG 2.4.1, Level A); without the target it points at nothing, and no
   automated check will tell you.
6. **Check the sibling or ancestor before using a `peer-*` or `group-*` variant.** `peer-*` needs a
   *preceding sibling* carrying `peer`; `group-*` needs an *ancestor* carrying `group`. Get it wrong
   and the class silently never matches — three shipped that way in Phase 3 and none of the gates
   noticed. See notes §1.8.10.
7. **Width names are not Tailwind's.** The container and max-width scales are cleared, so
   `max-w-sm`/`md`/`lg` do not exist; use `max-w-page`/`narrow`/`measure`/`dialog`/`drawer`/`panel`.
   Note that `w-*`/`max-w-*` still read `--spacing-*`, so `max-w-xs` is 6px.

`Button`, `Link`, `Badge`, `Skeleton` and the layout wrappers are server components. Anything wrapping
Radix carries `'use client'`; importing it from a server component is fine and creates the boundary
for you.

## Browser and accessibility checks

Playwright and axe-core are **Phase 27** dependencies and are not in `package.json`. Until then, run
them from a scratch directory against the dev server rather than installing them here.

Start the server on an explicit port and **confirm what it is serving before trusting it** — two
unrelated projects occupy `:3000` and `:3001` on the original development machine, and an early
screenshot pass once captured a different application entirely:

```bash
PORT=3210 pnpm dev
curl -s localhost:3210/api/users   # must return Payload's 403 JSON, not something else
```

## Generated files that are committed

Do not hand-edit these; regenerate them:

| File | Regenerate with | Written by |
|---|---|---|
| `src/app/(payload)/admin/importMap.js` | `pnpm generate:importmap` | Payload |
| `src/payload-types.ts` | `pnpm generate:types` | Payload |
| `src/payload/migrations/*.json` | `pnpm migrate:create` | Drizzle Kit — the schema snapshot the next migration diffs against |
| `src/payload/migrations/index.ts` | `pnpm migrate:create` | Payload — the barrel it rewrites on every generation |
| `AGENTS.md` (block between its BEGIN/END markers) | any `next dev` | Next.js |
| `pnpm-workspace.yaml` | `pnpm install` | pnpm |

`AGENTS.md` is re-created by `next dev` if deleted, so it is committed rather than fought. Project-owned
content lives **below** the `END:nextjs-agent-rules` marker, which Next does not touch.

## Expected dev-server output

`pnpm dev` prints several lines that look like problems and are not. Verified in Phase 2.

| Line | What it is |
|---|---|
| `⨯ turbopackServerFastRefresh` under *Experiments (use with caution)* | **Payload sets this**, not us. `withPayload` forces `experimental.turbopackServerFastRefresh: false` with the comment *"Server fast refresh breaks HMR"*. `⨯` is Next's marker for "this boolean is false", not an error. |
| `WARN: No email adapter provided. Email will be written to console.` | Expected until **Phase 19** adds Resend. Payload prints emails to the terminal meanwhile. |
| `[✓] Pulling schema from database...` | Drizzle's development push. Expected in dev **when the push guard is armed**, off everywhere else — see **D-10**. |
| `[env] Schema push is disabled: …` | The Phase 4 guard declined to arm. `DATABASE_PUSH_TARGET` is unset or malformed, or `DATABASE_URL` is ambiguous (an `options` parameter, a bad percent-escape). Payload will not create or alter tables. |
| `[env] Schema push is DISABLED: …` | The pointed version of the same guard: both values are valid but name **different databases**. Usually `DATABASE_URL` was repointed and the target was not. |
| `ERROR: Postgres pool client error…` | An idle connection died — Neon suspended the compute, the network dropped, or someone terminated the backend. The pool has already discarded it and the next query opens a new one. Logged rather than fatal on purpose; without the handler this is an `uncaughtException`. See [`DATABASE.md`](DATABASE.md) §9 |
| `[env] The <name> integration is partly configured — …` | Some of a provider's variables are filled in and others are not. The integration is treated as unavailable. Fill in the rest or clear them. |

### The `/admin` hydration warning is a browser extension

Logging into `/admin` may show *"A tree hydrated but some attributes of the server rendered HTML didn't
match"*, with the diff pointing at `<body className="vc-init">` and a stack inside
`node_modules/@payloadcms/next/.../Root/index.tsx`.

**Not a project bug.** Verified three ways:

1. The server-rendered HTML for `/admin` contains a bare `<body>` — `curl -s localhost:3000/admin | grep '<body'`.
2. `vc-init` appears in no file in `src/` and in no dependency in `node_modules/`.
3. The stack lands in Payload's own `<body>` because that element belongs to `@payloadcms/next`, not to us.

Something injects the class into the DOM after the server responds and before React hydrates — the
browser-extension case React's own error message lists. **Confirm it by opening `/admin` in a private
window with extensions disabled**; the warning disappears. It is a development-only warning and cannot
be fixed from this codebase.

## Working agreement

Taken from the master implementation plan. These are not suggestions.

**Before coding** — read the relevant phase, inspect what already exists, check package versions before
adding a dependency, and confirm the behaviour is not already implemented somewhere.

**During coding** — small coherent changes; typed interfaces; server-only code stays server-only; use the
existing design system rather than bypassing it; do not add a library when an installed one already
solves the problem; do not touch unrelated features.

**After coding** — run the narrowest relevant checks first, widening outward:

```
typecheck → lint → unit/component tests → targeted E2E → full build
```

Do not defer type errors to the end of the project.

## Phase completion gate

A phase is **not** complete because the code compiles. Every phase ends with:

1. Review `git diff` for unintended changes
2. Typecheck
3. ESLint
4. Relevant unit/component tests
5. Relevant E2E tests
6. Production build
7. Real-browser smoke test of the feature
8. Visual review against the visual guide and reference image, if any UI changed
9. Documentation updated
10. Commit

## Non-negotiables

- Never commit `.env`, secrets, API keys, or database dumps containing personal data.
- Never expose a server-only secret to client code.
- Never trust the browser for price, inventory, discount validity, tax, shipping, totals, or payment state.
- Never treat a browser reaching the success page as proof of payment — only a verified Stripe webhook is.
- Never introduce a physical-retail concept (see the online-only constraint in the README).
- Never build UI that looks functional but silently does nothing.

## Third-party accounts

Local development requires no paid service. Accounts are needed only from the phase that introduces them,
and every one has a free or test tier:

| Service | Needed from | Notes |
|---|---|---|
| Neon Postgres | **Phase 2** | Development branch, separate from production. Required for `/admin`. **PostgreSQL 17** |
| Cloudinary | Phase 8 | Development folder/preset |
| Algolia | Phase 12 | Development index |
| Stripe | Phase 17 | **Test mode only** |
| Resend | Phase 19 | Dev destination strategy; no production sends locally |
| PostHog / GA4 / Sentry | Phase 25 | Optional; the storefront must work without them |

Production credentials must never be used in local or preview environments.
