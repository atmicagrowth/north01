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
cp .env.example .env          # (pending — Phase 4)
pnpm dev                      # (pending — Phase 2)
```

- Storefront → http://localhost:3000
- Payload admin → http://localhost:3000/admin *(pending — Phase 2)*

## Scripts

*(pending — defined in Phase 2)* The project will expose at minimum:

| Script | Purpose |
|---|---|
| `pnpm dev` | Local development server |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier write |
| `pnpm test` | Vitest unit/component tests |
| `pnpm test:e2e` | Playwright |

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
| Neon Postgres | Phase 5 | Development branch/database, separate from production |
| Cloudinary | Phase 8 | Development folder/preset |
| Algolia | Phase 12 | Development index |
| Stripe | Phase 17 | **Test mode only** |
| Resend | Phase 19 | Dev destination strategy; no production sends locally |
| PostHog / GA4 / Sentry | Phase 25 | Optional; the storefront must work without them |

Production credentials must never be used in local or preview environments.
