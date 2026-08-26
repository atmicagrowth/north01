# NORTH / 01 — Implementation Notes and Deviations

> **This document takes precedence over `NORTH01_Claude_Implementation_Plan_Current_OnlineOnly.md`
> and over every other canonical project document.**
>
> It is the living record of what was actually discovered, decided, and changed while building
> NORTH / 01. Where anything here contradicts the implementation plan, the tech stack, the feature
> matrix, the website-structure document, or the visual guide, **this document wins** — because the
> statements here were verified against the real toolchain, the real registry, and the real codebase,
> whereas the canonical documents were written in advance.
>
> **Maintenance is mandatory.** At the end of every implementation phase, before that phase is
> considered complete, append this document with any new notes and any new deviations produced by that
> phase. A phase that changed behaviour without updating this document is not finished.

---

## How to use this document

**Section 1 — Notes** records facts established during implementation that the canonical documents do
not contain. Verified environment state, resolved package versions, integration findings, known hazards,
and the things that need the project owner rather than the engineer. Nothing in Section 1 contradicts the
plan; it fills in what the plan deliberately left to be determined at implementation time.

**Section 2 — Deviations** records every place where the implementation departs from what a canonical
document actually says. Each entry states what the document says, what we do instead, why, and which
document the precedence hierarchy makes authoritative. These are the entries that override the plan.

**Section 3 — Append log** tracks which phase added what, so the document can be read as a history.

Identifiers are stable and carry across documents. `C-xx` are contradictions between canonical documents,
`D-xx` are implementation decisions, and `G-xx` are specification gaps — the same IDs used in
`docs/ARCHITECTURE.md`. Do not renumber them.

---

# 1. Notes

Established during implementation. Not present in any canonical document.

## 1.1 Environment and repository

| Fact | Value |
|---|---|
| Platform | Windows 11 Home (10.0.26200) |
| Node.js | 22.14.0 — satisfies Next 16 (`>=20.9.0`) and Payload 3 (`^18.20.2 \|\| >=20.9.0`) |
| pnpm | 11.21.0 |
| Git | 2.47.1.windows.2 |
| TypeScript | not installed globally — intentional; it is a pinned project devDependency. Do not rely on a global `tsc`. |
| Corepack | 0.31.0 |
| Disk free | 45.7 GB at Phase 1 |
| Git identity | `atmicagrowth` (already configured globally; not overridden) |

- The project directory was **empty apart from the six specification documents** at the start of Phase 1.
  No prior Git repository anywhere up the tree, no `package.json`, no `node_modules`, no `.env`, no source.
  Nothing existed that needed preserving, refactoring, or replacing.
- Repository initialized on `main`. Baseline commit `96a3d9d`.
- Remote: **https://github.com/atmicagrowth/north01** — **public**, by the project owner's explicit
  decision. Consequence to keep in mind: the six specification documents are published with the code, so
  the architecture, build order, and service choices are readable by anyone. Nothing secret may ever be
  committed, and `.gitignore` blocks `.env*`, database dumps, and build output from Phase 1 onward.

## 1.2 Verified version matrix

The plan (§1.2, §2.1a) requires versions to be chosen from compatibility evidence at implementation time
rather than copied from the document. This is that evidence. Full detail and the resolution proof live in
[`docs/STACK_VERSIONS.md`](docs/STACK_VERSIONS.md).

**Core pins**

| Package | Pin | Basis |
|---|---|---|
| `next` | 16.3.2 | Inside `@payloadcms/next@3.88.0`'s supported range `>=16.2.6 <17.0.0` |
| `react` / `react-dom` | 19.2.8 | Satisfies Payload's stricter `^19.0.1 \|\| ^19.1.2 \|\| ^19.2.1` |
| `payload` and all `@payloadcms/*` | 3.88.0 | Current stable. **Payload 4.x exists only on the `canary` tag — excluded.** |
| `typescript` | 5.9.3 | See below |
| `eslint` | 9.39.5 | See below |
| `graphql` | 16.14.2 | Hard peer of `payload` itself |

**All `@payloadcms/*` packages must move in lockstep at the identical version.** They declare exact peers
on `payload`, so a mixed set will not resolve at all.

**Two cases where `latest` is wrong.** Both trace to `typescript-eslint@8.46.0`, which
`eslint-config-next@16.3.2` pulls in transitively:

- It declares `typescript: ">=4.8.4 <6.0.0"` — so **TypeScript 7.0.2 (`latest`) is excluded.** TS 7 is the
  Go-port major and sits outside every consumer's supported range.
- It declares `eslint: "^8.57.0 || ^9.0.0"` — so **ESLint 10.9.0 (`latest`) is excluded.** A resolution
  dry-run with ESLint 10 fails outright with `ERR_PNPM_PEER_DEP_ISSUES: unmet peer eslint`.

`eslint@9.39.5` emits a deprecation notice ("no longer supported"). **This is accepted deliberately** —
the Next 16 lint chain does not yet support ESLint 10. Revisit when `eslint-config-next` ships ESLint 10
support, and re-run the Gate 1 checks when doing so.

**Resolution proof.** The full graph resolves clean:
`pnpm install --lockfile-only --strict-peer-dependencies` → 825 packages, exit 0, no unmet peers. This
satisfies the plan's §2.1a acceptance criterion *"No unresolved peer-dependency warnings."*

**Supporting libraries**, confirmed available and to be installed by the phase that needs them, never up
front (plan §2.1b): `tailwindcss` 4.3.3 · `shadcn` CLI 4.19.0 · `motion` 13.1.1 · `lucide-react` 1.33.0 ·
`nuqs` 2.10.0 · `zod` 4.4.3 · `react-hook-form` 7.86.0 · `stripe` 22.5.0 · `resend` 6.22.0 ·
`react-email` 6.9.2 · `algoliasearch` 5.57.0 · `cloudinary` 2.10.1 · `posthog-js` 1.418.10 ·
`@sentry/nextjs` 10.70.0 · `vitest` 4.1.11 · `@playwright/test` 1.62.1 · `@axe-core/playwright` 4.13.0 ·
`sharp` 0.35.3 · `prettier` 3.9.6.

## 1.3 Integration findings

**There is no official Payload Cloudinary adapter.** `@payloadcms/storage-cloudinary` returns 404 on the
npm registry. Payload's official storage adapters cover S3, Vercel Blob, Azure, GCS and Uploadthing only.
The tech stack mandates Cloudinary and forbids a second media CDN, so changing providers is not an option.
Resolution in **D-03**.

**GraphQL cannot be avoided.** `graphql@^16.8.1` is a hard `peerDependency` of the `payload` package
itself. Resolution in **D-02**.

## 1.4 Known hazards

Recorded now, to be resolved by the phase that meets them.

- ~~**Tailwind v4 preflight vs. the Payload admin panel.**~~ **Closed in Phase 2 — it cannot occur.**
  The two route groups have separate root layouts, so Next.js builds them as separate CSS graphs.
  Verified against the production build: the Tailwind chunk is referenced by the storefront document and
  by no admin bundle. No `@source` scoping, `important` selector, or preflight opt-out was needed. The
  rule that keeps it true: **`(payload)/layout.tsx` must never import the storefront stylesheet.**
- ~~**pnpm 11 `minimumReleaseAge` gating.**~~ **Did not materialise** — see §1.7.1. `pnpm-workspace.yaml`
  is committed regardless, because pnpm 11's `allowBuilds` gate lives in it and two entries are required.
- **Windows line endings.** `.gitattributes` normalizes to LF in the repository. Do not disable this;
  Playwright snapshots and generated Payload types are sensitive to it.

## 1.5 Blocked on the project owner

The engineer cannot provision these. Each is needed from the phase named, and every one has a free or
test tier — no paid service is required for local development.

| Service | Needed from | What is required |
|---|---|---|
| ~~**Neon Postgres**~~ | ~~**Phase 2**~~ | **RESOLVED 2026-08-22.** Development branch provisioned, PostgreSQL 17.11. Phase 2 proved this lands earlier than Phase 5 — see **DEV-15** and §1.7.2. |
| Cloudinary | Phase 8 | Cloud name, API key/secret, development folder or preset |
| Algolia | Phase 12 | App ID, search-only key, admin key, development index |
| Stripe | Phase 17 | **Test mode only.** Secret key, publishable key, webhook signing secret |
| Resend | Phase 19 | API key; verified sending domain before any production claim |
| PostHog / GA4 / Sentry | Phase 25 | Optional — the storefront must work fully without them |

~~Phases 2, 3 and 4 need none of these.~~ **Corrected in Phase 2:** Phase 2 needs Neon. Phases 3 and 4
need none of these. See **DEV-15**.

## 1.6 Process notes

- **The pre-Phase-1 consistency gate was executed**, as the plan requires, and its result is recorded in
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#3-cross-document-consistency-audit). Method: six
  independent auditors swept the corpus along separate dimensions, then every claimed contradiction was
  handed to an adversarial verifier instructed to refute it and to confirm both quotes existed verbatim.
  22 of 24 verified claims were refuted as context-dissolving, misquoted, or jointly satisfiable. Outcome:
  **the corpus is architecturally consistent** — 11 real contradictions, all documentation drift or IA
  naming, none touching stack, business model, data ownership, or build order.
- The gate produced **14 specification gaps** — requirements every document assumes and none defines. Each
  is assigned to the phase that first needs it. See `docs/ARCHITECTURE.md` §3.2 and Section 2 below.
- **The reference image is not authoritative** and several elements drawn in it are deliberately out of
  scope. See **DEV-09**.

---

## 1.7 Phase 2 — Next.js + Payload scaffold

Sections 1.1–1.6 are Phase 1's, organised by topic. From here the notes are organised by phase, one
section each, so the document reads as history.

### 1.7.1 What the scaffold actually resolved to

**Install result.** `pnpm install --strict-peer-dependencies` resolves the full graph to **706 packages**
from **16 direct dependencies** (7 runtime, 9 dev), exit 0, **no peer-dependency warnings**. This is the
real number; the 825 figure in §1.2 came from a lockfile-only dry run that included packages later phases
will add. Plan §2.1a's acceptance criterion *"No unresolved peer-dependency warnings"* is met.

**The foundation deliberately installs 16 packages, not the stack list.** Per plan §2.1b, deferred and
*not* installed at Phase 2: `@payloadcms/richtext-lexical` (Phase 6, when rich-text fields first exist),
`sharp` (Phase 8, with the media collection), and every supporting library in §1.2. `graphql@16.14.2` is
present only because it is a hard peer of `payload` — see **DEV-04**.

**pnpm 11 gates build scripts, and two must be allowed.** pnpm 11 denies package build scripts by default
and writes an `allowBuilds` map into `pnpm-workspace.yaml`. Two entries are required, not optional:

| Package | Why it must be allowed |
|---|---|
| `esbuild` | Payload's config loader compiles `payload.config.ts` through esbuild; its postinstall downloads the platform-native binary. Without it the Payload CLI and `/admin` cannot load the config at all. |
| `unrs-resolver` | The module resolver behind `eslint-plugin-import-x`, which `eslint-config-next` depends on. Same native-binary postinstall. |

`pnpm-workspace.yaml` is committed for this reason. Note the key is **`allowBuilds`** in pnpm 11, not the
`onlyBuiltDependencies` used by pnpm 9/10.

**`minimumReleaseAge` gating did not materialise.** §1.4 anticipated pnpm 11 writing a
`minimumReleaseAgeExclude` list. With the pinned versions it did not — no such key was generated. The
hazard is closed for now; re-check when adding recently-published packages in later phases.

**`eslint-config-next@16.3.2` ships native flat config.** It exports `Linter.Config[]` arrays from
`./core-web-vitals` and `./typescript`, so `eslint.config.mjs` composes them directly. **No `FlatCompat`
shim and no `@eslint/eslintrc` dependency are needed** — one fewer dependency than the pattern most
Next 15-era guidance still shows.

**Next.js 16 generates `AGENTS.md` and `CLAUDE.md` on every `next dev`.** `next dev` writes an agent-rules
block delimited by `<!-- BEGIN:nextjs-agent-rules -->` / `<!-- END:nextjs-agent-rules -->` and re-creates
it if deleted, so deleting it only guarantees a permanently dirty tree. Both files are committed. Project
content is appended **below** the END marker, where Next does not touch it, and points at this document's
precedence hierarchy. It can be turned off with `agentRules: false` in `next.config.mjs`; it is left on
deliberately because the pointer to `node_modules/next/dist/docs/` is genuinely useful on a major this new.

**Next.js rewrites `tsconfig.json` during `build` unless it already agrees.** The first build reformatted
the file and forced `jsx: "react-jsx"` plus `.next/dev/types/**/*.ts` in `include`. Both are now written
into the committed `tsconfig.json`, and a subsequent build leaves the file byte-identical — verified.

**Prettier is scoped to code, not Markdown.** Running it across `*.md` reflowed every hand-authored table
in `README.md` and `docs/` — 136 lines of pure padding churn with no content change. `*.md` is in
`.prettierignore`; Markdown line endings and indentation stay governed by `.editorconfig`.

