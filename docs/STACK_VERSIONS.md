# NORTH / 01 — Resolved Stack Versions

> Required by the master implementation plan, §1.2 "Version strategy" and §2.1a "Choose compatible versions".
>
> **Rule:** versions here are chosen from *verified compatibility evidence*, never from the npm `latest` tag.
> Every pin below is justified. Re-verify before any core upgrade and re-run the Gate 1 checks.

**Verified:** 2026-08-22 · **Verification method:** npm registry metadata (`npm view <pkg> peerDependencies engines`) plus a
`pnpm install --lockfile-only --strict-peer-dependencies` full-graph resolution dry-run.

---

## 1. Local toolchain (as installed)

| Tool | Installed | Required by stack | Status |
|---|---|---|---|
| Node.js | 22.14.0 | `>=20.9.0` (Next 16), `^18.20.2 \|\| >=20.9.0` (Payload 3) | OK |
| pnpm | 11.21.0 | canonical package manager | OK |
| Git | 2.47.1.windows.2 | — | OK |
| Corepack | 0.31.0 | — | available |
| TypeScript | not installed globally | — | intentional; pinned as a project devDependency |

---

## 2. Core framework pins

| Package | Pin | Why this version |
|---|---|---|
| `next` | 16.3.2 | Current stable. Inside `@payloadcms/next@3.88.0`'s supported range `>=16.2.6 <17.0.0`. |
| `react` / `react-dom` | 19.2.8 | Satisfies Next 16 (`^19.0.0`) and Payload's stricter `^19.0.1 \|\| ^19.1.2 \|\| ^19.2.1`. |
| `payload` | 3.88.0 | Current stable `latest`. **Payload 4.x is canary only — excluded.** |
| `@payloadcms/next` | 3.88.0 | Declares `payload: "3.88.0"` as an *exact* peer. |
| `@payloadcms/db-postgres` | 3.88.0 | Exact peer `payload: "3.88.0"`. Drizzle + node-postgres under the hood. |
| `@payloadcms/richtext-lexical` | 3.88.0 | Exact peer. Required only once rich-text fields exist (Phase 6). |
| `graphql` | 16.14.2 | **Unavoidable peer dependency of `payload` itself** (`^16.8.1`). See note in §5. |
| `sharp` | 0.35.3 | Required by Payload image resizing. Added only when media handling begins (Phase 8). |

**Every `@payloadcms/*` package must move in lockstep at the identical version.** They declare exact
peers on `payload`, so a mixed set will not resolve.

---

## 3. Deliberate rejections of the `latest` tag

These are the cases where installing `latest` would have broken the build. Recorded because the plan
explicitly forbids blind upgrades.

| Package | `latest` | **Pinned** | Evidence for rejecting `latest` |
|---|---|---|---|
| `typescript` | 7.0.2 | **5.9.3** | `typescript-eslint@8.46.0` — pulled in transitively by `eslint-config-next@16.3.2` — declares `typescript: ">=4.8.4 <6.0.0"`. TS 7 is the Go-port major and is outside every consumer's supported range. |
| `eslint` | 10.9.0 | **9.39.5** | Same package declares `eslint: "^8.57.0 \|\| ^9.0.0"`. A dry-run with ESLint 10 fails with `ERR_PNPM_PEER_DEP_ISSUES: unmet peer eslint`. |
| `payload` | 3.88.0 | 3.88.0 | (`4.0.0-canary.29` exists on the `canary` tag — not stable, excluded.) |

> `eslint@9.39.5` emits a deprecation notice ("no longer supported"). This is **accepted deliberately**:
> the Next 16 lint chain does not yet support ESLint 10. Revisit when `eslint-config-next` ships ESLint 10 support.

---

## 4. Supporting libraries (versions confirmed available; install per phase, not up front)

Per plan §2.1b: *"Do not install the entire final dependency list on day one."*

| Package | Available | Introduced in |
|---|---|---|
| `tailwindcss` + `@tailwindcss/postcss` | 4.3.3 | Phase 2/3 |
| `shadcn` (CLI) | 4.19.0 | Phase 3 |
| `motion` | 13.1.1 | Phase 3 |
| `lucide-react` | 1.33.0 | Phase 3 |
| `class-variance-authority` / `tailwind-merge` / `clsx` | 0.7.1 / 3.6.0 / 2.1.1 | Phase 3 |
| `zod` | 4.4.3 | Phase 4 |
| `react-hook-form` + `@hookform/resolvers` | 7.86.0 / 5.9.1 | Phase 7 |
| `nuqs` | 2.10.0 | Phase 11 |
| `algoliasearch` | 5.57.0 | Phase 12 |
| `stripe` | 22.5.0 | Phase 17 |
| `resend` + `react-email` + `@react-email/components` | 6.22.0 / 6.9.2 / 1.0.12 | Phase 19 |
| `cloudinary` | 2.10.1 | Phase 8 |
| `posthog-js` | 1.418.10 | Phase 25 |
| `@sentry/nextjs` | 10.70.0 | Phase 25 |
| `@vercel/speed-insights` | 2.0.0 | Phase 25 |
| `vitest` | 4.1.11 | Phase 27 |
| `@playwright/test` | 1.62.1 | Phase 27 |
| `@axe-core/playwright` | 4.13.0 | Phase 27 |
| `prettier` | 3.9.6 | Phase 2 |

---

## 5. Notes and known integration hazards

1. **GraphQL is not an architectural choice here.** Plan §2.1b says *"Do not add GraphQL unless the project
   actually requires it."* However `graphql@^16.8.1` is a hard `peerDependency` of the `payload` package
   itself and cannot be omitted. It is installed as an implementation-detail dependency of an approved
   stack technology. We do **not** expose a GraphQL API surface; `@payloadcms/graphql` is not installed.

2. **No official Cloudinary storage adapter exists for Payload.** `@payloadcms/storage-cloudinary` returns
   404 on the npm registry. Official adapters cover S3, Vercel Blob, Azure, GCS and Uploadthing only.
   See `docs/ARCHITECTURE.md` → "Decision D-03" for the resolution.

3. **pnpm 11 `minimumReleaseAge` gating.** pnpm 11 writes recently-published packages into a
   `minimumReleaseAgeExclude` list in `pnpm-workspace.yaml` during resolution. This file is generated and
   must be committed so CI resolves identically.

4. **Tailwind v4 preflight vs. the Payload admin route.** Payload's admin panel ships its own stylesheet.
   Tailwind's global preflight must be scoped so it does not leak into `/admin`. To be verified during
   Phase 2 Gate 1 (acceptance criterion: "Payload admin loads" — *and looks correct*).

## 6. Resolution proof

Full-graph dry-run with the §2 + §3 pins:

```
pnpm install --lockfile-only --strict-peer-dependencies
→ resolved 825 packages, done. Exit 0. No unmet peer dependencies.
```

This satisfies plan §2.1a acceptance criterion *"No unresolved peer-dependency warnings."*
