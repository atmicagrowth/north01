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

Then fill in `.env`. Two variables, and the app needs both:

```bash
# 32 random bytes, hex. Server-only.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- `PAYLOAD_SECRET` — the value from that command.
- `DATABASE_URL` — a **Neon development branch** connection string. Never production, never a branch
  anyone else is using. The storefront builds and runs without it, but `/admin` and `/api/*` return
  HTTP 500 until it is set — Payload connects during `payload.init()`.

> **Use PostgreSQL 17 when creating the Neon project, not the default 18**, use the **direct**
> (non-pooled) endpoint locally, and end the string with **`sslmode=verify-full`** rather than
> `sslmode=require` — `pg` v9 redefines `require` as *skip certificate verification*. A Neon project's
> major version cannot be changed afterwards. Reasoning: notes §1.7.2 and §1.7.4.
>
> Missing either variable now fails immediately with a named error rather than starting in a broken state.
>
> **In development, Payload pushes schema changes straight into whatever `DATABASE_URL` points at.**
> Point it at a development branch and nothing else. See `docs/ARCHITECTURE.md` → **D-10**.

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
| `pnpm start` | Serve the production build |
| `pnpm typecheck` | TypeScript, no emit, strict |
| `pnpm lint` | ESLint — **fails on warnings** (`--max-warnings 0`) |
| `pnpm lint:fix` | ESLint with autofix |
| `pnpm format` | Prettier write (code only; Markdown is excluded) |
| `pnpm format:check` | Prettier check — use this in CI |
| `pnpm generate:types` | Regenerate `src/payload-types.ts` from the Payload config |
| `pnpm generate:importmap` | Regenerate the admin import map |
| `pnpm test` | Vitest unit/component tests *(pending — Phase 27)* |
| `pnpm test:e2e` | Playwright *(pending — Phase 27)* |

**Run `pnpm generate:types` after any change to a collection, global, or field.** The generated types are
committed and the build assumes they are current.

## Project layout

```text
src/
├─ app/
│  ├─ (frontend)/     storefront — its own root layout, imports Tailwind
│  └─ (payload)/      admin panel + Payload REST API — its own root layout
├─ payload.config.ts  aliased as @payload-config
└─ payload/           collections, access rules, hooks, migrations
```

Two things must stay true, or the Payload admin panel starts inheriting Tailwind's Preflight reset:

1. `src/app/(payload)/layout.tsx` never imports the storefront stylesheet.
2. No shared `src/app/layout.tsx` is added above the two route groups.

See `docs/ARCHITECTURE.md` → **D-08**.

**`/api/` is shared with Payload.** The app can own routes there — a static segment beats Payload's
catch-all — but a handler at `(frontend)/api/<name>` shadows the Payload collection endpoint of the same
name. Keep app handlers on names no collection would claim, such as `/api/stripe/*`.

Also: a folder starting with `_` is a Next.js *private folder* and is excluded from routing with no
warning. `api/_webhook/route.ts` will simply never exist.

## Generated files that are committed

Do not hand-edit these; regenerate them:

| File | Regenerate with | Written by |
|---|---|---|
| `src/app/(payload)/admin/importMap.js` | `pnpm generate:importmap` | Payload |
| `src/payload-types.ts` | `pnpm generate:types` | Payload |
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
| `[✓] Pulling schema from database...` | Drizzle's development push. Expected in dev, off everywhere else — see **D-10**. |

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