### 1.7.2 Gate 1, verified against a real database

Neon development branch provisioned by the project owner. **PostgreSQL 17.11**, chosen over Neon's
current default of 18 — see the note below. Direct (unpooled) endpoint, `sslmode=require`.

**Gate 1, all six criteria verified against the running application:**

| # | Criterion | Evidence |
|---|---|---|
| 1 | Frontend loads | `GET /` → 200, RSC-rendered, Tailwind chunk applied |
| 2 | Payload admin loads | `GET /admin` → 200 (`Dashboard · NORTH / 01`); `GET /admin/create-first-user` → 200 with the form rendered |
| 3 | Build passes | `pnpm build` → 4 routes; `/admin` and `/api/*` dynamic, never prerendered |
| 4 | Typecheck passes | `tsc --noEmit`, strict |
| 5 | Lint passes | `eslint --max-warnings 0` |
| 6 | Known-good baseline committed | branch `phase-2-scaffold-next-payload` |

**Payload API — full auth round-trip, not just a liveness check:**

| Request | Result |
|---|---|
| `GET /api/users` unauthenticated | **403** — correct. Payload's default access control denies it. A 403 here is the API working, not failing. |
| `POST /api/users/first-register` | 200, user persisted, JWT issued |
| `POST /api/users/login` | 200, JWT issued |
| `GET /api/users` with JWT | 200, `totalDocs=1` |
| `GET /api/users/me` with JWT | 200, identity echoed |

**Schema created by push on first `/admin` hit — 8 tables:** `users`, `users_sessions`,
`payload_preferences`, `payload_preferences_rels`, `payload_locked_documents`,
`payload_locked_documents_rels`, `payload_migrations`, `payload_kv`.

**Runtime confirmation of the CSS isolation.** `/admin` loads exactly one stylesheet, Payload's own. The
storefront's Tailwind chunk is absent from the served admin document — so the isolation holds at runtime,
not only in the build manifest. This is the second, independent confirmation of **D-08**.

**Why PostgreSQL 17 and not Neon's default 18.** Neon made PG 18 the default for new projects in June
2026. Payload had a genuine PG 18 incompatibility — [issue #13963](https://github.com/payloadcms/payload/issues/13963):
PG 18 refuses `DROP CONSTRAINT` on a NOT NULL belonging to a primary key column, which is exactly what
Drizzle emits during migrations. It is **fixed** — PR #14700, merged 2025-11-20, shipped in **v3.65.0**,
and our pinned 3.88.0 is 842 commits past it with `behind_by 0`. PG 17 was chosen anyway because **a Neon
project's major version cannot be changed after creation** (it requires a new project plus a data
migration), the phases immediately ahead are precisely the migration-heavy ones, and nothing in the
corpus needs a PG 18 feature. PG 17 is supported by Neon until 2029.

**`sslmode=require` will change meaning in `pg` v9.** ~~Revisit at Phase 5 or at any `pg` major
upgrade.~~ **Closed 2026-08-23 — the connection string now uses `verify-full` explicitly.** See §1.7.4.

### 1.7.3 Confirmation sweep of earlier deviations

Required by the plan's append rule, step 4: *"Confirm that deviations recorded earlier and marked 'to be
confirmed in Phase N' have in fact been confirmed."*

| Entry | Due | Status after Phase 2 |
|---|---|---|
| **DEV-04** — GraphQL installed, never exposed | Phase 2 | **Confirmed.** `graphql@16.14.2` installed as a peer of `payload`; `@payloadcms/graphql` absent; the `api/graphql` and `api/graphql-playground` route files from the blank template were deliberately not created. Build manifest shows `/api/[...slug]` and no GraphQL route. |
| **DEV-14** — substantial work uses feature branches | Phase 2 | **Confirmed.** Phase 2 ran on `phase-2-scaffold-next-payload`, not `main`. |
| **DEV-18, DEV-19** | Phase 2 | **Recategorised** — they recorded compliance, not departure. Content moved to §1.7.5; the entries remain as tombstones so the identifiers stay stable. |
| DEV-05 — Cloudinary first-party adapter | Phase 8 | Still pending. Not due. |
| DEV-03 — order state as two axes | Phase 18 | Still pending. Not due. |

No other deviation was due for confirmation in Phase 2.

### 1.7.4 Debt cleared before Phase 3

Three items closed on 2026-08-23, each from Phase 2's own edge-case list (§2.1c) rather than pulled
forward from a later phase.

**1. `process.env.X || ''` removed — it was the silent substitution §4.1b forbids.**

`payload.config.ts` defaulted both `DATABASE_URL` and `PAYLOAD_SECRET` to `''`. Plan §4.1b is explicit:
*"Do not silently substitute fake values"*, and Phase 2's edge-case list names *"Environment variables
accessed without availability."* An empty `PAYLOAD_SECRET` is the serious half — Payload would sign
session tokens with nothing.

Both now go through a `requireServerEnv` helper that throws at config load. Verified by removing each
variable in turn:

```
Error: PAYLOAD_SECRET is not set. Copy .env.example to .env and fill it in; see docs/DEVELOPMENT.md.
Error: DATABASE_URL is not set. Copy .env.example to .env and fill it in; see docs/DEVELOPMENT.md.
```

This is six lines, not an environment system. **Phase 4 still owes the typed Zod module** (§4.1a) that
separates browser-safe from server-only variables; this only removes the landmine in the meantime. The
variable name appears in the message safely because it throws server-side at config load and never
reaches an API response, as §4.1b requires.

**2. `sslmode=require` → `sslmode=verify-full`.**

`pg@8.20.0` warns that it currently treats `require` as `verify-full` and that **pg 9 will adopt libpq
semantics, where `require` skips certificate verification.** Left alone, a routine `pg` major upgrade
would silently downgrade TLS on the connection carrying customer and order data. Spelling out
`verify-full` today is behaviour-neutral — verified connecting against Neon — and immune to that change.
Applied to `.env` and documented in `.env.example`. **The pg-v9 debt item is closed, not deferred.**

**3. The `/api` namespace is shared with Payload — verified, not assumed.**

Payload's REST catch-all lives at `src/app/(payload)/api/[...slug]`, and Phase 17 needs a Stripe webhook
at `/api/stripe/webhook`. Whether those can coexist was an open structural question. Tested with a real
probe route in the `(frontend)` group:

| | |
|---|---|
| Build manifest | both registered — `/api/stripe/webhook` **and** `/api/[...slug]` |
| `GET /api/stripe/webhook` | 200, served by the storefront route |
| `GET /api/users` | 403, still served by Payload's catch-all |

**A static segment beats the catch-all, and both keep working.** Phase 17 needs no special routing, no
`routes.api` override, and no second API prefix. Probe removed after the test.

> **The rule this creates.** A storefront route handler under `/api/` shadows any Payload collection
> endpoint of the same name. `src/app/(frontend)/api/users/route.ts` would silently take over
> `/api/users`. **Phase 6 must check new collection slugs against storefront routes under `/api/`, and
> vice versa.** Keep app-owned handlers on names no collection would ever claim — `/api/stripe/*`,
> `/api/webhooks/*`.

*Also note: a folder whose name starts with `_` is a Next.js private folder and is excluded from routing
entirely. The first probe was named `_probe` and vanished from the manifest with no warning.*

### 1.7.5 Foundation choices that follow the plan rather than depart from it

Recorded here rather than in Section 2 because Section 2 is reserved for entries that **override** a
canonical document, and neither of these does. Both are easy to mistake for oversights, which is why they
are written down.

**No Lexical editor and no `sharp` at Phase 2.** Plan §2.1b: *"Add the Lexical rich-text package only if
rich-text fields are used. Add `sharp` only if the chosen Payload media configuration needs local image
manipulation."* Phase 2 defines one auth collection with neither a rich-text field nor a media
collection, so `buildConfig` carries no `editor` key and no `sharp` key.

`@payloadcms/richtext-lexical` arrives in Phase 6 with the first rich-text field; `sharp` in Phase 8 with
the media collection. **Consequence:** adding a `richText` field before installing Lexical fails at config
build with a missing-editor error. That failure is the guardrail working, not a defect.

**The `users` collection is scaffolding, not the account model.** Payload requires exactly one
auth-enabled collection to own the admin panel. `src/payload/collections/Users.ts` is that and nothing
more — `auth: true`, no roles, no custom fields, no access rules. Roles and access control are Phase 7
(§7.1a–7.1e); customer accounts and the rest of the data model are Phase 6. **This file must not
accumulate fields in the meantime.**

### 1.7.6 Visual review of the Phase 2 baseline page

Required by the plan's visual-reference rule 6 — *"Every new page ... must be reviewed against the visual
guide before its phase is considered complete"* — and by step 8 of the phase completion gate in
`docs/DEVELOPMENT.md`. Reviewed in a real browser at 1440×900 and 390×844, with computed styles read back
rather than judged by eye.

| Guide requirement | Measured |
|---|---|
| Obsidian `#0A0A0A` primary background | `rgb(10, 10, 10)` ✓ |
| Bone `#F1EEE8` primary text | `rgb(241, 238, 232)` ✓ |
| Stone secondary text, Graphite rules | applied to metadata labels and hairlines ✓ |
| "Oversized type with tiny metadata" (§01 Visual Tension) | 72px serif display against 12px tracked uppercase ✓ |
| No SaaS card system, pills, glassmorphism, gradients (rule 5) | none present ✓ |
| Responsive, no horizontal overflow | `scrollWidth === clientWidth` at both 1440 and 390 ✓ |
| Payload admin unaffected by Tailwind | admin `<body>` computes to Payload's own colours, not Bone ✓ |

**Known and accepted:** the display face resolves to Tailwind's generic `ui-serif, Georgia, …` stack, not
the *"refined, high-contrast serif"* the guide specifies. **Phase 3 (§3.1b) owns typography** and replaces
it. Phase 2 deliberately installs no font.

**Hazard found while doing this review — verify what a port is serving before trusting it.** Two unrelated
projects were listening on `localhost:3000` and `:3001` on this machine, and an earlier screenshot pass
captured *a different application entirely*. Any browser-based check must first confirm identity — for this
project, `GET /api/users` returning Payload's `{"errors":[{"message":"You are not allowed to perform this
action."}]}`. Prefer an explicit `PORT=` over the 3000 default.

---

## 1.8 Phase 3 — design system and UI foundation

Phase 3 needed no third-party account and no database. It resolved four questions no canonical
document settles — **G-12** (numbers for radius, shadow, motion and the type scale), **G-14** (an
accent the palette forbids), **C-10** (Storybook or equivalent), and the choice of typefaces — and
each is recorded below with its evidence rather than its conclusion alone.

### 1.8.1 The token layer, and the numbers behind the adjectives — G-12

The visual guide describes radius, shadow, motion and accent in adjectives, and gives type sizes with
no weights, line-heights or tracking. Plan §3.1a needs numbers. These are them. Every value sits
inside the guide's stated range wherever it gave one.

**Radius.** Guide §06 asks for "mostly rectangular or softly squared"; §11 forbids "rounded-card
overload". The rule adopted: **nothing is rounder than 4px unless it is literally a circle.**

| Token | Value | Use |
|---|---|---|
| `--radius-none` | 0 | surfaces, cards, images, sections |
| `--radius-sm` | 2px | buttons, inputs, controls |
| `--radius-md` | 4px | dialogs, drawers, dropdown panels |
| `--radius-full` | 9999px | colour swatches, radio dots, bag count — circles only |

**Shadow.** Guide §06 "minimal shadowing"; §11 lists "excessive shadows" under Avoid. On a `#0A0A0A`
page a shadow is nearly invisible anyway, so elevation is carried by surface lightness plus a 1px
rule. There is **one** shadow, not a scale — a scale invites use:

```
--shadow-overlay: 0 24px 64px -24px rgb(0 0 0 / 0.72);
```

Verified in the browser: exactly one distinct `box-shadow` value exists across the whole specimen
sheet.

**Motion.** Guide §08 "keep it slow, keep it subtle"; §11 "use motion sparingly and slowly".

| Token | Value | Use |
|---|---|---|
| `--duration-instant` | 80ms | pressed / active feedback |
| `--duration-fast` | 160ms | hover and focus colour, border, opacity |
| `--duration-base` | 240ms | dropdowns, tabs, accordions, toasts |
| `--duration-slow` | 400ms | drawers, dialogs, overlay fades |
| `--duration-editorial` | 700ms | image reveals and crossfades |

Easing is three curves: `--ease-entrance` `cubic-bezier(.22,1,.36,1)`, `--ease-exit`
`cubic-bezier(.64,0,.78,0)`, `--ease-editorial` `cubic-bezier(.65,0,.35,1)`. Nothing scales and
nothing bounces.

**Type scale.** The guide's size ranges, with the missing three-quarters filled in. Display levels use
the serif and are fluid; UI levels use the sans and are fixed, because metadata that resizes with the
viewport stops being precise.

| Token | Size | Line-height | Weight | Tracking | Family | Guide range |
|---|---|---|---|---|---|---|
| `display-xl` | clamp 48→72px | 1.02 | 500 | −0.02em | serif | 48–72 |
| `display-l` | clamp 36→52px | 1.06 | 500 | −0.015em | serif | 36–52 |
| `heading-m` | clamp 24→34px | 1.15 | 500 | −0.01em | serif | 24–34 |
| `heading-s` | clamp 16→20px | 1.30 | 500 | 0 | sans | 16–20 |
| `body` | 16px | 1.60 | 400 | 0 | sans | 14–16 |
| `body-sm` | 14px | 1.55 | 400 | 0 | sans | 14–16 |
| `meta` | 12px | 1.40 | 500 | 0.12em | sans | 11–13 |
| `micro` | 10px | 1.30 | 500 | 0.18em | sans | 9–10 |

Three weights are defined (400 / 500 / 600) and two are used. Guide §03: "avoid excessive
font-weight variation."

**Spacing** uses the guide's own XS–XXL names at 6 / 12 / 24 / 40 / 80 / 144px, each inside its stated
range. Section rhythm is fluid between XL and XXL, so §10's "reduce oversized spacing where necessary,
but never remove the breathing room" is handled by the scale rather than by per-page overrides.

**The structural decision underneath all of it.** Tailwind's default colour, type, radius and shadow
scales are **cleared** with `--color-*: initial` and its siblings, then rebuilt with semantic names.
The raw palette lives in plain `:root` custom properties that generate no utilities, so a component
cannot address a brand colour directly — there is no `bg-obsidian`, only `bg-canvas`. Consequently
`bg-red-500`, `text-lg`, `rounded-2xl` and `shadow-xl` **fail to compile** rather than quietly
contradicting the guide. Verified against the built stylesheet: zero default palette entries survive.

`src/lib/cn.ts` mirrors those overrides into `tailwind-merge`. Without it, tailwind-merge cannot tell
that `text-meta` is a font size while `text-foreground` is a colour, and would silently drop one when
a caller overrides a primitive's class.

### 1.8.2 Accent, selection, and the border problem — G-14

G-14: sale/compare-at prices and selected states need a visible accent, but the palette forbids
saturated colour and prescribes low-contrast graphite borders. Three separate answers were needed.

**1. Selection is contrast, not colour.** A checked checkbox is a solid Bone fill at 17.10:1; a
selected tab is Stone→Bone plus a 1px Bone rule; a current nav item is the same. That is a louder
signal than any hue this palette permits, and it costs nothing from the colour budget. Soft Taupe
stays what guide §02 calls it — "a rare accent, not a general-purpose highlight" — restricted by rule
to **a 1px rule, ring or underline, or a ≤10px uppercase label. Never a fill, never body text, never
an icon colour.**

**2. Compare-at price is typographic.** The live price stays Bone; the struck-through price is Stone
(7.91:1) with `line-through`; an optional `SALE` marker is a Micro-sized Soft Taupe outline badge. No
red, no fill. Deliberately **Stone and not the dimmer tone** — a struck price is still information a
customer reads.

**3. The border contradiction is real, and it is split rather than resolved.** Graphite `#33312D` is
**1.53:1** against the page. WCAG 1.4.11 requires **3:1** for the boundary of a control a user must be
able to find, so a graphite-bordered input is not identifiable at AA. The split:

- **Structural rules, dividers, hairlines → Graphite.** Decorative under 1.4.11 and exempt. This is
  the "usually low-contrast graphite" the guide asks for, and it is the majority of borders.
- **Interactive control boundaries → Muted Stone `#77726B` (4.15:1).** Still a palette colour, still
  quiet, and now findable. Recorded as **DEV-22**.

**4. An error needs a colour the palette does not contain.** See **DEV-21**.

**Measured contrast, computed from the hex values and re-verified in the live DOM**, against Obsidian
`#0A0A0A`:

| Colour | Ratio | Verdict |
|---|---:|---|
| Warm White `#FAF8F4` | 18.67:1 | AAA |
| Bone `#F1EEE8` | 17.10:1 | AAA |
| Soft Taupe `#C7B8A0` | 10.17:1 | AAA |
| Stone `#A9A39A` | 7.91:1 | AAA |
| Oxide `#C0745F` | 5.57:1 | AA |
| Muted Stone `#77726B` | 4.15:1 | **fails AA for normal text** |
| Graphite `#33312D` | 1.53:1 | decorative only |

**A token was deleted because of that second-to-last row.** The first draft had
`--color-foreground-subtle` (Muted Stone) as a "tertiary text" tone, with a comment restricting it to
large text and disabled content. Every one of its first uses broke that restriction, and axe-core
caught them as `color-contrast` violations. **A token whose correct use has to be remembered is a
trap**, so it was removed rather than re-documented. Muted Stone now answers only to `disabled`, where
WCAG 1.4.3 genuinely exempts it, and the hierarchy below primary is carried by size and tracking
instead — which is closer to guide §02 anyway: "the luxury comes from proportion, texture, and
contrast, not from having many colors."

### 1.8.3 Typography — what was chosen, and the two traps that were avoided

**Display: Bodoni Moda. UI: Instrument Sans.** Both SIL OFL 1.1 with **no Reserved Font Name**, both
verified against the upstream licence text in `google/fonts`, both committed as `latin`-subset
variable `.woff2` alongside their full licence files as the OFL requires. 76 KB for the pair.

**Self-hosted through `next/font/local`, not `next/font/google`.** The Google loader self-hosts the
*browser* request but performs a **build-time fetch** of `fonts.googleapis.com`, which fails on an
egress-restricted or offline build. Plan §3.1b says "self-host where practical"; at 76 KB, committing
the files is entirely practical and removes a network dependency from `pnpm build`.

**Why Bodoni Moda.** Guide §03 asks for a serif that is "elegant, high contrast, fashion-oriented,
slightly dramatic, never playful". That describes a Didone — the lineage of fashion mastheads — and
this is the closest libre face to it.

**Why Instrument Sans, and what it beat.** The sans is used almost entirely for small tracked
uppercase sitting against serif cap lines, so cap height is the alignment metric that matters. Bodoni
Moda's cap is 0.750 em; **Instrument Sans is 0.720 (≈4% off), Inter 0.7275, Archivo 0.686 — nearly 9%
short**, which makes a nav label look visibly smaller than the serif beside it at the same pixel size.
Its weight range is also only 400–700, which makes guide §03's "avoid excessive font-weight variation"
structural rather than a matter of discipline. *Archivo was chosen first and changed on that
cap-height evidence.* **Inter and Geist were rejected on brand distance** — Inter is the UI face of
every SaaS dashboard and Geist is Vercel's corporate typeface, and guide §12's final test ("if a page
feels like it could belong to any generic ecommerce template, it is not finished") makes that a
requirement rather than a preference.

**Trap 1 — Google serves two different Bodoni Moda variable fonts, and the default one is wrong.**
Without an explicit optical-size request you get a 25,884-byte file whose PostScript name is
`BodoniModa11pt-Regular`: the 11-point *text* cut, **with the `opsz` axis physically absent**. The
correct file is 46,260 bytes and carries `wght 400–900` **and `opsz 6–96`**. Since
`font-optical-sizing: auto` is the browser default, a 72px campaign headline then gets the fine
display cut automatically. Ship the wrong 26 KB and the headlines quietly become a competent serif
instead of a fashion Didone, with nothing to indicate why. **Verified in the browser rather than
assumed:** measuring a string at `opsz 6` versus `opsz 96` gives a 45.45px width difference, so the
axis is live in what we ship.

**Trap 2 — `next/font/local` never emits `unicode-range`.** These files hold roughly 250 glyphs.
Without the descriptor the browser assumes the file covers everything, uses it for characters it
lacks, and draws `.notdef` tofu instead of falling through to the fallback stack — so a customer name
or product description outside Latin-1 would render as boxes. The range is supplied through
`declarations`.

**And a build-breaking detail worth knowing:** Next's font loader reads these options **statically at
build time**, so every value must be a literal. Sharing the unicode range through a `const` fails the
build with `missing field 'value' at line 1 column 325`. It is written out at both call sites for
that reason, not by oversight.

Two further specifics that fail *silently* rather than loudly, both handled: a variable font still
needs an explicit `weight` range string (omit it and the `@font-face` gets no `font-weight`, the
browser pins the face to `normal`, and the whole axis is dead), and a `wdth`-axis file additionally
needs a `font-stretch` descriptor the loader never emits — which is part of why the **wght-only**
Instrument Sans file is the one committed.

FOIT/FOUT is answered by `display: 'swap'` **plus** `adjustFontFallback`, which generates a
metric-matched fallback so the swap does not move the layout. It is the combination, not `display`
alone.

### 1.8.4 C-10 settled — an in-app specimen route, not Storybook

Plan §3.1d permits "a Storybook **or equivalent** visual test page"; the tech stack lists Storybook as
*Recommended*; feature matrix §33 names it. **The equivalent was chosen.** See **DEV-20**.

**This is a cost-and-fit judgment, not a compatibility verdict — Storybook works.** It was built, on
this machine and this stack, before the decision was taken: Storybook 10.5.10 declares
`next: ^14.1.0 || ^15.0.0 || ^16.0.0`, resolves clean under `--strict-peer-dependencies`, and compiles
Tailwind v4 through the project's own PostCSS config. Three project-specific facts decided it anyway:

1. **Typography would not be production-faithful.** In Storybook, `next/font/google` resolves to
   `fonts.gstatic.com`; the real app self-hosts. For a brand that is fundamentally a display serif on
   `#0A0A0A`, verifying type on the one surface where type is delivered differently defeats the point.
2. **A second bundler, permanently.** Next 16 builds with Turbopack; Storybook offers webpack or Vite.
   A green Storybook build is not evidence the app builds, and vice versa.
3. **It cannot model this repository's real styling risk.** The `(frontend)`/`(payload)` split — the
   thing that keeps Tailwind out of `/admin` — has no representation in Storybook at all.

Against that, roughly 250–370 added packages, some 24 phases before its testing story (Vitest-based)
arrives. Meanwhile plan §27.1e already runs `@axe-core/playwright` against representative **routes**,
so an in-app route joins that sweep as one more entry — which is exactly how the zero-violation result
in §1.8.7 was obtained.

**What was given up, stated plainly:** the args/controls panel, per-component URL addressing,
autodocs, the viewport toolbar, and true component isolation. The last is mitigated by giving every
specimen its own bordered cell. Play-function interaction tests are replaced — arguably upgraded — by
Playwright driving the real route.

**The route is `/design-system`**, inside `(frontend)` so it inherits the real layout, CSS graph and
fonts. It is `robots: noindex, nofollow`, is absent from the primary navigation, and announces itself
in-page as internal documentation. It is deliberately *not* env-gated: the typed environment module is
Phase 4's (§4.1a), and inventing a second mechanism now would duplicate it. **Phase 32 should decide
whether it ships publicly.**

**The one clause of the acceptance criteria with nothing to show: "dark/light context where
relevant".** There is no light context, and that is a decision rather than an omission. The storefront
is dark-only — guide §02 gives Warm White the role "bright text / light surfaces", and this system
takes only the first half, mapping it to `--color-foreground-bright`. No light *surface* token exists,
so no primitive has a light variant to demonstrate.

Building one now would be speculative: nothing in Phases 3–18 renders on a light field. **The first
surface that genuinely needs one is Phase 19's transactional email**, where a light treatment is the
norm and where **G-13** already records that the visual guide gives no art direction at all. That is
where the inverse palette should be decided, against a real requirement.

**Forcing the un-renderable states.** §3.1d requires hover, focus and active, which cannot be rendered
statically. Rather than hand-copying each variant's hover classes onto a second copy of the component
— which proves only that the transcription is correct — the three built-in Tailwind variants are
extended with an attribute hook, so `data-preview="hover"` makes a component's **own** `hover:`
classes apply:

```css
@custom-variant hover {
  @media (hover: hover) { &:hover { @slot; } }
  &[data-preview~='hover'] { @slot; }
}
@custom-variant active (&:active, &[data-preview~='active']);
@custom-variant focus-visible (&:focus-visible, &[data-preview~='focus']);
```

`hover` keeps its `@media (hover: hover)` guard — dropping it is how a design system ends up with
sticky hover states on touch devices. The hook is inert wherever the attribute is absent, which is
everywhere but that page.

### 1.8.5 What the primitives are built on

All eighteen of plan §3.1c's primitives exist, plus a `FieldMessage` — the text half of an error
state, since §3.1d requires one and WCAG 1.4.1 forbids signalling it by colour alone.

**One dependency covers every primitive: `radix-ui@1.6.7`,** the unified package, rather than a dozen
individual `@radix-ui/react-*` packages. Phase 3's full install is five runtime packages —
`radix-ui`, `class-variance-authority@0.7.1`, `clsx@2.1.1`, `tailwind-merge@3.6.0` and
`lucide-react@1.33.0` — taking the tree from 706 to **782 packages**, clean under
`--strict-peer-dependencies`.

**`shadcn init` was deliberately not run, and that was verified rather than assumed.** Reproduced four
times against a byte-faithful replica of this repository: `init` does not overwrite `globals.css`, it
*merges* — and it injects `@apply bg-background text-foreground` into the existing `body {}` rule.
shadcn's `:root` is the **light** palette, its dark values live under a `.dark` class this app does
not have, so **running it flips the storefront from `#0A0A0A` to white.** It also writes
`--font-sans: var(--font-sans)`, a self-referencing custom property that destroys the font stack
(upstream issue #10768). `--no-css-variables` does **not** prevent any of this; it only flips a
boolean in `components.json`. Also worth knowing for later phases: the current CLI's default component
base is **Base UI, not Radix**, and `new-york`/`default` are legacy style ids — most existing shadcn
knowledge is stale for 4.19.0.

What *is* used is the shadcn **abstraction**, exactly as plan §3.1c directs — the same file layout,
the same `cn()` + `cva` variant composition, the same `data-slot` attributes, the same Radix
composition — with every class written against NORTH / 01's tokens instead of shadcn's
`--background`/`--primary` vocabulary. shadcn is a source pattern here, not a runtime dependency.

**Two components depart from what the current shadcn registry would install**, and both drop a
dependency rather than adding one. Recorded as **DEV-23**:

- **Drawer is Radix Dialog, not `vaul`.** vaul exists to provide drag-to-dismiss and iOS bottom-sheet
  physics, neither of which any document asks for and both of which cut against §06's "restrained
  motion". Radix Dialog already supplies the focus trap, focus restoration, Escape, scroll containment
  and `aria-hidden` management that plan §9.1c requires of the mobile drawer; the slide is six lines
  of CSS.
- **Toast is Radix Toast, not `sonner`.** sonner would add a second animation and stacking model plus
  `next-themes` — a theme switcher, on a site with exactly one theme.

**Overlays animate in CSS, driven by the `data-state` attribute Radix already writes**, not through an
animation library. Radix's `Presence` waits for `animationend`, so exits play in full. Three
consequences, all of them wanted: no JavaScript runs to move a drawer, the animations cannot drift out
of step with the duration tokens, and `prefers-reduced-motion` is honoured from one media query.

**A Radix regression that must not be forgotten.** `@radix-ui/react-dialog@1.1.23` — the version
inside `radix-ui@1.6.7` — **removed the development warning for a missing `DialogTitle`.** It emits
`aria-labelledby` only when a title exists, so a dialog without one is announced with no name at all,
silently, in every environment. `DialogContent` and `DrawerContent` therefore take `title` as a
**required prop**, with `titleHidden` rendering it inside `VisuallyHidden` when the design shows no
heading. Two other things Radix does not supply, and which these components now require: an
`aria-label` on `TabsList`, and an accessible name on the `Select` trigger.

The same make-it-a-compile-error approach applies to `IconButton`, whose `label` prop is required —
plan §3.1d asks for `aria-label` on icon-only buttons, and this moves it from a review item to a type
error.

**Where things live.** `src/components/ui/` for primitives, `src/components/layout/` for the shell,
`src/lib/cn.ts` for the one class-composition helper — named for what it does rather than `utils.ts`,
which plan §1.3 warns against becoming a dumping ground.

### 1.8.6 Choices that follow the plan rather than depart from it

Recorded here, not in Section 2, for the reason established in §1.7.5: Section 2 is reserved for
entries that **override** a canonical document, and these do not.

**The global shell is built but not mounted.** Plan §3.1d says *build* Header, Desktop nav, Mobile
nav, Footer, Page container, Section wrapper, Page title, Editorial block wrapper. Plan §9.1a is what
*mounts* the storefront shell, together with the mega menu, search overlay and cart drawer that make
its controls do something. Mounting a header now whose Search and Bag buttons did nothing would be
precisely the fake UI the plan forbids, so the components are proved on `/design-system` and the
storefront root layout stays bare until Phase 9. The header's utility actions are **links** to their
eventual routes rather than buttons wired to nothing, for the same reason.

**Navigation data is a typed constant, not a content system.**
`src/components/layout/navigation.ts` encodes **DEV-07**'s six primary items and **DEV-01**'s
four-item Edit set with Essentials under Collections, plus C-07's Journal-in-the-footer. Plan §9.1a
moves the content into Payload site settings; the types stay.

**Phase 3 needed nothing from the project owner**, as §1.5 predicted. No database, no third-party
account, no secret.

### 1.8.7 What the real-browser pass found

Run against `PORT=3210` with the identity check first — `GET /api/users` returning Payload's 403 JSON
— because §1.7.6 records two unrelated projects occupying `:3000` and `:3001` on this machine.

**Everything below was measured, not eyeballed.** Three suites: computed-style and geometry
assertions, a keyboard and focus-management suite, and axe-core.

| Checked | Result |
|---|---|
| Palette, type scale, tracking, weights, line-heights | all match §1.8.1 exactly; Display XL measures 72px / 73.44px / 500 at 1440 |
| Both faces self-hosted and loaded, `unicode-range` present | pass |
| `wght` and `opsz` axes live | Δ114.75px and Δ45.45px on a measured string |
| Contrast of body copy, nav, error text | 7.91 / 7.91 / 5.57 — all AA |
| Focus indicator | 2px solid Bone at 2px offset on every tab stop |
| Radius guardrail | no element rounder than 4px unless circular |
| Shadow guardrail | exactly one distinct `box-shadow` in the system |
| Horizontal overflow at 1440 / 768 / 390 | none |
| WCAG 2.5.8 target size | pass, with the inline and 24px-spacing exceptions computed explicitly rather than asserted |
| Dialog · Drawer · Dropdown | focus trap in both directions, Escape, focus restoration to the trigger, page scroll released on close |
| Modal isolation | the rest of the page really is `aria-hidden` while a dialog is open |
| Drawer | body scrolls, header and footer stay pinned, overscroll contained |
| Tabs · Accordion · Select | roving focus, single tab stop, real `<h3>` headings, `role="region"`, keyboard-selectable value |
| Mobile nav at 390px | group headers expand rather than navigate; account and wishlist reachable; Escape restores focus |
| `prefers-reduced-motion` | every duration token collapses to 1ms |
| **axe-core, WCAG 2.0/2.1/2.2 A + AA, desktop and mobile** | **0 violations** |
| `/admin` unaffected | body computes to Payload's own colours and font stack — **D-08 holds** |

**Two genuine defects were found and fixed, both by axe rather than by eye:**

1. **A loading button had no accessible name.** The label was hidden with `invisible`, and
   `visibility: hidden` removes text from the accessibility tree — so `aria-busy` was being announced
   on a nameless control. It is now `opacity-0`, which hides the label from sight and keeps the name.
   The distinction between those two utilities is load-bearing and not obvious.
2. **The `foreground-subtle` contrast failures** described in §1.8.2, which led to deleting the token.

**One change came out of the visual review rather than a test.** A loading button initially rendered
in its *disabled* colours, so a busy primary action read as unavailable. Each variant now restores its
resting colours while loading, through `data-loading:disabled:*` — which compiles to
`[data-loading]:disabled`, one class more specific than the `disabled:*` it overrides, so the win is
by **specificity** rather than by stylesheet order, which Tailwind controls and we do not.

**A reverted attempt worth recording, because it is a trap anyone would fall into.** Busy state was
first implemented as `aria-disabled` plus an `onClick` guard, to keep the button focusable — a
disabled `<button>` loses focus to the document body, which matters on submit. It broke the production
build: `Event handlers cannot be passed to Client Component props`. Attaching an `onClick`
unconditionally makes the component impossible to render from a Server Component, and `Button` is used
from server components throughout. The real `disabled` attribute is used instead. **The focus-loss
consequence is real and belongs to Phase 7**, which owns forms and has to move focus and announce the
result anyway; a button primitive cannot solve it for its caller.

**Playwright and axe-core were used as tools, not added to the project.** Both are Phase 27
dependencies, and plan §2.1b forbids installing a later phase's packages early, so both run from the
scratchpad directory against the dev server. `package.json` is untouched by the verification pass.

### 1.8.8 Visual review against the guide

Required by visual-reference rule 6 and step 8 of the completion gate in `docs/DEVELOPMENT.md`.
Reviewed in a real browser at 1440×900 and 390×844 against `NORTH01_Visual_Guide_OnlineOnly.md`.

| Guide requirement | Assessment |
|---|---|
| §02 palette, black and charcoal dominant | held; only ten colours exist and the defaults cannot compile |
| §03 refined high-contrast serif for display | **the Phase 2 gap is closed** — Bodoni Moda replaces the generic `ui-serif` stack |
| §03 serif/sans contrast used intentionally | the display serif never appears below 24px; metadata is always sans |
| §01 visual tension, "oversized type with tiny metadata" | 12px tracked eyebrow above 72px Didone, throughout |
| §04 disciplined max-width grid, generous outer margins | one container; gutter fluid 20→64px; no page sets its own |
| §05 spacing language | six named steps, all inside the guide's ranges |
| §06 thin borders, restrained fills, no pill buttons | 2px radius; one bone fill, reserved for the primary action |
| §06 dividers 1px and low-contrast, never decorative noise | Graphite hairlines only |
| §06 badges small, typographic, quiet, monochrome | 10px outlined; no filled stickers |
| §11 no gradients, glow, glassmorphism, neon, rounded-card overload | none present; the radius and shadow guardrails are machine-checked |
| §10 mobile quiet, monochrome, legible; hierarchy preserved | verified at 390px — no overflow, drawer nav, wordmark centred |
| §12 final test — recognisable as NORTH / 01 with the text removed | yes: palette, Didone proportions, hairline rules and restraint carry it |

The reference image was used as directional context only, per rule 10. Its five-item navigation is
**not** followed — see **DEV-07**.

### 1.8.9 Confirmation sweep of earlier deviations

Required by the append rule, step 4.

| Entry | Due | Status after Phase 3 |
|---|---|---|
| **DEV-14** — substantial work uses feature branches | ongoing | **Confirmed again.** Phase 3 ran on `phase-3-design-system`, not `main`. |
| **DEV-16** — route-group topology insulates the admin | Phase 2 onward | **Confirmed under load.** Phase 3 is the first phase that could plausibly have broken it: it added a full token layer, two self-hosted typefaces and eighteen components. Re-verified two ways — no admin build manifest references the Tailwind chunk, and `/admin`'s live `<body>` computes to Payload's own colours and font stack. |
| **DEV-01** — Essentials is a Collection | Phases 9, 11, 23 | **Encoded.** `navigation.ts` places Essentials under Collections and keeps the Edit set at four. Still to be exercised by Phase 9. |
| **DEV-07** — six primary nav items, including NEW | Phase 9 | **Encoded.** Six items ship in `primaryNav`. Still to be exercised by Phase 9. |
| DEV-05 — Cloudinary first-party adapter | Phase 8 | Still pending. Not due. |
| DEV-03 — order state as two axes | Phase 18 | Still pending. Not due. |
| DEV-06 — hosted vs embedded Checkout | Phase 17 | Still open. Not due. |
| **D-10** — environment guard against schema push | Phase 4 | **Still owed.** Phase 3 did not touch it. |

No other deviation was due for confirmation in Phase 3.

### 1.8.10 Post-implementation audit, and what it found

Phase 3 was committed green — typecheck, lint, build, the browser suite and axe-core all
passing — and then audited a second time specifically for latent defects and technical debt.
That second pass is recorded here because **most of what it found could not have been caught
by any of the gates the phase had already passed**, and knowing which failure modes those
gates are blind to is worth more than the individual fixes.

Method: four reviewers over the committed diff along separate axes (Radix/React correctness,
the compiled CSS and token layer, accessibility beyond axe, and internal consistency), each
finding then handed to an adversarial verifier instructed to refute it and to *reproduce* the
stated failure rather than reason about it. 37 claims; 14 were refuted, 23 survived. Every
survivor below was fixed, and every fix re-verified in the browser.

**The one that mattered most: `<Button asChild>` threw on every use.**

`asChild` hands the consumer's element to Radix's `Slot`, which adopts a child only when
`React.Children.count(children) === 1`. The component always rendered two — the label
wrapper and the `{loading ? … : null}` spinner slot, whose `null` **still counts**. So a
documented public prop failed 100% of the time with "Slot failed to slot onto its children",
and nothing caught it: TypeScript cannot express child arity, no call site used it yet, and
the specimen sheet had no `asChild` cell. Proved by bundling the committed component with the
project's own esbuild and rendering it through `react-dom/server`.

Fixed by making the contradiction unrepresentable rather than reconciling it: `asChild` and
`loading` are now mutually exclusive in the type, and the two cases render by separate paths.
They are genuinely exclusive in meaning too — `asChild` exists to make this a link, and a
link navigates rather than submits, so it has nothing to be busy about. A `Button asChild`
specimen now exists so the path cannot rot again.

**Three more that were silently wrong at runtime:**

| Defect | What actually happened |
|---|---|
| `Number.MAX_SAFE_INTEGER` used for a "persistent" toast | `setTimeout` clamps above 2³¹−1 ms and fires **immediately** on overflow — measured at 0.1 ms. The toast asked to stay until dismissed dismissed itself instantly. Radix supports `duration={Infinity}` natively (`if (!duration \|\| duration === Infinity) return`), so the conversion broke the very feature it implemented. |
| Toast exit animations were dead classes | Dismissal deleted the record inside `onOpenChange`, unmounting the element in the same commit. Radix wraps each toast in `<Presence>` precisely so the exit runs to `animationend` first. Now dismissal flips a per-toast `open` flag and the record is removed on exit. |
| `crypto.randomUUID()` in a client component | Defined only in a **secure context**. Present on localhost and HTTPS, `undefined` over plain HTTP on a LAN address — which is exactly how the mobile behaviour this plan requires gets tested. Replaced with a per-provider counter. |

**Four CSS-layer traps, all of which compiled cleanly and none of which axe can see:**

- **`max-w-prose` was 65ch, not the 672px this document claimed.** Tailwind resolves
  `max-w-*` against `--max-width` → `--spacing` → `--container`, and its deprecated
  `--max-width-prose: 65ch` beat our `--container-prose`. Renamed to `--container-measure`
  and both width namespaces cleared, as the colour and type scales already were.
- **`--spacing-xs` hijacked `max-w-xs`, which resolved to 6px.** Spacing is checked before
  container. Now documented explicitly rather than papered over: with the inherited scale
  cleared, `w-*`/`max-w-*` reading `--spacing-*` is consistent Tailwind behaviour, and the
  overlay widths have semantic names (`max-w-dialog`, `max-w-drawer`, `max-w-panel`).
- **`--font-weight-*` survived `--font-*: initial`** — a separate namespace — so
  `font-bold`, `font-black` and `font-thin` all still compiled, and the guardrail the
  colour and type scales get was quietly missing here. Cleared explicitly.
- **`cn()` could not resolve conflicts involving `transparent`, `current` or `inherit`.**
  Overriding tailwind-merge's colour theme with a literal list dropped Tailwind's built-in
  keyword colours, and a class it does not recognise cannot lose a conflict — so
  `cn('bg-surface', 'bg-transparent')` kept both. The 17 `--animate-*` tokens were missing
  from that config too, which is the exact failure `cn.ts`'s own opening comment warns about.

**Three dead `peer-*`/`group-*` variants.** This class of bug deserves its own note because
it is invisible by construction: `peer-*` requires a *preceding sibling* carrying `peer`,
`group-*` an *ancestor* carrying `group`, and when the relationship is wrong the class simply
never matches. Nothing errors. The Label's `peer-disabled:` worked for checkboxes (label
after control) and was dead for every text field (label above control) — it looked like it
worked because it worked *somewhere*. The radio dot's was dead outright, being a child rather
than a sibling. The Select chevron's `transition-transform` had nothing that rotated it.

**Accessibility findings that axe reported zero of.** All of these coexisted with a clean
axe run, which is the point: automated checking verifies rules, not intent.

- `/design-system` — the page whose job is to prove the heading structure — rendered **two
  `<h1>`s** and skipped h1 → h3, because the `PageTitle` specimen defaulted to `h1`.
- `outline-none` on `TabsContent` deleted the focus ring from an element Radix gives
  `tabIndex={0}`, so the tab panel was a keyboard stop with no visible focus. Same on the
  toast viewport, which is the F8 target.
- The drawer's `<header>` mapped to `role="banner"`, adding a second banner landmark to the
  page whenever a drawer opened. `role="dialog"` is not on HTML-AAM's exempting list.
- `BreadcrumbPage` carried shadcn's `role="link"` + `aria-disabled="true"`, announcing the
  current page as a *disabled link* — contradicting its own docstring three lines above.
- Two navigation landmarks both named "Breadcrumb" on one page.
- Footer landmark ids were built by concatenating heading text into
  `aria-labelledby`/`id`. It worked only because all three headings happen to be one word;
  HTML forbids whitespace in an `id`, so a column called "Customer care" would have produced
  two dangling idrefs and an unnamed landmark.
- **No skip link.** WCAG 2.4.1 Bypass Blocks is Level A, and no automated tool reports its
  absence. Added to `SiteHeader`, which creates a contract: **every page must give its
  `<main>` `id="main-content"`.**

**Two of the phase's own stated rules were broken by the phase's own code** — worth recording
because it is the failure mode a design system is most prone to. `::selection` is an accent
*fill*, 399 lines below the comment saying the accent is "never a fill" (the rule now states
the exception, since a selection highlight is a browser affordance and has to be a fill to
exist at all); and a 14px accent `<code>` sat on the same page that teaches accent is limited
to labels of 10px or less.

**One regression introduced by an earlier fix in this same phase.** Removing the tertiary
grey (§1.8.2) rewrote `Badge`'s `muted` variant to the same two classes as `default`, leaving
a documented variant that rendered identically to another. It now recedes by losing its rule
rather than by dimming its text, since "Sold out" is information a customer reads and must
stay at AA.

**Also fixed:** `overflow-hidden` cancelling the `max-h` it was paired with on
`DropdownMenuContent` and `SelectContent`, so a menu taller than the viewport clipped with no
way to scroll; the `stacked` entry in `editorialBlockVariants`, unreachable because the
component returns early for that case; `Link`'s `external` attributes spread *before*
`{...props}`, so a caller-supplied `rel` would silently drop `noreferrer noopener`; and
`React.ReactNode` used in three files that never import React.

**What was refuted, and why that matters.** 14 of 37 claims did not survive — among them
"the shell has no skip link *and nothing in the system can express one*" (the second half was
false), "nine exported components nothing imports" (true census, false consequences), and
several `className`-placement complaints that were the documented convention. Adversarial
verification earned its place here: roughly two in five plausible-sounding findings did not
reproduce, and acting on them would have churned working code.

**The lesson for later phases.** Every defect above compiled, typechecked, linted and passed
axe. The gates that caught things were: rendering a component in isolation through
`react-dom/server`, reading the *compiled* CSS rather than the source, computing the heading
outline from the rendered DOM, and checking that each `peer-*`/`group-*` variant has the
sibling or ancestor it needs. Those four checks belong in Phase 27's test suite.

---

## 1.9 Phase 4 — environment configuration and secret management

Phase 4 had two jobs: the typed Zod module plan §4.1a describes, and the schema-push guard **D-10**
has been owed since Phase 2. Both are done. What follows is mostly measurement, because almost every
design choice here turned on how Next 16 and Payload 3 actually behave rather than on how they are
usually described.

### 1.9.1 Where validation can and cannot fire — the four evaluation contexts

The environment module is evaluated in four different contexts — three loaders, one of them at two
different moments — and none of them covers everything. This was established by running each of
them, not by reading about them.

| Context | When | Covers |
|---|---|---|
| Turbopack, page-data collection | `next build` | **the build** — `payload.config.ts` is statically imported by all four `(payload)` route files, so a throw fails the build, exit 1 |
| Next server, `instrumentation.ts` | `next dev`, `next start` | **startup** |
| Next server, lazy route module | first request touching `(payload)` | too late to be a gate |
| tsx | `pnpm payload`, `generate:types`, `generate:importmap` | the CLI paths |

Three findings that changed the design:

- **`instrumentation.ts` is skipped during `next build`.** Next returns early from
  `registerInstrumentation` when `NEXT_PHASE === 'phase-production-build'`, prerender workers
  included. The widespread assumption that `register()` is a build hook is wrong. Had the validation
  gone only there, `pnpm build` would pass with a broken environment.
- **`payload.config.ts` is not evaluated at server boot.** `DATABASE_URL= pnpm start` boots clean,
  logs nothing, and returns **200** on `/`. Only `/admin` and `/api/*` fail, per request. A deployment
  in that state passes a health check on the storefront while its CMS and API are dead. That is the
  gap `src/instrumentation.ts` exists to close, and the only reason it exists.
- **A throw in `register()` behaves differently in the two commands**, and both were measured.
  `next dev` **exits with code 1** and serves nothing. `next start` **stays up**: Next logs
  `Failed to prepare server` and an `unhandledRejection`, and *every* route then returns 500 —
  storefront included. The body is a bare `Internal Server Error` with no variable name in it, which
  is what §4.1b requires of a public response. The `next start` case is a request-level failure, not
  a crash, and these notes should not claim otherwise.

So: **the build gate is `payload.config.ts` and the startup gate is `instrumentation.ts`.** Neither is
redundant. Moving either one is a regression that no test currently catches.

### 1.9.2 The push guard — what the hazard actually was, once measured

D-10 asked for a guard making a push to a non-development database "structurally impossible rather
than merely unlikely". Before designing one, the exposure was measured, and it is much narrower than
the decision text implies.

- **A production build cannot push at all**, and the emitted chunk says so. The guard reads
  `process.env.NODE_ENV` as a literal member expression, which Turbopack substitutes at build time,
  so the whole decision constant-folds: the production server chunk contains
  `{allowed:!1, reason:'NODE_ENV is "production", not "development"', mismatch:!1}` and there is no
  surviving `==="development"` comparison anywhere in `.next/server`.

  **This was got wrong once.** The claim originally recorded here — that the chunk contains `push:!1` —
  was measured against the *Phase 2* config, whose `push:` expression was a literal NODE_ENV test.
  Replacing it with `push: schemaPush.allowed` made it a runtime property read, and the audit found
  the chunk actually contained `push:d.schemaPush.allowed`. Reading the raw `process.env.NODE_ENV`
  inside the guard is what restored the build-time answer, in a form that is now verified rather
  than inherited. The lesson generalises: a measurement stops being evidence the moment the code it
  measured is edited.
- **`PAYLOAD_MIGRATING=true`** is set by `payload migrate` and disables push independently.
- **The adapter's own gate fails open.** `@payloadcms/db-postgres`'s connect path tests
  `this.push !== false`, so an *omitted* or `undefined` option pushes. The explicit boolean in
  `payload.config.ts` is load-bearing, not decoration.
- **Two paths remain:** `next dev`, and the unbundled `payload` CLI, which reads `NODE_ENV` at true
  runtime through tsx. Both take `DATABASE_URL` from the same `.env`.

So the realistic accident is specific and human: point `.env` at another database to look at
something, run `pnpm dev`, and Drizzle rewrites that database's schema. Push also re-runs on **every
HMR reload**, and that reload path deliberately skips `onInit` — which is what disqualified `onInit`
as the place to host the guard, along with the fact that it fires *after* `db.connect()` and after
push has already run.

**The guard.** `DATABASE_PUSH_TARGET` names the one database push may modify, as `host/database`.
Push requires `NODE_ENV=development`, `appEnv === 'local'`, the variable set, and the host and database
of `DATABASE_URL` matching it. Two independent facts have to agree and the second names the database,
so repointing `DATABASE_URL` **disarms** push instead of aiming it somewhere new. Re-arming it is a
deliberate second edit. Fail-closed: unset means no push.

Neon gives each branch its own endpoint hostname, so branches of one project are distinguishable; the
database name in the path separates two databases sharing a host.

**Proved, not asserted.** `pnpm dev` with a deliberately mismatched `DATABASE_PUSH_TARGET`: the
database still connects (`/api/users` -> 403, Payload's correct unauthenticated response), the warning
prints, and `Pulling schema from database` appears **zero** times. With the target correct it appears
and the schema is pushed as before.

### 1.9.3 Why the tiers are three files, and what a runtime tripwire could not do

Plan §4.1a asks for browser-safe and server-only to be separated. They are separated into two modules
rather than two exports of one, so the mistake is visible in the import line of the file making it.

**A `typeof window` tripwire was not enough, and the first version of this shipped broken.** It cannot
fire during a build: prerendering runs on the server, where `window` is undefined. Proven with a
throwaway `'use client'` component importing `serverEnv` — `pnpm build` exited **0**, `env.server.ts`
was bundled into `.next/static/chunks/`, and the rendered secret landed in `.next/server/app/index.html`,
the prerendered HTML of `/`. A runtime check is a smoke alarm, not a lock.

**`import 'server-only'` is the lock**, and it needs no dependency: Next aliases the bare specifier to
a vendored copy whose `exports` map resolves to an empty module under the `react-server` condition and
to a throwing module everywhere else. With it, the same probe fails the build, naming the import
chain.

**But that alias exists only inside Next's bundler.** The `payload` CLI loads `payload.config.ts` —
and so the environment module — through tsx, outside Next, where the specifier does not resolve at
all: `pnpm generate:types` fails with `ERR_MODULE_NOT_FOUND`. Measured, not assumed.

Hence **three modules, not two**. `env.core.ts` carries the schemas and stays tsx-resolvable;
`env.server.ts` is that plus the guard and is what application code imports; and an ESLint
`no-restricted-imports` rule stops anything but `payload.config.ts` and `instrumentation.ts` reaching
past the guard, so the bypass is a lint failure rather than a convention. The same tsx constraint is
why the module imports nothing from `next/*`.

**The public module reads one literal per line.** Next substitutes `process.env.NEXT_PUBLIC_X`
textually at build time and `process.env` is an empty shim in the browser, so a dynamic read, a
spread, or handing the whole object to Zod all yield nothing client-side. The verbose literal table in
`env.public.ts` is the only form that survives the bundler.

### 1.9.4 Things that would have been bugs

- **Empty string is not absent, unless you make it so.** `@next/env` skips its file fallback for any
  key already present in `process.env`, and an empty string is present. A blank `.env` line or a blank
  Vercel field therefore yields `''`, which satisfies `.optional()` and fails a required string with
  "too small" rather than "missing". The module strips empty values before parsing, which preserves
  the `if (!value)` semantic Phase 2 chose in §1.7.4.
- **`NODE_ENV` is undefined under the `payload` CLI.** Payload's bin loads `.env` through `@next/env`
  but never assigns `NODE_ENV`. A required `z.enum` for it would have broken `pnpm generate:types` and
  `pnpm generate:importmap` — both documented scripts. It is defaulted to `development`.
- **`z.httpUrl()` rejects `http://localhost:3000`.** Its hostname pattern demands a dotted TLD. Any
  http(s) URL variable here uses `z.url({ protocol: /^https?$/ })`, which still rejects a scheme-less
  string. `z.url()` alone would have accepted `localhost:3000` as a URL with protocol `localhost:`.
- **`.env.local` loads for `next build` and `next start`, not just `next dev`.** It is skipped only
  when `NODE_ENV=test`. A stray `.env.local` will override `.env` in a production build on a
  developer's machine.
- **Module scope is not "once per server".** Warning at module scope printed every message **twice**
  on a plain `pnpm dev`: Turbopack compiles the instrumentation hook and the Payload config into
  separate chunks, and `next dev` evaluates them in two different processes. Deduplicating through
  `globalThis` was tried and does not work, for exactly that reason — different processes do not share
  one. Reporting moved into `reportEnvironment()`, called once from `instrumentation.ts`, leaving
  module evaluation pure apart from throwing. The trade-off is recorded in the code: the `payload` CLI
  does not run instrumentation, so it validates silently.

### 1.9.5 Choices that follow the plan rather than depart from it

- **The full variable inventory is declared now, all of it optional except the two that are consumed.**
  Plan §4.1a enumerates Cloudinary, Algolia, Stripe, Resend, Sentry, PostHog and Turnstile as the
  content of its two buckets, and its Claude prompt requires `.env.example` to name them. Declaring
  them in the schema is what keeps `.env.example` and the typed accessor from drifting apart. This is
  not building a later phase early: naming a variable is not installing an SDK, and no integration
  code exists. Each entry carries the phase that activates it, and that phase tightens its own group.
- **§4.1c's Stripe rule is enforced, not advised.** "Never use production Stripe credentials in local
  or preview" is checked against the `sk_live_`/`pk_live_` prefixes and throws. A warning would be the
  wrong response to a preview branch that can charge a real card.
- **Optional integrations are grouped and all-or-nothing.** A Cloudinary cloud name with no API secret
  is not a working Cloudinary. A fully absent group stays silent — its phase has not arrived — while a
  *partly* configured one warns at every startup in every environment, because that is a real defect
  that otherwise surfaces much later and much further from its cause.

### 1.9.6 Confirmation sweep of earlier deviations

Step 4 of the append rule.

- **DEV-17** (withdrawn) — re-read and still correct. Phase 4 did not re-disable push; it aimed it.
  The withdrawn entry stays as a tombstone, and **D-10** now records the closure.
- **DEV-15** — confirmed again. Postgres is still a Phase 2 prerequisite; nothing in Phase 4 changes
  when Payload connects, and the adapter still opens no socket at config load.
- **DEV-04** — confirmed. No GraphQL surface was added or exposed.
- **DEV-24**, **DEV-25** — untouched, still pending their phases (10 and 19).
- Every open specification gap is unaffected: Phase 4 added no UI and no schema.

### 1.9.7 Post-implementation audit, and what it found

The phase was re-reviewed after it reached a green gate, the same way Phase 3 was in §1.8.10, by six
independent lenses: module logic, secret leakage, an adversarial attack on the guard, specification
compliance, documentation accuracy, and cross-loader integration. It found real defects in code that
had already passed typecheck, lint, build and eight hand-written behavioural checks. The ones that
mattered:

- **A client component could import the environment and ship a secret.** §1.9.3 above. The headline
  finding, and the one that changed the architecture.
- **The push guard failed open when `NODE_ENV` was unset.** The schema defaults it to `development`
  for the Payload CLI's sake, and the guard read the *defaulted* value — so a server started with no
  `NODE_ENV`, pointed at a production database with a matching target, returned `allowed: true`. The
  least safe value was the fallback for the check whose whole job is safety.
- **`?host=` defeated the guard completely.** `pg-connection-string` applies query parameters *before*
  falling back to the URL's own hostname, so `postgres://…@dev-host/db?host=prod-host` connects to
  production while a guard reading `url.hostname` inspects `dev-host`. The identity is now resolved
  the way `pg` resolves it. `?options=`, which Neon documents for SNI-less clients and which reroutes
  to a different compute entirely, is refused rather than interpreted.
- **Case folding was asymmetric.** The permitted value was lower-cased whole; the actual value had
  only its hostname lower-cased. A database name containing a capital letter could therefore never
  match itself, and the warning blamed the developer for a change they had not made. Four of the six
  lenses found this independently.
- **The port was not part of the identity**, so two Postgres servers on one host were one target; and
  a trailing slash on either side made the guard unsatisfiable by any value at all.
- **`decodeURIComponent` could throw a bare `URIError`** naming no variable, for a `DATABASE_URL` that
  Zod had accepted — `new URL()` tolerates a stray `%`.
- **A preview deployment could carry live Stripe keys.** With "Automatically expose System Environment
  Variables" off, `VERCEL_ENV` is absent and both preview and production build with
  `NODE_ENV=production`, so inferring production from `NODE_ENV` granted a preview branch the one
  privilege `production` carries. It now answers `preview`, and the error tells the operator how to
  prove otherwise.
- **`rk_live_` was invisible to the §4.1c check, and `rk_test_` was rejected outright.** Stripe issues
  restricted keys for server use and recommends them in production; the regex knew only `sk_`. Phase
  17 would have hit it.
- **Three declared variables belonged to no integration group**, so the "all-or-nothing" warning the
  docs promised could never fire for PostHog, GA4 or Sentry.
- **A missing `DATABASE_URL` reported a format complaint**, because a single `error` string on
  `z.url()` overrides every issue the schema raises, including the one for an absent value.
- **The mismatch warning echoed `DATABASE_PUSH_TARGET` verbatim**, so pasting a connection string into
  it — the obvious slip, since it is derived from `DATABASE_URL` — printed credentials at every
  `pnpm dev`. The value's shape is now validated and a pasted string is refused.

Plus a cluster of documentation defects: the `push:!1` claim above, an instrumentation claim that was
true of `next start` and false of `next dev`, a code comment calling `NODE_ENV` a build-time constant
forty-five lines from one saying the opposite, a citation to a §4.1a that does not exist in
`docs/ARCHITECTURE.md`, a `docs/STACK_VERSIONS.md` line asserting the environment is *not* validated
at build time, and an append-log row that did not render as a table row because a blank line left by
the Phase 3 append had already terminated the table.

**One destructive path the guard never covered** was also found and closed: the adapter's
`disableCreateDatabase` defaults to `false`, so a typo in the database segment of `DATABASE_URL`
caused a real `CREATE DATABASE` rather than an error. It is now `true`. `PAYLOAD_DROP_DATABASE` and
`migrate:fresh` remain as they are: those are explicit commands, not accidents.

**What this says about the gates.** Every defect above passed `pnpm typecheck`, `pnpm lint` and
`pnpm build`. What caught them was executing the module under tsx with hostile inputs, reading the
*emitted* chunk rather than the source, and building a deliberately wrong component to see whether
the build would stop it. Phase 27 should own all three as tests: a table-driven suite over
`resolveSchemaPush` inputs, an assertion about what does and does not appear in `.next/static`, and a
fixture build that must fail.

### 1.9.8 What is now owed, and by whom

`docs/ARCHITECTURE.md` §5's owed table is down to two rows. Phase 4 adds no new debt, and one item is
worth naming for a later phase rather than leaving implicit:

- **Nothing mechanically prevents a future file from reading `process.env` directly** and bypassing
  the module. Phase 4 added a `no-restricted-imports` rule for the one case that leaks secrets —
  reaching past `env.server.ts` to the unguarded core — but a blanket `no-restricted-properties` on
  `process.env` is a wider tooling decision with a scope question attached, and is left for
  **Phase 27** alongside the checks §1.8.10 and §1.9.7 assign there.

# 2. Deviations

Every departure from what a canonical document actually says. **These override the plan.**

---

### DEV-01 — Essentials is a Collection, not an Edit

**Plan §23.1b and feature matrix §13 say:** the Edit set is Weekend, Travel, Everyday, **Essentials**,
Gifts, Seasonal — six items.

**The website-structure document says:** `COLLECTIONS` contains Current Season, **Essentials**, Limited,
Archive; `EDIT` contains Weekend, Travel, Everyday, Gifts — four items.

**We do:** Essentials is a **Collection** at `/collections/essentials`. The Edit navigation exposes the
structure document's **four** items. "Seasonal" remains a CMS capability, not a fixed navigation entry.

**Why:** the structure document holds authority over user-facing information architecture, and the same
merchandising page cannot live in two URL namespaces. The reference image independently agrees — it draws
a page titled "ESSENTIALS COLLECTION".

*Resolves C-03 and C-04. Affects Phases 9, 11, 23.*

---

### DEV-02 — `PENDING_PAYMENT` is part of the order state machine

**Plan §18.1b says:** `DRAFT → CHECKOUT_STARTED → PAID → PROCESSING → SHIPPED → DELIVERED`, with
`PAYMENT_FAILED`, `REFUNDED` and `CANCELLED` as exceptional paths. No pending-payment state.

**We do:** include `PENDING_PAYMENT` between `CHECKOUT_STARTED` and `PAID`.

**Why:** the same plan lists "Pending payment" among allowed states in §17.1c, and §31.1f requires a
"payment succeeded but webhook not yet reflected" UI state. That state needs somewhere to live. Without it
the checkout window between session creation and webhook arrival is unrepresentable.

*Resolves C-05. Affects Phases 17, 18, 31.*

---

### DEV-03 — Order state is two axes, presented as one

**Plan §18.1b says:** a single linear status.

**Feature matrix §21 says:** the order stores **Payment status** and **Fulfillment status** as separate
fields.

**We do:** carry `paymentStatus` and `fulfillmentStatus` as separate fields, and derive the plan's single
linear machine as the **customer-facing display status**.

**Why:** both documents are satisfied, and the two-axis model prevents a genuine defect — a single axis
cannot express "paid but not yet processing" alongside "refunded after shipping". Plan §6.1k already lists
both a `Status` field and separate "Fulfillment/tracking fields", so the plan's own schema is closer to two
axes than its state diagram is. Transitions stay restricted; no arbitrary admin edits.

*Resolves G-11. Affects Phase 18. To be confirmed in Phase 18.*

---

### DEV-04 — GraphQL is installed, but never exposed

**Plan §2.1b says:** *"Do not add GraphQL unless the project actually requires it."*

**We do:** install `graphql@16.14.2`.

**Why:** it is a hard `peerDependency` of the `payload` package itself and cannot be omitted. It is
installed as an implementation detail of an approved stack technology, not as an architectural choice.
`@payloadcms/graphql` is **not** installed and **no GraphQL API surface is exposed**. The plan's intent —
no second API paradigm — is preserved.

*Resolves D-02. **Confirmed in Phase 2** — installed as a peer, no `@payloadcms/graphql`, no GraphQL route file created, and the build manifest shows no GraphQL endpoint. See §1.7.3.*

---

### DEV-05 — Cloudinary uses a first-party adapter built on Payload's generic storage interface

**Plan §8.1a says:** use Cloudinary for delivery/storage "as the selected integration" — implying an
integration exists to select.

**We do:** build a thin first-party adapter on `@payloadcms/plugin-cloud-storage@3.88.0` — Payload's own
generic storage-adapter interface, the same one every official adapter is built on — driven by the
`cloudinary` Node SDK.

**Why:** no official Cloudinary adapter exists (see §1.3), and the tech stack both mandates Cloudinary and
forbids a second media CDN, so switching providers is unavailable. Writing against Payload's own adapter
interface keeps provider-specific code isolated behind an integration boundary exactly as the plan's
third-party-integration rules require.

**Rejected:** `payload-cloudinary`, `payload-storage-cloudinary`,
`@jhb.software/payload-cloudinary-plugin` — community packages with no compatibility guarantee against
Payload 3.88, for the media layer of a commerce system. Revisit if Payload ships an official adapter.

*Resolves D-03. Affects Phase 8. To be confirmed in Phase 8.*

---

### DEV-06 — Card fields are never rendered by this application

**The reference image draws:** site-styled card-number, expiry and CVC inputs inside a four-step
on-site checkout.

**We do:** never build them as drawn. The steps we own — contact details, shipping address, shipping
method — are ours and styled to the visual guide. Payment is handed to Stripe's own elements.

**Why:** plan §0.1.16 forbids storing raw card details, and rendering our own PAN field would pull the
application into PCI scope for no benefit. The reference image is explicitly non-authoritative.

**Still open:** hosted-redirect Checkout versus embedded Checkout is a Phase 17 UX decision. Both create a
server-side Checkout Session, both are finalized by webhook, and the security model is identical either
way.

*Resolves D-07. Affects Phase 17.*

---

### DEV-07 — Primary navigation is six items, including NEW

**The reference image draws:** a five-item primary navigation — SHOP · COLLECTIONS · EDIT · LOOKBOOK ·
ABOUT. No `NEW`.

**We do:** **NEW · SHOP · COLLECTIONS · EDIT · LOOKBOOK · ABOUT.**

**Why:** three written documents specify the six-item set, and the written visual guide beats the image.

*Resolves C-08. Affects Phase 9.*

---

### DEV-08 — One discount code per order

**Feature matrix §18 says:** validate *"Not combinable with conflicting discount"* — presuming several may
coexist.

**We do:** one code per order. The combinability field is modelled but unused in the demo.

**Why:** plan §15.1c defaults to one code at a time and the plan outranks the feature matrix.

*Resolves C-06. Affects Phase 15.*

---

### DEV-09 — Reference-image elements that are deliberately out of scope

The reference image is directional and explicitly non-authoritative (visual guide §10; plan visual-reference
rule 10). These appear in the PNG and in **no written requirement**, and are therefore **not built** unless
a canonical document later adopts them:

- a **PILLAR** facet (Essentials / Core / Studio) with no taxonomy behind it
- a **Pre-Order** availability state — a commerce capability no document defines
- three parallel filter mechanisms shown simultaneously (filter button, inline dropdown row, persistent
  rail) with mismatched facet sets
- raw card inputs — see **DEV-06**
- a per-product **"WORN BY THE COMMUNITY"** user-generated gallery with no entity or moderation path
- a collection page drawn as a plain filterable grid, contradicting the guide's "campaign-led composition,
  broken into visual chapters"
- a checkout with no order summary and no discount-code field, both of which the structure document
  requires

---

### DEV-10 — Schema additions the plan's Phase 6 does not list

Plan §6.1a–6.1o defines the Payload data model. The following are required by other parts of the corpus
but appear in no schema, and will be added:

| Addition | Required by | Missing from |
|---|---|---|
| **Customer address** entity | `/account/addresses` (§20.1d), customer access rules (§7.1b), order address snapshots (§6.1k) | plan entity list §2.2 **and** Phase 6 |
| **Size guide** entity | Size Guide feature (matrix §8); Phase 6.1b defines a *"Size guide reference"* field | Phase 6 — the referenced collection is never defined |
| **Gender / audience** product field | Algolia filterable attribute (§12.1a); facet drawn in the reference image | product and variant schemas |
| **Variant availability state** | domain model §2.1 | Phase 6.1c variant schema; values never enumerated |
| **Product display-price rule** | every listing and the PDP show a product-level price | nowhere — price is owned solely by the variant, and no document says how a product-level price is derived |
| **Infrastructure records** — Stripe webhook/idempotency, email delivery, search sync | entity list §2.2 and Phases 12/17/19 | Phase 6. Created in their own phases rather than up front. |

*Resolves G-01 through G-05 and G-07. Affects Phase 6 and later.*

---

### DEV-11 — Checkout preflight validates a shipping address

**Plan §17.1a says:** eleven preflight steps. None validates a shipping address.

**We do:** add shipping-address validation to preflight.

**Why:** the tech stack makes a shipping address mandatory for physical-goods checkout, and shipping and
tax cannot be computed without one. Omitting it makes steps 8 and 9 of the plan's own preflight
unsatisfiable.

*Resolves G-10. Affects Phase 17.*

---

### DEV-12 — Category and collection browsing must not route through Algolia

**Plan §11.1d says:** use Algolia as the query/facet engine, and if Algolia is unavailable render a
graceful error state with a "Browse categories" fallback, without an expensive full-catalog scan.

**We do:** build category and collection pages to read **Postgres directly**, never Algolia. Only `/shop`
filtering and search route through Algolia.

**Why:** it is what makes the plan's own fallback true rather than aspirational. If category pages were
also Algolia-backed, "catalog remains usable through curated category navigation" would be false the moment
Algolia went down.

*Resolves D-04. Affects Phases 11, 12, 23.*

---

### DEV-13 — Documents referenced under wrong filenames

**Plan master execution directive says:** read `NORTH01_Claude_Implementation_Plan.md`.
**Feature matrix §35 says:** `NORTH01_Claude_Implementation_Plan_Current.md`.

**Neither file exists.** The only correct name is
**`NORTH01_Claude_Implementation_Plan_Current_OnlineOnly.md`**, per the plan's own "CANONICAL PROJECT
FILES" section. Treat every reference to the other two names as pointing at this file.

Related: feature matrix §35 declares *"Stack source: this document."*, contradicting the tech stack's own
header. The **tech stack** is the sole canonical stack — verified: every technology named across all 35
`**Uses:**` lines in the feature matrix already exists in the tech stack, so nothing actually diverges.

*Resolves C-01 and C-02.*

---

### DEV-14 — Process departures

- **The initial commit went directly to `main`.** The plan designates `main` as deployable with feature
  branches for substantial changes. For the baseline commit on a fresh repository there is nothing to
  branch from, and plan §1.1b's acceptance criterion is explicitly *"`git status` is clean after the
  initial commit."* Subsequent substantial work uses feature branches.
- **The repository is public**, by the project owner's explicit decision. See §1.1 for the consequence.

***Confirmed in Phase 2*** — the branch rule held: Phase 2 ran on `phase-2-scaffold-next-payload`, not
`main`. See §1.7.3.

---

### DEV-15 — Postgres is required from Phase 2, not Phase 5

**The plan implies, and this document's own §1.5 originally stated:** the database is first needed in
Phase 5, and *"Phases 2, 3 and 4 need none of these."*

**We found:** Phase 2's Gate 1 requires *"Payload admin loads"*. Payload connects to the database inside
`payload.init()`, which runs when `/admin` renders. With no reachable Postgres both `/admin` and
`/api/*` return **HTTP 500** with `cannot connect to Postgres … ECONNREFUSED`. Verified against the
running application, not inferred.

**We do:** treat a Neon development connection string as a **Phase 2** prerequisite. `§1.5` is corrected
above.

**What is unaffected:** `pnpm build`, `pnpm typecheck`, `pnpm lint`, `payload generate:importmap` and the
storefront route all succeed with no database. `/admin` is a dynamic route, so the production build never
prerenders it and never connects. The database is needed to *run* the admin panel, not to build it.

**Rejected:** a local Postgres install or a dev-only PGlite wire-protocol shim. Both add a local
dependency the tech stack does not approve, to substitute for a free Neon branch that Phase 5 requires
anyway.

*Affects Phases 2 and 5.*

---

### DEV-16 — Route-group topology, and how the admin panel is insulated

**Plan §1.3 fixes the directory boundaries** and its Phase 2 edge-case list warns of *"Payload admin route
colliding with storefront route groups."*

**We do:** two sibling route groups under `src/app/`, each with **its own root layout** and no shared
parent layout:

```text
src/app/(frontend)/   storefront - imports globals.css (Tailwind)
src/app/(payload)/    admin + REST API - imports @payloadcms/next/css + custom.css only
```

**Why this exact shape:** it is Payload's officially supported structure, and it resolves the Tailwind
preflight hazard structurally rather than by patching CSS. Separate root layouts mean separate CSS graphs,
so Tailwind is physically absent from `/admin` — confirmed against the production build's per-route
stylesheet references, not assumed.

**The invariant to preserve:** `(payload)/layout.tsx` must never import the storefront stylesheet, and no
shared `src/app/layout.tsx` may be introduced above the two groups. Doing either re-opens the hazard.

**Consequence to keep in mind:** navigating between the groups is a full document load, not a client
transition. The one link from the storefront to `/admin` is a plain anchor for that reason.

*Affects Phase 2 onward.*

---

### DEV-17 — ~~Drizzle's schema push is disabled from the start~~ **WITHDRAWN**

**Originally recorded, then reversed within Phase 2 before Gate 1 closed.**

The first version of this entry set `push: false` from Phase 2, reasoning that Phase 5's migration
baseline should be generated from a reviewed schema.

**That was wrong, and it is withdrawn.** Plan §5.1d is explicit: *"Use Payload/Drizzle's recommended
development push workflow for the sandbox database, then generate committed migrations for
non-development environments."* The override contradicted a direct instruction on a weak premise —
`migrate:create` diffs the Payload **config**, which is reviewed code either way, so disabling push
bought no review that the pull request did not already provide. It also pulled migration work forward
into Phase 2, duplicating Phase 5 for no gain.

**We do:** `push: process.env.NODE_ENV === 'development'` — written out rather than left to the adapter
default, so the condition is visible at the call site. Development pushes; every other environment gets
committed migrations, which Phase 5 establishes.

**Hazard this creates, recorded deliberately:** push rewrites the schema of whatever `DATABASE_URL`
points at. Running `pnpm dev` against a non-development database would alter it. `next build` and
`next start` both run with `NODE_ENV=production`, so push is off there. **Phase 4 owns the environment
guard** that makes this structurally impossible rather than merely unlikely.

*Supersedes the original DEV-17. Affects Phases 2, 4, 5.*

---

### DEV-18 — ~~Phase 2 installs no Lexical editor and no `sharp`~~ **MOVED TO NOTES §1.7.5**

Not a deviation. Omitting Lexical and `sharp` at Phase 2 **follows** plan §2.1b; it does not depart from
it, so it does not belong in a section defined as the entries that override the plan. The content moved
intact to notes **§1.7.5**. The identifier is retained rather than reused.

---

### DEV-19 — ~~The Phase 2 `users` collection is scaffolding~~ **MOVED TO NOTES §1.7.5**

Not a deviation either — no canonical document says otherwise; the plan simply never describes the
minimum auth collection Payload requires to boot. That is a gap the notes fill, not an override. Content
moved intact to notes **§1.7.5**. The identifier is retained rather than reused.

---

---

### DEV-20 — Storybook is not installed; the visual test surface is an in-app route

**The tech stack says:** Storybook is the "Component workbench", marked *Recommended*.
**Feature matrix §33 says:** the Design System *"Uses: Storybook + Tailwind + Radix + Motion"* and
lists what it must document.
**Plan §3.1d says:** *"Create a Storybook **or equivalent** visual test page showing every primitive
in..."*

**We do:** build the equivalent — a real route at `/design-system` inside the `(frontend)` group,
rendering every primitive and shell component in default / hover / focus / active / disabled / error /
loading and at mobile width. Storybook is **not** installed.

**Why:** the plan is rank 1 and is both the most specific and the most permissive of the three, so
"or equivalent" governs. Compatibility was never the issue — **Storybook 10.5.10 was actually built
against this exact stack before the decision, and it works.** The three reasons are project-specific:
Storybook's `next/font` shim resolves to `fonts.gstatic.com` while the app self-hosts, so the one
surface built to sign off typography would be the one surface where typography is not what ships; it
requires a second bundler (webpack or Vite) alongside Next 16's Turbopack, so a green Storybook build
is not evidence the app builds; and it cannot represent the `(frontend)`/`(payload)` route-group split
that is this repository's actual styling risk. It would also arrive roughly 24 phases before its
Vitest-based testing story does, for 250–370 packages.

The obligation C-10 identified — *"every primitive is demonstrable in all its states"* — is met, and
plan §27.1e's `@axe-core/playwright` route sweep picks the page up for free.

**What is given up:** args/controls, per-component URL addressing, autodocs, the viewport toolbar, and
component isolation. See notes §1.8.4.

*Resolves C-10. Affects Phase 3 and Phase 27. **Revisit at Phase 27**, where Storybook's cost falls
and its value peaks.*

---

### DEV-21 — Oxide: one signal colour the palette does not contain

**The visual guide §02 says:** nine colours, and *"avoid introducing additional saturated colors
unless there is a strong brand reason."*

**We do:** add exactly one — **Oxide `#C0745F`** — used only for error text, error borders and the
error badge.

**Why:** an error a customer must notice cannot be signalled by shape alone, and WCAG 1.4.1 forbids
signalling it by colour alone either — so the error state is *always* colour **plus** an icon **plus**
text. But it still needs a colour, and the palette contains none that reads as a warning: reusing Bone
would make an invalid field indistinguishable from a focused or selected one, which is worse than
adding a hue.

It is deliberately the least saturated hue that still reads as a warning — **H13 S43 L56**, against
the palette's own warm H35–40 family, so it sits beside Soft Taupe rather than fighting it. Contrast
on all three surfaces is **5.57 / 5.13 / 4.79**, so it clears AA for normal text everywhere it can
appear. A true alarm red sits near S85; this is roughly half that.

**What was not added:** no success colour. A success toast is Bone with a check icon. One non-neutral
hue in the entire system, and it is the one that is a safety requirement.

*Resolves part of G-14. Affects Phase 3 onward.*

---

### DEV-22 — Interactive control boundaries are Muted Stone, not Graphite

**The visual guide §02 says:** *"Borders should usually be low-contrast graphite rather than bright
white."* §06 asks inputs for *"thin graphite borders."*

**We do:** keep Graphite `#33312D` for structural rules, dividers and hairlines — the majority of
borders — and use **Muted Stone `#77726B`** for the boundary of anything interactive: inputs,
textareas, selects, checkboxes, radios and outline buttons.

**Why:** Graphite is **1.53:1** against the page. WCAG 1.4.11 requires **3:1** for the visual
information needed to identify a user-interface component, so a graphite-bordered input is not
identifiable at AA — a customer with low vision cannot see where the field is. Muted Stone is 4.15:1,
is itself a palette colour, and is still unmistakably low-contrast; nothing brighter was introduced,
and "bright white" borders remain forbidden. The guide's *"usually"* is satisfied, because dividers
and rules outnumber control boundaries and all of them stay Graphite.

*Resolves part of G-14. Affects Phase 3 onward.*

---

### DEV-23 — Drawer is built on Radix Dialog, and Toast on Radix Toast

**The tech stack says:** UI primitives are *"shadcn/ui + Radix UI"*.
**Plan §3.1c says:** *"Do not customize every Radix primitive from scratch if a good shadcn
abstraction exists, but do customize all visible styling to match NORTH / 01."*

**We do:** follow the shadcn abstraction for all eighteen primitives — its file layout, its
`cn()` + `cva` composition, its `data-slot` attributes, its Radix composition — while declining the
two components where the current shadcn registry reaches outside Radix. **Drawer is Radix Dialog
anchored to an edge, not `vaul`. Toast is Radix Toast, not `sonner` + `next-themes`.** The
`shadcn` CLI is not run and is not a dependency; the unified `radix-ui@1.6.7` package supplies every
primitive.

**Why:** `vaul` exists for drag-to-dismiss and iOS bottom-sheet physics, which no document requests
and which cut against guide §06's "restrained motion"; Radix Dialog already provides every behaviour
plan §9.1c demands of the mobile drawer, and the slide is six lines of CSS. `sonner` would add a
second animation and stacking model, plus `next-themes` — a theme switcher, on a permanently dark
site. Both choices remove a dependency rather than adding one, which plan §0.1.13 asks for directly.

Running `shadcn init` was separately ruled out on **verified** grounds, not preference: it merges into
`globals.css` and injects `@apply bg-background text-foreground` into `body`, and because its `:root`
is the light palette with dark values under a `.dark` class this app does not have, **it flips the
storefront from `#0A0A0A` to white.** It also writes the self-referencing `--font-sans: var(--font-sans)`
that destroys the font stack. `--no-css-variables` does not prevent either. Reproduced four times in
throwaway sandboxes; details in notes §1.8.5.

*Affects Phase 3 onward, and Phase 9 in particular, which consumes Drawer for the cart and the mobile
navigation.*

---

### DEV-24 — Motion is not installed in Phase 3

**Feature matrix §33 says:** the Design System *"Uses: Storybook + Tailwind + Radix + Motion."*
**The tech stack says:** Motion provides *"restrained page/component motion"*, required for the demo.

**We do:** install no animation library in Phase 3. Overlay enter and exit animations are CSS
keyframes driven by the `data-state` attribute Radix already writes, and Radix's `Presence` holds the
element mounted until `animationend` so exits play in full. `motion@13.1.1` was installed early in the
phase and **removed** once it was clear nothing in the design system needed it.

**Why:** plan §2.1b — *"do not install the entire final dependency list on day one"* — and §0.1.13's
"avoid unnecessary dependencies". Beyond phase discipline, CSS is the better tool for this specific
job: no JavaScript runs to move a drawer, the animations cannot drift out of step with the duration
tokens, and `prefers-reduced-motion` is honoured from the single media query that overrides those
tokens. An animation library sitting alongside would create a second place where motion is defined.

Motion remains an approved technology and is genuinely needed for the guide's "slow, subtle, cinematic"
editorial reveals and crossfades. **It moves to Phase 10**, with the homepage editorial system that
first has something to reveal. `docs/STACK_VERSIONS.md` is corrected accordingly.

*Affects Phases 3 and 10.*

---

### DEV-25 — The footer's newsletter column is deferred

**The structure document §20 says:** the footer has five columns — *"Shop. Help. About/editorial.
Newsletter. Social/legal."*

**We do:** ship Shop, Help, Brand and the legal/social row. `SiteFooter` takes a `newsletter` slot and
Phase 3 leaves it empty.

**Why:** a signup field rendered now would post nowhere. The subscriber collection is Phase 6.1n and
the mail is Phase 19, so the input would be UI that looks functional and silently does nothing —
which plan §0.1.17 forbids outright and `AGENTS.md` repeats. The column exists in the layout, and the
grid widens from three to four columns the moment the slot is filled, so the phase that can make it
work has somewhere to put it and no layout to renegotiate.

*Affects Phases 3, 6 and 19. **To be confirmed in Phase 19.***

### DEV-26 — Environment variable names this project had to choose

**The documents say:** plan §4.1a lists the server-only and browser-safe buckets by *service* -
"Analytics public IDs", "Algolia search-only key", "Stripe secret key", "Resend API key" and so on. It
names no variables. Nothing in the six canonical documents names an environment variable at all except
`DATABASE_URL` and `PAYLOAD_SECRET`.

**We do:** fix the names in Phase 4, in `src/lib/env.public.ts` and `src/lib/env.server.ts`, so the
schema, `.env.example` and `docs/ENVIRONMENT.md` agree from the start instead of each integrating phase
inventing its own.

Most follow an unambiguous provider convention. These did not, and are this project's choice:

| Variable | Why it needed deciding |
|---|---|
| `NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY` | Algolia's own templates use `_SEARCH_API_KEY`, `_SEARCH_KEY` and `_API_KEY` interchangeably |
| `ALGOLIA_ADMIN_API_KEY` | `ALGOLIA_ADMIN_KEY` and `ALGOLIA_WRITE_API_KEY` are both in circulation |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` / `POSTHOG_API_KEY` | PostHog documents several spellings |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | GA4 has no canonical environment-variable name |
| `DATABASE_PUSH_TARGET` | Entirely this project's — it exists for **D-10** and has no upstream analogue |
| `SITE_URL` | No document requires a canonical-origin variable; Phases 17, 19 and 24 will all need one |

**Why:** the alternative is a naming decision taken independently in Phases 8, 12, 17, 19, 25 and 26,
each defensible, none consistent — and `.env.example` has to list them in Phase 4 regardless, so the
names get chosen here whether or not they are written down as chosen here.

**Also decided here:** the Cloudinary cloud name is `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, browser-safe,
because it appears in every delivery URL and is not a secret. The single-variable `CLOUDINARY_URL` form
the Node SDK also accepts is deliberately *not* used: it packs the API secret and the public cloud name
into one string, which cannot be split across §4.1a's trust boundary.

**Authoritative:** this document. The plan says "Examples:" and assigns no names.

**A later phase may correct any of these** with evidence from the provider's own current
documentation — that is a correction to this entry, not a silent rename. What it may not do is
introduce a second name for a variable that already exists here.

*Affects Phases 8, 12, 17, 19, 24, 25 and 26. **Each name to be confirmed by the phase that first uses
it.***


# 3. Append log

| Phase | Date | Added |
|---|---|---|
| Phase 1 — Workspace, repository and baseline | 2026-08-22 | Document created. Notes §1.1–§1.6; deviations DEV-01 through DEV-14. |
| Phase 2 — scaffold | 2026-08-22 | Notes §1.7.1: resolved install (706 packages, 16 direct), pnpm 11 `allowBuilds`, native flat ESLint config, Next-generated agent files, tsconfig rewrite, Prettier scope. Closed both §1.4 hazards. Corrected §1.5 — Neon moves from Phase 5 to Phase 2. Deviations **DEV-15**, **DEV-16**. |
| Phase 2 — Gate 1 closed | 2026-08-22 | Notes §1.7.2: all six Gate 1 criteria verified against Neon PostgreSQL 17.11, full Payload auth round-trip, runtime confirmation of D-08, the PG 17-vs-18 reasoning. **DEV-17 withdrawn** — it contradicted plan §5.1d; push is development-only. Neon unblocked in §1.5. |
| Phase 2 — debt clearance | 2026-08-23 | Notes §1.7.4: empty-string env fallbacks replaced with fail-fast (§4.1b), `sslmode` hardened to `verify-full` (closes the pg-v9 item), `/api` namespace sharing verified empirically and the collision rule recorded for Phase 6. |
| Phase 2 — visual review | 2026-08-23 | Note §1.7.6: the baseline page reviewed in a real browser at 1440×900 and 390×844 against the visual guide — palette, visual tension, guardrails and responsive behaviour all measured rather than eyeballed. Closes step 8 of the phase completion gate, which the earlier Phase 2 commits had skipped. Records the port-identity hazard found while doing it. |
| Phase 2 — append audit | 2026-08-23 | Structural corrections to this document. Phase 2 notes renumbered from `1.5a–1.5c`, which sat *before* §1.5 and implied they subdivided it, to **§1.7** with subsections. Append log put back in date order. Step 4 of the append rule carried out and recorded as **§1.7.3** — **DEV-04** and **DEV-14** confirmed; DEV-05 (Phase 8) and DEV-03 (Phase 18) still pending, not due. **DEV-18** and **DEV-19** moved to §1.7.5: both recorded compliance, not departure, and did not belong in Section 2. |
| Phase 3 — design system and UI foundation | 2026-08-24 | Notes **§1.8**: the token layer and the numbers behind the guide's adjectives (**G-12**), accent/selection/border resolution and the contrast table (**G-14**), typeface selection with the Bodoni Moda optical-size trap and the `unicode-range` trap, **C-10 settled** in favour of an in-app specimen route, what the primitives are built on, the real-browser and axe-core pass, and the visual review. Deviations **DEV-20** (no Storybook), **DEV-21** (Oxide signal colour), **DEV-22** (control borders are Muted Stone), **DEV-23** (Radix Dialog drawer, Radix Toast), **DEV-24** (Motion deferred to Phase 10), **DEV-25** (newsletter column deferred). Step 4 carried out as **§1.8.9** — DEV-14 and DEV-16 re-confirmed, DEV-01 and DEV-07 encoded in `navigation.ts`. |
| Phase 3 — post-implementation audit | 2026-08-24 | Note **§1.8.10**: the committed phase re-reviewed for latent defects, 23 findings confirmed of 37 and all fixed. `<Button asChild>` threw on every use (Slot given two children); a "persistent" toast dismissed itself in 0.1ms (`setTimeout` overflow); toast exit animations were dead classes; `crypto.randomUUID` fails outside a secure context; `max-w-prose` was 65ch not 672px and `max-w-xs` was 6px (Tailwind width-namespace precedence); `--font-weight-*` survived `--font-*: initial`; `cn()` could not conflict `transparent`/`current`/`inherit`; three dead `peer-*`/`group-*` variants; and eight accessibility defects that coexisted with a clean axe run — two `<h1>`s on the specimen sheet, a suppressed focus ring on a focusable tab panel, a `banner` landmark inside the drawer, and **no skip link** (WCAG 2.4.1, Level A). Records which gates are blind to which failure modes, for Phase 27. |
| Phase 4 — environment configuration and secret management | 2026-08-26 | Notes **§1.9**: the four contexts that evaluate the environment module and what each can gate (`instrumentation.ts` is **not** a build hook; `payload.config.ts` is **not** a startup hook), the push hazard measured down to two real paths, **D-10 closed** with `DATABASE_PUSH_TARGET` and proved by running it, the three-module split that `server-only` forced, and the would-be bugs — empty-string-is-not-absent, `NODE_ENV` undefined under the Payload CLI, `z.httpUrl()` rejecting localhost, `.env.local` loading in production builds, module scope not being once-per-server. **§1.9.7 records a post-implementation audit** that found a client component could import the environment and ship a secret in prerendered HTML, a `NODE_ENV`-unset fail-open in the guard, a total bypass via `?host=`, asymmetric case folding, a port-blind comparison, and a preview deployment able to carry live Stripe keys — all fixed. Deviation **DEV-26** (variable names this project had to choose). New decisions **D-14** and **D-15** in `docs/ARCHITECTURE.md`; new `docs/ENVIRONMENT.md`. Step 4 carried out as **§1.9.6**. |

> **Append this table, and the sections above it, at the end of every phase.**
