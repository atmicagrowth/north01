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
| ~~**Cloudinary**~~ | ~~Phase 8~~ | **RESOLVED 2026-08-28.** Cloud name, API key and secret provided after the phase was committed. The live round trip passes — see §1.13.14. No folder or preset was needed: the adapter uploads into `north01/`, which Cloudinary creates implicitly. |
| Algolia | Phase 12 | App ID, search-only key, admin key, development index |
| Stripe | Phase 17 | **Test mode only.** Secret key, publishable key, webhook signing secret |
| Resend | Phase 19 | API key; verified sending domain before any production claim |
| PostHog / GA4 / Sentry | Phase 25 | Optional — the storefront must work fully without them |
| **Neon Postgres — production** | Phase 24 | A production database separate from development, plus the deployment setting that prevents two builds migrating at once. Added in Phase 5; see §1.10.9 and `docs/DATABASE.md` §6 |

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
| **DEV-01** — Essentials is a Collection | Phases 9, 11, 23 | **Encoded**, and **exercised in Phase 9** — the seeded navigation puts Essentials under Collections, the Edit set is four, and the resolved header was read in a browser. See §1.14.10. |
| **DEV-07** — six primary nav items, including NEW | Phase 9 | **Encoded**, and **discharged in Phase 9** — rendered as NEW · SHOP · COLLECTIONS · EDIT · LOOKBOOK · ABOUT and asserted against both the resolved data and the DOM. See §1.14.10. **Amended in Phase 30:** five items, ABOUT withdrawn because `/about` has no page (DEV-07's amendment, §1.35.5). |
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
`env.server.ts` is that plus the guard and is what application code imports; and two ESLint rules
stop anything but `env.server.ts`, `payload.config.ts` and `instrumentation.ts` reaching past the
guard, so the bypass is a lint failure rather than a convention. Two rules and not one because the
obvious one is blind to `import()` — see §1.9.9, which is where that was found and closed. The same
tsx constraint is why the module imports nothing from `next/*`.

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

### 1.9.9 Second audit — the fix that had a hole in it

The round-one fixes were themselves audited, on the committed code, by the same six lenses. Forty
claims, thirty-two refuted on reproduction, eight confirmed — a refutation rate that is what a
second pass over already-corrected code should look like. Two of the eight were the same defect, and
it was the important one.

**The `server-only` guard was sound; the fence around its back door was not.** §1.9.3 records that
`env.core.ts` exists because `server-only` cannot resolve under tsx, and that an ESLint
`no-restricted-imports` rule keeps everything but the two entry points away from it. That rule does
not see `import()`. Its implementation registers `ImportDeclaration`, `ExportNamedDeclaration`,
`ExportAllDeclaration` and `TSImportEqualsDeclaration` visitors and no `ImportExpression`, so a
dynamic import matched nothing at all.

Proven end to end, twice, in isolated checkouts: a client component containing
`use(import('@/lib/env.core'))` and rendering `serverEnv.PAYLOAD_SECRET` passed `tsc --noEmit`,
passed `eslint --max-warnings 0`, passed `next build`, and put the literal 64-character secret from
`.env` into `.next/server/app/<route>.html` — a statically prerendered page, served to every
visitor. The identical leak §1.9.3 describes, reached by changing `import x from` to `import(`.

Closed with a companion `no-restricted-syntax` rule on `ImportExpression`, and both patterns widened
to cover `.js` and `.ts` spellings. Seven bypass forms — static, relative, suffixed, dynamic,
awaited — were then probed one at a time and all seven are caught.

**The distinction this forces into the documentation.** A static import of `env.server.ts` from a
client component fails the *build*. Reaching `env.core.ts` fails *lint*. Both are in the phase gate,
so both are enforced, but they are not the same strength of guarantee and D-14 now says so rather
than implying one uniform guard. A computed or template-literal specifier would still evade the lint
rule; that residual is real, it is not worth a custom ESLint plugin today, and it belongs to Phase 27
alongside the fixture-build test §1.9.7 already assigns there.

The other six, all fixed:

- **An empty `?port=` armed push against the wrong server.** The guard used `??`, which does not fall
  back on an empty string; `pg-connection-string` uses `if (!config.port)`, which does. So
  `postgres://…@localhost:5433/db?port=` resolved to `localhost:5432/db` in the guard and to port
  5433 in `pg` — push authorised for one server and performed against another. One character:
  `??` became `||`, for host and port alike, matching pg's truthiness exactly.
- **No IPv6 address could ever arm push.** `'[::1]:5432'.split(':')` is `['[', '', '1]', '5432']`, so
  the host became `[` and the mismatch warning — the thing the docs present as the actionable
  diagnostic — printed a nonsense identity and told the developer their two variables named
  different databases when they had named the same one. Now parsed bracket-aware, which also rejects
  `host:5432:extra` (previously armed push while silently discarding the extra field) and a
  non-numeric port.
- **The Phase 4 acceptance table credited the mechanism D-14 records as insufficient**, calling the
  §4.1a pass "two modules, with a runtime tripwire" — the exact arrangement that leaked a secret.
  An acceptance table is what a later reader audits the phase from; it cannot describe a superseded
  design.
- **`payload.config.ts` pointed at `lib/env.server.ts` for `resolveSchemaPush`**, which lives in
  `env.core.ts`. A reader following the comment to verify what `push:` is gated on finds a 30-line
  re-export.
- **`VERCEL` was undocumented.** It is a declared schema member and the sole input to the
  `resolveAppEnv` branch §1.9.7 describes as the one that took a fix, but it appeared in no variable
  table, in a document billed as covering every variable.
- **A docblock undercounted its own evidence**, saying four integration groups have browser-safe
  members where seven of eight do — weakening the warning the paragraph exists to give.

**What this says about auditing.** Round one's audit found the leak; round one's *fix* introduced a
narrower version of the same leak, and only a second adversarial pass over the corrected code found
it. A fix is not self-verifying, and the gates that pass a fix are the same gates that passed the
defect. The habit worth keeping is the one that caught it both times: build the wrong thing on
purpose and check whether the toolchain actually stops it.

### 1.9.10 What is now owed, and by whom

`docs/ARCHITECTURE.md` §5's owed table is down to two rows. Phase 4 adds no new debt, and one item is
worth naming for a later phase rather than leaving implicit:

- **Nothing mechanically prevents a future file from reading `process.env` directly** and bypassing
  the module. Phase 4 fenced the one case that leaks secrets — reaching past `env.server.ts` to the
  unguarded core, in both its static and dynamic forms — but a blanket `no-restricted-properties` on
  `process.env` is a wider tooling decision with a scope question attached, and is left for
  **Phase 27** alongside the checks §1.8.10, §1.9.7 and §1.9.9 assign there.
- **The `env.core.ts` fence is lint-strength, not compiler-strength**, and a computed specifier would
  evade it. See §1.9.9. A custom ESLint rule that flags any import of the core from a file carrying
  `'use client'` would close it properly; it is not worth a plugin today.

## 1.10 Phase 5 — Neon Postgres + Payload CMS foundation

### 1.10.1 What Phase 5 still had to do

Two of the phase's four sections were already satisfied when it opened, and by earlier phases rather
than by luck.

| Plan | State at the start of Phase 5 |
|---|---|
| §5.1a — provision a development database | **Done in Phase 2.** Neon PostgreSQL 17.11, development branch, direct endpoint, `sslmode=verify-full`. See **DEV-15** and §1.7.2 |
| §5.1b — connect Payload to Postgres | **Done in Phase 2**, through the official `@payloadcms/db-postgres` adapter. Hardened here: pool limits, and the connection timeout that was not one |
| §5.1c — migration discipline | **This phase.** There was no migration at all |
| §5.1d — database safety | **Partly done in Phase 4** — `push` gated by **D-10**, `disableCreateDatabase`, `migrationDir`. The schema conventions were this phase's |

So what was genuinely outstanding was the migration baseline, the discipline around it, the schema
conventions the data model will inherit, and — the part that has to be *done* rather than written —
proof that all of it works. **No dependency was added.** The adapter, Drizzle, `pg` and the migration
CLI have been installed since Phase 2; Phase 5 is the phase that finally uses them.

### 1.10.2 Proving migrations without destroying the development database

The only honest way to prove a migration applies is to apply it. The development branch cannot be
that target: it is push-built, so `payload_migrations` carries the `batch = -1` row that push leaves
behind, and `payload migrate` therefore stops and asks whether to proceed *through data loss*. Both
ways forward from that prompt — answering yes, or `migrate:fresh` — destroy the admin user the
project owner created in Phase 2.

The way out was to check what the database role could actually do. `neondb_owner` has `rolcreatedb`,
so the whole lifecycle ran against a throwaway database created beside the development one in the
same Neon project, and dropped afterwards:

| Step | Result |
|---|---|
| `CREATE DATABASE north01_migration_check` | created; development branch untouched throughout |
| `pnpm migrate:status` | one migration, `Ran: No` |
| `pnpm migrate` | applied in 283 ms; nine tables |
| `pnpm migrate:status` | `Ran: Yes`, batch 1 |
| CRUD through the Local API | §1.10.3 |
| `pnpm migrate:down` | rolled the batch back — **every table dropped, `payload_migrations` included** |
| `pnpm build:deploy` | `payload migrate` re-applied it, then `next build` produced the four routes |
| `pnpm migrate:fresh --force-accept-warning` | dropped and rebuilt from the migration in 500 ms |
| `DROP DATABASE … WITH (FORCE)` | the Neon project is back to `neondb` alone |

Two things are worth keeping from how that was done. **Retargeting was a shell variable, not a file
edit** — Next's env loader assigns only variables that are not already in `process.env`, so
`DATABASE_URL=… pnpm migrate` overrides `.env` for one command and nothing on disk changes.
And **the D-10 guard disarmed push by itself**: `DATABASE_PUSH_TARGET` still named the development
branch, so pointing `DATABASE_URL` at the verification database left push off and said so on the
first line of `pnpm dev`. The guard was not under test. It simply did the thing it exists for, in the
exact situation it was written for.

The procedure is now the standing one, in `docs/DATABASE.md` §10.

**Rolling back the initial migration is a teardown, not a rollback** — its `down` drops every table,
and the migration ledger is one of them. That is inherent to a first migration and worth knowing
before it is attempted on anything that matters.

### 1.10.3 CRUD, proved three ways

Plan §5.1's acceptance asks for create/read/update/delete on a test collection through Payload Admin
*and* the application. All three surfaces were driven, because they are three different code paths
and only one of them is the admin panel.

**Local API** (`payload run`, against the migration-built database): create; read by ID and by query;
update, with `updatedAt` observed changing; a missing required field rejected; a duplicate `reference`
rejected; a duplicate `(owner, label)` pair rejected; **two rows with the same label and no owner both
accepted** — the NULL-distinctness result below; soft delete hiding the row from a default `find` and
revealing it under `trash: true`; restore; the owner user deleted and the probe's `owner` observed
becoming `null` rather than the row vanishing or dangling; hard delete followed by `Not Found`.

**REST, through the running application**: unauthenticated `GET /api/schema-probes` → **403**, which
is Payload's default access control working; then create, read, update, a duplicate rejected with
`Value must be unique`, soft delete by `PATCH`, and a list that returns `totalDocs: 0` by default and
`1` with `?trash=true`.

**Admin panel, in a real browser** at 1440×900: logged in, created a document, saw it in the list,
edited and saved it, watched a duplicate `reference` refused with the error attached to the field and
a toast repeating it, deleted through the document controls — the confirmation dialog reads *"You are
about to move the Schema Probe … to the trash"* and offers **Skip trash and delete permanently** —
and then found the list empty and the Trash view holding both soft-deleted documents.

### 1.10.4 What the phase found: an unhandled pool error is an `uncaughtException`

The acceptance criterion *"app survives database restart/reconnect"* was tested rather than assumed:
with a dev server running and serving, every backend belonging to it was terminated with
`pg_terminate_backend`, and the next requests were made immediately.

The requests were fine — 200, then 200 again. The log was not. It contained
`⨯ uncaughtException: error: terminating connection due to administrator command`.

**The cause.** `connect.ts` in the adapter takes one client from the pool at startup, to prove
connectivity, and attaches an `error` listener to *that client*. Every other client the pool creates
is bare. When a bare idle client dies — a suspended Neon compute, a dropped socket, an administrator
terminating a backend — `pg-pool` discards it and re-emits on the **pool**, and an `error` event with
no listener is the one event Node turns into a throw. `next dev` installs its own handler and
survives, which is exactly why this can sit in a codebase unnoticed: the environment where it is
harmless is the environment where it is visible. A production server has no such handler, and an
idle Neon compute is not an unusual thing to crash on.

**The fix** is four lines in an `onInit` hook: attach an `error` listener to the pool and log. Nothing
more, because nothing more is wrong — `pg` has already discarded the client, and the next query opens
a fresh one, which is precisely what the two 200s showed. The only thing missing was somewhere for
the event to land. `onInit` is the earliest point that has a pool to attach to: `payload.init()` calls
`db.connect()` before it. The listener-count guard is for `next dev`'s hot reload, which re-runs
`onInit` against the same retained pool.

**Re-measured after the fix:** backends terminated again, three requests, all 200, **zero**
`uncaughtException`, and one line — `Postgres pool client error. The connection was discarded; the
next query opens a new one.`

**And then re-measured under `next start`**, because the whole argument is about the environment
that has no development safety net, and proving a production fix in development proves nothing. A
production build was started, a request forced a real query — `POST /api/users/login` with bad
credentials, since `/admin`'s login page and a 403 from access control both answer without touching
Postgres — the backend behind that connection was terminated, and the next three requests returned
401 as they should. Handler fired once, no `uncaughtException`, process still listening.

**`connectionTimeoutMillis` was measured too**, against a black-holed address: the CLI failed with
`cannot connect to Postgres. Details: Connection terminated due to connection timeout` rather than
hanging. `pg`'s default for that option is `0` — wait forever — so this is the one pool setting that
is a behaviour change rather than a restatement. `max` restates `pg`'s default of 10;
`idleTimeoutMillis` is three times its 10s default, which the first draft of `docs/DATABASE.md`
wrongly described as a restatement and now states correctly.

### 1.10.5 Push and migrations produce the same schema — measured, not assumed

*Migration drift* is on the plan's edge-case list for this phase, and it is usually discussed rather
than checked. It was checked. The development branch, whose schema was built entirely by Drizzle's
push, and the verification database, whose schema was built entirely by the committed migration, were
dumped along three axes — every column with its type, nullability and default; every index definition;
every constraint definition — sorted, and diffed.

**Identical.** No differences at all.

That is the answer to the edge case: the two mechanisms are generated from the same config, so a
difference between them means one of them did not run, not that they disagree. The diff is cheap, and
`docs/DATABASE.md` §10 keeps it as the check to run when a migration looks unusual.

### 1.10.6 Things that would have been bugs

**`payload.delete({ trash: true })` is not a soft delete.** It reads exactly like one. It means
*permanently delete, trashed documents included*. The first version of the CRUD proof used it, and
the evidence was unmistakable once looked at: `deletedAt: null`, `visibleByDefault: 0`, and
`visibleWithTrash: 0` — the row was gone, not trashed. A soft delete is an **update** that sets
`deletedAt`, which is what the admin panel's "move to trash" does. Phase 18 will reach for this on
orders; it is now in `docs/DATABASE.md` §8.

**A compound unique index over a nullable column is weaker than it reads.** `(owner, label)` unique
does not prevent two rows with the same label and no owner, because Postgres treats NULLs as distinct
from one another. Both rows were created. PostgreSQL 15+ can say `NULLS NOT DISTINCT`; Drizzle does
not emit it, so the constraint that exists is the weaker one, and a constraint that must hold across a
nullable column needs the column made required instead.

**Compound index names are not namespaced by their table.** `indexes: [{ fields: ['owner', 'label'] }]`
emitted `CREATE UNIQUE INDEX owner_label_idx`. Index names are unique per *schema* in Postgres, so two
collections declaring a compound index over the same field names collide — and the collision surfaces
as a failed migration, not as a config error. Phase 6 defines a dozen collections and several of them
will want an index over something like `(product, slug)`. Recorded before it happens.

**A generated migration does not compile here.** Payload's template destructures
`{ db, payload, req }` and uses only `db`; this project sets `noUnusedParameters`, so `pnpm typecheck`
fails on a freshly generated file. Trimming both signatures to `{ db }` is the fix, it is one edit per
migration, and it is written into the workflow rather than rediscovered each time. The alternative —
exempting `src/payload/migrations/` from typechecking — was rejected: migrations are the code that
runs against production, and they are the last place to turn the compiler off.

**`payload migrate` cannot run unattended against a pushed database.** The `batch = -1` prompt has no
answer in a non-interactive build. It is another reason production must never be pushed to, and it is
why the deployment build command is safe: a production database has never seen push, so the prompt
never appears.

### 1.10.7 Choices that follow the plan rather than depart from it

Recorded here rather than in Section 2, because none of them departs from a canonical document.

- **The fixture collection is scaffolding, and Phase 6 removes it.** Plan §5.1's prompt asks for
  *"one small test collection"* to prove CRUD before the ecommerce collections exist. `schema-probes`
  is that, and every field in it is a worked example of one §5.1d requirement. Its removal in Phase 6
  is deliberate: it will be the project's first destructive migration, which is the one migration
  shape worth practising on something worthless.
- **Its access control is left at Payload's default**, which is `Boolean(req.user)` — closed, not
  open, as the 403 above confirms. Phase 7 owns access rules and the fixture will be gone before then;
  writing speculative rules for it would be Phase 7 work done early and thrown away.
- **No health endpoint was invented.** The reconnect criterion could have been demonstrated with a
  public `/api/health/db` route, and no canonical document asks for one. Building an unrequested
  public endpoint to make a test convenient is how surface area accumulates; `pg_terminate_backend`
  and three requests answered the same question with nothing left behind.
- **Migrations run in the build, not in the server** — `pnpm build:deploy`. The adapter's
  `prodMigrations` option would run them from `connect()` in every cold-starting instance at once.
  Plan §5.1d explicitly asks that deployments not race migrations; this is **D-16**.
- **Primary keys stay `serial`.** The adapter can issue `uuid`/`uuidv7`, and the choice is effectively
  permanent once Phase 6 creates the tables, so it was taken deliberately rather than inherited.
  **D-17**, with the reasoning and the place where the customer-facing identifier problem actually
  gets solved.

### 1.10.8 Confirmation sweep of earlier deviations

Step 4 of the append rule.

- **DEV-15 — Postgres is required from Phase 2, not Phase 5. Confirmed, and now closed.** Phase 5
  arrived to find the database already provisioned and connected, which is what the deviation
  predicted. Nothing further is owed by it.
- **DEV-17 — schema push disabled from the start. Still correctly withdrawn**, and this phase is the
  one that vindicates the withdrawal: the local workflow is push, exactly as §5.1d prescribes, and the
  migration baseline was generated from the config without push ever being disabled. One correction:
  the entry's *"We do"* line still quotes `push: process.env.NODE_ENV === 'development'`, which Phase 4
  replaced with `push: schemaPush.allowed`. The entry already points at Phase 4 for the guard; the
  quoted line is superseded, not the reasoning.
- **§1.7.2's `sslmode` item** — closed in §1.7.4 and re-confirmed in use here: the connection string
  ends in `sslmode=verify-full`, and `docs/DATABASE.md` §2 states it as a rule rather than a habit.
- **DEV-10 (schema additions Phase 6 does not list)** and **DEV-12 (category browsing must not route
  through Algolia)** are Phase 6 and Phase 12 respectively. Not due, not touched.

### 1.10.9 What is now owed

- **A production database, and the deployment setting that stops two builds migrating at once.** Both
  are the project owner's to provision and configure, and neither is needed before deployment.
  `docs/DATABASE.md` §6 says what is required. Added to `docs/ARCHITECTURE.md` §5's owed table
  against **Phase 24**.
- **Removing `schema-probes`** — Phase 6, as above.
- **Keeping compound-index field combinations distinct across collections** — Phase 6, for the
  index-name collision in §1.10.6.

## 1.11 Phase 6 — Payload data model

Twenty-two collections, two globals, seventy-three tables, one new dependency. This is the phase the
first five were foundation for, and the phase every later one builds on: from here the schema is the
thing that has to be right, because a column added in Phase 17 is a migration and a column *shaped*
wrongly in Phase 6 is a rewrite.

### 1.11.1 The five decisions that had to be taken before a single field could be written

Each of these determines the shape of many tables, and none of them is reversible cheaply.

**1. Money.** Payload's `type: 'number'` compiles to Postgres `numeric` — exact — and the adapter reads
it back through Drizzle's `numeric({ mode: 'number' })`, which hands JavaScript a binary float. Exact
in the database and approximate in the application is the worse half of both designs: the database
would be right and every total computed from it would be a rounding argument. Integers survive both
halves unchanged, and are what Stripe's API already speaks.

So every amount is an integer count of minor units, in a column whose name ends `Minor`. The name is
the enforcement — a field called `price` holding `1999` is a bug waiting for `product.price * quantity`
— and a field validator refuses a fractional value, because `min` and `step` govern the admin widget
only and a REST client can send `19.99`. Recorded as **D-20**.

**2. Publish state, and not Payload drafts.** `versions: { drafts: true }` was the obvious way to
express plan §6.1e's "publish state". It is not used, and the reason is a column property rather than
a preference. In `@payloadcms/drizzle/schema/buildRawSchema.js`:

```js
buildTable({ …, disableNotNull: !!collection?.versions?.drafts, tableName /* the MAIN table */ })
```

Enabling drafts strips `NOT NULL` from every column of the collection's **own** table, not just the
versions mirror — because a draft is allowed to be incomplete. On an editorial page that is untidy. On
`orders`, where `total_minor` and `payment_status` *are* the record, it makes `required: true`
unenforceable at the only layer that cannot be bypassed. And the weight is real: every array and block
table beneath every collection gains a mirror, which for eleven editorial collections is a large
multiple of the tables the model needs, in every migration, forever.

What the corpus asks for is narrower than versioning. `status` answers "should the public see this";
`publishedAt` answers feature matrix §12's "scheduled/past campaign" by being compared against the
clock. Nothing anywhere asks to see, restore or edit a previous revision. A later phase that needs
revision history can turn drafts on beside these two columns.

**3. Where variants live.** A separate collection, not an array on the product. The critical rule in
§6.1c is a uniqueness constraint, and Payload's compound-index API operates on collection fields, not
on array sub-fields — so an array could not express it at all. A separate table is also what lets a
cart line and an order line point at a purchasable row by id, which is the whole point of §2.1's
"a variant is the purchasable unit".

**4. Which side owns a many-to-many.** `products.collections` and `collections.products` cannot both be
stored — that is the duplication the phase brief warns against, and the two copies disagree within a
week. The direction is forced by *ordering*: feature matrix §12 requires curated product ordering on a
collection page, and an order is a property of the list rather than of its members. So the collection
owns an ordered `hasMany`, and the product reads it back through a `join`, which is virtual and adds
no column.

Categories go the other way for the same reason inverted: a category page has no hand-curated order —
products sort by `sortOrder`, price or newness — so the product owns `categories` and the category
needs no list. The asymmetry is deliberate and each direction is owned by whoever needs the order.

**5. Two auth collections.** Plan §7.1b states that customers *"may NOT access Payload Admin"*. With
one collection and a role column that is a conditional inside an access function, one inverted
comparison away from letting a shopper into the CMS. With two, `admin.user` points at `users` and a
customer has nowhere to log in *to*. Structural, like **D-08**'s route groups. Recorded as **D-21**;
Phase 2's `users` collection had already anticipated it in a comment.

### 1.11.2 The constraints that are stricter than the plan asks

Phase 5 left two questions open and labelled them for this phase (`docs/DATABASE.md` §8). Both are
now answered, and neither needed the escape hatch it looked like it needed.

**The variant SKU.** Plan §6.1c: *"do not allow two active variants of the same product to share the
same SKU."* Read literally that is `UNIQUE (product_id, sku) WHERE active` — a partial compound index,
which Payload's `{ fields, unique }` API cannot express, and which Phase 5 expected would need
`afterSchemaInit`.

What it actually needed was noticing that the rule is a *lower bound on correctness* rather than a
specification. The constraint in the database is `UNIQUE (sku)` across the whole collection, and it
refuses a superset of what the plan asks to be refused. The two things the literal rule permits are
both defects:

- **The same SKU on two different products.** Nothing in the wording forbids it and it is incoherent —
  a stock-keeping unit that identifies two different garments cannot be picked, counted or reconciled,
  and every downstream system assumes otherwise.
- **Reusing a SKU after retiring a variant.** This is precisely the case `WHERE active` exists to
  allow, and precisely the case that breaks order history: order lines snapshot the SKU (§6.1k,
  §18.1d), so a reassignable SKU means two orders eighteen months apart record the same code for two
  different garments and no report can separate them afterwards.

Recorded as **DEV-29**.

**Inventory.** `afterSchemaInit` *is* used, once, for the constraint that genuinely has no other
spelling: `CHECK (inventory_quantity >= 0)`. It earns it because plan §17.1f requires the decrement at
order finalisation to be atomic, which means Phase 17 will issue `UPDATE … SET inventory_quantity =
inventory_quantity - $n` directly against Postgres, past every field validator this config declares. A
`CHECK` is the only rule that statement cannot step around, and negative stock is not an oversell to
reconcile later — it is a lost write, and the row recording it is the last honest count anyone has.

`drizzle-orm` is reached through `@payloadcms/db-postgres/drizzle/pg-core`, which the adapter
re-exports for exactly this, so it costs no new direct dependency. Verified that drizzle-kit carries
the constraint into the `.json` snapshot, so later migrations will maintain it — which is the property
a hand-written migration would have lacked, and the reason that third option stays rejected.

Measured, not assumed: a raw `UPDATE` subtracting 100 000 from every variant of a product was refused
by the constraint.

### 1.11.3 Three defects that only running it would have found

All three passed typecheck, lint and the production build. None would have been found by reading.

**A `dbName` string replaces the whole table name, and shares it across collections.** The shop-the-look
block's default naming produced `collections_blocks_shop_the_look_hotspots_product_id_products_id_fk`
— 67 characters, over Postgres's 63-byte identifier limit. Payload validates *table* identifier lengths
and not constraint names, so nothing warned. The fix looked obvious: `dbName: 'look'`.

It was wrong, and worse than the problem. `createTableName` uses a custom name **instead of** the
`${parentTable}_blocks_` prefix, not with it — so a block used by two collections collapsed into one
shared `look` table whose parent foreign key referenced `collections` alone:

```sql
ALTER TABLE "look" ADD CONSTRAINT "look_parent_id_fk"
  FOREIGN KEY ("_parent_id") REFERENCES "public"."collections"("id")
```

Saving that block on an *Edit* would have written a row pointing at an `edits` id through a key that
says `collections`. A silent cross-collection corruption, traded for four characters. The function form
— `dbName: ({ tableName }) => \`${tableName}_blocks_look\`` — receives the parent table name and keeps
them separate, and the longest name they generate is 58 characters. (The longest identifier in the
schema as a whole is 59 — `wishlist_items_variant_preference_id_product_variants_id_fk` — which was
never the one at risk.)

**Required address sub-fields made a draft order impossible to save.** Plan §18.1a creates a pending
order *before or at* checkout creation, which is before the customer has typed an address. The address
field group was written once and reused twice — correct for the address book, wrong for the order
snapshot — and Payload has no "required only when the group has data", so `payload.create` on an order
failed with twelve validation errors at once. The requirement belongs where the corpus already puts
it: checkout preflight (§17.1a, and **DEV-11**, which adds shipping-address validation to it
precisely because shipping and tax cannot be computed without one). `addressFields` now takes
`required` as a parameter.

**A delete cascade written on `afterDelete` never runs.** Payload compiles a single non-polymorphic
`relationship` to `ON DELETE SET NULL` with no option to change it, and a `required` relationship is
also `NOT NULL`. The two are set independently and their combination is a contradiction that surfaces
only at delete time — Postgres tries to null a column that may not be null and raises
`null value in column "variant_id" violates not-null constraint`, failing the **parent's** delete. A
cleanup scheduled for `afterDelete` therefore never runs at all: the transaction has already rolled
back. Moved to `beforeDelete`, and extended to every dependant with a required back-reference:
`carts`→lines, `orders`→lines, `products`→variants/lines/wishlist/reviews, `product_variants`→lines,
`customers`→addresses/wishlist/reviews. Nullable references are deliberately left to `SET NULL`, which
is why deleting a customer keeps their orders.

### 1.11.4 Drizzle's generated migrations do not always run, and it is systematic

Twice, and the second time across twenty-two statements: the generator emits `DROP TABLE … CASCADE`
alongside explicit cleanup of the objects that referenced those tables, and `CASCADE` has already
removed them by the time the explicit statement runs.

```
error: constraint "payload_locked_documents_rels_schema_probes_fk"
       of relation "payload_locked_documents_rels" does not exist
```

Found first in the `up` that removed `schema_probes` — the fixture Phase 5 created for exactly this
purpose, and it earned itself on its way out — and then again in the `down` of the data-model
migration, where it would have made a production rollback impossible. Both rolled the batch back
cleanly, which is the one comfort: migrations are transactional.

The fix is `DROP CONSTRAINT IF EXISTS` rather than reordering. The statement is *redundant* rather than
wrong — the constraint is meant to be gone — and idempotence does not depend on getting a
two-hundred-statement ordering right by hand. It changes no end state, so the snapshot beside the file
stays accurate. `docs/DATABASE.md` §4 now lists it as a required step after `migrate:create`, beside
the parameter trim, and those two remain the only hand-edits a migration ever gets.

**A second migration-workflow finding: `migrate:create` is not always non-interactive.** Generating a
migration that drops one enum while creating fifty asks, through `prompts`, whether each new enum is a
rename of the dropped one — and with no TTY it cancels silently and writes nothing, exit code 0. The
answer was to remove the ambiguity rather than to answer it: the fixture removal was generated as its
own migration first, against a temporary config containing only `Users`, so the data-model migration
that followed had no drops in it at all. That also produced a better commit — a destructive migration
that stands alone and can be read.

### 1.11.5 What was verified, and how

The development database was rebuilt from the migration chain rather than from a throwaway copy —
`migrate` → `migrate:down` → `migrate` — which exercises the same statements plus the rollback and is
the cycle that found both `DROP CONSTRAINT` failures. Afterwards `pnpm dev` was started and `/admin`
requested: Drizzle pulled the schema, found no difference, and applied nothing. That is §1.10.5's
push-versus-migration cross-check repeated against a data model instead of a fixture.

Then twenty-four behavioural checks against the live database, **all twenty-four passing**:

| Check | Result |
|---|---|
| `derived` price range, compare-at and stock match the variants | matches — 22000–22000, compare-at 28000, 54 units over 10 variants |
| Deactivating a variant recomputes it; reactivating restores it | 157 → 149 → 157 |
| Duplicate SKU, anywhere in the catalogue | refused — `Value must be unique` |
| Duplicate colour + size within one product | refused |
| Duplicate slug within a collection | refused |
| A slug is trimmed and lower-cased before it is compared | `"  Slug-Normalisation-TEST  "` → `slug-normalisation-test` |
| A malformed slug | refused with the field-level reason |
| A fractional price | refused — whole minor units only |
| Negative stock through raw SQL, past every validator | refused by the `CHECK` |
| A cart issues its own token and expiry | 256-bit token, 30-day expiry |
| Two bag lines for one variant | refused |
| Deleting a cart removes its lines | 2 lines removed |
| A draft order saves with no address | `N01-B2MFB0ZV`, draft / unfulfilled |
| An order line after the product is renamed | snapshot unchanged |
| A promotion code is trimmed and upper-cased | `"  verify-test  "` → `VERIFY-TEST` |
| Soft delete hides a product; restore returns it | ordinary read 0, read-with-trash 1 |
| Hard delete cascades to variants and bag lines | all removed |
| Globals read back what the seed wrote | 6 primary navigation items |
| A seventh primary navigation item | refused — `no more than 6 Rows` |
| A hotspot with no product | refused |
| A hotspot coordinate above 100% | refused |
| A `javascript:` CTA href | refused |
| `publishedAt` on the transition to published | stamped once, not on a draft |
| A category set as its own parent | refused |

And in a real browser, signed in to the admin panel: all six sidebar groups render, the product editor
shows its six tabs, the `variants` join lists ten rows in size order with SKU, colour, price and stock,
the read-only *Derived from variants* panel shows the maintained values, Site Settings renders its six
tabs with the seeded content, and the console is clean. The temporary admin user created for that pass
was deleted afterwards.

`pnpm typecheck`, `pnpm lint --max-warnings 0` and `pnpm build` all pass. The build adds no routes,
which is correct: this phase adds no UI.

### 1.11.6 Things that would have been bugs

- **A `lowStock` flag on the product.** It was in the first draft of the derived cache. It would have
  been computed against `siteSettings.lowStockThreshold` at write time, so every product in the
  catalogue would have held a stale answer the moment an editor changed that threshold. Replaced with
  a **count** — `inventoryTotal` — and the threshold applied at render. Sold out is `= 0`, low stock is
  `<= threshold`, and neither can drift.
- **A compare-at price taken as the largest discount in the product.** It is the cheapest variant's,
  because that is the price being displayed beside it. "$240, was $400" when the $240 variant was never
  $400 is a false price claim, which plan §24.1b forbids in structured data and which is worse than
  useless on a card.
- **`customer_product_idx` on two collections.** Wishlist and reviews both index `(customer, product)`
  conceptually. Payload builds compound index names from the field list with no table prefix, and index
  names are unique per Postgres *schema*, so the two contend for one name; the adapter de-duplicates by
  appending a counter, which makes the loser's name depend on collection order in the config. Avoided
  by ordering the columns differently — `customer_product_idx` and `product_customer_idx` — which is
  also the better index for the query each one serves. **The column order is load-bearing because it is
  the name.**
- **A mixed-case index name.** The same naming rule uses *field* names, not column names, so a field
  called `colorName` produced `"product_colorName_size_idx"` — legal, and quoted forever afterwards.
  The field is called `color`.
- **A price snapshot on the cart line.** Tempting, because it is the only way to tell a customer "the
  price of this changed since you added it". Rejected: it puts money on a table whose entire invariant
  is that it holds none, and it invites the next reader to compute a total from it. No document requires
  the notice. The bag holds no money at all, and the order is where amounts are finally written down.
- **Seeded orders, customers and reviews.** Also rejected. Plan §6's brief is *"seed only representative
  demo content"*, and an order is not content — it is a record of something that happened. An admin
  panel full of purchases nobody made is the same category of lie as fake UI (§0.1.17), and it is worse
  than an empty order list because it looks trustworthy.

### 1.11.7 Choices that follow the plan rather than depart from it

Recorded so they are not mistaken for omissions, and to keep Section 2 for genuine departures.

- **Access control is Payload's default.** Every operation requires an authenticated session, which is
  closed rather than open. Phase 7 owns roles and rules (§7.1a–e); this phase built the columns those
  rules will be written against and opened none of them.
- **No `inventoryCommittedAt`, `confirmationEmailSentAt`, `checkoutIdempotencyKey`, Stripe event
  record, email delivery record or Algolia sync record.** Each is required by plan §17.1d, §19.1c or
  §12.1b, and each belongs to the phase that writes it — **G-07**, and **DEV-10**'s own last row. A
  column no phase writes reads empty through five phases and stops being trusted. Recorded as **D-19**.
- **No promotion-redemption table.** A per-customer usage limit is a count of paid orders carrying that
  promotion, which `orders.promotion` already answers. A second table recording the same fact is the
  duplication the §6 prompt warns against.
- **No review aggregates on the product**, for the same reason, even though the price aggregate beside
  them is denormalised. Price is gap **G-04**, assigned to this phase. Reviews are Phase 21.
- **The homepage block system is not here.** Plan §10.1a's hero, promotional strip, category tiles,
  brand story, social gallery and newsletter belong to Phase 10, which owns the homepage. What Phase 6
  defines is the shared editorial vocabulary §6.1e and §6.1f ask for — seven blocks, each mapping to a
  sentence of visual guide §09 — which Phase 10 may reuse.
- **`type: 'select'` enums are namespaced per table** (`enum_products_status`, `enum_carts_status`), so
  the collision hazard that applies to compound index names does not apply to enums. Verified in the
  adapter rather than assumed.
- **The seed creates no media.** Every image field is optional and every one is left empty. Media is
  Phase 8, and committing placeholder binaries to stand in for it would be a different kind of fiction;
  plan §8.1d already specifies what the storefront does with a missing asset.

### 1.11.8 Confirmation sweep of earlier deviations

Step 4 of the append rule.

- **DEV-10 — schema additions Phase 6 does not list. Now due, and discharged.** Customer address
  (**G-01**) and size guide (**G-02**) exist as collections; gender (**G-03**) and the product display
  price (**G-04**) exist as fields; variant availability (**G-05**) is enumerated as a derivation and
  explained in `ProductVariants.ts`. The row for infrastructure records is honoured by *not* building
  them — the entry itself says "created in their own phases rather than up front".
- **DEV-01 — Essentials is a Collection, not an Edit. Confirmed and now encoded in data.** The seed
  creates Essentials at `/collections/essentials`, and the Edit set is the structure document's four.
- **DEV-07 — six primary navigation items. Confirmed, and now enforced by the schema.**
  `navigation.primary` has `maxRows: 6`; a seventh is refused. Phase 3 encoded it in `navigation.ts`;
  Phase 6 makes it a property of the data an editor cannot exceed.
- **DEV-08 — one discount code per order. Confirmed.** `carts.promotion` and `orders.promotion` are
  single relationships, so stacking is unrepresentable rather than merely discouraged. `combinable` is
  modelled and unused, exactly as the entry says.
- **DEV-02 / DEV-03 — `PENDING_PAYMENT`, and order state as two axes. Both now exist as columns.**
  `paymentStatus` carries `pending_payment`; `fulfillmentStatus` is separate. Transitions remain
  unrestricted here — that is §18.1b's and Phase 18's, and a half-built state machine would be a rule
  to work around.
- **DEV-09 — reference-image elements out of scope. Confirmed by absence.** No PILLAR facet, no
  pre-order availability state, no per-product community gallery. The availability enumeration
  deliberately stops at four values.
- **DEV-06 / D-07 — no card data.** Nothing in this schema stores a PAN, a CVC or a payment method.
  The only payment identifiers are Stripe's own, read-only.
- **DEV-12 — category and collection browsing must not route through Algolia.** Not due until Phase 12,
  and the schema supports it: a collection owns an ordered product list, and a category page is a
  `where` clause on an indexed column. Neither needs a search index.
- **DEV-17 — schema push disabled from the start. Still correctly withdrawn**, and this phase leaned on
  push being available: the local workflow was push for iteration and committed migrations for
  everything else, exactly as §5.1d prescribes.
- **DEV-14 — substantial work uses feature branches. Confirmed.** Phase 6 ran on
  `phase-6-payload-data-model`.
- **DEV-16** (route-group topology) and **DEV-04** (no GraphQL surface) — both untouched and both still
  true; this phase added no route and exposed no new API paradigm.
- **DEV-24** (Motion, Phase 10) and **DEV-25** (newsletter column, Phase 19) — untouched, still pending
  their phases.

### 1.11.9 What is now owed

- **A `deletedAt` sweep for expired carts.** `carts.expiresAt` exists and nothing acts on it. An
  expired bag is treated as empty on read, so this is housekeeping rather than correctness — but the
  table grows without it, and a cart with no customer is still personal data by association. No phase
  has claimed it; it belongs with the maintenance tasks in Phase 24 or with a scheduled job if one is
  ever introduced.
- **Restricting order status transitions.** Phase 18, per §18.1b and §18.1c. The vocabulary exists; the
  state machine does not, deliberately.
- **Opening access control.** Phase 7. Every collection is currently authenticated-only, which means
  the storefront cannot read a published product yet — correct at this point in the build order, and
  the first thing Phase 7 changes.
- **Media requiredness and validation.** Phase 8 owns mime types, size and dimension limits, focal
  points, `imageSizes` and the Cloudinary adapter. Phase 6 left every image field optional so that a
  seed without assets is a legitimate state rather than a blocked one.
- **A rebuild path for `products.derived`.** Re-saving any variant recomputes it, which is enough today
  and is not a script. If the cache is ever found wrong in bulk — after a direct SQL edit, say — a
  small script over `recalculateProductDerived` is the fix, and it is exported for that reason.

### 1.11.10 Post-implementation audit, and what it found

The committed phase was re-reviewed the way Phases 3 and 4 were: seven independent auditors over
separate dimensions — the Payload API surface, the hooks, the generated SQL, corpus compliance,
commerce correctness, the scripts, and whether the documents tell the truth about the code — with
every claim then handed to a verifier instructed to *refute* it. **38 claims, 8 refuted, 30 survived**,
of which several were the same defect seen from different angles. Eight distinct problems, all fixed
here rather than noted.

**The headline: `context` is not a per-call argument, and the whole schema's price cache depended on
it being one.** `payload.update({ …, req, context })` reads as though `context` scopes to that call.
It does not — `createLocalReq` assigns `req.context = { ...req.context, ...context }` onto **the same
object it was handed** and nothing restores it. Proved by running it: the returned request is `===`
the one passed in, and the caller's context carries the flag afterwards.

Two consequences, both reachable from the admin panel this phase generates:

- `cascadeDelete` set `skipDerivedSync` on every cascade. Because `product-variants` installs that
  hook too, *any* permanent variant delete latched the flag onto the shared request, and the variant's
  own `afterDelete` then skipped the recompute — leaving a product advertising the price and stock of
  a variant that no longer existed, with nothing to correct it until an unrelated variant happened to
  be saved.
- `recalculateProductDerived` set the same flag on its own product update. A bulk variant edit shares
  one request across every matched row, so the first variant refreshed its product and **every later
  one silently did not**. Bulk-editing prices is an everyday merchandiser action.

The fix is to stop using a boolean on a shared object as a per-call switch. The suppression now
travels as the *id of the product being deleted* — a value that names its subject cannot suppress the
wrong subject — and the redundant flag on the product update is gone entirely, because updating a
product fires the product's hooks and products have no `afterChange`. There was never a cycle to
break. Both scenarios are now covered by checks that fail if the leak returns.

**The second real one: swallowing a hook error hid a transaction Payload had already rolled back.**
`recalculateProductDerived` caught its own failure, logged it and continued, on the reasoning that a
cache refresh must not fail the variant save that triggered it. The reasoning is sound and the
mechanism made it false: every Payload operation ends `catch { await killTransaction(req); throw }`,
and `killTransaction` rolls back the *caller's* transaction and deletes `req.transactionID`. By the
time the catch block ran, the variant's own write was already gone — so the operation reported success
for a save that did not happen. Silent data loss, which is strictly worse than a failed request. Both
this hook and the default-address hook now rethrow.

**Third: eleven media references and three hotspot references could never be deleted.** The
`NOT NULL` + `ON DELETE SET NULL` contradiction this phase discovered has a second form that the
`beforeDelete` cascade cannot reach. Where the dependant is an *array or block row inside another
document* — a shop-the-look hotspot, a gallery image, a review photo — there is no collection to
cascade from: those rows are not documents. A `required` column there made the referenced product or
media asset permanently undeletable, failing with a foreign-key error naming an internal block table.

Worse, the hotspot field's own comment asserted the opposite — that deleting a product would empty the
reference — and cited the rule it was breaking.

The column is now nullable and the requirement moved to `validate`, which Payload enforces on every
write through every API. Authoring is unchanged: a hotspot still cannot be saved without a product.
And the resulting behaviour is the one the plan already specified — §22.1b's *"hide the hotspot if the
product reference is invalid"* and §8.1d's neutral media placeholder both describe a reference that
has gone empty, a state a `NOT NULL` column could never produce. Verified: a product used by a hotspot
now deletes, the hotspot row survives, and its reference is empty. 14 columns, one migration.

**Fourth: a custom `validate` silently replaces Payload's built-in one, and with it `required`.**
`sanitize.js` installs the default validator only `if (typeof field.validate === 'undefined')`. Two
fields returned `true` for an absent value while being `required`: every money field, and
`addresses.country`. Neither was enforced by Payload, so a missing price or country passed validation
and failed on the `NOT NULL` column instead — a database error where a named field error belonged.
Both now consult the `required` option, as `slugField` already did. The six other fields with custom
validators were checked and all happen to reject empty values already.

**And four smaller ones**, each real:

- **A promotion could be saved with no value.** `admin.condition` decides what is *rendered*; it does
  not tie `percentage` to `type: 'percentage'`. A code with a null discount would have reached Phase
  15's calculation layer. Each value field now validates against its sibling type.
- **Stock accepted fractional values.** `min` is a bound and `admin.step` is an input attribute;
  neither makes a number an integer, and the `CHECK` only stops negatives — `0.5 >= 0` is true. A
  count of garments is now validated as one.
- **The seed's `upsert` could not see soft-deleted rows, but the UNIQUE index could.** A product an
  editor had trashed was invisible to the lookup and still occupied its slug, so the second run tried
  to *create* it and aborted. `find` now includes trashed rows and the update un-trashes them, which
  also makes a re-seed restore the demo catalogue rather than colliding with its own ghosts.
- **Both scripts guarded the wrong thing.** `appEnv !== 'local'` cannot see a connection string: it is
  derived from `VERCEL_ENV`/`NODE_ENV`, none of which the Payload CLI sets, so it reads `local` on a
  laptop pointed at production. The guard is now decision **D-10**'s — `DATABASE_PUSH_TARGET` must name
  the database `DATABASE_URL` actually reaches. That check had to be lifted out of `schemaPush`, which
  also requires `NODE_ENV === 'development'` and is therefore never satisfied under the CLI;
  `developmentDatabase` in `lib/env.core.ts` is the identity comparison alone. `baseline-migrations`
  additionally checks its arguments against the migration index, because a row naming no real
  migration is invisible to `migrate` and breaks `migrate:down` for its whole batch.

**Documentation errors, all found by checking claims against the code**, in the same class as the
Phase 4 audit's: the table count was 74 and is 73; `products` accounts for four tables, not six;
`docs/DATABASE.md` listed `reviews` as soft-deleted when it is not (and two cascades carried a
matching `includeTrashed` that meant nothing); `G-02` was the one gap row left un-struck inside an
otherwise uniform edit; `Products.ts` documented a derived field named `inStock` that the same file
rejects 370 lines later; `OrderItems.ts` cited `Orders.afterDelete` for a cascade this very phase
established can only work on `beforeDelete`; `ProductVariants.ts` cited a §8 heading this commit
renamed from "five traps" to six; both the config and `STACK_VERSIONS.md` listed tables among
Payload's default Lexical features, which they are not; §1.11.3's "longest identifier is 58" was true
of the block tables it described and not of the schema, where it is 59; and `money.ts` put the
safe-integer ceiling an order of magnitude too low.

**What the audit did *not* find** is worth recording too. No online-only violation. No field from
plan §6.1a–o missing. No place where an order's snapshot can change after the fact. No path by which
the browser becomes authoritative for a price or a total. No secret anywhere it should not be. The
eight refuted claims were mostly assertions about Payload's API that the installed source contradicts
— which is why the verifier's instruction to check `node_modules` rather than memory is the part of
this method that earns its cost.

**Re-verified after the fixes**: 13 targeted checks against the live database, all passing, including
both context-leak scenarios and the hotspot delete. The seed re-runs clean. `pnpm typecheck`,
`pnpm lint --max-warnings 0` and `pnpm build` all pass.
---

## 1.12 Phase 7 — access control and authentication

Twenty-three collections and two globals went from Payload's default — *"is there a session?"* — to a
stated rule each, three roles arrived, and the six authentication flows §7.1e names were built. **No
dependency was added.** Authorisation is Payload's own access layer, the forms are React 19 Server
Actions and `useActionState`, and the validation is the Zod that Phase 4 already installed.

### 1.12.1 The shape of the answer, and why it is three layers

Plan §7.1e's prompt asks to *"protect account and admin routes at both route and data-access levels"*.
That reads like two layers. It is three, and only two of them are checks.

| Layer | Where | What it decides | What it cannot do |
|---|---|---|---|
| `src/proxy.ts` | Next 16's renamed `middleware` | redirect a visitor with no session cookie away from `/account` before rendering starts | verify the cookie — no signature check, no expiry, no revocation |
| `src/lib/auth/session.ts` | `requireCustomer()`, memoised with React `cache()` | what a *route* does: render, redirect, or 404 | protect anything that does not call it |
| `src/payload/access/` | every collection and global | what a *query* returns, for every caller including the REST API | know what page it is on |

**The proxy is deliberately weak.** Verifying the cookie there would put Payload and a Postgres round
trip in front of every matched request, which is the cost a proxy exists to avoid. Next's own
authentication guide calls this an "optimistic check" and says the same thing: *"it should not be your
only line of defense"*. Its proxy documentation adds the sharper warning, which is new in Next 16 and
worth quoting because it is easy to get wrong — a Server Function is a POST to *the route it is used
on*, so **a matcher change can silently remove proxy coverage from a mutation**. Nothing in
`lib/auth/actions.ts` relies on the proxy; every action re-derives the caller from the cookie itself.

**The route check is in the pages, not the layout**, and that is the non-obvious half. A layout in the
App Router does **not** re-render on navigation within its own segment: it renders once and children
swap beneath it. A guard placed in `account/layout.tsx` would run on the first load of `/account` and
then never again as the customer moved to `/account/orders` — which is the difference between a guard
and a decoration. Next's guide says it outright: *"you should fetch the user data in the layout and do
the auth check in your Data Access Layer"*. Recorded as **D-23**.

**`middleware.ts` is deprecated in Next 16** and renamed `proxy.ts`; the export must be `proxy` or the
default. Read from `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`
rather than assumed, per this repository's standing rule about this version of Next.

### 1.12.2 Roles: two in a column, one in a collection

§7.1a names Customer, Editor and Admin, which reads like one table with a `role` column. It is not,
and Phase 6 had already decided why (**D-21**): a customer is a row in `customers`, a separate auth
collection, so *"customers may NOT access Payload Admin"* (§7.1b) is a property of the topology rather
than of a rule that has to stay right forever. Payload settles it in `getAccessResults` before any
rule of ours runs — `canAccessAdmin` is `false` for any user whose collection is not `admin.user`.
Measured, not assumed: a real customer token resolves to `canAccessAdmin !== true`, a staff token to
`true`.

So `users.role` carries the two staff roles, `editor` and `admin`, and the asymmetry is the point.

**The escalation boundary is field access, not collection access.** An editor may already update their
own row — that is how a password gets changed — so without a rule on the field itself,
`PATCH /api/users/<own id>` with `{"role":"admin"}` is a one-line privilege escalation. Payload
enforces field access by *deleting* the key from the incoming data and falling back to the stored
value, so the request succeeds and the role does not move. Verified: an editor's self-promotion
returns a document still reading `editor`.

**The bootstrap problem, and the two answers it needed.** `role` defaults to `editor`, which is the
right default and the wrong answer twice:

- *On an empty database*, `create-first-user` posts no role, so the founding account would default to
  `editor` — and then nobody could ever grant anybody anything, because creating staff and editing
  `role` both require an admin who does not exist. A `beforeValidate` hook forces the first account to
  `admin`. It runs *after* field-level access (Payload evaluates field access inside the field
  `beforeValidate` pass, which precedes the collection one), so the assignment lands last and is not
  stripped.
- *On a database that already has staff*, the column default would demote every one of them at once.
  Before this migration there were no roles and every staff account had unrestricted CMS access, so
  `editor` does not preserve their permissions — it removes them. The migration ends with
  `UPDATE "users" SET "role" = 'admin';`, which is not a promotion but the truthful translation of the
  previous state into the new vocabulary. It is the third hand-edit a migration in this project is
  allowed, and `docs/DATABASE.md` §4 now states the bar for it. Proved on the throwaway database: a
  row inserted before the migration comes out `admin`, one inserted after comes out `editor`.

### 1.12.3 The access vocabulary, and the two things a rule cannot do

Every collection's `access` block reads as named rules from `src/payload/access/` — `publishedOnly`,
`ownedByCustomer('customer')`, `isStaff`, `isAdmin`, `nobody`. The reason is auditability rather than
brevity: "who may read an order" has one answer, and the failure mode of inline closures is not that
one is wrong on the day it is written, it is that the twenty-third differs subtly from the first and
nobody notices for a year. Recorded as **D-22**.

**Ownership rules return a `Where`, not `false`, and that is a security property.** A cross-account
read of somebody else's order is not a 403 that confirms the order exists — it is an empty result,
which confirms nothing. Payload applies the same constraint to `update` and `delete`, so the whole
class of attack answers "not found" rather than "forbidden".

Two things a rule genuinely cannot do, both handled beside it:

1. **A rule cannot say whose a *new* row is.** `POST /api/addresses` with `{ customer: <someone
   else> }` passes any rule that only asks "is this an active customer", and writes into their address
   book. Field access is no help either: denying `create` on the `customer` field *removes* it, and the
   column is `required`, so the write would fail for every customer rather than only the dishonest one.
   `hooks/enforceCustomerOwnership.ts` therefore **forces** the value, on create and on update alike —
   reassigning an existing row is the same attack a second later. Verified for addresses and wishlist
   rows: a create naming another customer comes back owned by its creator.
2. **A rule cannot protect one field of an otherwise-permitted write.** `customers.accountStatus`,
   `users.role`, `reviews.status`, `reviews.verifiedPurchase` and the Commerce tab of Site Settings are
   all field-level. Verified: a customer cannot re-enable their own disabled account, and a review
   created through the API lands `pending` and unverified whatever the request body says.

**The rule with no precedent here, so the one most worth proving:** a product variant carries no
status of its own and is public exactly when its product is —
`publishedOn('product.status')`, a `Where` across the relationship that Payload's Postgres adapter
resolves to a join. If that had not worked, the collection holding every SKU, price and live stock
count would have been readable while `products` was correctly filtered: next season's line sheet,
without the products. Measured both ways — a draft product's variants are invisible, and publishing it
makes them visible.

**Carts are readable by their owner and not writable by them**, which looks inconsistent with the
wishlist and the address book until you read §7.1b: it grants a customer write access to exactly two
things, and a cart is neither. Every mutation of a bag has consequences the browser must not be
trusted with — quantity bounded by live stock and `maxQuantityPerLine`, the variant still existing and
still purchasable, the attached promotion revalidated — and **Phase 14** does all of that in server
code through the Local API. Opening `PATCH /api/carts` would be a second, unvalidated door onto the
same table.

**`orders.create` is `nobody`, and that includes admins.** An order is not authored; it is the record
of something that happened. Phase 17 writes it from the checkout and finalises it from a
signature-verified webhook, both in server code past access control. What `nobody` forbids is
`POST /api/orders` — a request that could only ever be somebody inventing a purchase.

**Promotions are staff-only including read.** An open `GET /api/promotions` hands over every
unreleased code and threshold; the storefront never reads the collection, because §15.1c requires a
code to be validated server-side against the real cart at the moment it is applied.

### 1.12.4 The password-reset flow, and the honest way to build it without email

§7.1e requires forgot-password and reset-password. §19 owns Resend. That gap is where the interesting
decision was.

Payload's unconfigured default, `consoleEmailAdapter`, logs *"Email attempted without being
configured. To: …, Subject: …"* and discards the body. For a reset mail **the body is the token**, so
the default would issue a valid single-use credential and destroy the only copy of it — a form that
submits, confirms, and cannot be completed by anyone. That is plan §0.1.17's fake functionality in a
very convincing costume.

So `payload/email/logEmailAdapter.ts` logs the whole message and the flow is genuinely end-to-end in
development: submit, read the link out of the server log, choose a new password. Everything except
delivery is real — a 40-hex-character token, a one-hour expiry, single use, a storefront reset route —
and the adapter logs at **`error`** on every send outside local development, because a deployed
storefront whose resets land in a log file is broken and should say so rather than degrade quietly.
Recorded as **D-25**.

Three details that had to be got right:

- **The link must not be built from the request.** Payload's default points at
  `/admin/reset/<token>`, which for a customer is a route their session cannot even load. Overriding
  `generateEmailHTML` is straightforward; where the *origin* comes from is not. Deriving it from the
  `Host` header is textbook host-header injection, and password reset is its textbook victim: trigger
  a reset for someone else's address with a forged `Host`, and the mail in the victim's inbox carries
  a real token pointed at the attacker's server. The origin comes from `SITE_URL` via
  `config.serverURL`, which a request cannot steer. Payload's own `getRequestOrigin` reaches the same
  conclusion by a different route — it prefers `serverURL` and falls back to the request host only
  when that host is in the CORS/CSRF allowlist.
- **The token is not validated on page load.** Checking it on `GET` would let a link preview, a mail
  scanner or a corporate URL-rewriter burn a single-use token before the customer clicked. It is spent
  on submit, by the person choosing the password.
- **Resetting does not sign you in.** A reset is the one moment where the person holding the link
  might not be the account holder; handing out a seven-day session on the strength of an emailed token
  is how a mailbox compromise becomes an account compromise. They land on the sign-in form and use the
  password they just chose, which also confirms it works.

`resetPassword` writes through `payload.db.updateOne` and never reaches a collection hook, so it is
the one path the password policy hook cannot see — the action calls `checkPassword` directly, from the
same module, so the two cannot diverge.

### 1.12.5 A password policy, because Payload's is three characters

`fields/validations.password` defaults `minLength` to **3**, inside `generatePasswordSaltHash` where
no configuration reaches it. That is the floor this project's shopper accounts would have shipped
with.

`src/lib/password-policy.ts` sets twelve, with **no composition rules** — no required digit, symbol or
mixed case. That is a decision, not an omission: NIST SP 800-63B stopped recommending composition
rules because they measurably push people toward `Password1!` and away from length, which is the
property that resists guessing. The upper bound of 128 is not a security rule but a denial-of-service
one: hashing is deliberately slow, so an unbounded password field is unbounded server CPU anybody can
spend. The one content rule kept is that a password may not be the email address — the most
predictable choice a person makes, and the first thing an attacker who already has the address tries.

It is enforced by a **collection hook**, not only by the form, so the REST API, the admin panel and a
seed script are all held to it. The module has no imports at all, which is what lets the collection
reach it by relative path under tsx and the Zod schemas reach it by alias. Recorded as **D-24**.

### 1.12.6 The §7.1e edge-case list, one by one

All ten driven in a real browser against the dev server, and the security-relevant half again through
the Local API in `pnpm verify:access`.

| Edge case | Behaviour |
|---|---|
| Wrong password | *"That email and password do not match an account."* |
| Nonexistent email | The same sentence, deliberately. Anything else makes the login form an oracle for "does this person shop here" |
| Existing email during registration | **Named**, and this is the one deliberate exception — see below |
| Expired reset link | *"This link is no longer valid — it may have expired, or it may already have been used."* |
| Reused reset link | The same sentence, and correctly so: `resetPassword` clears the token on success, so the second use finds nothing, exactly as the sixty-first minute does. Proved by resetting, then re-submitting the same link |
| Expired session | The token carries a session id checked against the row on every request, so expiry, sign-out and disablement all resolve to "no viewer" and the account route redirects |
| Logs out from another tab | Proved with two tabs in one browser: signing out in tab A revokes the server-side session, and tab B's next navigation lands on `/login` |
| Account is disabled | Login refused with the generic message; live sessions emptied on the transition, so an open tab is signed out on its next request; and `activeCustomer` returns `null`, so every ownership rule fails closed even if a token somehow survived |
| Brute force | Payload's own five attempts / ten-minute lockout, stated explicitly rather than inherited. Proved: the sixth attempt returns *"Too many sign-in attempts…"* |
| OAuth | No buttons. §7.1e says so outright and it is the account system's instance of the standing rule against UI that looks functional and is not |

**On the duplicate-email exception.** Every other message here refuses to confirm whether an address
has an account. Registration cannot: telling somebody "that did not work" without saying why leaves
them stuck on a form with no way forward, and the address is one they typed themselves. The
privacy-preserving alternative — accept silently, send a mail explaining an account already exists —
needs a transport, which is Phase 19. The exposure is also narrower than it looks: a registration form
leaks membership one address at a time at the cost of a round trip, and **Phase 26**'s Turnstile is
what puts a price on doing it at scale. The forgot-password flow, which is the one an attacker would
actually script, stays silent — and Payload agrees, its `forgotPassword` operation returning quietly
when no user matches with the comment *"we prefer to fail silently"*.

**The lockout is the second deliberate exception**, and the reasoning runs the other way. A lockout is
only reached after five failures against one address, at which point the attacker already knows the
address exists — telling them nothing new — while the legitimate customer who mistyped five times
needs to know that waiting is the answer and trying again is not.

### 1.12.7 Two defects found by running it, not by reading it

**React resets an uncontrolled form once its action resolves.** The forms were written on the
assumption that uncontrolled inputs keep whatever the customer typed — React re-renders the same DOM
nodes with no `value` prop, so the browser's own contents survive. They do not. Measured in a browser:
after a rejected registration, `firstName`, `lastName` and `email` all came back **empty**, while the
one field that had just been re-typed kept its value. A failed sign-in emptied the email box.

The only thing React resets *to* is the rendered `defaultValue`, so the action now echoes back what
was submitted and the fields read it. The password is deliberately not echoed: it would put the
plaintext in the RSC payload and in any log that captured the response, to save a customer one field
that a password manager refills for free. The comment in `login-form.tsx` that asserted the opposite
is corrected in place rather than deleted, because the wrong assumption is the interesting part.

**The first version of `verify-access.ts` could not fail.** Its `denied()` helper treated *any* thrown
error as a passing access check — so a fixture with one wrong field name would have thrown
`ValidationError`, been counted as a refusal, and reported a clean run while proving nothing. It now
names the errors it will accept (`Forbidden` and `NotFound` by default), and the run that caught this
also caught a check on the admin-panel boundary asserting `canAccessAdmin === false` where the
sanitised value is `undefined`, and a "disabling revokes sessions" check that passed against an
account which had never signed in. All three are fixed, and the file is 43 checks rather than 33.

### 1.12.8 What was verified, and how

- **`pnpm verify:access` — 43/43** (45/45 from Phase 9, which added two role-bootstrap assertions —
  see §1.14.12). Cross-customer reads of orders, addresses, carts, wishlists and
  profiles; ownership forcing; role escalation; an admin's self-delete; `orders.create` refused to
  everyone; review moderation state; the variant/product publication join; disabled accounts; session
  revocation; the password policy; and both directions of the admin-panel boundary through real
  tokens. It creates its own fixtures and removes them, and refuses to run against anything but the
  database `DATABASE_PUSH_TARGET` names.
- **Browser, dev server — 18/18 and 7/7.** Registration, sign-in, sign-out, the return-path round
  trip, duplicate email, the session cookie's own attributes (`HttpOnly`, `SameSite=Lax`, seven days),
  the full reset round trip using a token read from the log, reuse of that link, the old password
  ceasing to work, and the lockout.
- **Browser, sessions and accessibility — 11/11.** Two tabs sharing and losing a session together, a
  disabled account signed out of an open tab, and **0 axe-core violations** on all six new routes at
  WCAG 2.0/2.1/2.2 A + AA.
- **Browser, production build — 6/6.** Tab order (`NORTH / 01` → email → password → submit → the two
  links), a visible 2px focus outline, and the axe sweep again with Next's dev overlay out of the way.
- **Browser, admin panel as an editor — 5/5.** Sign-in works; Users is absent from the sidebar and
  answers *"Nothing found"* when typed directly; the Commerce fields render read-only.
- **The migration** applied, rolled back and re-applied on a throwaway database created beside the
  development one, and the resulting schema dumped and diffed against the pushed development schema:
  **identical**, byte for byte, across every column, index and constraint.

**One axe result worth writing down, because it is not a defect and will look like one again.**
Scanning `/account` in the instant a Server Action redirect lands reports `document-title` (WCAG
2.4.2, Level A). The page's title is correct before and after — measured directly, `"Your account ·
NORTH / 01"` on a document load and after the transition settles — but during an RSC client
transition React removes the old `<title>` before inserting the new one, and a scan fired on
`waitForURL` can catch the gap. Phase 27's suite should settle the navigation before scanning, or it
will chase this. Recorded here rather than "fixed", because the fix would be a workaround for
somebody else's frame.

Playwright and axe-core were used as **tools, not dependencies**, from the scratchpad — the same
treatment as Phase 3 (§1.8.7), because both are Phase 27 packages and plan §2.1b forbids installing a
later phase's packages early. `package.json` gained one script and no dependency.

### 1.12.9 Choices that follow the plan rather than depart from it

- **No change-password screen.** §7.1e lists the flows Phase 7 owns and a signed-in password change is
  not among them; §20.1d gives `/account/settings` to Phase 20. The *permission* exists today — a
  customer may update their own row and the policy hook applies — so Phase 20 adds a screen, not a
  rule. A first implementation was written and removed: verifying the current password by attempting a
  login mints a second session row and can lock the account out on a typo, and neither is a decision
  Phase 7 should make on Phase 20's behalf.
- **`/account` shows a profile and a sign-out, and links to nothing.** §7.1e owes a *protected route*;
  §20.1d owns the five account screens. Linking to `/account/orders` before it exists is the same lie
  as a button that does nothing, and "coming soon" is that lie with an apology attached.
- **`customers.create` is open to anyone.** It looks alarming and is not: registration has to be
  reachable without a session, and the alternative — closing it and registering through a server
  action with `overrideAccess: true` — would mean the storefront and the REST API are governed by two
  different rules, one of them a function nobody can audit from the collection file. Everything
  privileged on the row is closed at the field level instead, so a self-registration cannot arrive
  pre-enabled and there is no role column here to escalate.
- **`newsletter-subscribers.create` stays closed.** Signing up is a public action and `create: anyone`
  is the obvious move, but there is no form yet (§10.1a) and the double-opt-in question is §19.1b's.
  An open, unrated write endpoint for email addresses with no form in front of it is a spam sink with
  no product behind it.
- **The session cookie is `Secure` outside local development.** Payload's default is `false`, which
  lets a seven-day customer session travel over plain HTTP. It is set in `payload.config.ts` rather
  than in the two collection files, because that module is the only one in `src/payload/**` allowed to
  read the environment — widening the **D-14** ESLint exemption to the collections directory to set
  one boolean would trade a real security property for a small convenience.
- **`SameSite=Lax` is kept**, which is what stops a cross-site form POST riding the cookie. It matters
  because the `/api` REST surface is reachable from anywhere.

### 1.12.10 What is now owed

- **A rate limit on registration, login and password reset.** Payload 3 removed its built-in one. The
  per-account lockout covers a *known* address; per-IP throttling and Turnstile are **Phase 26**
  (§26.1b), and until then the honest statement is that these endpoints are unrated.
- **`config.csrf`.** Payload's cookie extraction validates the `Origin` header against a CSRF
  allowlist when one is configured, and falls back to `Sec-Fetch-Site` when it is not. Setting it
  would tighten the REST surface; it is not set here because a wrong value breaks the admin panel on
  every alias a deployment answers on, and no deployment exists yet to enumerate. **Phase 26**, with
  Phase 33's domain settled.
- **PBKDF2 at 25 000 iterations** is Payload's, not configurable through the config, and is below
  OWASP's current guidance for PBKDF2-SHA256. Noted rather than acted on: changing it means replacing
  Payload's local strategy. Worth revisiting in the **Phase 34** security audit.
- **Email verification, and the transactional templates.** **Phase 19**. `logEmailAdapter` is replaced
  then, and `resetPasswordEmail` re-styled alongside the rest of the set — what must not change is the
  route and the query parameter the reset page reads.
- **`/account/orders`, `/account/wishlist`, `/account/addresses`, `/account/settings`.** **Phase 20**,
  with the account navigation between them.
- **Whether a review author may edit or withdraw their own review.** **Phase 21** (§21.1a). Today
  `update` and `delete` on `reviews` are staff-only, which is the conservative half.

### 1.12.11 Confirmation sweep of earlier deviations

Step 4 of the append rule.

- **DEV-21 — Oxide is the signal colour. Confirmed and now load-bearing.** Every form error in the
  auth flows renders in it, paired with an icon so colour is never the sole carrier (WCAG 1.4.1).
- **DEV-25 — the newsletter column deferred to Phase 19. Still pending and now touched:**
  `newsletter-subscribers.create` was considered for opening here and deliberately left closed. Same
  phase, same reason.
- **DEV-24 — Motion deferred to Phase 10. Untouched.** These forms animate nothing; the busy state is
  the Phase 3 button's spinner.
- **DEV-04 — no GraphQL surface. Confirmed.** The access rules govern REST and the Local API, and
  there is still no third paradigm to keep them in step with.
- **DEV-16 — route-group topology. Confirmed, and extended one level down.** `(auth)` is a nested
  group inside `(frontend)`; it adds no URL segment and buys one layout for the four routes. The two
  root layouts are untouched, so **D-08** holds.
- **DEV-14 — substantial work uses feature branches. Confirmed.** Phase 7 ran on
  `phase-7-access-control-and-auth`.
- **DEV-27 — a review requires a customer. Confirmed and now enforced at both ends:** the column is
  `required`, and `enforceCustomerOwnership` makes the value the author's own rather than whichever id
  the request named.
- **DEV-06 / D-07 — no card data. Untouched and still true.** Nothing in this phase stores or reads a
  payment credential.
- **DEV-10 — schema additions Phase 6 does not list. Discharged in Phase 6, and this phase adds two
  more with the same discipline:** `users.role` and `customers.accountStatus` are both named by
  §7.1a and §7.1e, both generated as a migration, both documented in `docs/DATABASE.md`.
- **DEV-17 — schema push disabled from the start. Still correctly withdrawn.** The local workflow was
  push for iteration, then `migrate:create`, then the throwaway-database check.
- **D-19 — Phase 6 defines the entities the corpus names, and no more. Confirmed by what was *not*
  added:** no session-audit table, no login-attempt log, no password-history table. Payload's own
  `sessions` array and `loginAttempts`/`lockUntil` columns answer everything §7.1e asks.

---

## 1.13 Phase 8 — media and Cloudinary

Payload holds the metadata, Cloudinary holds the bytes and performs every transformation, and the
storefront gets one component. Two dependencies added — `@payloadcms/plugin-cloud-storage@3.88.0` and
`cloudinary@2.10.1` — and one **removed from the plan**: `sharp`, which two committed documents said
this phase would install.

**The phase is committed with no Cloudinary credentials**, at the project owner's direction, so the
degraded path is not a footnote here — it is the state everything below was verified in.

### 1.13.1 D-03 confirmed, in the phase that was told to confirm it

**DEV-05** ends *"To be confirmed in Phase 8"* and `docs/ARCHITECTURE.md`'s D-03 already read
*"Confirmed in Phase 8"* — a forward-tense marker asserting a check nobody had made. Both are now
honest, and the check was made against the registry rather than from memory:

| Package | Result |
|---|---|
| `@payloadcms/storage-cloudinary` | **`ERR_PNPM_FETCH_404`** |
| `@payloadcms/storage-s3`, `-vercel-blob`, `-azure`, `-gcs`, `-uploadthing` | all publish **3.88.0** |
| `@payloadcms/plugin-cloud-storage@3.88.0` | exists; peer `payload: "3.88.0"` **exact** |

Official adapters do ship at our exact version and Cloudinary simply is not one of them. The premise
holds, the "revisit if Payload ships an official adapter" clause has not triggered, and DEV-05 moves
from pending to confirmed.

### 1.13.2 The architecture, and the measurement that chose it

Two readings of §8.1a were available. Payload's `imageSizes` — how every official storage adapter works
— has `sharp` generate N derivatives at upload and the adapter upload each one. Or Cloudinary derives
every variant from one stored original, at delivery, from a URL.

The corpus points hard at the second: tech stack §3 gives Cloudinary *"delivery **and
transformations**"*, and the feature matrix says *"Cloudinary is media delivery; Payload stores media
metadata/relationships."* The measurements agree, and they are what made it cheap rather than merely
correct:

- **A delivery URL is pure string concatenation.** Verified in the SDK's own
  `generate_transformation_string` (`key + '_' + value`, sorted, joined) *and* against the live CDN with
  no credentials: every transformation this project needs returns 200 unsigned. So the browser-facing
  layer needs no SDK, no secret and no server round trip, and §8's *"Never expose Cloudinary server
  secrets to the browser"* becomes a property of the file's shape rather than a rule to keep obeying.
- **`f_auto` genuinely negotiates.** With a browser `Accept` header the CDN returned AVIF at 19.1 KB
  against 26.5 KB of JPEG for the same image.
- **The `imageSizes` route is expensive in schema, not just in uploads.** Each declared size costs six
  columns *and* a b-tree index (the size group inherits `index: true` through an object spread), and
  index names are silently truncated at **60 characters** — `media_sizes_<n>_sizes_<n>_filename_idx`
  overflows once a size name passes fourteen snake-cased characters. Eight contexts would have been 48
  columns, eight indexes and nine uploads per asset, all to reproduce something Cloudinary does for
  nothing. And it freezes the breakpoints into stored rows.

Recorded as **D-26**. The `media` table still has no `sizes_*` columns and now never will.

### 1.13.3 Three defects found by measuring, all of which would have shipped

Every one of these was written, believed, and then contradicted by a real HTTP response.

**1. `c_lfill` silently abandons the aspect ratio.** It is Cloudinary's documented "fill but do not
enlarge" mode and it looks like exactly the safe option. From an 864 × 576 source:

| asked for | delivered |
|---|---|
| `c_fill,ar_4:5,w_400` | 400 × 500 — correct |
| `c_fill,ar_4:5,w_2000` | **2000 × 2500** — upscaled, 302 KB of soft pixels |
| `c_lfill,ar_4:5,w_2000` | **864 × 576** — *the ratio is gone* |

A box reserved at 4:5 receiving a 3:2 image is precisely the layout shift §8.1d and §30.1b forbid,
arriving through the option chosen to prevent it. Neither mode is used blind; the width is clamped in
our code and plain `c_fill` then always holds its contract.

**2. Clamping to the source width is not enough.** The first clamp did that and a delivered image
caught it: the same landscape asked for the 4:5 mobile hero at its own width returned **864 × 1080** —
inside the width budget and nearly double the source *height*. When a crop changes the ratio the
binding constraint moves. `c_fill` cuts the largest region of ratio `R` that fits and then scales it, so
the largest output width that never enlarges anything is `min(W, H·R)` — 460 for that source at 4:5, not
864. The test that missed it only asserted the width; it now asserts both axes.

**3. `fl_relative` multiplies rather than addresses.** Payload stores a focal point as two 0–100
percentages and Cloudinary's `x_`/`y_` want pixels, so the obvious bridge is the flag that says
"relative". It is not a bridge. `c_fill,ar_4:5,w_400,g_xy_center,x_0.2,y_0.8,fl_relative` returns
`400 Maximum image width/height is 65500. Requested 345600x432000` — the values multiply the source
dimensions. `fl_region_relative` fails identically. Plain pixel coordinates, converted here against the
stored dimensions, return 200.

**And a fourth, found in a browser rather than over HTTP.** The art-directed *placeholder* did not
change shape at the breakpoint: `<picture>` correctly served the 4:5 crop below 768px while the reserved
frame stayed 16:9, so the mobile hero was letterboxed into a landscape hole. It mattered more than it
looks — with no assets in the catalogue the placeholder is the *only* path that renders, so the bug was
in the one state the site is actually in. The ratio now travels as a custom property switched by a
`max-md:` utility, which is also why the breakpoint is a literal rather than a prop: Tailwind can only
generate a class it can see.

### 1.13.4 `sharp` is not installed — and this reverses two committed documents

`DEV-28` and `docs/STACK_VERSIONS.md` (in three places) both said Phase 8 would install it. A prediction
is not a requirement, and this project has withdrawn one before — DEV-17.

What was expected to need it does not:

- **Dimensions.** `getImageSize` falls back to a header-only byte probe (`image-dimensions` plus
  hand-rolled BMP/ICO/SVG/TIFF/JXL parsers) covering every format this collection accepts. §8.1a's
  "dimensions" and §8.1d's reserved box are both satisfied without it.
- **Admin thumbnails.** `adminThumbnail` as a *function* short-circuits before Payload looks for a
  stored derivative, so it needs neither `sharp` nor `imageSizes`.
- **Focal point.** Stored as `focalX`/`focalY` regardless, and consumed by our own URL builder as a
  Cloudinary gravity.

**The deciding argument runs the opposite way to the expected one.** Without `sharp`, Payload's crop UI
*renders and silently discards the crop* — the "UI that looks functional but silently does nothing" this
project forbids outright, and one of only two things `sharp` would have fixed. But installing it would
fix the silence and leave the tool wrong anyway: every delivered variant is re-derived from the
**original** through Cloudinary, so a crop stored in Payload is ignored by the thing that actually makes
the image. `crop: false` is therefore not a concession to a missing dependency — it is the only honest
setting once D-26 is taken, and with the tool switched off the dependency has nothing left to do.

Recorded as **D-27**. Worth noting for accuracy: `sharp@0.35.3` — the exact pin the docs named — is
*already* in the lockfile as an optional dependency of `next@16.3.2`, so this decision saves no download.
It saves a dependency the running code does not use, which is what §2.1b is about.

### 1.13.5 §8.1b, and the security finding that drives all of it

`checkFileRestrictions` has **two mutually exclusive branches**, and which one runs depends entirely on
whether `mimeTypes` is set.

- **Without it** — the state this collection was in since Phase 6 — there is *no content inspection at
  all*: a case-insensitive `endsWith` against a list of dangerous extensions, plus an equality test on
  the MIME type **the browser claimed**. Renaming a file defeats both.
- **With it**, `file-type` sniffs the buffer — and the restricted-executable list is skipped entirely.

So setting `mimeTypes` is the whole of §8.1b's *"Do not accept arbitrary executable files"*. Two
exclusions carry the rest, and both are about specific, known bypasses:

**SVG is excluded** because Payload's `validateSvg` has a hole. A file opening with an `<?xml …?>`
declaration is sniffed as `application/xml`, **relabelled** to `image/svg+xml`, and then skips validation
— the relabelling happens inside the branch the validator guards. Keeping SVG out of the allowlist is
what actually stops it: the relabelled type fails the allowlist test instead. Confirmed by running it —
the refusal reads `Invalid MIME type: application/xml`.

**GIF is excluded** because `file-type` reads magic bytes at **offset 0 only**. `GIF89a` followed by an
entire executable is detected as `image/gif` and would pass. Confirmed by building exactly that file:
the refusal reads `Invalid MIME type: image/gif`. Nothing in the corpus asks for GIF and motion has a
field of its own in `products.video`.

Two more findings shaped the rest:

- **A file-size limit without `abortOnLimit` is worse than none.** Busboy truncates the stream and
  carries on — the first N bytes are kept, a `truncated` flag is set, and Payload never reads it. The
  result would be a corrupt asset stored with a 201. Both are set, plus `responseOnLimit` so the editor
  gets a sentence rather than a status code. It is a root-config option, so it caps every upload
  collection this project will ever have.
- **There is no built-in maximum-dimension option at all.** `resizeOptions` only downscales, and only
  with `sharp`. §8.1b's "maximum dimensions" is therefore a `beforeValidate` hook, which works because
  `generateFileData` populates `width`/`height` earlier in the same operation. The cap is a
  decompression-bomb guard rather than a taste rule: a 30,000² PNG is a few hundred kilobytes on disk
  and ~3.6 GB of RGBA in memory.

`pasteURL` is switched **off**. It defaults to on, makes the browser fetch an arbitrary URL, and nothing
in the corpus asks for ingest-by-URL. It also closes a door that `disablePayloadAccessControl: true`
opens: that flag forces `skipSafeFetch: true` and is not overridable, so Payload's SSRF filter is
disabled on a path that no longer exists.

### 1.13.6 The numbers §8.1c does not give, and the one the repository already had

A sweep of all six documents for image dimensions and aspect ratios returns **nothing** — the only
numbers in the corpus are the type scale, the spacing scale and a 1px divider. Every ratio is this
project's decision.

The **widths** are not, and an earlier draft got that wrong by inventing those too. Plan §30.1a names the
breakpoints this design is built and tested at — 320, 375, 430, 768, 1024, 1280, 1440, 1920 — and every
width is one of those or a DPR multiple of one. A `srcset` whose candidates line up with the layout's own
breakpoints is the difference between a browser picking the intended file and one 40% too large.

Three corpus rules constrain the shape of the answer, and only three: §30.1b's *"Fixed/known image
aspect ratios"* (listed under **Layout shift prevention** — the same requirement §8.1d states from the
other end), visual guide §10's *"intentional mobile crops"*, and §07's *"Consistent product photography"*
beside *"Strong crop"*. Visual guide §08 and §09 sound relevant and are **not** used: each is scoped by
its own preamble to *"the photography language"* and *"composition only"*, and neither names a ratio, a
crop or a width. An adversarial pass caught exactly that over-reach in a draft.

Eight contexts, not §8.1c's six, and the two additions are both owed to something already written:

- **`productZoom`**, uncropped — §13.1a gives the PDP a zoom and a full-screen viewer, and zooming into
  the cropped gallery frame would magnify the crop rather than reveal what it removed.
- **`socialCard`**, 1200 × 630 — **the one image dimension the repository had already committed to**.
  `fields/seo.ts`, written in Phase 6, tells editors *"Social share card. Landscape, roughly 1200 ×
  630"*, so Phase 8 either honours it or makes a Phase 6 field description a lie. It delivers `f_jpg`
  rather than `f_auto`: a crawler sends no meaningful `Accept` header and several will not render AVIF.

**`editorial` crops nothing, and that is structural rather than aesthetic.** Phase 6 put shop-the-look
hotspots on lookbook images and recorded that their positions are *"percentages, so they survive every
crop and breakpoint"* (`Lookbooks.ts`). That guarantee holds only while the delivered image has the
framing the editor placed the hotspots on — a `c_fill` would move every hotspot off its garment.

### 1.13.7 "Media role" — a specification gap, and the reading that makes it a real column

The string *"Media role"* appears **once** in all six documents (plan §8.1a's bullet list) and nothing
anywhere says what a role is, enumerates values, or names a consumer. It is a gap of the same kind as
**G-01**–**G-14** and is recorded as one.

The reading taken is the only one that makes it worth a column: **a role names the delivery context an
asset defaults to.** An editor marks a campaign frame `campaign` and every consumer that does not care
gets hero framing; a consumer that does care passes a context and wins. `MediaImage` reads it on every
render.

The rejected reading is the more obvious one — a taxonomy label for organising the library. Nothing
would ever read it, and a column that exists only to be filled in is §0.1.17's fake functionality in
database form. If browsing by kind is wanted later it is a filter over this same column.

### 1.13.8 §8.1a's "transformation metadata where useful" — decided, not skipped

The bullet is hedged (*"where useful"*), and under D-26 the useful form is **not** stored derivative
rows. It is the eight context definitions in `lib/media/cloudinary-url.ts`: ratio, crop mode and width
ladder per context, in code, changeable without a migration and without re-uploading anything. Storing
them as data would be storing a decision that belongs to the layout, in a place the layout cannot see.

What *is* stored is what only Cloudinary knows and a URL cannot re-derive: the public id, the asset id,
the version and the resource type.

### 1.13.9 The degraded path, which is the committed state

`.env` has no Cloudinary keys, so `integrationStatus('cloudinary')` is `unconfigured` and this is what
was actually verified.

- **Uploads land on local disk** and Payload serves them from `/api/media/file/<filename>`. The plugin
  sets `disableLocalStorage: true` only when enabled, so nothing is switched off.
- **The storefront renders every image as its placeholder**, because the seeded catalogue has no assets
  — `scripts/seed.ts` deliberately creates none. §8.1d's placeholder is therefore not an edge case in
  this build; it is the normal path, which is why the specimen sheet leads with it.
- **The schema is identical either way.** This was the sharpest risk in the design and it needed a
  specific mechanism: the storage plugin injects a `prefix` column, and registering it conditionally
  would produce two schemas from one committed migration — the failure `docs/DATABASE.md` §6 has no
  recovery for. So the plugin is registered *unconditionally* with `enabled` carrying the distinction
  and `alwaysInsertFields: true` pinning the fields, and the folder is a module constant because it
  becomes that column's SQL `DEFAULT`. Verified: with Cloudinary unconfigured, the generated migration
  still emits `prefix varchar DEFAULT 'north01'`.
- **It is only correct locally, and now says so.** A serverless filesystem is ephemeral and often
  read-only, so a deployed environment with no Cloudinary loses every upload. §4.1b asks for a clear
  server-side warning on optional integrations and `reportEnvironment` previously warned only on
  `partial`. Phase 8 is where "its phase has not arrived" stops being true for Cloudinary, so it now
  warns whenever `appEnv` is not `local` and the group is unconfigured. It warns rather than throws:
  `ARCHITECTURE.md` §2 requires an unavailable optional service to degrade rather than stop the shop.

### 1.13.10 Guarding the SDK's hidden inputs

The `cloudinary` SDK reads `CLOUDINARY_URL`, `CLOUDINARY_ACCOUNT_URL` and `CLOUDINARY_API_PROXY`
straight out of `process.env` on its first `config()` call, merging them *underneath* explicit
configuration. `CLOUDINARY_URL` is the dangerous one — a single `cloudinary://<key>:<secret>@<cloud>`
string that supplies a write credential behind this project's deliberate three-variable scheme, and
throws inside the SDK at boot if malformed.

An allowlist cannot stop a library reading `process.env` directly, so `env.core.ts` **refuses all
three**: setting any one fails validation at startup with a message naming the three variables that
replace it. Two smaller SDK traps are handled at the call site: `analytics: false`, because the SDK
appends a `?_a=<token>` tracking parameter to every URL it builds and those would follow our assets into
every `img` tag; and `secure: true`, because its default is `http` and a mixed-content image is a
blocked image.

### 1.13.11 What was verified, and how

- **`pnpm verify:media` — 48/48.** The hostile-upload set (shell script named `.jpg`, `MZ` executable
  named `.png`, XML-prefixed SVG, HTML document, GIF/executable polyglot — all refused, each by the
  mechanism intended), the dimension cap, the mime allowlist's two exclusions, public-id derivation and
  hardening (traversal, comma injection, empty name), the clamp in every context, the reserved box in
  every context, and the degraded path. **Its fixtures are generated, not committed** — real PNGs
  written with Node's own `zlib` — for the reason `seed.ts` gives about placeholder binaries, plus one
  more: a repository should not carry several files that are executables wearing picture extensions.
- **Browser, against the specimen sheet — 15/15, and CLS 0.0000.** Layout shift measured with a
  `PerformanceObserver` rather than asserted. All three missing-image states occupy an identical box;
  the product-card frame is 4:5 to three decimals; art direction genuinely changes shape at 768px
  (1.778 → 0.800); no horizontal overflow at 320px; **0 axe-core violations** at WCAG 2.0/2.1/2.2 A+AA.
- **The URL builder against the live CDN — 25/25.** Every context, the clamp on both axes, the focal
  point, `f_auto` negotiating AVIF, the 120-byte LQIP, the social card, the video namespace, and the
  public-id hardening — all against `res.cloudinary.com/demo`, which needs no account.
- **The migration** applied, rolled back and re-applied on a throwaway database created beside the
  development one, then dumped and diffed against the pushed development schema: **identical**.

Playwright and axe-core were used as **tools, not dependencies**, from the scratchpad — the same
treatment as Phases 3 and 7 (§1.8.7), because both are Phase 27 packages.

### 1.13.12 What is now owed

- ~~**The live Cloudinary round trip.**~~ **Discharged the same day — see §1.13.14.** Credentials arrived
  after the phase was committed, `pnpm verify:media` armed its second half automatically, and everything
  passed including the *Strict transformations* check that could not be predicted from here.
- **Assets uploaded before credentials arrive do not migrate themselves.** Any file on local disk keeps
  its `/api/media/file/…` URL and gains no `cloudinaryPublicId`. There are none today and the seed
  creates none, so the practical exposure is zero — but if any exist when Cloudinary is switched on they
  must be re-uploaded. No phase has claimed a backfill.
- **A Cloudinary/`media` reconciliation sweep.** The storage plugin's `afterDelete` swallows errors, so a
  failed remote delete orphans the asset silently. That is the right trade — a delete already shown to a
  user should not be blocked by a third party being down — but the orphan is real and nothing reaps it.
- **Review photo uploads.** `Reviews.ts` defers *"upload limits and mime restrictions"* to Phase 8, and
  those now exist. What Phase 8 does **not** answer is who may create a media record: `create` is
  staff-only, so a review author cannot attach a photo. That is **Phase 21**'s to decide along with the
  moderation flow, and it is sharpened by **D-28** — media bytes are public the moment they are
  uploaded, so an unmoderated review photo would be publicly fetchable before anyone had seen it.
- **A Content-Security-Policy naming `res.cloudinary.com` as an image source.** There is no CSP in the
  repository at all; **Phase 26** owns it.
- **`next.config.mjs` still has no `images` block**, and correctly so — **D-29** means Next never fetches
  an image, so `remotePatterns` would configure a code path that does not run. The file's own comment
  nominating "the phases that introduce them" is satisfied by *not* adding it.

### 1.13.14 The live round trip, run after the phase was committed

Credentials arrived shortly after the commit, which is exactly the sequence `verify-media.ts` was built
for: its second half arms itself on `integrationStatus('cloudinary') === 'configured'` and needs no
edit. **61/61**, up from the 48 provable without an account.

What the thirteen live checks establish, none of which could be reasoned about from here:

| Check | Result |
|---|---|
| **Strict transformations is off** | three contexts derived on the fly, `200 image/webp` |
| The upload reaches Cloudinary and stores its public id | `north01/landscape` |
| §8.1a's *Asset ID* and version are returned and stored | both present |
| `cloudinaryResourceType` comes from Cloudinary, not from a client MIME | `image` |
| `media.url` points at the CDN, not at this server | `https://res.cloudinary.com/…` |
| **Cloudinary's dimensions replace the local probe's** | 3000 × 1200 |
| Every `srcset` candidate a real record produces resolves | 3/3 |
| No candidate exceeds the source | `640w 768w 960w` |
| The LQIP is worth inlining | **83 bytes** |
| Deleting the record removes the asset | `404` |

Two of those are worth drawing out.

**The clamp is right on real data.** A 3000 × 1200 landscape in the 4:5 `productGallery` context clamps
to **960**, which is `floor(1200 × 0.8)` — the height-limited formula from §1.13.3, arrived at from a
synthetic 864 × 576 fixture, predicting the correct answer for a completely different asset. The widths
the component would emit are the widths that exist.

**`f_auto` chose WebP here, not AVIF.** The demo-cloud measurements returned AVIF; this account returns
WebP for the same request. That is the point of `f_auto` — the format is the CDN's decision against the
request's `Accept` header and the account's own settings, and both answers are correct. It is recorded
because a future reader comparing §1.13.2's AVIF numbers against a live response would otherwise think
something had regressed.

**One label was corrected while doing this**, in the same category as the Phase 7 harness defect: a check
named *"with Cloudinary unconfigured, an uploaded asset still has a usable URL"* had the assertion
`cloudinary !== 'configured' ? … : true`, so once credentials existed it passed vacuously under a name
that described the opposite situation. It now asserts the Cloudinary URL in the configured case and the
local one otherwise, and names whichever it is checking.

### 1.13.13 Confirmation sweep of earlier deviations

Step 4 of the append rule.

- **DEV-05 — the Cloudinary adapter path. CONFIRMED and closed.** Checked against the registry in the
  phase that was told to check it; see §1.13.1. `docs/ARCHITECTURE.md` D-03's premature *"Confirmed in
  Phase 8"* marker is corrected to say what was actually done.
- **DEV-28 — `media` created in Phase 6, not Phase 8. Confirmed, and its sharp clause withdrawn.** The
  early collection was exactly right: twenty-three upload fields across nine collections, five blocks and
  two globals needed a target, and Phase 8 filled the skeleton in without touching a foreign key. The
  entry's closing promise that *"`sharp` … Phase 8"* is superseded by **D-27**.
- **DEV-29 — SKUs are globally unique. Untouched, and relied upon indirectly:** Payload's `filename`
  uniqueness is what makes a derived Cloudinary `public_id` unique, so no upload silently overwrites
  another.
- **DEV-30 — currency and locale are this project's choice. Untouched.** No media decision depends on it.
- **DEV-24 — Motion deferred to Phase 10. Confirmed and now slightly load-bearing:** the LQIP fades in
  under the photograph with CSS alone, and visual guide §08's motion rules were explicitly ruled *out* of
  scope for delivery mechanics by an adversarial pass — they are photography art direction.
- **DEV-16 — route-group topology. Untouched.** Phase 8 added no route.
- **DEV-14 — substantial work uses feature branches. Confirmed.** Phase 8 ran on
  `phase-8-media-cloudinary`.
- **D-14 — the environment trust boundary. Respected, and tested by this phase.** `Media.ts` needed the
  cloud name and reached it through `env.public`, the browser-safe tier, rather than widening the ESLint
  fence around `env.core`. The API key and secret are read only in `payload.config.ts` and handed to the
  adapter as arguments — the same pattern Phase 7 used for the session cookie's `Secure` flag.
- **D-11 — the design system is enforced by the compiler. Confirmed:** the placeholder is built from
  `bg-surface` and `ring-border`, and Tailwind's default palette remains cleared, so there was no
  `bg-neutral-800` available to reach for.
- **D-19 — Phase 6 defines the entities the corpus names, and no more. Confirmed by absence:** no
  derivative table, no transformation log, no media-usage index. Six columns on one existing table.

---

## 1.14 Phase 9 — storefront shell

Plan §9.1a–§9.1d. The header, the mega menu, the mobile drawer, the footer, the search overlay and the
bag drawer — mounted, driven by Payload, and gated on one sentence:

> A user can open/close search, mobile menu, and cart from any major route without navigation state
> conflicts.

Phase 3 built the header and footer components and deliberately did not mount them, recording the
condition in its own docblocks: *"plan §9.1a mounts them once the search overlay, mega menu and cart
drawer behind their controls exist."* This phase built those three and discharged that.

**No dependency was added.** The mega menu is `radix-ui`'s NavigationMenu, which came with the
primitive set in Phase 3.

### 1.14.1 The two questions this phase had to answer before writing a component

**Where does a document live?** Plan §9.1a drives navigation from Payload, and `fields/link.ts` models
an item as a *reference* precisely so that renaming a document cannot break a link — *"the URL is
derived from this document at render time."* No document in the corpus says what that derivation is.
The structure document draws the browsing namespaces and never gives a path for a single product; it
has no `CAMPAIGN` node at all. That is a specification gap of exactly the kind §3.2 records, and it is
now **G-15**, closed by **D-30**: one route map, following the namespaces the structure document does
give.

The first version of that map had a seventh entry, `campaigns: null`, and left campaigns in
`LINKABLE_COLLECTIONS`. That combination is an **editor trap** — the admin panel offers a campaign as a
link target and the header then silently drops the item, because the renderer has no URL to build — and
it was removed the same day it was flagged. See **DEV-39** and §1.14.11.

**What does a broken link render as?** Feature matrix §1 lists *"missing navigation item"*,
*"unpublished collection"* and *"broken internal route"* as global-shell edge cases and does not say
what to do about them. The answer taken is **drop it**, and the alternative is worth naming because it
is the tempting one: rendering the item *disabled*. A disabled navigation item is a word in the header
that looks like a destination and is not one — plan §0.1.17's fake control with an apology attached.
A menu that is one item shorter is the only honest outcome, so an empty column, an empty mega menu and
an empty header are all states the components render without complaint, and `verify-shell.ts` asserts
each of them.

One consequence that had to be checked rather than assumed: **publication is re-tested at render.** The
shell reads through the Local API, whose default is `overrideAccess: true`, so `payload/access`'s
published-only narrowing does not apply and an unpublished target would populate happily. Scheduling is
included too — a future `publishedAt` hides an item — which is not a disagreement with the access rule
that excludes it, but the split that rule's own docblock describes: *"a query concern belonging to the
page that renders the listing."* A navigation menu is a listing.

### 1.14.2 One state machine, because the acceptance criterion is about state

§9's criterion and its prompt (*"verify that opening one overlay closes conflicting overlays"*) are
statements about state, not appearance. `components/shell/overlay-context.tsx` holds one variable that
names at most one overlay, so a second open overlay is **unrepresentable** rather than merely avoided,
and "open the cart" is the same operation as "close whatever else was open."

Three things follow that would each have been a separate bug:

- **The mega menu is in the machine, from the outside.** It is Radix's own uncontrolled state, but it
  is the only overlay in the shell with no focus trap — so it is the only one that could sit *behind*
  an open drawer. `DesktopNav` reads the context and collapses when anything in it opens.
- **Navigation closes everything.** `DrawerClose` handles the common path; the pathname comparison
  covers a link inside the search panel, a browser back button, and a `redirect()` from a server
  action.
- **Neither of those is an effect.** Both are React's *"adjusting state when a prop changes"* pattern —
  a comparison in the render body. An effect would repaint the new route with the stale drawer still
  over it before running, and this project's ESLint config rejects it outright: the React Compiler's
  `react-hooks/set-state-in-effect` rule failed the build on the first version of both.

### 1.14.3 The defect a browser found and a review would not have

**Radix's modal dialog restores focus to `Dialog.Trigger`, and these overlays have none.**

The search and bag controls are in the header; their dialogs are mounted beside the footer, outside
every route's subtree, because §9.1d requires them to work from every page. So there is no
`Dialog.Trigger` anywhere in the tree. `DialogContentModal`'s own `onCloseAutoFocus` unconditionally
calls `preventDefault()` and then focuses `context.triggerRef.current` — which is `null` — so **every
close dropped focus to `document.body`**.

That is a WCAG 2.4.3 failure, and nothing available would have caught it. The markup is correct. The
axe-core run is clean, because axe inspects a static tree and this is a transition. Only pressing
Escape in a real browser and asking what `document.activeElement` was showed it, and the mobile drawer
— which *does* use `DrawerTrigger` — behaved correctly throughout, so the two overlays that were broken
sat beside one that was not.

The fix is to own the restore rather than reshape the component tree around Radix's assumption: each
trigger registers the element it was activated on, and one shared handler always `preventDefault()`s —
which, through `composeEventHandlers`, also suppresses the internal handler that caused the problem —
and then focuses the registered control. The one case it deliberately skips is a handoff to another
overlay, where a restore would land inside a fresh focus trap and fight it.

### 1.14.4 What the mega menu is, and the two things §9.1b actually asks for

§9.1b is four words of layout and one instruction — **"Do not make it visually overwhelming."** Both
were failed by the first version and fixed against a screenshot:

- **Columns were equal fractions of the header width.** Two columns of three links each landed at the
  far ends of a 1440px bar with a void between them. That is "visually overwhelming" arriving through
  emptiness rather than through clutter. They are now a wrapping row of fixed-measure columns, packed
  from the left, which holds guide §06's *"strong alignment"* whether an editor writes one column or
  four.
- **The primary row sat against the top of the bar** while the wordmark sat on its centre line. Radix's
  `NavigationMenu.Root` renders `<nav>` → `<div style="position:relative">` → `<ul>`, and that
  intermediate div has no height, so the `h-full` chain the row relied on resolved against `auto`.
  Centring needs no height chain to survive, and it puts the current-page rule directly under the word
  rather than at the bottom of the bar — type rather than a tab.

**The trigger is a button, not a link**, on both desktop and mobile. §9.1c's *"no accidental navigation
while expanding"* is a statement about the relationship between a group and its landing page, and it
does not stop being true on a pointer device. SHOP opens the panel; **All Shop**, the first row inside
it, is the way to `/shop`.

### 1.14.5 Compact on scroll, measured rather than listened for

Structure §3 asks for *"sticky when appropriate, compact on scroll"*. It is an `IntersectionObserver`
watching a one-pixel sentinel in normal flow above the bar, not a scroll handler: the observer fires
**twice in a session** and costs nothing in between, where a scroll listener fires on every frame of
every scroll on every page and has to be throttled to be survivable.

The compaction is 72px to 56px and nothing else — no colour change, no shadow appearing, no shrinking
type — and it runs on the `--duration-base` token, so the single reduced-motion block in
`globals.css` collapses it to 1ms. A customer who asked for less motion gets the compact bar without
the animation, rather than a bar that never compacts.

### 1.14.6 Caching, and why an editor does not have to wait

The header and footer are in the storefront root layout, so their two `findGlobal` calls are on the
critical path of every page. **D-32**: `unstable_cache` under three tags with a 300-second floor, plus
an `afterChange` hook on both globals calling `revalidateTag`. Saving navigation in the admin panel
reaches the storefront on the next request.

Three details that were got wrong first and are now deliberate:

- **`revalidateTag(tag)` alone is deprecated in Next 16.** The two-argument form with `'max'` is
  current, and gives stale-while-revalidate — so an editor's save never puts a database read in a
  customer's critical path. `updateTag`, which expires immediately, is Server-Actions-only and the
  admin panel saves through a Route Handler.
- **The hook has to survive running outside Next.** `pnpm seed` writes both globals from a CLI process
  where there is no static generation store; `revalidateTag` throws *"Invariant: static generation
  store missing"*. `next/cache` is therefore imported **dynamically inside the try** — a static import
  would be evaluated whenever `payload.config.ts` loads, which is every CLI command and every
  migration — and a failure warns rather than throwing, because the write has already committed by the
  time an `afterChange` hook runs. Verified by running `pnpm seed`: the warning appears, the seed
  completes.
- **The failure path is not cached.** The `try` is around the *call*, not inside the cached function.
  A function that throws stores nothing, so a database blip degrades one request rather than pinning a
  degraded header in the data cache for five minutes.

### 1.14.7 What was verified, and how

`pnpm verify:shell` — **83 checks, all passing.** New script, same shape as `verify:access` and
`verify:media`, behind the same **D-10** database guard.

Its first half needs no database, which is why `lib/navigation/routes.ts` and `resolve.ts` import
nothing from Next and nothing from the server: the route map, the href boundary (`//evil.example`,
`/\evil.example` and `javascript:` are each refused), and every navigation edge case as a fixture.

Its second half does what a fixture cannot. It creates **real** `collections` documents in three
publication states, points real navigation links at them, then unpublishes one and deletes another and
re-reads both. That is what proves the resolver is being fed what it thinks it is — `publishedAt`
arriving as an ISO string, `status` living on the document rather than the relationship, a deleted
target arriving as `null` through `ON DELETE SET NULL` — which is the class of thing Phase 7's first
access harness got wrong by asserting against its own assumptions.

**49 browser checks** against the production build at 1440×900 and 390×844, covering the acceptance
criterion directly: search, the mobile menu and the bag opened and closed from `/`, `/login`, the
design-system route and a 404; the mega menu opened by hover and closed by Escape; the drawer group
expanded by tap without navigating; a link inside the drawer closing it; focus inside each overlay and
back on its trigger afterwards; the header compacting and un-compacting; and the drawer fully open
after 150ms under `prefers-reduced-motion`.

**0 axe-core violations** across five route and overlay states — home, home with the bag open, the
mobile drawer open, the 404, the design-system sheet and the login page — at WCAG 2.0/2.1/2.2 A and AA.

The visual review against the guide is §1.14.4 above; both findings were fixed and re-shot.

### 1.14.8 Things that would have been bugs

- **A second `<main>` on four routes.** Mounting the shell in the root layout means the layout owns
  `<main id="main-content">`; the auth layout, the account layout, the foundation page and the
  design-system sheet each declared their own, and two of them also drew a standalone wordmark that
  would have been a second link to the same place beside the header's. All four were stripped, and the
  contract is now written into `site-header.tsx` where the skip link lives.
- **The design-system sheet rendering the shell twice.** It composed `SiteHeader` and `SiteFooter`
  itself, which was right while they were unmounted and became a duplicate the moment they were not.
  Removing them made the sheet a *better* specimen: what a reviewer sees there is now the shipped
  shell, on the shipped data.
- **`lucide-react@1.x` ships no brand icons.** `Instagram`, `Youtube`, `Linkedin` and the rest were
  removed from the icon set, so the `Navigation` global's promise that social links are *"rendered as
  icons in the footer"* could not be kept — see **DEV-38**. Found by checking the export rather than by
  rendering an undefined component, which is what would have happened at the end of the phase.
- **Social links opening a new tab with no announcement.** `Link`'s `external` prop deliberately
  leaves the *"opens in a new tab"* wording to the caller, which is right where a human writes the
  label and wrong in a shell where every label is typed by an editor into a CMS field. A visually
  hidden `NewTabHint` now travels with every external link the shell renders (WCAG 3.2.5).
- **A three-deep `asChild` stack in the bag drawer.** `DrawerClose asChild` → `Button asChild` →
  `Link` is three Radix Slots, and Phase 3's audit found that stack is where `asChild` breaks quietly.
  Replaced by a click handler, which also covers the case a route change does not: navigating to the
  page you are already on.

### 1.14.9 What is now owed

- **The navigation points at routes that do not exist yet**, and will until Phases 11, 13, 22 and 23
  land. **D-31**'s global 404 makes that a styled page inside the shell with a way back, rather than
  Next's built-in blank. The visible residue is that Next prefetches those links — **41 prefetch 404s**
  on a home-page load — which is noise in a browser console and nothing else. It resolves itself as the
  phases land; nothing should paper over it with `prefetch={false}`, which would have to be undone.
- **`experimental.globalNotFound` is not a stable API.** **D-31** states the exposure and the exit: one
  file and one config key. **Phase 31** owns error, empty and loading states as a system and should
  absorb both halves of the 404.
- **The search overlay is chrome without contents** — **DEV-37**. Phase 12 replaces the body of
  `SearchPanel` and nothing else.
- **The bag drawer has an empty state and no other state** — Phase 14 fills the `Drawer` primitive's
  pinned `footer` slot, which was built in Phase 3 and is still empty on purpose.
- **Campaigns are not linkable and have no route** — **DEV-39**. Restoring them is one entry in
  `LINKABLE_COLLECTIONS`, one in `lib/navigation/routes.ts`, and a migration that puts the four
  `campaigns_id` columns back. All three belong to the phase that gives a campaign a page; doing any
  of them earlier re-creates the trap.
- **The newsletter column is still a slot** — **DEV-25**, unchanged, Phase 19.
- **A cart count badge on the bag trigger.** Deliberately absent: a badge reading "0" on every page is
  noise. Phase 14 adds it with the number behind it.
- **The mega menu's featured panel has never rendered an image**, because the seed creates no media
  (by design) and no editor has uploaded one. The code path is the same `MediaImage` every other
  surface uses and its placeholder branch is what renders today; the *image* branch is unexercised
  here specifically.


### 1.14.11 Campaigns removed from the linkable set, and what it took

Filed as **DEV-39**, and separated here from the rest of the phase because it is the one schema change
Phase 9 makes.

**The finding.** `campaigns` was in `LINKABLE_COLLECTIONS` and had a route of `null`. Both halves were
individually defensible and together they were a trap: an editor could point a navigation item at a
campaign, save it without complaint, and watch the item never appear. That is plan §0.1.17's fake
control expressed as a relationship field, and the fix is to remove the *choice*, not to make the
symptom prettier.

**The evidence that a campaign has no page**, gathered before touching anything, because the decision
turns on it:

| Source | What it says |
|---|---|
| Structure §2 — the site map, the only place URLs are drawn | **no `CAMPAIGN` node** |
| Feature matrix §3 — Homepage | *"Campaign hero"*, *"Editorial campaign"* — homepage sections |
| Feature matrix §12 — Collections | *"Scheduled/past campaign"* is an edge case a **collection page** handles |
| Feature matrix §25 — Admin | *"Campaigns"* among the things an editor manages |
| Plan §6.1g | fields only — and one of them is a **collection** the campaign points at |
| Plan, phases 1–36 | campaign appears in the entity list, the field list and Phase 28's admin prompt, and **nowhere else**; no phase builds a route |
| Visual guide §09 | page-level art direction for seven page types; a campaign is not one of them |

**The one line that cuts the other way**, recorded because the reading is not free: structure §4 path C
and §22's Journey E both draw *Home → Campaign → Lookbook → Shop the Look → Product*. Those are
*journeys*, in diagrams whose other steps include BAG and SHOP THE LOOK — an overlay and a component.
The site map is the document that assigns paths, and it has no campaign in it.

**Zero rows were affected, and that was measured rather than assumed.** Drizzle's push warning names
four tables and quotes row counts — *"about to delete campaigns_id column in collections_rels with 21
items"* — which counts rows in the **table**, not rows referencing a campaign. Queried directly:

```
campaigns_rels                 → rows referencing a campaign: 0
collections_rels               → rows referencing a campaign: 0
edits_rels                     → rows referencing a campaign: 0
navigation_rels                → rows referencing a campaign: 0
payload_locked_documents_rels  → rows referencing a campaign: 0
```

The fifth is not touched by the migration and should not be: it belongs to the `campaigns`
**collection** still existing and being editable, which is unchanged.

**The migration.** `20260828_060719_phase_9_defer_campaign_links` — four `DROP CONSTRAINT`, four
`DROP INDEX`, four `DROP COLUMN`, with the two hand-edits `docs/DATABASE.md` §4 requires (the parameter
trim and `DROP CONSTRAINT IF EXISTS`). Applied, rolled back and re-applied on the development database;
the `down` restores every column, constraint and index. The catalogue was re-seeded afterwards, because
the rollback reached far enough down the chain to remove the data-model tables.

**A workflow hazard, observed and not explained.** Twice in one chained shell command,
`pnpm migrate` printed nothing, applied nothing and exited **0** — confirmed by `migrate:status`,
which showed both migrations still pending; run alone immediately afterwards it applied them normally.
`pnpm seed` did the same once, piped through `tail`. The practical rule until someone reproduces it:
**run a Payload CLI script on its own, redirect its output to a file rather than piping it, and
confirm the effect rather than the exit code** — a `migrate` that prints no `Migrating:` line has
done nothing, and the `&&` after it will happily continue as though it had.

**And a second, sharper one about `migrate:down`.** This database's batch numbers were not monotonic
with file order — earlier phases had left them at 1, 2, 2, 3, 1, 1 — so a single `migrate:down` rolled
back a *batch* that spanned migrations older than others still applied. Phase 6's tables went, Phase 7's
and Phase 8's columns on those tables went with them, and rolling forward again replayed only the
rolled-back batch, leaving `customers` without `account_status` and `media` without every
`cloudinary_*` column while `migrate:status` reported a fully applied chain. Nothing was wrong with any
migration; the *ledger* was the problem. `pnpm migrate:fresh` was the repair — it replayed all seven in
file order and reset every batch to 1 — and it is also the strongest check the chain gets. **Read the
batch column before running `migrate:down`**, and prefer `migrate:fresh` on a development database
whose batches are not monotonic.

**What replaced the special case.** `verify-shell.ts` now asserts the invariant rather than the
instance: *every collection in `LINKABLE_COLLECTIONS` has a route.* That is the check that fails the
day someone adds a collection to one list and forgets the other — which is the general form of the bug
this entry is about. 83 checks, up from 76.


### 1.14.12 A Phase 7 harness defect, found by rebuilding the database

Not a Phase 9 defect, and recorded here because Phase 9 is what exposed it and fixed it.

Rebuilding the development database with `migrate:fresh` leaves `users` **empty**, and that is the one
state `verify-access.ts` could not survive. It created its fixtures in the order alice, mallory,
**editor**, admin — and `Users.ts` has a `beforeValidate` hook that forces the *first* account on an
empty database to `admin`, so that `/admin/create-first-user` produces someone who can administer.
The hook does not care which role the caller asked for.

So on a fresh database the **editor fixture was silently created as an admin**, and every
*"an editor cannot …"* assertion in the file was quietly testing an admin. That is bad enough as a
false negative. What made it worse is that one of those assertions deletes a product:

```
denied('an editor cannot delete a product', () => payload.delete({ id: draft.id, user: editorUser }))
```

The delete succeeded, the fixture product was destroyed, and the run crashed forty lines later on
`insert or update on table "reviews" violates foreign key constraint` — an error pointing at a review,
naming a product id, and saying nothing at all about roles.

**The fix is two lines and one assertion.** The admin fixture is created first, so the bootstrap
promotes the account that was going to be an admin anyway; and the editor fixture's role is then
*checked*, so the ordering is asserted rather than assumed:

```
PASS  the editor fixture is actually an editor — the first-account bootstrap did not promote it
PASS  the admin fixture is an admin
```

`pnpm verify:access` is now **45 checks**, up from 43.

It is the same lesson Phase 7 already recorded about this very file in §1.12.7 — *"the first
`verify-access.ts` counted any thrown error as a passing access check, so a fixture typo would have
reported a clean run while proving nothing"* — in a second form: **a fixture that is not what the
script thinks it is must fail loudly.** A harness that only works against a database someone has
already used is a harness that will mislead the first person to clone the repository.


### 1.14.13 Post-implementation audit

The committed shell re-read adversarially, with every claim tested against the running application
rather than against the comment describing it. Phases 3, 4 and 6 each did this and each found defects
that had passed every gate; this one found **four**, and the first is a security defect that was
demonstrated end to end.

#### Finding 1 — an open redirect in the sign-in flow

**One rule, copied into four files, wrong in all four.**

```ts
value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
```

That refuses an absolute URL and the protocol-relative `//host`, which is what it was written for. It
does not survive a control character: the WHATWG URL parser **removes** tab, line feed and carriage
return before parsing, so `"/\t/evil.example"` starts with a single slash in JavaScript and is
`//evil.example` by the time a browser resolves it. Measured in Chromium:

```
new URL('/\t/evil.example', 'https://north01.example/page')  →  https://evil.example/
```

The worst of the four sites was `safeReturnPath` in `lib/auth/session.ts` — **Phase 7 code** — which
guards the `?next=` parameter the login flow returns you to. Demonstrated against the running
application with a real customer and a real password:

```
/login?next=/%09/evil.example  →  sign in  →  http://evil.example/
```

A phishing link on the shop's own domain that hands the visitor to an attacker in the moment right
after they type their password, which is the exact failure `safeReturnPath`'s own docblock claimed to
prevent. The other three were `isInternalHref` (the shell), the CMS `href` validator, and the
announcement bar's — so an editor could also have put a header link on any domain, reading as an
internal path in the admin panel.

**Fixed** by `lib/same-site-path.ts`: one rule, no imports, reachable both by the `@/` alias and by a
relative path from a collection loaded outside Next — the same shape as `lib/password-policy.ts`, and
for the same reason. It **refuses** control characters rather than stripping them: a raw tab never
appears in a legitimate path, and stripping-then-rechecking would be one specification revision away
from being wrong again. Re-tested end to end — the same request now lands on `/account`.

The duplication is the actual lesson. Four copies of one security rule, three of them fixed and one
forgotten, is the failure the module now makes impossible.

#### Finding 2 — the route map answered for things that are not routes

`DOCUMENT_ROUTES` was an object literal, and `documentHref` takes a `string`, so the lookup walked
`Object.prototype`:

| `collection` | returned |
|---|---|
| `'toString'` | `'[object Undefined]'` — a string, so the link **rendered** |
| `'constructor'` | the slug, as a **relative** href resolved against the current page |
| `'isPrototypeOf'` | `false` — a boolean, from a function typed `string \| null` |
| `'__proto__'` | **threw** — and `getShell` catches, so the whole shell silently degrades |

Not reachable through the CMS today, because Payload constrains `relationTo`. It is still a function
whose contract is *"a path, or nothing"* returning three other things, and it is exported for Phases
11 and 13 to call with values from route params. **Fixed** with a `Map`, which has no prototype chain.

The same read found that a slug was interpolated into a path **unencoded**, so a stored
`../../admin` produced `/product/../../admin` — which a browser resolves to `/admin`. `slugField`'s
pattern makes that unreachable through the admin panel, and `encodeURIComponent` leaves every
conforming slug byte-identical, so the fix costs nothing and closes the path that never went through
that validator.

#### Finding 3 — the search and bag triggers announced nothing

Measured, against the mega menu as a control:

```
Search: aria-expanded=null   aria-haspopup=null    ← ours
Bag:    aria-expanded=null   aria-haspopup=null    ← ours
Shop:   aria-expanded=false                        ← Radix's NavigationMenu.Trigger
```

**This is the same root cause as the focus defect fixed during the phase itself** (§1.14.3), and only
half of it was fixed at the time. Bypassing `Dialog.Trigger` — because these triggers are in the
header and their dialogs are beside the footer — loses *both* the focus restoration *and* the trigger
ARIA. Having found the first, the phase did not go looking for the second.

A screen-reader user tabbing the header heard "Search, button" and "Bag, button": no indication that
either opens a dialog, no indication of state. **Two clean axe-core sweeps had already passed over this
markup** — `aria-haspopup` is an enhancement, not a violation.

**Fixed** with `overlayTriggerProps`, which supplies what `Dialog.Trigger` would have.
`aria-controls` is emitted **only while the panel is open**, because Radix unmounts the content on
close and a dangling `aria-controls` is itself an axe violation — a worse outcome than the omission.

#### Finding 4 — two navigation items at one URL shared a panel

`key={item.href}` and `value={item.href}` gave the href two jobs it cannot guarantee: React's
reconciliation key and Radix's identity for which panel is open. Nothing stops an editor pointing two
primary items at the same URL — "Shop" and "Store" both at `/shop` is ordinary — and the result was
duplicate keys **and** one shared open state, so hovering either opened both. The same collision
existed for columns sharing a heading, links sharing an href, and social entries sharing a URL.

**Fixed** with positional keys and values, which is the correct choice for a fixed CMS array with no
client-side insertion or reordering. Verified behaviourally rather than by inspection: two items were
written to the live `navigation` global through the REST API, and the result was
`SHOP=open STORE=closed` with only the first panel's content visible.

#### What was verified rather than assumed

Two claims this phase had *written down* and never tested:

**Editor saves reach the storefront.** An admin signed in through the REST API, changed the site
tagline, and the storefront was polled: read #1 served the old value, read #2 the new one. That is
exactly `revalidateTag(tag, 'max')`'s stale-while-revalidate contract, so the behaviour is correct —
but the README said *"on the next request"*, which is one request early. Corrected.

**The degraded shell.** `fallback.ts` and `getShell`'s catch had never run. Against an unreachable
database, all four failure modes were measured, and they layer:

| Scenario | Result |
|---|---|
| A statically prerendered route (`/`) | **200**, real CMS content, database never contacted — the prerender is a stronger guarantee than the fallback |
| A dynamic route rendering the shell (dev `/`) | **200**, fallback navigation, and the `[shell] Falling back…` line in the log |
| A dynamic route with its own data access (`/login`, `/account`) | **500** — correctly: the page has nothing true to show |
| `pnpm build` | **exit 1**, stopping on `/account` — a deploy against a broken database fails loudly rather than silently baking a fallback site |

The middle row is the one that had never been exercised, and it behaves as D-32 describes.

#### Coverage

`pnpm verify:shell` is **100 checks**, up from 83: the open-redirect vectors against both the shared
guard and the wired-up CMS validator, and the prototype-chain and slug-encoding cases, are permanent
regression tests. `verify:access` 45/45 and `verify:media` 61/61 unchanged, 49/49 browser checks,
**0 axe-core violations**.

### 1.14.10 Confirmation sweep of earlier deviations

Step 4 of the append rule.

- **DEV-01 — Essentials is a Collection, not an Edit. CONFIRMED and now exercised.** The seeded
  navigation puts Essentials under COLLECTIONS and keeps the Edit set at four, and Phase 9 is the first
  phase to *render* either. `verify-shell` asserts the resolved primary set is six items.
- **DEV-07 — six primary items including NEW. CONFIRMED and now exercised.** Rendered in a browser as
  **NEW · SHOP · COLLECTIONS · EDIT · LOOKBOOK · ABOUT**, and asserted both against the resolved data
  and against the DOM. Both DEV-01 and DEV-07 carried *"still to be exercised by Phase 9"* in §1.8's
  table; that clause is discharged.
- **C-07 — Journal in the footer, never the primary navigation. CONFIRMED**, in the seeded data, in
  the fallback, and by an assertion in `verify-shell`.
- **C-09 — wishlist is a header affordance routing to `/account/wishlist`. CONFIRMED**, and it is the
  one header link that still 404s; Phase 20 builds its target.
- **DEV-20 — the visual test surface is an in-app route. CONFIRMED and improved.** The sheet stopped
  mocking the shell and now sits inside it.
- **DEV-23 — Drawer is Radix Dialog. CONFIRMED, and this is the phase that consumed it** for the cart
  and the mobile navigation, exactly as its entry predicted. §1.14.3 is the one place the abstraction
  leaked, and the leak was in Radix's *Dialog* assumption rather than in the wrapper.
- **DEV-24 — Motion is not installed. CONFIRMED and re-argued.** The mega menu, the compact header and
  both overlays animate from Radix's `data-state` and the duration tokens (**D-13**). Nothing in this
  phase needed a spring.
- **DEV-25 — the newsletter column is deferred. CONFIRMED**, and the slot is still a slot.
- **DEV-22 — interactive control boundaries are Muted Stone. CONFIRMED**; the header utilities and the
  drawer controls inherit it through `IconButton`.
- **D-08 — the admin panel is insulated by topology. CONFIRMED, and tested by this phase.**
  `global-not-found.tsx` sits *beside* the two route groups rather than above them, so neither
  invariant is breached; the alternative — a catch-all route inside `(frontend)` — was rejected
  precisely because it would have competed with `/admin` and `/api`.
- **D-10 — the development-database guard. CONFIRMED.** `verify-shell.ts` creates and deletes real
  documents and refuses to run without it, the same as `seed`, `verify:access` and `verify:media`.
- **D-14 — the environment trust boundary. CONFIRMED and untouched.** Nothing in the shell reads the
  environment except `MediaImage`, which was already reaching the cloud name through the browser-safe
  tier.
- **D-29 — images are `<picture>`/`<img>`, not `next/image`. CONFIRMED**, including for the header
  logo: a fixed height against the context's reserved aspect ratio is what turns a component built for
  fluid editorial imagery into a fixed-height mark, so the bar cannot be pushed around by whatever an
  editor uploads.
- **DEV-14 — substantial work uses feature branches. CONFIRMED.** Phase 9 ran on
  `phase-9-storefront-shell`.

---

## 1.15 Phase 10 — homepage / editorial system

Plan §10.1a–§10.1d. A CMS-driven editorial commerce homepage: typed reorderable blocks, a campaign
hero, product rails, editorial sections, shop-the-look, and the performance rules that govern the
site's LCP route.

**No dependency was added.** Direct dependencies stay at 22. The one the phase was expected to add —
`motion`, deferred here by **DEV-24** — was measured and declined; see §1.15.5 and **DEV-40**.

### 1.15.1 The homepage is a global, and the split that makes its rules testable

There is exactly one homepage, so it is a **global** (`homepage`) holding one `blocks` field. A
collection would have needed a slug, a publish status, a rule deciding which row is live, and a route
resolver — four mechanisms to express a singleton. Feature matrix §25 is the only place the corpus
says where homepage content lives, and it says the CMS: *"Manage: … Homepage content."*

The architecture is Phase 9's, reused deliberately rather than reinvented:

| Module | Job |
|---|---|
| `lib/home/resolve.ts` | **pure** — every drop/keep rule, the LCP choice, the heading rule, the rail query |
| `lib/home/home.ts` | `server-only` — `unstable_cache` under the `home` tag, `revalidate: 300`, one `try` |
| `lib/home/sizes.ts` | pure — every `sizes` string, as a table a verification script can assert |

The point of the split is that `pnpm verify:home` exercises **161 checks** without a browser, because
the module holding the rules imports nothing from Next, nothing runnable from Payload, and nothing
marked `server-only`. The one Payload import is `import type { Where }`, which TypeScript erases —
a `Where` handed straight to `payload.find` should not be typed as a bare record.

**Measured, not assumed:** after `pnpm build`, `.next/prerender-manifest.json` reports `/` as
`"compute": "static"` with `initialRevalidateSeconds: 300`, and `.next/server/app/index.meta` carries

```
x-next-cache-tags: …,shell,navigation,site-settings,home
```

That `home` tag is what lets an editor's save invalidate **prerendered HTML**. An uncached read would
have made `/` dynamic; a cached-but-untagged one would have made the save invisible for five minutes.

`revalidateShell.ts` was renamed **`revalidateTags.ts`**. It had always been a generic variadic tag
factory named after its first caller, and Phase 10 needed the same body for a *collection* hook —
`campaigns`, because the campaign **is** the hero and a five-minute delay on the site's largest
statement is not acceptable. Products deliberately do **not** revalidate: they fire on every variant
save through `syncProductDerived`, and a rail is a 300-second-stale merchandising surface by design.
Recorded as owed to Phase 11, which builds the listings that make a tighter guarantee worth paying for.

### 1.15.2 Eleven block types, five of them already written

Plan §10.1a lists ten blocks *"such as"* — and the hedge matters, because two of the ten are the same
data shape and one is not a homepage section at all.

| §10.1a names | Delivered as | New? |
|---|---|---|
| Hero | `hero` (one field: a campaign reference) | new |
| Promotional strip | `promoStrip` | new |
| Category tiles | `categoryTiles` | new |
| Product rail/grid | `productRail` (query) **+** `productGroup` (curation) | new + **reused** |
| Editorial split | `splitFeature` | **reused** |
| Shop-the-look | `shopTheLook` | **reused** |
| Collection feature | `collectionFeature` | new |
| Brand story | `splitFeature` | **reused** — **DEV-43** |
| Social gallery | `socialGallery` | new |
| Newsletter | the footer's column | **DEV-42** |

Five of the eleven are the Phase 6 objects imported unchanged, which is exactly what
`blocks/editorial.ts` predicted: *"Phase 10 may reuse any of these seven."* Payload sanitises a block
config once and keys storage off the parent table name, so one object serves three parents, produces
three separate tables, and yields **one** shared interface in `payload-types.ts` — confirmed in the
regenerated types, where `SplitFeatureBlock` and the other four gained a third reference rather than a
duplicate interface.

Two of the seven are deliberately not offered here: `gallery` (because `socialGallery` is this page's
multi-image grid, and two grid blocks is a choice with no answer) and `pullQuote` (guide §09's Home
direction names image-led and typography-led sections, and `editorial` is the second).

`productRail` and `productGroup` both exist because they are different jobs. A rail is a **query** —
"New arrivals" must stay true without an editor re-curating it weekly — and a group is a **curation**
whose drag order *is* the merchandising decision. Neither expresses the other. They render through one
component, because the resolver normalises them to the same shape.

### 1.15.3 The 63-byte identifier arithmetic, done before the schema reached the database

Postgres truncates any identifier over 63 bytes **silently**, with a NOTICE. Worse, the truncation is
symmetric: `ADD CONSTRAINT "<66 chars>"` succeeds and the matching `DROP CONSTRAINT` truncates
identically, so a migration rolls forward, back and forward again cleanly while the Drizzle snapshot
holds a name the database has never had. It breaks only when two long names truncate to the same 63
bytes — at which point the failure is nowhere near the change that caused it.

Blocks under a global run long, because the template is
`${global}_blocks_${block}_${field}_id_${target}_id_fk`. Two of the six new blocks breached it:

| Block | Longest generated name | Bytes |
|---|---|---|
| `collectionFeature`, default | `homepage_blocks_collection_feature_collection_id_collections_id_fk` | **66** |
| `collectionFeature`, with `dbName` | `homepage_blocks_collection_collection_id_collections_id_fk` | 58 |
| `categoryTiles`, default | `homepage_blocks_category_tiles_items_category_id_categories_id_fk` | **65** |
| `categoryTiles`, with `dbName` | `homepage_blocks_tiles_items_category_id_categories_id_fk` | 56 |

Both carry the **function** form of `dbName`, never a string — a string replaces the whole table name
including the `${parent}_blocks_` prefix, which for a shared block collapses two parents into one
table whose `_parent_id` foreign key names only the first. `editorial.ts`'s `shopTheLook` docblock
already carries that measurement; this is the same trap avoided the same way.

Verified against the pushed schema rather than by arithmetic alone: **zero identifiers at 63 bytes or
longer anywhere in the database**, 17 `homepage*` tables, longest constraint 58. `verify-home.ts` §M
now asserts that invariant permanently — no earlier harness had it, and no earlier phase needed it.

### 1.15.4 `MediaImage` could not render a field the schema had promised since Phase 6

`campaigns.mobileHero` has existed since Phase 6, with a docblock citing plan §10.1b's *"mobile image
omitted: use safe fallback"*. Phase 8 documented it. **Nothing could render it.**

`MediaImage`'s `mobileContext` art-directs **one** asset at two crops — the same photograph, framed
upright. A second *asset* had no path through the component at all, so the field was unreachable: the
CMS half of §0.1.17's fake control, an upload an editor can fill that changes nothing.

Phase 10 added one prop, `mobileMedia`, and the change is backwards-compatible in both directions:
absent, the behaviour is exactly what it was; present, it supplies the `<picture>`'s mobile `<source>`
from a different record. Three details that are not incidental:

- **The reserved mobile box follows the asset that will be served**, not the desktop one. For an
  uncropped context `reserveBox` reads the asset's own dimensions, so reserving from the wrong record
  is the letterboxing defect Phase 8 measured, reintroduced through a different door.
- **A hero given only a mobile frame still renders.** The fallback is symmetric — the editor supplied
  one photograph, and deciding that they filled in the wrong field is not the component's job.
- **The degraded path art-directs too.** With no Cloudinary configured — the state this project is
  committed in — the crops are lost but a distinct `mobileMedia` is a distinct file Payload already
  serves, so the phone still gets the photograph shot for it.

### 1.15.5 Motion: DEV-24 deferred a library to this phase, and this phase declined it

The full argument is **DEV-40** and decision **D-34**. The four measurements:

| | |
|---|---|
| Install | 8.64 MiB across four packages (`motion` is a re-export shim over `framer-motion` + `motion-dom` + `motion-utils`) |
| Bundle | ~40 KB gzip, on the LCP route plan §37's performance gate names |
| Reduced motion | `MotionConfigContext` defaults to `reducedMotion: "never"`, and opting in neuters only *positional* keys — **opacity is not among them** |
| Tokens | it animates through the Web Animations API, which cannot read the CSS custom properties `globals.css` collapses to 1 ms under `prefers-reduced-motion` |

The last one is decisive rather than merely unfavourable: honouring the preference would have required
a **second implementation of motion**, which is the exact thing decision **D-13** exists to prevent.

Two claims in DEV-24 did not survive checking. *"Cinematic"* — the word it quotes as the guide's —
**does not appear in the visual guide at all**; it is the plan's word, and the guide's actual
instruction is §08's *"keep it slow, keep it subtle, prefer crossfades and gentle reveals"*, which
needs no spring, no gesture and no scroll-linked transform. And *"genuinely needed"* was a prediction,
not a finding.

What ships is two CSS declarations on the existing `--duration-editorial` / `--ease-editorial` tokens
and one client component using `IntersectionObserver`. CSS scroll-driven animation
(`animation-timeline: view()`) was rejected for a property the corpus cares about more than novelty:
a subject inside an `overflow: hidden` ancestor binds its timeline to an unscrollable container and
sits at `opacity: 0` **permanently**. It also ignores `animation-duration`, which would have moved
pacing out of the token layer, and it scrubs — scrolling up un-reveals.

### 1.15.6 The defect a browser found, in the component whose docblock said it could not happen

`Reveal`'s docblock claimed that content *"is never stranded invisible"*. It was wrong, and only a
real browser could show it.

An `IntersectionObserver` reports **threshold crossings**. A section that goes from below the viewport
to above it in a single jump — the End key, a scrollbar drag, an anchor link, a browser restoring a
scroll position — moves from ratio 0 to ratio 0 and **fires no callback at all**. Measured on the
built homepage at 1440×900:

| Scroll | Result |
|---|---|
| Gradual (wheel, 600px steps) | all nine sections `open` |
| `window.scrollTo(0, scrollHeight)` | **six sections stranded at `opacity: 0`**, `top` between −7163 and −1489 |

Those six stay invisible for the rest of the session, and scrolling back up does not recover them —
the observer has nothing left to report.

The fix is one option, argued rather than pasted: `rootMargin: '100000px 0px 0px 0px'` extends the
observer's root **upwards only**, so anything above the viewport counts as intersecting and gets a
callback, while the bottom edge stays at the viewport so what is below still arms. An explicit
`boundingClientRect.top <= 0` branch covers a section further above than the margin reaches. Re-measured
after the change: gradual, jump-to-bottom and scroll-back-up all leave zero sections closed.

The general lesson, and it is the same one Phase 9's §1.14.3 recorded about focus: **a docblock
asserting a safety property is a hypothesis until something executes it.** Both defects were invisible
to typecheck, lint and axe-core.

### 1.15.7 A Phase 7 defect the newsletter schema exposed

`lib/auth/schemas.ts` has said since Phase 7:

> `.trim()` on email is not cosmetic. A pasted address routinely carries a leading space, and the
> unique index does not consider `" ada@example.com"` and `"ada@example.com"` the same address.

The reasoning is right and the code did not do it. `z.email().trim()` reads as *"an email, trimmed"*
and is not: `z.email()` is its own schema type, so the **format check runs against the raw input** and
the trim only shapes the value it produces. Measured against `zod@4.4.3`:

| Input | `z.email().trim()` | `z.string().trim().pipe(z.email())` |
|---|---|---|
| `"  Ada@Example.COM "` | **rejected** | `"ada@example.com"` |
| `"Ada@Example.COM"` | `"ada@example.com"` | `"ada@example.com"` |

So a customer pasting an address with a trailing space was told *"Enter a valid email address."* — on
the sign-in form, the registration form and the password-reset form — for an address that is perfectly
valid. The paragraph above described an intention the code never implemented.

Fixed in both schemas by piping a trimmed string **into** the email check. Found because
`verify-home.ts` asserted the *behaviour* the docblock claimed rather than the syntax, on a schema
written by copying the Phase 7 one — which is an argument for testing the sentence rather than the
expression.

### 1.15.8 The newsletter, and the one place it departs from Phase 7

**DEV-42** in full. The short version: **DEV-25** deferred the footer column in Phase 3 because *"a
signup field rendered now would post nowhere — the subscriber collection is Phase 6.1n."* Phase 6
built it, `NewsletterSubscribers.ts` names this phase as the owner, and the premise expired. The
column is filled and DEV-25 is discharged.

The departure worth recording: `newsletter-subscribers.create` **stays `isStaff`**, and the Server
Action writes with `overrideAccess: true` — the opposite of `register`, which uses
`overrideAccess: false` on the principle that *"the storefront gets no privilege the REST API does not
have."*

That principle is right for an auth collection, which must be publicly creatable or nobody could sign
up. It is wrong here because of a property `customers` does not have: `email` is `unique` and `read`
is `isStaff`, so an openly creatable endpoint would answer a duplicate with a constraint error and a
fresh address with success — a **membership-enumeration oracle over personal data** for anyone with a
list of addresses. For the same reason a duplicate submission returns the identical success message,
and an unsubscribed address is **not** silently re-subscribed: that row exists precisely so *"a later
import cannot resurrect the address."*

Owed: the mail and the §19.1b double-opt-in question (**Phase 19** — these rows are single opt-in, the
only state the Phase 6 schema can represent), and rate limiting plus Turnstile (**Phase 26**).

### 1.15.9 No Suspense, no skeleton, no `loading.tsx` — and why that is a decision

§10.1d asks for *"skeletons for asynchronous product data **where needed**"*. It is not needed here,
and adding one would have been theatre:

1. **`/` is statically prerendered.** Every query resolves at build time; the HTML is complete before
   a visitor exists. There is nothing to stream.
2. **All reads are inside one cached loader**, so there is no second async boundary a `<Suspense>`
   could sit on.
3. Next's own streaming documentation warns that an **LCP element inside a Suspense boundary cannot
   paint until the boundary resolves** — a homepage `loading.tsx` would put the §10.1b hero behind a
   full-page skeleton and defeat §10.1d's own priority requirement.

Recorded here so a later reviewer reads the absence as a decision. The `Skeleton` primitive stays
unused on this route; Phase 11's shop page has real filter-driven streaming and is where it earns its
place.

Also deliberately absent: `export const revalidate` on the page (redundant — the loader carries it and
the lowest value across the route wins), and a `<head>` preload for the hero (it would need a client
component and a duplicated Cloudinary URL builder, for marginal gain on a route that is already
prerendered with the hero in the first HTML chunk).

### 1.15.10 What was verified, and how

**`pnpm verify:home` — 173 checks, all passing.** Two halves, in `verify-shell.ts`'s shape: pure
fixtures for every edge case in feature matrix §3, then **real Payload documents** for the states that
matter. The database half creates a draft campaign, a scheduled one and a product with no active
variant, and proves the resolver drops exactly those — a fixture proves the function, a real document
proves the function is being fed what it thinks it is, which is the difference that mattered in Phase
7's access harness.

No regression elsewhere: `verify:access` **45/45**, `verify:media` **61/61**, `verify:shell`
**100/100**. Total **367** checks across the four harnesses.

**Browser pass — 55 checks** at 320, 375, 430, 768, 1024, 1280, 1440 and 1920px (§30.1a's eight):

- no horizontal overflow at any width, and the Display XL headline stays inside guide §03's 48–72px
  range at every one of them;
- exactly one `<h1>`, one `<main>`, no duplicate DOM ids — including on `/login`, where the footer's
  form and the sign-in form both render an email field (the reason the newsletter field is named
  `newsletterEmail`);
- **exactly one image with `fetchpriority="high"`**, every other image lazy, and every `<img>`
  carrying `width` and `height`;
- the horizontal rail focusable and keyboard-scrollable (WCAG 2.1.1 — axe cannot see this: a static
  tree cannot tell that a `div` scrolls);
- the reveal in all three failure modes — JavaScript disabled (every section renders, nothing hidden),
  `prefers-reduced-motion` (transition duration `0.001s`, from the existing token block with no new
  policy), and jump-scrolling (the defect in §1.15.6, fixed and re-measured);
- the newsletter end to end: a fresh address, the same address again (indistinguishable), an invalid
  address (a field error with `aria-invalid`), and a pasted address with whitespace and capitals.

**0 axe-core violations** on `/` at 1440×900 and 390×844, WCAG 2.0/2.1/2.2 A + AA.

**Media.** The database had no assets, so the media pipeline was exercised against nineteen uploaded
test frames carrying edge ticks and printed dimensions — not photography, and not committed. Two Phase
8 predictions re-confirmed on live data: a 3000×1200 source clamps to `w_960` in the 4:5 context
(`floor(1200 × 0.8)`), and a 480×600 source never upscales in any context.

### 1.15.11 What is now owed

- **Every commerce destination on this page 404s** — `/shop/<slug>` (Phase 11), `/product/<slug>`
  (Phase 13), `/collections/<slug>` (Phase 23). The same accepted state Phase 9 shipped for the
  navigation, answered by **D-31**'s global 404. Nothing should paper over it with `prefetch={false}`.
- **The product tile is not the product card.** §11.1b's nine states and §11.1c's interactions are
  Phase 11's; `ProductTile.soldOut` is carried by the resolver and read by nothing.
  `derived.compareAtFromMinor` is likewise unread — a struck-through price a variant never sold at is
  a false saving claim.
- **Products do not revalidate the `home` tag** — Phase 11.
- **No hero video, and no `campaigns.video` field** — **DEV-41**, to be confirmed in Phase 23.
- **The newsletter is single opt-in and unthrottled** — Phase 19 and Phase 26.
- **Rich-text prose is the first public Lexical surface**, and its hrefs are re-validated at render
  (**D-35**) because `LinkFeature()` stores an unvalidated editor-typed URL. A phase that adds link
  *fields* to the editor config should revisit whether the validation belongs at save time too.
- **Homepage SEO is the layout's default.** No `metadata` export, no OG image, no structured data —
  Phase 24, which `site-settings` already holds `defaultSeoTitle`/`defaultSeoDescription`/
  `defaultOgImage` for.
- **The seed's composition adapts to the media library.** On an empty library it writes seven sections
  rather than ten, because three blocks carry `validateRequiredUpload`. Phase 29's demo catalogue
  should ship assets and make the full composition unconditional.


### 1.15.12 Post-implementation audit

The committed, green Phase 10 was re-read adversarially — seven auditors along separate dimensions,
then a verifier instructed to **refute** every claim and to reproduce anything it could not refute.
**39 claims verified: 3 refuted, 36 confirmed** (2 high, 8 medium, 26 low), plus 11 duplicates. All
36 are fixed.

This is the fifth phase to run this exercise and the fifth to find defects that had passed every
gate. The headline is not any single finding — it is *what kind* of thing survived 367 harness
checks, a clean `--max-warnings 0` lint, a strict typecheck and two zero-violation axe sweeps.

#### The two high-severity findings

**1. `Prose` sanitised one of Lexical's two link node types.** Decision **D-35** says every rich-text
href is re-validated at render, and the converter map spread `defaultConverters` and overrode `link`.
Lexical also has **`autolink`** — created by the editor's own plugin the moment someone types
something URL-shaped — and `LinkJSXConverter` renders it as `<a href={node.fields.url}>` with no
validation at all.

Reproduced end to end: a campaign story written through the Local API rendered
`<a href="//evil.example/phish">` and `<a href="data:text/html;base64,…">` on the live homepage,
while the identical URLs as `link` nodes correctly degraded to text. The save side cannot catch it
either — `AutoLinkNode`'s server config declares no `getSubFields`, so the `url` field's own hooks
and validators never run on it. An unregistered `upload` node also stored and rendered, with an
editor-controlled `src` and a `<link rel="preload">`.

Fixed by listing every converter by name instead of spreading: `link` and `autolink` share one
sanitised implementation, and the node types this editor does not enable (`upload`, `table`,
`horizontalrule`, `tab`) render nothing. Re-verified against the running application with six
hostile URL shapes on both node types — `evil.example`, `javascript:` and `data:text/html` now
appear nowhere in the HTML, and safe links still render, now with the new-tab announcement they were
missing.

**2. A failed regeneration cached a blank homepage over the good one.** `getHome` was documented as
*"Never throws"*, and that was the defect rather than the virtue. `/` is prerendered with a
300-second revalidate, so a **background regeneration** renders the page and ISR stores whatever
comes back. A loader that cannot throw returns a perfectly valid *empty* homepage, Next caches that
**200**, and the blank page replaces the real one for five minutes — outliving the database blip that
caused it. A throw would have failed the regeneration and left the last good HTML in place.

The `try` around the *call* was reasoned about correctly for the **data** cache; the **route** cache
is a second cache the reasoning never accounted for. `page.tsx` now throws on `degraded`, which also
makes the flag load-bearing rather than computed-and-never-read. Per-read `catch`es were added so a
single failing rail costs that rail — which is the rule `home-sections.tsx` already stated for
unknown block types and the loader did not follow.

#### The rest, by what they teach

**Two `<h1>`s.** Nothing stops an editor adding a second campaign hero — the block's plural label is
literally "Campaign heroes" — and `hasHeading: boolean` can say *at least one* and cannot say
*exactly one*. Axe agreed, because `page-has-heading-one` requires at least one. The resolver now
demotes every hero after the first to `h2`.

**An empty `<h2>`, reachable by an editor and not by the seed.** A product rail with a "View all"
link and no heading rendered `SectionHeading` with nothing in it — a real `empty-heading` violation
that axe reports immediately *once the markup exists*. The seeded composition gives every rail a
heading, so the zero-violation sweep never met it.

**The newsletter announced nothing on a validation failure.** `FormStatus` renders nothing without a
form-level `message`, and `Field` deliberately clears `role="alert"` on its own message — correct,
and only correct when a summary exists. With `message: null` there was no live region on the page at
all, and `Button`'s real `disabled` attribute had already dropped focus to `<body>`.

**Two protections that were not protections.** The action's docblock credited Next's Origin check and
a 320-character column cap. Replaying a captured Server Action request showed a request that simply
*omits* the `Origin` header is accepted (a wrong origin is rejected; no origin is not), and
`information_schema` shows the column is `varchar` with no length. Both claims are now stated
accurately, and the open write path is recorded as owed to Phase 26 rather than described as covered.
The read-then-create shape was also replaced with an unconditional insert that swallows the unique
violation — the read-first version had reintroduced, as a *timing* oracle, the very enumeration the
design set out to prevent, and could double-insert under concurrency.

**`MediaImage` discarded the mobile photograph in exactly the state three docblocks said it
survived.** The `<picture>` branch keyed off `mobileAsset === null` — an asset derived from
`cloudinaryPublicId`, which is `null` for *both* records whenever Cloudinary is unconfigured. So the
art direction collapsed to a single `<img>` in the state this project is committed in, while still
reserving the mobile box. The test is now record identity. Two smaller ones went with it: a distinct
mobile record with no Cloudinary id emitted two byte-identical `<source>`s, and the LQIP blur was
built from the desktop asset even when a different photograph was served.

**`sizes` strings measure the viewport, not the container.** `58vw` and `25vw` described fractions of
a *container* that stops growing at 1440px. Corrected with fixed-pixel tiers above 1440, and
`productTileGrid` lost a three-column tier the product grid never had — it was describing the
*category* grid. The browser pass now asserts that no image is delivered smaller than its box, which
is the check that had already caught shop-the-look during the phase.

**Two accessibility defects axe structurally cannot see.** A sticky header covered 100% of the
focused control on backward keyboard traversal at 375×700 (WCAG 2.2 SC 2.4.11) — it needs a scroll
position only Shift+Tab produces; fixed with one `scroll-padding-top`. And keyboard focus could land
inside a section still at `opacity: 0`, invisible along with its focus ring for the length of the
transition; `[data-reveal='closed']:focus-within` reveals it the instant focus enters. Also: the rail's
focus ring was clipped to two bars by its own `overflow-x-auto`, `snap-x` sat on a non-scrolling
`<ul>` and did nothing, and a CTA marked `inline-block` inside a flex column was blockified into a
505px hit target.

**The harness could not see its own gaps.** `verify-home` asserted that `railWhere` returns three
clauses and inspected two of them — invert the merchandising flag and 161/161 still passed, because
the seeded catalogue carries enough products either way. It also never built a rail with a CTA and no
heading, a homepage with two heroes, or a body an editor had cleared (which is a root with one empty
paragraph, not `null`). Every confirmed finding the pure module can hold now has a regression test;
the harness is **173 checks**, up from 161.

And the harness could truncate its own verdict: at 173 checks the report was cut off mid-run while
the command still exited `0`, because `process.exit()` does not drain an asynchronous stdout write to
a pipe or a file — and `payload.destroy()` tears the logger down before it flushes. The report is now
one awaited `process.stdout.write`, verdict line first.

#### What the gates cannot see, stated for the phases that follow

Four categories, and every confirmed finding sits in one of them.

1. **Types describe shape, never meaning.** `section.body ?? null` is perfectly typed and asks the
   wrong question. `Math.min(Math.max(x, 1), 12)` takes a number and returns a number, and `4.5`
   survives it into a Postgres `LIMIT`. `hasMedia`'s `.some()` and a renderer's `index === 0` are both
   valid and disagree. `mobileAsset === null` compiles identically whether it means "no distinct
   record" or "no Cloudinary id" — and those two meanings diverge in precisely the branch that exists
   because Cloudinary is absent.
2. **A harness meets the fixtures its author imagined, and one seeded composition.** States an editor
   reaches by dragging and deleting — two heroes, a CTA without a heading, a cleared body — were
   never constructed.
3. **axe reads one static DOM at one scroll position, with no keyboard and no clock.** It cannot fire
   a Server Action, so a form state that only exists after a failed submit never existed while it ran.
   It has no scroll position produced by Shift+Tab. It does not measure opacity 120 ms later.
4. **The gates run inside the machine and cannot check the machine's account of itself.** The largest
   single class of confirmed findings — nine of thirty-six — was **prose asserting a property the code
   does not have**. `Prose` said *"every href is re-validated"* while inheriting a converter that
   validated none. `MediaImage` said the phone *"still gets the photograph shot for it"* in the one
   state where it did not. `PromoStrip` said it was *"deliberately not a list of `<li>`"* while
   rendering a list of `<li>`. `revalidateTags` credited its safety to an import strategy a stack
   trace shows is not what saves it.

   This phase had already caught one such docblock by measuring, fixed it, and shipped nine more.
   **The docblock is the specification the next phase will trust, and it is the only artefact in this
   repository that nothing executes.** That is the standing argument for running this audit every
   time.


## 1.16 Phase 11 — product catalogue and discovery

Plan §11.1a–§11.1e. The shop page, the product card's nine states, URL-backed filters through nuqs,
five sorts, pagination, the empty state — and the search index that three of the six required facets
cannot be answered without.

**Two dependencies added**, both this phase's own and both on the approved list (tech stack §1):
`nuqs@2.10.1` (plan §11.1d names it) and `algoliasearch@5.57.0`. Direct dependencies go from 22 to 24.

### 1.16.1 The engine is chosen per query, and that is what makes three documents agree

Three instructions look incompatible until the question is narrowed:

- plan §11.1d — *"use Algolia as the query/facet engine after the catalog is seeded"*;
- plan §0 and the master directive — Postgres is the source of truth, Algolia is *"a derived search
  index"*;
- plan §A.5 — when Algolia is down, *"catalog remains usable through curated category navigation."*

They agree the moment the question stops being *which engine runs the shop* and becomes **which engine
can answer this query**. `requiresSearchIndex` is that predicate, and it states a fact about the
schema rather than a preference:

| Facet | Stored on | Engine |
|---|---|---|
| Category | `products.categories` — indexed relationship | Postgres |
| Price | `products.derived.priceFromMinor` — indexed | Postgres |
| Availability | `products.derived.inventoryTotal` — indexed | Postgres |
| Every sort, and the page | indexed columns | Postgres |
| **Size** | `product-variants.size` | **Algolia** |
| **Colour** | `product-variants.colorFamily` | **Algolia** |
| **Collection** | `collections.products` | **Algolia** |

The last three are not columns on `products` at all. `products.variants` and `products.collections`
are Payload **`join`** fields — virtual, no column — so a product cannot be filtered by one. Answering
*"products with an active Black variant in M"* from Postgres means querying the variant table,
collecting distinct product ids and paginating over that set, which is precisely the *"expensive
full-catalog scan on every request"* §11.1d forbids by name. Decision **D-36**.

`Products.ts` predicted the collection half of this in Phase 6 and gave the reason: membership is
owned by the collection because *"an order is a property of the list, not of its members."*

**The consequence is the one D-04 already committed to**, now true rather than aspirational: an
Algolia outage cannot take the shop down. Measured against a deliberately unreachable application —
`.env` pointed at `BROKENAPPID`, dev server restarted:

| Request | During the outage |
|---|---|
| `/shop` | **10 products** |
| `/shop/clothing` | **8 products** |
| `/shop?priceMax=150` | **2 products** |
| `/shop?availability=in-stock` | **10 products** |
| `/shop?sort=price-desc` | **10 products** |
| `/shop?color=black` | the controlled unavailable state, with the two top-level categories |

Only the three variant-and-membership facets degrade, and they degrade into §11.1d's stated fallback
rather than into an empty grid.

### 1.16.2 The index stores no price, no image and no name a customer reads

Decision **D-37**, and it is the single most consequential choice in the phase.

An Algolia record here carries facets and ranking attributes. A query asks for `objectID` **and
nothing else**, and `catalog.ts` reads those ids back from Postgres through the ordinary
access-controlled `payload.find`.

This is the opposite of the usual Algolia record, and the argument is the same one that governs the
browser: *a copy is not authoritative*. A grid rendered from the index would show the name and price
of a product unpublished thirty seconds ago, and a price edit would be visible in a listing before it
was true in the database — the exact failure *"the browser is never authoritative … recalculate
server-side"* exists to prevent, moved one layer out.

The cost is one extra indexed round trip on a filtered query. What it buys is that plan §12.1d's
*"deleted product still in index"* and *"product unpublished after index update"* are handled **by
construction**: the row is not returned, so the card is not rendered. A stale id costs one missing
card and can never cost a wrong price. It also means **one** card resolver for both engines rather
than two rendering paths that drift — the property `verify:catalog` asserts directly.

### 1.16.3 What Phase 11 took from Phase 12, and what it left

§11.1d cannot be built without an index, and an index cannot exist without a record shape, settings,
sort replicas, a rebuild and synchronisation. So this phase owns the parts of §12.1a and §12.1b that
a *facet* needs, and Phase 12 owns everything *searching* means:

| | Phase |
|---|---|
| Record shape, filterable attributes, sort replicas | **11** |
| Full rebuild (`pnpm reindex`), sync on write, removal on unpublish | **11** |
| Searchable attributes *declared* (§12.1a) but never queried | **11** — an index whose records lack them cannot be made searchable later without a rebuild |
| The search overlay, autocomplete, suggestions, recent and popular queries, the results page, §12.1d's query edge cases | **12** |

`ALGOLIA_ADMIN_API_KEY` was corrected to **`ALGOLIA_WRITE_API_KEY`** on the way — the reasoning is in
the naming table in §1.9, and the short version is that Algolia's signup screen issues a pre-scoped
*Write* key which is measurably not the Admin key (`GET /1/keys` → **403**). The old name invited
someone to paste an account-root credential into it. `env.core.ts`'s integration group moves from
phase 12 to phase 11 with it.

**There is deliberately no `ALGOLIA_INDEX_NAME`.** The index is `catalogIndexName(appEnv)` —
`north01_products` in production, `north01_products_local` on a laptop. `.env.example` states the rule
(*"use a DEVELOPMENT index locally, never the production one"*); a variable would make it a request
rather than a guarantee.

### 1.16.4 Sorting by a nullable column, and the `NULLS FIRST` that would have topped the grid

`price-desc` sorts on `derived.priceFromMinor`, which is `null` exactly when a product has no active
variant. Drizzle emits a bare `ORDER BY x DESC` — verified in
`@payloadcms/drizzle/dist/queries/buildOrderBy.js`, which maps a `-` prefix onto `desc()` with **no
nulls-ordering control of any kind** — and Postgres sorts `NULL` **first** under `DESC`.

So every withdrawn product would have headed the "Price: high to low" grid, priceless, above the most
expensive garment in the shop.

The fix is a clause, not a sort: `publishedProductWhere` requires `derived.priceFromMinor` to exist.
That is a merchandising rule with a second benefit rather than a workaround — a product whose every
colour and size is switched off has been *withdrawn from sale*, and listing it is *"a dead end dressed
as an offer"*, which is the judgement `resolveProductTile` already makes on the homepage.

Every sort also ends in **`slug`**, which is unique. Postgres guarantees no order for equal keys, so
without a tiebreaker page 1 and page 2 of a `sortOrder = 0` run can interleave between two requests:
one product appears twice and another never appears at all.

### 1.16.5 The nine card states, and the three that are not data

Plan §11.1b lists nine. Three of them are not props and pretending otherwise grows a model nothing
reads:

| §11.1b | Where it lives |
|---|---|
| Normal, New, Sale, Low stock, Sold out, Out-of-season | the model — one `state` plus two booleans |
| **Hover** | CSS. A `group-hover` opacity settle, no state, no JavaScript |
| **Loading** | `ProductCardSkeleton` — a different component; a card with data is never loading |
| **Image unavailable** | `MediaImage`, which solved it in Phase 8 by reserving the box from the context |

Availability is **derived, never stored**, copying gap **G-05**'s table from `ProductVariants.ts`
rather than re-inventing it, and the threshold is passed in because `SiteSettings.ts` is explicit that
`lowStockThreshold` must be *"applied at render"* — a stored flag would be stale on every product the
moment an editor changed the number.

**One badge, by precedence**, never a row of stickers: availability outranks merchandising, always. A
NEW badge on a product that cannot be bought is an advertisement for a disappointment. The sale state
is not lost when it loses the badge — `compareAtLabel` still renders as a struck price, which is where
a saving is legible anyway.

`unavailable` never appears in the shop grid, and that asymmetry is deliberate rather than dead code:
the listing filters those products out, and the state exists because Phase 20's wishlist, Phase 23's
curated collections and a recently-viewed rail all link to a *specific* product regardless.

### 1.16.6 Pagination rather than load-more, and one parser rather than two

**Pagination**, and every reason is the same reason. Feature matrix §5 requires a shareable URL and
Back/Forward restoring state; a load-more button accumulates results in client memory, so page 3 is a
state no URL describes, Back returns to an empty list, and a crawler sees the first twenty-four
products and stops. Numbered pages are server-rendered, addressable and work with JavaScript off —
which the browser pass measures directly.

**One parser map.** `CATALOG_PARSERS` is imported by the server loader *and* by `useQueryStates`. The
standing trap with URL state is two parsers that disagree by one character — a separator, a default, a
clamp — so the page renders one thing while the controls claim another. `nuqs/server` is the import on
both sides because the package's main entry carries `'use client'`.

Three write options are each a departure from a nuqs default and each is load-bearing:
`shallow: false` (without it the address bar changes and **nothing else** — the classic fake control),
`history: 'push'` (feature matrix §5's Back requirement; the default `replace` makes Back leave the
shop), and `scroll: false`. Every write also clears `page`: standing on page 3 and ticking a colour
otherwise lands the customer on an empty grid that says nothing matched.

### 1.16.7 The Suspense boundary is around the results, not the page

Phase 10 recorded that a homepage `loading.tsx` would be theatre and named this page as where
streaming earns its place. It does — `/shop` is a function of nine URL parameters and cannot be
prerendered.

The boundary wraps the **results only**, keyed on the serialized query. The title and the filter panel
stay outside it, because the panel is a client component reading URL state and reflects a ticked box
*instantly*; putting it inside would replace the control the customer is using with a skeleton of
itself at the moment they use it. The key matters too: without it React reuses the boundary and leaves
the **previous** products on screen, which is worse than a spinner because stale results that look
settled are indistinguishable from an answer.

Confirmed in a browser rather than assumed: the fallback is observed painting during a sort
transition.

`NuqsAdapter` is scoped to `app/(frontend)/shop/layout.tsx` rather than the frontend root. It is a
client component, and mounting it at the root would put a client boundary around `/` — the route Phase
10 measured as `"compute": "static"` and whose whole performance argument is that it ships almost no
client JavaScript. The build confirms `/` is still static with a 300-second revalidate.

### 1.16.8 Three defects a browser found, and one axe did

**The sort control overflowed a 320px viewport.** `min-w-[11rem]` on the select, in a row with the
product count and the Filter trigger: measured at a **376px `scrollWidth` against a 320px
viewport** — a shop that scrolls sideways on the narrowest of §30.1a's eight widths. A flex item's
default `min-width` is `auto`, so it refused to shrink rather than narrowing. The controls now take
their own row below the count on a phone and the select gives up its width where there is none.

**The category vocabulary was flat, and it should have been a tree.** `loadVocabulary` read
`doc.parent` as a document — but the query runs at `depth: 0`, where it is an **id** — so every
category resolved to `parent: null`. `expandCategory` therefore built an empty child map and
`/shop/clothing` quietly stopped meaning *"everything under Clothing"*. The visible symptom was
smaller and is what caught it: the degraded and empty states offer top-level categories as the way
back in, and were listing *Hoodies*, *Shirts*, *Sweatshirts* and *Tops* beside *Clothing* as though
they were siblings.

The harness could not have found it. `verify-catalog`'s category fixtures are hand-written with the
parents already resolved, so they proved `expandCategory` correct while the thing feeding it was
wrong — Phase 10's *"a harness meets the fixtures its author imagined"*, exactly. The fix moved the
shaping into the pure module as `toCategoryOptions`, so the harness now runs it against **real
documents**; four checks were added, and one of them asserts the live vocabulary is a tree.

**A chip per descendant.** Ticking *Clothing* rendered three chips — *Clothing*, *Tops*, *Hoodies* —
because `activeFilterChips` read `query.categories`, which is the **expanded subtree**, not what the
customer chose. Three controls for one decision, two of which they never made and could not
meaningfully remove one at a time. `CatalogQuery` now carries `requestedCategories` beside
`categories` precisely so the distinction can be made. Found by `verify:catalog`, not by the browser.

**The struck-through compare-at price used the disabled tone.** `text-foreground-disabled` is
Muted Stone at **4.15:1** and axe-core called it, correctly. `Badge`'s own docblock had already
written the rule that was broken: *"'Sold out' is information a customer reads, so it keeps Stone's
7.91:1 rather than dropping to the 4.15:1 tone reserved for disabled."* A former price is information
a customer reads. It is Stone now, and the payable price went one step brighter, which is hierarchy
rather than decoration — the number a customer will be charged should not be the quieter one.

There was also a defect in the code before any of that: `TIMEOUTS` was written as
`{ connect: 2, read: 3, write: 30 }` under a comment saying *"in seconds"*. Algolia's are
**milliseconds** (`@algolia/client-common` exports `DEFAULT_CONNECT_TIMEOUT_NODE = 2000`), so every
request timed out after two milliseconds and the client reported *"Unreachable hosts — your
application id may be incorrect"*: a message about credentials for a fault that had nothing to do with
them.

### 1.16.9 What was verified, and how

**`pnpm verify:catalog` — 122 checks, all passing.** Three parts, extending `verify-home.ts`'s shape:

- **Pure fixtures** for the URL contract, all six §11.1d edge cases, the nine §11.1b card states,
  badge precedence, category expansion (including the two-save parent cycle `Categories.ts` says the
  schema permits) and the index-record rules.
- **Real Payload documents** — a draft, one scheduled a week out, one whose every variant is inactive,
  and a sold-out one — proving the listing query drops exactly the first three and keeps the fourth.
- **Both engines, compared.** For every query Postgres can answer, the same query goes to the index
  and the id lists are compared for membership *and*, on the price sorts, for **order**. No earlier
  harness has an analogue, because no earlier phase answered one question two ways. It also asserts
  the property that makes the comparison honest: a **CLI write does not reach the index**, which is
  why `pnpm reindex` exists.

No regression elsewhere: `verify:access` **45/45**, `verify:media` **61/61**, `verify:shell`
**100/100**, `verify:home` **173/173**. Total **501** checks across five harnesses.

**Browser pass — 34 checks plus 9 interaction checks**, at 320, 375, 430, 768, 1024, 1280, 1440 and
1920px:

- no horizontal overflow at any of the eight widths (after §1.16.8's fix), one `<h1>`, no duplicate ids;
- the sort control re-orders the grid, and Back and Forward restore the previous and next results —
  feature matrix §5's requirement, measured rather than assumed;
- a facet narrows the grid, unticking restores it, ticking from `?page=2` **resets the page**, and a
  facet is operable by keyboard with Space;
- a size facet — which only the index can answer — returns products;
- every §11.1d edge case in a real URL: an unknown value reported rather than silently dropped, a
  reversed range swapped, `?page=99999999` rendering the empty state, junk parameters not crashing
  the page, duplicates collapsing to one chip;
- **JavaScript disabled**: the shop renders and a filter chip is still removable, because the chips
  and the pagination are real anchors;
- a focused card is 1% covered by the sticky header at 375×700 (WCAG 2.4.11).

**0 axe-core violations** on `/shop` at 1440×900 and 390×844, `/shop/clothing`, the ignored-filter
notice, the empty state and the open mobile filter drawer — WCAG 2.0/2.1/2.2 A + AA.

**Media.** The library is still empty, so all ten cards paint `MediaImage`'s reserved placeholder and
there is no `<img>` on the page. The LCP assertion is therefore vacuous today and the harness says so
rather than passing quietly; it becomes meaningful with Phase 29's assets.

### 1.16.10 What is now owed

- **Quick View, Quick Add and the wishlist control are deferred** — **DEV-45**. Every one of them
  needs a service that does not exist yet, and §0.1.17 forbids the alternative.
- **`/product/<slug>` still 404s** (Phase 13), so every card links somewhere that does not exist yet.
  The same accepted state Phase 9 and Phase 10 shipped, answered by **D-31**'s global 404.
- **`best-sellers` sorts by a merchandising flag, not by sales.** There is no order history until
  Phase 18, which is where it can become a measured sort.
- **No rating sort** — Phase 21 owns reviews. **DEV-46.**
- **Shop SEO is the layout's default.** No `metadata`, no canonical, no `generateStaticParams` on
  `/shop/[category]` — Phase 24, exactly as Phase 10 deferred the homepage's.
- **The listing itself is uncached** and the vocabulary is cached under the `catalog` tag. Phase 30
  owns performance polish and is where a measurement, rather than an intuition, decides whether the
  listing needs more.
- **A category slug change does not re-index**, by design — it rewrites the `categorySlugs` of every
  product beneath it, which is a bulk operation. `pnpm reindex` is the documented answer.
- **Facet counts are not rendered**, so every indexed attribute is `filterOnly`. Phase 12 can widen
  any of them when the search UI wants counts.
- **The facets are independent, not dependent.** Ticking *Accessories* does not narrow the size list
  to the sizes accessories come in, so a combination that returns nothing is still reachable. The
  audit fixed the case where a facet value could *never* match (a draft product's size); narrowing
  the vocabulary to the current filter context is a different feature, and it belongs to Phase 12,
  which is where Algolia is already computing facet distributions.
- **`unavailable` is still the one card state no listing renders**, by design — `publishedProductWhere`
  drops a product whose every variant is switched off. It is reachable from a wishlist (Phase 20) or
  a curated collection (Phase 23), which are the phases that link to a product regardless of whether
  a listing would have offered it.

### 1.16.11 Post-implementation audit

The committed, green Phase 11 was re-read adversarially, then every claim was reproduced against the
running application rather than argued from the code. **Six defects confirmed: two high, two medium,
two low.** All six are fixed.

This is the sixth phase to run this exercise and the sixth to find defects that had passed every
gate — 501 harness checks, a clean `--max-warnings 0` lint, a strict typecheck, a 34-check browser
pass and two zero-violation axe sweeps. As in Phase 10, the interesting question is not *what* was
wrong but *what kind* of thing survived all of that.

#### The two high-severity findings

**1. A filter applied with different casing could not be removed.** `normaliseCatalogQuery` maps
`?size=m` onto the stored value `M`, because `ProductVariants.size` is upper-cased by its own
`beforeValidate` hook. The chip's *label* came from that normalised value; its *remove link* was
built by filtering the **raw** URL token, so `['m'].filter(v => v !== 'M')` removed nothing and the
href came back byte-identical to the page it was on. Measured on `/shop?size=m`: six products before
the click, six after, same URL.

`activeFilterChips`' own docblock states the property it violated — *"a filter a customer can apply
and cannot see is a filter they cannot clear"*. The mechanism was different from the one the docblock
imagined; the outcome was exactly the one it named.

Fixed by **canonicalising the URL** rather than by patching the comparison, which is the difference
between closing an instance and closing a class: `/shop?size=m` now redirects once to `/shop?size=M`,
after which every downstream comparison is normalised-against-normalised *by construction*. It also
buys what feature matrix §5 asks for — one canonical URL per query, which is one entry in a crawler's
index rather than four spellings of one page.

Two things are deliberately **not** canonicalised, and the harness pins both: an **unknown** value
(`?color=puce`) and a **reversed** price range. Rewriting either would strip the evidence before the
toolbar could report it, and plan §11.1d requires the customer be *told*, not silently corrected.
`canonicaliseParams` is also asserted to be a **fixed point** — no URL can redirect twice.

**2. The price facet lied about what was applied.** The two inputs hold local draft state so a
customer can type `1`, `12`, `120` without three server round trips. That state was seeded from props
and never updated, so it went stale the instant the URL changed underneath it:

| Action | URL | Inputs showed |
|---|---|---|
| Load `?priceMin=100&priceMax=200` | correct | 100 / 200 |
| Remove the price chip | `/shop` | **100 / 200** |
| Apply a maximum, then press Back | `/shop` | **— / 150** |

Worse than cosmetic: the panel is the only thing on screen claiming what is applied, so a customer who
then edited only the minimum and pressed Apply would silently re-apply a maximum they believed they
had cleared. Fixed with a `key` on the URL values — React's own documented answer for resetting state
on a prop change, and one that leaves typing untouched because it only fires on a real change.

#### The rest, by what they teach

**An out-of-range page was a dead end that contradicted itself.** `/shop?page=5` against a one-page
catalogue rendered the toolbar's honest *"10 products"* directly above *"Nothing here yet — this part
of the shop has no published products at the moment"*, which was false, and **no pagination at all**,
because that control lives in the branch that only runs when there are products. The only way back was
editing the URL. It now redirects to the last real page, so the empty state can only ever mean
*"nothing matched"* — the one thing it should mean. `CatalogEmpty` also gained the count, so the one
remaining way to reach it with a non-zero total (a stale index — plan §12.1d's *"deleted product still
in index"*) gets a sentence describing what actually happened.

**The filter panel offered sizes no customer could buy.** The vocabulary read every variant with
`active: true` — and said nothing about whether its *product* was published. So a draft product's
sizes and colours appeared in the panel and returned zero results. Verified with a draft product sized
`AUDIT-ONLY`: offered by the panel, 0 products. The function's own docblock claimed the opposite, in
as many words: *"a facet that can only ever return nothing is worse than a missing facet."* The clause
is now `publishedProductWhere`'s three conditions reached through the `product.` join — the same
dotted path `access/publishedOn` resolves — extracted to `listableVariantWhere` so the vocabulary and
the listing share **one** definition of "listable" rather than each deciding separately.

**`site-settings` was read twice per render**, because `getCatalog` and `getCatalogSettings` each
called the un-memoised `readSettings`. Hoisted into the `cache()`d export, so the second caller is
free and both look at the same object.

**A docblock described a narrower rule than the code implements.** `ProductGrid.eager` said "an
unfiltered shop"; `/shop/<category>` qualifies too, because standing in a category is not filtering.
The behaviour was right and the prose was wrong — the same category of defect that produced nine of
Phase 10's thirty-six.

#### The coverage gap the audit found, and closed

**Every one of the ten seeded products was in stock.** So `soldOut`, `lowStock` and `unavailable` —
three of plan §11.1b's nine card states — had **never rendered in a browser**. The badge precedence
chain, the `muted` badge over a photograph and the reduced-opacity treatment were all fixture-verified
only, and no axe sweep had ever seen them.

They were verified during the audit by creating the missing states, then made permanent: the seed now
ships `cashmere-scarf` sold out (both colours at zero — `inventoryTotal` is a **sum**, so zeroing one
colour would still have totalled four) and `card-holder` at two units against a threshold of five.
`/shop` now renders three availability states on one page in every environment, so every future
browser and axe pass covers them without anyone remembering to.

The general lesson is Phase 10's, arriving through a different door: *a harness meets the fixtures its
author imagined, and one seeded composition.* Here the fixtures were right and the **composition** was
the gap — the seeded catalogue could not express a third of the states the phase was built to render.

#### What the gates could not see, again

Every one of the six sits in a category Phase 10 already named, which is the part worth recording:

1. **Types describe shape, never meaning.** `params.size.filter(v => v !== value)` is perfectly typed
   and compares a raw URL token against a normalised one. `useState(min)` is valid and means "ignore
   every later value of `min`".
2. **A harness meets the fixtures its author imagined.** `verify-catalog` asserted that every applied
   filter produces a chip — and built that chip from an already-canonical fixture, so the one input
   shape that breaks it was never constructed.
3. **A browser is where state over *time* lives.** Findings 1, 2 and 3 each needed a second
   interaction — a click, a Back, a page number — and none of them is visible in one static DOM.
4. **The gates run inside the machine and cannot check the machine's account of itself.** Two of the
   six were code contradicting its own docblock, and in both cases the docblock was the more confident
   of the two.

All six now have regression tests. `verify-catalog` is **144 checks**, up from 122, and both the
out-of-range rule and the vocabulary clause were *extracted into the pure module* so the harness could
hold them at all — the same move Phase 10 made when it found `railWhere` untestable where it sat.

#### Verification after the fixes

`pnpm verify:catalog` **144/144**; `verify:access` 45/45, `verify:media` 61/61, `verify:shell`
100/100, `verify:home` 173/173 — **523 checks** across five harnesses. Browser pass **36/36** (up from
34; the out-of-range assertion was rewritten, because the old one encoded the defect), plus a 16-check
re-verification of the fixes themselves. **0 axe-core violations** across six surfaces, now including
the newly-reachable sold-out and low-stock cards. Typecheck, lint at `--max-warnings 0` and the
production build all clean, with `/` still static at a 300-second revalidate.

## 1.17 Phase 12 — search / Algolia

Plan §12.1a–§12.1d. Text search over the index Phase 11 built: the searchable set the plan actually
asks for, the overlay panel **DEV-37** deferred, a `/search` results page, and the ten edge cases.

**Two dependencies were already present** — `algoliasearch` arrived in Phase 11 with the facet engine.
This phase added none.

### 1.17.1 Three defects in the shipped index, found before a single line of Phase 12 was written

The design pass measured the live index rather than reading the code, and all three would have gone
live in the same commit that enabled text search. They are fixed in `813b40a`, before the feature.

**1. Every sort replica had no `searchableAttributes`.** In Algolia that means *search every
attribute*. `configureCatalogIndex` hand-wrote a four-key settings object per replica, and
`setSettings` leaves anything it is not given unchanged — so the replicas kept the empty default while
the primary had four attributes. Measured:

| Index | `black` |
|---|---|
| `north01_products_local` | **0 hits** |
| `north01_products_local_price_asc` | **1 hit** |

Dormant only because `indexSearchParams` hard-coded `query: ''`. The first text query would have made
`?q=black&sort=price-asc` return a different, differently-ranked set from `?q=black` — a sort control
that silently changes the result set.

Fixed by **omission rather than addition**: `CATALOG_SHARED_SETTINGS` is the primary's object minus
`customRanking`, so a setting added by a later phase cannot be forgotten for the replicas.

**2. `_highlightResult` returns index text past `attributesToRetrieve`.** A query for `hoodie`
returned `{objectID, _highlightResult}` where the highlight carried `name`
(`"Heavyweight <em>Hoodie</em>"`), `materials` and `fit` — customer-visible index text, with markup, on
the one code path **D-37** says returns an id and nothing else. Closed with
`attributesToHighlight: []`. Rendering it would also have required `dangerouslySetInnerHTML`, which is
the Phase 10 **D-35** defect class.

**3. `attributesToRetrieve` is not a security boundary, and D-37's wording implied it was.** Measured
with the *public* search key alone, a per-request override returned `name`, `slug`, `priceFromMinor`
and `inventoryTotal`. Nothing confidential is exposed — `buildProductRecord` keeps drafts, scheduled
drops and withdrawn products out of the index entirely — but the guarantee is **staleness**, not
secrecy. `docs/ARCHITECTURE.md`'s D-37 entry is amended to say so, and
`unretrievableAttributes: ['inventoryTotal']` is added as the one setting here that genuinely cannot be
overridden.

That third one is the Phase 10 lesson again: *the docblock is the specification the next phase will
trust, and it is the only artefact nothing executes.*

### 1.17.2 §12.1a asked for nine searchable fields and four of them matched nothing

| Probe | Before | After | Answered by |
|---|---|---|---|
| `accessories` | 0 | 2 | category **name** |
| `essentials` | 0 | 5 | collection **title** |
| `black` | 0 | 1 | colour-family **label** |
| `Graphite` | 0 | 2 | variant display colour |
| `XL` / `ONE SIZE` | 0 | 6 / 2 | sizes |
| `brushed cashmere` | 0 | 1 | `shortDescription` |
| `merino hoodie` | 0 | 1 | `removeWordsIfNoResults: 'lastWords'` |

They are collapsed into **one** derived attribute, `searchTerms`, rather than five. Algolia's Attribute
ranking criterion is positional, so five entries would impose an arbitrary precedence between a
category name and a colour name — and every product carries all of them, so the ordering would be
noise outranking relevance. One `unordered(...)` bucket says what is true.

Slugs stay out: they are machine strings, and `categorySlugs` already covers the subtree for the
*facet*. `fit` and `materials` stay out because they are already their own attributes and repeating
them would double-weight them.

**The design pass caught a defect here that would have shipped as a settings-shaped fake control.**
`readCategoryParents` selected `{ parent, slug }` and `readCollectionMembership` selected
`{ products, slug, status }` — so every category name and collection title was `undefined`, and
`clean()` would have dropped them silently. Not an error anywhere: a searchable attribute that matches
nothing.

`removeWordsIfNoResults` deserves its own line because Algolia ANDs query words by default, so
`merino hoodie` returned **0** and returns **1** with `'lastWords'`. Without it, no-results would be
the most-visited state on the results page. The cost, recorded because Algolia gives no signal that it
happened: this is the one place the engine answers a slightly narrower question than the one asked.

**`medium` still does not match size `M`**, and no synonym map ships — **DEV-53**. An Algolia synonym
expands the query token *globally*, so `medium` → `M` would prefix-match Merino, Moss and Melton inside
`name`, the highest-ranked attribute, under the live `queryType: 'prefixLast'`. `XL`, `32` and
`ONE SIZE` are what customers actually type and all match.

### 1.17.3 D-38 — popular searches are curated, and the argument is data quality

The brief assumed Algolia Analytics was gated behind a credential. It is not: the existing write key
already carries the `analytics` ACL and `getTopSearches` returns data today. The decision rests on what
it returns.

The measured top search for this application was `{ search: '', count: 18 }` — the **empty string**,
eighteen times the next — because every faceted `/shop` request sent `query: ''` while Algolia's
`analytics` parameter defaults **on**. Several other recorded terms were engineer probes matching
nothing. Rendering that list would offer a customer a "popular search" whose only destination is the
no-results page: §0.1.17's fake control, arriving with official provenance.

So the terms are an editor-curated array on `site-settings`, **validated against the index** in one
batched multi-query with any zero-hit term dropped, and an empty surviving list means the section is
*absent* rather than empty. `indexSearchParams` now sends `analytics: false` for a browse, so the
corpus stops being polluted — the history already is, and Phase 25 must not read the early window as
customer behaviour.

Three details the design pass got right and were nearly missed:

- **The cache tag is `site-settings`, not `catalog`.** That is the tag `SiteSettings.afterChange`
  actually revalidates. Under `catalog`, an editor's save would have invalidated nothing that reads it
  while every unrelated product save flushed it constantly.
- **The terms are seeded.** `getPopularSearches` drops unvalidated terms, so an unseeded field means
  the section renders in zero environments — delivering the *field* rather than the *section*.
- **The heading is honest.** A curated list is not evidence of popularity; the admin field says so, and
  the validation is what stops it becoming a link to nowhere.

### 1.17.4 D-39 — the typeahead does not get its own data path

The obvious optimisation is to let the index return names and prices for suggestions, saving a database
round trip per keystroke. Refused, and the decisive text is not §12.1a's permissive *"return only safe
display data"* but feature matrix §2's failure row: *"deleted/unpublished product indexed stale:
product fetch validates current publish state before display."* A row rendered from index fields has
had no such fetch.

There is also a case no index-freshness policy can ever cover: a product that becomes unlistable
because the clock passed its `publishedAt` generates no write, so no sync hook fires. Only the
read-time clause catches it.

`rehydrateProductIds` is therefore extracted and called by **both** the grid and the panel — one path
from an id to a card. The cost is bounded by four mechanisms, three of them compliance rather than
optimisation: a two-code-point floor (§12.1d's *"empty query"* and *"1-character query"*), a 200 ms
trailing debounce, last-request-wins, and a per-session memo.

The debounce is the **only** request-reduction mechanism available: the SDK's Node build constructs its
transporter with `responsesCache: createNullCache()` and issues requests through `node:https` rather
than global `fetch`, so neither it nor Next's fetch cache can dedupe a repeated query.

A related correction: both engines now read with `overrideAccess: false, user: null` from one constant.
D-37's phrase *"the ordinary access-controlled `payload.find`"* was aspirational — the Local API
defaults to `overrideAccess: true`, so only the explicit `publishedProductWhere` clause was keeping
drafts out. The answer was right; the safety net was not there.

### 1.17.5 The results page is a third caller, not a second implementation

`q` joined the **one** `CATALOG_PARSERS` map, so `/search` renders through `CatalogPage` and inherits
feature matrix §2's four requirements — query in the URL, filters and sorting in the URL, a result
count, pagination — along with canonicalisation, the chips and Back/Forward.

The `/shop?q=` → `/search?q=` redirect is **composed into** the canonical redirect rather than layered
on top, because two redirects would break the fixed-point property `verify-catalog` check B2 asserts by
name and §1.16.11 records as the fix for Phase 11's highest-severity defect. Measured single-hop:

```
/shop?q=hoodie          -> /search?q=hoodie
/shop?q=%20hoodie%20    -> /search?q=hoodie
/shop/hoodies?q=merino  -> /search?q=merino&category=hoodies
```

The third is the one that needed thought: the route's category lives in the path, so moving to
`/search` without merging it would silently widen the customer's search to the whole catalogue.

**All four "clear" affordances were erasing the search.** `active-filters.tsx`, `catalog-toolbar.tsx`
and two in `product-grid.tsx` each built a fresh object carrying only `sort` — so on `/search` they
offered a customer who found nothing a link that threw away what they were looking for. They are in
three separate components and nothing typed-checked the omission.

`CatalogEmpty` also stopped inferring staleness from a non-zero total and took the flag the engine now
reports; and the shipped copy *"the search index has not caught up"* is gone, because structure §1 lists
search indexes among what a customer should never need to understand and the phase that owns search
should not be the one shipping the vocabulary leak.

### 1.17.6 Three defects a browser found in the panel

None was visible to typecheck, lint or any harness.

**Popular searches could never render.** The panel only fetched when a term reached two characters, so
the idle sections were markup that could never populate. The fix then failed a *second* time: the line
deriving `payload` still required a non-null term, so the idle response was discarded the instant it
arrived. Every unit was individually correct — endpoint, fetch, state write — and the one line
consuming them disagreed about what counts as a key.

**The ARIA tree and the keyboard model described different things.** Recent and popular searches were in
the flat option list the arrow keys walk but rendered as `<button>` rather than `role="option"`, so
`aria-activedescendant` pointed at ids not in the document. A dangling activedescendant is *silent*: the
attribute is set, nothing matches, and a screen reader announces nothing at all. axe agreed twice over —
`aria-required-children` (the listbox held groups, headings and buttons rather than options) and
`aria-required-parent` (options wrapped in `<ul>`/`<li>`, whose implicit list roles break the ownership
ARIA requires). Both critical.

Fixed by deriving the rendered groups from the same list the keyboard walks. Recorded cost: a product
suggestion is a `role="option"` div, so it cannot be middle-clicked into a new tab — ARIA does not
permit an interactive element inside an option, and the results page carries real anchors.

**The panel dropped popular searches during an outage** while `suggest.ts`'s docblock said the
unavailable payload still carried them. Found by the degraded pass. The code withheld unvalidated terms
on the theory they might dead-end — but during an outage they lead to the *designed*
search-unavailable state, so withholding them removed navigation §A.5 requires in order to avoid a page
that explains itself.

Three more, from the mechanics rather than the UI: three `setState`-in-effect errors were fixed by
**deleting the state** rather than suppressing the rule (`payload`, `pending` and `active` are all
derivable, which makes a stale payload under a new term unrepresentable); `payload run` does **not**
forward extra argv, so `reindex:check` had to become its own file or the command meant to *check* the
index would have *rebuilt* it; and `reindex:check` reported every field of every product stale
immediately after a clean rebuild, because `browseObjects` honours the index's
`attributesToRetrieve: ['objectID']` default like any other read. The check caught its own bug, which is
the argument for it existing.

### 1.17.7 The harness found a defect it had itself caused

`verify:search` is **200 checks**. On the first run with correct fixtures, eight failed —
`normaliseSearchTerm` was stripping almost nothing.

The character class had been destroyed two commits earlier by my own cleanup: the pass that removed
literal control characters from a docblock also ate them **out of the regex literal**, leaving
`/[-----]/`. That still compiled, still ran, and silently let zero-width spaces, bidi overrides and BEL
through into a term echoed back as a page title and a filter chip.

A regex with the wrong characters in it is not a syntax error. Typecheck, lint, the build and 144
catalogue checks all passed over it. Worse: the repo-wide *"0 files affected"* scan run to prove the
cleanup was safe returned zero **because** the escapes had been destroyed.

Both regexes are now built with `new RegExp` from a string of `\u` escapes — plain ASCII in the file,
unalterable by any formatter or patch script without the change being visible in review. The harness's
own fixtures went through the same failure twice (literals made the file binary; escapes were mangled
to empty strings, turning every assertion into `!term.includes('')`) and are built with
`String.fromCodePoint`.

The general lesson, and it is new: **a character can be destroyed by tooling without any gate
noticing.** Types describe shape, lint describes syntax, and neither can see that a character class is
missing its characters. Anything security-relevant expressed as a literal control character should be
expressed as a construction instead.

### 1.17.8 What was verified, and how

**`pnpm verify:search` — 200 checks.** Three halves in `verify-catalog.ts`'s shape: pure fixtures for
§12.1d's ten cases, the state machine's full 72-input cross-product, the byte clamp against ASCII,
emoji, CJK and combining marks, the URL contract and the index settings; then **real Payload
documents** — a nested category, a product, a variant and a collection — proving `searchTerms` carries
the category name, *every ancestor's* name, the collection title, the variant's display colour, the
colour-family label and the size; then a **live** section, gated on the integration, asserting
primary/replica parity on four settings, that a hit carries no `_highlightResult`, that stock is
withheld even when explicitly requested, and the six §12.1a probes.

It exists in that shape because **`verify-shell.ts` contains zero assertions about the search
overlay** — 676 lines, no match for "overlay". The panel's chrome was covered by a Phase 9 browser pass
and by nothing that runs at the gate, which raised the stakes on this harness owning the panel's pure
state machine outright.

No regression elsewhere: `verify:catalog` **144/144**, `verify:access` 45/45, `verify:media` 61/61,
`verify:shell` 100/100, `verify:home` 173/173. **723 checks across six harnesses.**

**Browser pass — 19 checks**, including the one that mattered most: re-searching from `/search?q=a` to
`/search?q=b` closes the panel. `overlay-context.tsx` closes on a *pathname* change, so a query-only
navigation does not close it; the shipped panel hid that by wrapping every link in `<DialogClose>`.
Also: the combobox contract, `aria-activedescendant` pointing at an element that exists, DOM focus
staying on the input, recent searches persisting, Escape, no horizontal overflow at 390px, and — twice —
that both `/search` and `/search?q=hoodie` render **with JavaScript disabled**.

**0 axe-core violations** across 14 surfaces: four results-page states and three panel states, each at
1440×900 and 390×844.

**Degraded pass**, with the three Algolia variables removed:

| Route | With index | Without |
|---|---|---|
| `/shop` | 10 | 10 |
| `/shop/clothing` | 8 | 8 |
| `?sort=price-asc` | 10 | 10 |
| `?priceMax=150` | 2 | 2 |
| `?availability=in-stock` | 9 | 9 |
| `/search?q=hoodie` | 1 | controlled state |
| `/shop?color=black` | 1 | controlled state |

The panel keeps categories, collections, recent and popular. `pnpm reindex:check` reports no drift.

### 1.17.9 What is now owed

- **Quick View, Quick Add and the wishlist control** are still deferred — **DEV-45** stands. A
  suggestion row links to the PDP and nothing else.
- **`/product/<slug>` still 404s** (Phase 13), so structure §12's flow cannot be demonstrated to its
  terminus. The same accepted state Phases 9, 10 and 11 recorded.
- **Dependent facets** — **DEV-49**. §1.16.10 assigned them to this phase; the reason for deferring is
  structural and is written out there.
- **No `metadata`, canonical or `noindex` on `/search`** — **DEV-50**, Phase 24. Redirecting `/shop?q=`
  here hands Phase 24 exactly one crawlable search namespace rather than two.
- **No rate limiting on the search path** — **DEV-51**, Phase 26. The floor, the debounce, the six-hit
  cap and the byte clamp are edge-case handling and cost control, **not** security controls, and the
  route handler's docblock says so.
- **No analytics events** — **DEV-52**, Phase 25. `analytics: false` on browse queries is diagnostic
  hygiene, not event emission.
- **`medium` does not match `M`** — **DEV-53**.
- **Typo tolerance reaches four characters or more** (`minWordSizefor1Typo: 4`; measured `hod` → 0,
  `hoodei` → 1). Feature matrix §2 names typo tolerance without qualifying it; this is the boundary.
- **The pre-existing analytics corpus is polluted** with `{search: '', count: 18}` and engineer probes.
  Phase 25 must not read the early window as customer behaviour.
- **Two Algolia cost questions** could not be answered from the installed package and should be sourced
  from Algolia's pricing documentation: whether a multi-request `client.search({ requests })` counts as
  one operation or N, and how `replaceAllObjects` is billed.
- **A cross-document discrepancy**, logged rather than resolved: feature matrix §35 cites
  `NORTH01_Claude_Implementation_Plan_Current.md`, a filename that does not exist in this repository.
  `AGENTS.md`'s precedence list is unambiguous, so nothing depends on it.


### 1.17.10 Post-implementation sweeps

Two adversarial passes over the committed phase, on deliberately different axes. **Six defects, all
fixed.** The seventh phase to run this exercise and the seventh to find things that had passed every
gate.

#### Sweep 1 — probing the runtime rather than reading the code

Five, and the first would have put a number on a page that meant nothing.

**A malformed URL escape reported a product count for a term nobody typed.** `?q=%E0%A4%A` is an
incomplete UTF-8 sequence, and `URLSearchParams` decodes it to `U+FFFD` + `%` + `A` rather than
throwing — so the `A` satisfied the letter test and `/search` rendered **"9 products"**. The
replacement character is the decoder saying it could not read the input; guessing at what was meant
and putting a count on the guess is worse than saying nothing. It now makes the term unsearchable.

**The "very long query" notice was dead code.** `canonicaliseParams` clamped the term, so the
redirect rewrote a 400-character paste to 256 bytes and `normaliseCatalogQuery` then saw an
already-short term with `truncated: false`. This is the **third** instance of one mistake — the same
one canonicalisation deliberately avoids for unknown facet values and for reversed price ranges, both
of which have paragraphs explaining why the evidence must survive the redirect — made in the one
place nobody checked. Canonicalisation no longer clamps.

**`/search?q=` did not canonicalise**, while `/shop?q=` did: two routes disagreeing about one rule,
and four URLs for one page. The landing branch returns before `CatalogPage`'s redirect, so it needed
its own.

**A dead control in the unavailable state.** `CatalogUnavailable` rendered "Clear filters"
unconditionally, so on `/search?q=hoodie` with no facets it pointed at the page the customer was
already on — the shape Phase 11's audit found in `activeFilterChips`, and that component's own
docblock warns about it. It is now withheld when there is nothing to clear, and always for
`scope: 'search'`, because the term itself needs the index so clearing a colour leaves the same
unavailable page. Its label was also `scope === 'search' ? 'Clear filters' : 'Clear filters'` — an
identical-branch ternary that typecheck and lint are both structurally blind to.

**The panel had no loading state**, which feature matrix §2 lists by name under *Live results*.
`pending` was computed and used only to *suppress* the empty message, so `SEARCH_COPY.loading` was
defined, documented and unreachable — a customer who typed saw a blank panel until the response
landed.

#### Sweep 2 — checking claims against the running application

One defect, and it was found by a test that **passed**.

`syncTaxonomyRename` was exercised end to end for the first time, through the admin API against the
running app, because the hook cannot fire under the CLI. Renaming *Hoodies* updated the product's
`searchTerms` and the new name was searchable within seconds. Renaming the **grandparent**
*Clothing* also worked, two levels down — better than the docblock hedged.

Checking *why* is what found the defect. The `where` was
`{ or: [{ categories: { equals: id } }, { 'categories.parent': { equals: id } }] }`, which reaches one
level. It succeeded two levels down only because **the seed tags every product with its full ancestor
path** (`[hoodies, tops, clothing]`), so the direct clause matched. Nothing in the schema requires
that convention, and `withAncestors` exists precisely because a product may be tagged with only its
leaf.

Proved by construction: re-tagging the product with `[hoodies]` alone and renaming *Clothing* again
would have missed it. The hook now resolves the subtree explicitly — one extra read of a collection
`Categories.ts` describes as a *shallow tree* — and the leaf-only case was then verified to pass.

**The lesson is the one worth keeping.** A green test is not evidence that the mechanism under test is
the mechanism doing the work. The rename test passed twice before it was correct, and would have kept
passing until a merchandiser tagged a product the way the schema allows and the seed does not.

#### What the sweeps say about the gates

Every one of the six was invisible to typecheck, lint, the build and 200 harness checks — and five of
the six were invisible to a *reading* of the code, because each was a disagreement between two places
that were individually reasonable. Four categories, all previously named in §1.15.12 and §1.16.11:

1. **Types describe shape, never meaning.** A conditional with identical branches type-checks.
   `U+FFFD` is a letter-adjacent character to a regex and a decoding failure to a human.
2. **A harness meets the fixtures its author imagined.** No fixture carried a replacement character,
   because nobody types one.
3. **A browser and a running application are where state over time lives.** The loading state, the
   dead link and the rename hook all needed something to happen *after* something else.
4. **The gates cannot check the machine's account of itself.** Two of the six were docblocks
   describing a mechanism that was not the one running.

`verify:search` is **209 checks**, up from 200, with a regression for every finding the pure modules
can hold. Full sweep after both: **732 checks across six harnesses**, 19 browser checks, 0 axe
violations across 14 surfaces, no index drift, and the degraded pass re-run to confirm the dead link
is gone and browsing is untouched.


## 1.18 Phase 13 — product detail page

Plan §13.1a–§13.1f. The page every link in the storefront has pointed at since Phase 9, and the first
one where a customer chooses something.

**No dependencies added.** Everything here is Radix, nuqs, `MediaImage` and Payload, all present
since Phase 8.

### 1.18.1 The route that had 404'd since Phase 9

`documentHref('products', slug)` has returned `/product/<slug>` since Phase 9. The homepage rails, the
mega menu's featured products, the shop grid, the search suggestions and the search results page all
resolve their links through it, and until this phase **every one of those links 404'd**. Phases 10, 11
and 12 each recorded it under *"what is now owed"*. It is closed.

**One 404 for four different absences.** A slug that does not exist, a draft, a drop scheduled for
next week and a product whose every variant has been withdrawn all return `null` from `getProduct`
and land on the same page. That is not laziness about error states — `publishedProductWhere` is the
**single definition of listable**, shared with both catalogue engines and the search indexer, so a
product that cannot appear in a listing cannot be reached by typing its URL either. There is no back
door around the rule, and the 404 leaks nothing: an unpublished product and a nonexistent one are
indistinguishable from outside, which is what stops a URL being a way to enumerate next season's line.

Verified against real documents rather than reasoned about: the harness publishes a product, reads it
by slug, sets `status: 'draft'` and reads again, then sets `publishedAt` a week out and reads a third
time. **1, 0, 0.**

### 1.18.2 §13.1c is a rule, so it lives in a module the harness can import

`lib/product/variants.ts` imports nothing from Next and nothing runnable from Payload. It is the same
split every phase since 9 has kept, and it is what lets `pnpm verify:product` walk plan §13.1c's whole
combination table without a browser, a request or a database.

**The plan's own example is a named check.** §13.1c states it concretely — *"if Black / M exists but
Cream / M does not: Black selectable, Cream M disabled, do not permit submission of Cream / M"* — so
the harness asserts it concretely, in seven checks. A screenshot of a customer who happened to pick a
combination that works proves nothing about the one that does not.

**Colour falls back; size does not.** This asymmetry is the phase's one real design decision. A stale
link carrying an unknown colour resolves to the first colour with stock, because a product page with
no colour selected is a page nobody can buy from. A stale link carrying an unknown **size** resolves
to *no size* — picking a size on a customer's behalf is how somebody ends up buying the wrong one. A
colour is a way of looking at the product; a size is a commitment. Both cases set `invalidSelection`,
and the page says *"That combination is not available — showing what we do have."*

**Three states, not two.** `active: false` is withdrawn and does not appear at all; `inventoryQuantity: 0`
is sold out and appears, listed, struck through, with *"Sold out in this size"*; a combination that was
never made is `missing` and reads *"not made in this colour"*. Collapsing any two of those would lose
the information a shopper most wants — whether the garment is made in their size at all.

### 1.18.3 The join would have shipped a size selector missing its last size

`products.variants` is a Payload `join` field. A join populates at a fixed `defaultLimit` with no
control over which columns come back, which is fine for a card and wrong for a control whose entire
job is to be **exhaustive**: a product with more sizes than the join's page would render a size row
silently missing its last size, and nothing in the page would look broken.

So `readVariants` is one explicit query — `pagination: false`, `limit: 500`, sorted by the
merchandiser's `sizeSortOrder` — and the question does not arise. This is the same reasoning Phase 11
applied when it found that a `join` has no column and therefore cannot be *filtered* on; here the
problem is not the filter but the page size.

### 1.18.4 What is not on this page — DEV-55

Structure §7 puts **Quantity**, **Add to Bag**, **Buy Now**, **Wishlist** and reviews on this page.
None of them ships, and none of them can: the cart is Phase 14, checkout is Phase 17, the wishlist is
Phase 20 and reviews are Phase 21. §13.1f is itself explicit that an empty star histogram must not be
shown, and a catalogue with no reviews is exactly that state.

What ships in their place is **a sentence, not a disabled button**. A greyed-out *Add to Bag* still
reads as a broken shop rather than an unfinished one, and §0.1.17's rule is about not implying the
capability at all. The selector already resolves and exposes the exact variant Phase 14 will need, so
the controls slot in beneath it without the page being rebuilt. Recorded as **DEV-55**.

### 1.18.5 A `role="radiogroup"` is a promise about the keyboard, and three of them were not keeping it

Found in the pre-commit read, on code that had already passed typecheck, lint, the build, 49 harness
checks, 25 browser checks and an axe sweep reporting **zero** violations.

The colour row, the size row and the gallery thumbnails all rendered `role="radiogroup"` with
`role="radio"` children and a roving `tabIndex` — and **no arrow-key handler**. Roving `tabIndex` is
only half of the ARIA 1.2 pattern, and it is the half that takes something away: it leaves the group a
single tab stop and marks every other option `tabIndex={-1}`. Without the arrow keys that supply the
other half, those options are not reachable by keyboard **at all**.

On the size row it was worse than that. Before a size is chosen nothing is selected, so *every* option
carried `tabIndex={-1}` and the entire control was skipped by Tab. That is the state every arrival
from the shop is in.

| Group | Before | After |
|---|---|---|
| Colour | 1 of 2 reachable | 2 of 2 |
| Size (no selection) | **0 of 5 reachable** | 5 of 5 |
| Gallery thumbnails | 1 of *n* reachable | *n* of *n* |

**Why every gate missed it.** axe tests the DOM as it stands, and the DOM was correct — one tab stop,
correct roles, correct `aria-checked`. What was missing was a *behaviour over time*, which is
§1.17's category 3 almost word for word: *"a browser and a running application are where state over
time lives."* The harness missed it because there was nothing to import; the arithmetic did not exist
yet.

**The fix, and the one place it departs from ARIA.** `lib/product/roving.ts` holds the index
arithmetic — both axes, because `flex-wrap` turns one row of sizes into two on a phone and a customer
whose row has wrapped reaches for Down before Right; wrapping at the ends, because a radio group is a
closed set; and `tabbableIndex(-1) === 0`, which is the fix for the unreachable size row stated as a
function.

ARIA's radio pattern ordinarily **selects on arrow** — focus and selection travel together. This
selector does not, and the reason is `shallow: false`: every selection is a server round-trip that
re-resolves the variant, the price and the stock message. Arrowing across six sizes to reach the
seventh would fire six navigations and leave the customer looking at whichever landed last. So arrows
move focus and **Space or Enter commits** — the manual-activation variant ARIA describes for controls
whose selection has a real cost — and `aria-checked` therefore continues to mean *selected* rather than
*focused*. The gallery thumbnails keep selection-follows-focus, because changing which photograph
shows is client state and costs nothing.

**Unavailable options are visited, not skipped.** That is the whole point of `aria-disabled` over
`disabled`: a keyboard user arrives at XS, hears *"XS, sold out in this colour"*, and learns exactly
what the strike-through tells a sighted customer. Measured across the five sizes of a colour with one
gap: `false,false,false,false,true` — every option visited, including the one that cannot be bought.

Regressions: **11 harness checks** on the arithmetic and **19 browser checks** on the wiring, including
that arrowing fires no navigation, that Space on an unavailable size changes nothing, and that Tab
still leaves the group.

### 1.18.6 The gallery has never rendered a photograph, and that is a data gap rather than a defect

The media library on the development database is **empty — zero documents** — and by design:
`scripts/seed.ts` creates no assets, because plan §6's brief is content only and Phase 8 built the
placeholder path precisely so an empty library renders a deliberate neutral box at the right aspect
ratio. The seed's homepage composition already adapts to this, writing six sections instead of ten.

The consequence for this phase is worth stating plainly rather than leaving to be discovered: with no
media, every product has one gallery frame and that frame is a placeholder, so **§13.1a's thumbnail
row, the snap scroller's movement between frames, and zoom of any frame but the first have never
rendered.** The single-frame path is exercised — the scroller, the zoom dialog and the placeholder all
behave — and the thumbnails' keyboard arithmetic is covered by the harness, but the multi-frame
gallery is owed a pass against real assets. Recorded in §1.18.9.

It also means the storefront's photography is uniformly absent, which has been true since Phase 10 and
is not something this phase changed.

### 1.18.7 Three smaller decisions

**Shipping & Returns comes from `site-settings`, not from the product.** `SiteSettings.ts` says so in
as many words, and gap **G-08** already records that the dedicated `/help/*` pages must render these
same fields rather than a second copy. A per-product shipping policy is a promise an editor can make
in one place and forget in ninety. `CatalogSettings` gained the two fields; the page reads them from
the same cached settings object every other surface uses.

**An accordion that opens onto a gap is a fake control wearing a chevron.** Every one of §13.1e's five
panels is conditional on having content, and the rich-text ones go through `hasProse` rather than
`!== null` — an editor who selects a body and deletes it leaves a Lexical root containing one empty
paragraph, which is truthy. That is the Phase 10 defect, brought forward as a rule.

**The size guide is a `<table>`, and its cells are found by label.** Measurements are two-dimensional
data, so real `<th scope>` on both axes. `SizeGuides` stores labels per row rather than once per guide,
so the header comes from the first row and every cell is then looked up **by label** — a row that lists
its measurements in a different order still lands in the right columns, and a row missing one renders
an empty cell instead of shifting everything left. Verified at 1440×900 and 390×844: five rows, columns
`SIZE / CHEST (CM) / LENGTH (CM)`, no horizontal page overflow, zero axe violations.

### 1.18.8 What was verified, and how

| Surface | Evidence |
|---|---|
| §13.1c's combination table | 60 harness checks, including the plan's Black/M–Cream/M example by name |
| The page in a browser | 25 checks — disabled sets differing by colour, sold-out and low-stock copy, invalid queries, price movement, URL round-trip and Back |
| Keyboard | 19 checks across the two variant rows |
| Accessibility | 0 axe violations across 14 surfaces, plus the size-guide dialog at two widths |
| Draft / scheduled / withdrawn | real documents, created and deleted under the **D-10** guard |
| The rest of the storefront | `verify:search` 209, `verify:catalog` 144, `verify:shell` 100, `verify:home` 173 |

### 1.18.9 What is now owed

- **Add to Bag, Buy Now and Quantity** — Phase 14 and Phase 17. The variant is already resolved for them.
- **Wishlist** — Phase 20. **Rating, review count, distribution and entries** — Phase 21, and §13.1f's
  "be the first to review" state with it.
- **A multi-frame gallery pass against real assets** — thumbnails, swipe between frames, zoom of a
  frame other than the first. Blocked on the media library having anything in it (§1.18.6).
- **A merchandised colour order** — `ProductVariants.ts` has a `sizeSortOrder` and no colour
  equivalent, so the swatch row is alphabetical. That is stable and explicable; it is not a
  merchandiser's choice. Needs a field on the collection.
- **A captions field on `Media`** — a product video carrying speech cannot be captioned today, which
  is a WCAG 1.2.2 failure waiting for the first video to be uploaded.
- **SEO metadata and product structured data** — Phase 24. `seoField()` is already on the collection.
- **`generateStaticParams`** — a Phase 30 question, and not obviously right for a page that reads live
  stock.

### 1.18.10 Post-implementation sweeps

#### Sweep 1 — driving the page instead of reading it

Four findings. One was caught in the pre-commit read and shipped fixed inside the phase commit
(§1.18.5); the other three needed a **production build**, because two of them do not exist in
development at all.

**1. A history entry can render content that describes a different URL.** The serious one.

Click one size, then another before the server has answered the first. The URL ends on the second,
correctly. Press Back: the address bar says `?size=XS` and the page shows **no size selected**, with
*"Choose a size to see availability"* under a URL that names a size.

`history: 'push'` writes the entry synchronously; the render that belongs to it arrives later. When a
second push supersedes the first before its render commits, the intermediate entry keeps the tree that
was on screen when it was created — so the customer walks back into content that is not what the URL
asks for. It is what the App Router's client cache does with an entry that never received a render,
not something specific to this code.

Measured against `next start`, not `next dev`:

| Route | Fails from | Notes |
|---|---|---|
| `/product/<slug>` | **400 ms** between clicks | three queries per render, so the widest window |
| `/shop/<category>` | 150 ms | |
| `/shop` | 150 ms | the cheapest render, and still reachable |

**This is not a Phase 13 regression.** The pattern is Phase 11's, and `/shop` has had it since
`filter-controls.tsx` was written; it went unnoticed because the probe that would have caught it
compared two filter states that happened to return the same eight products, and because the shop's
render is fast enough that a human rarely wins the race. The product page made it visible by being
slower.

The fix is to stop creating the entry: while a navigation is in flight the customer has not **seen**
the state they are leaving, so it is not a place to come back to, and the write becomes a `replace`.
As soon as the server answers, `push` resumes and deliberate selections get their own entries —
feature matrix §5's requirement is preserved exactly where it means something. `components/url-state.tsx`
now owns that rule and the three write options that were previously written out twice; nuqs's
`startTransition` is what makes "in flight" mean *the server has not answered* rather than *the URL
has not changed*.

Measured with a probe that walks the entire history in **both** directions and asserts that every
entry renders what its URL claims:

| | Product page | Catalogue |
|---|---|---|
| Before | **2/5** | not measurable with the old probe |
| After | **5/5** | **8/8** across `/shop` and `/shop/clothing` |

Two of my own probes were wrong before the code was, and both failed in the direction that invents a
defect: one read the selector one history entry behind because it stopped waiting as soon as two
samples matched — which they did, because the navigation had not started — and one declared the fix
broken because Back now lands on the original page rather than on an entry that should never have
existed. The second is the more instructive: **a probe that asserts the old behaviour will call the
fix a regression.**

**2. Closing the zoom viewer dropped focus onto `<body>`.** A keyboard customer who opened a
photograph and pressed Escape landed at the top of the document with the whole page to tab through
again — WCAG 2.4.3.

Radix returns focus to whatever opened a dialog, but only when it knows what that was, which means a
`DialogTrigger`. The viewer has none: it is opened from whichever frame was activated, so there are as
many triggers as there are photographs. The size guide, which does have a trigger, was correct all
along — the two behaved differently and the difference was invisible in a screenshot. Fixed by
remembering the frame and restoring focus in `onCloseAutoFocus`.

**3. The product video shipped an empty `<track kind="captions" />`.** `src` is required on that
element, so the markup was invalid, nothing was ever loaded, and it asserted the existence of a caption
track that does not exist. Lint did not ask for it — removing it leaves `--max-warnings 0` clean — so
it was defensive and wrong. `Media` has no captions field for one to point at; a product video carrying
speech would fail WCAG 1.2.2, and closing that needs a field on the collection rather than an empty
element on the page. The video also gained an accessible name, which it had never had.

Never rendered today, because no product has a video. That is exactly why it survived every gate.

**Two findings that were not findings.** The accordion appeared to have no `aria-controls` — it has
one; Radix adds it when the panel exists, and the probe read a collapsed trigger. And an intermittent
`performance.measure` console error on `/shop/<category>` is Next's development-only React
instrumentation emitting a negative timestamp; zero console errors in four scenarios in development
and none in production. Both are recorded because a sweep that only lists confirmed defects hides how
often the instrument is the thing that is broken.

#### Sweep 2 — checking the docblocks against the running application

Five findings. Four of them are a sentence in a comment that was not true of the code beneath it,
which is the same category §1.17.10 named after Phase 12 and the reason this sweep exists.

**1. The swatch row's order depended on which sizes each colour came in.** `variants.ts` said
*"colour order follows first appearance, which is the merchandiser's `sizeSortOrder`-sorted read"* —
and `ProductVariants.ts` has **no colour order field**, so there was no merchandiser's order to
follow. What the code actually did was take first appearance from a read sorted by size, which means
a colour made only in XL sorts behind one made in XS, for a reason no customer can see.

Worse, the read was `sort: ['sizeSortOrder', 'size']`, and two colours in the same size are a tie that
query does not break. The order was whatever Postgres returned — stable in practice today, and stable
only until an UPDATE moves a tuple or the planner picks a parallel scan.

That is not cosmetic, because `selectedColor` falls back to *the first colour with stock*: an unstable
row means **the default colourway of the product page can change between requests**. Fixed in two
places — the read is now totally ordered (`sizeSortOrder, size, color, id`) and the swatch row is
sorted alphabetically, which is the only order the schema can justify and is independent of stock. A
real merchandised order needs a field on the collection and is recorded as owed.

**2. `PRODUCT_IMAGE_SIZES.recommendation` existed from the first commit of the phase and nothing
imported it.** The row is built from `ProductCard`, which hard-coded the shop grid's string — a
narrower card that sits beside a filter rail. Measured, it promised the browser **244px for a card
laid out at 313px**: a 22% *under*-claim, the direction that costs picture quality rather than bytes,
because the browser fetches a rendition too small and the card is upscaled. `ProductCard` now takes
`sizes` as a prop, defaulted to the shop grid.

A constant that is never imported is not a decision. It is a comment that type-checks — and the
harness's *"every product sizes string is present and non-empty"* passed on it happily.

**3. Then the same measurement was pointed at every other `sizes` string, and four more were wrong.**

The instrument is worth more than the findings: it resolves a `sizes` string the way a browser does —
walking the media conditions with `matchMedia`, converting the winning value to pixels with a probe
element — and compares the answer to the box the element is actually laid out in, on six pages at ten
viewport widths. `MediaImage`'s placeholder carries `data-sizes` so this stays measurable while the
media library is empty, which it is.

| String | Was | Measured | Worst error |
|---|---|---|---|
| product gallery, bottom tier | `100vw` | 92vw, then `100vw - 2.5rem` | **+14% at 320** |
| product gallery, fixed tier | `742px` | 756px at 1440 | −2% |
| shop card, bottom tier | `44vw` | `46vw - 12px` / `50vw - 32px` | +10% at 320 |
| shop card, 3- and 4-up tiers | `21vw`, `17vw` | container **minus 353px** of rail and gaps | +6% |
| category / product / social tiles | `328px`, `23vw`, `31vw`, `48vw` | 301px, `23vw - 30px`, … | **+20% at 320** |

Every one of them is the same mistake in the same place: **the last tier, the one with no media
condition attached to it.** `sizes` is read left to right and the final entry is the fallback, so it
is the tier nobody re-derives — and for anything inside `PageContainer` it is the tier where the
container's `clamp(1.25rem, 4vw, 4rem)` padding stops being proportional and becomes a subtraction. A
single `vw` figure can only be right in one of that clamp's three regimes.

Phase 10's audit corrected two of these strings and wrote *"a `vw` unit measures the viewport; every
one of these elements lives inside a container"* — and the bottom tiers still said `100vw`. Knowing
the rule is not the same as having applied it everywhere.

After: **seven distinct strings, none off by more than 2%**, at every page and width measured. The
shared container arithmetic now lives once, in `lib/media/grid.ts`, instead of being rounded to a
plausible `vw` three times. Each of the three harnesses gained the rule the finding generalises to:
*a string may end in a bare `100vw` only if that surface really is the viewport* — three surfaces on
the homepage qualify, one on the product page, none in the catalogue.

**4. The size guide's central promise lived where nothing could execute it.** The dialog's docblock
said *"the cells are looked up by label rather than by position, so a row that lists its measurements
in a different order still lands in the right columns"* — a real risk, because `SizeGuides` stores
measurements per row and nothing makes two rows agree on order. The rule was correct. It was also
inside a component, which is the one place this project's rules are not allowed to live.

Moved to `lib/product/size-guide.ts` and given **nine regressions**, including the case the sentence
describes: a row whose measurements are entered Length-then-Chest still renders 101 under Chest. A
positional read would print one row's lengths under another row's chests — numbers that look right
and are wrong, on the page a customer uses to decide what fits.

**5. `pagination: false` does not make `limit` decorative.** `readVariants` passes both, and the
comment treated 500 as a headroom figure. Measured: a `pagination: false` read with `limit: 2` returns
**two rows**. So it is a real cap on the one control whose entire job is to be exhaustive — the exact
failure the explicit read exists to avoid, reintroduced by the guard against it. 500 is far beyond any
real garment, so it should never bind; it now logs if it ever does, because *should never* and
*cannot* are different words and only one of them is checkable.

#### Claims that held

Worth recording, because a sweep that lists only failures makes the codebase look worse than it is:
the nuqs adapter really is scoped — the homepage ships none of it; Shipping & Returns really is one
policy from `site-settings`, byte-identical across three products; the gallery really is one list laid
out two ways, a snap scroller at 390px and a vertical stack at 1440; a product in no category really
does fall back to the curated catalogue and exclude itself, verified against a real uncategorised
document; and the price range really is scoped to the selected colour.

#### What the two sweeps say about the gates

Nine findings across the two, and the pattern is sharper than Phase 12's:

1. **Three of them were only visible in a production build.** The history-entry defect does not
   reproduce under `next dev` at any click speed a person can achieve.
2. **Three were a sentence that was true of an earlier version of the code, or of no version.** The
   merchandiser's colour order never existed; the caption track never loaded; the `sizes` tiers were
   derived once and then re-rounded.
3. **Two were rules living in components**, where this project's own architecture says rules may not
   live — and both were invisible for exactly that reason.
4. **Two of my own probes were wrong before the code was**, and both invented a defect rather than
   hiding one. A probe that asserts the old behaviour will call the fix a regression.

The most useful artefact is not a fix but an instrument: resolving every `sizes` string the way a
browser resolves it and comparing it to the rendered box turns a class of defect that three phases
had each corrected by hand into one a machine can find in ninety seconds.

`verify:product` is **80 checks**, up from 49 at the phase commit. Full sweep after both:
**719 checks across five harnesses**, 119 browser checks, 0 axe violations across 14 surfaces, and
every `sizes` string within 2% of the box it describes.

## 1.19 Phase 14 — cart system

Plan §14.1a–§14.1e. The phase that turns a catalogue into a shop, and the only one in the corpus whose
prompt asks for tests by name: *"add unit tests for every cart calculation and merge edge case."*

**No dependencies added.** The schema was already there — `Carts.ts` and `CartItems.ts` were written in
Phase 6 and have waited eight phases for a writer.

### 1.19.1 Phase 6 had already made the hard decisions, and they held

Reading those two collections before writing a line of this phase was the highest-value hour in it.
Three of their choices are load-bearing and none needed revisiting:

- **No totals on `carts`.** Not subtotal, not discount, not tax. §14.1d requires every one of them to
  be computed server-side, and a stored subtotal is a cached answer that goes stale the moment a price
  changes — which §14.1e lists as an edge case the bag must *notice*.
- **No price snapshot on `cart-items`.** Same reasoning, one level down. *"Product price changed"* is
  only visible if the price is read live, so every line renders today's number. The freeze happens once,
  at `order-items`, and only after payment.
- **`(cart, variant)` is a unique index.** That is §14.1b step 5 — *"resolve duplicate items by summing
  quantities"* — expressed as a constraint rather than a convention. Verified against the real database:
  a second line for the same variant is refused. Without it a double-tapped Add button produces two
  lines and every total is quietly wrong.

The collections also close customer write access entirely, so `lib/cart/cart.ts` is the **only** door
onto these tables and runs with `overrideAccess: true`. That is the opposite posture from the
catalogue reads, and deliberately: reads there are *for* the browser, writes here are *about* the
browser's request and never take its word for anything.

### 1.19.2 §14.1b, all seven edge cases, as fixtures

`lib/cart/rules.ts` imports nothing from Next or Payload, so the merge can be exercised with two bags,
a stock change and a deleted product in the same fixture. All seven of §14.1b's named edge cases are
named checks:

| Plan's words | What happens |
|---|---|
| Customer has no cart | the guest cart is **claimed** — one `customer` write, no line copying, no ids changing |
| Guest cart empty | nothing to do |
| Customer cart empty | the merge is the guest's lines |
| Same variant exists in both carts | quantities **summed**, then clamped |
| One variant becomes unavailable during merge | dropped and reported |
| Quantity exceeds stock after merge | reduced to stock and reported |
| Product deleted while guest was browsing | dropped and reported |

**Summing happens before clamping, and the order is the point.** Two of three in one bag and three of
three in the other is a request for five, and five is what gets checked against stock. A merge that
clamped each side first would pass both checks and produce a bag holding more than the warehouse has —
which is exactly what *"quantity exceeds stock after merge"* is warning about.

**The customer's own lines lead.** Signing in should leave your bag with new things in it, not
reordered. The output is a pure function of its inputs, which is what lets the harness assert it.

Verified end to end in a browser as well: a guest fills a bag, registers (the bag is claimed), signs
out, fills a second bag, signs back in (the two merge into two lines with the customer's leading), and
then repeats with the *same* variant to confirm the quantities sum rather than duplicating. **9/9.**

### 1.19.3 §14.1d asks for five totals and exactly one can be true today

Subtotal, discount, shipping estimate, tax estimate, total. Promotions are **Phase 15**; shipping rates
and tax are **Phase 16**. So `cartTotals` returns the subtotal and **`null`** — not zero — for the other
three.

That distinction is the whole design. A discount of `0` says *no discount applies*; a discount of
`null` says *this phase does not know*. Rendering a confident `$0.00` beside *Shipping* would be plan
§0.1.17's fake UI in its most persuasive form, because a customer has no way to tell a computed zero
from a placeholder. So those rows are not rendered, the figure is labelled **Subtotal** rather than
**Total**, and one sentence says where the rest arrives.

`totals.isFinal` is what the summary reads to choose between the two. It is false while anything is
`null`, and it becomes true **without this component being edited** the moment Phases 15 and 16 assign
those fields. That is why the `null`s are in the type rather than the rows being commented out.

The one part of §14.1d's shipping estimate that *is* computable is §14.1e's shipping-progress message,
because it is a comparison against an editor's number in `site-settings` rather than a rate for a
destination. A threshold of zero means everything ships free — a shop's decision to make — and says so
rather than dividing by zero.

### 1.19.4 Reading a bag revalidates it, and does not repair it

§14.1e lists four edge cases that are one fact: the bag is a set of references and the world moves
underneath them. *Price changed. Product unavailable. Quantity unavailable. Two tabs diverge.*

`getCart` re-reads every variant live and clamps every quantity — but it **does not write the
correction back**. A page view is not a decision. The customer sees the truth with the reason beside
it, the stored rows are repaired on the next mutation, and checkout preflight (§17.1a) will do it
again. A read that silently edited the bag would mean a crawler could empty someone's cart.

Two clamps run per line, and confusing them was this phase's first real defect (§1.19.6).

### 1.19.5 Every control is a form

Add to Bag, both stepper buttons and the remove control are `<form action={serverAction}>`, not buttons
with `onClick`. A form is submitted by the browser itself when the script has not arrived, failed, or
been switched off — so the one control on the site that turns browsing into buying keeps working in the
condition where every other approach quietly does nothing. `useActionState` upgrades it in place: same
markup, same action, no second code path.

**No price crosses the boundary in either direction as an input.** §13.1d's *"never trust a
client-submitted price"* is satisfied by there being nothing to trust — the request carries a variant
id and a whole number, the server reads the price from the variant at the moment it writes, and
`cart-items` stores none.

### 1.19.6 Three defects found by running it

Two of the three were invisible to `typecheck`, `lint` and `build`.

**1. `A "use server" file can only export async functions, found object.`** `actions.ts` exported
`CART_ACTION_IDLE` beside its four actions, and every page rendering a cart control answered with a
**500** — at runtime. All three gates were green, because the rule is enforced by the server-actions
runtime rather than by the compiler. Found by clicking the button. The constant now lives in
`lib/cart/action-state.ts`.

**2. The `+` control was disabled on every line from the moment it was added.** `maxQuantity` was
computed by clamping the line's *current* quantity, which returns the current quantity — so
`quantity >= maxQuantity` was always true. Two clamps answer two questions: *may they keep what they
have?* (clamp the stored quantity; a difference is drift) and *how many could they have?* (clamp the
policy maximum; the answer is `min(stock, policy)`). Using the first for both is a rule that type-checks
and is wrong in one direction only.

**3. The new bag badge produced a horizontal scrollbar on every page of the site.** `IconButton` does
not position itself, so the badge's `absolute` resolved against an ancestor far up the tree and rendered
two pixels past the **document's** right edge. Measured at seven widths on the bag page; invisible in a
screenshot, because two pixels of white look like nothing. Fixed with `relative` on the trigger.

### 1.19.7 What was verified, and how

| Surface | Evidence |
|---|---|
| §14.1b's seven edge cases | 68 harness checks, each named in the plan's own words |
| Clamping, totals, shipping progress | fixtures for every bound, including the hard cap of 99 and a zero threshold |
| The schema's constraints | real documents: the unique index refuses a duplicate line, quantity 0 and 500 are both refused, deleting a cart cascades |
| The whole flow in a browser | 34 checks — add, drawer, stepper, remove, cookie flags, and that browsing alone issues no cookie |
| Sign-in merge | 9 checks against a real account: claim, merge, and sum |
| Accessibility | 0 axe violations across six new surface/width combinations |
| The rest of the storefront | shell 100, home 183, catalogue 147, search 209, product 80 |

### 1.19.8 What is now owed

- **Apply and remove a promotion** (§14.1c) — **Phase 15**. `carts.promotion` exists and is unused;
  `cartTotals` has a `discountMinor` field waiting for a number.
- **Shipping and tax** (§14.1d) — **Phase 16**. Same shape: two `null`s and an `isFinal` that flips on
  its own.
- **The Checkout control** — **Phase 17**. See **DEV-57**.
- **Save for later** (§14.1c) — listed as *"if implemented"*, and it is not.
- **An expiry sweep.** `carts.expiresAt` is set and honoured on read; nothing deletes an expired cart,
  and `Carts.ts` already recorded that the sweep is a maintenance task no phase has claimed.

### 1.19.9 Post-implementation sweeps

#### Sweep 1 — the bag under conditions the happy path never produces

Two defects, both found by making the world move underneath an open bag, and sixteen adversarial cases
that held.

**1. The bag rendered a quantity of 2 beside a subtotal charging for 1.**

Stock was dropped from 6 to 1 on a variant held twice in an open bag. Everything downstream was right —
the badge read 3, the subtotal was computed from the effective quantities, the drift banner appeared —
and the **line still displayed "2"**. The number on screen multiplied by the price on screen did not
equal the subtotal on screen.

The rule *"a read revalidates but does not repair"* is correct for the stored row: a page view is not a
decision, and a read that silently edited the bag would let a crawler empty someone's cart. It was
wrong for the **rendered** number. `CartLineView` now carries `effectiveQuantity` beside `quantity` —
what they will get, and what they asked for — the row renders the first, the steppers step from it, and
a reduced line says so in words: *"You asked for 2. Only 1 left, so that is what this line is for."*

The underlying mistake is the same one §1.19.6 records: **two clamps that answer two questions and have
identical signatures.** The harness now asserts that they diverge whenever the bag holds less than the
shelf, which is the shape of the confusion rather than one instance of it.

**2. An unavailable line linked to a page that 404s.**

Unpublishing a product with an open bag holding it leaves the line visible — which §14.1e wants — and
the line's product link pointing at `/product/<slug>`, which now returns 404, because
`publishedProductWhere` is the single definition of *listable* and the route honours it. A dead link
inside the bag, which is the one place a shopper is least willing to be sent nowhere.

The line now links only when `availability.productPublished` is true. The same defect class Phase 12's
sweep found in the search panel, in a different component, for the same reason: a surface that shows a
document keeps showing it after the document stops being reachable.

**What held.** Recorded because the adversarial cases are the ones worth knowing about:

| Attempt | Result |
|---|---|
| A forged 42-character cart token in the cookie | resolves to an empty bag; adding replaces it with a server-issued 43-character one |
| Rewriting our own form's `lineId` to another session's line, then submitting | the victim's line is untouched — `ownedLine` resolves the line's cart and compares |
| Re-enabling the disabled Add button in the browser and posting a sold-out variant | refused by the server, with *"Sold out in this size."* |
| Two tabs, one removing what the other still shows | the stale tab's mutation resurrects nothing, and it converges on a refresh |
| Double-tapping Add | **one** line, quantity two — the unique index and the increment agree |
| **JavaScript disabled entirely** | the form is in the HTML, carries a real variant id, and **submitting it adds to the bag** |

That last one is the claim `add-to-bag.tsx` makes in its docblock, and it is the kind of claim that is
usually false. It was tested by switching JavaScript off in the browser context, not by reading the
markup.

**The world moving underneath an open bag**, in five states, each measured against a bag holding three
lines at quantity two:

| Change | Bag after |
|---|---|
| Price 48000 → 39000 | the line shows **$390.00**; nothing is cached |
| Stock 6 → 1 under a line holding 2 | quantity **1**, drift banner, subtotal recomputed |
| Variant deactivated | line visible, *"No longer available"*, excluded from the subtotal |
| Product unpublished | same, and **no link** (after the fix) |
| Variant deleted outright | the line is gone, no crash, the rest of the bag intact |
| Cart expired | reads as empty, exactly as `Carts.ts` says |

#### Sweep 2 — checking the docblocks against the running application

Six findings. One of them is the most serious defect of the phase, and it was found by testing a
sentence rather than a feature.

**1. A signed-out visitor was handed the previous account holder's bag.**

`resolveCart` looked a cart up by token when `customerId === null || !found.customer`. The first half
of that condition means: *an anonymous request may resolve any cart its cookie names* — including one
that belongs to an account.

Measured: register a new account with no bag, add one thing while signed in, sign out. The header
still read **"Bag, 1 item"**, and `/cart` still listed it. On a shared machine that is one person's
bag shown to the next person who sits down.

The condition is now `!found.customer` alone: **a cart that has an owner is never resolvable by
cookie.** `logout` also clears the cart cookie now, which is the tidy half — a cookie is a guest
identity and a session that owned a cart should not leave one behind. The check does not depend on
the cookie being cleared, because a fix that relies on a second fix is one fix.

Verified: signed in **1**, after sign-out **0**, after signing back in **1**.

**2. The cart cookie decided `secure` by a different rule from the session cookie.** `payload.config.ts`
sets the session cookie's from `appEnv !== 'local'`; this module read `process.env.NODE_ENV` directly.
Two cookies on one site answering the same question two ways is how they come to disagree on the
deployment nobody tested — and reaching past `env.core` to `process.env` is the shortcut §1.9's audit
already found once. Now `appEnv`.

**3. "Prefixed like every other cookie this project sets."** There is no other cookie this project
names: the session cookie is Payload's `payload-token`, from its own default prefix. The sentence was
corrected rather than a cookie renamed to make a comment true.

**4. "A guest bag … is claimed rather than ignored" — the code only returned it.** No `customer` was
ever written. The consequence is real: a signed-in shopper whose merge did not run keeps filling an
ownerless cart that disappears with their cookies. The bag is now **claimed on a mutation** — `create`
is the flag that says the request is a decision — and still merely read on a read, which keeps the
module's *"a page view is not a decision"* rule intact.

**5. `LINE_LIMIT = 200` was a silent cap.** Exactly the finding Phase 13's second sweep made about
`VARIANT_LIMIT`, in a new file: `pagination: false` does not make `limit` decorative, so a bag that
reached 200 lines would render and **total** a truncated read. It now logs when it binds. That two
phases in a row produced the same shape suggests it is worth watching for in every read that pairs the
two options.

**6. "The action is idempotent per line."** It is not — adding increments, and Phase 14's first sweep
measured a double tap producing a quantity of two. That is the *correct* reading of two clicks, so the
behaviour stands and the justification was rewritten as the trade it actually is: a pending-disabled
button protects against a mis-click and costs a deliberate second click on a control whose whole job
is to accept them.

#### Claims that held

**The deferral really is only in the type.** `cart-summary.tsx` claims that when Phases 15 and 16
assign `discountMinor`, `shippingMinor` and `taxMinor`, the component *"starts rendering the rows and
the word Total without being edited"*. Tested by temporarily assigning `500`, `995` and `1234` in
`cartTotals`: the summary rendered a Discount row, a Shipping row, a Tax row and **Total $237.29** —
`$220.00 − $5.00 + $9.95 + $12.34` — and the *"calculated at checkout"* sentence disappeared. No
component was touched. Reverted.

*(One thing for Phase 16 to hold together: with a threshold met, the bag says "Standard delivery is
free on this order" while a simulated `shippingMinor` of `995` sat in the Shipping row. The
free-shipping message and the shipping amount are two renderings of one fact and must not be allowed
to disagree.)*

**Server actions really do refuse a cross-site call.** `actions.ts` claims Next's origin check makes
the action uncallable cross-site with the browser's credentials. Tested by capturing a real action
POST — `next-action` header and all — and replaying it from the same cookie jar with
`Origin: https://evil.example`: **500**, and the bag was unchanged.

**A page view really does not write a row.** Eight routes including `/cart`, opening the drawer on each:
no cookie issued and the `carts` table unchanged at 13 rows.

## 1.20 Phase 15 — promotions and discounts

Plan §15.1a–§15.1c. The phase that fills the first of Phase 14's three deferred totals.

**No dependencies added.** `Promotions.ts` was written in Phase 6 and its docblocks already said what
this phase would do — including two decisions this phase simply honoured rather than revisited.

### 1.20.1 Phase 6 had answered three questions this phase would otherwise have got wrong

- **`timesUsed` is not incremented here.** It moves in **Phase 17**, inside the transaction that
  finalises payment, for the same reason inventory does. Incrementing anywhere earlier means a code
  consumed by an abandoned checkout.
- **`perCustomerLimit` is not a counter.** It is compared against a **count of that customer's paid
  orders** carrying the promotion, which `orders.promotion` already answers exactly. A second counter
  would duplicate a fact the orders table owns and would be wrong the first time an order was
  refunded.
- **One code at a time is a schema property, not a rule.** `carts.promotion` is a single
  relationship, so §15.1c's *"multiple codes attempted"* is unrepresentable rather than forbidden —
  applying a second code replaces the first. **DEV-08**, confirmed.

### 1.20.2 The eight checks, and the order they are reported in

§15.1a lists eight and all eight are named checks. The order they run in is a decision: **only the
first failure is shown**, so it runs from *"this code is not for you"* to *"this code is not for this
bag"*, which is also least-to-most actionable. Expired beats under-the-minimum, because a customer
can add to their bag and cannot change a date.

**`inactive` and `unknownCode` produce the identical sentence.** Telling somebody that a code exists
but is switched off is telling them a code exists, and a form field that distinguishes the two is a
way to enumerate an unreleased campaign. Verified in a browser: an inactive code and `NOSUCHCODE`
return the same string, byte for byte.

**Currency constrains a fixed amount only.** A percentage is dimensionless — 10% off is 10% off in
any currency — and free shipping has no amount at all. Applying §15.1a's *"currency compatibility"* to
all three would fail a percentage code in a currency it works perfectly well in.

**The minimum is measured against the whole bag**, not the eligible subset, because
`Promotions.minimumSubtotalMinor` says in its own description *"compared against the subtotal before
shipping and tax"*. A code that says "spend 100" means spend 100, not "have 100 of qualifying goods".

### 1.20.3 Eligibility runs the other way round, and the join is why

`Promotions.eligibleCollections` names collections, and the obvious implementation reads
`product.collections` — which is a Payload **`join`**. A join is virtual and has no column, so it
comes back as a paginated `{ docs }` object rather than a list of ids, and a caller treating it as an
array gets an empty one: **a collection-scoped promotion that silently never applies.**

So membership is resolved from the owning side — `collections.products`, the ordered `hasMany` that
curation writes — and **only when the promotion names collections at all**, which most do not. Phase
11 learned the same thing about facets. It is the third phase to meet this join from a different
direction, and the first to meet it before shipping the bug.

### 1.20.4 Rounding is a decision, and the discount can never exceed what it discounts

A percentage of a minor-unit amount is rarely whole. `Math.round`, not `floor`: the discount belongs
to the customer, and flooring every percentage is a systematic fraction of a penny in the shop's
favour on every order that has one. Ten per cent of `1005` minor units is `101`, not `100`.

§15.1c names both overflow directions and both are clamped **against the eligible subtotal**, not the
bag's. A fixed code worth 5000 on a bag holding 20000 of ineligible goods and 2000 of eligible ones
takes 2000. The clamp is applied to percentages too, even though one at or below 100 cannot overflow
— the alternative is a rule that holds only while a validator elsewhere keeps `percentage` at or
below 100, and a discount larger than the bag is a negative total, which is a refund the shop did not
agree to.

### 1.20.5 The discount is re-decided on every read

Nothing about the *amount* is stored. `carts.promotion` records which code was chosen and that is
all, so §15.1c's *"expired code during checkout"* and *"code reaches usage limit between cart and
checkout"* cannot produce a stale discount — there is no stored number to go stale. A code that
stopped working stays visible in the bag with its reason beside it, and the customer removes it; the
bag does not quietly charge full price.

This is the same architecture `cart-items` uses for prices, and for the same reason.

### 1.20.6 The `server-only` guard was on the wrong module

`pnpm verify:promotions` failed on its first run with `ERR_MODULE_NOT_FOUND: Cannot find package
'server-only'` — the harness runs outside Next, where that package cannot resolve.

The fix is structural rather than a workaround. Everything that merely *reads* a promotion takes a
`Payload` instance as an argument and touches no cookie, request or secret, so it belongs in
`read.ts` with no guard — exactly how `lib/catalog/query.ts` sits beside `lib/catalog/catalog.ts`.
The guard belongs on the module that calls `getPayloadClient`, which is the two mutations. **A guard
on the wrong module does not make anything safer; it only makes it untestable.**

### 1.20.7 What was verified, and how

| Surface | Evidence |
|---|---|
| §15.1a's eight checks | 64 harness checks, each named in the plan's own words |
| §15.1b's four outputs | asserted individually, plus rounding, clamping and eligibility scoping |
| §15.1c's eight edge cases | all eight, including both overflow directions and case/whitespace |
| Real documents | the collection normalises on write, a lower-case padded lookup finds it, the unique index refuses a duplicate, and a percentage promotion with no percentage **cannot be stored** |
| The bag in a browser | 20 checks — apply, messy input, expired, under-minimum, inactive-equals-unknown, fixed amount, free shipping, remove, and the drawer showing the code without offering a second field |
| Accessibility | 0 axe violations across the six cart surfaces |
| The rest of the storefront | shell 100, home 183, catalogue 147, search 209, product 80, cart 72 |

### 1.20.8 What is now owed

- **`timesUsed` must be incremented** in Phase 17's payment transaction. Nothing does it yet, so a
  `usageLimit` is currently enforced against a counter that never moves.
- **Free shipping must actually make shipping free** — **Phase 16**. The code validates, records and
  reports itself today; the amount it affects does not exist yet (**DEV-60**).
- **Revalidation at checkout creation** (§15.1b) — Phase 17. The engine is ready; the caller is not.
- **A per-customer limit is unenforceable against a guest**, because the count comes from orders and
  a guest has none (**DEV-59**).
- **The seeded demo codes stay inactive.** `scripts/seed.ts` says why in one line — *"a live discount
  code in seed data is a live discount code"* — and this phase did not overrule it. The harness and
  the browser passes create their own and delete them.

### 1.20.9 Post-implementation sweeps

**No defects.** The first phase in this project where both sweeps came back empty, which is worth
examining rather than celebrating — see the note at the end.

#### Sweep 1 — the engine under hostile input

A discount is money, so the adversarial cases are the whole point. Sixteen checks, all of which held.

| Attempt | Result |
|---|---|
| `' OR 1=1 --`, `<script>alert(1)</script>`, a 500-character code, `../../etc/passwd`, `%00SWEEP`, whitespace only | each refused with a readable reason; nothing echoed unescaped |
| Applying a code that **exists but is switched off** | refused, with the sentence an unknown code gets |
| Reading what the form actually posts | **`["code"]`** — no amount, no promotion id, no eligibility |
| Applying a code, then emptying the bag entirely | no error; the bag says it is empty |
| …then refilling it with a **different** product | the code is re-decided against the new bag: `$165.00` subtotal, `−$33.00` |
| A code whose minimum exceeds the bag | refused, and specifically *"under the minimum"* rather than a generic failure |
| Two tabs, one applying and the other removing | the stale tab converges on refresh |

The refill case is the one worth keeping. The cart stores *which* code, never *what it was worth*, so
a bag that changes under an applied code produces a recomputed discount rather than a stale one —
and it did, from `−$44.00` on one bag to `−$33.00` on another, without the code being re-entered.

One probe was wrong before the code was: it counted React's own `$ACTION_REF_*` and `$ACTION_KEY`
fields as data the form posts. Filtering them is the difference between testing our form and testing
Next's.

#### Sweep 2 — the claims, and the one made on reasoning alone

**Collection eligibility was corrected during the build without ever being run.** §1.20.3 records the
reasoning — `product.collections` is a `join`, so it has no column and returns `{ docs }` rather than
an array, and a promotion scoped to a collection would have silently never applied. The fix reads
membership from `collections.products` instead. That is exactly the kind of change a sweep exists to
distrust, so it was measured end to end against a real collection:

| Bag | Code | Result |
|---|---|---|
| `cotton-tee`, a member of *Archive* | 50% off *Archive* | **`−$37.50`** off `$75.00` |
| `field-jacket`, not a member | same code | refused — *"does not apply to anything in your bag"* |
| both, `$555.00` | same code | **`−$37.50`** — only the eligible line is discounted |

The reasoning was right, and now it is also tested.

**Nothing about a promotion reaches the browser.** `promotions.ts` claims the page carries only the
code, the label and the amount. Checked against the rendered HTML with a code applied: no
`eligibleCollections`, no `eligibleProducts`, no `minimumSubtotalMinor`, no `usageLimit`, no
`perCustomerLimit`, no `timesUsed`, and not the promotion's id.

**A code at its usage limit is refused** — which also confirms the shape of what §1.20.8 records as
owed: the check reads `timesUsed`, and nothing increments it until Phase 17, so today it only binds on
a value an editor set by hand.

#### Why both sweeps were empty, which is not the same as the phase being perfect

Three reasons, in decreasing order of how much credit they deserve:

1. **The schema had already made the hard calls.** `Promotions.ts` was written in Phase 6 with
   docblocks that named this phase and told it what not to do — do not increment `timesUsed`, do not
   add a per-customer counter, do not model stacking. Three defects this phase never had a chance to
   write.
2. **The previous two phases' lessons were applied during the build rather than after.** The
   `'use server'` export rule, the `null`-versus-zero distinction, the two-clamps confusion, the
   pure/`server-only` split — each of those cost a sweep finding in Phase 14 and cost nothing here.
   The `server-only` guard was still on the wrong module (§1.20.6), but the harness caught it in
   minutes because the harness existed first.
3. **This phase has no new UI surface to speak of.** One text field and one remove button, both
   following patterns three phases old. Phases 13 and 14 each shipped a page; every sweep finding
   in both was in something rendered.

The honest reading is that the sweeps found nothing because the *cheap* defects had been made
already, in earlier phases, and their fixes were carried forward. It is not evidence that a sweep is
no longer worth running — it is evidence that the corpus of lessons is doing its job.

## 1.21 Phase 16 — shipping and tax boundaries

Plan §16.1a–§16.1d. The phase whose title is the deliverable: **boundaries**, built before the thing
that will consume them, so that Phase 17 has interfaces to call rather than decisions to make.

**No dependencies added**, and one deliberately not added — see §1.21.4.

### 1.21.1 The distinction the whole phase turns on

**A price is knowable without an address. Eligibility is not.**

The static provider's prices come from the *cart* — a threshold on the subtotal, a fixed amount — and
not from where the parcel is going. What the destination decides is whether we will send it there at
all. So a bag with no address can honestly quote a **price**, and must not claim **eligibility**.

`ShippingQuote.destinationKnown` carries that difference. When it is false every rate is
`eligible: true` because nothing has been ruled out — *not* because anything has been confirmed — and
the bag labels the row **"Delivery (estimated)"** and says why. §17.1a's preflight re-quotes with the
real address, which is what **DEV-11** already committed it to.

That is what makes it honest for the bag to show a number at all, which it now does: `$9.95` under
the threshold, `Free` above it.

### 1.21.2 §16.1d's coupon case, and the two surfaces that had to agree

> *"Free-shipping threshold crossed because of a coupon."*

A discount moves the subtotal, so the shop must decide which number the threshold compares against.
**The discounted subtotal.** A threshold is a statement about what the customer spends, and after a
coupon they spend less; comparing against the pre-discount figure would give delivery away on every
discounted order forever, measured against a number the customer never sees.

The consequence is visible and has to be: **applying a coupon can take free delivery away.** Measured
end to end — a `$555.00` bag with a 90% code becomes `$55.50` of spend, drops below the `$150.00`
threshold, and delivery reverts to `$9.95`.

The part that needed care is that **two surfaces read this number**: the rate, and the bag's
shipping-progress sentence. The sentence was reading the *raw* subtotal, which was correct until
Phase 15 shipped discounts and would have produced "Standard delivery is free on this order" printed
directly above a delivery charge. Both now read the same discounted figure, and the same measurement
confirms it: the message becomes *"$94.50 away from free standard delivery"* — `$150.00 − $55.50` —
at the same moment the rate returns.

Getting two surfaces from one number rather than two is the specific lesson §1.18.5 and §1.19.9 both
recorded, applied before the bug rather than after.

### 1.21.3 A free-shipping code waives Standard and nothing else — DEV-60 closed

Phase 15 validated `free_shipping` codes, recorded them and reported them, but had no rate to zero.
It has one now: `waivable` marks which methods a waiver may touch and **only Standard is marked**.

"Free shipping" means the delivery the shop offers as standard. A code that silently upgraded a
customer to Overnight would be a promotion nobody wrote, costing real money per order. Verified: a
free-shipping code takes a `$9.95` Standard rate to `Free` on a bag well under the threshold, and
leaves Express at `$19.95` and Overnight at `$34.95`.

### 1.21.4 The tax provider answers honestly and calculates nothing — DEV-61

§16.1c says Stripe Tax *"may be"* the initial provider. It is not this one, for two reasons that are
both phase order rather than preference: the Stripe SDK, its secret and its webhook all belong to
**Phase 17** and `AGENTS.md` forbids installing a later phase's dependencies early; and there is
**nothing to calculate**, because tax is a function of a destination and no surface in this
application collects one yet.

So `deferredTaxProvider` returns `pending_address` and says so. That is not a stub — it is the correct
answer to every question this application can currently ask. What it must never do is return `0`: a
tax amount of zero is a *claim that no tax is owed*, and a checkout acting on a zero that really meant
*unknown* would undercharge every order in a taxable jurisdiction.

`TaxResult.amountMinor` is therefore nullable while `status` is not, and the four statuses are
distinct on purpose: `calculated`, `not_required` (zero, and that zero is a fact), `pending_address`,
and `unavailable` (§16.1d's *"tax service unavailable"*). Phase 17 must be able to tell the last two
apart, because one may proceed to payment and the other may not.

The provider also refuses to guess **if it is one day handed an address** — it answers `unavailable`
rather than inventing a number. A deferral that quietly started guessing when its inputs improved
would be worse than one that never worked.

### 1.21.5 The harness found a design flaw in Phase 14's totals

`CartTotals.isFinal` required *discount, shipping and tax* all to be non-null. Writing the check
`cartTotals(line, null, 0, 0).isFinal === true` made it fail, and the failure was the code's rather
than the test's.

`null` had been doing two jobs: **"do not draw this row"** and **"this component is unknown"**. For
shipping and tax those are the same thing. For a discount they are not — a bag with **no code
applied** has `discountMinor: null` and a perfectly knowable total, because no discount contributes
nothing. As written, `isFinal` was unreachable for every bag without a promotion, which is most of
them, and the bug would have surfaced in Phase 17 as *"the total only appears when you use a coupon."*

`isFinal` now asks only about the components that can genuinely be unknown. Two regressions hold the
distinction.

### 1.21.6 What was verified, and how

| Surface | Evidence |
|---|---|
| §16.1a's normalised fields | 68 harness checks; every rate asserted to carry all six, plus a reason when ineligible |
| The static rate card | threshold, fixed prices, waiver scope, and the cheapest-eligible default |
| §16.1b's validation | the rate returned is the **quote's**, never the request's; a nonexistent method and an ineligible one give different reasons |
| §16.1d's six edge cases | all six, including *"address changes after shipping method selection"* as the same id revalidating against a new quote |
| §16.1c's contract | request and result shapes, the taxable base, and that neither `pending_address` nor `unavailable` can carry a zero |
| The bag in a browser | 7 checks — no quote on an empty bag, `$9.95` under the threshold, `Free` above it, the estimate label, and the footnote narrowing to tax alone |
| DEV-60 and the coupon case | 5 checks against live promotions |
| The rest of the storefront | shell 100, home 183, catalogue 147, search 209, product 80, cart 72, promotions 64 |

### 1.21.7 What is now owed

- **A real tax provider** — Phase 17, with Stripe Tax and an address (**DEV-61**).
- **A shipping-method selector.** Phase 16 quotes; nothing chooses. `validateSelectedRate` is built
  and tested for §17.1a's preflight to call, and `orders.shippingMethodCode` is waiting for its
  answer.
- **Re-quoting at checkout creation** with the real destination — §16.1b, and the reason
  `destinationKnown` exists.
- **Writing the authoritative amounts onto the order.** §16.1d's closing sentence; `orders` already
  has `shippingMinor`, `taxMinor`, `shippingMethodCode` and `shippingMethodLabel` waiting.
- **A rate card an operator can change.** It is code today (§16.1a's *"static provider"*), which is
  right for a demo and wrong for a shop that changes its delivery prices.

### 1.21.8 Post-implementation sweeps

#### Sweep 1 — the boundaries at their edges

One defect, and it is the kind a boundary phase exists to catch before anything downstream inherits it.

**`Math.max(0, Math.floor(x))` is not a clamp.** `Math.floor(NaN)` is `NaN` and `Math.max(0, NaN)` is
`NaN`, so the guard that appears in every money calculation in this project passes the poison straight
through. `taxableBaseMinor` returned **`NaN`** for a `NaN` subtotal — a value that would have gone to a
tax provider, and in Phase 17 to a payment processor.

The same input reached `quoteShipping` and came out clean, which was worse rather than better: it
survived because `NaN >= threshold` is false, so the comparison happened to fall the safe way and the
`NaN` never reached an output. **Luck is not a property worth relying on twice**, and it would have
stopped being lucky the first time somebody wrote a comparison the other way round.

Fixed at the class rather than the instance. `lib/money.ts` gained `toMinorAmount` — *not finite is
zero, negative is zero, fractional is floored* — and the three modules that handle money now share one
definition of what an unusable number means. `cartTotals`, `quoteShipping` and `taxableBaseMinor` all
go through it.

**Twenty-four other hostile inputs held**, and rather than leaving them in a scratch file they were
folded into `verify-shipping.ts`, which is now **93 checks**. A check that found a defect belongs where
it will be run again. Among them:

- A negative subtotal, a negative discount, a discount larger than the bag, and a fractional subtotal
  one cent short of the threshold all resolve to a sensible rate rather than a surprising one.
- A **negative** threshold is not read as "everything qualifies" — the check that would have made a
  misconfigured setting give delivery away.
- The default rate is **never an ineligible one**, at every destination and every threshold state, and
  is always the cheapest eligible rate rather than merely the first.
- `validateSelectedRate` refuses `''`, `'0'`, `'[object Object]'`, `'STANDARD'` and `'standard '` — an
  id is compared exactly, so case and padding cannot smuggle a method through.
- Every method appears in every quote, eligible or not: a hidden method can be neither chosen nor
  explained, and §16.1d's first edge case is about explaining one.
- **Shipping is added after the discount**, so a coupon can never discount delivery — a `$10.00` bag
  with a `$10.00` code and `$9.95` delivery totals `$9.95`, not `$0.00`.

#### Sweep 2 — the same defect, in five places the first sweep did not touch

**One finding, and it is the first sweep's finding generalised.**

Sweep 1 fixed `Math.max(0, Math.floor(x))` in the three places it had happened to probe. Sweep 2
grepped for the idiom instead of testing for it, and found **five more**:

| Where | What a `NaN` would have done |
|---|---|
| `clampQuantity` — the requested quantity | a `NaN` quantity written toward the database |
| `clampQuantity` — the stock figure | `NaN` stock read as *unlimited* rather than as none |
| `shippingProgress` — the subtotal | `style="width: NaN%"` on the progress bar |
| `subtotalOf` in the promotion engine | **a `NaN` discount** |
| the fixed-amount discount | **a `NaN` discount**, again |

Two of those five are money, and one of them is the number a customer is charged.

That the first sweep found three and missed five is the lesson worth keeping: **a sweep that tests
inputs finds instances, and a sweep that reads for the pattern finds the class.** Both were needed,
and the cheap one was the second.

Fixed with one implementation under two honest names in `lib/money.ts` — `toMinorAmount` for money and
`toWholeCount` for quantities, because calling the money function on a number of jackets is a small
lie the next reader has to decode. Six regressions across `verify-cart` and `verify-promotions` hold
each case.

#### The one claim that could not be tested, and what was done about it

`deferredTaxProvider` claims it *"refuses to invent a number even if one day it is handed an
address"* — the single most important sentence in the tax boundary, because a provider that quietly
began guessing once its inputs improved is one nobody would be watching.

It was untestable. The provider carries `server-only`, correctly — a real one holds an API key — and
`server-only` cannot resolve outside Next, so no harness could execute it. The same shape as Phase
15's finding, arriving from the opposite direction: there the guard was on the wrong module, here it
is on the right one and the *decision* was in the wrong place.

`decideDeferredTax` moved to `tax/rules.ts` and the provider is now three lines that call it. Four
checks assert what the sentence promised: pending without an address, **`unavailable` with one**,
never `not_required` — which would be a claim about tax law rather than about this provider — and
never an amount in either case.

#### What held

The bag's drawer and its page were measured against each other at both threshold states and agree row
for row, which is the invariant §1.21.2 was written to protect: `{"Subtotal":"$75.00","Delivery
(estimated)":"$9.95"}` from both, and `Free` from both above the threshold. `verify-shipping` is
**97 checks**; the full sweep is **961 across eight harnesses**.

## 1.22 Phase 17 — checkout / Stripe

Plan §17.1a–§17.1h. The phase the rule at the top of `AGENTS.md` was written for: *"Only a
signature-verified Stripe webhook marks an order paid. Reaching the success page is not payment."*

**One dependency added** — `stripe@22.5.0`, at the pin `docs/STACK_VERSIONS.md` set for this phase.
**One migration**, generated and committed: the `stripe-events` table and `orders.cart_id`.

### 1.22.1 One rule, made structural rather than remembered

`fulfil.ts` is the only file in the project that writes `paymentStatus: 'paid'`. Nothing else can:
the state machine in `rules.ts` refuses `draft → paid` outright, preflight writes `checkout_started`
and the session write moves it to `pending_payment`, and the success page is a **read** with no write
path at all.

That is the difference between a rule and a convention. A convention is a sentence somebody has to
remember; this one is three separate mechanisms that each have to be defeated.

### 1.22.2 §17.1a's eleven steps, and the five that were already written

Steps 3 to 7 — *"verify products still exist, verify variants active, revalidate inventory,
recalculate prices, recalculate promotion"* — are **not re-implemented**. They are `getCart`, which has
done exactly those five things on **every read** since Phase 14, because §14.1e and §15.1c both
required it.

A preflight that re-implemented them would be a second opinion about the same facts, and the two would
disagree the first time either was changed. So preflight *asks*, and adds the thing a bag does not
need and an order does: **the refusal.** A bag shows an unbuyable line with an explanation; checkout
declines to charge for it.

Nothing in the chain accepts a number from the browser. The customer supplies an email, an address and
a **method id**; `orderTotalMinor` takes four server-derived numbers and has no parameter a total
could arrive through. §17.1b's *"never accept a client-provided total"* is satisfied by there being
nothing to accept.

### 1.22.3 Two barriers, and why one is not enough

§17.1d is explicit that idempotency has two layers, and the reason is subtle enough to be worth
restating:

1. **The unique event id**, enforced by the database. It stops **the same event** being processed
   twice. It is an insert that violates a constraint, not a read-then-write — two concurrent retries
   would both find nothing and both proceed, and the window between the read and the write is exactly
   where a duplicate finalisation lives.
2. **The order's own state.** It stops **a different event** driving the same transition. Stripe sends
   `checkout.session.completed` *and* `payment_intent.succeeded` for one payment: two events, two ids,
   and the first barrier lets both through. Only `needsPaymentFinalisation` catches that.

Measured against the real database: a second event describing the same payment returns `alreadyFinal`
and **inventory is not decremented twice**, however many times it arrives.

`payment_intent.succeeded` is also deliberately **not** in the handled set — the session event is the
one acted on. That is belt as well as braces, and the harness asserts it so a future addition has to
be deliberate.

### 1.22.4 §17.1f's race, and the order that is paid but cannot be shipped

Stock is read **inside the transaction that writes it**, which is the whole of the race: two customers
buying the last unit are two transactions, and the second reads what the first committed.

The decision is **all or nothing**. If any line is short, none is decremented — a partially shipped
order is a decision nobody made, whereas an order that cannot be met is a human problem with a human
answer.

And when the stock is not there, the order is marked **paid** and left **unfulfilled**. The money has
already moved; refusing to record that would leave the customer holding a Stripe receipt for an order
this shop says was never paid for. §17.1f says *"do not mark an impossible order as **fulfilled**"* —
fulfilment is precisely the half withheld, and the shortfall is logged for the *"refund/exception
path"* the same section asks for.

Verified end to end: stock 1, order for 2 → paid, unfulfilled, stock untouched at 1. And a two-line
order where one line is short leaves **both** lines' stock alone.

### 1.22.5 §17.1g: six cases, one behaviour

*"Closes the Stripe page. Returns without paying. Refreshes success. Opens success directly. Opens
cancel directly. Pays but never reaches the success page."*

All six collapse into: **the page reads the order and reports what it says.** The success page writes
nothing. Arriving there means nothing about whether money moved, and the page's three outcomes are
*paid*, *not yet confirmed* — the customer beat the webhook, which is common and not an error — and
*one message for not-found, not-yours and never-existed*, because distinguishing them would turn the
URL into a way to enumerate other people's orders.

The identifier is *safe* by the check beside it rather than by being unguessable: a signed-in customer
may read their own order, and a guest may read one **only in the session that placed it**, proven by
the cart token still in their cookie. The cart is marked `converted` at payment rather than deleted,
which is what makes a refresh work and a different machine fail.

### 1.22.6 The `server-only` lesson, for the third time

`verify:webhook` failed on its first run with `ERR_MODULE_NOT_FOUND: server-only` — the same message
Phase 15 got, from the same cause in a different place.

`applyStripeEvent` reached for `getPayloadClient()` internally, so it needed the guard, so no harness
could drive it — and this is the function that decides whether inventory moves. It now takes a
`Payload` instance as an argument, exactly as `lib/promotions/read.ts` does, and the guard sits on
`stripe.ts`, which is where the key actually lives.

Three phases have now produced the same rule from three directions: **a guard belongs where a secret
or a request could leak, and nowhere else.** Phase 15 had it on a module the harness needed; Phase 16
had it on the right module with the decision in the wrong place; this had the decision reaching for a
client it could have been handed.

### 1.22.7 What was verified, and how

Stripe keys are not configured in this environment, which shaped the verification rather than limiting
it as much as expected.

| Surface | Evidence |
|---|---|
| §17.1c's state machine | 61 checks — paid is terminal, a draft cannot reach paid, a declined card can still succeed later |
| §17.1d's second barrier | asserted as a property: no status both *is* paid and *needs* finalising |
| **Signature verification** | **offline and real** — the SDK's own `generateTestHeaderString`, then a tampered payload and a wrong secret, both refused |
| §17.1f's race | 24 checks against the **real database**: stock moves once, never twice, all-or-nothing, and an unmeetable order is paid-but-unfulfilled |
| §17.1h's failure list | declined card, retry after decline, late failure against a paid order, expired session, unknown type, unknown order, invalid metadata |
| The first barrier | the unique constraint exercised where it lives — a second insert of one event id is refused |
| The browser | 24 checks — the degraded state, both redirect URLs opened directly and with guessed ids, and the webhook never answering 200 to an unsigned or forged request |
| Accessibility | 0 axe violations across six checkout surface/width combinations |
| The rest of the storefront | shell 100, home 183, catalogue 147, search 209, product 80, cart 78, promotions 67, shipping 97 |

### 1.22.8 What is now owed

- **A live Stripe test-mode pass.** Everything downstream of the signature is verified against the
  real database, and the signature itself is verified offline — but no real Checkout Session has been
  created, because there are no keys (**DEV-62**). That is the one gap and it is named.
- **The confirmation email** (§17.1d's *"triggers email only after the correct state transition"*) —
  **Phase 19**. The transition it hangs off exists and is the right one.
- **Refunds.** `refunded` is in the state machine and reachable; nothing drives it, because
  `charge.refunded` handling belongs with the order-management surface in **Phase 18**.
- **A cleanup for abandoned pending orders.** An order left at `checkout_started` is harmless and
  accumulates; the same sweep `Carts.expiresAt` has been waiting for since Phase 14.
- **Stripe Tax.** §16.1c's provider is still the deferral, so preflight refuses when tax cannot be
  calculated — which, with no keys, is every attempt (**DEV-61**).

### 1.22.9 Post-implementation sweeps

#### Sweep 1 — two payments arriving at the same instant

**One defect, and it is the one this phase exists to prevent.**

§17.1d names two idempotency barriers and this phase implemented both: a unique event id, and a status
check before finalisation. Sweep 1 delivered **two events for one payment concurrently** — a
`checkout.session.completed` and a `checkout.session.async_payment_succeeded`, which is exactly what
Stripe sends — and **both reported `finalised`**.

The status check is a *read*. Two transactions read `pending_payment` before either wrote `paid`, so
both passed a guard that is correct in every sequential test and useless under concurrency. The first
run hid the consequence: stock happened to land on the right number because both transactions computed
the same absolute value from the same stale read, and the second write silently overwrote the first
with an identical figure. A **lost update** that looked like success.

Making the decrement atomic made the damage visible rather than fixing it — `inventory_quantity =
inventory_quantity - $n` correctly subtracted **twice**, taking stock from 5 to 1 for a two-unit order.
That was the useful failure: it moved the bug from where it was hiding to where it was.

**The fix is a third barrier: the order is *claimed*, not checked.** One conditional statement both
sets `paid` and refuses to if it already is:

```sql
UPDATE orders SET payment_status = 'paid', paid_at = ..., stripe_payment_intent_id = COALESCE(...)
WHERE id = $1 AND payment_status IN (<finalisable>)
```

Postgres serialises the two statements on the row; the loser sees zero rows affected and stops. There
is **no window between the decision and the write, because they are the same statement.** The
finalisable list is derived from the state machine rather than written out in SQL, so the two cannot
drift.

Both the claim and the decrement are now expression updates. Neither reads a value and writes back a
number computed from it, which is the shape every one of these bugs had.

Measured after: `alreadyFinal,finalised`, and stock moved exactly once.

#### What the near-miss says about the harness

`verify-webhook` had **24 passing checks** covering both documented barriers, including duplicate
events, and every one of them ran the events **in sequence**. A sequential test of an idempotency
guard tests the guard; it does not test the race the guard exists for, and the two look identical
until something runs them at once.

Fifteen other adversarial cases held and are now permanent checks — a draft order refusing to be paid,
a refunded one refusing to be re-paid, an order with no lines, an order whose variant was deleted after
payment, exactly the last unit, and §15's owed `timesUsed` counter incrementing once inside the
payment transaction and not again on a retry. `verify:webhook` is **37 checks**, up from 24.

#### Sweep 2 — the shape, not the instance

Sweep 1 fixed a lost update. Sweep 2 went looking for **the same shape somewhere else**, which is the
lesson Phase 16 arrived at from the other direction: testing inputs finds instances, reading for the
pattern finds the class.

**Two more read-then-writes, both live.**

1. **The promotion counter.** `fulfil.ts` incremented `timesUsed` with `(promotion.timesUsed ?? 0) + 1`
   — a read and a write, on the column a code's `usageLimit` is measured against. Two customers paying
   with one code at the same instant are two **different** orders, so neither §17.1d barrier applies
   and both are genuinely owed an increment; read-then-write gives them one between them, and the shop
   quietly honours a limited code more often than it agreed to. Now
   `times_used = times_used + 1` inside the payment transaction.
2. **The webhook's delivery counter.** `attempts` was incremented the same way when a duplicate event
   arrived. The cost here is only a wrong number in an operational column rather than money — which is
   exactly why it was worth fixing, because the shape is what should be consistent, not the stakes.

**The harness had already tested the first one, and passed.** `verify-webhook` section K increments
`timesUsed` twice *in sequence* and asserts it lands on 1, then on 1 again for a duplicate. That check
passes whether the counter is an expression or a read — the identical blind spot sweep 1 found in the
idempotency barriers, in a check written *by* sweep 1. So section L was written to run two concurrent
payments on one code, and **it failed on its first run at `1` instead of `2`**, before the fix was
applied. `verify:webhook` is **38 checks**; `verify:checkout` is **62**, including three concurrent
redeliveries of one event landing on `attempts = 4`.

**The fourth door to `paid`.** §1.22.1 above claims nothing but `fulfil.ts` can mark an order paid, and
listed three mechanisms. Sweep 2 checked the claim rather than re-reading it, and found a fourth path
it did not cover: `Orders.access.update` is `isStaff`, and `paymentStatus` is an ordinary select field,
so **a staff member could simply type it in the admin panel** — which is precisely what `AGENTS.md`
forbids without qualification. Closed with `nobodyField` on the field, the project's existing idiom
from `Media.ts`. Field access is skipped for `overrideAccess: true`, so the webhook's own write is
untouched: the server path stays open and the browser path no longer exists. `verify:access` proves all
three halves — an admin edit carrying `paymentStatus: 'paid'` leaves it at `draft`, the *rest* of that
same edit still lands (so the denial is the field and not the write), and a server-side write still
moves it. `verify:access` is **48 checks**.

A documentation defect went with it: the route's own docblock was headed *"Why it always answers 200"*
and then listed three codes, none of which was the **503** the route returns when Stripe is
unconfigured. Corrected to the four responses it actually gives.

**One found and deliberately not fixed.** `cart.ts`'s add-to-bag reads a line's quantity and writes the
clamped sum — the same shape. It is left alone because the race cannot violate anything: the write is
*absolute* and each concurrent writer's value is already clamped to the cap, so two simultaneous adds
can only lose an increment, never exceed availability or the per-line limit. The symptom is a customer's
own bag showing one fewer than they asked for, on a control they can immediately use again. Recorded
here rather than fixed silently, and it belongs with the cart's transaction story rather than bolted on
during a checkout sweep.

## 1.23 Phase 18 — order system

Plan §18.1a–§18.1d. The phase where **DEV-03** either becomes true or gets withdrawn: it promised two
stored axes and one derived display status, and said the confirmation was due here.

**One migration**, generated and committed, and it adds **two columns** — `orders.refunded_at` and
`orders.refunded_minor`. That is the whole schema cost of this phase, because most of §18 turns out to
be behaviour over columns that already existed.

### 1.23.1 Two thirds of §18.1a was Phase 17

> *"Create pending order before or at checkout creation. Store stable item snapshots. Store Stripe
> identifiers. Finalize as paid only from validated Stripe state."*

All four already hold. Preflight creates the order before the Checkout Session, `order-items` has held
snapshot columns since Phase 6, `stripeCheckoutSessionId` and `stripePaymentIntentId` are written from
the session and the verified event, and `fulfil.ts` is the only file that writes `paid`.

So this phase did not re-implement §18.1a. It **tested** it, which is a different and more useful
thing, and then built the two halves that were genuinely missing: the fulfilment machine, and the
refusals that keep §18.1d's snapshots from being retyped.

### 1.23.2 The edges the plan does not draw

§18.1b gives a happy path and one instruction about everything else — *"Do not let arbitrary
transitions happen from the admin UI."* Every edge is therefore a decision, and four are worth stating
because each refuses something a careless click would otherwise do:

- **`delivered` and `cancelled` are terminal.** A cancellation that can be un-cancelled is not one.
- **`shipped → processing` is refused**, and this is the expensive one. §18.1c hangs a shipment email
  off marking an order shipped, and moving the column back does not unsend it. The customer's world
  already contains a dispatch notice; correcting a mistaken dispatch is a conversation, not a state
  edit.
- **`shipped → cancelled` is refused.** §18.1b permits `PAID → CANCELLED` *"only where business rules
  allow"* and invites the shop to say which. This one says: **cancellation is available until
  dispatch.** After that it is a return, with a different process and a different refund.
- **`unfulfilled → shipped` is refused.** `processing` is where a human picked the order. Reaching
  `shipped` without it is an order nobody confirmed could be picked.

Exhaustively: five legal edges across twenty-five ordered pairs, asserted as a count so that a machine
which quietly grows an edge fails one check rather than none.

### 1.23.3 Where the two axes meet

§18.1b's line starts fulfilment at `PAID`, so advancing into `processing` or `shipped` requires a paid
order. Two exemptions, both of which are the two-axis model earning its keep:

- **`shipped → delivered` needs no payment condition.** It records a fact about a parcel that has
  already gone. A refund issued while it was in transit — **DEV-03's own example** — must not make its
  arrival unrecordable.
- **Cancelling needs no payment either.** Cancelling an order nobody paid for is the ordinary case.

§18.1c's *"require tracking where appropriate"* is answered at the same point: marking an order
shipped without a carrier **and** a tracking number is refused, and a tracking number typed as spaces
is not a tracking number. The timestamps are written **by the transition** rather than typed beside
it, because a `shippedAt` a person can set independently of the status is a date that will eventually
disagree with it.

### 1.23.4 A hook, not field access, and not the admin UI

The rules live in `lib/orders/rules.ts` where a harness can enumerate them; `hooks/orderTransitions.ts`
is what makes every write obey them. It is a `beforeChange` hook rather than field access or an admin
component for one reason: **a hook runs on every path.** Field access is skipped by `overrideAccess`,
and an admin component is a suggestion a `PATCH` can ignore.

The subtlety that would have broken it: the admin panel posts the **whole document** on every save, so
an unchanged `fulfillmentStatus` arrives on every write. Treating that as a transition would make a
delivered order unsaveable — including adding a tracking number to it, which is an ordinary correction.
The hook short-circuits on `to === from`; the rules module still reports `unchanged` for a deliberate
no-op, because a future action asking for one deserves an answer.

### 1.23.5 §18.1d, which was half true and is now enforced

> *"Order item name/price/variant/SKU snapshots remain unchanged after a product is edited later."*

The half that was already true: those four are **columns**, not reads through a relationship, so a
product edit cannot reach them. Measured rather than assumed — the harness renames the product,
reprices and re-SKUs the variant, and re-reads the line.

The half that was not: `OrderItems.access.update` is `isStaff`, and a receipt line staff can retype is
a receipt that can be made to say anything. That is precisely the door Phase 17's second sweep found
standing open on `paymentStatus` — a rule in a docblock and a field that ignored it — so it is closed
here in the same phase rather than left for a sweep to find again. `freezeOrderLines` refuses the four
columns §18.1d names, on **every** path including `overrideAccess`.

`quantity` and `lineTotalMinor` are deliberately not in that set. `OrderItems`' own docblock reserves
them for a per-line partial refund, and a rule that forbade the case the schema was designed for is a
rule that gets deleted the first time it is inconvenient. They are closed to the browser by field
access instead, which is the door §18.1d is actually about.

### 1.23.6 DEV-03, confirmed

Two axes, one derived display status: `displayStatus(payment, fulfilment)` is the machine §18.1b draws,
reconstructed rather than stored. Storing it would be a third column that can disagree with the two
that are true.

Precedence: **refund first**, then cancellation, then fulfilment, then payment. Refund leads because
it is the only one of the four that is about money moving back, and burying it under a fulfilment step
would report *"shipped"* to somebody just refunded. Fulfilment outranks payment because an order being
picked is newer news than an order being paid for, and payment answers exactly while fulfilment has not
started. All 35 combinations derive a status that has customer-facing copy.

The refund-before-cancellation half of that order is sweep 2's, not the first draft's — see §1.23.11.

Its consumer is **Phase 20's `/account/orders`**, which is where the plan puts order history. Built and
proved here because DEV-03 said this phase would confirm it, and a derivation with an untested
precedence is a promise rather than a confirmation.

### 1.23.7 Two more read-then-writes, and a race two phases of tests had missed

Phase 17's sweeps established the shape. Wiring the refund path exposed the same shape twice more in
`applyStripeEvent`, and one of them could lose a payment:

> A `payment_intent.payment_failed` for a superseded attempt, arriving at the same instant as the
> `checkout.session.completed` that paid the order, read `pending_payment`, agreed the transition was
> legal, and wrote `payment_failed` **over a payment that had already succeeded.**

The state machine forbids `paid → payment_failed`. The read simply never asked it about the state the
row was actually in. `verify-webhook` section F tested exactly this and passed, because it ran the two
events in sequence — the third time that specific blind spot has produced a defect.

**Every payment transition is now a conditional `UPDATE`**, with the reachable-from list derived from
the machine by `statusesThatCanReach` rather than written out in SQL. Both orderings of the race now
end at `paid`, asserted concurrently.

The second was the refund itself, which is written the same way and records **how much** and **when**
in the same statement. A status alone cannot tell a partial refund from a full one.

### 1.23.8 The refund could not be found by the reference every other event carries

§17.1b attaches the order reference through Checkout Session metadata, and every session-shaped event
carries it back. `charge.refunded` does not: its `data.object` is a **Charge**, whose `metadata` is the
charge's own and is usually empty. Adding the event type without noticing that would have produced a
handler that verified the signature, recorded the event, and ignored every refund.

So the reference is optional now, and `applyStripeEvent` falls back to the **payment intent** — which
Stripe puts on the charge and Phase 17 already stores on the order, uniquely. An event with neither
still ends as `noOrder`, recorded and acknowledged, exactly as before.

### 1.23.9 What was verified, and how

| Surface | Evidence |
|---|---|
| §18.1b's machine | every one of 25 ordered pairs, and the five legal edges asserted as a count |
| §18.1c's conditions | tracking, carrier, whitespace-only tracking, and the payment condition with both its exemptions |
| §18.1c's authorization | anonymous, customer and staff attempts against the **real** access layer — staff may, a customer may not, and staff still cannot skip a step |
| §18.1d | the product renamed, repriced and re-SKU'd, then the line re-read; then the line itself retyped, on both the staff path and the server one |
| DEV-03 | all 35 payment × fulfilment combinations, precedence asserted in both directions |
| §18.1b's `PAID → REFUNDED` | driven end to end from a `charge.refunded` with **no order reference**, resolved by payment intent, amount and date recorded, redelivery refused |
| The race | two legitimate contradictory events delivered concurrently; the order ends `paid` either way |
| Phase 17, unchanged | webhook 38/38, checkout 62/62 re-run after the transition rules landed |
| The rest | access 48, media 61, shell 100, home 183, catalogue 147, search 209, product 80, cart 78, promotions 67, shipping 97 |

`pnpm verify:orders` is **62 checks**.

### 1.23.10 What is now owed

- **A browser and axe pass.** No browser tooling is available in this session, so the admin panel was
  exercised through the access layer and the routes only smoke-checked over HTTP. Phase 18 adds **no
  storefront UI**, so nothing customer-facing is unverified — but the order edit screen has not been
  looked at. Named rather than glossed.
- **The shipment email** — **DEV-64**, and Phase 19.
- **A restock on cancellation.** Deliberately absent: Phase 17 moves stock only at confirmed payment,
  so an unpaid cancellation has nothing to return, and a paid one is a refund — a decision with money
  attached, not a silent side effect of a select box.
- **An admin action for cancelling and refunding.** Today a refund arrives from Stripe and the panel
  reflects it. Initiating one from the panel is a write to Stripe, which belongs with a considered
  admin surface rather than a status dropdown.
- **The abandoned-order sweep**, still. An order left at `checkout_started` is harmless and
  accumulates; the same job `Carts.expiresAt` has been waiting for since Phase 14.
- **One order per bag.** Sweep 2 found `preflight.ts` doing a find-then-create on `orders.cart`, so two
  checkout attempts started at the same instant produce **two** pending orders for one bag. Named and
  deliberately not fixed here: the second order can only become a charge if the customer completes a
  second Stripe Checkout, each order is individually correct, and the fix is a partial unique index
  plus a retry in the checkout path — a change to Phase 17's flow whose new failure modes deserve more
  than the last hour of a sweep. See §1.23.11.


### 1.23.11 Post-implementation sweeps

#### Sweep 1 — the guard read a value that stopped being true

**Two defects, one of them the phase's own rule failing on the axis the phase introduced.**

Phase 17's sweeps established the shape: a check followed by a write is a read and then a write, and
two requests can pass the check before either performs the write. Sweep 1 asked whether the fulfilment
guard — brand new, and the whole point of §18.1b — had the same shape. It did.

Two staff, two requests, two transactions, both reading `processing` before either wrote:

```
both read: processing / processing
ship:   ok      (carrier, tracking number and shippedAt written)
cancel: ok      ← the machine says shipped → cancelled is impossible
final:  cancelled, shippedAt = null
```

Worse than the transition itself: the losing write also carried the *rest* of its stale document, so
the carrier, the tracking number and the dispatch timestamp were wiped — and by §18.1c a shipment
email had already been triggered for a parcel the record now says was never sent.

**Fixed with a lock rather than a conditional `UPDATE`.** `fulfil.ts` claims the payment axis in one
statement because it writes raw SQL; this write goes through Payload, because it has to pass
validation, run the remaining hooks and produce a document the panel can render. So the hook takes
`SELECT … FOR UPDATE` on the order before deciding: the second transaction waits, reads `shipped`,
and is refused by the rule that always applied. No new rule — one that is now asked about the state
the row is actually in.

The interleaving matters and is worth recording, because the first attempt to reproduce this
**passed**. Two `payload.update` calls fired together serialise on their own, and so does the case
where the first transaction commits before the second's write is issued. The failure needs the second
write to be *in flight* while the first still holds the row. `verify-orders` section J now sets that
up deliberately: two transactions, both reads asserted equal, the cancel issued, four hundred
milliseconds, then the ship commits.

**Second defect, found by reading rather than running.** The tracking check read
`data.carrier ?? original.carrier`, and `??` reads straight past an explicit `null` — so a single
write that both dispatched the order and *cleared* the carrier satisfied §18.1c's condition using the
value it was deleting. Now `'carrier' in data`, so what the write says wins, including when what it
says is nothing.

**What held.** The full-document re-save, which was the likeliest way to have broken the panel:
`unitPriceMinor` comes back from Postgres as a `number`, not a string, so re-posting an unchanged
order line is not read as an edit — checked because the opposite would have made every order line
unsaveable and no existing test would have caught it. Payload also coerces before hooks run, so a
REST body carrying `"5000"` for a frozen column is compared after coercion rather than as a string.

`verify:orders` is **67 checks**, up from 62. Every other harness re-run unchanged.

#### Sweep 2 — the fields whose read-only was a decoration

Sweep 1 found a race and fixed it. Sweep 2 went after the **class** — which by now has a name in this
document: *a rule stated in a docblock, with nothing enforcing it.* Phase 17's second sweep found it on
`paymentStatus`; Phase 18 found it on the order lines while building. So the question was how many more
there are, and it was answered by grepping for `readOnly: true` with no field access beside it rather
than by testing anything.

**Fourteen hits, four of them real.**

- **`orders.stripePaymentIntentId`** and **`stripeCheckoutSessionId`**. The payment-intent field's own
  docblock names the danger in as many words — *"a hand-typed payment intent is an order attached to
  somebody else's money"* — and nothing stopped anyone typing it. Both are unique, so a staff member
  could have attached an order to a payment that belonged to a different order.
- **`orders.paidAt`**, which would be a lie about when money moved.
- **`promotions.timesUsed`**, which is what `usageLimit` is measured against. Resetting it is how a
  usage limit lies; the honest way to extend a code is to raise the limit. Phase 17 increments this
  with an expression update inside the payment transaction, past Payload entirely, so the guard costs
  that path nothing.

All four closed with `nobodyField`, which `overrideAccess` skips — every server write to them already
uses it, and two of them are raw SQL that never touches Payload at all.

**And one that was investigated and correctly left alone.** `products.derived` — the cached price range
and stock total — has the same shape, and guarding it would have **broken the cache it protects**:
`syncProductDerived` refreshes it with `payload.update({ req })` and no `overrideAccess`, so field
access applies to the hook's own write. The finding is that the shape is not the whole story; what
matters is whether the maintaining code goes through the same door. Recorded so the next sweep does not
re-find it and get it wrong.

#### A precedence that was reasoned about and still landed on the wrong answer

`displayStatus` put cancellation ahead of refund, so an order **cancelled and then refunded** read as
*"Cancelled. Nothing was dispatched."* — true, and silent about the money. The check written next to it
had quietly excluded `refunded` from its sweep of payment statuses, which is the tell: the corner was
noticed while writing the test and then not decided. Refund leads now, because it is the fact the
customer would otherwise write in to ask about, and nothing is lost — an order that was never
dispatched has no tracking to explain.

#### Found, recorded, not fixed

`preflight.ts` finds an existing pending order by cart and creates one if there is none — a
find-then-create, the same shape as everything above. Two checkout attempts started at the same
instant produce **two** pending orders for one bag.

Not fixed here, and the reasoning is worth stating rather than hiding: each order is individually
correct, the second can only become a charge if the customer completes a second Stripe Checkout with a
second card entry, and the real fix is a partial unique index over `orders.cart_id` for live orders plus
a retry path in preflight — which changes how checkout fails, at the end of a sweep, with nothing left
to exercise the new failure modes. It is in §1.23.10 as a named debt, not as a shrug.

#### What was measured rather than asserted

The claims §1.23.5 was making about field access were prose until now. `verify-orders` section L
measures each: staff cannot retype a line's `quantity` or `lineTotalMinor`, cannot type the dispatch
stamps or the refund columns, cannot hand-type a payment intent — and a promotion with a guarded
counter is **still editable**, which is what a guard on one field must not cost.

`verify:orders` is **74 checks**, up from 67. Every other harness re-run unchanged.

## 1.24 Phase 19 — email / Resend

Plan §19.1a–§19.1d. **Three dependencies added** at the pins `docs/STACK_VERSIONS.md` fixed for this
phase — `resend@6.22.0`, `@react-email/components@1.0.12`, and `react-email@6.9.2` as a dev
dependency for the preview server. **One migration**, generated and committed: the `email_messages`
table and its unique index.

### 1.24.1 One service, and the sentence that shaped everything else

§19.1a: *"Build a centralized email service wrapper… **Do not call Resend directly from random
components.**"*

`resend` appears in exactly **one import** in this repository. Everything above it — the order
confirmations, the dispatch notices, the refund notice, the welcome, and Payload's own password reset
— deals in a `Transport`, which is a function from a message to an outcome. That is not tidiness: it
is what makes the one integration nobody has credentials for the one with the fewest unverified
claims, because a harness can supply a transport that opens no socket and drive the entire service.

The old `logEmailAdapter` is gone. Its best property is not: an unconfigured mail provider still logs
the whole message locally, so Phase 7's reset flow remains completable end to end with no key, and
still shouts at `error` in a deployed environment, because an operator should be told that a customer
is waiting for mail that is not coming.

### 1.24.2 §19.1c is a constraint, not a check

*"A webhook retry must not send two confirmation emails."*

`email_messages.dedupe_key` is `UNIQUE`, and **the insert is the check**. `send.ts` never asks whether
a message was already sent — it claims the key, and a violation is the answer. This is the mechanism
`stripe-events.event_id` established in Phase 17, chosen for the reason Phase 17's sweeps paid for: a
read-then-write has a window between the read and the write, and two concurrent retries both find
nothing and both send.

**The key names the thing that happened, never the message that reported it.** That distinction is the
whole design, and an event id would have got it wrong twice over. Stripe sends
`checkout.session.completed` **and** `payment_intent.succeeded` for one payment, with two different
ids — keying on either would send two confirmations. And the shipped and delivered notices have no
Stripe event at all: they originate in the admin panel, which posts the whole document on every save,
so an unkeyed send would re-mail a customer every time somebody fixed a typo in a tracking URL.

So: `order-confirmation:42` once per order forever; `order-shipped:42` once per transition;
`refund:42:1500` once **per refunded amount**, because partial refunds are ordinary and a second one
is a second thing the customer is owed; and `password-reset:<address>:<issued at>` deliberately *not*
once per customer, because asking again is the entire point of asking again.

Two duplicate shapes had to be recognised, and finding the second is what the harness earned:
Payload validates uniqueness *before* inserting, so an ordinary sequential retry arrives as a
`ValidationError`. That pre-check is itself a read-then-write and cannot see an uncommitted row, so a
genuine race passes validation twice and the **database** refuses the second with SQLSTATE 23505.
Matching only the first shape would have logged a fault every time the barrier did its job.

### 1.24.3 The queue exists because Payload has no post-commit hook

This was the finding that decided the architecture, and it was measured in `node_modules` rather than
assumed: in Payload 3, `afterChange` and `afterOperation` **both run inside the open transaction** —
`commitTransaction` comes after both, in `collections/operations/updateByID.js`. There is no
post-commit collection hook.

So a dispatch email sent from the hook that marks an order shipped would be a dispatch email sent for
a dispatch that could still roll back, with a mail provider's latency added to the duration of a row
lock that blocks every other staff write to that order.

Sending is therefore split in two, and the split is not ceremony:

- **`enqueueEmail`** writes a `pending` row and nothing else. Safe inside a transaction, and *correct*
  inside one: if the order never reaches `shipped`, the intention to say so rolls back with it.
- **`deliverEmail`** renders and hands the message to the provider, always outside.

The confirmation and refund notices are queued and delivered in the same breath, because the webhook
route is demonstrably outside a transaction by the time `applyStripeEvent` has returned — which
`fulfil.ts` had already written down in Phase 17: *"the email is genuinely afterwards, and genuinely
outside the transaction."*

### 1.24.4 §19.1d: nothing here can undo the thing it reports

*"A failed email should not roll back a successful payment/order."*

Every function in the service returns an outcome; none throws. That is absolute rather than tidy, and
the webhook route is why. It wraps its body in a catch that turns any throw into a 500; Stripe
retries; the retry hits the unique event id and returns 200 **without reprocessing**. So a single
thrown error from a mail call would leave an order paid and its customer permanently without a
confirmation that nothing would ever resend. The same reasoning guards the `afterChange` hook, where a
throw would call `killTransaction` and roll back a dispatch a warehouse has already performed.

Failure is recorded rather than lost: status, reason, attempt count, timestamps, all visible in the
admin panel, which is §19.1d's *"admin visibility"*. Retry is bounded at three attempts and then left
for a human — a message failing on a malformed address fails identically on the hundredth attempt, and
a queue that never gives up buries the one failure somebody could fix.

### 1.24.5 The safeguard is on the destination, because it cannot be on the credential

The phase prompt asks for *"local/dev safeguards so emails are not accidentally sent to arbitrary
recipients using production credentials"*. One sentence naming **two** hazards, which rules out the
obvious implementation: gating on whether a key is present does not help, because the dangerous case
is a key that *is* present. Resend issues no test-mode key that would make the mistake harmless.

So the gate is on where a message is going. In production every address is deliverable; anywhere else
a message is delivered **only** to an address on `EMAIL_DEV_ALLOWLIST`, and everything else is
recorded as `suppressed` — visible, never sent, and never retried into a send. An empty allowlist is
the safe default rather than the convenient one: it suppresses everything.

A developer running against a copy of the production database therefore cannot mail a real customer,
which is precisely the accident the prompt describes.

### 1.24.6 The `server-only` lesson, for the fourth time — and the opposite way round

Three phases produced the rule *"a guard belongs where a secret or a request could leak, and nowhere
else."* This phase produced its mirror image, and produced it as a failure: the first version put
`import 'server-only'` on the module that constructs the Resend client, which is exactly where a
secret lives — and `pnpm generate:types` died with `ERR_MODULE_NOT_FOUND: server-only`.

The reason is one this project already knew and had not connected: Phase 19 routes Payload's own
password-reset mail through the service, so `payload.config.ts` now transitively imports it — and the
Payload CLI loads the config through tsx, **outside Next**, where the bare specifier does not resolve.
A guard there would have broken `generate:types`, every migration, the seed and all fourteen `verify:*`
harnesses at once.

`lib/catalog/algolia.ts` had already solved it and said so: *"there is no `server-only` import here and
no environment import either."* The credentials are **arguments**. `lib/email/resend.ts` now does the
same, and `lib/email/courier.ts` is the guarded tier that reads them for application code, while the
config and the scripts read their own from `env.core`, which they are exempt to import.

So the rule gains a second half: **a guard belongs where a secret could leak, and never on a module the
CLI has to load.** The two are in tension exactly once — on the module that holds an SDK client — and
the resolution is to hold the client and not the key.

A smaller version of the same fence: the ESLint rule banning `env.core` catches a *type-only* import
too. Rather than weaken a rule added after a measured secret leak, the email service declares its own
three-value `DeliveryEnv`. The duplication is load-bearing in one direction — add a fourth environment
to `AppEnv` and this stops compiling until somebody decides whether mail may leave it.

### 1.24.7 What was verified, and how

| Surface | Evidence |
|---|---|
| §19.1b's eight templates | all eight rendered to HTML **and** plain text, asserted for the wordmark, for no leaked `undefined`, and for carrying no image or tracking pixel |
| The receipt | contains the frozen line snapshot, the variant label, the total and the order number — §18.1d's guarantee, in the customer's copy |
| §19.1c's keys | one key per *event*, distinct per refund amount, distinct per reset request, distinct between shipped and delivered |
| **§19.1c's barrier** | **two simultaneous enqueues of one key produce exactly one message** — the race, run as a race |
| The dev safeguard | production delivers; an empty allowlist delivers to nobody; a real address on a laptop is suppressed **even with a production key present**; matching is case-insensitive |
| §19.1d's isolation | a transport that **throws** does not throw out of the service; a provider refusal is recorded with its reason and the message recovers on retry |
| The ceiling | three attempts, then `failed` and left alone — and a `suppressed` message is never retried into a real send |
| The claim on delivery | an already-sent message cannot be delivered twice, so two drains cannot both send one row |
| End to end | a real order and its real line items queued, delivered, and refused a second time when the event replays |
| The rest of the shop | orders 74, webhook 38, checkout 62, access 48, media 64, shell 100, home 185, catalogue 147, search 209, product 80, cart 78, promotions 67, shipping 97 |

`pnpm verify:email` is **85 checks**, and none of them needs an API key.

### 1.24.8 What is now owed

- **A live Resend pass.** No key exists in this environment, so no message has left the building.
  Everything up to and including the provider call is verified with a fake; the call itself is one
  HTTP request whose failure path is recorded rather than thrown. **DEV-62**'s shape, a second time.
- **A verified sending domain**, before any production send. `.env.example` says so and Resend
  enforces it.
- **Nothing drains on a schedule** — **DEV-67**. A queued dispatch notice is delivered by the next
  Stripe webhook's bounded opportunistic drain, by `pnpm email:drain`, or by a staff member calling
  the drain route. On a quiet shop a message can wait.
- **Two of the eight templates have no caller** — **DEV-66**. Verification is off by Phase 7's
  decision; the contact form is gap **G-08**, assigned to Phase 23.
- **The newsletter has no double opt-in.** §19.1b does not list a newsletter template and the
  `status` enum has no `pending` state; adding one is a schema change, and the features document
  marks the whole item optional.

## 1.25 Phase 20 — wishlist, account, recently viewed

Plan §20.1a–§20.1d. **No dependency added and no migration**, which is the first thing worth
recording: `WishlistItems` was built in Phase 6 to §6.1m and already carried everything this phase
needed, including the constraint that makes §20.1b enforceable.

### 1.25.1 The merge rule was already a database constraint

§20.1b's first rule is *"existing customer wishlist wins duplicates"*, and Phase 6 had already made
that true rather than aspirational: `wishlist-items` carries a compound unique index on
`(customer, product)` with **both columns required**, because Postgres treats NULLs as distinct and an
index over a nullable column would not have bitten.

So the merge does not decide who wins a duplicate — the database refuses the second insert, whichever
code path happened to run first. `planWishlistMerge` filters duplicates out anyway, and the reason is
worth separating from the guarantee: it exists so the caller can **report** what happened instead of
counting exceptions. The constraint is the guarantee; the function is the explanation.

Same shape as Phase 19's `dedupeKey` and Phase 17's event id, for the third time.

### 1.25.2 The guest wishlist cannot merge the way the cart does — DEV-68

The cart's merge runs inside `login()`, on the server, and the browser is not involved: a guest cart
is a **database row named by a cookie**, so the server can find it.

A guest wishlist is `localStorage`. `WishlistItems` decided that in Phase 6 — *"there is no guest
wishlist table"* — and this phase paid the bill: no server action can read it, so the merge has to be
offered by the only party that can see the list. `WishlistSync` is a client component mounted in the
shell that does nothing at all until a session exists and the device has entries, and then hands them
over once.

That makes the merge input **untrusted in a way the cart's is not**, and the containment is explicit
rather than assumed: the action can only ever write rows owned by the session's own customer, because
there is no parameter for whose; every id is checked against the published catalogue before anything
is written; and the list is capped on the way in. The worst a forged call can do is add a product to
*the caller's own* wishlist, which is what the button beside it does anyway.

The device copy is cleared **only on success**, so a failed merge is retried on the next navigation
rather than losing a list the customer chose to keep.

### 1.25.3 A button inside a link is not a small problem

`ProductCard` was one `<Link>` wrapping the image, the name and the price, and the obvious home for a
heart — the top-right of the image, mirroring the badge — would have put a `<button>` inside an `<a>`.

That is invalid HTML, and browsers recover from it inconsistently: the control becomes unreachable or
un-activatable by keyboard, and assistive technology is handed a nested interactive it has no way to
describe. So the card was restructured — a plain wrapper, the link covering image and text, and the
control as its **sibling** positioned over the image. `group` moved to the wrapper with it, because
the image's hover treatment keys off it.

Plan §11.1c named this exact hazard as a requirement — *"click wishlist → prevent card navigation"* —
and the structural fix is the version of that which needs no `stopPropagation`, because the click
never reaches the link at all.

**The heart is opt-in.** `ProductCard` renders in five places and two of them are inside the bag: the
cart page's recommendations and the drawer, where each card sits in an `<li onClick={close}>` that
would shut the drawer under the customer's finger. A prop means those call sites do not ask for it,
rather than having to suppress it.

### 1.25.4 Two mechanisms behind one control, and the customer is told which

Signed in, the heart is a server action against `wishlist-items`. Signed out, it is a write to
`localStorage`. A guest who saves something is told *"saved on this device"* — a control that looked
identical in both states would be a promise the shop cannot keep when they open their phone.

The signed-out branch is deliberately **not** a `<form>`, which departs from `AddToBag`'s pattern.
`AddToBag` is a real form with hidden inputs so it works before hydration; there is no server for the
guest branch to post to, and a form that degraded to posting a wishlist add for a signed-out visitor
would be §0.1.17's fake control — a button that submits and achieves nothing.

State lives in `aria-pressed` rather than in the accessible name, so a screen reader announces
*"Save for later, pressed"* instead of a name that changes width under the cursor that pressed it.

### 1.25.5 Recently-viewed renders nothing on the server, on purpose

§20.1c is four constraints and the interesting one is *"validate products before rendering"*. The
browser holds ids and is trusted with none of them: every id goes through the same
`publishedProductWhere` the shop grid uses, under `overrideAccess: false, user: null`, so a withdrawn
product or an id somebody typed into devtools resolves to nothing and is simply absent.

*"Do not store sensitive personal information"* is satisfied by construction rather than by care —
the parser can only represent a positive safe integer, so there is no shape in which a name, an
address or an email could be stored even if something tried.

The rail's server snapshot is the **empty list**, so the markup React hydrates and the markup the
server sent agree by construction. `AnnouncementBar` recorded the rule from the other direction when
it declined a dismiss button: *"a `localStorage` read that makes a server-rendered bar flicker on
every page load."*

`createLocalList` is that whole pattern factored out of `search-panel.tsx`, because this phase needed
it twice more and a third copy of forty lines is how two of them drift.

### 1.25.6 The lint rule caught the shortcut

The rail's first version cleared its own state inside the effect — `setCards([])` when the id list was
empty — and `react-hooks/set-state-in-effect` refused it. Correctly: clearing state that the render
could have computed is a cascading render for nothing. The empty case is now **derived** at render,
and the resolved cards are filtered against what the store currently says, which also means removing
the last viewed product empties the rail immediately rather than after a round trip.

### 1.25.7 The account screens, and the two things deliberately absent

Five navigable routes plus `/account/orders/[order]`, spelled `[order]` because the plan spells it
`[order]`. The guard stays **per page** through `requireCustomer()` — the layout's own docblock
explains why, and Phase 20 added the navigation there and only the navigation.

**The order detail route takes the order *number*, not the database id.** An id is a running count of
every order the shop has taken, so a URL carrying one tells a customer how many came before theirs and
makes enumeration a matter of counting. The number is not secret and does not need to be, because the
query is scoped by the session's customer.

**A cross-account request is not found, never forbidden.** `readCustomerOrder` returns `null` both for
an order that does not exist and for one belonging to somebody else, and the page cannot tell them
apart because it is not given enough to. A 403 would be a disclosure oracle: it would confirm which
order numbers are real. Phase 7 established the property; this is the first phase with a surface that
could have broken it.

Two absences are decisions. `/account/settings` does not change a password — Phase 7 built a
single-use, one-hour, email-delivered reset that re-checks the policy, and a second path to the same
outcome is a second place for it to be wrong. It does not change an email address either, for a
sharper reason: `orders.email` is a snapshot, so changing the account address does not and must not
change where past confirmations went. That interaction deserves designing rather than adding to a
settings page because the field happened to be nearby.

`/account/addresses` **can add and remove**, which is more than the plan strictly asks for and less
than a full CRUD. It had to: checkout snapshots an address onto the order and never writes to
`addresses`, so a read-only screen would have rendered an empty state forever — §0.1.17's fake
surface, a page that looks like a feature and cannot do anything.

### 1.25.8 What was verified, and how

**Nothing was run.** The Neon password for `neondb_owner` stopped working during Phase 19's first
sweep and has not been replaced, so `pnpm build` and all fifteen harnesses are blocked. See `TODO.md`.

| Surface | State |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm lint --max-warnings 0` | passes |
| `pnpm build` | **blocked** — prerendering opens Payload |
| `pnpm verify:account` | **written, never run** — 40 checks across five sections |

The harness covers what the phase prompt names: cross-account access prevention (a second customer
cannot read, list or remove the first's rows, and gets `null` rather than a refusal) and merge
behaviour (existing wins, invalid dropped, order preserved, and merging twice adds nothing). It also
covers the hostile-input cases the device-local stores actually face, because a store the customer can
edit by hand is an untrusted input.

That gap is the honest state of this phase and is recorded rather than glossed.

### 1.25.9 What is now owed

- **Run the harness.** Everything above is unexecuted. This is first in the queue the moment a
  connection string exists.
- **Move to cart from the wishlist** — §20.1a names it. Deliberately not built: `variantPreference` is
  a colour memory and explicitly *not* a size commitment, so a move-to-cart still has to ask for a
  size, which means it is a navigation to the product page rather than a one-click action. Doing it
  properly is a small design question, not a missing function.
- **A merge notice.** `mergeGuestWishlistAction` returns a count and nothing renders it. The customer
  currently discovers the merge by their list being right.
- **Order pagination.** `/account/orders` reads fifty and stops.

## 1.26 Phase 21 — reviews

Plan §21.1a–§21.1c, plus §13.1f which is where the public rendering is actually specified.
**No dependency and no migration** — the second phase running. `Reviews` was built to §6.1j in Phase 6
and already carried every field, every bound and the constraint that makes duplicate prevention real.

### 1.26.1 The corpus disagrees with itself, twice — DEV-69

Plan §21.1a and feature matrix §9 are not the same specification, and `AGENTS.md` ranks the plan
above the matrix.

**Is a purchase required?** The plan hedges twice — *"**If** verified purchase is required"* and the
prompt's *"**optional** verified-purchase checks"*. The matrix lists *"review for non-owned product"*
as an abuse case, which only means anything if ownership is a gate. Resolved: **a purchase is a badge,
not a gate.** Anyone signed in may review; those who bought it get the indicator §13.1f asks for.

**Which order state counts?** The plan says a **paid** order. The matrix says *"order not delivered
yet"* — four states further along §18.1b's machine. Resolved: **paid**, and a refunded order still
counts, because the customer did buy it and had it long enough to form a view.

### 1.26.2 Three things the browser cannot decide, each closed differently

- **`status`** defaults to `pending` and the field carries `access: { create: isStaffField, update:
  isStaffField }`. A review created through *any* door lands pending whatever the request body says.
  §21.1b's moderation rule is access control, not a hook somebody could forget to run.
- **`verifiedPurchase`** is staff-only for the same reason and is set from an order lookup. A badge
  the submitter can assert is not a badge.
- **`customer`** is *forced* by `enforceCustomerOwnership`, on create and on update alike, because
  `create: isActiveCustomer` only asks whether the caller is an active customer — `POST /api/reviews`
  with `{ customer: 42 }` would pass it.

### 1.26.3 The duplicate is caught by the index, not by a check before it

§21.1c's first abuse case. Phase 6 made `customer` **required** specifically so the compound unique
index on `(product, customer)` would bite, since Postgres treats NULLs as distinct.

So the action attempts the insert and catches the violation. The newsletter action had already
recorded why read-then-create is wrong twice over: it is a concurrency bug, **and** a measurable
timing oracle, because an unknown value costs a SELECT plus an INSERT while a known one costs only the
SELECT. The catch is narrow — a validation error about some other field must not be reported to a
customer as *"you already reviewed this"*.

The eligibility check before the form is a **courtesy**, not the guarantee: it lets the page say so
rather than the customer discovering it by submitting.

### 1.26.4 The histogram is absent, not empty

§13.1f: *"Do not show an empty star histogram."* That is the only place in the corpus where the plan
pre-agrees on an **absence**, and it is worth honouring literally — five bars all at zero is not a
neutral chart, it reads at a glance as five one-star reviews.

The same logic runs through `summariseReviews`: with no reviews the average is **`null`, never `0`**.
Zero is a rating somebody could have given; absence is not. `lib/money.ts` made the same distinction
for a price, and *"0.0 stars"* on an unreviewed product is false information rather than no
information.

Aggregates are computed on read, from the same rows that are rendered. `Products.ts` decided in Phase
6 not to cache them, and the other half of that decision is here: two queries can disagree, and the
failure mode is a page claiming forty-one reviews above a list of forty.

### 1.26.5 No profanity filter — DEV-70

§21.1c lists *"profanity/spam"*. Neither the plan nor the matrix specifies a mechanism, a word list or
a service, no phase is assigned one, and nothing in the approved stack does it.

The answer this project gives is **human moderation**, which is what the pending-by-default status
already is. An automated filter would be new ground with no specification behind it, and a bad one is
worse than none: it publishes what it misses and rejects what it misreads, with nobody in the loop
either way.

### 1.26.6 No review photos — DEV-71

§6.1j lists photos, §13.1f asks for *"photo reviews where available"*, and the `photos` array exists
on the collection with `maxRows: 4` answering §21.1c's *"huge image upload"*.

It cannot be wired, and the reason is not effort. `media.create` is staff-only, and **D-28** records
that media bytes are **public the moment they are uploaded**. A customer-submitted review photo would
therefore be publicly fetchable *before any person had seen it* — §21.1b's moderation rule defeated by
the one field that bypasses it.

Solving it properly means a private-by-default upload path, which is a Cloudinary and access-control
design question rather than a wiring task. Recorded rather than half-built.

### 1.26.7 No rate limiting

Plan §26.1a names *"review submission"* as a Turnstile surface, and Turnstile is Phase 26's — as is
its dependency. Recorded as owed rather than improvised, and stated without overclaiming: this is an
authenticated write endpoint with a Zod-shaped body, and the only thing bounding it is that a customer
may submit one review per product.

### 1.26.8 What was verified, and how

**Nothing was run.** The Neon password has been invalid since Phase 19's first sweep. See `TODO.md`.

| Gate | State |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm lint --max-warnings 0` | passes |
| `pnpm build` | **blocked** |
| `pnpm verify:reviews` | **written, never run** — 30 checks |

The harness covers the two tests the prompt names by title — unauthorized submissions and duplicate
reviews — plus rating validation, §13.1f's summary rules, and §21.1a's paid-order match including the
cases that must *not* verify: another customer's order, a different product, and an order that never
reached payment.

### 1.26.9 What is now owed

- **Run the harness**, with everything else queued behind the connection string.
- **Review photos** — DEV-71, blocked on a private-upload path.
- **Turnstile** — Phase 26.
- **Whether an author may edit or withdraw a review.** Phase 6 deferred it to Phase 21 explicitly;
  Phase 21 leaves `update`/`delete` staff-only, because a customer editing an approved review would
  re-publish unmoderated text under a badge that had already been granted. Withdrawal is the more
  defensible half and is worth designing on its own.
- **Structured data.** §29 wants review aggregates in the markup; the numbers now exist for it.

## 1.27 Phase 22 — shop the look

Plan §22.1a–§22.1d. **No dependency and no migration** — the third phase running, and this time not
even a new component library: `radix-ui@1.6.7` already ships `@radix-ui/react-popover`, so the
preview needed nothing installed.

§22 is unusually thin. It names no route, no test list and no acceptance gate. What it names instead
is a **sequence** — §22.1d's six numbered steps — and a prohibition repeated twice: *"do not guess
sizes silently"*, *"never silently guess unavailable or missing variants."* That prohibition is the
phase.

### 1.27.1 Phase 6 had already built §22.1a, and Phase 10 had already built the marker

`hotspotFields()` carries every field §22.1a names: a product reference, an optional label, an
optional styling variant (`markerTone`, capped at two options so the CMS does not become a styling
system), and four coordinates — desktop and mobile, as **percentages** of the rendered box.

*"Do not hard-code hotspot coordinates in React"* was satisfied before this phase began.

`ShopTheLookSection` had also existed since Phase 10, and its docblock had already named its own
successor: *"a marker that opened an empty dialog would be §0.1.17's fake control"*, so the preview
waited for a PDP and a cart. Both exist now, so Phase 22 is an **upgrade to a working component**
rather than a new one — which is a materially different job, and the difference is what §1.27.2 is
about.

### 1.27.2 The naive upgrade would have broken the clause the plan did not have to state

§22.1c asks for four things: open a preview, show image/name/price/variant state, allow add to bag,
and **allow full PDP navigation**.

The obvious implementation — turn the marker from an anchor into a button that opens a popover —
satisfies the first three by breaking the fourth. It also breaks something §22.1c never mentions,
because it had no reason to: Phase 10's marker *works without JavaScript*.

So the trigger is still the anchor. `Popover.Trigger asChild` wraps the same `Link`, and the click
handler prevents default. With JavaScript the preview opens; without it the anchor navigates to the
product page exactly as it did before. The preview **offers** the PDP rather than replacing it, which
is what the fourth clause asks for read literally.

It also keeps the accessible name Phase 10 gave the marker — the product's name and price, visually
hidden — rather than turning it into a dot only a mouse can use.

### 1.27.3 A popover, not a dialog, and not the shell's overlay context

`Popover`, because a preview is anchored to the thing that opened it and does not deserve a focus
trap, a scrim or a scroll lock. A customer scanning a look opens one marker, glances, and moves to
the next; the shell's three overlays are modal because they *replace* the page, and this augments it.

The shell's `overlay-context` is deliberately not reached for, and the reason is worth recording
because it looks like reuse. That context exists because the cart, menu and search panels are mounted
beside the footer with **no trigger in their own subtree** — Radix focuses a null ref and drops focus
to `document.body`, a WCAG 2.4.3 failure Phase 9 found by driving a browser. A hotspot's trigger sits
next to its content, so Radix's own restoration is correct. Using the context would also enter a
mutual-exclusion state machine that would close the customer's bag.

Radix supplies `aria-haspopup`, `aria-expanded` and `aria-controls`, and keeps the last one in step
with mounting. Phase 9 got that wrong by hand — an `aria-controls` pointing at an unmounted id is a
real violation, and two clean axe sweeps had passed over markup missing `aria-haspopup` entirely,
because axe treats it as an enhancement. None of it is hand-written here.

### 1.27.4 The preview is fetched when it is opened

A homepage can carry four shop-the-look blocks with eight markers each. Resolving thirty-two
products' live stock on every render — for a section most visitors never touch — would be paid by
everyone for the benefit of a few.

So the marker stays cheap and the preview costs one round trip when asked for. The loading state
renders the name and price the page already had rather than a spinner, because the marker's
accessible name carried them: only the *variant state* has to wait.

It also means the preview is resolved against stock as it is **now**, not as it was when the page
rendered — which is why a product withdrawn since has its own state in the popover rather than an
empty frame.

### 1.27.5 §22.1d, and why the three outcomes are not a count

The six steps are implemented in order, and step 3 is enforced by a **type** rather than by a rule
somebody remembers: `planLookAddition` returns products needing a size in a bucket that carries **no
variant to add**. A caller cannot add one by accident, because there is nothing there to add.

*"One purchasable variant"* is the whole definition of unambiguous. A product with three sizes of
which one is in stock is still added without asking — that is not a guess, it is the single available
thing. What is forbidden is picking medium out of three in stock.

Step 6 says *"report skipped unavailable items"*, and the notice separates the two reasons rather
than counting them. **"Needs a size" is a ten-second fix; "not available" is a dead end.** *"2 items
skipped"* is neither, and collapsing them turns an actionable outcome into a shrug.

The count reported is what **actually landed**, not what was planned: `addToCart` re-checks live
inventory, so a variant that sold out between the plan and the write is refused there.

### 1.27.6 The route is Phase 23's, and the navigation is still broken

`/lookbook` is in the navigation and **404s today**. It did before this phase and it does after.

§22 names no route — it is the interaction system, and the four surfaces that carry hotspots
(homepage block, collection page, edit page, lookbook chapter) all get the upgrade at once because
they all render `ShopTheLookSection`. Plan §23 owns the lookbook *page*. Building it here would be
building a later phase's feature early, which `AGENTS.md` forbids without qualification.

Recorded so it is not mistaken for an oversight: **the nav link is broken until Phase 23**, and it is
the next phase.

### 1.27.7 What was verified, and how

**Nothing was run.** The Neon password has been invalid since Phase 19's first sweep. See `TODO.md`.

| Gate | State |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm lint --max-warnings 0` | passes |
| `pnpm build` | **blocked** |
| `pnpm verify:lookbook` | **written, never run** — 20 checks |

The harness asserts the prohibition, because §22 sets no tests of its own and a prohibition nothing
tests is one that holds until somebody refactors: one variant resolves, two resolve to `null` rather
than to the first, zero is not a default in disguise, and out-of-stock and inactive variants are not
purchasable.

### 1.27.8 What is now owed

- **Run the harness.**
- **A browser pass.** Hotspot alignment is the one thing in this phase that cannot be asserted from
  source: it depends on the delivered image having the framing the editor placed the coordinates on.
  The `editorial` context crops nothing, which is what makes it hold — but `reserveBox` falls back to
  16:9 when a media record has no stored dimensions, and **that path is unguarded**. Worth a
  deliberate look rather than discovering it on a live page.
- **The lookbook route** — Phase 23.

## 1.28 Phase 23 — editorial, collections, journal

Plan §23.1a–§23.1c. **No dependency and no migration** — the fourth phase running. Six new routes:
`/collections/[slug]`, `/edits/[slug]` (renamed `/edit/[slug]` in Phase 30, §1.35.1), `/lookbook`,
`/lookbook/[slug]`, `/journal`, `/journal/[slug]`.

### 1.28.1 Two blocks had been authorable for seventeen phases and rendered nothing

`gallery` and `pullQuote` are in the shared editorial vocabulary and have been on `collections.body`
and `edits.body` since Phase 6. Neither had a resolver case. Neither had a component. **Anywhere.**

An editor could compose a gallery, publish the page, and find the section simply absent — plan
§0.1.17's rule inverted: not a control that lies about what it does, but a CMS field that silently
discards work.

Nothing had noticed because no route rendered `collections.body` until this phase. That is the honest
explanation and also the reason it was worth writing down: the defect was invisible for as long as
the surface that would have shown it did not exist.

### 1.28.2 Why there are two block resolvers now

`lib/home/resolve.ts` already resolves five of these seven blocks and **cannot be reused**. Its
`resolveSection` is module-private and typed to `NonNullable<Homepage['sections']>[number]`, a union
that does not include `GalleryBlock` or `PullQuoteBlock` — and widening it would mean the homepage
dispatcher's exhaustive `never` default rejecting two blocks the homepage can never receive.

So `lib/editorial/resolve.ts` is a second resolver over the same vocabulary. The duplication is small
because the expensive part, `resolveProductTile`, was already exported, and the alternative was a
type-level knot in a file whose exhaustiveness guard is doing real work.

Its default case is deliberately **not** a `never` guard, for the mirror-image reason: the vocabulary
is shared, and a block added for the homepage should cost a collection page that section rather than
a compile error.

### 1.28.3 A collection page is not a filterable grid, and building one would have broken it

**DEV-09** already ruled it out — *"a collection page drawn as a plain filterable grid, contradicting
the guide's campaign-led composition"* — and structure §9 says collections *"should feel like
campaigns, not category dumps."* So `CatalogPage` is not reused, despite fitting one chapter of
§23.1a's flow exactly.

There is a second reason, and it would have been a live defect rather than a style disagreement.
`requiresSearchIndex()` sends **any** query carrying a collection to Algolia, because membership lives
on `collections.products` and the reverse side on the product is a Payload `join` — virtual, no
column, unfilterable in Postgres. A collection page built on `getCatalog` would therefore have
rendered **nothing at all** whenever Algolia was unconfigured or down, while every other listing in
the shop survived it. Plan §A.5 asks for the opposite.

Reading the ordered id list and asking Postgres for those products keeps the page working with no
search service — and keeps the curator's order, which a relevance-ranked index would not.

The grid is also unfiltered on purpose. A collection is a finite curated set whose contents *and*
order a merchandiser decided; offering to re-sort it would be offering to undo the curation.

### 1.28.4 Featured products without a new field

§23.1a's flow names *"featured products"* as a step and `Collections` has no `featuredProducts`
field. Adding one is a schema change — a generated, committed migration, impossible with the database
down, and a deviation to record.

It would also duplicate a decision the editor has already made. `Collections.products` is explicitly
ordered and its own field description says *"an order is a property of the list"* and *"dragging a
row is the curation."* **The front of a curated list is what featured means.** The first four are
taken from the same resolved cards as the grid below, so the two can never disagree about whether
something is published.

### 1.28.5 Products are never read through the relationship at depth

Reading a collection at `depth: 2` to get populated products looks like it saves a query and would
have shown **scheduled drops and withdrawn garments**. `Products.access.read` is `publishedOnly`,
which checks `status` and explicitly not `publishedAt`, and knows nothing about
`derived.priceFromMinor` — the rule that withdraws a product with no active variant. Only
`publishedProductWhere(now)` applies all three, and it only applies on a `find` against `products`.

So membership is an ordered id list at `depth: 0` and the products are a second query, re-sorted back
into the curator's order because `id IN (…)` returns the database's order, not the list's. Phase 20's
recently-viewed reader had already established the shape.

### 1.28.6 The navigation has been broken since Phase 9, and is not any more

The header and the mobile menu have linked to `/lookbook` since the shell was built, and
`documentHref` has mapped a lookbook to `/lookbook/<slug>` since the same phase. **Neither route
existed.** Every one of those links 404'd, accepted at the time and recorded, because the page
belonged here.

Phase 22 restated it when it built the hotspot interaction and stopped short of the page. Building
only `/lookbook/[slug]` would have left the nav broken; building only `/lookbook` would have left
`documentHref` pointing at nothing. Both, together, is what closes it — and `Lookbooks.coverImage`,
described in the CMS as *"the index-page cover"*, finally has the index page it was authored for.

### 1.28.7 §23.1c's dead end is designed against rather than avoided

*"Avoid creating an editorial dead end."* Every article carries three exits — the products it is
about, the collections it belongs to, other articles — each resolved through the same published rules
as everything else, so a withdrawn product is **not offered** rather than offered as a link to a 404.

An article with none of those relationships still gets one exit. A dead end is a dead end whether it
was authored or inherited, and the instruction is not conditional on an editor having filled in a
field.

### 1.28.8 What was verified, and how

**Nothing was run.** The Neon password has been invalid since Phase 19's first sweep. See `TODO.md`.

| Gate | State |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm lint --max-warnings 0` | passes |
| `pnpm build` | **blocked** |
| `pnpm verify:editorial` | **written, never run** — 24 checks |

The harness asserts the four failure cases the phase prompt names by title, because they are
resolution decisions rather than layout: unpublished content resolves to `null`, missing hero media
drops one section, an empty product relationship drops the group rather than rendering a heading over
nothing, and a deleted related product is absent rather than a broken link.

### 1.28.9 What is now owed

- **Run the harness**, and a browser pass — six new routes have never been rendered.
- **`/collections` and `/edits` index pages.** §23.1a and §23.1b describe the *detail* pages and the
  navigation reaches collections through the mega menu, so neither is a broken link today. Worth
  having anyway.
- **`generateMetadata`** on all six routes — Phase 24, exactly as Phases 10 to 13 deferred it.
  `seoField()` is on every one of these collections waiting for it.
- **The contact form** — gap **G-08**, and the caller Phase 19's contact-confirmation template
  (**DEV-66**) is still waiting for. Not in §23's three sub-sections, so not built here.

## 1.29 Phase 24 — search engine optimization

Plan §24.1a–§24.1d. **No dependency and no migration** — the fifth phase running. `docs/STACK_VERSIONS.md`
lists nothing for §24, and it is right to: metadata is built into Next and JSON-LD is a string.

### 1.29.1 Three CMS fields had been authorable for eighteen phases and read by nothing

`site-settings.defaultSeoTitle`, `defaultSeoDescription` and `defaultOgImage` have existed since
Phase 6. `seoField()` — a title, a description and a social image — has been on nine collections
since the same phase. **Nothing read any of them.**

That is the defect Phase 23 found in the `gallery` and `pullQuote` blocks, and it is worse here,
because these sit on a settings screen that looks exactly like it is configuring this. `SiteSettings.ts`
said so in its own docblock — *"Phase 24 the SEO defaults"* — and `seo.ts` said *"falling back to the
page's hero when unset is Phase 24's job."* Both promises are now kept, which is the substance of this
phase rather than an aside to it.

The precedence is stated in exactly one place, `pageMetadata`:

1. the document's own SEO override, because an editor who typed a title meant it;
2. the page's own content — its name, its prose, its hero;
3. the site defaults from `site-settings`;
4. the built-in fallback, so a fresh install is not blank.

**An emptied override is not an override.** A cleared field means *derive it*, not *publish an empty
tag* — `seoField()`'s own description says the fields are overrides and every one is optional, and
`documentSeo` is where that is enforced rather than remembered.

### 1.29.2 §24.1b is a rule about honesty, and it is enforced by shape

*"Do not include fake ratings, fake availability, incorrect prices, prices not actually purchasable."*
The prompt restates it harder: *"never generate structured data that claims false price, availability,
or ratings."*

That is an unusual instruction for a metadata phase and it is the right one. Structured data is the
one output on a storefront **read by machines and shown to customers without the page being visited** —
a rating in a search result reaches people who never see the product page, and a price in a shopping
listing is a promise made before anybody reaches the shop. Getting it wrong is not an SEO defect; it
is a false claim at scale.

So `productStructuredData` **omits rather than guesses**, and each omission is forced by the input
shape rather than by a check somebody has to remember:

- **The offer is built only from purchasable variants** — active, in stock, priced. A sold-out size
  cannot set the price, which is precisely what *"prices not actually purchasable"* names.
- **Nothing buyable emits `OutOfStock` with no price at all.** The product is real, so saying so is
  honest; attaching a price nobody can pay is the forbidden claim, and a price is what a naive
  implementation would keep.
- **A product with no variants emits no `offers` key**, rather than a free one.
- **`aggregateRating` appears only when a real, approved review exists.** No key — not a zero, not an
  empty object, and not the industry's favourite lie: five stars from nobody. Phase 21 made ratings
  real; this is the first thing that could have made them fake again.

A SKU is emitted only when a product **is** one variant. With several, a product-level SKU is a claim
about which one, and there is no honest answer.

### 1.29.3 `getProduct`'s cache did not apply to its second caller, and that is why it was split

`generateMetadata` and the page render are two calls in one request, and reading the document twice
is how a `<title>` ends up describing a page that 404'd — the two reads can disagree about publication
state in the moment an editor unpublishes.

React's `cache` was supposed to make that free. **It did not.** `getProduct(slug, selection)` takes
an object, and `cache` compares arguments with `Object.is`: two callers passing `{ color: null, size:
null }` miss each other's entry and both run the queries, because the two objects are not the same
object. Memoisation that silently does not apply is worse than none — it looks free.

So `getProductRecord(slug)` holds the queries and is keyed by a **string**, and `getProduct` builds
the variant matrix — pure, cheap, and the only part that depends on the selection — on top of it. The
editorial readers already took a single slug, so they needed nothing.

### 1.29.4 The canonical never comes from the request, and never carries a query

`resetPasswordEmail.ts` recorded the reason in Phase 7: a `Host` header is attacker-controlled, and a
URL built from one is a URL an attacker can point at their own domain. `canonicalUrl` takes `siteUrl`,
which is configuration.

It also strips the query, which matters most on the two routes that have one. `/shop` is a function of
nine parameters; canonicalising each combination would ask an index to hold every filter of every sort
of every page. `/product/<slug>?size=m` is the same document as `/product/<slug>` — a variant of a
page, not a page.

### 1.29.5 The homepage had no metadata at all, on purpose, and it cost it a canonical

The old docblock recorded a real trap: the layout's template renders `%s · NORTH / 01`, so a
page-level title on the homepage reads *"NORTH / 01 · NORTH / 01"*. Its answer was to export nothing —
which also cost the front page its canonical URL and its Open Graph card, on the route most likely to
be shared.

`absoluteTitle` is the answer instead: `title: { absolute }` bypasses the template, and everything
else is derived normally. The layout's own metadata became `generateMetadata` at the same time, so the
title template carries the site's name **from the CMS** rather than a hard-coded string — renaming the
shop now renames every tab in it.

### 1.29.6 `robots.txt` needs three rules per prefix, and every shorter version is wrong

`Disallow: /account/` matches the subtree and **not** `/account`, which is a real page. Dropping the
slash blocks `/accounts-payable` too, because a disallow is a plain prefix match — the same
string-versus-path trap `isIndexablePath` avoids, arriving through a different door.

And a matched path in RFC 9309 **includes the query string**, so neither rule touches
`/search?q=jacket` — the near-duplicate the exclusion exists for in the first place.

So each prefix emits `${p}$`, `${p}/` and `${p}?`. Exactly the subtree, and nothing else.

The list itself is **one constant**, `NON_INDEXABLE_PREFIXES`, shared by `robots.txt` and the sitemap.
A sitemap that submits a URL `robots.txt` disallows tells a crawler two things at once, and which one
it believes is not predictable.

### 1.29.7 The sitemap reads as the public, and degrades rather than failing

Products go through `publishedProductWhere(now)` — the same predicate the shop grid, the search
indexer and every editorial page use — and every document is read under `overrideAccess: false, user:
null`. A sitemap built from a privileged read would list drafts, which is not a small mistake: it
hands a crawler a URL that answers 404 to the public, and it discloses the existence of unreleased
work.

A database that cannot be reached returns the four static routes instead of a 500. A sitemap missing
its product URLs for an hour is recoverable; a sitemap URL that answers 500 is one a crawler remembers.

`robots.ts` and `sitemap.ts` sit at `app/`, **not** inside `(frontend)`. A route group does not appear
in a URL, but these two are resolved by position in the tree, and Payload's admin occupies the sibling
group.

### 1.29.8 JSON-LD is a raw-text element, so the payload is escaped

`<script type="application/ld+json">` is raw text: the browser parses no entities inside it, and it
ends at the first literal `</script`. `dangerouslySetInnerHTML` is therefore the only way to render
one — and escaping is not optional, because every value in the payload comes from the database. A
product named `</script><script>…` would otherwise close the block and open a real one.

`JSON.stringify` does not escape `<`. `JsonLd` does, along with `>`, `&`, `U+2028` and `U+2029`.

### 1.29.9 What was verified, and how

The first harness in this project that **touches no database at all** — so there is no D-10 guard,
because it creates nothing, deletes nothing and never opens a connection. That is a consequence of the
pure-module discipline rather than a coincidence: everything §24 decides was written as a pure
function, and the one module that reads the CMS holds a `findGlobal` and no decision.

| Gate | State |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm lint --max-warnings 0` | passes |
| `pnpm build` | **passes** — `/robots.txt` and `/sitemap.xml` prerendered, 35 URLs from real data |
| `pnpm verify:seo` | **90/90** |

The build was the first since Phase 18. `robots.txt` and `sitemap.xml` were read back out of the build
output rather than assumed.

### 1.29.10 Two stale claims in old docblocks, corrected rather than repeated

The homepage's docblock said the route was *"statically prerendered"*. **It is not, and has not been
since Phase 9** — the storefront layout awaits `cookies()` through `getCustomer()` for the header's bag
badge, which makes every route beneath it dynamic. The caching argument built on it still holds,
because it rests on the *data* cache, which is what `unstable_cache` and the 300-second revalidate
actually control; the sentence about prerendering was simply wrong and is now marked as corrected.

Four routes carried *"No `generateMetadata`. SEO is Phase 24"* notes. They are Phase 24's now, so they
say what was decided instead of what was deferred.

### 1.29.11 Sweep 1 — what the first pass got wrong

Four defects, and the first two are the same mistake in different clothes: **caching a failure**.

**`getSeoDefaults` remembered the outage.** The `findGlobal` carried its own `.catch(() => null)`
*inside* `unstable_cache`, so the cached function returned successfully with blank defaults — and Next
stored those blanks for **300 seconds**. Every page rendered in that window carried a generic title
and no Open Graph card, long after the database had recovered, and nothing was ever logged because
nothing ever threw. The docblock claimed it "fails open"; it failed *silently and durably*, which is
the opposite. `home.ts` had already written the argument down — *"returning a valid empty homepage
would have written a 200 blank page into the route cache… outliving the database blip that caused
it"* — and this reproduced it one file away. The catch belongs **outside** the cached function:
`unstable_cache` does not store a rejected promise, so the next request retries, and the fallback
applies to one request rather than to five minutes of them.

**The sitemap swallowed its error entirely**, `catch {}` with a comment. Static-routes-only is a
survivable answer; not knowing it happened is not, and this is the one route whose reader is a crawler
that will not report the problem either. It also had **silent truncation**: six bounded reads with no
check against `totalDocs`, so a catalogue past the cap produces a valid sitemap, a green build, and a
slice of the shop simply not submitted. Both fixed, the second the way `readVariants` already does it.

**`socialImageUrl(input.image ?? defaults.ogImage)` chose the record before asking for a URL.** A page
whose own image exists as a row but yields no URL — an asset uploaded before Cloudinary was
configured, or a video — got **no card at all**, while the site default sat there unused. The ladder
is over *URLs*, not over records: ask each in turn.

**A video was accepted as a social card.** `defaultOgImage` and `seo.image` are uploads to `media`,
and `media` holds video; a 1.91:1 JPEG transform of a video asset is a URL in the video delivery
namespace that no crawler renders. Now `null`, checked against the stored `cloudinaryResourceType`
column rather than the MIME type, per `Media.ts`.

Two smaller ones: a missing document's `generateMetadata` returned a plain `{ title: 'Not found' }`
where `privateMetadata` is right, and `EMPTY_DOCUMENT_SEO` — handed out by identity to every document
with no overrides — was an unfrozen shared object. `pnpm verify:seo` is **94/94**, four checks added
for the cases above that a pure harness can reach.

### 1.29.12 Sweep 2 — a title that claimed what the page refuses to claim

**`/checkout/success` had `<title>Order confirmed</title>`.** The page beneath it renders one of three
headings — *Order confirmed* when the webhook has marked the order paid, *Order received* while it has
not, and *We could not find that order* when there is nothing to show. §17.1g is the entire reason
that distinction exists: *"reaching the success page is not payment."* A static title claiming
confirmation contradicted the page in two of its three states, from the browser tab, on the one screen
in the shop where the difference is money. It is `Your order` now — neutral, and free, because the
page is `noindex` either way.

**The homepage's `degraded` guard had drifted below other work.** Adding the organisation JSON-LD put
two awaits between reading the homepage and refusing to render an empty one. The throw still fired,
but an invariant that is not the first thing after its read is an invariant a later edit steps over.
Moved back up.

Three smaller ones. The product route's `generateMetadata` docblock still credited `getProduct` for
the memoisation that is now `getProductRecord`'s — the exact claim sweep 1 existed to correct, left
stale one file away. `product.shortDescription ?? product.description` used `??` where `||` is right:
an editor who **cleared** the short description left an empty string, not a decision to publish no
description, and `??` walked straight past the full one. And `routes.ts` promised a note about an
`/order` prefix that is neither in the list nor anywhere in this application.

### 1.29.13 What is now owed

- **`/collections` and `/edits` index pages**, still — they are in the sitemap only as detail URLs.
- **`generateStaticParams`** on the document routes. A Phase 30 question, and not obviously right for
  a PDP that reads live stock.
- **Product `Offer.priceValidUntil` and `shippingDetails`** — Google's Merchant listings want both.
  Neither is claimable today: there is no price-expiry field, and shipping is computed per basket.
- **The harnesses written since Phase 19** — `verify:email` (85), `verify:account` (40),
  `verify:reviews` (30), `verify:lookbook` (20), `verify:editorial` (24) — remain unrun. They write
  documents, so D-10 holds them until a **development** connection string exists. See `TODO.md`.
- **A browser pass** over the six Phase 23 routes and the Phase 22 hotspots.

## 1.30 Phase 25 — analytics and observability

Plan §25.1a–§25.1e. **Three dependencies, installed at their pinned versions** — `posthog-js`
1.418.10, `@sentry/nextjs` 10.70.0, `@vercel/speed-insights` 2.0.0 — and **no migration**. GA4 has no
package: it is a `gtag` script tag.

### 1.30.1 The taxonomy came first, and it is a type

The prompt is explicit about the order — *"define a clean ecommerce/event taxonomy first, then
instrument the core flows"* — and §25.1a asks for *"a single internal naming convention"*.

`AnalyticsEvent` is a union of exactly the seventeen §25.1a names, and `trackEvent` takes it. **A
typo is a compile error**, not a column in a dashboard nobody notices is empty — which is the failure
mode of string-keyed analytics and the reason it is worth a type. `AnalyticsPayloads` maps each event
to what it carries, so `purchase` cannot be sent without a value.

**The internal names are the GA4 names**, for the ten that overlap. §25.1a's ecommerce list is GA4's
recommended vocabulary word for word, and a translation table between an internal name and a vendor
name is somewhere for the two to drift — invisibly, because the events still arrive, under the wrong
label. The seven discovery events are custom, under the same names, and none collides with a GA4
reserved name.

### 1.30.2 Money crosses the vendor boundary exactly once

Everything in this project holds money in integer minor units, and §25.1c wants GA4 decimals. The
division happens in **one** function, `toGa4Params`, at the boundary where the format demands it —
the same rule `money.ts` follows for display and `toMajorUnits` follows for structured data.

A `price` field that is sometimes cents and sometimes dollars reports revenue a **hundred times too
high**, and it is not recoverable: the wrong numbers are already in the property. So the conversion
is a pure function with fifteen assertions on it, including the two that matter most — a zero value
is a real zero, and an **unknown** value is absent rather than zero. GA4 treats those differently in
a revenue report, and this project already has the rule written down: `null` means unknown, `0` means
none.

`index` is one-based in GA4 and zero-based everywhere here. Converted in the same place, once.

### 1.30.3 Instrumenting Server Components without converting them

`ProductCard` is the most-rendered component in the shop and it is a Server Component. Adding an
`onClick` to report `select_item` would convert it **and everything it renders** into client
components, which is a large regression bought with an analytics event — the homepage's whole
performance argument is that it ships almost no client JavaScript.

So `ProductCard` gained two **attributes**, `data-item-id` and `data-item-name`, and `TrackList`
delegates from the grid wrapper: one listener for forty cards, and the card stays a server component.
It renders `display: contents`, so the wrapper can sit around a CSS grid without becoming a box —
instrumentation that changes the DOM eventually gets blamed for a visual bug.

The listener is in the **capture** phase. A card's own click handling — the cart drawer closing
itself, a hotspot preventing default — can stop propagation first, and a `select_item` that
disappears whenever the surrounding UI does something is worse than none.

### 1.30.4 An event is emitted where it is *true*, not where it was clicked

This is the single rule behind every call site, and it is what makes the funnel worth reading.

`addToBagAction` re-derives the price, re-checks live stock and clamps the quantity — **it can
refuse**, and a size that sold out between render and click is the ordinary case. An `add_to_cart`
fired on the click would report an add that never happened, and the resulting report would show a
cart-abandonment problem this shop does not have.

So `useActionResult` watches the `useActionState` result and fires only on success. Its guard is
**reference identity**: every action invocation returns a new object, so two identical successes are
two events and a re-render is none. The initial state is skipped, because a form that has not been
submitted has produced no result.

The guest wishlist is the deliberate exception: a device-local list has no server to wait for, so the
write **is** the outcome and the event fires at the click. Same rule, different authority.

### 1.30.5 `purchase` is the one event that must never be sent twice

Every other event describes something a customer did, and twice is two events. A purchase is a fact
about an order, and reporting it twice **doubles reported revenue**.

Three conditions, and only the third is obvious:

1. **The order is paid** — §17.1g, and `AGENTS.md`: *"only a signature-verified Stripe webhook marks
   an order paid. Reaching the success page is not payment."* A customer lands on the success page
   the instant Stripe redirects, routinely **before** the webhook arrives. The page says *Order
   received* and nothing is sent. On refresh, once the webhook has landed, it says *Order confirmed*
   and the event fires. An order that is never paid is never reported.
2. **Not already sent on this device** — `sessionStorage`, keyed on the order number, because the
   success URL is refreshable, bookmarkable and shareable. Session scope rather than local: a repeat
   purchase gets a new order number, so `localStorage` would be storing keys forever against a
   collision that cannot happen.
3. **Not already sent in this component** — a ref, for Strict Mode's development remount.

Storage can throw (private mode, blocked site data). It is wrapped, and a throw means the event
**is** sent: an occasional double-count is a smaller error than silently dropping revenue. That is
the one place in the file where the trade goes that way, and it is stated rather than assumed.

### 1.30.6 §25.1d is enforced on the way out, on two independent grounds

An error report is the one payload in a system that is **assembled by accident**. Nobody chooses what
goes into a stack trace, a breadcrumb or a captured request body — the runtime does, from whatever
was in scope. Redaction therefore cannot be a habit at call sites; it has to run over the finished
event.

`redact.ts` walks anything and scrubs on two grounds, because either alone leaks:

- **By key** — anything named like a secret. Catches a value whose *format* is unremarkable: a
  password, a session id, an address line.
- **By value** — anything shaped like a secret. Catches one in a place nobody thought to name: a
  Stripe key interpolated into a message, a connection string in a `cause`, a token inside a URL.

Order inside the value patterns is load-bearing. A Postgres URL contains an `@`, so the email pattern
would otherwise eat part of it and leave the host **and the password** behind — a partial redaction
that reads as a successful one. The whole-URL pattern runs first.

Three things `redact` alone would not do, and `redactEvent` does:

- **Cookies and headers are dropped, not scrubbed.** A redacted-but-present `payload-token` still
  tells a reader which requests were authenticated, and there is nothing in a cookie jar worth
  keeping.
- **The user is reduced to an id.** *"Raw personal data where not necessary"*; an id answers *"one
  customer or a thousand?"*, which is the only question a report needs.
- **The URL keeps its route and loses its token.** Which route failed is the useful half.

It never returns `null`. §25.1d asks for redaction, not silence, and dropping errors to be safe would
trade a privacy problem for a reliability one.

### 1.30.7 Two of the seventeen events are not emitted, and both are recorded rather than faked

- **`add_payment_info`** — §25.1a already hedges it: *"where applicable"*. It is not applicable here.
  Stripe Checkout is **hosted**, and §17 keeps it that way deliberately: this application never sees
  a card, a wallet or a payment-method selection, so there is no moment at which payment information
  is added. Firing it at redirect would report the customer *leaving* for Stripe as them entering
  their details, which is a different thing and often a different outcome. **DEV-73.**
- **`quick_view_opened`** — there is no quick view. `product-tile.tsx` mentions §11.1c's *"quick
  view, quick add and a wishlist"* in a docblock; only the wishlist was built, and no phase since has
  asked for the other two. The event stays in the taxonomy because §25.1a lists it and because the
  taxonomy is the deliverable, but nothing emits it. **DEV-74.**

Leaving both in the union and emitting neither is the honest shape: the vocabulary is complete and
the instrumentation says what is true.

### 1.30.8 What Sentry is wired into, and what it is deliberately not

Four entry points, because Next has four kinds of failure and no single hook sees them all:

| Failure | Caught by |
|---|---|
| Unhandled browser exception | `instrumentation-client.ts` |
| Server exception, integration failure | `sentry.server.config.ts`, from `register()` |
| **Server Component render error** | `onRequestError` in `instrumentation.ts` |
| Root layout / hydration failure | `app/global-error.tsx` |

The third is the one that is easy to miss: an exception thrown while rendering a Server Component
does not reach a client boundary as an exception — React sends a digest and Next renders an error
page — so without `onRequestError` the report says only that a page failed.

`global-error.tsx` renders its own `<html>` with **inline styles**, because the stylesheet is loaded
by the layout that just failed. It renders `error.digest` and **not** `error.message`: §4.1b already
forbids putting a server-produced message in a public response, and an error boundary is a public
response. The digest is meaningless to a stranger and is the exact key an operator greps for.

Its "Home" link is a real `<a>` with the Next lint rule suppressed and the reason written out: a soft
navigation would re-enter the router and mount the tree that just failed.

**Traces are off** (`tracesSampleRate: 0`). §25.1d asks for errors; §25.1e defers performance
measurement until there are real users. Turning tracing on before then buys a p75 built from a sample
of one.

### 1.30.9 §25.1e is a schedule, and it is honoured as one

*"Enable after the application is stable enough to generate meaningful real-user data."* The package
is installed — it is on the Phase 25 list — and the component renders in **production only**. On a
preview or a laptop it returns `null` and the beacon is never requested.

There is a second gate no code can control: Speed Insights reports nothing until it is enabled for
the project in the Vercel dashboard. `TODO.md` §6 carries it, so nobody goes looking for data that
was never being collected.

### 1.30.10 `@sentry/cli`'s postinstall is denied, and that has a visible consequence

pnpm 11 asked; the answer is **false**, in `pnpm-workspace.yaml` beside the two allowed builds. Its
postinstall downloads a ~20 MB platform binary whose only job is uploading source maps, and this
project does not upload them: `SENTRY_AUTH_TOKEN` is deliberately unset, so the binary would be
fetched on every install — in CI too — and never run.

The consequence is stated plainly rather than discovered later: **production stack traces will be
minified.** Turning it on is three coordinated changes — the token, the `allowBuilds` entry, and
`sourcemaps` in `next.config.mjs` — and it belongs to whoever owns the Sentry organisation.

`withSentryConfig` wraps `withPayload`, **outermost**. Payload's wrapper injects the aliases and
server-external packages the CMS cannot run without; Sentry's adds build instrumentation on top of a
finished config.

### 1.30.11 Two small model changes the events needed, and why they were the right ones

- **`ConfirmationLine.productId` and `unitPriceMinor`.** GA4's `item_id` must be an **id**, and the
  confirmation view carried only the stored name. Using the order-line id would make every purchase
  look like a first-ever sale of a product nobody has bought before. A deleted product reports its
  name with no id rather than a fabricated one — `OrderItems` stores the name precisely so an order
  survives that deletion.
- **`ProductCard` has no price, and none was invented.** It carries `priceLabel` — `"From $95.00"` —
  because a card renders a label and a range is a real state. Parsing that back into a number would
  invent precision the model does not have: a floor is not a price. So `select_item` and
  `view_item_list` omit `priceMinor`, which `events.ts` defines as *unknown*, and the events that
  genuinely know a price are built from the variant or the order line.

### 1.30.12 What was verified, and how

| Gate | State |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm lint --max-warnings 0` | passes |
| `pnpm build` | passes, with the Sentry wrapper in the config |
| `pnpm verify:analytics` | **89/89** |
| `pnpm verify:seo` | 94/94, unchanged |

The second harness in this project that **touches no database**, for the same reason as the first:
what §25 decides is pure. It asserts the two things that fail *silently, in production, forever, with
nothing in the application misbehaving* — the GA4 reshaping and the Sentry redaction.

What it cannot assert is the phase prompt's own instruction: *"verify events in local/preview
environments before enabling production measurement."* That needs a network tab and a real property,
and no account exists. **It has not been done**, and `TODO.md` §6 says so rather than implying
otherwise.

`react-hooks/refs` rejected the "latest ref" pattern written during render — correctly: a ref written
during render is a value React cannot see. All four occurrences moved into an effect declared before
the effect that reads them.

### 1.30.13 Sweep 1 — a comment that claimed a protection the code disabled

**`analytics.tsx` set `mask_all_text: false` under a comment reading *"§25.1d's redaction rule
applies to PostHog too"*.** Three things wrong with one line: it is a **session-recording** option,
it was set to the value that *disables* masking, and the file it pointed at (`sentry.config.ts`) does
not exist. The comment described a protection the code was switching off.

What it was claiming is now what the code does — `autocapture: false` and
`disable_session_recording: true`, explicitly. Autocapture is a §25.1a problem as much as a §25.1d
one: it invents event names from the DOM and fills the project with `$autocapture` events beside the
seventeen somebody named, so the taxonomy stops being the answer to *"what do we measure"*. And this
shop has a checkout, an address book and a settings form; capturing element text across them is
exactly the *"raw personal data where not necessary"* §25.1d forbids.

**The redaction key matcher tested the whole key as a substring.** Measured against this project's
own field names:

| key | matched | why |
|---|---|---|
| `shipping` | **yes** | `shi`**`pp`**`in`**`g`** contains `pin` |
| `author` | **yes** | a journal byline contains `auth` |
| `company` | **yes** | contains `pan` |

Every one is a field an operator needs in order to read a report, and losing them protects nothing.
The docblock called the trade *"nearly free"*; it was the substring doing the damage rather than the
breadth. The key is now split into camelCase and underscore **segments**, each matched whole, with a
short prefix list where a prefix genuinely names the family. `stripeSecretKey`, `STRIPE_SECRET_KEY`,
`payment_method` and `sessionToken` all still match; `shippingMinor` does not.

**`redactString` truncated before replacing.** A secret straddling the 2 000-character boundary was
left as a fragment too short to match its own pattern — a partial credential kept by the step meant
to bound the payload. Replace, then truncate.

**The browser and the server reported different Sentry environments for the same deployment.** The
server resolves `preview` from `VERCEL_ENV`; the browser had only `NODE_ENV`, which is `production`
for *every* built deployment. A preview's client errors were landing in the production environment
beside real ones, while that same deployment's server errors landed in `preview`. `publicAppEnv()`
reads `NEXT_PUBLIC_VERCEL_ENV`, which Vercel exposes under the same setting `appEnv` already depends
on — no new variable for anyone to set, and the mapping is deliberately identical.

Two smaller ones: `beforeBreadcrumb` scrubbed `data` while claiming the buffer was clean and left
`message` alone, and `TrackList` would never report a list that rendered empty and filled later.

### 1.30.14 Sweep 2 — the error text was in the field nobody scrubbed

**`redactEvent` scrubbed `event.message` and not `event.exception`.** That is the wrong half.
`message` is set for `captureMessage` and a few synthetic events; **everything thrown** — every
`new Error(...)`, every rejection, every Stripe or Postgres failure — arrives as
`exception.values[].value`. So `Error: Invalid API Key provided: sk_live_…` went out untouched,
which is the single most likely way a real credential reaches an error report, and §25.1d exists to
stop precisely that. It is walked with `redact` rather than picked apart, because the frames beneath
it can carry local variables and the shape belongs to the SDK.

**The edge runtime had no Sentry client at all.** `register()` returned immediately for anything that
was not Node — right for the environment module, wrong for Sentry. `src/proxy.ts` is middleware, it
runs on the edge, and it guards `/account`: a failure there redirects a signed-in customer to a login
page they do not need, or lets an unauthenticated request through. Those failures were reaching
`onRequestError` in a runtime with no initialised client, which is a **silent no-op** — the shape
this project keeps finding. `sentry.edge.config.ts` reads the *public* environment tier, because
`instrumentation.ts` already refuses to load `env.server` outside Node and it is right to: a DSN is
public by design and the secrets are not.

**`shop_the_look_add_item` named products that may not have been added.** `addLookToBagAction`
returned a *count*, and the event reported the first `added` ids of the requested list — correct only
when the skipped product happens to be last. A look whose jacket needs a size choice and whose scarf
goes straight in would have reported the **jacket**. The action now returns `addedProductIds`, in the
order they went in, and the event reports those.

`pnpm verify:analytics` is **115/115** after both sweeps, up from 89: the added checks are
regressions for the key matcher in both directions, the truncation boundary, and the exception field.

### 1.30.15 What is now owed

- **Verify events against a real PostHog and GA4 property**, per the phase prompt. `TODO.md` §6.
- **Enable Speed Insights in the Vercel dashboard**, per §25.1e's own condition.
- **`add_payment_info` and `quick_view_opened`** stay unemitted until there is something true to
  emit — DEV-73 and DEV-74.
- **Consent.** Nothing here asks for permission before loading a vendor, and no section of the corpus
  requires it. A shop selling into the EU or California needs a banner and a gate in front of
  `Analytics`; the integration boundary is already the one place that would change. Recorded as gap
  **G-17**.
- **The five harnesses** D-10 still holds until a development connection string exists.

## 1.31 Phase 26 — security and bot protection

Plan §26.1a–§26.1d. **No dependency added** and no migration — Turnstile is a script tag and a POST.
One dependency was **upgraded**, and that is the phase's most consequential change.

### 1.31.1 `next@16.3.2` carried two unauthenticated RCE advisories

The phase prompt asks for a *"dependency audit"*, and this is what it found:

| Severity | Package | Advisory |
|---|---|---|
| **CRITICAL** | `next` | Unauthenticated **remote code execution** on Windows-hosted servers |
| **CRITICAL** | `next` | Unauthenticated **RCE** in the Image Optimization API with AVIF files |
| HIGH ×4 | `fast-uri` | Two SSRF, two host confusion |
| HIGH | `sharp` | Two libheif advisories |
| HIGH | `js-yaml` | Unbounded CPU on empty merge sources |
| MODERATE | `payload` | Default account-unlock access |

`next@16.3.3` closes both criticals and is still inside `@payloadcms/next@3.88.0`'s declared range.
`docs/STACK_VERSIONS.md` says *"version pins are evidence-based"*; two unauthenticated RCEs is the
evidence. The other three are transitive and closed with overrides beside the two this project
already carried.

**`pnpm audit` went from 9 findings — 2 critical, 6 high, 1 moderate — to 1 moderate.**

### 1.31.2 The one remaining finding was already closed, in config, two phases ago

`payload@<=3.88.0`'s `unlock` access defaults to `defaultAccess`, which is `Boolean(user)` — **any**
authenticated user on **either** auth collection. A signed-in shopper could therefore
`POST /api/customers/unlock` with somebody else's address and clear the five-failure lockout that
`maxLoginAttempts` exists to impose, repeatedly, turning §7.1e's brute-force protection into a speed
bump.

The upgrade Payload names, `3.88.1`, is **not available to this project**: every `@payloadcms/*`
package pins an *exact* peer on `payload@3.88.0`, so overriding one would put the tree in a state its
own peers declare invalid.

It did not need to be. `Customers.ts` sets `unlock` to staff-only and `Users.ts` sets it to
admin-only, and both have since the phases that wrote them. **The advisory describes a missing
default this project never relied on.** That was verified by reading the two collections rather than
assumed from the fact that somebody once thought about it — and it is worth recording, because the
first instinct during this sweep was to *add* the access rules, which would have been a duplicate
key and a compile error.

### 1.31.3 §26.1a's own sentence is the whole design

> *"Server must verify Turnstile response. Client-side widget alone is not security."*

`turnstile-widget.tsx` renders a challenge and writes a token. Whether that token means anything is
decided in `lib/security/guard.ts`, on the server, with a secret the browser has never seen.

**Delete the widget and every guarded form starts refusing, not accepting.** That is the right way
round and is worth stating, because the opposite arrangement — a client that decides whether
verification applies — is the common one and is the failure §26.1a is warning about.

The mechanism is that `verifyTurnstile` reads the **configured state itself**, from the server
environment, rather than taking a `required` flag from its caller. There is no argument a call site
can pass and no field a client can omit that turns a required verification into a skipped one.
Omitting the token is a refusal. `pnpm verify:security` asserts exactly that.

### 1.31.4 Which forms, and the one that does not exist

§26.1a names four. Three exist:

- **Newsletter** — the classic list-poisoning target; it writes a row per address with no
  authentication at all.
- **Review submission** — §21.1c's abuse cases, and the only form whose output is *published*.
  Moderation catches what is submitted; this bounds how much there is to catch.
- **Registration** — account farming, and the door to everything behind it.
- **Login** — §26.1a hedges with *"where abuse warrants it"*, and the answer is yes. A login form is
  the most attacked endpoint any shop has, and the question is what the form **is** rather than
  whether abuse has been observed on this one yet. It composes with the existing five-failure
  lockout rather than replacing it: a challenge raises the cost of each attempt, the lockout bounds
  how many one account can suffer, and neither is sufficient alone — a lockout with no challenge is
  a denial-of-service primitive against a known address.

**Contact does not exist.** Gap **G-08** has recorded that since Phase 19, which is also still
waiting on it for the contact-confirmation email template (**DEV-66**). It gets a challenge the day
it is built.

The guard runs **first** in each action, before validation: a refused request costs one Cloudflare
round trip and never reaches a query, a hash or a write, and a bot's malformed payload does not get
a free field-by-field critique of the form it is attacking.

### 1.31.5 Unconfigured skips, and an outage refuses — DEV-75

Two failure modes that look similar and are opposites.

**Unconfigured** — no site key or no secret — means the widget was never rendered and nothing is
verified. Failing closed with no keys would make an unconfigured deployment a shop nobody can
register with, which is not more secure; it is broken. This project has settled that trade three
times (**DEV-62**: the checkout page says payment is unavailable rather than showing a form that can
only fail). A *partial* configuration is treated as unconfigured, matching `integrationStatus`: a
site key with no secret renders a widget nothing can verify, which is precisely the decoration
§26.1a warns about.

**An outage** — Cloudflare unreachable, a 500, a timeout — is a **refusal**. This is the one control
in the project that fails closed, and it is deliberate: everywhere else the shop degrades, because
the cost of degrading is a worse page. Here the cost of degrading is *no bot protection at all* on
exactly the forms an attacker is hammering, and an attacker can cause the outage they benefit from.

The consequence is stated rather than hidden: **if Cloudflare is unreachable, those four forms stop
accepting submissions.** That is the correct trade for a control whose entire purpose is to refuse.
Recorded as **DEV-75**.

The customer sees one sentence for every failure — an expired token, a duplicate, a missing one, a
network error. Telling somebody *which* check they failed is telling an attacker which knob to turn,
and none of the distinctions is actionable by an honest customer, whose fix is the same in every
case. The reason **is** logged, once, because an operator watching `timeout-or-duplicate` is watching
a replay and an operator watching `http-500` is watching an incident.

### 1.31.6 §26.1b — the API depth cap was the one real finding

Payload's default `maxDepth` is **10**, and `/api/*` is a public REST surface. `GET
/api/products?depth=10` asks the database to walk relationships ten levels deep for every document in
the page, on an endpoint that needs no authentication to reach published content. That is an
amplification primitive — one cheap request, an unbounded amount of work — and nothing in this
application asks for it.

**`maxDepth: 3`.** The deepest read anywhere in the project is two: the four editorial readers and
`PRODUCT_DEPTH` all use `depth: 2`. Three leaves one level of headroom rather than pinning the cap to
today's exact usage.

`defaultDepth` is deliberately left at Payload's 2. Lowering it would change what the admin panel
receives from its own REST calls — a functional change to the CMS in the name of a limit `maxDepth`
already enforces. A cap on what a caller may *ask for* is the precise control.

The rest of §26.1b was **verified rather than changed**, which is the honest outcome of a review:

| §26.1b | State |
|---|---|
| Secure cookies | `payload.config.ts` sets `{ sameSite: 'Lax', secure: appEnv !== 'local' }` on both auth collections — Payload's default is `secure: false` |
| Production secret | `PAYLOAD_SECRET` is validated at startup and at build; never a literal |
| Rate limiting / anti-abuse | `maxLoginAttempts: 5`, `lockTime: 10 minutes` — Payload's defaults, restated explicitly on `customers` and inherited by `users`. Confirmed by reading `payload/dist/collections/config/defaults.js`, not assumed |
| Admin access | `Users.access.admin` is explicit; `role` is field-access-guarded against self-promotion |
| Access controls | Unchanged, and the `unlock` advisory above is the audit of them |

### 1.31.7 §26.1c — reviewed, and what the review actually found

| Check | Finding |
|---|---|
| **XSS in rich text** | **No `dangerouslySetInnerHTML` renders CMS content anywhere.** The only occurrence in the project is `JsonLd`, which escapes `<`, `>`, `&`, `U+2028` and `U+2029` before writing. Lexical is rendered as React elements, so text is text |
| **Open redirect** | `isSameSitePath` refuses anything not starting with a single `/`, plus `//host`, `/\host` and any control character — so a `Location:` cannot be smuggled through a newline. 14 assertions |
| **Input validation** | Every Server Action parses with Zod before acting. Unchanged |
| **Authorization** | Payload access controls, applied through `overrideAccess: false` on the storefront paths that write |
| **Server-only boundaries** | `env.server` carries the guard, `env.core` is fenced by ESLint (**D-14**), and Phase 19 recorded why a guard must never sit on a module the Payload CLI loads |
| **Query parameterization** | Every raw SQL statement in this project is a Drizzle `sql` template with interpolated **parameters**, never string concatenation |
| **File uploads** | An **allowlist** of six MIME types, all `image/*` or `video/*`. No PDF, no SVG — an SVG is a script container — no HTML, no `application/octet-stream`. Bounded in bytes and in pixels, the second being the decompression bomb |
| **CSRF** | `SameSite=Lax` on the session cookie, and Next Server Actions carry their own origin check. The `/api` REST surface is the reason `Lax` is load-bearing rather than incidental |

### 1.31.8 §26.1d — a scan that runs, not a scan that was run

`pnpm scan:secrets` walks `git ls-files` and matches high-confidence vendor patterns. A one-off grep
satisfies the sentence once; a committed script satisfies it every time.

**The first version's Resend pattern matched English.** `re_[A-Za-z0-9_-]{16,}` hit
`Structu`**`re_Current_OnlineOnly`**`.md` and `figu`**`re_mobile_image_idx`** — a filename and a
database index. A scan that reports noise is a scan people learn to skim, so every pattern now either
carries a vendor prefix meaningless in prose or requires structure prose does not have.

It then found four real matches, all of them **fixtures in `verify-analytics.ts`** — the strings that
prove the Sentry redaction works. Two ways to resolve that, and the tempting one is wrong:
allowlisting `scripts/` would put a hole exactly where somebody is most likely to paste a real key
while debugging. Instead every credential-shaped fixture now carries `EXAMPLE` inside the matched
span, which the scanner already classifies as a placeholder. The redaction patterns do not care what
is inside a key, so the fixtures test the same thing.

**Result: no secrets in 388 tracked files.**

### 1.31.9 What was verified, and how

| Gate | State |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm lint --max-warnings 0` | passes |
| `pnpm build` | passes, on `next@16.3.3` |
| `pnpm verify:security` | **51/51** |
| `pnpm scan:secrets` | **clean**, 388 files |
| `pnpm audit` | **9 → 1**, and the 1 is closed in config |

`verify:security` is the **third** harness that opens no connection: the Cloudflare verifier is
injected, so every branch is driven without a network or an account. The phase prompt's closing
sentence — *"do not weaken security to make a test pass"* — is why each assertion states the rule
rather than the current behaviour: there is nothing here to relax.

### 1.31.10 Sweep 1 — the scanner had a hole shaped like the word "user"

**`PLACEHOLDER` was case-insensitive.** `docs/DATABASE.md` writes a connection string as
`postgresql://USER:PASSWORD@HOST…`, and those shouted words are what make it obviously an
illustration — so they were excluded. Matching them with `/i` excluded something else as well:
**every real credential whose username contains the letters `user`.**
`postgres://dbuser:<a real password>@…` was classified as documentation and never reported.

A scanner with a hole shaped like the most common username in the world is worse than no scanner,
because it is trusted. Shouted placeholders are now matched **exactly**, and only the genuinely
case-insensitive markers — `example`, `your-`, `<…>` — stay loose.

**Then the fix created a second hole, and the harness caught it in one run.** Adding `SECRET` and
`KEY` to the exact list looked harmless and meant that a PEM private-key header — which contains the
word `KEY` — was excused as an illustration. The single most serious thing the scanner exists to
find, silently ignored by the rule meant to reduce noise. It failed the first time
`pnpm verify:security` ran, which is the entire argument for the change that made it testable at all:
the matching moved out of `scripts/` and into `lib/security/secret-patterns.ts`, because **a scanner
that cannot be driven by a harness is a scanner nobody finds out has stopped matching.**

Two smaller findings from the same extraction:

- **Only the first match on a line was reported.** A `.env` pasted into a document would surface one
  line and hide the rest, which defeats the point of a report somebody is meant to clean up in one
  pass. `matchAll` now, per pattern.
- **The harness's own fixtures tripped the scanner**, as `verify-analytics.ts`'s did. The fix there —
  marking them `EXAMPLE` — cannot work here, because half of these assertions are that a credential
  **is** found and `EXAMPLE` is a placeholder marker. So the prefix and the body are separate string
  literals joined at runtime: the line in the file contains no contiguous match, the value passed to
  `findSecrets` does. Allowlisting `scripts/` was the tempting third option and is a hole exactly
  where a real key gets pasted while debugging.

One unrelated fix: **the newsletter's Turnstile refusal wiped the address the customer had just
typed.** Verification failing is the case where somebody is *most* likely to try again, and making
them retype is a punishment for a challenge that expired while they read the page. `values` is echoed
now, as `lib/auth/actions.ts` already did for the same reason.

`pnpm verify:security` is **64/64**, up from 51.

### 1.31.11 Sweep 2 — the form was guarded and the door beside it was not

**`POST /api/customers` created accounts with no challenge at all.**

Phase 26 put Turnstile on the registration *form*. `customers.create` was `() => true`, and Payload's
REST surface is public — so a bot never had to load the form. The same write was one unauthenticated
request away, with no widget, no token and no round trip to Cloudflare.

That is §26.1a's own warning one level further out than the sentence is usually read. *"Client-side
widget alone is not security"* is about the widget; this is about the **set of paths to the write**.
Verifying in the Server Action is necessary and, on its own, still not sufficient.

The fix keeps the property Phase 7 deliberately built. `register` writes with `overrideAccess: false`
because *"the storefront gets no privilege the REST API does not have… one rule, auditable in one
file"*, and switching to `overrideAccess: true` would delete that rather than enforce it. So the rule
itself got stricter and stayed one rule: **staff, or a request carrying verification evidence.**

The evidence is `req.context`, and the reason it works is an asymmetry in Payload itself:
`createLocalReq` is the only thing that populates `context`, and the REST route never does. **It is a
value the network cannot supply.** The storefront still holds no privilege the REST API lacks — the
REST API simply cannot produce the evidence.

When Turnstile is unconfigured the guard skips and the action sets the flag anyway. That is correct
and is the point: the flag means *"this went through the guard"*, not *"a challenge was solved"*. The
guard decides whether a challenge was required.

**Two harness consequences, and the second is the interesting one.** `verify-access.ts` has two
checks asserting the password policy on registration; they now have to carry the evidence to reach
the thing they are testing, or they would keep passing while testing the new gate instead. And a new
check asserts the gate itself. **Neither could be run** — `verify:access` writes documents, and D-10
still holds it until a development connection string exists. `verify:security` covers the rule as a
pure function instead, which is six of the seventy checks.

**What is still open, stated rather than implied: `POST /api/customers/login` is not guarded.** It is
Payload's own auth endpoint and access control does not reach it, so the login form's Turnstile
protects the form and not that route. The mitigation is real but narrower than a challenge: the
five-failure lockout applies to REST logins too. Recorded as gap **G-18**.

The other public writes were checked rather than assumed: `newsletter-subscribers.create` is
`isStaff` — the Server Action writes with `overrideAccess: true`, so the guarded action is the only
public path — and `reviews.create` is `isActiveCustomer`, which needs an account before it needs a
challenge.

`pnpm verify:security` is **70/70**.

### 1.31.12 What is now owed

- **Turnstile keys.** Until `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` exist, the
  widget is not rendered and nothing is verified — by design, and stated in `TODO.md` §7 rather than
  implied to be protection that exists.
- **The contact form** — **G-08**, still, and now owed by two phases.
- **A browser pass over the four guarded forms**, which have never rendered a widget.
- **`payload@3.88.1`** when the `@payloadcms/*` packages catch up, so the advisory leaves the audit
  rather than being explained in it.
- **`verify:access`, first**, once a development connection string exists: this phase changed
  `customers.create` and could not run it. That is the one owed item with a security consequence.
- **`POST /api/customers/login`** — gap **G-18**, above.
- **The five database harnesses**, still held by D-10.

## 1.32 Phase 27 — testing strategy

Plan §27.1a–§27.1f. **Eight dependencies, all at exact pins** — `vitest` 4.1.11,
`@vitejs/plugin-react` 6.1.1, `@testing-library/react` 16.3.3, `@testing-library/user-event` 14.6.7,
`@testing-library/jest-dom` 7.0.1, `jsdom` 30.0.1, `@playwright/test` 1.62.1,
`@axe-core/playwright` 4.13.0. No migration.

**813 Vitest tests across 18 files, all green. 57 Playwright tests across 5 files, none of which has
ever been executed.**

### 1.32.1 Two Vitest projects, because one would have let a rule rot

`unit` runs in **Node** and `components` in **jsdom**. A module claiming to be pure that reaches for
`window` therefore **fails** rather than passing by accident — which matters in a project that spent
twenty phases drawing exactly that boundary and enforcing it three other ways (the `server-only`
guard, the ESLint fence on `env.core`, the `typeof window` backstop). A single jsdom project would
have been the one place the boundary was invisible.

`server-only` is aliased to an empty module. Next aliases that bare specifier **inside its own
bundler**, which is why the Payload CLI cannot resolve it either — Phase 19 measured the
`ERR_MODULE_NOT_FOUND` — and Vitest is a third loader with the same problem. The guard still means
what it means in the two places that matter: a browser bundle and the CLI.

### 1.32.2 The tests found five defects, and that is the phase's actual output

Not one of them came from reading the code again. Each came from an assertion somebody had to think
about hard enough to write down.

**`invalidSelection` never fired for the case feature matrix §7 names by title.** It caught a colour
or a size that exists nowhere on the product, and missed the ordinary version:
`?color=Cream&size=M`, where Cream/M was never made but **Black/M was**. `sizes` is every size across
the *whole product*, each entry carrying `missing` for the selected colour — so "M" was found, the
flag stayed false, and the live region that exists to say *"that combination is not available —
showing what we do have"* said nothing at all. The customer saw M apparently chosen, Add to bag
disabled, and no explanation. The rule the two original clauses were approximating is *they asked for
a specific combination and it does not exist*, and that is now the third clause.

**A merged cart line of quantity zero was reported as SOLD OUT when the variant was fully in stock.**
`clampQuantity` answers `{ clampedBy: null, quantity: 0 }` for a request of **zero** — nothing
clamped it, there was nothing to grant — and the merge's `?? 'soldOut'` fallback turned that into a
false statement about inventory. There is no `ClampReason` for *"you asked for none"* and inventing
one would widen a union three call sites switch on, so the row is simply not reported: nothing was
dropped, because nothing was asked for.

**`combined` contradicted its own documentation.** It was `sources > 1` counted over the concatenated
`[...customer, ...guest]`, so a variant appearing twice **inside one bag** came back `combined: true`
— against a field doc reading *"true when this variant was in both bags"*. A bag holds one row per
variant by design, and nothing in this pure function enforces that; the caller passes rows read from
the database.

**`canFulfillmentTransition` threw a `TypeError` where a refusal belonged.** The type says an unknown
`from` cannot reach it; the type is not what reaches it, because `planFulfillmentChange` is handed a
status read from the **database**. A column that gains an option in a migration before this table
does was a crash rather than an `unreachable`.

**The search panel could take the whole overlay down.** Its `scrollIntoView` effect built
`` `#${CSS.escape(options[active]?.id ?? '')}` ``, and `CSS.escape('')` is `''` — so the selector
became the single character `'#'`, which `querySelector` **throws** a `DOMException` on rather than
returning null. The `?.` after it shows a null was what the author expected. Reachable rather than
theoretical: the panel honours cross-tab writes to the recent-searches key, so arrowing to a late
option and clearing the list in another tab leaves `active` past the end. Every other consumer of
that stale index was already guarded; this was the exception.

One more, corrected in the copy rather than the logic: **`FULFILLMENT_COPY.notPaid` told an operator
something untrue about a refunded order.** The gate is `payment !== 'paid'`, which a refunded order
fails — it *was* paid and the money went back — while the sentence read *"this order has not been
paid for"* and advised cancelling an order that is already settled.

### 1.32.3 One reported defect was deliberately not fixed

`cartTotals` counts the units of an **unpriced** line while charging nothing for it, so a bag could
report *"3 items"* above a total charging for two. It was flagged as a null-means-unknown collapse
and the case is real.

It was left alone, and the reasoning is now in the source rather than in a commit message.
`lib/cart/cart.ts` filters on `unitPriceMinor !== null && maxQuantity > 0` **before** calling it, so
no unpriced line reaches this function on any live path. And the behaviour is a **written §14.1e
decision** rather than an oversight: an unavailable line should be *visible*, and a count that
silently dropped it would hide the discrepancy the bag is trying to show.

Making an unreachable path disagree with a documented decision is not a fix. Recording why is.

### 1.32.4 §27.1b's tests assert behaviour and accessibility, never markup

Query by **role and accessible name**, never by class, and no snapshot anywhere — the phase prompt
says *"prioritize business-critical logic and user flows over superficial snapshot coverage"* and a
snapshot is the fastest way to a suite that fails on every refactor and catches nothing.

Each file asserts what its control **refuses** to do as much as what it does, which is where this
project's rules live: the variant selector does not preselect a size, the quantity stepper's ceiling
is derived and not stored, the checkout summary does not render an unquoted shipping cost as *Free*,
the search panel is a real `<form method="get" action="/search">` that works before React arrives.

### 1.32.5 The quantity control's tests were wrong in an instructive way

Three failed and **two passed for entirely the wrong reason**, which is worse.

The field is a **controlled** `type="number"`. `userEvent.clear()` fires a change carrying `''`, the
component reads `Number('') === 0`, the floor turns it into `1`, and React re-renders showing "1"
**before the next keystroke lands** — so `clear()` + `type('8')` produces **18**. That is a fact
about a controlled value, not about the component.

The two that passed did so because `type('9')` against a ceiling of 3 clamps to 3 whether the field
held 9 or 19. A green test asserting nothing is the failure mode a test suite is supposed to prevent,
and it appeared in the suite's own first hour. All of them now send the single change event a real
select-all-and-type delivers, and the helper says why.

### 1.32.6 §27.1c–§27.1e are written and have never run

An E2E suite **writes**: it creates customers, adds to bags, and opens Stripe Checkout sessions. The
only database this project can reach is **production**, and decision **D-10** exists to stop a
writing harness reaching it. This is the most destructive harness in the repository.

So `playwright.config.ts` starts no server unless `E2E_START_SERVER=1`, and §27.1f's own phrase —
*"E2E tests where environment permits"* — is the plan acknowledging this case rather than a loophole
being used as one.

Correctness therefore came from **reading the application**: every selector is a `data-slot` or a
role taken from `src/`, and user-facing copy is imported from `CART_COPY`, `SEARCH_COPY`,
`LOOK_COPY`, `REVIEW_COPY` and `WISHLIST_COPY` rather than retyped. There is no `waitForTimeout`
anywhere — web-first assertions and `waitForURL` only.

**Flow 4, "quick view → add to cart", is skipped because the feature does not exist.** Only the
wishlist third of §11.1c was ever built, and Phase 25 recorded `quick_view_opened` as an event
nothing emits (**DEV-74**). Faking a quick view to make a flow green would have been the one thing
worse than skipping it.

Flow 7 never speaks to Stripe: it signs its own events offline with
`stripe.webhooks.generateTestHeaderString`, the approach `scripts/verify-checkout.ts` established.
Flow 6 is the *"at least one real Stripe test-mode integration path"* the prompt asks to retain, and
it skips itself when the deployment answers 503 rather than assuming the harness's environment and
the server's match.

### 1.32.7 §27.1d's fifteen cases are enumerated even where they cannot be driven

Four are unconditionally skipped, each naming exactly what would be needed: a product unpublished
mid-test, a price changed mid-test, an expired promotion row, and a duplicate webhook. All four need
a database write.

The enumeration is kept anyway. Fifteen entries with four honest skips is a list somebody can act on
when the environment arrives; fourteen entries is how a case gets forgotten.

The rest are real tests, several driven with `page.route` — the image-failure case aborts image
requests and asserts §8.1d's actual rule, that the reserved box comes from the **context** and not
the asset, so the layout does not shift.

### 1.32.8 §27.1e is automated and is explicitly not sufficient

Axe over the six routes §27.1e names, at `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`, asserting
**zero** violations, with no blanket `disableRules`.

The `/checkout` scan carries a trap worth naming: the route redirects to `/cart` when the bag is
empty, so a bare `page.goto('/checkout')` scans the **bag**, finds nothing, and reports green having
never looked at checkout. The spec seeds a bag through the real UI first and asserts the URL
afterwards.

The file ends with the manual list, because the plan says outright that automated tools *"cannot
cover all interaction and content problems"*: the cart-drawer and search-overlay focus traps, the
variant selector's roving tabindex, the skip link, and the hotspot popovers.

### 1.32.9 The CI pipeline would have skipped its own build

§27.1f's order exactly: install → typecheck → lint → unit tests → build → E2E where permitted, with
format-check and the four database-free harnesses added.

The first version guarded the build with `if: env.DATABASE_URL != ''` while defining `DATABASE_URL`
in that step's **own** `env:` block. A step's `if:` cannot see its own `env:` — the `env` context in
a condition resolves against workflow- and job-level env only — so the condition read an empty
string, `'' != ''` was false, and **the build would never have run**. A skipped step that reports
success is the worst shape a pipeline can take, and it is invisible until somebody reads a log.
Moved to job level, where the condition can see it.

That the four harnesses run in CI **without any secret** was verified rather than assumed: `.env` was
blanked and `pnpm verify:seo` still passed 94/94.

### 1.32.10 What is now owed

- **Run the E2E suite**, which needs a disposable database. It is the largest thing D-10 is holding,
  and it is now holding most of a phase rather than a corner of one.
- **Install Playwright's browsers** once per machine — `pnpm exec playwright install --with-deps
  chromium`. `pnpm install` does not.
- **The manual accessibility pass** listed at the end of `accessibility.spec.ts`.
- **The five database harnesses**, still held by D-10, and `verify:access` first because Phase 26
  changed `customers.create` and could not re-run it.
- **The latent `Math.max(1, …)` traps.** Five places share the idiom `money.ts` itself documents as
  *"reads like a clamp and is not one"* — `clampQuantity`'s policy, `productCardState`'s threshold,
  the percentage branch of `calculateDiscount`, and two others. Every one is currently unreachable
  because the settings reader rejects the values that would trigger them, so none was changed; they
  are recorded here so the next phase that touches those numbers knows they exist.

## 1.33 Phase 28 — admin experience

Plan §28.1a–§28.1d. **No dependency, and no migration** — `pnpm migrate:create` reports *"no schema
changes detected"*, because every change in this phase is admin metadata, field access, a hook or a
validation. One new field, `promotions.liveNow`, which is `virtual: true` and therefore has no
column.

**`pnpm verify:admin`: 87/87**, against the development branch, through the live Payload access and
validation layer.

### 1.33.1 Two of the findings were bugs, not missing configuration

**`admin.readOnly` on `products.derived` was decorative, and that made it a live data-loss path.**

Payload's `readOnly` is a *widget* attribute. The value stays in form state, and `Form`'s submit body
is `reduceFieldsToValues(fields, true)`, which drops only `disableFormData` fields. So the ordinary
authoring flow — open a product, add sizes in the Variants drawer, save the product — **wrote back
the pre-variant copy of `derived`**, setting `priceFromMinor` to null and withdrawing the product
from the shop, on a save the editor believed was a no-op.

Field access closes it, and closes it in the right way: access *deletes the key* and falls back to
the stored value rather than failing, so an editor never sees an error for a field they did not
knowingly touch. `syncProductDerived` is unaffected, because it writes through the Local API with the
default `overrideAccess: true`.

**Every money column on an order was freely editable by staff**, in the panel and over REST, on a
record with no version history. §28.1d asks the admin to refuse *"invalid refunds"*, and the closest
thing to a fake refund this admin ever permitted was not a status — it was typing a smaller total.
`currency`, `subtotalMinor`, `discountMinor`, `shippingMinor`, `taxMinor`, `totalMinor` and
`discountCode` are now `nobodyField` on update, alongside `paymentStatus`, which Phase 17's sweep had
already closed. An order's amounts are a **snapshot of what was actually charged** (§18.1d); one that
disagrees with Stripe is a reconciliation nobody can win.

### 1.33.2 §28.1d's one genuinely missing guardrail

Nothing stopped `status: published` on a product with **no active priced variant**. The save
succeeded, the sidebar said Published, and `publishedProductWhere` then removed it from the shop,
from search, from the sitemap and from every rail — with no message anywhere in the panel, because
the rule that hid it lives in a query an editor never sees.

`refuseUnsellablePublish` refuses the **transition** to published, reading `derived.priceFromMinor` —
the same column `publishedProductWhere` filters on, so it is the *same rule* rather than a second
opinion. The variants are read only on the refusal path, to tell three cases apart: *"add a
variant"*, *"switch one back on"* and *"the summary is stale"* are three different actions, and one
message covering all three would send an editor looking for a variant that is already there.

Three deliberate exemptions, each written into the hook:

- **Only the transition.** A published product losing its last variant is a legitimate withdrawal,
  and refusing that save would make the ordinary way to retire a line impossible. It is also what
  keeps the hook off `syncProductDerived`'s path.
- **Duplicate slips past it, and that is the better outcome.** Payload's duplicate is a `create` that
  hands the hook the *source* document as `originalDoc`, so a copy of a published product reads as
  "already published". The copy is unsellable and filtered out of every listing exactly as the rule
  intends. Refusing the button would be worse: a duplicate saves immediately, so there is no form in
  which to set it to draft first and the editor is left with an error they cannot act on. **Verified
  by reading `collections/operations/create.js`, not assumed.**
- **Only for a request with a user.** The seed, an import and a migration build a catalogue in an
  order they control and are not a person clicking Publish. Nothing is lost, because this is an
  authoring guardrail and **not a security boundary** — the authority remains
  `publishedProductWhere`, which filters an unsellable product out however the row was written.

**A missing image is deliberately not malformed**, despite the phase prompt listing it.
`publishedProductWhere` does not look at the gallery, and §8.1d answers an absent image with a
deliberate neutral placeholder — so the product is visible, buyable and merely ugly. Blocking the
save would have invented a rule the storefront does not hold.

### 1.33.3 The other four guardrails were already there, and were verified rather than assumed

| §28.1d | State |
|---|---|
| Arbitrary order transitions | `hooks/orderTransitions.ts` already ran `planFulfillmentChange` on every write. Confirmed bulk edit does **not** bypass a collection `beforeChange` hook |
| Invalid refunds | `paymentStatus` was already `nobodyField`; the amounts were not, and now are |
| Negative inventory | `min: 0`, a custom `validateStock`, **and** a real `inventory_quantity >= 0` CHECK. The harness asserts both layers, because they fail differently — 23514 from Postgres past validation entirely |
| Duplicate SKUs | A real Postgres UNIQUE, asserted as 23505 rather than only through Payload's pre-check |

Four smaller ones were closed along the way: a category could be made its own **ancestor** beyond one
hop (Phase 6 stopped the one-hop case and deferred the rest); a compare-at price at or below the
price was accepted and then silently rendered as nothing; a promotion whose `endsAt` preceded its
`startsAt` was accepted and could never be live; and `promotions.timesUsed` was guarded on update
while **open on create**, so a new code could be born claiming redemptions it never had.

### 1.33.4 Order search matched the order number and nothing else

Payload's list search silently defaults to `useAsTitle`, which on a support desk reads as *"search is
broken"* rather than *"search is narrow"*. It now covers the customer email, the tracking number and
the Stripe ids a support agent copies out of the Stripe dashboard — which is the actual first move
when a customer writes in.

### 1.33.5 The descriptions were rewritten for the person the prompt names

*"Keep the admin useful to a non-technical client"* is a requirement, and a description reading *"The
product title"* does not meet it. They now say what happens when you get it wrong:

> How many of this exact colour and size are in the warehouse. 0 shows the size as sold out; it can
> never go below 0. **This number goes down by itself when an order is paid for — never reduce it by
> hand to account for a sale, or that sale is counted twice.**

That one sentence prevents a class of stock error that no validation can catch, because both numbers
are individually legal.

### 1.33.6 No custom dashboard, on purpose

The prompt says *"without introducing unnecessary custom dashboard complexity"*, and the whole phase
holds to it: **no `admin.components` were added at all.** Everything is `admin.description`,
`defaultColumns`, `listSearchableFields`, `useAsTitle`, `filterOptions`, field `access`, `validate`
and hooks. `promotions.liveNow` — the one thing that looks like a widget — is a virtual text field
computed by an `afterRead` hook from `validatePromotion`, the same function checkout runs. A code
reads *"Used up — it has reached its total usage limit"* rather than leaving somebody to compare two
counters.

`filterOptions` was **considered and rejected** on `products.categories`, on evidence rather than
taste: Payload's relationship validator ends in `validateFilterOptions`, which re-runs the filter on
every save of an existing value. Restricting it to published categories would make every product in a
category that was later unpublished unsavable — including for an unrelated stock edit.

### 1.33.7 Sweep 1 — the footer pointed at eight routes and none of them existed

`/help/faq`, `/help/contact`, `/help/shipping`, `/help/returns`, `/order-tracking`, `/about`,
`/legal/privacy` and `/legal/terms`. **Every one a 404**, in the most-rendered component in the
project, on every page of the shop. The seeded navigation carried its own variant of the same list.
This is §0.1.17's fake control at the largest scale it has appeared in this build.

Three are now real, and the content for all three had been in the CMS for phases:

- **`/help/faq`** renders the `faqs` collection — a collection §28.1c names as a managed surface and
  which, until now, **rendered nowhere.** That is precisely the defect Phase 23 found in the
  `gallery` and `pullQuote` blocks: an editor fills it in and the site silently discards it.
- **`/help/shipping`** and **`/help/returns`** render `site-settings.shippingPolicy` and
  `returnsPolicy`, whose own field descriptions have said *"and the shipping support page"* since
  Phase 6. They read the same field the PDP accordion reads, because `SiteSettings.ts` calls these
  *"one policy with one source"* and **G-08** already recorded that a support page must not keep a
  second copy of the words.

The rest are **removed rather than faked**. Contact is G-08. Order tracking and About have no route
and no phase claiming them. Privacy and Terms are legal text somebody has to write and be accountable
for — generating plausible privacy copy would be *worse* than the broken link, because it would be a
false statement about what this shop does with personal data, on the page a regulator reads first.
Recorded as gap **G-19**.

Two more, in files no agent owned:

**`seoField()`'s `publishedAt` description was wrong for four of the five collections that use it.**
It read *"a future date schedules the page"*, and that is true only where a **query** enforces it.
`publishedProductWhere` does. `publishedOnly` — the access rule the four editorial collections read
through — checks `status` and explicitly **not** `publishedAt`, so a future-dated collection, edit,
lookbook or article is reachable at its own URL the moment it is published; the date embargoes it
from navigation and the homepage and nothing else. Four collections were being described by a
sentence true of a fifth.

**`Reviews.access.update` is `isStaff`, and it has to be** — somebody moves a review between pending,
approved and rejected. It also let a moderator rewrite the customer's `body`, `rating`, `title` and
`displayName`. §21.1b defines moderation as three states, not as authoring, and a staff-edited review
is **words put in a customer's mouth, under their own name, on a public page, with no version
history**. The four customer-authored fields are now `nobodyField` on update. A review that must not
be published is *rejected*, which is the control that exists for it.

### 1.33.8 Sweep 2 — verifying the guardrails rather than trusting their framing

The Duplicate escape above was **checked against Payload's own source** rather than accepted from a
report, and the reasoning holds: the copy is unsellable, filtered out, and one click from being
fixed, while refusing it would hand an editor an error with no form in which to act on it.

The sweep's own finding was a hole in the *harness*: section B proved the payment **axis** could not
be typed and never touched the **amounts** — which were the fields Phase 28 had just locked. Eight
new assertions cover them, each with a legitimate field riding along in the same write, so a working
denial is told apart from an update that failed for some other reason. 79 → 87.

### 1.33.9 What is now owed

- **`product_variants.sku` is unique case-SENSITIVELY.** The `beforeValidate` hook uppercases, so
  every path through Payload normalises before the index sees it; a raw SQL insert of `adm-1`
  alongside `ADM-1` is accepted. A case-insensitive index is a migration, and this is recorded rather
  than done for the same reason Phase 27's five `Math.max` traps were: it is unreachable through the
  application, and a defensive migration is not sweep work.
- **`campaigns.collection` and `campaigns.products` are read by nothing.** DEV-39 removed campaigns
  from the route map, so a campaign surfaces only as the homepage hero, which uses neither. Both are
  now honestly labelled *"stored and never rendered"*; dropping them is a migration and a decision.
- **A refusal from `enforceOrderTransitions` is unreadable on the bulk-edit path.** Payload's bulk
  endpoint collapses per-document errors into *"unable to update N out of M"*. A framework
  limitation; mitigated by `disableBulkEdit` on the fields where it matters most.
- **An admin-initiated refund action**, deliberately not built. It needs a custom control and a server
  endpoint calling `stripe.refunds.create`, and a control that looked like it moved money and did not
  would be the exact thing §0.1.17 forbids. Refunds are initiated in Stripe and land here signed.
- **`cancelledAt`** — a genuine asymmetry. `shipped`, `delivered`, `paid` and `refunded` all carry a
  timestamp; `cancelled` is terminal and carries none.
- **Per-block `admin.description`** in `payload/blocks/home.ts` and `blocks/editorial.ts`. Payload's
  `Block` type has no `admin.description`, so each block's requirements would have to live on a field
  inside it. `SECTION_GUIDE` in `Homepage.ts` covers the homepage today and paraphrases
  `resolveSection` — nothing enforces that the two agree.
- **The five database harnesses and the 57 Playwright tests**, still unrun. The development branch
  exists now and they are free to run — `verify:access` first, because Phase 26 changed
  `customers.create` and could not re-verify it.

## 1.34 Phase 29 — content seeding and demo data

Plan §29.1a–§29.1d. **No dependency and no migration.** Ten products became **twenty-eight**, across
all ten categories §29.1b names, and the seed writes customers, orders and reviews for the first time.

**Every harness in the project ran, and passed: 1,819 checks across twenty-two of them**, plus 813
Vitest tests. That had never been true before — the development branch arrived in this phase.

### 1.34.1 The seed now writes records of things people did, having refused to for twenty-three phases

`seed.ts`'s own docblock said it created no customers, orders or reviews, and gave a good reason:
*"a commerce demo whose order list is fiction is worse than one whose order list is empty."*

§29 is the phase that argument was written against. The prompt asks for content *"sufficient to
demonstrate every feature"*, and four features **cannot be demonstrated empty**: the review block, the
moderation queue, the account order history, and the admin's order list. An empty table does not show
a reviewer that reviews work — it shows them a page with nothing on it.

The docblock now makes the argument rather than contradicting it, and four things keep it honest:

- Every seeded person is on **`@example.test`**, a reserved TLD that cannot receive mail. Not
  decoration: Phase 19's queue will happily try to email a seeded customer.
- **`verifiedPurchase` is set only where the customer genuinely has a paid order for that product** —
  the same question `hasPaidOrderFor` asks. A fabricated badge is precisely the lie §21.1a exists to
  prevent, and it would be invisible.
- Ratings and states vary: nine approved, one pending, one rejected, across nine products, including
  a two-star with a specific criticism. A wall of five stars demonstrates nothing.
- Passwords live in `docs/DEMO_ACCOUNTS.md`, **git-ignored** — §29.1d's *"never commit real
  credentials"*.

Six orders span every fulfilment state the machine has, so the admin's order list demonstrates the
machine rather than repeating one row.

### 1.34.2 §29.1c's real test is "authored rather than generated from a template"

That clause is the whole difficulty of the phase, and it is not satisfiable by a loop. Concretely,
across the eighteen new products: colour counts run **1 to 4**, size runs **3 to 5** in **two
vocabularies** (XS–XL and waist 30–36), descriptions **1 to 4 paragraphs**, materials **1 to 5**
lines, care **1 to 3**. Two of seven tops carry a compare-at price rather than all of them, because a
sale on everything is a sale on nothing. Stock is set so all three of §11.1b's card states are
reachable, and several products have **one size** at zero so the disabled option in the size selector
is visible in the demo rather than only in a test.

The data lives in five modules under `scripts/seed/` because it is long and the orchestration is not
— and because five agents could then write it at once without contending for one 1,400-line file.
Their `sortOrder` bands are disjoint **by agreement**: the original ten hold 10–100, tops 110–170,
lower 175–200, accessories 210–250. The column is `required` but not unique, so a collision would not
error; it would make the merchandised order arbitrary between the colliding rows, which surfaces
months later as *"the shop looks shuffled"*.

### 1.34.3 `generate:media` duplicated every asset on a second run, and the safe repair was not the obvious one

The script uploaded unconditionally. A second run against the same catalogue therefore created a
second copy of **all 78 assets**, repointed every field at the copy, and left the original orphaned.
Invisible while it only ever ran once against an empty library — and this phase made *"run it again
for the new products"* the ordinary case.

**`--clean` is emphatically not the answer**, and this file's own docblock already said why: the
Cloudinary public id is derived from the filename, so development and production address the **same
objects**, and deleting a Payload upload document tells the storage adapter to delete the object
behind it. A `--clean` against development would have taken production's images down.

So the repair went the other way: every field was repointed at the **original** asset and only the new
duplicates were deleted. The public ids production references were never touched. 78 rows before, 78
after.

Every loop is incremental now — product galleries, colour swatches, category and collection imagery,
edits, journal, lookbook covers, campaign frames, the Open Graph image. A repeat run reports **0
generated** and names what it skipped, because a run that says *"0 assets"* and nothing else looks
like a failure.

### 1.34.4 Sweep 1 — the development branch made twenty-two harnesses runnable at once, and four were wrong

**`verify:lookbook` and `verify:editorial` could not start at all.** Both import the storefront read
layer, which is `server-only`-guarded, and `server-only` is **not an installed package** — Next
aliases the bare specifier inside its own bundler and that alias exists nowhere else. Phase 19
measured the same `ERR_MODULE_NOT_FOUND` against `payload.config.ts`; Vitest needed an alias of its
own in Phase 27; these two were the **third** instance, dormant because D-10 had held them since
Phase 22.

Fixed with a `tsconfig.json` `paths` entry pointing at an empty stub, which is what `tsx` resolves
through. **That the Next build guard still bites was verified, not assumed**: a client component
importing `@/lib/env.server` was added temporarily, and `pnpm build` refused it and named the import
chain. The real `server-only` package is deliberately **not** installed — its `exports` map resolves
to a throwing `index.js` under everything but the `react-server` condition, so installing it would
make the CLI throw rather than resolve, which is the opposite of what is wanted.

**`verify:catalog` found a real defect that twenty-seven phases could not.** Postgres breaks a price
tie on `slug`; the Algolia replicas broke it on **nothing**, leaving two products at the same price in
whatever order the index's internal ranking gave. The assertion that the two engines agree *in order*
passed for ten products with ten distinct prices, and failed the moment twenty-eight produced **four
ties**. Both engines now end on `asc(sortOrder)` — distinct per product, present on both sides, and
therefore a **total** order, which is what the assertion was always about. `sortOrder` rather than
`slug` because Algolia's `customRanking` orders on numeric and boolean attributes and a slug is
neither. The tiebreak stays ascending under `price-desc`: it is a stable secondary key, not part of
the direction the customer chose.

**And the harness itself was wrong.** It fetched a page from each engine and filtered its own fixtures
out of the Postgres side *afterwards*, which only worked while a page had room to spare. Twenty-eight
products filled it, two slots went to fixtures, and it reported the engines disagreeing when they did
not. A harness that cries wolf about the thing it exists to watch is worse than one that is silent.
The fixtures are excluded in the query now.

**`verify:account` failed nine checks against behaviour that was right.** Written in Phase 20 and
never run, its fixture created a published product with **no variants** and expected the wishlist to
accept it. `publishedProductWhere` requires `derived.priceFromMinor`, which comes from the variants,
so `saveToWishlist` correctly answered `unavailable`. The fixture has a variant now — the same rule
Phase 28's publish guard states from the authoring side.

**`verify:shell` asserted the footer's legal row is two links.** Phase 28 emptied it because both were
404s and recorded gap **G-19**. The assertion is **inverted rather than deleted**, so restoring the
links is a deliberate act that has to come here and say so.

### 1.34.5 The seed does not update the search index, and now says so

`syncSearchIndex` is on `products.hooks.afterChange`, fires on every write the seed makes, and does
nothing: it resolves credentials through `@/lib/env.server`, which cannot resolve under the CLI. The
hook logs that at **debug** and returns, which is correct — it is the expected state for `pnpm seed`,
and a warning per product would be noise on a healthy run.

The consequence only became visible here, when the script started writing eighteen products instead of
updating ten: `verify:catalog` failed eight checks because the index held ten products and the
database held twenty-eight. Not a defect — a step nobody was told to take. The seed's closing line
now tells them.

### 1.34.6 Sweep 2 — eighteen of twenty-eight products belonged to no collection

§29.1c lists it in one line: *"Every product should have… collection assignment."* The four collection
lists were written against a catalogue of ten, and a product module cannot know what a merchandiser
would file its garment under — so the eighteen new products were reachable **only from the shop
grid**: absent from `/collections/*`, from the homepage's collection feature, and from the collection
facet in the filter panel, which is the surface §11.1d's *"filter by collection"* is about.

All twenty-eight now sit in at least one, ordered as a merchandiser would show them rather than
alphabetically — `Collections.ts` is explicit that *"dragging a row is the curation"*. A product may
sit in more than one, which is why `wool-overshirt` is in both Current Season and Limited: a
collection is a point of view, not a folder.

### 1.34.7 What was verified, and how

| Gate | State |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm lint --max-warnings 0` | passes |
| `pnpm build` | passes |
| `pnpm test:run` | **813** |
| Twenty-two `verify:*` harnesses | **1,819 checks, all passing** |
| `pnpm scan:secrets` | clean, 436 files |
| Seed idempotency | **run twice, every count identical** |
| `generate:media` idempotency | **run twice, 0 assets generated** |

§29's own requirement — *"seed scripts are idempotent and do not duplicate data when run twice"* — is
asserted by running them twice and comparing counts, rather than by reading the upserts and believing
them.

### 1.34.8 What is now owed

- **The 57 Playwright tests.** They are the last thing D-10 was holding and they are now runnable:
  `pnpm exec playwright install --with-deps chromium`, then `E2E_START_SERVER=1 pnpm test:e2e`
  against the development branch.
- **`/help/contact`** — gap **G-08**, owed since Phase 19 and now by three phases.
- **`/legal/privacy` and `/legal/terms`** — gap **G-19**. Legal text somebody has to write.
- **Real photography.** Every image in the demo is generated fabric and lit-ground art. It is
  deliberate stand-in work and it deletes cleanly, but it is the most visible thing between this and
  a shop that looks finished.
- **`campaigns.collection` and `campaigns.products`**, still read by nothing (Phase 28).

## 1.35 Phase 30 — performance and responsive polish

Plan §30.1a–§30.1d. **No dependency and no migration.** The phase began by asking a real browser for
every href in the navigation, and the first thing it measured was not a layout problem at all.

### 1.35.1 Four navigation links had answered 404 on every page since Phase 23

`documentHref` in `lib/navigation/routes.ts` is the one map every link in the application goes
through, and it emits `/edit/<slug>`. Phase 23 built the detail route as `/edits/[slug]`. The mega
menu, the footer, search suggestions and — from Phase 24 — the sitemap all pointed at a spelling no
route answered to. **The route was renamed to match the map**, not the map to match the route,
because the map is what the rest of the code already agrees with.

`/collections` and `/edit` had no index at all: Phase 23 built the detail pages and recorded both as
owed, and Phase 28's audit repeated it. One reader (`getCollectionIndex` / `getEditIndex`) and one
component (`EditorialIndex`) serve both, because the two differ in their detail pages and not in what
an index shows. `/lookbook` and `/journal` keep their own cards — a season, a category and an excerpt
are different cards, not one card with a prop.

`/about` exists nowhere and no phase claims it. It was removed from the primary navigation, the
fallback navigation and the seed, and the homepage's brand block now sends readers to the journal.
**DEV-07 is amended from six primary items to five** — see §1.35.4.

Every page of a local production build also requested `/_vercel/speed-insights/script.js` and got a
404: `appEnv` is `production` for any `NODE_ENV=production` build, including `pnpm start` on a laptop,
and the beacon exists only on Vercel. The component now requires the platform (`VERCEL`), not merely
the build mode — which is what its own docblock already said.

### 1.35.2 The product page spent two seconds before its first byte

TTFB was **2.1s** against a round-trip floor of about **80ms** to the development branch. Home and
`/shop` answered in 0.09s; the product page was the slowest page in the shop by a factor of twenty,
and none of it was images — every image on the page had arrived by 190ms. Three causes, each
measured on its own:

| Cause | Measured |
|---|---|
| The product read at **depth 2**, with a comment naming `variants[].image` as the second hop. The variants are never read through the product — `readVariants` queries them. The second hop bought the `variants` **join**, ten rows deep with every image, and the `collections` join, all discarded. | 770ms → **380ms** at depth 1 with joins off |
| Recommendations and variants were two `await`s **inside an object literal**, which JavaScript evaluates in order. Neither depends on the other. | one full query removed from the critical path |
| **No storefront read anywhere passed `joins`**, so every product read — every card on every grid — populated both join fields for nothing. | recommendations 450 → 300ms |

Nested products needed a different lever. `joins: false` on the outer query **does not reach a product
populated through a relationship** — measured: a collection at depth 2 still fetched nine products
with ten variants each. `PRODUCT_CARD_POPULATE` in `lib/catalog/resolve.ts` is the six fields a card
and a tile read, passed as `populate.products` on the four editorial depth-2 reads. Its docblock says
what to do when a card starts reading a seventh: a field missing from the select arrives `undefined`,
which a card treats as *unknown*, so the failure mode is a card that quietly says less.

The edit page resolved its product groups **one query at a time, in series**, under a comment
reasoning that groups are few. True — and on a database a round trip away, also the whole cost. One
query for the union now; each group takes its own products back out in its own order.

| Route | Before | After |
|---|---|---|
| `/product/field-jacket` | 2.09s | **1.07s** |
| `/collections/current-season` | 1.72s | **1.23s** |
| `/edit/cold` | 1.45s | **1.07s** |

**Every change was checked by rendering eleven routes before and after and diffing the DOM** (scripts
and hashed asset paths stripped). All eleven are byte-identical. What changed is how long they take.

**That proof was narrower than it sounds.** Eleven identical routes did not include a lookbook with a
hotspot, and the populate select dropped every one of them — sweep 1 found it (§1.35.6), and the harness
that now guards it was proven by putting the bug back.

### 1.35.3 The product page scrolled sideways on every phone, from two one-pixel spans

`scrollWidth` 448 in a 320px viewport; 531 at 375, 613 at 430, 1099 at 768. The offenders were two
`sr-only` spans inside the gallery's buttons. `sr-only` is `position: absolute`; with no positioned
ancestor its containing block is the **initial** one, and an absolutely positioned box is **not
clipped by an `overflow` ancestor that is not its containing block**. So both spans escaped their
scrollers and widened the document. `relative` on the buttons makes each its own containing block,
back inside a scroller that clips. Nothing moves.

### 1.35.4 Image sizing, touch targets and layout shift — measured at §30.1a's eight widths

- **The editorial index grids over-fetched 3.2×.** All four used `figureContained`, which promises the
  whole container, for a card a third of it. `EDITORIAL_GRID_TWO_UP` and `EDITORIAL_GRID_THREE_UP` in
  `lib/media/grid.ts` are derived from the container's three regimes and checked against the rendered
  card at nine viewports; every tier is exact. The 1440–1600 tier exists because `max-w-page` caps the
  container before the padding `clamp` reaches its ceiling — a band where the container **shrinks as
  the viewport grows**.
- **Touch targets: 134 elements under 24px tall at 375px, and every one passes** WCAG 2.2 AA 2.5.8 by
  its spacing exception — nearest neighbour 38px or more, measured centre to centre. Reported rather
  than "fixed", because enlarging inline text links would have been a visual change with no
  accessibility gain.
- **CLS 0** on home, shop, product, collections and journal at 375 and 1440.
- The first audit's forty "image has no `sizes`" findings were the audit's fault: inside `<picture>`
  the `<img>` is the no-`srcset` fallback and the sources carry `sizes`. The harness now reads the
  matched source.

### 1.35.5 The fallback header had its own 404, and verify:shell could not have seen it

The fallback's NEW went to `/new`. The live navigation has always sent it to `/shop?sort=newest`; this
copy invented a route. Invisible, because the fallback renders only when the CMS read has failed.

`verify:shell` asserted the fallback had **six** links — and failed the moment ABOUT came out, which is
how it was found. The count was never the question. It now builds the set of pages from `src/app` on
every run and resolves **every fallback, utility and live navigation href** against it — 25 live hrefs
today — with a negative control first, so a matcher that answered *yes* to everything cannot pass.

**DEV-07, amended:** five primary items — NEW · SHOP · COLLECTIONS · EDIT · LOOKBOOK. ABOUT returns
when there is a page behind it, and the assertion is written so that bringing it back has to come
through the harness and say so.

### 1.35.6 Sweep 1 — twenty-seven findings, twenty-six confirmed, and the worst one was mine

Five read-only finders — mobile UX, performance, layout shift, the surfaces the first audit had not
visited, and a correctness review of this phase's own diff — each followed by an adversarial verifier
that re-measured every finding and tried to refute it. One was refuted (a data gap, not a defect). Ten
of the twenty-six came back with a **corrected** fix, and three of those corrections mattered.

**The highest-severity finding was a regression this phase introduced.** `PRODUCT_CARD_POPULATE`
shipped without `status` and `publishedAt`. `resolveProductTile` asks `isPublicDocument` before it
will link a product, and that asks `status === 'published'` — so every hotspot in every lookbook, and
every tile in a `productGroup` or `shopTheLook` block, resolved to *unpublished* and was dropped.
`/lookbook/in-black` rendered **0 of its 6** hotspots. The before-and-after DOM diff meant to prove the
read-layer change safe did not catch it: the card path never checks `status`, and the one lookbook the
diff rendered had no hotspots to lose. A proof is only as good as its fixtures.

Both fields are back, and `publishedAt` is not optional — `isPublicDocument` skips its scheduled-drop
gate when the key is *absent*, so selecting `status` alone would have let a product scheduled for next
week link from a lookbook today. `verify:editorial` now resolves every published lookbook twice through
the same resolver — once from a full read, once through `getLookbook` — and requires them to agree.
**Proven by reintroducing the bug:** the check failed with `in-black: 0 of 6`, and passes with
`6 hotspot(s) across 2 lookbook(s)` restored.

**Performance — about a third of every page's JavaScript was two things doing nothing:**

| Route | First-load JS, gzip, before | After |
|---|---|---|
| `/` | 369,897 B | **256,951 B** |
| `/shop` | 366,679 B | **253,746 B** |
| `/product/field-jacket` | 372,784 B | **255,302 B** |
| `/cart`, `/journal` | 352,470 B | **240,604 B** |

- **All of Zod, 65 KB gzip, on every route**, to re-validate ten optional `NEXT_PUBLIC_*` strings in the
  browser. `env.public.ts` imported it, and `env.public.ts` is reached by client components —
  `MediaImage` alone by four. The schema now lives in `env.schema.ts`, imported only by `env.core.ts`,
  which `instrumentation.ts` evaluates on every server start — and `ServerEnvSchema` *extends* the public
  schema, so an invalid public variable still fails the deployment at boot. `env.public.ts` takes the
  `PublicEnv` type with `import type`, which is erased. **Not** `server-only` on the new module, because
  `env.core.ts` must stay loadable by the Payload CLI; a `typeof window` backstop instead, the one
  `env.core.ts` already carries.
- **The Sentry browser SDK, ~58 KB gzip, on every route with no DSN configured.** The DSN check decided
  whether `init` ran, not whether the SDK was downloaded — against the rule `analytics.tsx` states for
  every other third party, *"not configured means not loaded"*. The verifier found the second door the
  finder missed: `global-error.tsx` imported it statically too, and Next ships that boundary with every
  route. Both now `import()` it behind the literal `process.env.NEXT_PUBLIC_SENTRY_DSN`, which Next
  substitutes at build. **The trade-off, for a deployment that does set a DSN:** the SDK arrives as an
  async chunk rather than before hydration, so an exception in the first few milliseconds is not
  captured. `global-error.tsx` and `onRequestError` still cover a root layout that throws and a server
  render that fails. Restoring the eager import is one line, for a deployment that has somewhere to send
  what it catches.
- Confirmed absent from every first-load chunk of `/`, `/shop` and the product page: no `ZodArray`, no
  `__SENTRY__`. **ESLint now forbids both** in the three files that sit in every client graph
  (`@typescript-eslint/no-restricted-imports`, which allows `import type`, and which does not replace
  the `env.core` ban the way reconfiguring the core rule for those files would have).
- The size guide's rich-text notes are rendered on the server and passed in as children, so the Lexical
  converters leave the product page's client bundle.
- The product video's `poster` was the untransformed Cloudinary original — a 696 KB PNG where the
  `f_auto` derivative is 21 KB. Latent (no seeded product has a video), and now built through the same
  URL builder as every other image.

**Layout shift the unthrottled pass could not see:**

- **Choosing a size moved the whole gallery — 0.36 CLS in one entry at 1440**, above the 0.25 "poor"
  line, on the most important interaction on the page. A size tap prepends the variant's photograph,
  which arrives with the server render about a second later, outside the 500ms input window. The frames
  were keyed by media id, so React inserted a new leading frame. Keyed by position, the leading 4:5 box
  is the same node and only its image changes. **Measured after: 0.0000 at 1440 and at 375**, with the
  variant photograph still in front.
- **The compact-on-scroll header moved the page on every return to the top**, and made scroll anchoring
  snap any 1–16px scroll back to 0. The finder proposed a `fixed` header; the verifier refuted that — it
  would cover the announcement bar above it, which scrolls away by design. Now the bar's margin grows by
  exactly what its height loses, on the same token and curve, so its footprint is 72px at every frame.
  **Measured after: zero layout-shift entries at 375 and 1440, and `scrollTo(2)` stays at 2.**
- Turnstile's container reserved no height, so the 73px widget pushed the submit button down after
  hydration (0.022 at 375 on `/login`, reproduced with Cloudflare's test key). It reserves the box now,
  and only when a site key means a widget will render.

**Mobile:**

- **The filter drawer closed after every tick** and dropped focus to `<body>` — the opposite of what
  `filter-drawer.tsx` promises. It was rendered inside `<Suspense key={canonicalHref}>`, and every filter
  write changes that key. The verifier found the sort select lost focus the same way; both controls now
  sit above the boundary. **Measured after: two ticks, drawer still open, focus on the checkbox; Escape
  returns focus to Filter.** The sort select no longer truncates its label at 320 ("Featurec") — the row
  wraps, and the select is 230px.
- **`/cart` scrolled sideways at 320** — an implicit single grid track sized to its items' min-content.
  `grid-cols-1` is `minmax(0, 1fr)`. Measured after: 320 of 320.
- **The cart drawer's pinned footer was 332px**, leaving one line visible at 320×568 and **none** in
  landscape, with Checkout below the fold. The summary now scrolls with the lines and only the two
  actions are pinned: at 568×320 the lines get 84px and Checkout ends at 240.
- **Swiping the gallery never moved the thumbnail selection.** It does now.
- **Checkout, quantity and discount inputs were 14px**, so iOS Safari zoomed the page on focus. 16px,
  matching `ui/input.tsx` — and not `lg:text-body-sm`, because an iPad at 1024 is `lg`.
- Commerce icon controls — steppers, remove, the bag opener, every drawer's close — were 36px on a
  phone. 44px below `lg`.
- Journal, Edit and Collection heroes were the desktop 16:9 frame on a phone (375×211). They take the
  upright `heroMobile` crop every other full-bleed hero already had: 375×469.

**Image sizing, three more tables:** product grids with no filter rail (collections, edits, journal, the
search landing) were **under**-fetched using the rail's sizes; Recently Viewed declared a two-up width
for a three-up tile; the lookbook gallery claimed the full container for a half-width tile. Each has its
own measured string now.

**Also fixed:** the `/collections` and `/edit` indexes fetched 17.7× the bytes they rendered — a
`select` of the four fields a card shows — and no longer turn a failed read into *"No collections are
published yet"*, a false statement about the catalogue made on the one occasion the page cannot know it.
`verify:shell`'s route matcher no longer treats a `_private` folder as transparent.

**And the part-2 commit would have failed CI.** `pnpm format:check` is a CI step but not one of the three
local gates `AGENTS.md` names, and `fallback.ts` was committed unformatted. Formatted — and every file
this sweep touched went through Prettier before the gate.

**One more, found by the gate rather than the sweep: the CLI could add to the search index and never
remove from it.** `verify:catalog` failed six checks — the index returned three products Postgres did
not have, `Verify Parka 537664`, `725785` and `822707`, one orphan per run of `verify:search` since
Phase 29. Phase 29 made `server-only` resolvable under the Payload CLI and guarded the product hook
against CLI index writes as a result; the sibling `syncTaxonomyRename` hook was missed. So renaming a
fixture category indexed its product from the CLI, and the cleanup's delete went through the guarded
hook and did nothing. `reindexWhere` now refuses CLI writes too, so the two can never disagree; the
three orphans were deleted from the **development** index (`north01_products_local`, asserted by name
before the delete); and `verify:search` now checks, after its cleanup, that none of its fixtures is
left in the index. Both harnesses pass: 210/210 and 148/148.

**Not done, and why:**

- **A sticky add-to-bag bar on the mobile product page.** No document specifies one — *"sticky"* appears
  in the structure and features documents only about the header, and §30.1d lists *"sticky purchase
  controls"* as something to test. Measured: the button sits 0.51 viewport-heights down at 375×812 and
  1.12 at 320×568. A second purchase control is a product decision, not polish.
- **`/lookbook/aw26` renders no photography.** Its chapters were seeded by `seed.ts` with no hero images,
  so its three stored hotspots cannot render. Refuted as a Phase 30 defect — the page handles the data
  correctly — and owed as a seed change: give the chapters images, or drop their hotspots as
  `scripts/seed/editorial.ts` already does for a chapter with no hero.
- **Phase 31's:** the degraded search page still offers Filter and Sort controls that can change
  nothing; and the catalogue's Suspense fallback does not match the real geometry (it reserves no
  pagination and renders 24 skeletons for a four-result search) — measured at zero CLS, so a
  loading-state fidelity item rather than a shift.

### 1.35.7 Sweep 2 — the shop-the-look markers had never opened

Five read-only finders again — a correctness review of sweep 1's own changes, the account pages and
overlays no audit had signed in to see, layout shift during interactions under throttling, touch
tablets, and keyboard focus — each followed by an adversarial verifier. The run was interrupted twice:
once by a usage limit, and once because the development database stopped accepting its password
(§1.35.8). The verifiers still running when the database went down were stopped rather than left to
report failures that were the outage's, not the code's.

**The highest-severity finding dates from Phase 22.** Every shop-the-look hotspot — on the homepage and
in every lookbook — did nothing when tapped, clicked or activated by keyboard. `Popover.Trigger asChild`
merges handlers child-first, and Radix composes its own toggle to run only
`if (!event.defaultPrevented)`. The marker's `onClick={(event) => event.preventDefault()}`, there to stop
the anchor navigating, therefore also stopped the popover: `aria-expanded` stayed `false`, no preview
was ever requested, and `shop_the_look_opened` never fired. Phase 22's notes record its browser pass as
never run; sweep 1 of this phase restored the markers' *rendering* and never activated one. The Root is
controlled now and the marker's handler toggles it; Radix's own toggle still skips, so there is exactly
one. DEV-72's anchor and its no-JavaScript fallback are unchanged.

**Add to bag opened nothing.** Structure document §13 draws *"Add to Bag → Cart drawer"*; the only
feedback was the header badge, about four seconds after the tap on a throttled connection. Both add
surfaces — the product page and a hotspot's single-variant add — now open the drawer on the server's
*yes*, never on the click, and register their own button as the trigger so closing the drawer returns
focus to it. Two component tests assert the bag opens on success and stays closed on a refusal.

**Layout shift during interactions**, which sweep 1's load-time pass could not see:

- **Removing a bag line collapsed the row seconds later** — 0.106 CLS on `/cart` and 0.089 in the
  drawer at 375, 0.209 for the last line — because the server's answer arrived outside the 500ms input
  window. A removal now hides its row while the form is pending (`useFormStatus`, marked inside each
  form that can remove, and `has-[[data-pending]]:hidden` on the row). If the server refuses, pending
  ends and the row returns with its notice; the server stays authoritative.
- **Choosing a size emptied the availability hint** when the server answered, moving Add to bag up
  22px. The region keeps one line.
- **The discount Apply button swapped its label for "Checking…"**, which is wider, narrowing the field
  just typed in and widening it again on the answer. It uses `Button`'s `loading` state, which keeps the
  label and its width; the component test now asserts `aria-busy` and `disabled` on the same button.

**Mistakes in sweep 1, found by the review of sweep 1:**

- Making the bag button 44px on phones pushed Search under the absolutely centred wordmark at 320–329px,
  so a tap on Search's left edge went home. The bag takes the menu button's mirrored `-mr-2` offset.
- The lazy Sentry change left `sentry-options` — and the redaction module behind it — statically
  imported, so it was still on every route. And the comment claiming Next substitutes an unset
  `NEXT_PUBLIC_` variable at build was wrong: an unset one is a runtime read of the empty `process.env`
  shim. The branch is not eliminated; it simply never runs, which is what keeps its chunks unrequested.
  Both modules load inside it now, the comments say what actually happens, and ESLint forbids a static
  import of the options module too.
- Touch-sized controls were keyed to **width** (`max-lg:`), so an iPad in landscape — at or above `lg`,
  with a coarse pointer — got 36px steppers beside a 44px drawer close. They use `pointer-coarse:` now.
  Search takes it only from 360px, because at 320–345px a 44px Search, a 44px bag and the wordmark do
  not fit.

**Account pages and overlays:**

- The address book's ten fields were 40px and 14px — the iOS-zoom class sweep 1 fixed in checkout and
  missed here — and Remove was 13px tall.
- On a phone the account nav loaded scrolled to its start, so on Addresses or Settings the current tab,
  the only "you are here" cue, was off-screen. The row now scrolls itself (never the window) to the
  current tab, and the tabs are 44px.
- Opening search focused Close, not the field, so a customer's first keystrokes went nowhere. The field
  is focused on open and is 44px tall; Chromium's clear control draws in the field's dark scheme instead
  of saturated blue, and stays — Escape closes the dialog rather than clearing the field.
- The wishlist grid borrowed the shop rail's sizes: 1.75x over-fetch at 768, 0.72x under-fetch at 1024.
  It has its own measured string.

**Keyboard focus rings the scrollers were clipping** — the product gallery's frames (no visible ring at
all below `lg`), its thumbnails, the zoom viewer's auto-focused Close, the homepage product rails, the
desktop filter rail and the drawers' scroll edges — each given room or an inset ring. And the product
details accordion's headings are `h2`, which axe-core's `heading-order` asked for on every product page.
These are the fixes whose adversarial verification the database outage interrupted; they were measured
by the finder, and re-measured below after the rebuild.

**Refuted:** the mobile menu's 18px sub-links. They sit 34–38px apart, pass WCAG 2.5.8 by spacing, and
follow the same pattern as the footer, which §1.35.4 already measured and accepted.

**Owed, as decisions for the owner rather than defects:**

- **At 768×1024 portrait the product page is the phone layout scaled up** — the photograph fills the
  first screen, and name, price and Add to bag are below it. Two-column from `md`, or a capped frame, are
  both reasonable; neither is specified.
- **Arrow keys on the desktop gallery thumbnails scroll the page to a frame** and push the focused
  thumbnail off-screen. Fixing it means either hiding the thumbnails at `lg`, where the stacked column
  already shows every photograph, or moving to manual activation as the variant selector does.
- **The in-black lookbook's "Wool" chapter is a 252px photograph shown ~1,086px wide** — the upscale
  TODO.md §5 says to avoid. It wants a larger export or a generated stand-in.
- `/checkout`'s payment-unavailable state offers a 17px text link as its only action — Phase 31's, with
  the other error states; `checkout/cancelled` already uses a button.

### 1.35.8 The development database moved, and was rebuilt rather than copied

Mid-sweep, the development branch `ep-green-boat-axabhusu` began rejecting its password — on its direct
and pooled hosts, with the same password that authenticates elsewhere — after production was moved to a
new Neon account. Its data could not be read, so it could not be copied.

Development now points at `ep-wandering-surf-ax7ia116` on the new account (`DATABASE_URL` on the direct
host, and `DATABASE_PUSH_TARGET` naming the same host, which is what D-10 checks). It arrived holding
the first ten products and all twelve committed migrations — schema current, content from before Phase
29. It was brought to the Phase 29 state by running the project's own scripts, which is the point of
their being idempotent:

| Step | Result |
|---|---|
| `pnpm seed` | 28 products, 213 variants, 12 categories, 4 collections, 5 edits, 6 articles, 2 lookbooks, 14 FAQs, 5 customers, 6 orders, 11 reviews — the old branch's counts |
| `pnpm generate:media` | 66 stand-in assets for what had none; nothing deleted |
| `pnpm import:media` | 17 photographs, 22 placements |
| `pnpm reindex` | 28 products into `north01_products_local` |

Cloudinary is shared with production, so both media scripts ran incrementally — never `--clean`, which
deletes the objects production also renders. The rebuilt branch then passed every harness (below).

### 1.35.9 What was verified, and how

Every sweep-2 fix was re-measured in a browser after the rebuild, against the rebuilt development
branch — not taken from the finder's word:

| Fix | Measured after |
|---|---|
| Shop-the-look marker opens | lookbook at 1024 touch, 1440 mouse and 1440 keyboard; homepage at 1440 and 375 touch — `aria-expanded` true, the preview dialog shows name, price and sizes, the URL does not change, Escape closes |
| Add to bag opens the bag | drawer titled *Bag* with the new line; closing returns focus to *Add to bag* |
| Removing a line | 2 lines → 1, **CLS 0.0000** (was 0.106) |
| Discount Apply while pending | 95px → 95px, CLS 0.0000 |
| Choosing a size | CLS 0.0000 at 1440 and 375 |
| Search on open | focus in `#site-search`; "shirt" typed straight after opening lands in it; field 44px |
| Header at 320 touch | Search 36px, and a tap on its left edge hits Search, not the wordmark; no overflow |
| Touch sizing | 44px Search and bag at 375 and 1024 touch; 36px with a mouse at 1440; bag steppers 44px at 1024 touch |
| Gallery frame focus | ring drawn inset (`outline-offset: -4px`) and visible |
| Zoom viewer | the auto-focused Close sits 5px inside the dialog on both clipped sides |
| Product details | accordion headings are `h2` |
| Account, signed in as a seeded customer | Addresses and Settings tabs visible at 320 and 375; tabs 44px; address fields 44px at 16px |
| First-load JavaScript | `/` 256,295 B gzip; no Zod, no Sentry, no redaction module in any first-load chunk |

Not re-measured after the rebuild, and said so: the focus rings on the thumbnail row, the product
rails, the desktop filter rail and the drawer scroll edges. They were measured by sweep 2's finder and
their verifier was one of those the database outage interrupted.

| Gate | State |
|---|---|
| `pnpm typecheck`, `pnpm lint --max-warnings 0`, `pnpm format:check` | pass |
| `pnpm build` | pass, against the rebuilt branch |
| `pnpm test:run` | **815** (two new: the bag opens on a successful add and stays shut on a refusal) |
| Twenty-two `verify:*` harnesses | **1,829 checks, all passing**, on the rebuilt branch |
| `pnpm scan:secrets` | clean |
| Eight-width audit, 13 routes | no overflow, no over- or under-fetch, no console errors; only the 134 sub-24px inline links §1.35.4 accepted |

### 1.35.10 What is now owed

**Decisions for the owner** — each measured, none a defect against a written requirement:

- A sticky add-to-bag bar on the phone product page (§1.35.6): unspecified.
- The portrait-tablet product page, where the photograph is the whole first screen (§1.35.7).
- Arrow keys on the desktop gallery thumbnails scrolling the page away from them (§1.35.7).
- The 252px photograph shown ~1,086px wide in the in-black lookbook (§1.35.7), and `/lookbook/aw26`,
  whose chapters have no images at all (§1.35.6).
- **Production's database endpoint** — TODO.md §1 still names the old account's. And `neondb_owner`'s
  password, which has now appeared in a chat transcript four times.

**Phase 31's**, recorded rather than built: the degraded search page's Filter and Sort; the catalogue
fallback's geometry; the checkout-unavailable state's text-link action; and the error surface the
`/collections` and `/edit` indexes now reach instead of claiming nothing is published.

**Not run in this phase:** WebKit (so the 16px-input fix is verified by computed style, not on iOS
Safari); a throttled interaction pass over the account pages; and the **57 Playwright end-to-end
tests**, still owed since Phase 27.

**Carried from earlier phases:** `/help/contact` (G-08), `/legal/privacy` and `/legal/terms` (G-19),
and `campaigns.collection` / `campaigns.products`, still read by nothing.

**Production still serves Phase 29.** Nothing in this phase is live until it is pushed and deployed —
including the performance work, and the Sentry, analytics and Turnstile keys added to Vercel on
2026-09-10, which reach a build only when one is made.

## 1.36 Phase 31 — error, empty and loading states

Plan §31.1a–§31.1f. **One migration** (`cart_items.price_seen_minor`, nullable, display only) and no
dependency. The phase began with a live privacy leak, which is recorded first because it shipped in
this project's own previous phase.

### 1.36.1 Before the phase: Phase 30's deploy sent password-reset tokens to Google Analytics

Phase 30 was pushed the evening before this phase began. The GA4 measurement ID had been added to
Vercel the same day, so that deploy was the first build to load `gtag` — and `gtag('config')` sends
`page_location = window.location.href`. The reset email links to `/reset-password?token=…`, a one-hour
credential in the query, so **every reset link a customer opened sent its token to Google**. PostHog's
`$current_url` would have done the same the day its key is built. The redaction Phase 25 wrote
(`lib/observability/redact.ts`) covered Sentry and nothing else. The other session's audit
(`docs/PHASE_35_36_AUDIT.md`, R1-16) had named it as a pre-deploy blocker; the deploy happened first.

Fixed and pushed as a hotfix (`95c040b`) before any Phase 31 work, and confirmed live on production:

- `/reset-password` is not reported at all — neither SDK loads for a session that starts there, and
  no page view is sent for it later.
- Every other URL goes through `redactUrl` before either vendor sees it: GA page views and
  `gtag('set', { page_location })`, and PostHog's `before_send` on `$current_url`, `$referrer` and
  their `$initial_` copies. `session_id` joined `SENSITIVE_PARAM`, so a Stripe session id is not
  reported either.
- **One source of GA page views.** The old code sent one from `config` and one per navigation while
  GA4's enhanced measurement sent another on every history change: every navigation counted twice.
  `config` now runs with `send_page_view: false` and the component sends every page view. The GA4
  "page changes based on browser history events" toggle has to be switched off in the dashboard —
  TODO.md §6.
- Both SDKs load when the page is idle, and `redact.ts` loads with them, so a keyless build ships none
  of it.
- `begin_checkout` no longer fires on the payment-unavailable checkout.

**Verified against a build with test keys and every vendor request intercepted:** a reset link
produced no GA script, no page view and no PostHog event; `/shop?token=…&email=…` produced one page
view with both values redacted; the token and the email appeared in no `dataLayer` entry and no
intercepted request.

### 1.36.2 The storefront survives a database outage now

Measured by pointing a second server at the development database with a wrong password. **Before:
every route answered a bare 500 with no header, navigation or footer — including `/help/faq`.** The
root layout and the header read the signed-in customer and the bag for its badge; those reads threw,
and an error in the root layout is one no boundary inside it can catch. `getShell` and
`getSeoDefaults` already fell back; these did not.

- `getShellSession()` (`lib/navigation/shell-session.ts`) wraps the two reads: a failure means a
  signed-out shell with no badge, and the cart drawer says `CART_COPY.failed` (*"We could not load
  your bag just now"*) rather than claiming the bag is empty.
- `(frontend)/error.tsx` is new: the branded error **inside** the shell, with `retry()` (Next 16's
  re-fetch, not `reset()`), a different sentence when `navigator.onLine` is false, the error's digest
  as a reference, a DSN-guarded Sentry capture, and `noindex`.

**After:** `/` and `/shop` render normally; `/help/faq`, `/journal`, `/product/field-jacket` and `/cart`
return **500** and render *"This page could not be shown."* with header, footer and *Try again*; the
order page renders its own sentence (§1.36.4). The raw HTML of an erroring page is Next's error shell,
replaced on hydration by the boundary — which is how Next delivers a server error to a client boundary,
and why the check was made in a browser rather than with `curl`.

**A malformed URL is a 404, not a 500.** `/product/%E0%A4%A` — an incomplete UTF-8 sequence — made Next
throw decoding the dynamic segment and answered with a 21-byte *Internal Server Error*. The proxy now
matches the dynamic-segment routes and rewrites an undecodable path to a path no route claims, which
renders the branded not-found with a 404. `tests/unit/proxy.test.ts` pins which paths it touches.

### 1.36.3 Security checks that explain themselves, and one that waits to be used

The Turnstile keys were in Vercel for the same deploy, so two more of the audit's pre-deploy items
became live: a blocked widget left every guarded form — **sign-in included** — answering *"Please try
again"*, which could never work (R1-22); and the footer newsletter, on every page, ran a Cloudflare
challenge on every page view (R3-07).

- **Explicit rendering** (`api.js?render=explicit`, `turnstile.render()` on `onReady`). Implicit
  rendering scans the page once, so a widget mounted later — after a client navigation, or on demand —
  was never rendered.
- **It says so when it cannot load:** the script's `onError`, the widget's `error-callback` and an
  eight-second check for `window.turnstile` all put *"The security check couldn't load… Allow
  challenges.cloudflare.com, or try another connection"* in the reserved box, as an alert.
- **The newsletter activates it on the form's first focus.** Sign-in, registration and reviews stay
  eager — their forms are the page.

Verified with Cloudflare's always-pass test keys: `/login` writes a token and sign-in succeeds through
the server check; with `challenges.cloudflare.com` blocked the explanation appears; the footer makes
**no** Cloudflare request until the email field is focused, then renders and writes a token.

### 1.36.4 Plan §31.1f — checkout states

- **The success page says what happened.** It had one branch — paid, or *"Confirming your payment…
  we will email you either way"* — which a declined, abandoned or never-sent order also received.
  `confirmationCopy(status)` (`lib/checkout/confirmation-copy.ts`) gives each payment status its own
  heading, sentence and summary label; only `pending_payment` promises an email; a failed or
  incomplete order offers the bag back. `tests/unit/checkout-confirmation.test.ts` asserts every
  status.
- **An unreadable order is not a missing one.** `readOrderForConfirmation` caught every error as
  "not found", so during an outage a customer who had just paid read *"We could not find that order…
  it may belong to a different account"*. Only Payload's 404 means not found now; anything else gets
  *"We can't show your order right now. If you paid, your payment is safe and your confirmation email
  is on its way."* Verified on the outage server.
- **Session expired mid-checkout** said *"Your bag is empty"* to someone whose bag was intact. Two
  changes, because the first alone could not work:
  - `hasSignedOutBag()` recognises a bag on this device that belongs to a signed-out customer; the
    bag page then says *"Your session has ended. Sign in to see your bag — everything in it is
    saved"*, checkout redirects to `/login?next=/checkout&expired=1`, and the sign-in page says why.
  - **The bag cookie is no longer cleared at sign-in** — it now names the customer's bag. It was
    cleared at every sign-in, which left an expired session nothing to recognise the bag by. It
    exposes nothing: `resolveCart` refuses an owned bag to an anonymous request whatever the cookie
    says (Phase 14's second sweep). An explicit sign-out still forgets it; an expiry does not. This
    is a deliberate change to Phase 14's merge, recorded here.

  Verified end to end: a guest bag carried through sign-in; with the session cookie removed, `/cart`
  said the session had ended, `/checkout` went to sign-in with the notice, and signing in returned to
  `/checkout` with the bag intact.
- The payment-unavailable checkout's only action is a button, not a 17px link.

Invalid address, shipping unavailable, payment declined, payment pending and the webhook-not-yet-landed
states already existed (Phases 16–18) and are unchanged.

### 1.36.5 Plan §31.1e — "price changed", the one cart state that did not exist

Cart lines stored no price — a recorded decision, and still true of anything charged. The customer was
charged the live price, which is right, but nothing ever said a price had moved since they added it.

`cart_items.price_seen_minor` records the unit price the customer was looking at when they last added
or changed the line. **Never charged, never trusted** — the collection description still holds. When it
differs from today's price, the line says *"Was £X when you added it"* and the bag, the drawer and the
checkout page say *"A price in your bag has changed since you added it. You pay the price shown."*
Changing the quantity is looking at today's price, so it becomes the seen one. Lines from before the
migration, and lines a sign-in merge carried over, have no seen price and show no notice — the shop
cannot vouch for them. `priceMovedFrom` is pure and unit-tested; the notice was verified by giving a
test bag a different seen price.

The migration was generated (`pnpm migrate:create`), not written, and trimmed to `{ db }` as
`docs/DATABASE.md` §4 requires; the development branch received it by push. **Production receives it
on the next deploy**, through `pnpm build:deploy` (`payload migrate && next build`); it adds one
nullable column.

Empty, stale item, out-of-stock item and expired promotion were already handled (Phases 14–15).

### 1.36.6 Plan §31.1c — "search service unavailable" read as an empty shop

- The polite live region above the unavailable panel announced **"No products"** first, so a screen
  reader heard an outage as an empty catalogue. The toolbar says nothing when the engine failed.
- *"Search is briefly unavailable"* is false when search is not configured at all — production's state
  until TODO.md's Algolia item is done. The sentences are now true for both an outage and a service
  that is off.
- With search unconfigured, `/search` no longer shows the Filter drawer and sort select, which could
  only rewrite the URL of a search that cannot run. A configured index that is merely down keeps them:
  clearing a facet is a real escape there.

Empty filter and no products were already distinct states (Phases 11–12).

### 1.36.7 What was already right, and the decisions this phase records

- **§31.1b product states** — unpublished, deleted and scheduled products 404 through
  `publishedProductWhere` (Phase 13), sold-out and unavailable variants are disabled and explained
  (Phase 13), missing media renders `MediaImage`'s placeholder (Phase 8). `verify:product` asserts them.
- **§31.1d account states** — signed out redirects to sign-in with `next` (the proxy), and no orders,
  an empty wishlist and no addresses each have their own copy.
- **Unauthorized** is the sign-in redirect. **Forbidden** is deliberately rendered as *not found*: a
  customer asking for another customer's order is told it does not exist, so an order number cannot
  be used to learn that one exists. Next's experimental `forbidden()`/`unauthorized()` are not used.
- **Loading.** No route-level `loading.tsx`, deliberately: a route that can 404 must decide that before
  the first byte, and a `loading.tsx` streams a 200 first. The catalogue's own `Suspense` fallback
  is the loading state that matters, and its card skeleton now uses the real card's line boxes (it
  was 6–7px short per card, about 80px over a page of 24).
- **Maintenance.** No maintenance mode: the error boundary inside the shell, and `global-error.tsx`
  for the layout itself, are the fallback §31.1a lists. A planned maintenance window would be a Vercel
  deployment decision, not application code.
- **A streamed error on `/shop` still answers 200** (audit R3-25): the results stream inside a
  `Suspense` boundary after the first byte. The error boundary marks it `noindex`; changing the status
  would mean resolving the catalogue before the first byte, which is the streaming Phase 12 chose.

### 1.36.8 The build caught one of this phase's own fixes, and what was verified

**`getShellSession` swallowed Next's interrupts.** Its `try/catch` caught everything — including the
dynamic-usage signal `cookies()` and `headers()` throw while a route is prerendered. The build then
treated `/help/faq` and `/collections` as static and would have baked a signed-out shell with an empty
bag into both, for every visitor. The build log said so (*"Route /help/faq couldn't be rendered
statically because it used `headers`"*, printed from inside the new catch). Both catches now call
`unstable_rethrow(error)` first — Next's documented way to let `notFound`, `redirect` and dynamic-usage
through a `try/catch` — and the rebuilt route table shows `/help/faq`, `/collections`, `/journal`,
`/lookbook`, `/edit` and `/shop` dynamic again. A guest with a bag sees *"Bag, 1 item"* on each; the
outage server still renders the shell and the branded error.

| Gate | State |
|---|---|
| `pnpm typecheck`, `pnpm lint --max-warnings 0`, `pnpm format:check` | pass |
| `pnpm build` | pass; per-visitor routes dynamic |
| `pnpm test:run` | **829** (fourteen new: confirmation copy per status, the malformed-path rule, the price-changed rule) |
| Twenty-two `verify:*` harnesses | **all pass** |
| Analytics redaction | no token or email in any `dataLayer` entry or intercepted vendor request |
| Turnstile, with Cloudflare's test keys | token written; sign-in through the server check; explanation when blocked; newsletter silent until focused |
| Database outage, second server with a wrong password | shell and branded error with 500 where a page needs the database; `/` and `/shop` render; the order page's own sentence |
| Malformed URL | 404, branded, in the shell |
| Session expiry, end to end | bag intact after signing back in; checkout resumed |
| Price changed | line and bag notices |
| Dynamic 404s (`/product/…`, `/journal/…`, `/shop/…`) | 404, branded, `noindex`, in the shell |

### 1.36.9 Sweep 1

Done in the main session, against the committed phase: a re-read of the diff for the ways each fix
could fail, the route walk above repeated with the database up, and the eight-width audit.

- **A Turnstile script that arrives after the eight-second check stayed "failed".** The check is a
  guess about a slow connection; a script that loads at nine seconds now clears the explanation and
  renders the widget (`onReady` resets `failed`).
- **The E2E suite asserted "exactly three renderings" of the success page.** Phase 31 made it one per
  payment status. `readHonestConfirmation` now takes the headings and summary labels from
  `confirmationCopy` itself, so the test and the page cannot drift apart — and a heading that is none
  of them still fails.
- **Route walk, database up:** every dynamic route's missing slug is a 404 with the branded page,
  `noindex` and the shell (`/product/…`, `/journal/…`, `/lookbook/…`, `/collections/…`, `/edit/…`,
  `/shop/<unknown category>`); `/search` with no query is its idle state and `?q=` redirects to it;
  `/checkout/cancelled` says nothing was charged; an empty-bag `/checkout` goes to the bag; an
  account route signed out goes to sign-in with `next`.
- **An invalid reset link is answered on submit, not on arrival** — *"This link is no longer valid — it
  may have expired, or it may already have been used. Ask for a new one."* (Phase 7). Checking the token
  before the form would mean looking up a credential on every page view of `/reset-password`; the one
  wasted field is the better trade, and it is recorded rather than changed.
- **The eight-width audit** (13 routes × 8 widths) reports only the 134 inline links §1.35.4 accepted.
- **A shared device with an expired session** now shows the next visitor *"Your session has ended.
  Sign in to see your bag"* for the previous customer's bag. It reveals that a bag exists, never what is
  in it, and signing in as someone else clears the pointer (`mergeGuestCart` forgets a bag owned by
  anyone else). An explicit sign-out has always been the way to leave a shared computer, and it still
  forgets the bag.

### 1.36.10 Sweep 2

A different angle from sweep 1: the new states themselves, at phone width and under axe-core, and the
architecture document.

- **Every new state at 320, 375 and 1440:** the session-ended bag (after a real guest-bag, sign-in,
  session-cookie-removed journey), the price-changed bag and its line note — no horizontal overflow at
  any width.
- **axe-core** (WCAG 2 A/AA, 2.1 AA, 2.2 AA) on the session-ended bag, the sign-in page with its
  *"Your session has ended"* notice, the missing-order success page, the degraded search and the
  price-changed bag: **no violations**.
- **`docs/ARCHITECTURE.md` still said the storefront does not survive a database outage** (D-32's
  closing paragraph, and the fallback's "six" primary destinations). D-32 is amended, and two decisions
  are added: **D-41** (a page fails inside the shell; the shell's per-visitor reads degrade; every
  render-path `catch` calls `unstable_rethrow` first; an undecodable URL is a 404) and **D-42** (the bag
  cookie survives sign-in, and why that exposes nothing).

## 1.37 Phase 32 — deployment to Vercel

Plan §32.1a–§32.1d. No dependency and no migration. The Vercel project, its production deployment
and its build command existed since Phase 2; this phase is the procedure around them, the parts of
the configuration that live in the repository, and a precise list of the parts that do not.

### 1.37.1 What the phase could change, and what it could only document

Phase 32's prompt asks for separate Preview and Production environments, safe migrations, a deployment
checklist and a post-deployment smoke test. Four of those are dashboard settings — Vercel variables,
Vercel project settings, Neon branches, GitHub secrets — which this application cannot set, and which
this phase deliberately did not set from the CLI on the owner's behalf: changing production's
environment is an owner decision with the owner's credentials. Each is in
[`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) §9 with its reason, and in TODO.md §8.

What the repository could carry, it now does:

- **`docs/DEPLOYMENT.md`** (plan §38's missing deployment document, audit DOC-10): the project settings,
  the three environments side by side, how to set up Preview, **the six-step migration procedure**
  (§32.1d: backup as a Neon branch, migrate by the build with expand/contract, deploy, verify with
  `migrate:status`, smoke-test, monitor), rollback, the shared Cloudinary hazard, the production search
  index, the scheduled drain, CI, and the owner's list.
- **`pnpm smoke <url>`** (`scripts/smoke.mjs`) — the post-deployment smoke test §32 asks for: the
  homepage and its canonical host, the shop, a product and its JSON-LD, search, the bag, checkout's
  empty-bag redirect, the admin, the Stripe webhook's refusal of an unsigned POST, `robots.txt`, the
  sitemap's host, a 404, and that `/reset-password` loads no analytics script (the Phase 31 hotfix, now a
  permanent check). Read-only, no dependencies, safe against production.
- **Node 22.x** in `package.json` `engines`. The range was `>=20.9.0`, and Vercel ran **24.x** — a major
  no gate had exercised, which would also have floated to the next major by itself (audit R3-22). `.nvmrc`,
  CI and `STACK_VERSIONS.md` all say 22.
- **A preview names itself.** Without its own `SITE_URL`, a preview fell through to
  `VERCEL_PROJECT_PRODUCTION_URL`, so a reset email sent from a preview linked to production and
  Stripe's return URLs sent a preview checkout to the live shop. On a preview `siteUrl` now resolves to
  `VERCEL_BRANCH_URL`, then `VERCEL_URL` — both set by the platform at deploy time, so the Phase 7 rule
  that a URL is never built from a request header still holds.
- **DEV-67's scheduled drain.** `vercel.json` schedules a daily `GET /api/email/drain`; the route
  answers only `Authorization: Bearer <CRON_SECRET>`, compared in constant time, and 401 otherwise —
  including when no secret is set, so an unset variable can never mean open. Daily, because it is the
  one schedule every Vercel plan accepts; a more frequent expression fails a Hobby deployment.
- CI's build-skip notice pointed at a closed TODO section; it points at DEPLOYMENT.md §8. README lists
  DEPLOYMENT.md and SEARCH.md.

### 1.37.2 The smoke test's first run against production

**9 passed, 3 warnings, 0 failed.** The three warnings are two findings the other session's audit had
made, now measured by a check anyone can rerun:

- **The canonical and the sitemap name `north01apparel-mi-ca-growth.vercel.app`** — production's
  `SITE_URL` is the team alias, not the public host (R3-09). Every canonical, all 40 sitemap URLs, reset
  links and Stripe return URLs name a host customers do not use.
- **Search is not available** — production has no Algolia keys, and the `north01_products` index has
  never been built (R3-01). DEPLOYMENT.md §6 is the procedure; keys alone will not fix it.

Everything else passed, including the webhook refusing an unsigned request (503, Stripe unconfigured)
and no analytics script on `/reset-password`.

### 1.37.3 Two platform facts recorded rather than changed

- **A malformed percent-encoding is answered 400 by Vercel's edge**, before the application. The Phase 31
  proxy rule matters under `next start` and in development, where it produces the branded 404.
- **`NEXT_PUBLIC_` variables are fixed at build.** The Phase 30 deploy switched on six integrations at once
  because their keys had been added in the dashboard without a build (§1.36.1). DEPLOYMENT.md §10 says
  so, and the Preview environment is what would have rehearsed it.

### 1.37.4 What was verified

| Check | Result |
|---|---|
| `pnpm typecheck`, `pnpm lint --max-warnings 0`, `pnpm format:check`, `pnpm build` | pass |
| `pnpm test:run` | 829 |
| `pnpm smoke`, production and local | 0 failed; the three production warnings are §1.37.2's |
| The scheduled drain, with a test `CRON_SECRET` | no header **401**; wrong secret **401**; right secret passes authorisation (then **503**, Resend unconfigured, queue untouched); the staff `POST` still **403** without a staff session |


### 1.37.5 Sweeps

**Sweep 1 — the pieces checked against something real.** A server started as a Vercel preview
(`VERCEL_ENV=preview` and a branch alias) gives `/shop` a canonical on the preview's own host. `robots.txt`
and the sitemap are prerendered, so they carry whichever host the *build* saw; on Vercel a preview builds
with its own variables, so they will name the preview too — recorded, not changed. `STACK_VERSIONS.md`
records the 22.x pin; `DATABASE.md` §6 points at `DEPLOYMENT.md` §4. `verify:email`, `verify:security`,
`verify:seo` and `verify:shell` — the harnesses the changes touch — all pass.

**Sweep 2 — the deployment itself.** The Phase 32 push built on Vercel and the log confirms each
change: *"Skipping build cache since Node.js version changed from 24.x to 22.x"*, `payload migrate`
before `next build` as the procedure says, and a Ready deployment. `pnpm smoke` against production
afterwards: **9 passed, 3 warnings, 0 failed** — the same three, both owner settings. Vercel now notes
that the project setting (24.x) is overridden by `engines`; setting it to 22.x in the dashboard
silences that and changes nothing.

## 1.38 Phase 33 — Cloudflare, domain and DNS

Plan §33.1a–§33.1c. No dependency, no migration. There is no custom domain yet, and §33.1a says the
Vercel host is sufficient during development — so most of this phase is the procedure for the day one
is bought. One part of it was not future work at all: the host question was already breaking
signed-in customers in production.

### 1.38.1 Signed-in actions ran as a guest on production's public host

Audit R1-14, confirmed and fixed. Payload accepts the session cookie on a request carrying an `Origin`
only if that origin is in its `csrf` allowlist, and by default the list is `serverURL` alone —
`SITE_URL`. A Server Action always sends `Origin`. Production's `SITE_URL` is the team alias
(`north01apparel-mi-ca-growth.vercel.app`) while customers use `north01apparel.vercel.app`, so on the
public host **every signed-in action ran as a guest**: the account pages rendered (a plain GET sends no
`Origin`), and saving an address answered *"Sign in to save an address."* And the UI sign-out, whose
`payload.auth` also returned nobody, cleared the cookie without revoking the session — the old token
kept working.

Notes §1.12.10 had deferred `csrf` to "Phase 26, with Phase 33's domain settled"; Phase 26 did not do
it, and the domain was never the variable — the deployment's own hosts were.

- `csrf` is now every origin this deployment answers on (`lib/trusted-origins.ts`, pure and
  unit-tested): `SITE_URL`, Vercel's production host, this deployment's own host, a preview's branch
  alias — all set by the platform at deploy time, never taken from a request — and, off Vercel, the
  machine on the port it serves. A foreign origin is still refused.
- A sign-out that clears a cookie which did not authenticate now logs a warning, so a session left
  unrevoked is visible rather than silent.

**Verified with the audit's own reproduction**, on port 3211 while `SITE_URL` resolves to
`http://localhost:3000`: signed in, saving an address answered *"Address saved."* (the test address was
removed again), and after the UI sign-out the old token returned `user: null` from `/api/customers/me`.
Pushed immediately rather than at the end of the phase, because the defect was live.

This does not replace setting production's `SITE_URL` correctly (DEPLOYMENT.md §9) — canonicals, the
sitemap and reset links still name the team alias until the owner changes it. It means signed-in
customers are no longer broken while they wait.

### 1.38.2 The domain procedure — `docs/DEPLOYMENT.md` §11

§33's prompt: *"Document the exact DNS records that will be required once a domain is purchased…
Do not change DNS records blindly; inspect current records first and preserve unrelated services."*

- **Inspected first.** `vercel domains ls`: the team holds one unrelated domain,
  `dippedncolorsplatstudio.com`, which nothing here touches. The shop has no custom domain. HTTPS on the
  Vercel host is Vercel's, with `Strict-Transport-Security: max-age=63072000; includeSubDomains;
  preload` on every response.
- **Pointing a domain at Vercel** — both apex and `www` added to the project with one redirecting to the
  other (the §33.1b canonical-host redirect, served at Vercel's edge, so no application code), and the
  Cloudflare records Vercel shows, typically `A @ 76.76.21.21` and `CNAME www cname.vercel-dns.com`,
  **DNS only**. The Domains page is named as the source of truth, because Vercel can issue
  project-specific values; proxied through Cloudflare, SSL must be Full (strict), never Flexible.
- **Everything that names the host** — `SITE_URL` (which now also carries the CSRF allowlist with it),
  Turnstile's widget hostnames (a widget refuses an unlisted host, which would stop sign-in), the Stripe
  webhook endpoint and its new signing secret, Search Console and the sitemap.
- **Email** — a Resend sending subdomain, so the apex's own mail records are never touched; DKIM, MX,
  SPF and DMARC by shape, with the values deliberately **not** reproduced because Resend's are
  region-specific. §33.1c's rule is stated as written: not production-ready until Resend says Verified
  and one message has reached a real inbox.
- **Verification** — `curl -I` for the 200, the `www` 308 and the HTTP→HTTPS redirect; `pnpm smoke` with
  no canonical or sitemap warning; a signed-in action on the new host; a reset email whose link names it.

### 1.38.3 What was verified

| Check | Result |
|---|---|
| `pnpm typecheck`, `pnpm lint --max-warnings 0`, `pnpm format:check`, `pnpm build` | pass |
| `pnpm test:run` | **836** (seven new: the trusted-origins list) |
| R1-14, reproduced and fixed on a non-canonical origin | *"Address saved."*; old token `user: null` after sign-out |
| Production before the fix | HTTPS and HSTS present; the public host's signed-in actions affected |

### 1.38.4 Sweep 1

- **The admin panel on a non-canonical origin.** It authenticates through the same allowlist, so it was
  exposed to the same defect. Signed in at `localhost:3211` (while `SITE_URL` is `:3000`): the dashboard
  loads, `fetch('/api/users/me')` from the page — which sends `Origin` — returns the staff user, and the
  products list renders.
- **Production after the push:** `pnpm smoke` 9 passed, 3 warnings, 0 failed — the same two owner
  settings.
- TODO.md §8 now points at the domain procedure for the day a domain is bought.

### 1.38.5 Sweep 2 — the allowlist still refuses what it should

Widening an allowlist is the change most likely to weaken what it guards, so the sweep checked the
refusal rather than the acceptance. A real customer session cookie, sent to `/api/customers/me` with
different `Origin` headers:

| `Origin` | Result |
|---|---|
| `http://localhost:3211` — this deployment | the customer |
| `https://evil.example` — foreign | `user: null` |
| `http://localhost:9999` — the machine, but not the port it serves | `user: null` |
| none, from a non-browser client with no `Sec-Fetch-Site` | `user: null` — Payload's fallback, unchanged by this phase; a browser's own navigations send `Sec-Fetch-Site` and render signed in |

CSRF protection is intact: the list grew by the deployment's own hosts and nothing else.

## 1.39 Phase 34 — security, privacy and data minimisation

Plan §34.1a–§34.1d and its prompt: *"Trace customer data from browser input through Next.js,
Payload/Postgres, Stripe, Resend, analytics, and logs… Fix all issues found and document the data flow
and retention assumptions."* The trace is `docs/SECURITY.md`; this is what it found and what changed.
No dependency, no migration (`migrate:create --skip-empty` produced nothing).

### 1.39.1 Every reset link was being written to the production logs

`serviceEmailAdapter` logged the whole unsent email — body and recipient — in every environment, and
production has no Resend key yet, so every password-reset request put a live one-hour reset token and
the customer's address into Vercel's logs. The body is now logged on a local machine only; deployed,
the line carries the subject and a masked recipient (`maskEmail`, `j***@example.com`), and so do the
failure logs. The reset email's idempotency key — stored forever and sent to Resend — was the raw
address; it is now a digest.

### 1.39.2 Doors beside the guarded ones (audit R1-15, R1-18, and the trace)

Each of these is the same shape as Phase 26's `POST /api/customers`: the form was guarded, the REST
route next to it was not.

- **Customer login, forgot-password and reset-password over REST** now refuse anything but the Local
  API (`Customers.ts` `beforeOperation`). The audit had reset a password to `abc` through REST.
  Measured: all three 403; storefront sign-in unaffected.
- **Forgot-password** gained Turnstile (the fifth public form) and a five-minute cooldown per address
  (`lib/auth/reset-cooldown.ts`, computed from the stored expiry since the issue time is not stored).
  The answer is the same sentence either way. Measured: two requests, one email.
- **Payload's own collections** — `payload-locked-documents`, `payload-preferences` — were open to any
  signed-in *customer*, because Payload gives them `Boolean(user)` and this project has two auth
  collections. Narrowed to staff in `onInit` (they are created after every plugin runs). Measured:
  customer 403, staff 200.
- **A customer could `PATCH` their own password or email** with no current password — so a stolen
  cookie became a permanent takeover — and **an editor could set any customer's**. Both now need an
  admin (email compared against the stored value, since the admin form resends it on every save).
  Measured: customer 403 on both, phone 200, admin 200.
- **Order ownership** — `customer`, `email`, `cart` — is server-written only (`nobodyField`); the address
  snapshots are admin-only. Re-pointing `customer` handed an order to another account; changing
  `email` redirected its dispatch emails. Measured: an admin PATCH of the email leaves it unchanged.
- **`POST /api/reviews`** skipped the review form's Turnstile. The rule is now the one `customers`
  uses: an active customer **and** the action's verified flag, which REST cannot supply.
- **Public reviews carried the author's account id**, so `where[customer]` profiled one person. The
  field is readable by staff and the author only; the published name is `displayName`. Measured: 0 of
  5 public reviews carry it; the query by customer is 400.
- **Guest bag tokens** — bearer credentials — are admin-only in the panel.

### 1.39.3 The review form could never have worked

Found by the trace. The Server Action created the review with `overrideAccess: true`, no `user` and no
`customer` in the data; `enforceCustomerOwnership` only fills `customer` from `req.user`, so the
required field was empty, validation failed, and `isDuplicateReview` read the `customer` path as a
duplicate — every first review was told *"You've already reviewed this."* `verify:reviews` passed
because it passes `customer` itself. The action now names `customer` explicitly. It stays
`overrideAccess: true` — `verifiedPurchase` is computed there and field access closes it to every
access-controlled write (the first version of this fix dropped the badge that way; caught in sweep 1).
`verify:access` asserts that an access-controlled create without the verified flag is refused.

### 1.39.4 Minimisation

- **Expired bags are deleted** (R1-27): a second daily cron, `/api/carts/sweep`, 200 per run, `active`
  only. Both cron routes now share `lib/security/cron-auth.ts`.
- **Length bounds** (R1-24): every address line has a `maxLength` from one table
  (`lib/address-limits.ts`) used by the schema, checkout preflight (so an overlong line is the address
  message, not a failed write) and both forms. Discount codes over 32 characters are refused before a
  lookup.
- **Analytics and Sentry**: `order` joined the redacted URL parameters (the serial id on checkout's
  return URLs reached GA4 and PostHog — D-17); a search that looks like an email or a long number is
  sent as `[redacted]`; Sentry's key redaction now covers address, line, postcode, phone and name keys.

### 1.39.5 Headers (R3-10)

`nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, a
`Permissions-Policy`, no `X-Powered-By`, and a CSP in **Report-Only** — enforcing a guessed policy
could break Stripe, Turnstile or the admin. `docs/SECURITY.md` §6 is the step to enforce it.

### 1.39.6 Not done, and why

- **Retention periods** for unpaid orders and the email outbox, erasure of orders, a newsletter
  unsubscribe, and editors' read access to the subscriber list — legal and business decisions, listed
  in `docs/SECURITY.md` §4 and TODO.md §10 rather than guessed.
- **Privacy policy and terms** (G-19, DOC-08) — legal text; TODO.md §9. The footer row stays empty.
- **Error objects are logged whole**; a Postgres or Stripe error can quote an email. Recorded as a
  residual in `docs/SECURITY.md` §5 rather than replacing Payload's logger configuration late.
- The Stripe line-item description and return URLs still carry the internal order id; analytics no
  longer receives it, and the confirmation page checks ownership.

### 1.39.7 What was verified

| Check | Result |
|---|---|
| `pnpm typecheck`, `lint --max-warnings 0`, `format:check`, `build` | pass |
| `pnpm test:run` | **845** (nine new: cooldown, address bounds, email mask) |
| All 22 `verify:*` harnesses, `scan:secrets` | pass; `verify:access` 50/50 with the new review check |
| REST, on a production build | login/forgot/reset 403; locks and preferences 403 customer / 200 staff; customer password/email PATCH 403; public reviews carry no account id; `POST /api/reviews` 403; sweep without the secret 401 |
| Browser | sign-in works; a 250-character address line refused; two reset requests, one email, masked in the log |
| Headers on `/` | all five present, no `X-Powered-By` |

### 1.39.8 Sweep 1

An independent review of the phase commit, plus my own re-read of the review fix.

- **My review fix would have removed the verified-purchase badge.** Switching the action to
  `overrideAccess: false` made field access strip `verifiedPurchase`, which the action computes. Back
  to `overrideAccess: true` with `customer` named explicitly — the actual bug.
- **The Carts admin list broke for editors.** `token` became admin-only while it was still the
  collection's `useAsTitle`, and Payload refuses a search on a field the user cannot read (*"cannot be
  queried"*). The title is now the id.
- **The CSP would never have run clean**, so the recorded step to enforce it could not have been
  taken: `connect-src` lacked Stripe's and Cloudinary's APIs and `frame-src` lacked `'self'`. Added.

Checked and clean: `updateByID` reaches `beforeOperation` as `update`; Payload's own login and lockout
writes bypass the hooks; an editor saving an unchanged customer passes the email comparison; no code
writes orders with `overrideAccess: false`; the internal-collection access holds on every
`getPayload` init.

### 1.39.9 Sweep 2 — the review form, used; and what the CSP actually reports

- **The review form, end to end.** Signed in as a demo customer, a real review submitted through the
  product page was stored — `pending`, `verifiedPurchase: false` for an account with no paid order,
  owned by that customer — and the page moved to its "already reviewed" state. Removed afterwards.
  Before Phase 34 this submission could not have been saved.
- **The report-only CSP, measured.** Nine storefront page types (home, shop, product, bag, sign-in,
  register, forgot-password, journal, search) reported **nothing**. The admin reported one source on
  every page: `www.gravatar.com`. Payload's default avatar is Gravatar, which sends a hash of each staff
  member's email address to a third party on every admin page load. `admin.avatar: 'default'` — a
  privacy fix the policy found, rather than an origin to allow.

## 1.40 Phase 35 — final product quality pass

Plan §35.1a–§35.1d: *"Do not add features merely to make the site appear more complex… Remove
redundant UI and simplify any confusing flows."* The input was the 34 `P35-*` findings in
`docs/PHASE_35_36_AUDIT.md` (an earlier session's audit, untracked). Each was first re-checked against
current code, because Phases 30–34 had changed things since: **P35-03 was already fixed** (Phase 30
sweep 2), P35-14 and P35-15 partly. One migration (`order_shipping_estimate`), applied to development
by push and committed for everywhere else.

### 1.40.1 Navigation — where am I, how do I get back (§35.1b)

- **Links to pages that do not exist are dropped (P35-01).** Production's Navigation global links
  `/about`, `/contact` and `/help` — three 404s on every page — because the admin checks a URL's shape,
  never whether a page answers it. `resolveLink` now checks `PAGE_ROUTE_PATTERNS`
  (`lib/navigation/routes.ts`), a list rather than a filesystem walk because a deployed function has
  no `src/app`; `tests/unit/navigation-routes.test.ts` walks the tree and fails when the two disagree.
  The production global still needs its entries removed (TODO.md §11) — until then they are hidden
  rather than broken.
- **Visible breadcrumbs (P35-18)**: product (Shop / category / product — the JSON-LD now uses the same
  list, and it used to skip the category), category (Shop / parent / category) and journal article
  pages. A crumb links only to a published document. The product page's bottom "Back to the shop"
  and the category page's "Shop" eyebrow, both now repeats of the trail, are gone.
- **NEW says what it is (P35-19)** — `/shop?sort=newest` was titled "All"; it is "New arrivals".
  Not a new filter: the listing is the same catalogue, newest first, and says so.
- Mobile menu marks the current section (P35-29); the 404 page's footer has the newsletter like
  every other footer (P35-24); the wishlist has one name — "Wishlist" — where it had three (P35-34).
- **Shipping and returns are reachable** from the bag, the drawer, checkout and the product page's
  delivery section, and the three help pages link to each other and back to the shop (P35-32).

### 1.40.2 Commerce clarity — price, variant, availability, Add to Bag (§35.1c)

- **The sale price shows before a size is chosen, and a sale product is badged Sale, not New
  (P35-12)**; the struck price uses the muted tone, not the disabled one (P35-13). `compareAtForColor`
  shows a "was" price only when every size of the colour agrees on one.
- **A sold-out product says "Sold out"** — on the button and visibly on the colour (P35-17). It used
  to ask for a size.
- **A tapped size is selected at once** (P35-16, `useOptimistic`); the server still resolves price and
  stock. One "Choose a size." prompt where there were two.
- **A one-size product needs no size choice (P35-31).** A deliberate exception to §13.1c's "never
  pick a size on the customer's behalf": with one size there is nothing to choose, and Features §6 asks
  for "one unambiguous variant, add directly". A requested size that does not exist still selects
  nothing.
- The bag drawer offers "Continue shopping", and "Add the look" opens it like Add to Bag (P35-15).
- **Collections of four or fewer** no longer show the same cards twice (P35-10).
- **Size filter order** reads XS, S, M, L, XL, then numeric, then ONE SIZE (P35-11,
  `lib/catalog/size-order.ts`). Scoping the list to the current category is **deferred**: it needs a
  per-category cached vocabulary, and a shorter list is not worth a new cache layer this late.
- On phone and tablet the gallery is capped at about two-thirds of the screen so the name and price
  are in the first view (P35-30).
- **The delivery estimate outlives the purchase (P35-20).** Checkout promised "3–5 business days" and
  the order forgot it. Now snapshotted (`orders.shippingEstimate`, server-written only) and shown on
  the confirmation page, the order page and the confirmation email.

### 1.40.3 Visual consistency (§35.1a)

- Form fields use the `Input`/`Textarea` primitives — 16px text, 44px tall, one border and radius
  (P35-14); checkout's section headings are sans, as the type scale says heading-s is (P35-21).
- Editorial index and journal cards share one 3:2 crop (`editorialCard`) and one title size (P35-22).
- Off-scale spacing (`py-5`, `pt-6`, `gap-6`) replaced with tokens across account, auth and reviews;
  the account overview's double hairline removed (P35-23).
- No scaling on hover and no backdrop blur — the visual guide lists both under "avoid" (P35-25).

### 1.40.4 Editorial quality (§35.1d)

- **No developer copy on the site (P35-07).** Every collection page carried "Photography arrives in
  Phase 8"; every article was its excerpt followed by "Demo copy." Collections now have no body block
  (the description is already the lede); the three articles have their own paragraphs, written from
  what the catalogue already says and making no new brand claims.
- **No unbacked claims (P35-08, P35-26).** "Carbon-neutral delivery" became "Free delivery over $150",
  which `freeShippingThresholdMinor` enforces; "milled in Yorkshire" was removed. The overshirt block
  now links to the overshirt instead of an article about denim.
- **Hotspots sit on the photograph they point into (P35-02, P35-09).** The seed wrote positions with
  no image (AW26's chapters, which then showed neither hotspots nor "Add the look") or on whatever
  media came first (the homepage's Shop the Look, on a fabric swatch). `import:media` now places each
  image and its hotspots together, positioned by eye on the files; the seed writes none. A chapter
  refuses hotspots without a hero image. The lookbook page shows its cover, and its title no longer
  reads "AW26 — AW26" (P35-33).
- Footer social links removed until real handles exist (P35-27).
- **House style is US English (P35-28)** — the currency is USD and the locale `en-US`; "Colour" became
  "Color" in the interface. Seed prose still has British spellings in places; recorded, not swept.

### 1.40.5 Not done here, and why

- **P35-04, P35-01 (data half)** — production's content is the owner's: seed it or author it
  (TODO.md §11).
- **P35-05, P35-06** — the supplied photographs are 217–467 px wide (only the panorama is 1983 px),
  and have white frame borders. No placement or crop fixes a 267-px photograph on a 1440-px slot. The
  owner's photography item (TODO.md §5) is the fix; trimming borders in the import would re-upload
  over the images production also uses (Cloudinary is shared).

### 1.40.6 Sweep 1

An independent review of the phase commit, reading every changed area against the code around it.

- **The pre-size "was" price could quote a saving no buyable size had.** `compareAtForColor` counted
  only the reduced sizes: one reduced size — even a sold-out one — was enough to show "was $100" and a
  Sale badge above sizes that were full price. A former price is a pricing claim, so it is now shown
  only when **every** offered size of the colour is reduced to the same former price; otherwise the
  page waits for a size, as before Phase 35.
- **"Choose a size." flashed on one-size products** while a colour change round-tripped, because the
  optimistic state cleared the size the server was about to re-select. A one-size product is never
  asked.

Checked and clean: the route guard keeps query, hash, trailing-slash and encoded-slug links; every
navigation consumer already tolerates a dropped link; the gallery cap sits on the wrapper, so the swipe
index still matches the thumbnails; `shippingEstimate` is written on the only path that writes the
method label; the import keeps chapter ids; no test still asserts changed copy.

### 1.40.7 Sweep 2 — the E2E suite's first run

Audit R3-04: the 57 Playwright tests had never run, because until the development database moved to
its own Neon account the only reachable database was production. Sweep 2 ran them for the first time,
against a production build (`pnpm build && pnpm start`) of the reseeded development database.

**First run: 38 passed, 5 failed, 14 skipped.** Every failure was investigated before anything was
changed. One was a shop defect, one a configuration defect, three were the suite's own:

- **The shop: a customer who had just reviewed a product was told only that they had reviewed it**
  (flow 10). The form shows the pending-moderation sentence, but the action revalidates the page and
  the form is replaced by *"You have already reviewed this product"*, taking the sentence with it —
  §21.1b's *"held for moderation"* was never said where the customer could read it. The product page
  now shows the pending sentence for as long as their review is pending (`ownReviewPending`). The flow
  could not have run before Phase 34, because the review form could not save at all (§1.39.3).
- **Configuration: `next start` on a laptop called itself production** (audit R1-19). `resolveAppEnv`
  fell back to `NODE_ENV`, so the local build read the production search index — absent locally, so
  search showed its outage state and the "no results" test found the wrong page — and would have
  accepted live Stripe keys. Off Vercel is now always `local`, server and client alike.
- **The suite: two flows clicked the header behind an open drawer.** Add to Bag opens the bag drawer
  (Phase 30), which makes the rest of the page inert — correct modal behaviour the specs predate. The
  drawer helper now accepts a drawer that is already open, and flow 5 closes it before reaching for
  the account link.
- **The suite: the homepage accessibility scan measured invisible text.** Sections below the fold
  start faded out until the reader reaches them; axe reads the DOM once, so it reported seventeen
  contrast failures on content at `opacity: 0`. The scan now scrolls the page through with reduced
  motion first, so it checks what a reader sees.

**Second run: 41 passed, 2 failed, 14 skipped**, and both failures were the specs' expectations of
the corrected behaviour: flow 10's reload step still expected *"already reviewed"* where the page now
(rightly) says the review is pending, and the no-results test counted the empty state's own "Worth a
look" grid as a results grid. Both corrected and re-run green: **43 passed, 0 failed, 14 skipped.**
The specs' docblocks still say they have never been executed; that is corrected with the testing
documentation in Phase 36.

The 14 skips are written into the specs themselves — flows that need a server-side mutation mid-test
or Stripe keys this environment does not have — and are listed with their reasons in Phase 36's
testing document.

## 1.41 Phase 36 — the three review passes

Plan §36.0 and §36.1a–§36.1c. Feature development stopped; the work was to find what the build itself
had missed and fix it. The input was the earlier audit (`docs/PHASE_35_36_AUDIT.md`, untracked working
input, never committed), **re-checked item by item against the code first**, because Phases 31–35 had
already fixed a large share of it. The three required reports are `docs/REVIEW_1_ARCHITECTURE.md`,
`docs/REVIEW_2_UX_ACCESSIBILITY.md` and `docs/REVIEW_3_PRODUCTION_READINESS.md`; this section is what
changed and why. One migration (`phase_36_order_fulfilment_hold`).

### 1.41.1 Review Pass 1 — the shop could not safely take money

None of the checkout or webhook code had been touched since Phase 18, and five High findings were
still open in it. All five are fixed; `verify:webhook` went from 38 checks to 67.

- **The webhook paid whatever order the metadata named (R1-01).** An old Stripe session could pay for
  an order preflight had since rewritten — a different bag, a different total. Paying is now a
  conditional claim on the order's *current* session id, total and currency; anything else is a
  `mismatch`, recorded on the event row, reported to Sentry, answered 200 (a retry cannot fix it) and
  never applied. Preflight expires a reused order's previous session first and refuses if it was
  already paid. Sessions expire after 31 minutes — Stripe's 30-minute floor is measured from its own
  clock, so exactly 30 is refused.
- **`completed` is not `paid` (R1-05).** The session's `payment_status` now decides: `unpaid` waits at
  `pending_payment` for the async result; `no_payment_required` is a mismatch, because this shop has no
  free orders.
- **A failed webhook was acknowledged and lost (R1-04).** Every insert error was treated as a duplicate
  and answered 200; a database error during the order lookup became "ignored". Now only a unique
  violation is a duplicate; a failed or stale row is reclaimed atomically and reprocessed exactly once;
  a fresh in-flight row is answered 409 so Stripe retries; anything else is 500.
- **An expired session stranded the bag (R1-03)** by reusing a `cancelled` order into a terminal
  state. Cancelled orders are never reused; `pending_payment` ones are, safely.
- **Every checkout was refused (R1-02).** The tax provider was still Phase 16's placeholder, so no
  address ever produced a figure. It is now Stripe Tax (`tax.calculations`) whenever Stripe is
  configured. `automatic_tax` on the Checkout Session is deliberately **not** used: Stripe would then
  compute the total, and `amount_total` would stop matching the order's — breaking DEV-63 and the
  R1-01 check. The owner must enable Stripe Tax; without registrations it returns zero (TODO.md §4).

Also fixed in the same path: promotion limits enforced at payment (R1-07), a reused order taking the
bag's current code (R1-08), cumulative partial refunds that leave the order paid (R1-09 — the demo
order `N1-2607-DEMO05` was seeded as `refunded` and is now `paid`), and **oversold orders (R1-10,
R3-19)**: stock decrements roll back to a savepoint, the order is marked `fulfilmentHold =
stockShortfall`, and the confirmation says the order is being checked rather than that it is on its
way. There is no staff-notification channel; a held order is found by the admin column and Sentry.
A password reset or an admin password change now ends every session (R1-13); Resend calls time out
after 8 seconds and the webhook sends email after responding (R1-21).

### 1.41.2 Review Pass 2 — clarity and access

Of twenty findings, five were already fixed (including the one High, R2-01). The rest are fixed except
one Low by decision: checkout lists what is being bought; checkout buttons are primary; the
payment-unavailable copy is written for shoppers; mobile menu rows meet the 44-pixel target; a guest's
discount code survives sign-in; the bag distinguishes a per-order cap from stock; category filters are
a tree; the skip link moves focus; the checkout, discount and address forms mark their fields invalid and point them at the error. **Not built:** a one-time
notice when sign-in reduces a guest's lines — it needs a new cookie and a clearing action (R2-03's
second half).

### 1.41.3 Review Pass 3 — failure and deployment

Thirteen of twenty-six were already fixed by Phases 31–35. Fixed here: handled failures now reach
Sentry (`reportFailure`, R3-13 — checkout, webhook, tax, catalogue, shell); uploads capped at 4 MB
because Vercel Functions reject request bodies over about 4.5 MB and uploads stream through the
function (R3-16); a failed image shows its reserved placeholder (R1-29); analytics can never throw into
a page (R1-30); robots.txt's non-standard `Host:` line and Sentry's inert `disableLogger` removed
(R3-23, R3-24). **Recorded rather than fixed:** every storefront page renders per request (DEV-83).
Owner actions — search index, Preview, CI secrets, region, `SITE_URL`, queued builds — are unchanged
in DEPLOYMENT.md §9 and TODO.md.

### 1.41.4 §36.0 — the documents agree with the build

Twelve DEV entries (DEV-73…84) and four gaps (G-17…20) recorded; DEV-45, DEV-50, DEV-52, DEV-55,
DEV-59, DEV-61, DEV-62 amended; the canonical documents carry "as built" prefaces pointing at the
entries that override them; README, ARCHITECTURE, DEVELOPMENT, DATABASE, STACK_VERSIONS, ENVIRONMENT
and SEARCH corrected where they contradicted the code. The returns and contact copy no longer promises
an online returns flow or names an undeliverable address (DOC-01, DOC-02 — the live wording is the
owner's, TODO.md §12). Plan §38's missing documents now exist: `CMS.md`, `COMMERCE.md`, `EMAIL.md`,
`ANALYTICS.md`, `TESTING.md` and the three review reports.

### 1.41.5 What was verified

| Check | Result |
|---|---|
| `pnpm typecheck`, `lint --max-warnings 0`, `format:check`, `build` | pass |
| `pnpm test:run` | **927** (from 868: webhook decisions, Stripe Tax mapping, confirmation, courier reply-to, component tests) |
| All 22 `verify:*` harnesses on a freshly reseeded development database | pass — `verify:webhook` 67 (from 38), `verify:orders` 83, `verify:checkout` 67, `verify:promotions` 69, `verify:email` 87, `verify:access` 50 |
| `pnpm scan:secrets` | no secrets in 467 tracked files |
| Playwright E2E, full suite, local production build | **43 passed, 0 failed, 14 skipped** |
| Performance (Review Pass 3) | CLS 0.000 everywhere; homepage LCP 0.3–0.4 s; cached routes TTFB ~90 ms, per-request routes ~1 s from a laptop to `us-east-2` |

**Not verified, and why:** nothing that needs Stripe keys has run — session creation, a Stripe Tax
calculation, a real payment, a real refund. The code paths are harness-tested with signed events
offline; the first test-mode purchase is the owner's first step once keys exist (docs/COMMERCE.md).

### 1.41.6 Sweep 1

Two independent reviews of the phase commit: one adversarial, on the payment path only, assuming an
attacker controls every request and Stripe delivers late, twice and out of order; one on everything
else, including a spot-check of fifteen claims in the new documents against the code.

**The payment path** — seven defects, one High, all fixed:

1. **(High) Concurrent checkouts on one bag.** A double click or a second tab could create two orders
   for one bag, or rewrite one pending order twice and leave a payable session behind — money taken
   for an order that stayed unpaid, or a double charge. The lookup and write now run under a per-cart
   `pg_advisory_xact_lock` (Payload's `indexes` has no `where`, so a partial unique index would have
   meant a hand-written migration); reusing a pending order is a conditional claim on the status and
   session it saw; and the session claim also requires the order's `updated_at` from that attempt's own
   write, so a superseded attempt loses and expires its session. `verify:checkout` G2 races two
   preflights with `Promise.all`.
2. **A mismatched payment was invisible to staff.** It now sets `fulfilmentHold = paymentMismatch` on
   the order (payment status unchanged) as well as reporting to Sentry. No automatic refund: whether
   the money is a duplicate or the customer's only payment is a staff decision.
3. **The confirmation email could be lost** between marking the event processed and queueing it in
   `after()`. The email row is now queued inside the payment transaction; `after()` only delivers.
4. **A refund that arrived before its payment was recorded as processed and lost.** It now answers
   500 so Stripe retries until the payment has landed.
5. **Converting the bag through the Local API could roll the payment back silently** (Payload kills
   the transaction on a failed write) while finalise reported success. It is a raw UPDATE on the same
   transaction now.
6. **No Stripe Tax transaction was ever recorded**, so sales would be missing from Stripe Tax reports.
   The calculation id is stored on the order and committed with `createFromCalculation` after payment,
   without blocking. Reversal on refund is not built (documented in `lib/tax/transactions.ts`).
7. **A zero taxable base called Stripe**, and **the shortfall detail was inaccurate** — both fixed; the
   harness now proves the savepoint-rollback branch runs.

One migration (`phase_36_sweep_1_mismatch_hold_tax_calculation`). `verify:webhook` 74, `verify:checkout`
71, `verify:orders` 85.

**Everything else:**

- **A failed image never cleared.** `MediaFrame` remembered a failure for the life of the component,
  and the product gallery deliberately reuses one frame across colours — so after one image failed,
  choosing another colour loaded the new image underneath a placeholder that never lifted. The frame
  is now keyed by its image.
- **A category cycle hid categories.** The tree-order walk starts from roots, and two categories that
  name each other as parent have none, so both vanished from the filter. Anything the walk misses is
  now listed at the top level.
- **The reply-to guard missed the bare reserved names** (`help@localhost`, `help@example`) because
  its pattern required a leading dot.
- **The address book was said to tie errors to fields, and did not** — only its notice had become an
  alert. Its inputs now carry `aria-invalid` and point at the notice.
- **The skip link's focus move** was cited as verified by the mobile-navigation spec, which in fact
  said it deliberately did not assert it. It asserts it now.
- **Seven documentation claims were false or overstated** — a test-file count, a sentence calling the
  specs' docblocks stale in the commit that had just rewritten them, "component test" cited where
  none existed, `verify:media` cited for the upload cap it never checks, and ESLint's reach over
  Sentry imports. Each corrected to what is actually verified, or to "code review".

**The gate after the fixes** — 936 unit and component tests, build, 21 of 22 harnesses and 42 of 43
E2E flows green on the first run. The two failures were one cause: `verify:search` crashed on a
dropped Neon connection (`Connection terminated unexpectedly`) before its cleanup, leaving its
published fixture product in the database, and E2E flow 2 then picked that product as the first in the
shop and searched for it. The harness's cleanup only removed what the current run had created, so a
crashed run's debris was permanent. It now clears earlier runs' fixtures by their `vs-`/`VS-` prefixes
before it starts; re-run, it removed the product, passed 210/210, and flow 2 passed.

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

*Resolves G-11. Affects Phase 18. **Confirmed in Phase 18** — `displayStatus` derives the plan's single
line from the two stored axes, and all 35 combinations are asserted; see §1.23.6.*

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

**Amended in Phase 30 — five items: NEW · SHOP · COLLECTIONS · EDIT · LOOKBOOK.** ABOUT was withdrawn
because `/about` is a route no phase builds, so it was a 404 in the primary navigation on every page.
NEW stays, for the reason above — three written documents specify it. The count now matches the
reference image; the set still does not, and that is still deliberate. See §1.35.1 and §1.35.5:
`verify:shell` resolves every navigation href against the route tree, so ABOUT comes back only with a
page behind it.

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

***Discharged in Phase 6.*** Customer address and size guide exist as collections; gender and the
product display price exist as fields; variant availability is enumerated as a derivation rather than
a column, and the reasoning is at the top of `src/payload/collections/ProductVariants.ts`. The
infrastructure row is honoured by *not* building those records — the entry's own wording says "created
in their own phases rather than up front", and **D-19** records the rule that follows from it. See
notes §1.11.8.

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

> **Revised in Phase 10 — see DEV-40.** Phase 10 built the reveals and did not install the library.
> Two claims above did not survive contact with the measurement. The word *"cinematic"* **does not
> appear in the visual guide at all** — it is the plan's word (line 401), and the guide's actual
> instruction is §08's *"keep it slow, keep it subtle, prefer crossfades and gentle reveals"*, which
> needs no spring, no gesture and no scroll-linked transform. And *"genuinely needed"* was an
> assumption rather than a finding: two CSS declarations and one `IntersectionObserver` do the whole
> job. The deferral was right; the prediction attached to it was not.

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
| ~~`ALGOLIA_ADMIN_API_KEY`~~ → **`ALGOLIA_WRITE_API_KEY`** | `ALGOLIA_ADMIN_KEY` and `ALGOLIA_WRITE_API_KEY` are both in circulation. Phase 4 picked *admin* and **Phase 11 corrected it**: Algolia's signup screen issues a pre-scoped **Write API Key**, and it is not the Admin key — measured against a live application, it can add/delete objects, edit settings and delete indices, but `GET /1/keys` returns **403**. The old name was wrong against both the vendor's label and the key's real ACLs, and would have invited someone to paste an account-root credential into it. Corrected before anything read the variable. |
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


### DEV-27 — A review requires a customer

**Plan §6.1j says:** a review has a *"customer reference **if applicable**"* — which reads as nullable.

**We do:** make `reviews.customer` **required**.

**Why:** two other requirements are unsatisfiable without it, and one of them is a constraint that
silently does nothing.

- **Duplicate prevention.** Plan §21.1c's first abuse case is *"duplicate review by same customer for
  same product"*. The constraint that stops it is `UNIQUE (product, customer)` — and over a *nullable*
  `customer` that constraint does nothing at all, because Postgres treats NULLs as distinct from one
  another, so every anonymous review satisfies it. This was measured in Phase 5 on the fixture
  (§1.10.6) and is the first of `docs/DATABASE.md` §8's traps. Requiring the column is what turns the
  index from decoration into enforcement.
- **Verified purchase.** Feature matrix §9 wants a *"verified-purchase indicator based on order
  history"* and plan §21.1a wants to *"match customer to a paid order containing the product"*.
  Neither is possible without knowing who wrote it.

Plan §21.1a independently expects it: *"only authenticated customers should submit reviews unless a
deliberately designed verified-review workflow is implemented."* No such workflow is designed anywhere
in the corpus, so the required column follows the more specific instruction. `displayName` stays a
separate field precisely so the public byline never has to be the account name.

**Authoritative:** this document. §6.1j's "if applicable" is a field-list hedge; §21.1c states a rule
that the hedge would make unenforceable.

*Affects Phases 6 and 21.*

---

### DEV-28 — The `media` collection is created in Phase 6, not Phase 8

**Plan §8.1a says:** media architecture — Payload metadata records plus Cloudinary delivery — is
**Phase 8**.

**We do:** create the `media` collection in Phase 6 as an upload-enabled skeleton with two fields,
`alt` (required) and `caption`. Phase 8 adds everything else.

**Why:** Phase 6 cannot be built without it. Plan §6.1a asks a global for a logo; §6.1b asks a product
for a gallery and an optional video; §6.1e, §6.1f, §6.1g and §6.1h ask for hero, intro and cover media;
§6.1i asks an article for a hero image; §6.1j asks a review for photos. Every one is an `upload` field,
and an `upload` field needs a collection to point at. The alternatives were both worse: text columns
holding URLs, to be swapped for real relationships in Phase 8 — a rewrite of a dozen tables and every
foreign key between them — or leaving the fields out and adding them later, which is the same rewrite
under a different name.

It is the precedent Phase 2 set with `Users`, which exists as *"foundation, not a feature"* because
Payload requires one auth collection before any feature needs authentication (§1.7.5).

**What Phase 8 still owns, and this does not pre-empt:** the Cloudinary storage adapter (**DEV-05**),
`sharp`, `imageSizes`, focal point and crop, mime-type and size validation, and the media-role and
dimension metadata §8.1a lists. `sharp` is deliberately not installed — without it Payload stores the
original and skips image processing, which is exactly the reduced behaviour intended, and installing it
now would be installing a later phase's dependency.

`alt` is required from the start because accessibility is *"part of implementation, not a final
cosmetic pass"* (§0.1.19), and alt text backfilled across a seeded catalogue months later is the thing
that never happens.

*Affects Phases 6 and 8.*

---

### DEV-29 — A variant SKU is unique across the whole catalogue

**Plan §6.1c says**, in a box of its own: *"Do not allow two active variants of the same product to
share the same SKU."*

**We do:** `UNIQUE (sku)` across the entire `product-variants` collection — strictly more than the rule
asks.

**Why:** the rule is a lower bound on correctness rather than a specification, and the two things it
permits are both defects.

- **The same SKU on two different products.** Nothing in the wording forbids it, and it is incoherent.
  A stock-keeping unit that identifies two different garments cannot be picked, counted or reconciled,
  and every downstream system — Stripe line items, the Algolia index, a fulfilment export — assumes
  otherwise.
- **Reusing a SKU after retiring a variant.** This is the case the `WHERE active` clause exists to
  allow, and precisely the case that breaks order history. Order lines snapshot the SKU (§6.1k,
  §18.1d); if a SKU may be reassigned, two orders eighteen months apart can record the same code for
  two different garments and no report can tell them apart. Retired SKUs staying retired is what makes
  the snapshot mean anything.

It is also the constraint Payload's API can actually express. The literal reading is a *partial*
unique index, which `{ fields, unique }` cannot produce; Phase 5 flagged the choice for this phase
(`docs/DATABASE.md` §8) between `afterSchemaInit`, a hand-written migration, and a stricter constraint.
The stricter one is both simpler and more correct, and unlike a hand-written index it is visible to the
Drizzle snapshot chain, so later migrations maintain it.

A second, weaker constraint carries the presentation half: `UNIQUE (product, color, size)`, so a size
selector can never face two rows offering the same combination — plan §13.1c requires the server to
determine whether *the* exact variant exists, singular.

**Authoritative:** this document. The plan states a minimum; nothing in the corpus asks for a SKU to be
reusable.

*Affects Phases 6, 12, 17 and 18.*

---

### DEV-30 — Default currency and locale are this project's choice

**The documents say:** plan §6.1a lists *"default currency"* and *"default locale"* as site settings,
and carries currency on the cart (§6.1k) and the order (§6.1k), and asks a promotion to check
*"currency compatibility if applicable"* (§15.1a). **No document in the corpus names a currency, a
country or a locale.** There is no price, no address and no market anywhere in the six artifacts.

**We do:** default to **USD** and **`en-US`**, with GBP and EUR available in the enum, and record both
as editable in Site Settings.

**Why:** something has to be chosen before a price column can be written, and USD is the least
surprising default for a Stripe test-mode build. The choice is deliberately shallow: it is a *default*
in a settings row, not an assumption baked into the schema.

**What this is not:** multi-currency pricing. Catalogue prices are held in one currency — the one
`site-settings.defaultCurrency` names — and the `currency` column on a cart and an order records which
currency *that row's* money was denominated in, so a historical order still reads correctly if the
store default is ever changed. Changing the default converts nothing and reprices nothing. The schema
should not be read as offering more than that.

One assumption does reach the schema: the minor-unit convention (**D-20**) assumes a two-decimal
currency. All three enum values are. Adding a zero-decimal currency such as JPY means revisiting the
formatting layer before the enum.

**A later phase may correct this** with a real market requirement from the project owner — that is a
correction to this entry, not a silent change to a column default.

*Affects Phases 6, 14, 15, 16 and 17.*

---

### DEV-31 — Registration names a duplicate email; every other message refuses to

**Plan §7.1e lists as an edge case:** *"Existing email during registration."* It does not say what to
answer, and the same list contains *"Nonexistent email"* — whose only safe answer is one
indistinguishable from a wrong password.

**We do:** registration says *"An account already uses that email address. Sign in instead, or reset
your password."* Login, and forgot-password, say nothing that distinguishes a known address from an
unknown one.

**Why:** the two cases are not symmetrical. On the login form, an attacker supplies an address they
want to *learn about*; on the registration form, the person supplies one they already know is theirs,
and refusing to explain leaves them on a form with no way forward — a dead end, not a defence. The
privacy-preserving alternative (accept the registration silently, send an email explaining an account
already exists) requires an email transport, which is **Phase 19**.

**What this costs, stated plainly:** the registration form is an account-enumeration oracle, one
address per round trip. **Phase 26**'s Turnstile is what puts a price on doing that at scale, and the
flow an attacker would actually script — forgot-password — is silent, as is Payload's own
`forgotPassword` operation.

*Affects Phase 7. Revisit at **Phase 19**, when the silent-accept variant becomes buildable, and at
**Phase 26**, which adds the rate limit that makes the residual exposure academic.*

---

### DEV-32 — A password-reset flow exists eleven phases before email does

**Plan §7.1e says:** implement *"Forgot password"* and *"Reset password"*, and handle *"Expired reset
link"* and *"Reused reset link"*. **Plan §19 says:** email is Resend, in Phase 19.

**We do:** build the whole flow now — token issue, one-hour expiry, single use, a storefront
`/reset-password` route, and the two edge cases — with a **log-only email adapter** standing in for
delivery until Phase 19.

**Why:** Payload's unconfigured default logs a message's subject and discards its body, and for a
reset mail the body *is* the token. Shipping that would mean a form that submits, confirms, and cannot
be completed by anyone — plan §0.1.17's fake functionality. Deferring the whole flow to Phase 19 was
the other option, and it leaves §7.1e's two named edge cases untestable for eleven phases while an
account has no recovery path at all.

**What is real and what is not:** the token, the expiry, the single use, the storefront route, the
session handling and both edge cases are real and tested. Only the transport is missing, and it says
so at `error` level on every send outside local development rather than degrading quietly.
`docs/DEVELOPMENT.md` says where the link appears.

*Affects Phases 7 and 19. **Phase 19 replaces the adapter and re-styles the message**; the route and
its `?token=` parameter must not change.*

---
### DEV-33 — `sharp` is not installed, reversing DEV-28's closing clause and three lines of the stack document

**Two committed documents say:** `sharp` arrives in Phase 8. `DEV-28`'s final paragraph — *"`sharp` is
deliberately not installed … installing it now would be installing a later phase's dependency"* — and
`docs/STACK_VERSIONS.md` in three separate places.

**We do:** not install it. `crop: false` on the `media` collection, and `focalPoint: true` instead.

**Why:** under **D-26** Cloudinary performs every transformation at delivery, so nothing in the serving
path calls it. Dimensions come from Payload's header-only byte probe; `adminThumbnail` as a function
needs neither `sharp` nor `imageSizes`; focal point is stored regardless and consumed by our own URL
builder as a Cloudinary gravity.

The deciding argument is the one that at first looks like an argument *for* installing it: without
`sharp`, Payload's crop UI renders and silently discards the crop, which is exactly the *"UI that looks
functional but silently does nothing"* §0.1.17 forbids. But installing `sharp` fixes the silence and
leaves the tool wrong — every delivered variant is re-derived from the **original** through Cloudinary,
so a Payload-side crop is discarded by the thing that actually produces the image. Switching the tool
off is the honest fix, and it leaves the dependency with nothing to do.

**What this is not:** a saving of install cost. `sharp@0.35.3` — the exact pin the documents name — is
already resolved in `pnpm-lock.yaml` as an optional dependency of `next@16.3.2`. What is avoided is a
direct dependency the running code does not use, which is what plan §2.1b is about.

**Reversible.** A later phase that genuinely needs server-side image processing — a generated OG card
composited from text, say — adds `sharp` and passes it to `buildConfig`. Nothing here depends on its
absence except the crop tool, and that would need re-examining anyway.

*Supersedes DEV-28's sharp clause. Affects Phase 8. Recorded as **D-27**.*

---

### DEV-34 — Eight delivery contexts, not §8.1c's six

**Plan §8.1c says:** use responsive variants/crops appropriate for desktop hero, mobile hero, product
card, product PDP gallery, editorial image, thumbnail — **six**, with no dimension, ratio or crop mode
given for any of them.

**We do:** define eight. The six, plus `productZoom` and `socialCard`.

**Why:** each addition is owed to something already written down.

- **`productZoom`** — plan §13.1a gives the PDP a zoom and a full-screen viewer. Zooming into the
  cropped gallery frame would magnify the crop rather than reveal the parts of the garment it removed,
  so the zoom must be a separate, uncropped variant. §8.1c's "PDP gallery" cannot be both.
- **`socialCard`** — `src/payload/fields/seo.ts`, written in Phase 6, already tells editors *"Social
  share card. Landscape, roughly 1200 × 630."* That is the only image dimension anywhere in the
  repository, and Phase 8 either honours it or makes a shipped field description a lie.

**Also recorded:** every ratio in all eight is this project's invention, because a sweep of all six
specification documents for image dimensions and aspect ratios returns nothing. The **widths** are not
invented — they are plan §30.1a's breakpoints (320 / 375 / 430 / 768 / 1024 / 1280 / 1440 / 1920) and
DPR multiples of them.

*Affects Phase 8, and Phases 10, 11, 13, 22, 23 and 24, which consume these contexts.*

---

### DEV-39 — Campaigns are not a link target, for now

**The schema said** a navigation item, a call to action or an editorial link could point at a campaign:
`campaigns` was one of the seven entries in `LINKABLE_COLLECTIONS`.

**It no longer can.** A campaign has no public URL in any of the five specification documents — the
evidence is tabulated in notes §1.14.11 — so a link aimed at one could never resolve, and the header
dropped it silently. An admin field that accepts a choice which then does nothing is plan §0.1.17's
fake control in a different coat, and the honest fix is to stop offering the choice rather than to keep
explaining the outcome.

**What is *not* being claimed.** This is not a ruling that campaigns are permanently unlinkable, and it
is not a change to the `campaigns` collection, which is untouched: it still exists, is still seeded,
still holds its hero, story, products, collection and CTA, and is still what Phase 10 renders as the
homepage hero. **The deferral is only about being a link *target*.**

**Restoring it is three things, and they belong together:** the entry in `LINKABLE_COLLECTIONS`, the
entry in `lib/navigation/routes.ts`, and a migration putting the four `campaigns_id` columns back —
the exact inverse of `20260828_060719_phase_9_defer_campaign_links`, whose `down` already contains the
SQL. The phase that gives a campaign a page does all three in one commit, which is the only order in
which either half is honest.

**Revisit** when a written requirement gives a campaign a URL. Until then `verify-shell.ts` holds the
invariant that made this a bug in the first place: every collection a link may point at has a route.

*Affects Phase 9 and whichever later phase gives campaigns a page.*

### DEV-36 — The mobile drawer has no back button, because it has no nested groups

**Plan §9.1c says** the mobile navigation needs *"a drawer with hierarchical expansion"* and lists,
among its requirements, *"back button for nested groups."*

**What was built** is a one-level, self-collapsing accordion with no back control.

**Why.** There are no nested groups to go back through. The CMS shape settles it rather than taste: a
primary item holds *columns of links*, and a column is a heading, not a destination — there is no third
level in the schema to nest. A panel-sliding drawer would satisfy the letter of that bullet by first
manufacturing the problem it solves: the customer would lose sight of the other five destinations in
order to read four category links, on the surface visual guide §10 asks to keep *"quiet, monochrome,
highly legible, minimal visual clutter."*

Everything else on §9.1c's list is met and was driven in a browser: the group header is an accordion
trigger rather than a link, so tapping SHOP never navigates; the landing page is an explicit **All
Shop** row inside the group; Escape, the focus trap, focus restoration, scroll containment and
`aria-expanded` are Radix's.

**Revisit** if a later phase adds a third level to the `navigation` global. The back control comes with
it, not before it.

*Affects Phase 9. Recorded because it is a requirement bullet not literally implemented.*

### DEV-37 — The search overlay ships as chrome, with an honest interim panel

**Plan §9 requires** that a user can *"open/close search … from any major route"*, and its §9.1a prompt
lists a *"search trigger"* among the shell's parts. **Plan §12.1c** enumerates what goes inside the
overlay — query input, suggested categories and collections, product suggestions, recent and popular
searches, view-all — and every one of those is an Algolia query, which **Phase 12** owns.

**What was built** is the overlay and everything around it: the trigger, the state machine, focus
into and out of it, Escape, scroll containment, mutual exclusion with the bag and the mobile menu.
Inside it, one line saying search arrives with the catalogue, and the primary navigation as a way
through to browsing.

**Why there is no search box.** A field that swallows a query, or one that submits to a `/search` route
no phase has built, is exactly plan §0.1.17's *"never create fake UI for unsupported functionality"* —
and worse than nothing, because it costs the customer a typed sentence and their attention before
telling them anything. Offering the browse routes instead is the same instinct structure §12 applies to
a real no-results state: *"offer category alternatives."*

This is the same shape as **DEV-25**, where the footer's newsletter column is a slot the phase that can
post a form fills in. Phase 12 replaces the body of `SearchPanel` and touches nothing else.

*Affects Phases 9 and 12.*

### DEV-38 — Social links are words, not icons

**`Navigation.ts` said** the social array is *"rendered as icons in the footer"*, and its `platform`
field was a closed list on the stated grounds that *"each value is an icon the application ships."*

**Neither is true, and the schema now says so.** `lucide-react@1.x` — the only icon dependency the tech
stack approves — **ships no brand marks**. `Instagram`, `Youtube`, `Linkedin`, `Twitter` and `Facebook`
were all removed from the set; the export is `undefined`.

**What was built:** the footer renders each platform as a quiet uppercase text link, which is guide
§06's own instruction for links — *"text-first, precise"* — and is consistent with the rest of the
footer. The closed list survives with a different justification, written into the field: it supplies a
*printed name*, because "TikTok" and "YouTube" carry internal capitals that no case transform produces
and "X" is a single letter that title-casing would leave looking like a typo.

**The two alternatives were worse.** Adding a second icon library for six glyphs is a dependency the
stack does not list, for decoration; hand-drawing six trademarked logos into this repository is not a
design system.

*Affects Phase 9. The field description in `Navigation.ts` and the docblock in `site-footer.tsx` both
record it.*

### DEV-35 — SVG and GIF are refused on upload

**Plan §8.1b says:** validate *"Allowed mime types"* and *"Reasonable image formats"*, and *"Do not
accept arbitrary executable files."* It names no formats.

**We do:** accept JPEG, PNG, WebP, AVIF, MP4 and WebM. Refuse **SVG** and **GIF**.

**Why:** both are specific, verified bypasses of the only content check Payload has.

- **SVG** is a script-execution context that renders as a picture, and Payload's own `validateSvg` can
  be stepped around: a file opening with an `<?xml …?>` declaration is sniffed as `application/xml`,
  **relabelled** to `image/svg+xml`, and then skips validation because the relabelling happens inside
  the branch the validator guards. Excluding it from the allowlist is what actually stops it — the
  relabelled type then fails the allowlist test. Verified: the refusal reads
  `Invalid MIME type: application/xml`.
- **GIF** because `file-type` reads magic bytes at **offset 0 only**, so `GIF89a` followed by an entire
  executable is detected as `image/gif`. Verified by building exactly that file; the refusal reads
  `Invalid MIME type: image/gif`.

**What this costs:** an editor cannot upload a vector logo or an animated GIF. Neither is asked for
anywhere in the corpus — a logo ships as PNG, and motion has a field of its own in `products.video`
(§6.1b), which is why MP4 and WebM *are* accepted.

**Revisit** only with a real requirement, and then with a sanitiser (SVG) or an offset-aware scan (GIF)
rather than by widening the list.

*Affects Phase 8 and any later phase that wants a vector asset.*

### DEV-40 — Motion is not installed in Phase 10 either, reversing DEV-24's deferral

**DEV-24 said** the animation library *"moves to Phase 10, with the homepage editorial system that
first has something to reveal."* **The tech stack** lists Motion as approved and Required. **Feature
matrix §3** names it among the homepage's `**Uses:**`.

**We do:** install no animation library, in this phase or any so far. The homepage's editorial reveal
is two CSS declarations on the existing duration tokens plus one client component using
`IntersectionObserver` — `components/editorial/reveal.tsx`, and the `[data-reveal]` block in
`globals.css`.

**Why — four measurements, not a preference:**

| | |
|---|---|
| **Install** | `motion@13.1.1` resolves to a re-export shim; the real tree is `motion` + `framer-motion` + `motion-dom` + `motion-utils` = **8.64 MiB, four new packages** |
| **Bundle** | `motion/react-client` is **~40 KB gzip** — on the LCP route, and many times React's own runtime in this project |
| **Reduced motion** | `MotionConfigContext` defaults to `reducedMotion: "never"`; opting in neuters only *positional* keys, and **opacity is not one of them**, so a reduced-motion visitor gets every fade at full duration |
| **Tokens** | it animates through the Web Animations API, which cannot read the CSS custom properties that `globals.css` collapses to 1 ms under `prefers-reduced-motion` — so honouring the preference would need a **second** implementation of motion, which is precisely what **D-13** exists to prevent |

Every `motion/react` entry point carries `"use client"`, so each animated section would also have
become a client boundary on a page that currently has two.

**The strongest argument against this, stated plainly:** `useInView` alone is well under 1 KB gzip,
and importing only that would cost almost nothing. It is rejected because it puts four packages
permanently in the tree so that the *next* phase can reach for a motion component without making a
decision — and it will, because the import is already there. A dependency installed in order not to
use it is §0.1.13's *"unnecessary dependencies"* with extra steps.

**What this costs:** no springs, no gestures, no layout animation, no presence-based exit animation
outside the Radix overlays that already have one. Nothing in the corpus asks for any of them; guide
§08 asks for the opposite.

**Revisit** if a written requirement needs motion CSS cannot express — a shared-element transition, a
drag interaction. Motion stays an approved technology and `docs/STACK_VERSIONS.md` records it as
available and not installed.

*Affects Phases 3 and 10. Amends **D-13**; adds **D-34**.*

### DEV-41 — The homepage hero renders no video, and `Campaigns` gains no `video` field

**Plan §10.1b says** the hero supports an *"Optional video"*, with the edge case *"Video unavailable:
image fallback."*

**We do:** render the campaign image and nothing else, and deliberately **do not add** a `video`
field to `Campaigns`.

**Why, in the order the reasons decided it:**

1. **§30.1c — the section that governs this exact route — says *"Avoid … Autoplaying massive
   videos."*** The homepage is the LCP route plan §37 measures.
2. **`prefers-reduced-motion` could not be honoured from the token layer.** An autoplaying video needs
   a client component reading `matchMedia`, which is the second definition of motion **D-13** forbids
   and **DEV-40** has just declined for the same reason.
3. **The frame could not be reserved.** Payload's dimension probe reads no video container, so every
   video row has `null` width and height — the box would be guessed rather than derived from the
   delivery context, which is the layout shift §30.1b forbids and §8.1d was built to prevent.
4. **It could not be smoke-tested.** No video asset exists in this project, and the phase gate
   requires a real-browser pass. Shipping an unverifiable rendering path is worse than a written
   deferral.

Adding the *field* without the renderer would be worse still: an upload control an editor can fill
that changes nothing is §0.1.17's fake control wearing a different widget. **The field is not added.**

§10.1b's *"Video unavailable: image fallback"* is satisfied permanently and trivially — the image is
the hero.

**Revisit in Phase 23**, which has editorial pages and a reason for a campaign film. `media` already
accepts MP4 and WebM (**DEV-35**), so the schema is ready when the requirement is.

*Affects Phase 10; to be confirmed in Phase 23.*

### DEV-42 — The newsletter is the footer's column, not a homepage block — discharging DEV-25

**Plan §10.1a lists** *"Newsletter"* among the homepage blocks, and **feature matrix §3** lists it
among the homepage sections.

**We do:** ship one working signup, in the footer slot **DEV-25** reserved in Phase 3, and define **no
`newsletter` block** for the homepage.

**Why the footer.** Structure §4's step 8 is a single item — *"Newsletter/**footer**"* — and structure
§20 lists Newsletter among the footer's five columns. `SiteFooter` has taken a `newsletter` slot since
Phase 3, with a grid that widens from three columns to four the moment it is filled. A homepage block
*and* a footer column would put two signup forms on one page, which is a duplicate surface rather than
a second route into commerce.

**Why it is built now rather than deferred again.** DEV-25's stated reason was that *"a signup field
rendered now would post nowhere. The subscriber collection is Phase 6.1n."* **Phase 6 built it**, and
`NewsletterSubscribers.ts` names this phase as the owner: *"the newsletter block is plan §10.1a … the
phase that builds the form owns the decision."* The premise expired.

Writing a row with an address, a **consent timestamp**, a source and a status is the artefact §6.1n
specifies — real, durable, defensible consent. The *sending* is Phase 19's, and nothing on the page
claims an email is coming.

**One departure from the Phase 7 precedent, and it is deliberate.** `register` writes with
`overrideAccess: false` on the principle that *"the storefront gets no privilege the REST API does not
have."* The newsletter does the opposite — `create` stays `isStaff` and the Server Action writes with
`overrideAccess: true` — because this collection has a property `customers` does not: `email` is
`unique` and `read` is `isStaff`. A publicly creatable endpoint would answer a duplicate address with
a constraint error and a fresh one with success, turning `POST /api/newsletter-subscribers` into a
**membership-enumeration oracle over personal data**. An auth collection must be publicly creatable;
this one must not.

For the same reason a duplicate submission returns the **identical success message**. **DEV-31** has
the registration form disclose a taken email, correctly — an account either exists or it does not and
the submitter is the account holder. A mailing-list membership is not the submitter's to learn about;
anyone can type anyone's address into a footer.

**An unsubscribed address is not silently re-subscribed.** The action reads before it writes and
leaves an existing row alone whatever its status, because that row exists precisely so *"a later
import cannot resurrect the address"* (§6.1n). The response is identical either way, so nothing is
disclosed by the difference.

**What is owed:** the welcome mail and the §19.1b double-opt-in question (**Phase 19** — these rows
are single opt-in, the only state the Phase 6 schema can represent), and rate limiting plus Turnstile
(**Phase 26**, §26.1a names the newsletter specifically), recorded as owed rather than improvised
here — the same words `Customers.ts` uses for registration.

***DEV-25 is discharged.*** Its *"to be confirmed in Phase 19"* clause is answered early: the slot is
filled and the grid widens as designed. What remains for Phase 19 is the mail, not the column.

*Affects Phases 3, 10, 19 and 26.*

### DEV-43 — "Editorial split" and "Brand story" are one block, not two

**Plan §10.1a lists** ten blocks *"such as"*, among them both *"Editorial split"* and *"Brand story"*.

**We do:** define one — and it is not new. Both are `splitFeature`, which `blocks/editorial.ts`
already shipped in Phase 6 for the collection and Edit pages.

**Why:** they are the same data. An image, a side, an eyebrow, a heading, a short body, a call to
action — field for field. The only thing separating them is what an editor writes in them, which is
content rather than schema. Shipping two identical block definitions so the picker could print two
names would mean two Postgres tables, two generated interfaces and two renderers to keep in step, for
a distinction the database cannot see. §A.1.6's rule against duplicate abstractions is the direct
authority; §10.1a's own *"such as"* is the licence.

The same reasoning kept three more of the ten from being new definitions: *"Shop-the-look"* is the
existing `shopTheLook`, and *"Product rail/grid"* is served by the existing curated `productGroup`
**and** a new query-driven `productRail` — because a standing section like "New arrivals" cannot be a
hand-dragged list, and a curated list cannot be a query. Five of the eleven homepage block types are
Phase 6 objects imported unchanged, which is what `blocks/editorial.ts` predicted when it wrote
*"Phase 10 may reuse any of these seven."*

Two of those seven are deliberately **not** offered on the homepage: `gallery`, because `socialGallery`
is this page's multi-image grid and two grid blocks is a choice with no answer, and `pullQuote`,
because guide §09's Home direction names image-led and typography-led sections and `editorial` is the
typography-led one.

**What this costs:** an editor choosing "Image and text" for a brand story rather than a block labelled
"Brand story". The block's own description carries the guidance instead.

*Affects Phase 10.*

### DEV-44 — The hero statement is set over the campaign photograph

**Visual guide §09 says** the home page is a *"hero-first composition"* with a *"large campaign
statement"*, and the reference image draws the statement **over** the photograph.

**We do:** render the campaign frame full-bleed, then the statement beneath it on the canvas, left
aligned. Nothing is overlaid, and there is no scrim and no gradient.

**Why, in the order the reasons decided it:**

1. **Guide §10's responsive priority list opens with *"Preserve headline hierarchy."*** An overlay is
   the first thing that breaks at 320px: the headline either drops out of its own type scale or
   covers the subject of the photograph.
2. **Guide §11 lists *"Excessive gradients"* under Avoid.** Legible type over *arbitrary* campaign
   photography needs a scrim. A crop an art director controls can carry text; a crop an editor
   uploads next season cannot be relied on to, and the design system cannot inspect an image.
3. **It removes §10.1b's *"Text too long for selected crop"* edge case by construction** rather than
   by hoping. The copy sits in a measured column on Obsidian at 17.10:1, at every one of §30.1a's
   eight widths.

**Revised twice, at the project owner's direction.** First beside the frame, then **over** it: the
picture now runs edge to edge and the statement sits on its right half above 768px, stacked beneath
it below that.

The statement is on the **right** because the supplied panorama has its subject in the left third.
Left-aligned type would have been set on the model's face, and no crop fixes that — the photograph
cannot be made to put him anywhere else. `heroWide` is 5:2 rather than 16:9 for the same reason: a
16:9 crop cuts both ends off a frame chosen for its width.

What changed is the arrangement. What did not change is any of the three reasons above, and that is
why the revision is a revision rather than a reversal:

- Below 768px the grid collapses and the frame returns above the statement, so **§10's 320px case is
  the stacked one it always was**.
- **There is now a scrim, and it is a real concession.** Guide §11 lists *"excessive gradients"* under
  Avoid, and DEV-44 spent three arguments not needing one. Bone over a bright sky is illegible
  without it. It is held to the minimum that works — 88% at the very edge rather than opaque, because
  a solid edge would undo the edge-to-edge picture it is drawn over, and gone entirely by 70% of the
  width, well clear of the subject. It renders only where the type is, and only above 768px.
- The copy is still in a measured column, so **§10.1b's *"text too long for selected crop"* remains
  impossible by construction**.

The band carries a desktop minimum height, or a campaign with a short headline reads as a strip
rather than as a hero. The breakpoint is **768px** and not `lg`, because 768 is the width
`MediaImage` already switches geometry on, so the layout and the crop change at the same place
rather than leaving a band of widths between them.

**What this costs, stated plainly.** The statement's side is now a property of one photograph rather
than of the design. An editor who uploads a frame composed the other way round has to move the type
with it, and that is a code change rather than a setting. DEV-44's second argument — that a design
system cannot inspect an image — is exactly what is being paid here.

The original ruling stands as written for what it decided — that the *written guide beats the
reference image*. It was overridden here by the owner, which is a different authority from the one
DEV-44 was weighing, and the record is kept rather than rewritten.

The reference image is directional and explicitly non-authoritative — visual guide §10 and the plan's
own visual-reference rules — and the written guide beats it, which is the same ruling **C-08** applied
to the five-item navigation that image also draws.

The result still reads as guide §01: *"high-contrast black surfaces with soft bone typography"*, and
*"oversized type with tiny metadata"* — the season label being the tiny half.

**Revisit** if art direction ever supplies campaign imagery with a reserved text area, at which point
the block would need a field saying so rather than a component guessing.

*Affects Phase 10.*

### DEV-45 — Quick View, Quick Add and the wishlist control are deferred to the phases that own their services

**Plan §11.1c says** a product card supports four interactions: click → PDP, click wishlist (*"prevent
card navigation"*), Quick View (*"→ dialog"*) and Quick Add (*"variant selection if required"*).
Feature matrix §6 details what a Quick View dialog contains.

**We do:** ship the card link, and **none of the other three**.

**Why:** every one of them needs a service that does not exist yet, and building the control without
it is the thing §0.1.17 forbids outright — *"never create fake UI for unsupported functionality."*

| Control | Needs | Phase |
|---|---|---|
| Quick Add | the cart service — a line item, a server-side price re-check, a bag | **14** |
| Wishlist heart | `wishlist-items`, guest identity and the merge on sign-in | **20** |
| Quick View | feature matrix §6's dialog is *"variants, availability, **add to cart**, **wishlist**, link to full product"* — two of its five actions are the rows above, and the fifth links to a PDP that does not exist | **13/14** |

A Quick Add button that opens nothing is worse than no button: it costs a customer a decision and
their attention before telling them nothing. A Quick View whose only working affordance is a link to a
404 is the same trade with more markup. §11.1c's own **critical edge case** — *"if a product has
multiple sizes/colors and no default purchasable variant, Quick Add must NOT guess an invalid
variant"* — is a rule about a cart write, and it belongs in the phase that performs one.

This is the shape **DEV-25** and **DEV-37** already established twice in this repository: Phase 3
deferred the newsletter field because *"a signup field rendered now would post nowhere"* and Phase 10
filled it; Phase 9 shipped the search overlay as chrome and Phase 12 fills it. The card is built so
none of the three needs it re-plumbed — `ProductCard` takes one model, and the states they read
(`state`, `isNew`, `compareAtLabel`) are already on it.

**What this costs:** a customer must open the product page to add to their bag, which is one
navigation rather than none — and today that page 404s anyway.

*Affects Phase 11. ~~Discharged by Phases 13, 14 and 20.~~* **Only the wishlist heart was discharged,
by Phase 20.** Quick Add and Quick View were never built, and **DEV-76** (Phase 36) withdraws them.

### DEV-46 — There is no rating sort, and there are five sort options rather than six

**Feature matrix §5 lists six sorts:** Featured, Newest, Best selling, Price low-high, Price high-low,
and *"Rating **where enough real review data exists**."*

**We do:** ship five. Rating is absent.

**Why:** the qualifier is the matrix's own, and it is not satisfied. Reviews are **Phase 21**; the
`reviews` collection exists but nothing writes to it, and `Products.ts` deliberately declined to cache
a review aggregate in `derived` for exactly this reason — *"a column that no phase yet writes is a
column that quietly reads zero on every product card in the meantime."*

A rating sort today would order every product by the same absent number. That is not a limited sort,
it is a control that does nothing — and plan §11.1e's instruction is to *"keep sort options
intentionally limited"*, which argues for the same answer from the other direction.

**`best-sellers` is shipped, and it is worth being precise about what it means**, because its name
promises more than the data holds. There is no order history until **Phase 18**, so it orders by the
`isBestSeller` merchandising flag — the merchandiser's own declaration of what sells — and then by
curated order. That is a real, editorially owned answer rather than a fabricated metric, and it is
recorded here so nobody later reads the label as measured.

**Revisit** in Phase 21 (rating) and Phase 18 (a measured best-selling sort). Both are one entry in
`CATALOG_SORTS`, one line in `CATALOG_SORT_FIELDS` and one replica.

*Affects Phase 11.*

### DEV-47 — Phase 11 builds the search index, which plan §12 owns

**The plan puts Algolia in Phase 12.** Plan §11.1d nonetheless requires it in Phase 11: *"use Algolia
as the query/facet engine after the catalog is seeded."*

**We do:** build the minimum index a **facet** needs in Phase 11 — the record shape, the filterable
attributes, the four sort replicas, a full rebuild (`pnpm reindex`) and synchronisation on write — and
leave everything *searching* means to Phase 12.

**Why it cannot be deferred:** three of feature matrix §5's six facets are not columns on `products`.
`size` and `colorFamily` live on `product-variants`, and collection membership lives on `collections`
— both reached through Payload `join` fields, which are virtual and have no column. There is no
Postgres query for *"products with an active Black variant in M"* that is not a walk of the variant
table, and §11.1d forbids that by name.

**Why it is not simply "Phase 12 early":** the phase boundary moves to where the work actually
divides. Phase 12 keeps §12.1c's overlay, autocomplete, category and collection suggestions, recent
and popular searches, the full results page, and every one of §12.1d's *query* edge cases — none of
which this phase touches. What moved is the derived store those features will read.

Searchable attributes are **declared** in the index settings and never queried here, which is
deliberate: an index whose records lack them cannot be made searchable later without a full rebuild.

`env.core.ts`'s `algolia` integration group moves from `phase: 12` to `phase: 11`, and
`docs/ENVIRONMENT.md` with it.

*Affects Phases 11 and 12.*

### DEV-48 — A product withdrawn from sale is not listed, though the card can render it

**Plan §11.1b lists nine card states**, the eighth being *"out-of-season/inactive"*.

**We do:** implement the state on the card and **exclude those products from every listing**.

**Why:** `derived.priceFromMinor` is `null` exactly when a product has no active variant — every
colour and size switched off, which is `ProductVariants.ts`'s *"merchandising switch"* thrown for all
of them. That is a product **withdrawn from sale**, not one temporarily out of stock, and a shop grid
is a merchandising surface: listing it is *"a dead end dressed as an offer"*, which is the judgement
`resolveProductTile` already reached on the homepage in Phase 10.

**Sold out is a different answer and is listed**, with its badge — a customer looking at a sold-out
garment is looking at something the shop intends to sell again.

The state is not dead code. Phase 20's wishlist, Phase 23's curated collections and any
recently-viewed rail link to a *specific* product regardless of whether a listing would have offered
it, and those surfaces must be able to say "not available" rather than render a card with no price and
no explanation.

**A second benefit, and it is not incidental.** The same clause removes the only `null` that could
reach a price sort. Drizzle emits a bare `ORDER BY x DESC` — verified in
`@payloadcms/drizzle/dist/queries/buildOrderBy.js`, which has no nulls-ordering control — and Postgres
sorts `NULL` **first** under `DESC`, so without it every withdrawn product would head the "Price: high
to low" grid, priceless, above the most expensive garment in the shop.

*Affects Phase 11.*

---

### DEV-49 — Dependent facet counts are deferred, though §1.16.10 assigned them to this phase

**Notes §1.16.10 says:** *"narrowing the vocabulary to the current filter context is a different
feature, and it belongs to Phase 12, which is where Algolia is already computing facet
distributions."*

**We do:** ship independent facets, unchanged from Phase 11, and record the reason here.

**Why:** the premise is false in this architecture. **D-36** chooses the engine *per query*, so most
query shapes never reach Algolia at all and have no facet distribution to read. Counts that appeared
under `?color=black` and vanished under `?category=hoodies` would be a control whose meaning depends
on an implementation detail — and structure §1 lists exactly that among what a customer should never
need to understand.

Making them consistent means routing every query to Algolia, which abandons D-36 and forfeits the
guarantee that an outage cannot take the shop down. That trade is not worth a count.

§1.16.10's two clauses are treated differently, as its own wording invites: facet **counts** are
permissive (*"can widen"*) and are simply not taken; **dependent facets** are assignive
(*"belongs to"*) and get this deviation.

---

### DEV-50 — No SEO metadata on `/search`

**Plan §24 owns SEO.** `/search` ships with no `metadata` export, no canonical link and no `noindex`.

**Why:** the same deferral Phase 10 and Phase 11 recorded for `/` and `/shop`. Phase 24 also owns a
question this phase should not answer alone — whether a search results page should be indexable at
all.

What this phase hands Phase 24 is **one** crawlable search namespace rather than two: `/shop?q=`
redirects to `/search?q=`, composed into the canonical redirect so no URL redirects twice.

**Discharged:** `/search` now exports `privateMetadata('Search')` (`robots: noindex, nofollow`), so
results pages are not indexed.

---

### DEV-51 — No rate limiting on the search path

**Plan §26.1a** owns bot protection, and its Turnstile surface list does not name search.

**We do:** ship `/search/suggest` as an unauthenticated, uncapped GET endpoint.

**Why:** phase order, and the same honest position `newsletter/actions.ts` records for its own open
write path. The two-character floor, the 200 ms debounce, the six-hit cap and the 256-byte clamp are
§12.1d edge-case handling and cost control. They are **not** security controls and the route handler's
docblock says so explicitly, because describing a cost control as a security control is how a later
phase comes to believe a surface is already protected.

---

### DEV-52 — No analytics events

**Plan §25.1a** owns `search_submitted` and the Insights API.

**We do:** emit no events. `indexSearchParams` sets `analytics: false` on a browse query and `true` on
a text query, and `clickAnalytics` is deliberately not set.

**Why:** phase order — Phase 11 set the precedent by shipping filters and sorts without
`filter_applied` or `sort_changed`. The `analytics` flag is **diagnostic hygiene rather than event
emission**: without it every faceted `/shop` request is recorded as a customer searching for the empty
string, which is measurably what had already happened (`{search: '', count: 18}`, eighteen times the
next entry). Stopping a metric from lying is not the same as collecting one.

**Discharged in Phase 25:** `search_submitted` is emitted from `components/shell/search-panel.tsx` on
the normalised term.

---

### DEV-53 — Long-form size words do not match, and no synonym map ships

**Plan §12.1a lists Size as searchable**, unhedged.

**We do:** deliver it through `searchTerms` — `XL`, `32`, `M` and `ONE SIZE` all match — and accept
that `medium` does not match `M`.

**Why:** an Algolia synonym expands the query **token globally**, so `medium` → `M` would prefix-match
Merino, Moss and Melton inside `name`, the highest-ranked attribute, under the live
`queryType: 'prefixLast'`. It would also be a sixth piece of index state with no owner, no rebuild path
and no harness coverage.

The seeded sizes are `XS, S, M, L, XL, 30, 32, 34, 36, ONE SIZE`; three quarters of those are literally
what a customer types. Structure §12 puts the size **filter** after the results page anyway, which is
where a customer who means "medium" is served.

---

### DEV-54 — `SearchOverlay` lost its `items` prop, and `DEV-37` is closed with an amendment

**DEV-37 said** Phase 12 *"replaces the body of `SearchPanel` and nothing else."*

**We do:** replace the body, and also remove the `items` prop from `SearchOverlay` and add
`titleHidden` to its `DialogContent`.

**Why:** the panel fetches on open rather than receiving navigation as props, which is what keeps the
component's signature unchanged — and the signature matters more than it looks, because
`SearchOverlay` is mounted **twice**: in the frontend layout and again in `global-not-found.tsx`,
which renders its own `<html>` outside the route group. Any new prop would have to be supplied in both
or the 404 page's panel would silently lose a section. Removing a prop is the change that makes *no
future prop* necessary.

`titleHidden` is chrome rather than body — the input sits at the top of the panel and a visible
"Search" heading above a search field is a label repeated twice. Recorded here rather than claimed as
"DEV-37 honoured to the letter".

---

### DEV-55 — The product page ships without its purchase controls

**Structure §7 and plan §13.1b** put Quantity, Add to Bag, Buy Now, Wishlist and a rating on this page.

**We do:** ship the gallery, the identity, the price, an authoritative variant selector, live stock
messaging, the size guide, the five detail accordions and recommendations — and, in place of the
purchase controls, **one sentence**: *"Online ordering opens shortly. Everything here — colours, sizes
and live stock — is the real catalogue."*

**Why:** phase order, and §0.1.17. The cart is **Phase 14**, checkout is **Phase 17**, the wishlist is
**Phase 20** and reviews are **Phase 21**; §13.1d's own add-to-cart revalidation rules describe a
server action that has nothing to write to yet. A button that looks like it adds to a bag and does not
is exactly what §0.1.17 forbids, and on this page it is a worse lie than a missing button, because the
customer only discovers it after making a purchase decision.

A **disabled** button would not fix that — a greyed-out *Add to Bag* reads as a broken shop rather than
an unfinished one, and the rule is about not implying the capability at all. Quantity is omitted for a
second reason: its only consumer is Add to Bag, so shipping it alone would be a stepper that changes a
number nothing reads.

§13.1f is the one place the plan agrees in advance: *"do not show an empty star histogram."* A
catalogue with no reviews is that state, so the rating, the count, the distribution and the entries all
wait for Phase 21 together.

`buildVariantMatrix` already resolves and exposes the exact variant id, price and stock a cart line
needs, so Phase 14 adds controls beneath the selector rather than rebuilding the page.

**Amended in Phase 36:** Quantity, Add to Bag, the wishlist and reviews were discharged by Phases 14,
20 and 21. **Buy Now never was, and DEV-78 withdraws it.**

---

### DEV-56 — The variant selector moves focus with the arrows but commits only on Space or Enter

**ARIA 1.2's radio group pattern** selects on arrow: focus and selection travel together, and
`aria-checked` follows focus.

**We do:** move focus with the arrow keys, Home and End, and commit the selection only on Space or
Enter. `aria-checked` tracks the **selection**, never the focus. The gallery thumbnails keep
selection-follows-focus.

**Why:** the selection is a URL parameter written with `shallow: false`, so every commit is a server
round-trip that re-resolves the variant, the price, the stock message and the disabled set. Arrowing
across six sizes to reach the seventh would fire six navigations and leave the customer looking at
whichever one landed last — which is not a slower version of the right behaviour, it is the wrong
answer on screen. ARIA describes exactly this as the manual-activation variant, for controls whose
selection has a real cost.

The thumbnails do not need it: changing which photograph is showing is client state and costs nothing,
so they follow the pattern as written.

Unavailable sizes are **visited** by the arrow keys rather than skipped, which is the point of
`aria-disabled` over `disabled` — the customer meets XS and hears that it is sold out in this colour
rather than never meeting it.

---

### DEV-57 — The bag ships without a Checkout control

**Plan §14.1e** lists *"Checkout CTA"* among the drawer's contents, and a bag page without one is not a
bag page a customer can finish with.

**We do:** pin **View bag** in the drawer, going to `/cart` — a page this phase builds — and put a
sentence where the checkout button belongs: *"Checkout opens shortly. Everything here — prices, sizes
and stock — is live, and your bag will still be here."*

**Why:** checkout is **Phase 17**, and `/checkout` does not exist. A control labelled *Checkout* that
404s is worse than a missing one, because the customer only learns after deciding to buy — which is the
same argument **DEV-55** made about Add to Bag one phase ago, and the reason that button is now real.

A **disabled** Checkout button was considered and rejected for the identical reason DEV-55 gives: a
greyed-out control reads as a broken shop rather than an unfinished one, and §0.1.17's rule is about not
implying the capability at all.

The bag itself is complete, which is what makes the omission legible: every line, every quantity
control, the live subtotal and the shipping-progress message are real. Phase 17 adds one button to a
page that already knows what it is selling.

---

### DEV-58 — Discount, shipping and tax are `null` rather than zero, and their rows are not drawn

**Plan §14.1d** asks the server to calculate *"subtotal, discount, shipping estimate, tax estimate where
appropriate, total"*.

**We do:** compute the subtotal, and return `null` for discount, shipping and tax. The summary renders
no row for a `null`, labels the figure **Subtotal** rather than **Total**, and says *"Delivery and any
taxes are calculated at checkout."*

**Why:** promotions are **Phase 15** and shipping and tax are **Phase 16**, so this phase cannot produce
those three numbers truthfully. `0` is not a truthful stand-in — it is a *claim*, and a customer has no
way to distinguish a computed zero from a placeholder. A bag that says *Shipping $0.00* and then charges
for delivery at checkout has misled someone in the most expensive possible place.

`null` also does the phase boundary a service the plan does not require but the code benefits from:
`CartTotals.isFinal` is false while any component is unknown, and the summary switches to a real
**Total** the moment Phases 15 and 16 assign those fields — **without the component being edited**. The
deferral is expressed in the type rather than in commented-out markup.

The one estimate that *is* rendered is the free-shipping progress message, and it is legitimate: it
compares the subtotal against `site-settings.freeShippingThresholdMinor`, which is an editor's number
rather than a rate for a destination. §14.1e asks for it by name.

---

### DEV-59 — A per-customer limit cannot be enforced against a guest

**Plan §15.1a** lists *"per-customer limit not exceeded"* among the checks, without qualification.

**We do:** enforce it for a signed-in customer, by counting their paid orders carrying the code, and
**count zero for a guest**.

**Why:** the count comes from `orders.promotion`, which is what `Promotions.ts` specifies precisely so
that a refund cannot leave a stored tally wrong. A guest has no customer id, so there is nothing to
count against — and the alternatives are worse than the gap. Counting by email would key a limit on a
field the customer types, so two spellings are two allowances. Counting by cart token would key it on
a cookie, which is cleared. Both would *look* like enforcement while a single private window defeated
them, which is the failure mode plan §0.1.17 is about.

The `usageLimit` total is unaffected and does bind on guests, so a code with a global cap is still
capped. A merchandiser who needs a per-customer limit to mean something should pair it with an
account requirement, which is a decision for whoever writes the campaign rather than for this code.

**Amended in Phase 36 (R1-07).** The per-customer count now includes `pending_payment` orders other
than the one on the customer's active bag, so parallel checkouts count against the limit. `usageLimit`
binds at payment: the `times_used` increment carries `usage_limit IS NULL OR times_used < usage_limit`.
When it matches nothing the payment still stands — the money has moved at the discounted price — and
the over-redemption is logged and reported to Sentry. Guests still count as zero.

---

### DEV-60 — A free-shipping code is validated and recorded, and does not yet change a price

**Plan §15.1b** asks the calculation to return a discount amount, and `Promotions.type` offers
`free_shipping` as one of three kinds.

**We do:** validate a free-shipping code against all eight of §15.1a's checks, store it on the cart,
show it in the bag by name, and carry its effect in a `freeShipping` boolean rather than an amount.
The bag says *"Applies to delivery, which is calculated at checkout."*

**Why:** shipping is **Phase 16**. There is no rate for the code to zero. Returning a discount amount
of `0` and drawing a `-$0.00` row beside *Free delivery* would read as a code that did nothing —
which is the shape of fake UI that is hardest to spot, because the number is real and only its
meaning is wrong. So no Discount row is drawn for this type at all, and a sentence carries the
promise instead.

A code with an *amount* of zero still draws its row, because that is genuinely surprising and the
customer should see it. The distinction is deliberate: `null` means *this kind of code has no amount*
and `0` means *this code is worth nothing today*.

Phase 16 turns the boolean into a rate of zero. Nothing in this phase has to change for that to work,
which is the same property Phase 14's deferred totals were built with and Phase 14's second sweep
tested.

---

### DEV-61 — The tax provider is a boundary with a deferral behind it, not Stripe Tax

**Plan §16.1c says** Stripe Tax *"may be the initial provider"*, and the phase prompt says to *"use
Stripe Tax as the initial tax provider"*.

**We do:** ship the `TaxProvider` interface exactly as §16.1c specifies it — five inputs, three
outputs, no provider vocabulary anywhere in the shape — and implement it with a provider that returns
`pending_address` and calculates nothing.

**Why:** two reasons, both phase order rather than preference.

The Stripe SDK, its secret key and its webhook signature belong to **Phase 17**, and `AGENTS.md` is
explicit: *"Do not build a later phase's feature early, and do not install its dependencies early."*
Installing `stripe` here to compute a number that nothing charges would be exactly that, and would put
a live-key guard, a webhook route and a secret in the environment a phase before anything verifies
them.

And there is nothing to calculate. Tax is a function of a destination; no surface in this application
collects one, because the address form is checkout's. Every request this provider can currently
receive has `address: null`, and the honest answer to *"what tax is owed to an unknown place"* is not
a number.

**What makes this a boundary rather than a stub** is that the deferral is visible in the type. The
result is `{ amountMinor: null, status: 'pending_address', providerRef: null }`, and `amountMinor` is
**never** `0` for a state that means *unknown* — a zero is a claim that no tax is owed, and a checkout
acting on one would undercharge every order in a taxable jurisdiction. The four statuses are distinct
precisely so Phase 17 can tell *"no tax applies here"* from *"the tax service is down"*, because one
of those may proceed to payment and the other may not.

The provider also refuses to guess if it is handed an address, answering `unavailable` rather than
inventing a figure. A deferral that quietly began guessing once its inputs improved would be more
dangerous than one that never worked, because nobody would be watching it.

Phase 17 replaces one exported constant. Nothing that reads a `TaxResult` changes.

**Closed in Phase 36 (R1-02).** `taxProvider` is Stripe Tax whenever Stripe is configured, and the
deferral otherwise. `stripe.tax.calculations.create` receives one exclusive line (the discounted
goods), `shipping_cost`, and the shipping address; `tax_amount_exclusive` becomes the amount and the
calculation id the reference; zero is `not_required`; an error or a 5-second timeout is `unavailable`,
which preflight refuses. Checkout's `automatic_tax` is deliberately not used, so the order's total
stays the one we computed (DEV-63). An account with no registrations returns zero tax — TODO.md §4.

---

### DEV-62 — Checkout is complete and has never taken a payment

**The phase prompt says:** *"Implement production-style Stripe Checkout integration in test mode."*

**We do:** implement all of it — preflight, session creation, the signature-verified webhook, both
idempotency barriers, the transactional inventory decrement, every redirect case — and run it against
an environment with **no Stripe keys**, where the checkout page says so and declines rather than
failing.

**Why:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and the publishable key are absent from this
repository's environment, and `AGENTS.md` forbids committing them: *"Never commit secrets."* An
operator supplies them; a build cannot invent them.

**What that does and does not leave unverified.** Less than it sounds:

- **Signature verification is verified**, offline and for real. `verify-checkout.ts` section F uses the
  SDK's own `generateTestHeaderString` to sign a payload against a fabricated secret, verifies it,
  then tampers with the payload and watches it fail, then tries the right payload under the wrong
  secret and watches that fail too. Verification is an HMAC over exact bytes; a payload that verifies
  there verifies in production.
- **Everything downstream of the signature is verified** against the real database, by driving
  `applyStripeEvent` exactly as the route drives it: 24 checks covering both barriers, the
  transaction, the inventory race, the paid-but-unfulfilled path and six of §17.1h's failure states.
- **What is not verified** is one HTTP call: `stripe.checkout.sessions.create`. Its inputs are
  asserted, its failure path returns a refusal rather than a crash, and the redirect it produces is
  Stripe's own — but no real session has been created, and no live payment has moved.

**The degraded state is a decision, not a fallback.** `docs/ARCHITECTURE.md` §2 requires the store to
work when an integration is missing, and `isStripeConfigured()` is what the checkout page asks. It
renders the bag, the totals and a sentence — *"Payment is not connected yet"* — rather than a form
whose only possible outcome is a refusal at the last step. The same shape as **DEV-55** and **DEV-57**
before it: say what is true, do not draw a control that cannot work.

The webhook route answers **503** rather than 200 when unconfigured, which is the one place the
degradation must not be quiet: a silent 200 would make Stripe discard real payment events during a
misconfiguration.

**Amended in Phase 36 — the webhook verifies the session, not only the order reference.** Paying
requires the order's *current* session id, total and currency (R1-01); a mismatch is recorded, reported,
answered 200 and never applied. `completed` is decided by `payment_status`: `unpaid` waits at
`pending_payment`, `no_payment_required` is a mismatch (R1-05). `payment_intent.payment_failed` is
recorded only — a declined card inside Checkout leaves the session payable. Only a unique violation is a
duplicate event; failed rows, and `received` rows older than 60 seconds, are reclaimed atomically and
reprocessed, and fresh ones are answered 409 (R1-04). Preflight reuses `pending_payment` orders, never
`cancelled` ones, expires the previous session first and refuses if it was paid; sessions expire after
31 minutes and are claimed conditionally. Partial refunds keep the order `paid` with a monotonic
`refundedMinor` (R1-09). A stock shortfall rolls back to a savepoint, takes no stock, sets
`fulfilmentHold = stockShortfall`, and still converts the bag and counts the code (R1-10, R3-19).

---

### DEV-63 — The Checkout Session is one line item, not one per product

**Plan §17.1b** says to use trusted server-derived values and says nothing about line-item shape;
Stripe's own conventions favour a line per product, and it renders more attractively on their page.

**We do:** send **one** line item, named for the item count and priced at the order's own
`totalMinor`.

**Why:** a line per product makes Stripe a **second place the total is computed**. Stripe sums its
line items to charge; we compute the order total from subtotal, discount, shipping and tax. Those two
answers agree until they do not — a percentage discount that rounds, a delivery charge allocated
across lines, a tax that applies to some lines and not others — and on the day they disagree the
customer is charged **Stripe's** number while the order records **ours**.

One line item priced at the server's total makes that disagreement impossible to express. There is one
number, computed once, in the place that owns it.

The itemisation a customer needs is not lost: it is on the bag, on the checkout page beside the form,
and on the confirmation — all three rendered from `order-items`, which is the record. Stripe's page is
where a card number is typed, and it shows the amount being charged, which is the number that matters
there.

The cost is real and worth naming: Stripe's dashboard shows one line rather than an itemised order, so
reconciling a dispute means opening the order in the admin panel. That is an operator's inconvenience
rather than a customer's risk, and it buys the guarantee that the shop and the processor can never
quote two different prices.

---

### DEV-64 — §18.1c's shipment email is a seam in Phase 18 and an email in Phase 19

**Plan §18.1c says:** when marking shipped — *"Require tracking where appropriate. Store carrier.
Store tracking number. **Trigger shipment email.**"*

**We do:** the first three, and leave the fourth as the transition it hangs off.

**Why:** §19.1a builds the email service, and §19.1b the shipped template. Phase 18 cannot trigger an
email that does not exist, and the project's own rule is *"do not build a later phase's feature early,
and do not install its dependencies early."* Resend is a Phase 19 dependency.

What Phase 18 owes Phase 19 is the **point** to hang it on, and that is now a single, guarded,
server-side transition into `shipped` — one place, reachable only when a carrier and tracking number
are present, which is exactly what a dispatch notice needs to say. §19.1c's *"a webhook retry must not
send two confirmation emails"* has the same shape as the transition guard already built here: the
email follows a state change that can only happen once.

*Affects Phases 18 and 19.* **Discharged in Phase 19** — `hooks/queueOrderEmails.ts` hangs the
shipment notice on exactly that transition, and it queues rather than sends, because the hook runs
inside the transaction. See §1.24.3.

---

### DEV-65 — Eight templates, not the features document's ten

**Plan §19.1b says:** Welcome, Verification, Password reset, Order confirmation, Order shipped, Order
delivered, Refund, Contact confirmation. **Eight.**

**Features document §24 says:** the same eight plus *"Order cancelled"* and *"Optional
back-in-stock"*. **Ten.**

**We do:** the plan's eight.

**Why:** `AGENTS.md` ranks the plan above the features matrix, and the two extras are weaker than they
look. *Back-in-stock* is marked optional in its own source and needs a subscription surface nothing has
built. *Order cancelled* is the more interesting one: this shop cancels an order in two places, and
neither wants a mail. A Stripe `checkout.session.expired` cancels an order the customer never paid
for and usually never knew existed — a message about it would be the first they hear of a purchase
they did not make. A staff cancellation before dispatch is a refund conversation, and the refund
message already covers the half where money moved.

The template set is exhaustively keyed off `EMAIL_KINDS`, so adding either later is a type error until
its template exists rather than a silent gap.

*Resolves the §19.1b / §24 conflict. Affects Phase 19.*

---

### DEV-66 — Two of the eight templates are written and unwired

**Plan §19.1b requires** a Verification template and a Contact confirmation template.

**We do:** write both, render both, test both — and wire neither, because neither has a caller.

**Why:** `Customers.auth.verify` is deliberately off, recorded in Phase 7: turning it on would make
every registration depend on a message being delivered, and it interacts with `register()` signing the
customer straight in. That decision is unchanged and is not Phase 19's to reverse. The contact form
does not exist at all — `/contact` and the help routes are gap **G-08**, assigned to **Phase 23**.

The alternative was to skip them, and it is worse. A template is a pure function of its data, so both
are exercised by `pnpm verify:email` exactly as the wired six are; what is missing is a sender, which
is one call each. The day verification is switched on should not also be the day somebody writes that
email in a hurry.

This is deliberately *not* a violation of §0.1.17's rule against building UI that looks functional and
does nothing: nothing user-facing was added. There is no verification prompt, no contact form and no
control anywhere that implies either exists.

*Affects Phases 19, 21 and 23. To be discharged when verification is enabled and when Phase 23 builds
the contact form.*

---

### DEV-67 — Nothing drains the email queue on a schedule

**Plan §19.1d says:** *"Allow retry where appropriate."*

**We do:** three deliberate drains and no scheduled one — the Stripe webhook drains a bounded five
messages opportunistically, `pnpm email:drain` clears a backlog from a shell, and a
staff-authenticated `POST /api/email/drain` does it from a deployed environment where there is no
shell.

**Why, and what it costs.** Most messages never touch the queue's slow path: the confirmation, the
refund and the welcome are all delivered by the request that queued them. Only two cannot be — the
shipped and delivered notices, which are queued *inside* a transaction because Payload 3 offers no
post-commit collection hook, and anything that has already failed.

So the cost is bounded and specific: **on a shop with no payment traffic, a dispatch notice can sit
until somebody drains it.** On a busy one the webhook covers it within minutes.

A scheduled drain is a cron entry, not application code, and it belongs with the rest of the
deployment surface rather than being half-built here. The alternative considered and rejected was a
`CRON_SECRET`-style bearer token on the drain route: a new secret to leak, rotate and document, when
the audience that should be allowed to press it is exactly the staff who can already read
`email-messages`.

*Affects Phase 19 and the deployment phase. To be discharged by a scheduled call to the drain route.*


---

### DEV-68 — The guest wishlist merges from the client, not from `login()`

**Plan §20.1a says:** *"Guests: optional local wishlist. On login, merge into customer wishlist."*

**We do:** exactly that, and the merge is initiated by a client component after the session exists,
rather than by the sign-in action the way the cart's merge is.

**Why:** the two are not the same problem. A guest **cart** is a database row named by a cookie, so
`mergeGuestCart` runs inside `login()` on the server and the browser is never involved. A guest
**wishlist** is `localStorage`, because `WishlistItems` decided in Phase 6 that *"there is no guest
wishlist table"* — and no server action can read a browser's storage. The merge therefore has to be
offered by the only party that can see the list.

`WishlistSync` is mounted in the storefront shell, renders nothing, and does nothing until a session
exists and the device has entries.

**What this costs, and how it is contained.** The merge input is untrusted in a way the cart's is not,
so:

- The action has **no parameter for whose list it is**. It writes rows owned by the session's own
  customer or it writes nothing.
- Every id is checked against the published catalogue before anything is written, so a hostile list of
  ten thousand integers writes nothing and costs one query.
- The list is capped on the way in, so the work is bounded whatever arrives.

The worst a forged call can achieve is adding a product to *the caller's own* wishlist — which is what
the button next to it does anyway.

The device copy is cleared **only on success**, so a failed merge is retried on the next navigation
rather than losing a list the customer chose to keep.

*Affects Phase 20. Follows from Phase 6's no-guest-table decision rather than departing from it.*


---

### DEV-69 — A purchase is a badge, not a gate, and the bar is *paid*

**Plan §21.1a says:** *"Only authenticated customers should submit reviews unless a deliberately
designed verified-review workflow is implemented."* Then: *"**If** verified purchase is required:
match customer to a **paid** order containing the product."* The §21 prompt repeats the hedge —
*"**optional** verified-purchase checks."*

**Feature matrix §9 says:** *"review for non-owned product"* and *"order not delivered yet"* are abuse
cases — which only means something if ownership is a gate and delivery is the bar.

**We do:** authentication is the only gate. A purchase is looked up, stored on the row, and shown as
§13.1f's *"verified indicator"*. The lookup takes any order that is no longer awaiting payment.

**Why:** `AGENTS.md` ranks the plan above the features matrix, and the plan hedges twice in the same
section rather than once in passing. There is also a design argument the precedence rule does not need
to make: a shop that only accepts reviews from buyers has no reviews on a new product, which is
exactly when a customer most wants one — and the badge already carries the distinction that matters,
visibly, on each review.

A **refunded** order still verifies. The customer bought it and had it; a return is often the most
informed review there is.

*Resolves the §21.1a / matrix §9 conflict. Affects Phase 21.*

---

### DEV-70 — Profanity and spam are handled by moderation, not by a filter

**Plan §21.1c lists:** *"Profanity/spam."* **Feature matrix §9 lists:** *"Profanity/abuse
moderation."*

**We do:** nothing automated. Every review lands `pending` and a person approves it.

**Why:** neither document specifies a mechanism, a word list or a service; no phase is assigned one;
and nothing in `01_NORTH01_Tech_Stack` does it. Inventing one would be unspecified ground.

It would also be worse than the alternative rather than better. A word list publishes what it misses
and rejects what it misreads — a customer writing about a *"bloody awful zip"* is describing the
product, and a filter that rejects them has removed a true review and told them nothing. Since every
review is already read by a person before it is public, the filter would add false negatives and false
positives to a process that has neither.

*Affects Phase 21. Revisit if review volume makes human moderation impractical.*

---

### DEV-71 — Review photos are specified, built into the schema, and cannot be wired

**Plan §6.1j lists** *"Photos"* on the review model. **§13.1f asks for** *"photo reviews where
available."* The `photos` array exists on `Reviews` with `maxRows: 4`, answering §21.1c's *"huge image
upload"*.

**We do:** not wire it. There is no upload control on the review form.

**Why, and it is not effort.** `media.create` is staff-only, and **D-28** records the property that
makes this unfixable at this layer: **media bytes are public the moment they are uploaded.** A
customer-submitted review photo would be publicly fetchable at its Cloudinary URL *before any person
had seen it* — which is §21.1b's *"only approved reviews appear publicly"* defeated by the one field
that does not go through the review's own status.

Nothing in the corpus specifies a private-by-default upload path, and building one is a Cloudinary
delivery-and-access design question rather than a wiring task: it needs signed URLs or a private
folder, a promotion step on approval, and a decision about what happens to the bytes of a rejected
review.

The column stays. When the upload path exists, the form gains a control and nothing else changes.

*Affects Phases 8 and 21. To be discharged when a private upload path is designed.*


---

### DEV-72 — The hotspot trigger stays an anchor

**Plan §22.1c says:** *"Click hotspot: open product preview… allow add to bag. Allow full PDP
navigation."*

**We do:** wrap Phase 10's existing product link in `Popover.Trigger asChild` and prevent its default,
rather than replacing it with a button.

**Why:** the obvious implementation satisfies three of §22.1c's four clauses and breaks the fourth. A
button that opens a preview has no PDP navigation of its own — the preview must then carry it, which
it does, but the *marker* has stopped being a link at all.

It also breaks something §22.1c never mentions, because it had no reason to. Phase 10's marker works
with no JavaScript: it is an anchor with a real accessible name, and the whole look is operable and
readable before a single byte of the bundle arrives. A button is inert until hydration.

Keeping the anchor gives both. With JavaScript the click is prevented and the preview opens; without
it the anchor navigates. That is the same reasoning that makes `AddToBag` a real `<form>` with hidden
inputs rather than a click handler, and the same reasoning that made the guest wishlist heart
*not* a form in Phase 20 — the question each time is what the control does when the script does not
run, and the answer has to be something rather than nothing.

**The cost, named:** an anchor carrying `aria-haspopup="dialog"` is unusual, and a customer using a
screen reader is told it opens a dialog while the element is semantically a link. The alternative was
a control that does nothing without JavaScript, which is worse — and the link's destination *is* what
the popover offers, so the announcement is not a lie about where it goes.

*Affects Phases 10 and 22.*

---

### DEV-73 — `add_payment_info` is in the taxonomy and is never emitted

**Plan §25.1a lists** `add_payment_info` among the events, hedged *"where applicable"*.

**We do:** keep it in the event union in `lib/analytics/events.ts` and emit it nowhere.

**Why:** it is not applicable here. Stripe Checkout is **hosted** (§17, **DEV-06**), so this
application never sees a card, a wallet or a payment-method choice, and no moment exists at which
payment information is added. Firing it at the redirect would report the customer *leaving* for
Stripe as entering their details, which is a different event and often a different outcome. Notes
§1.30.7.

*Affects Phase 25.*

---

### DEV-74 — `quick_view_opened` is in the taxonomy and is never emitted

**Plan §25.1a lists** `quick_view_opened`.

**We do:** keep it in the event union and emit it nowhere.

**Why:** there is no quick view. `product-tile.tsx`'s docblock mentions §11.1c's quick view, quick
add and wishlist, and only the wishlist was built. The event stays because §25.1a lists it and the
taxonomy is the deliverable. **DEV-76** later withdrew the feature, so this one is permanent unless a
quick view is built. Notes §1.30.7. E2E flow 4 (*"quick view → add to cart"*) is skipped for the same
reason (§1.32).

*Affects Phase 25.*

---

### DEV-75 — Turnstile is skipped when unconfigured and refuses when Cloudflare is down

**Plan §26.1a says:** *"Server must verify Turnstile response. Client-side widget alone is not
security."* It does not say what happens when verification is impossible.

**We do:** two opposite answers for two situations that look alike.

- **Unconfigured** (no site key or no secret, and a partial configuration counts as none): the
  widget is not rendered and nothing is verified. Failing closed with no keys would leave an
  unconfigured deployment where nobody can register. That is broken, not safer, and it is the trade
  **DEV-62** already made for checkout.
- **An outage** (Cloudflare unreachable, a 5xx, a timeout): the request is **refused**. It is the only
  control in the project that fails closed. If it degraded, the forms an attacker is hammering would
  have no bot protection, and an attacker can cause the outage they benefit from.

**The cost, named:** while Cloudflare is unreachable, the guarded forms (newsletter, review,
registration, login) accept nothing. `verifyTurnstile` reads the configured state itself, so no call
site or client field can turn a required check into a skipped one. Notes §1.31.5.

*Affects Phase 26.*

---

### DEV-76 — Quick View and Quick Add are withdrawn

**Plan §11.1c, feature matrix §6 and structure §6** give the product card Quick View (a dialog) and
Quick Add (variant selection where required). Plan §27.1c flow 4 and §36.1b flow 2 exercise them.

**We do:** a product card (`components/catalog/product-card.tsx`) is a link to the product page plus
the wishlist heart (`WishlistButton`). A customer adds to the bag on the product page, where Add to
Bag is a real form re-checked on the server that opens the bag drawer when the server accepts the
line.

**Why:** **DEV-45** deferred both controls to the phases that own their services (13 and 14). Those
phases shipped the product page and the cart, and no later phase picked up the card controls. Until
now nothing recorded the decision not to build them, so they stayed an open deferral that DEV-45's
closing line wrongly called discharged. This entry makes the decision explicit. The product page
already enforces §11.1c's critical edge case (*"Quick Add must NOT guess an invalid variant"*),
because its selector and `addToBagAction` are the only path that writes a line.

**What this costs:** one navigation before adding, which is the cost DEV-45 named. Plan §27.1c flow 4
is skipped in the E2E suite (notes §1.32) and `quick_view_opened` is never emitted (**DEV-74**).

*Amends DEV-45. Affects Phases 11, 14 and 27.*

---

### DEV-77 — There is no public order-tracking lookup

**Structure §2 and §18** list ORDER TRACKING as a global destination (*"Track Order → Order number /
permitted lookup → Status → Shipment/tracking"*). Feature matrix §23 specifies order tracking.

**We do:**

- A **signed-in customer** sees status, carrier and tracking number (linked to `trackingUrl` when one
  is stored) on `/account/orders/[order]`.
- **Any customer, guest or not,** gets the tracking number and a *"Track this parcel"* link in the
  OrderShipped email, which §18.1c's shipped transition queues.
- A **guest** can read the confirmation page only in the browser session that placed the order
  (`lib/checkout/confirmation.ts`).
- No route answers an order number and email, and nothing links to one. The footer's Order Tracking
  link was removed in Phase 28 rather than left as a 404 (notes §1.33).

**Why:** no phase was assigned the public lookup. Phase 18 built the fields and Phase 20 the account
view. A guest lookup is not a page with a form. It needs an enumeration-safe identifier check,
Turnstile, a rate limit and one uniform not-found response, and none of that was built.

**What this costs:** a guest who has lost the shipped email has no self-service way to see where the
parcel is. That email depends on Resend, which is unconfigured today (TODO.md). **Owed:**
`/order-tracking` (order number plus email, Turnstile, rate-limited, identical not-found, showing
status and tracking but never the address or payment), linked from the footer Help column, the
confirmation page and the shipped email. Audit DOC-05.

*Affects Phases 18, 20 and 28.*

---

### DEV-78 — Buy Now is withdrawn

**Structure §7, plan §13.1b and feature matrix §7** put a Buy Now control on the product page.

**We do:** ship Add to Bag only. When the server accepts the line, the bag drawer opens
(`add-to-bag.tsx`, `setOpen('cart', true)`), and the drawer carries a Checkout button.

**Why:** **DEV-55** deferred Buy Now to Phase 17 along with the other purchase controls. Phase 17
built checkout and did not add Buy Now, and nothing withdrew it. Add to Bag followed by the drawer's
Checkout gets to the same place in one more click, through the one path that writes a cart line. A
second submit that writes the line and then redirects would repeat the `disabledReason` rules in a
second place.

**What this costs:** one click between choosing a size and reaching `/checkout`.

*Amends DEV-55. Affects Phases 13 and 17.*

---

### DEV-79 — Recommendations are one row: same category first, then the catalogue

**Feature matrix §10 and structure §7** specify several recommendation types (Complete the Look,
Trending, related collection) and a collection → category → best sellers → new arrivals fallback
chain. Journey C runs *"Product → Complete the Look → Add to Bag"*.

**We do:** one row, *"You may also like"*. `readRecommendations` (`lib/product/product.ts`) reads
published products in the product's own categories, and falls back to the curated order across the
whole catalogue when that returns nothing. It never shows Complete the Look, Trending, a
related-collection row or the longer chain.

**Why:** recommendations never had a phase of their own (**G-09**). Phase 13 shipped the minimum rule
and documented it only in a code docblock, and no later phase reconciled the product page with §7.
This records the scope instead of leaving it implied. The fallback exists so the row is never an empty
heading.

**What this costs:** a product never points at the look or edit it belongs to from its own page. Shop
the Look runs in the other direction, from the look to the product (Phase 22).

*Closes G-09. Affects Phase 13.*

---

### DEV-80 — Forms are Server Actions with `useActionState` and Zod, not React Hook Form

**The tech stack lists** React Hook Form as *"Required"* for complex forms. Feature matrix §7 and §9
name it in their *Uses* lines.

**We do:** the storefront's write forms (sign-in, registration, password reset, address book,
checkout, bag, discount code, newsletter, reviews, wishlist) post to React 19 Server Actions. The
client side is `useActionState` (17 files under `src/`), and validation is the Zod installed in
Phase 4, run on the server. Neither
`react-hook-form` nor `@hookform/resolvers` is installed.

**Why:** the rule that the browser is never authoritative means validation has to run on the server
anyway, and a Server Action form works before hydration (the same reasoning as **DEV-72** and
`AddToBag`'s real `<form>`). Phase 7 took this route and added no dependency (ARCHITECTURE §5,
Phase 7). React Hook Form would have added a second, client-side validation path over the same
schemas.

**What this costs:** no client-side field-by-field validation as the customer types. Errors come back
from the server on submit and are shown next to the field.

*Affects Phase 7 onward.*

---

### DEV-81 — Husky and lint-staged are not adopted; CI enforces the gate

**The tech stack lists** *"Git hooks: Husky + lint-staged — Local quality gates — Recommended"*.

**We do:** install neither. `.github/workflows/ci.yml` runs install → typecheck → lint
(`--max-warnings 0`) → format check → unit and component tests → the pure `verify:*` harnesses → the
secret scan → build (when `DATABASE_URL` is configured) on every pull request and every push to
`main`. The phase gate in AGENTS.md is the same `typecheck && lint && build`.

**Why:** a local hook is per-machine and can be skipped with `--no-verify`, so it cannot be the
enforcement point. CI can. The listing was *"Recommended"*, and the gate it recommends exists in the
place that cannot be bypassed.

**What this costs:** a formatting or lint slip is caught at push instead of at commit.

*Affects Phase 27.*

---

### DEV-82 — The homepage social gallery renders only when there are three editorial images

**Feature matrix §3** lists a *"Social/community gallery"* on the homepage.

**We do:** the `socialGallery` block requires at least three items (`minRows: 3` in
`payload/blocks/home.ts`), and `pnpm seed` composes it, headed *"Worn by"*, from the first four
media records with role `editorial` only when at least three exist (`scripts/seed.ts`,
`socialItems`). With fewer, the homepage has no gallery section and nothing stands in for it.

**Why:** the images are brand photography credited to the brand's own handle. They are never
presented as customer posts, and customer-submitted imagery has no entity and no moderation path
(ARCHITECTURE §3.3). A gallery of one or two tiles would be a broken grid, so the block is dropped
rather than shown thin.

**What this costs:** the section is absent in any environment whose media library has fewer than three
editorial-role images. The Phase 35 audit (DOC-24) found it absent locally and in production.

*Affects Phases 10 and 29.*

---

### DEV-83 — Every storefront page is rendered per request

**Plan §30.1c and §36.1c** ask for sound cache behaviour and fast server responses. ARCHITECTURE D-32
and the Phase 10 table assumed `/` was prerendered.

**We do:** render every storefront route dynamically. The root layout (`(frontend)/layout.tsx`) awaits
`getShellSession()`, which reads the signed-in customer and the bag for the header badge and the bag
drawer. Both are keyed by cookies, and reading `cookies()` in the shared layout makes every route
under it dynamic.

**The cost, measured by the Phase 35 audit (R3-06):** `.next/prerender-manifest.json` lists only
`/_global-error`, `/robots.txt` and `/sitemap.xml`. Production pages answer
`Cache-Control: private, no-cache, no-store` and `X-Vercel-Cache: MISS`, so anonymous traffic runs a
function and several Postgres reads per page, and the `revalidateTag` hooks never reach an HTML cache.
Median TTFB was about 260 ms for `/` and `/shop` and 520–650 ms for a product, a collection and an
article, before the Phase 30 product-page fix. During a database outage `/` renders a signed-out shell
(notes §1.36.2) because the shell degrades, not because anything was prerendered.

**Why it is the current shape:** the bag badge, the bag drawer and the wishlist sync are per-visitor,
and they were built as server reads in the shell before anyone measured the cost.

**Owed:** move per-visitor state out of the server layout. The bag badge, drawer and account state
would fetch from a no-store route handler after hydration, or become dynamic holes under Cache
Components. Catalogue and editorial routes would then get revalidate windows so the existing tag hooks
invalidate their HTML. `/cart`, `/checkout*`, `/account*` and `/search` stay dynamic. The bag must
never leak between visitors.

*Affects Phases 9, 14, 24 and 30. Recorded in Phase 36.*

---

### DEV-84 — A one-size product's only size is selected automatically

**Plan §13.1c says** the product page must never pick a size on the customer's behalf.

**We do:** when a colour has exactly one size, the server selects it, and the selector shows no
*"Choose a size."* prompt (`variant-selector.tsx`: the prompt requires `sizes.length > 1`). A size in
the URL that does not exist still selects nothing.

**Why:** with one size there is nothing to choose, and feature matrix §6 asks for *"one unambiguous
variant, add directly"*. Asking would also make the prompt flash while a colour change round-trips.
The rule §13.1c protects, never adding a variant the customer did not choose, still holds: they chose
the product and the colour, and the size had no alternative. Notes §1.40.2 (P35-31).

*Affects Phases 13 and 35.*


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
| Phase 4 — environment configuration and secret management | 2026-08-26 | Notes **§1.9**: the four contexts that evaluate the environment module and what each can gate (`instrumentation.ts` is **not** a build hook; `payload.config.ts` is **not** a startup hook), the push hazard measured down to two real paths, **D-10 closed** with `DATABASE_PUSH_TARGET` and proved by running it, the three-module split that `server-only` forced, and the would-be bugs — empty-string-is-not-absent, `NODE_ENV` undefined under the Payload CLI, `z.httpUrl()` rejecting localhost, `.env.local` loading in production builds, module scope not being once-per-server. **§1.9.7 and §1.9.9 record two post-implementation audits** that found a client component could import the environment and ship a secret in prerendered HTML, a `NODE_ENV`-unset fail-open in the guard, a total bypass via `?host=`, asymmetric case folding, a port-blind comparison, and a preview deployment able to carry live Stripe keys — all fixed. Deviation **DEV-26** (variable names this project had to choose). New decisions **D-14** and **D-15** in `docs/ARCHITECTURE.md`; new `docs/ENVIRONMENT.md`. Step 4 carried out as **§1.9.6**. |
| Phase 4 — second audit | 2026-08-26 | Note **§1.9.9**: the round-one fixes re-audited on the committed code. 40 claims, 32 refuted, 8 confirmed. The headline: the ESLint rule fencing the unguarded `env.core.ts` **does not see `import()`** — core `no-restricted-imports` registers no `ImportExpression` visitor — so a client component doing `use(import('@/lib/env.core'))` passed typecheck, lint and build and put `PAYLOAD_SECRET` into prerendered HTML: §1.9.3's leak, reached through different syntax. Closed with a companion `no-restricted-syntax` rule; seven bypass spellings probed and all caught. Also fixed: an empty `?port=` arming push against a different server (`??` where pg uses truthiness), IPv6 targets that could never arm, an acceptance-table row crediting the superseded runtime tripwire, a wrong file reference in `payload.config.ts`, an undocumented `VERCEL`, and an undercounted docblock. **D-14 now distinguishes** what fails the build from what only fails lint. |
| Phase 5 — Neon Postgres + Payload CMS foundation | 2026-08-26 | Notes **§1.10**: what the phase actually had left to do once Phases 2 and 4 had done §5.1a–b, the initial migration and the discipline around it, and the whole lifecycle proved against a **throwaway database created beside the development one** so the owner's branch and admin user were never at risk — apply, roll back, re-apply through `pnpm build:deploy`, rebuild with `migrate:fresh`, drop. CRUD proved three ways: Local API, REST through the running app, and the admin panel in a real browser. **§1.10.4 records the one real defect** — the adapter attaches an `error` listener to a single pool client, so any other idle connection dying emitted `error` on a listener-less pool and became `uncaughtException`; `next dev` hides it and a production server would not. Fixed with an `onInit` pool handler and re-measured. **§1.10.5**: the push-built and migration-built schemas were dumped and diffed and are **identical**, which is the migration-drift edge case answered rather than discussed. **§1.10.6** records four traps — `delete({trash:true})` is a *permanent* delete, a compound unique index over a nullable column does not constrain NULL rows, compound index names are not namespaced by table, and a generated migration does not compile under `noUnusedParameters`. New decisions **D-16** (migrations run in the build, not the server) and **D-17** (primary keys stay `serial`); new `docs/DATABASE.md`. Step 4 carried out as **§1.10.8** — **DEV-15 confirmed and closed**, DEV-17's withdrawal vindicated with one superseded code line noted. No deviations, no new dependencies. |
| Phase 6 — Payload data model | 2026-08-27 | Notes **§1.11**: the five decisions that had to precede any field — money as integer minor units, publish state as a column rather than Payload drafts (whose `disableNotNull` strips `NOT NULL` from the *main* table), variants as their own collection, which side of a many-to-many owns the order, and shoppers as a second auth collection. **§1.11.2** answers the two questions Phase 5 left for this phase: the variant SKU needs no partial index because a *global* unique refuses a superset of what §6.1c asks, and `afterSchemaInit` is used once, for `CHECK (inventory_quantity >= 0)`, because Phase 17's atomic decrement will be raw SQL past every validator. **§1.11.3 records three defects that only running it would find** — a `dbName` string that collapsed one block into a table shared by two collections with the wrong parent foreign key; required address sub-fields that made §18.1a's draft order impossible to save; and delete cascades on `afterDelete` that can never run, because a `required` relationship is `NOT NULL` *and* `ON DELETE SET NULL`, so the violation fails the parent's own delete. **§1.11.4**: Drizzle emits `DROP TABLE … CASCADE` alongside explicit drops of constraints the cascade has already removed — twice, and 22 statements the second time — so every generated `DROP CONSTRAINT` now needs `IF EXISTS`; and `migrate:create` is not always non-interactive, which is why the fixture removal was generated as its own migration. **§1.11.5**: 24 behavioural checks against the live database, all passing, plus a signed-in browser pass over the admin panel. Deviations **DEV-27** (a review requires a customer), **DEV-28** (`media` is created here, not in Phase 8), **DEV-29** (SKUs are globally unique), **DEV-30** (currency and locale are this project's choice). New decisions **D-18** through **D-21** in `docs/ARCHITECTURE.md`; **G-01**–**G-05** closed. One dependency: `@payloadcms/richtext-lexical`. Step 4 carried out as **§1.11.8** — **DEV-10 discharged**, DEV-01, DEV-07 and DEV-08 now enforced by the schema rather than by convention. |
| Phase 6 — post-implementation audit | 2026-08-27 | Note **§1.11.10**: the committed phase re-reviewed by seven independent auditors with adversarial verification — 38 claims, 8 refuted, 30 survived, 8 distinct defects fixed. The headline is that **`context` is not a per-call argument**: `createLocalReq` merges it onto the *same* request object it is handed, so `skipDerivedSync` latched — every permanent variant delete skipped its product's price/stock refresh, and in a bulk variant edit only the first product was refreshed. The suppression now travels as the id of the product being deleted. Second: swallowing a hook error hid a transaction Payload had **already rolled back** via `killTransaction`, so a variant save reported success for a write that no longer existed — both hooks now rethrow. Third: eleven media references and three hotspot references were `NOT NULL` + `ON DELETE SET NULL` inside array and block rows, where no cascade can reach them, making the referenced product or asset permanently undeletable — the columns are nullable and the requirement moved to `validate`, which is also what makes plan §22.1b's "hide the hotspot" and §8.1d's placeholder reachable at all. Fourth: a custom `validate` replaces Payload's built-in one and with it `required`, which money fields and `addresses.country` both relied on. Plus a promotion saveable with no discount value, fractional stock, a seed blind to trashed rows, and both scripts guarding on `appEnv` — which cannot see a connection string — instead of D-10's database identity, now exposed as `developmentDatabase`. Twelve documentation errors corrected, including a table count of 74 that is 73 and a comment asserting the opposite of what its own foreign key did. 13 targeted re-checks against the live database, all passing. |
| Phase 7 — access control and authentication | 2026-08-27 | Notes **§1.12**: route protection is **three** layers and only two are checks — the Next 16 `proxy.ts` (renamed from `middleware.ts`) is an optimistic cookie-presence redirect that cannot verify anything, and the real route check lives in the *pages* rather than `account/layout.tsx`, because a layout does not re-render on navigation within its own segment. **§1.12.2**: the role bootstrap needed two answers — a hook forcing the first account on an empty database to `admin`, and a data statement in the migration backfilling existing staff, because `editor` would not have preserved their permissions, it would have removed them from all of them at once with no admin left to grant them back. **§1.12.3**: ownership rules return a `Where`, so a cross-account read is *empty* rather than *forbidden*; and two things a rule cannot do — say whose a new row is (`enforceCustomerOwnership` forces it) and protect one field of a permitted write (field access does). The variant/product publication join `publishedOn('product.status')` was measured both ways, because getting it wrong would have published every unreleased SKU, price and stock count. **§1.12.4–5**: why the reset link's origin comes from `SITE_URL` and never the `Host` header, why the token is not validated on page load, why a reset does not sign you in, and a password policy of twelve characters with no composition rules against Payload's built-in floor of **three**. **§1.12.7 records two defects found by running it**: React **resets** an uncontrolled form once its action resolves, so a rejected sign-in emptied the email field — fixed with echoed `defaultValue`s, password excluded; and the first `verify-access.ts` counted *any* thrown error as a passing access check, so a fixture typo would have reported a clean run while proving nothing. Deviations **DEV-31** (registration names a duplicate email), **DEV-32** (the reset flow exists before email does). New decisions **D-22**–**D-25**. New script `pnpm verify:access` — 43 checks, all passing; 42 further browser checks across dev, production and the admin panel; **0 axe-core violations** on six routes. No dependency added. Step 4 carried out as **§1.12.11**. |
| Phase 8 — media and Cloudinary | 2026-08-28 | Notes **§1.13**: **D-03/DEV-05 confirmed against the registry** in the phase told to confirm it (`@payloadcms/storage-cloudinary` still 404s; five sibling adapters publish at 3.88.0), and ARCHITECTURE.md's premature *"Confirmed in Phase 8"* marker corrected. **§1.13.2**: Cloudinary transforms at *delivery* and Payload declares **no `imageSizes`** — a delivery URL is pure string concatenation (verified in the SDK source and against the live CDN unsigned), while the `imageSizes` route would have cost 48 columns, 8 indexes and 9 uploads per asset to reproduce it, and would freeze the breakpoints into stored rows. **§1.13.3 records three defects found by measuring rather than reading, all of which would have shipped**: `c_lfill` — the documented "fill but do not enlarge" mode — *silently abandons the aspect ratio* when a request exceeds the source, which is the layout shift §8.1d forbids arriving through the safe-looking option; clamping to the source **width** is insufficient once a crop changes the ratio, because the binding constraint moves to the height (an 864×576 source asked for the 4:5 hero returned 864×**1080**); and `fl_relative` makes Cloudinary's `x_`/`y_` **multiply** the source dimensions, so the first focal-point implementation requested a 345,600 × 432,000 image and got a 400. A fourth was caught in a browser — the art-directed *placeholder* did not change shape at the breakpoint, which mattered because with an empty catalogue the placeholder is the only path that renders. **§1.13.5**: `checkFileRestrictions` has two mutually exclusive branches and without `mimeTypes` there is **no content inspection at all**; setting it is the whole of §8.1b, and SVG and GIF are excluded as verified bypasses (an `<?xml`-prefixed SVG skips `validateSvg`; `file-type` reads offset 0 only, so a `GIF89a`+`MZ` polyglot passes as an image). A size limit without `abortOnLimit` is **worse than none** — Busboy truncates and Payload never reads the flag. **§1.13.9**: the phase is committed with **no Cloudinary credentials**, so the degraded path is what was verified — and the storage plugin is registered *unconditionally* with `alwaysInsertFields: true` because conditional registration would emit two different schemas from one committed migration. Deviations **DEV-33** (no `sharp` — reverses DEV-28's closing clause and three lines of STACK_VERSIONS), **DEV-34** (eight contexts, not six), **DEV-35** (SVG and GIF refused). New decisions **D-26**–**D-29**. New script `pnpm verify:media` — 48 checks, plus a live round trip that arms itself when credentials appear. 15 browser checks at **CLS 0.0000** and 0 axe violations; 25 URL-builder checks against the live CDN; the migration applied, rolled back, re-applied and diffed **identical** against the pushed schema. Two dependencies added, one removed from the plan. Step 4 carried out as **§1.13.13**. |
| Phase 9 — storefront shell | 2026-08-28 | Notes **§1.14**: the shell mounted in the storefront root layout and driven by the `navigation` and `site-settings` globals, with **no dependency added**. **§1.14.1** answers the two questions that had to precede a component — where a document lives (gap **G-15**, closed by **D-30**: one route map, `campaigns` deliberately mapping to nothing) and what a broken link renders as (**dropped**, never disabled, because a disabled navigation item is §0.1.17's fake control with an apology attached) — and records that publication has to be re-tested at render because the Local API's `overrideAccess: true` bypasses the access rule. **§1.14.2**: one state variable makes a second open overlay *unrepresentable*, the mega menu joins the machine from outside because it is the only overlay with no focus trap, and neither reset is an effect — the React Compiler's `set-state-in-effect` rule failed the build on the first version. **§1.14.3 records the defect only a browser could find**: Radix's modal dialog restores focus to `Dialog.Trigger`, these overlays have none (their triggers are in the header, their dialogs beside the footer, because §9.1d demands they work from every page), so `DialogContentModal` focused a null ref and **dropped focus to `document.body` on every close** — a WCAG 2.4.3 failure invisible to axe, which inspects a static tree. **§1.14.4**: two visual failures fixed against screenshots — equal-fraction mega-menu columns that put two columns at the far ends of a 1440px bar, and a primary row that sat against the top of the bar because Radix's `<nav>` → `<div>` → `<ul>` breaks an `h-full` chain. **§1.14.6**: `revalidateTag`'s single-argument form is deprecated in Next 16, and the hook must survive `pnpm seed` running outside Next, which is why `next/cache` is imported dynamically and a failure warns. Deviations **DEV-36** (no back button — there are no nested groups), **DEV-37** (the search overlay is chrome, with an honest interim panel), **DEV-38** (social links are words: `lucide-react@1.x` ships no brand marks). New decisions **D-30**, **D-31** (`global-not-found.tsx` behind `experimental.globalNotFound`, because **D-08**'s two root layouts leave no layout for a root `not-found`), **D-32**. New script `pnpm verify:shell` — 76 checks including the publication states as **real** Payload documents; 49 browser checks at two widths; **0 axe-core violations** across five route and overlay states. Step 4 carried out as **§1.14.10** — **DEV-01** and **DEV-07** discharged, their *"still to be exercised by Phase 9"* clause closed. |
| Phase 9 — post-implementation audit | 2026-08-28 | Note **§1.14.13**: the committed shell re-read adversarially, four defects found and fixed. **The headline is a security defect in Phase 7 code**: one same-site-path rule copied into four files, all four accepting `/\t/evil.example` — which the WHATWG URL parser strips to `//evil.example` — so `/login?next=/%09/evil.example` sent a customer to another domain immediately after they typed their password. Demonstrated end to end against the running application and re-tested after the fix. Closed by `lib/same-site-path.ts`, one rule with no imports, reachable both by alias and by relative path, refusing control characters rather than stripping them. Second: `documentHref`'s object literal answered for `Object.prototype` members — `'toString'` returned a string that **rendered**, `'constructor'` returned a *relative* href, `'isPrototypeOf'` returned a boolean from a function typed `string | null`, and `'__proto__'` **threw**, silently degrading the whole shell; fixed with a `Map`, and slugs are now encoded so a stored `../../admin` cannot climb out of its namespace. Third, and **the same root cause as §1.14.3's focus defect with only half of it fixed at the time**: bypassing `Dialog.Trigger` loses the trigger ARIA as well as the focus restoration, so the search and bag buttons announced no `aria-haspopup` and no `aria-expanded` — invisible to axe, which had swept the markup clean twice. Fourth: `key`/`value` on the href meant two navigation items at one URL shared a mega-menu panel; fixed with positional keys and verified by writing duplicates to the live global. Also **tested two claims the phase had only written down**: the editor-save revalidation round trip (correct, but the README said "next request" where stale-while-revalidate makes it the one after — corrected), and the degraded shell in all four database-failure modes, which layer — a prerendered route serves real content, a dynamic route serves the fallback and logs, a route with its own data access 500s, and a build fails loudly rather than baking a fallback site. `verify:shell` is **100 checks**, up from 83. |
| Phase 9 — campaigns deferred out of the linkable set | 2026-08-28 | Note **§1.14.11**, deviation **DEV-39**. `campaigns` had a route of `null` *and* remained in `LINKABLE_COLLECTIONS`, which together made an **editor trap**: the admin panel accepted a campaign as a link target and the header silently dropped the item. The evidence that a campaign has no page is tabulated — no `CAMPAIGN` node in structure §2's site map, campaigns on the *homepage* in feature matrix §3 and inside a **collection** page's edge cases in §12, no phase in the plan building a route, and no page-level art direction in visual guide §09 — together with the one line that cuts the other way (structure §4 path C and §22's Journey E draw *Home → Campaign → Lookbook*, in diagrams whose other steps are an overlay and a component). **Zero rows referenced a campaign**, measured rather than assumed: Drizzle's push warning quotes *table* row counts, not reference counts. One migration, `20260828_060719_phase_9_defer_campaign_links` — the only schema change in Phase 9 — applied, rolled back and re-applied, with the catalogue re-seeded afterwards because the rollback reached the data-model tables. Records a workflow hazard: `pnpm migrate` twice printed nothing, applied nothing and exited 0 inside a chained command, then worked when run alone. `verify-shell.ts` now asserts the *invariant* rather than the instance — every collection in `LINKABLE_COLLECTIONS` has a route — 83 checks, up from 76. The `campaigns` collection itself is untouched. Two workflow hazards recorded: a Payload CLI script that prints nothing may have done nothing while exiting 0, and `migrate:down` follows *batch* numbers rather than file order, which on a database with non-monotonic batches rolls back across phases and leaves a chain that reports itself fully applied while missing columns. **§1.14.12** records the Phase 7 harness defect that rebuild exposed: `verify-access.ts` created its editor fixture before its admin, so on an empty `users` table `Users.ts`'s first-account bootstrap silently promoted the editor to admin, every *"an editor cannot …"* assertion tested an admin, and one of them deleted a product and crashed the run on an unrelated foreign key. Fixed by ordering plus two assertions — `verify:access` is now **45 checks**. |
| Phase 8 — Cloudinary credentials, live verification | 2026-08-28 | Note **§1.13.14**: credentials arrived after the phase was committed and `pnpm verify:media` armed its live half with no edit — **61/61**, up from 48. Confirms the one thing that could not be predicted without an account: **Strict transformations is off**, so the dynamically built delivery URLs this project depends on derive on the fly. Also confirms the storage round trip end to end — public id, asset id, version and resource type stored from Cloudinary's own response, `media.url` pointing at the CDN, Cloudinary's dimensions replacing the local probe's, every `srcset` candidate for a real record resolving, and a deleted record leaving a 404 behind. **The height-limited clamp predicted real data correctly**: a 3000×1200 landscape in the 4:5 gallery context clamps to 960 = `floor(1200 × 0.8)`, a formula derived from an unrelated 864×576 fixture. Recorded that `f_auto` returns **WebP** on this account where the demo cloud returned AVIF — both correct, and noted so the difference is not later read as a regression. One vacuous check name corrected. **§1.5 Cloudinary unblocked**; the live round trip is struck from §1.13.12's owed list. `.env.example` also de-duplicated: the Phase 8 commit added a Cloudinary block while an empty one already existed in the per-provider section. |
| Phase 10 — homepage / editorial system | 2026-08-28 | Notes **§1.15**: the homepage as a `homepage` **global** of typed blocks, with Phase 9's split reused — a **pure** `lib/home/resolve.ts` holding every drop/keep rule so a CLI can exercise it, and `lib/home/home.ts` holding only caching. **Eleven block types, five of them the Phase 6 objects imported unchanged** (`splitFeature`, `figure`, `editorial`, `shopTheLook`, `productGroup`), which is what `blocks/editorial.ts` predicted; `productRail` (a query) and `productGroup` (a curation) both exist because neither expresses the other. **§1.15.3**: the 63-byte identifier arithmetic done *before* the schema reached the database — `collectionFeature` and `categoryTiles` breach it at 66 and 65 bytes and carry the **function** form of `dbName`; verified afterwards that **no identifier in the database is 63 bytes or longer**, an invariant `verify-home.ts` now holds permanently, because a breach is silent in both directions and only fails when two names truncate alike. **§1.15.4**: `campaigns.mobileHero` had been **unrenderable since Phase 6** — `MediaImage` art-directed one asset at two crops and had no path for a second asset; one backwards-compatible `mobileMedia` prop, with the mobile box reserved from the record that will actually be served. **§1.15.6 records the defect only a browser could find**: `Reveal`'s docblock claimed content could never be stranded invisible, and an `IntersectionObserver` reports *threshold crossings*, so jumping to the foot of the page left **six sections at `opacity: 0` for the rest of the session** — fixed with an upward-only `rootMargin` and re-measured. **§1.15.7 records a Phase 7 defect this phase's schema exposed**: `z.email().trim()` validates the **raw** input, so `"  Ada@Example.COM "` was rejected on the sign-in, registration and reset forms — the exact case `auth/schemas.ts` said the trim existed to handle; both schemas now pipe a trimmed string into the email check. Deviations **DEV-40** (no animation library, reversing DEV-24's deferral on four measurements — 8.64 MiB, ~40 KB gzip on the LCP route, `reducedMotion: "never"`, and a WAAPI path that cannot read the duration tokens), **DEV-41** (no hero video and no field for one), **DEV-42** (the newsletter is the footer's column, **discharging DEV-25**, with `create` kept `isStaff` to avoid a membership-enumeration oracle), **DEV-43** ("Editorial split" and "Brand story" are one block), **DEV-44** (the hero is stacked; no type over the photograph). New decisions **D-33**, **D-34** (amends **D-13**), **D-35**; new gap **G-16**. New script `pnpm verify:home` — **173 checks**; `verify:access` 45/45, `verify:media` 61/61, `verify:shell` 100/100 all unchanged. 55 browser checks across §30.1a's eight widths and **0 axe-core violations** at 1440×900 and 390×844. `/` confirmed prerendered `static` with `home` on its cache tags. **No dependency added**; direct dependencies stay at 22. |

| Phase 10 — post-implementation audit | 2026-08-28 | Note **§1.15.12**: the committed phase re-read by seven auditors with adversarial verification — **39 claims, 3 refuted, 36 confirmed** (2 high, 8 medium, 26 low), all fixed. **The headline is a security defect this phase's own decision D-35 claimed to have closed**: `Prose` spread `defaultConverters` and overrode only `link`, while Lexical's **`autolink`** node — created by the editor's plugin whenever someone types something URL-shaped — renders `node.fields.url` unvalidated. `//evil.example/phish` and a `data:text/html` payload rendered as live anchors on the homepage; the save side cannot catch it either, because `AutoLinkNode` declares no `getSubFields` so the `url` field's hooks never run. Closed by listing every converter by name, sharing one sanitised implementation between both link types, and rendering nothing for the four node types this editor does not enable. Second: **`getHome`'s documented "never throws" was the defect** — `/` is prerendered with a 300-second revalidate, so a failed *background regeneration* returned a valid empty homepage that ISR cached over the good HTML for five minutes; the `try` had been reasoned about for the data cache and the route cache is a second one. `page.tsx` now throws on `degraded`. Also: two `<h1>`s from two heroes (axe requires *at least* one); an empty `<h2>` from a rail with a CTA and no heading; the newsletter announcing nothing and dropping focus on a validation failure; a sticky header covering 100% of the focused control on Shift+Tab (WCAG 2.4.11); focus landing inside an `opacity: 0` section; `MediaImage` discarding the mobile photograph in exactly the no-Cloudinary state three docblocks said it survived; a read-then-create newsletter path that was a timing oracle for the enumeration it set out to prevent; and two `sizes` strings measuring the viewport where they meant the container. **Nine of the thirty-six were docblocks asserting a property the code does not have** — the report's own conclusion is that the docblock is the specification the next phase trusts and the only artefact nothing executes. `verify-home` is **173 checks**, up from 161, with a regression for every confirmed finding the pure module can hold — and its report is now one awaited `stdout.write`, because `process.exit()` was truncating the verdict while still exiting 0. |
| Phase 11 — product catalogue and discovery | 2026-08-30 | Notes §1.16: the per-query engine choice (**D-36**) that reconciles §11.1d, §0 and §A.5, measured against a real Algolia outage; the index that stores no customer-visible data (**D-37**); the `NULLS FIRST` that would have topped the price-desc grid; the nine card states; pagination over load-more; one nuqs parser map for server and client; and four defects — a 320px overflow, a taxonomy flattened by reading `parent` at `depth: 0`, a chip per descendant, and a struck price at 4.15:1. New harness `pnpm verify:catalog` (**122 checks**, including that both engines agree) and `pnpm reindex`. Deviations **DEV-45** through **DEV-48**. Two dependencies added: `nuqs`, `algoliasearch`. |

| Phase 11 — post-implementation audit | 2026-09-02 | Note **§1.16.11**: the committed phase re-read adversarially and every claim reproduced against the running application — **6 defects confirmed** (2 high, 2 medium, 2 low), all fixed. **The headline is a filter a customer could apply and could not remove**: the chip's label came from the *normalised* value while its remove-link filtered the **raw** URL token, so on `/shop?size=m` the href was byte-identical to the page it was on — six products before the click, six after. Closed by **canonicalising the URL** (`?size=m` → `?size=M`, one redirect) rather than by patching the comparison, so every downstream comparison is normalised-against-normalised by construction; unknown values and reversed price ranges are deliberately *not* rewritten, because §11.1d requires the customer be told rather than silently corrected, and `canonicaliseParams` is asserted to be a fixed point so no URL can redirect twice. Second: **the price facet lied about what was applied** — draft state seeded from props and never re-synced, so removing the price chip left `100 / 200` in the inputs and pressing Back left a maximum the customer believed cleared, which a subsequent Apply would silently re-apply. Also: **an out-of-range page was a self-contradicting dead end** ("10 products" above "this part of the shop has no published products", with no pagination to escape by) — now redirects to the last real page; **the filter panel offered sizes of draft products**, verified with a draft-only size that returned zero results, against a docblock claiming the opposite, fixed by extracting `listableVariantWhere` so the vocabulary and the listing share one definition of "listable"; a duplicated `site-settings` read; and one docblock narrower than its code. **The coverage gap mattered more than any single defect**: all ten seeded products were in stock, so three of §11.1b's nine card states had never rendered in a browser — the seed now ships one sold-out and one low-stock product, so `/shop` exercises three availability states in every environment. `verify:catalog` is **144 checks**, up from 122, with a regression for each finding and two rules extracted into the pure module so the harness could hold them; browser pass **36/36** (the old out-of-range assertion encoded the defect and was rewritten); **523 checks** across five harnesses; 0 axe violations across six surfaces. |

| Phase 12 — search / Algolia | 2026-09-07 | Notes **§1.17**: text search over the Phase 11 index. **Three defects in the shipped index were found and fixed before the feature was written**: every sort replica had NO `searchableAttributes` (measured — `black` returned 0 on the primary and 1 on `..._price_asc`, so a text query would have made the sort control silently change the result set); `_highlightResult` returns index text past `attributesToRetrieve`, which would have made D-37's own sentence false in the same commit that enabled search; and `attributesToRetrieve` is **not a security boundary** — measured with the PUBLIC key, a per-request override returned name, slug, price and stock, so D-37 is amended to say it buys staleness, not secrecy, and `unretrievableAttributes` is added as the one real boundary. §12.1a asked for nine searchable fields and four matched nothing (`accessories` 0→2, `essentials` 0→5, `black` 0→1, `Graphite` 0→2, `XL` 0→6, `brushed cashmere` 0→1, `merino hoodie` 0→1); answered by ONE derived `searchTerms` attribute, because Algolia\u2019s Attribute ranking is positional and five entries would impose an arbitrary precedence. **D-38** settles popular searches as editor-curated and index-validated — Algolia Analytics was rejected on measured data quality, not access: its top search was the EMPTY STRING with 18× the next, because every faceted /shop request sent an empty query with `analytics` defaulting on. **D-39** keeps D-37 intact for the typeahead (one `rehydrateProductIds` for grid and panel); **D-40** puts `q` in the one parser map, so `/search` is a third caller of `CatalogPage` and the `/shop?q=` redirect COMPOSES with canonicalisation rather than layering, preserving the fixed-point property. A browser found three panel defects nothing else could: popular searches could never render (twice — the fetch, then the line consuming it); the ARIA tree and the keyboard model described different things, so `aria-activedescendant` pointed at ids not in the document (two critical axe failures); and the panel dropped popular searches during an outage while its docblock said otherwise. **The new harness found a defect it had itself caused**: a cleanup pass had eaten the control characters out of `normaliseSearchTerm`'s regex literal, leaving `/[-----]/` — still compiling, still running, stripping almost nothing, and invisible to typecheck, lint, build and 144 catalogue checks. Both regexes are now built with `new RegExp` from \u escapes. New: `pnpm verify:search` (**200 checks**), `pnpm reindex:check`, `docs/SEARCH.md`. **723 checks across six harnesses**, 19 browser checks, 0 axe violations across 14 surfaces, and a degraded pass proving browsing is untouched without the index. Deviations **DEV-49** through **DEV-54**; **DEV-37 closed**. No dependency added. |

| Phase 13 — product detail page | 2026-09-07 | Notes **§1.18**: the `/product/<slug>` route every phase since 9 recorded as owed, and one 404 for all four absences — `publishedProductWhere` is the single definition of *listable*, so a product that cannot be listed cannot be reached by URL (verified: published 1, draft 0, scheduled 0). §13.1c lives in a pure module and the plan's own Black/M–Cream/M example is a named check; colour falls back and size deliberately does not. Variants are read explicitly rather than through the Payload `join`, whose fixed page size would have shipped a size row silently missing its last size. **A pre-commit read found three `role="radiogroup"`s with roving `tabIndex` and no arrow-key handler** — the size row, which is unselected on every arrival from the shop, had **zero of five options reachable by keyboard**, invisible to typecheck, lint, the build, 49 harness checks, 25 browser checks and an axe sweep reporting zero violations, because it is a behaviour rather than a property of the DOM. Fixed in `lib/product/roving.ts` with 11 harness and 19 browser regressions. Also recorded: the media library is empty by design, so the multi-frame gallery is owed a pass against real assets. Deviations **DEV-55** (purchase controls deferred — a sentence, not a disabled button) and **DEV-56** (arrows move focus, Space commits, because `shallow: false` makes every selection a navigation). |

| Phase 13 — two post-implementation sweeps | 2026-09-07 | Notes **§1.18.10**. Nine findings. **Sweep 1**, against a production build: `history: 'push'` with `shallow: false` writes a history entry synchronously and renders it later, so a second selection made before the server answers leaves an entry whose content describes a **different URL** — Back showed `?size=XS` over a page with no size selected, from 400 ms between clicks on the product page and 150 ms on `/shop/<category>`. Not a Phase 13 regression; the pattern is Phase 11's. `components/url-state.tsx` now owns the write options both call sites duplicated plus the rule that a write made while a navigation is in flight replaces rather than pushes. Walking the whole history in both directions: product **2/5 → 5/5**, catalogue **8/8**. Also: closing the zoom viewer dropped focus onto `<body>` (WCAG 2.4.3), and the product video shipped an empty `<track kind="captions">` — invalid markup asserting a caption track that does not exist. **Sweep 2**, against the docblocks: the swatch row's order depended on which sizes each colour came in, with a tie the query never broke, so the **default colourway could change between requests** — now alphabetical over a totally ordered read; `PRODUCT_IMAGE_SIZES.recommendation` was **never imported**, so the row used the shop card's string and under-claimed by 22%; pointing the same measurement at every `sizes` string found four more wrong, all in the last tier, by up to **+20% at 320px** — every one now within 2%, with the shared container arithmetic in `lib/media/grid.ts` and a *no bare `100vw` unless it really is the viewport* rule in all three harnesses; the size guide's "cells by label" promise lived in a component where nothing could execute it, now a pure module with nine regressions; and `pagination: false` does **not** make `limit` decorative, so the 500-variant cap was a real silent truncation of the size selector and now logs. `verify:product` 49 → **80**. Full sweep: 719 harness checks, 119 browser checks, 0 axe violations. |
| Phase 14 — cart system | 2026-09-07 | Notes **§1.19**: a server-authoritative bag. Phase 6's schema needed no revisiting — no totals on `carts`, no price snapshot on `cart-items`, and `(cart, variant)` unique, which is §14.1b step 5 as a constraint and is verified against the real database. §14.1b's **seven named edge cases are seven named checks**; summing happens **before** clamping, because two checks that each pass can still add up to more than the warehouse has. §14.1d's five totals: the subtotal is real and discount, shipping and tax are **`null` rather than zero** (**DEV-58**) — a computed `$0.00` beside *Shipping* is the most persuasive kind of fake UI, and `isFinal` flips on its own when Phases 15 and 16 assign those fields. Every control is a `<form>` posting to a Server Action, so the bag works without JavaScript, and **no price crosses the boundary as an input**. **DEV-57**: no Checkout control — Phase 17 owns `/checkout`, and the drawer pins *View bag* instead. Three defects found by running it, two invisible to every gate: a `'use server'` module exporting a constant 500'd at **runtime** with typecheck, lint and build all green; `maxQuantity` clamped the current quantity instead of the ceiling, disabling `+` on every line; and the new bag badge escaped its unpositioned button to sit two pixels past the **document** edge, giving every page a horizontal scrollbar. `verify:cart` is **68 checks**; 34 browser checks, 9 merge checks against a real account, 0 axe violations. |
| Phase 14 — two post-implementation sweeps | 2026-09-07 | Notes **§1.19.9**. Eight findings. **Sweep 1**, making the world move under an open bag: the line rendered the **stored** quantity beside a subtotal computed from the **effective** one — drop stock to 1 under a line holding 2 and the number on screen times the price on screen did not equal the subtotal on screen; and an unpublished product left a **dead link inside the bag**, because `publishedProductWhere` is the single definition of *listable* and the route honours it. Sixteen adversarial cases held, including a forged cart token, a mutation aimed at another session's line id, a re-enabled Add button posting a sold-out variant, two diverging tabs, a double tap, and **the whole add-to-bag flow with JavaScript switched off** — which was a docblock claim until it was tested. **Sweep 2**, against the docblocks: `resolveCart` resolved a cart by cookie when `customerId === null || !found.customer`, so **a signed-out visitor was handed the previous account holder's bag** — measured as "Bag, 1 item" after signing out on a machine with no session; the condition is now `!found.customer` alone and `logout` clears the cookie. Also: the cart cookie decided `secure` from `process.env.NODE_ENV` while the session cookie uses `appEnv`; *"claimed rather than ignored"* never wrote a `customer`; `LINE_LIMIT` was a **silent cap** — the same `pagination: false` finding Phase 13's sweep made about `VARIANT_LIMIT`, in a new file; and *"the action is idempotent per line"* was false. Three claims held under test, including the forward-looking one: assigning the three deferred totals made the summary render Discount, Shipping, Tax and **Total $237.29** with no component edited. `verify:cart` 68 → **72**. |
| Phase 15 — promotions and discounts | 2026-09-07 | Notes **§1.20**: a server-authoritative promotion engine, filling the first of Phase 14's three deferred totals. Phase 6 had already answered three questions this phase would otherwise have got wrong — `timesUsed` increments in **Phase 17**'s payment transaction, `perCustomerLimit` is a **count of paid orders** rather than a tally that a refund would falsify, and one-code-at-a-time is a schema property rather than a rule. §15.1a's eight checks and §15.1c's eight edge cases are all named checks. **`inactive` and `unknownCode` return the identical sentence**, byte for byte, so the code field cannot be used to enumerate an unreleased campaign. Eligibility is resolved from `collections.products` and not from `product.collections`, because the latter is a **`join`** — virtual, no column, `{ docs }` rather than an array — and reading it would have produced a collection-scoped promotion that silently never applied; the third phase to meet that join, and the first to meet it before shipping the bug. Rounding is `Math.round` rather than `floor`, because flooring every percentage is a systematic fraction of a penny in the shop's favour. **The discount is re-decided on every read** — only the choice of code is stored — so an expired or exhausted code cannot leave a stale amount. `verify:promotions` failed on its first run with `ERR_MODULE_NOT_FOUND: server-only`: the guard was on the wrong module, and the fix was structural — reads that take a `Payload` argument moved to `read.ts` with no guard, exactly as `catalog/query.ts` sits beside `catalog/catalog.ts`. Deviations **DEV-59** (a per-customer limit is unenforceable against a guest, and the alternatives only look like enforcement) and **DEV-60** (a free-shipping code validates and records but changes no price until Phase 16, and draws no `-$0.00` row). `verify:promotions` **64 checks**, 20 browser checks, 0 axe violations. |
| Phase 15 — two post-implementation sweeps | 2026-09-07 | Notes **§1.20.9**. **No defects** — the first phase where both sweeps came back empty, recorded with the reasons rather than as a result. **Sweep 1**, hostile input: SQL-shaped and script-shaped codes, a 500-character one, a null byte and whitespace were each refused with a readable reason and nothing echoed unescaped; a code that **exists but is switched off** got the same sentence an unknown code gets; the form posts **`["code"]`** and nothing else; and applying a code, emptying the bag and refilling it with a different product produced a **recomputed** discount (`−$44.00` → `−$33.00`) rather than a stale one, because only the choice of code is stored. **Sweep 2** measured the one claim made on reasoning alone: collection eligibility had been corrected during the build — reading `collections.products` instead of the `join` on `product.collections` — without ever being run. Verified end to end: 50% off *Archive* takes `−$37.50` off a member, is refused on a non-member, and in a `$555.00` mixed bag discounts only the eligible `$75.00` line. Nothing about a promotion reaches the page: no eligibility lists, no minimum, no usage limits, no counter, not even the id. One probe was wrong before the code was, counting React's own `$ACTION_*` fields as data the form posts. |
| Phase 16 — shipping and tax boundaries | 2026-09-07 | Notes **§1.21**: the two provider interfaces, built before the phase that consumes them. The phase turns on one distinction — **a price is knowable without an address; eligibility is not** — so `destinationKnown` carries it, the bag quotes `$9.95` under the threshold and `Free` above it labelled *"Delivery (estimated)"*, and §17.1a re-quotes with the real address. §16.1d's coupon case is answered explicitly: the threshold reads the **discounted** subtotal, so applying a coupon can take free delivery away — measured, a `$555.00` bag with a 90% code drops to `$55.50` of spend and delivery returns to `$9.95`. The care was that **two surfaces read that number**: the progress sentence was reading the raw subtotal and would have promised free delivery directly above a delivery charge, which Phase 15 had made reachable and nothing had yet noticed. **DEV-60 closed** — a free-shipping code now zeroes Standard and *only* Standard, because a code that silently upgraded a customer to Overnight is a promotion nobody wrote. **DEV-61**: the tax provider is the §16.1c interface with a deferral behind it, not Stripe Tax — the SDK belongs to Phase 17 and there is no destination to calculate against; it returns `pending_address`, never `0`, and refuses to guess even if handed an address. The harness also found a **design flaw in Phase 14's totals**: `isFinal` required a discount, so a bag with no code applied could never show a final Total — `null` had been doing duty as both *"do not draw this row"* and *"unknown"*, and only the second belongs in that test. `verify:shipping` **68 checks**, 12 browser checks, 0 axe violations. |
| Phase 16 — two post-implementation sweeps | 2026-09-07 | Notes **§1.21.8**. One defect, found twice at different resolutions. **Sweep 1** discovered that `Math.max(0, Math.floor(x))` — the guard in every money calculation in this project — is **not a clamp**: `Math.floor(NaN)` is `NaN`, so `taxableBaseMinor` returned `NaN`, a value bound for a tax provider and in Phase 17 a payment processor. The identical input passed through `quoteShipping` cleanly **by luck**, because `NaN >= threshold` is false and the comparison happened to fall the safe way. **Sweep 2** then grepped for the idiom rather than testing for it and found **five more instances** the first sweep had not touched — including a `NaN` discount, twice. A sweep that tests inputs finds instances; a sweep that reads for the pattern finds the class. Fixed with one implementation under two honest names, `toMinorAmount` and `toWholeCount`. Sweep 2 also found the tax provider's most important claim — *"refuses to invent a number even if handed an address"* — **untestable**, because `server-only` is correctly on that module and cannot resolve outside Next; the decision moved to `tax/rules.ts` and four checks now assert it answers `unavailable` rather than `not_required`, which would be a claim about tax law. Twenty-four hostile inputs held and were folded into the committed harness. The drawer and the bag page were measured against each other at both threshold states and agree row for row. `verify:shipping` 68 → **97**, `verify:cart` 72 → **78**, `verify:promotions` 64 → **67**. |
| Phase 17 — checkout / Stripe | 2026-09-08 | Notes **§1.22**: the phase `AGENTS.md`'s payment rule was written for. `stripe@22.5.0` installed at its pin; one migration, generated and committed — the `stripe-events` table whose **unique event id is §17.1d's first idempotency barrier**, and `orders.cart_id` for §17.1a step 10. `fulfil.ts` is the **only** file that writes `paid`, and three separate mechanisms would each have to be defeated to change that. §17.1a's steps 3–7 are **not re-implemented** — they are `getCart`, which has revalidated products, variants, stock, prices and promotions on every read since Phase 14; preflight adds the refusal a bag does not need. **Both barriers, and why one is not enough**: the unique event id stops the same event twice, and the order's own state stops a *different* event driving the same transition — Stripe sends `checkout.session.completed` **and** `payment_intent.succeeded` for one payment, and only the second barrier catches that. Verified against the real database: inventory is not decremented twice, however many times an event arrives. §17.1f's race is resolved by reading stock **inside** the transaction that writes it, all-or-nothing, and an order that cannot be met is marked **paid and left unfulfilled** — the money moved, and fulfilment is the half §17.1f withholds. §17.1g's six cases collapse to one behaviour: the success page **reads** and reports, writes nothing, and shows one message for not-found, not-yours and never-existed. `verify:webhook` failed on its first run with `ERR_MODULE_NOT_FOUND: server-only` — the third phase to produce the same rule from a third direction: **a guard belongs where a secret or a request could leak, and nowhere else.** Deviations **DEV-62** (complete, and has never taken a payment — no keys; signature verification is nonetheless verified offline against the SDK's own signer, and everything downstream against the real database) and **DEV-63** (one Stripe line item priced at the server's own total, so the shop and the processor cannot quote two different prices). `verify:checkout` **61**, `verify:webhook` **24**, 24 browser checks, 0 axe violations. |
| Phase 17 — two post-implementation sweeps | 2026-09-08 | Notes **§1.22.9**. One defect and then its whole class. **Sweep 1** delivered two events for one payment *concurrently* — which is what Stripe actually sends — and **both reported `finalised`**: §17.1d's second barrier is a status *read*, and two transactions read `pending_payment` before either wrote `paid`. The first run hid it, because both computed the same absolute stock figure from the same stale read and the second write overwrote the first with an identical number; making the decrement atomic *made the damage visible* rather than fixing it, taking stock from 5 to 1 for a two-unit order. Closed with a **third barrier**: the order is **claimed** by one conditional `UPDATE … WHERE payment_status IN (<finalisable>)` rather than checked, so there is no window between the decision and the write because they are the same statement, and the finalisable list is derived from the state machine so the two cannot drift. The near-miss indicted the harness as much as the code — **24 passing checks** covered both documented barriers and every one ran its events *in sequence*. **Sweep 2** then hunted the *shape* rather than another instance and found two more read-then-writes: the **promotion `timesUsed` counter**, which is what a code's `usageLimit` is measured against — two customers paying with one code at the same instant are two different orders, so no barrier applies and both are owed an increment — and the webhook's `attempts` column. Both are expression updates now. Section K had *already tested* the promotion counter and passed, because it increments in sequence: the identical blind spot, in a check written by sweep 1. The replacement, section L, **failed at `1` instead of `2` before the fix**. Sweep 2 also checked §1.22.1's claim that nothing but `fulfil.ts` can mark an order paid and found **a fourth door**: `paymentStatus` was an ordinary editable select and `Orders.access.update` is `isStaff`, so a staff member could type the value `AGENTS.md` reserves for a signature-verified webhook. Closed with `nobodyField`, which `overrideAccess` skips — server path open, browser path gone — and proved three ways in `verify:access`. Route docblock corrected: it was headed *"why it always answers 200"* and omitted the **503** it returns when Stripe is unconfigured. One read-then-write in `cart.ts` was found and **deliberately left**, with the reason recorded: the write is absolute and already clamped, so the race can lose an increment but can never exceed availability or the per-line limit. New module `lib/checkout/events.ts` — the delivery counter, unguarded so a harness can drive it, which is the `server-only` rule for the fourth time. `verify:webhook` **38**, `verify:checkout` **62**, `verify:access` **48**; every other harness re-run unchanged and green. |
| Phase 18 — order system | 2026-09-08 | Notes **§1.23**: the phase **DEV-03** said would confirm it, and it is confirmed — `displayStatus` derives plan §18.1b's single line from the two stored axes, all 35 payment x fulfilment combinations asserted, precedence checked in both directions, and the reason one column cannot do it stated: nothing single-valued holds *"refunded, but it shipped last week"*. **Two thirds of §18.1a was already Phase 17** — the pending order, the snapshots, the Stripe identifiers and *"finalize as paid only from validated Stripe state"* all held, so this phase tested them rather than rebuilding them. What was genuinely missing: **§18.1b's edges**, which the plan does not draw. Five legal transitions across 25 ordered pairs, asserted as a count so a machine that quietly grows an edge fails a check; `delivered` and `cancelled` terminal; **`shipped` cannot go back to `processing`**, because §18.1c hangs a dispatch email off that transition and moving the column back does not unsend it; **`shipped` cannot be cancelled**, which is this shop's answer to §18.1b's *"only where business rules allow"* — cancellation is available until dispatch, after which it is a return. Fulfilment starts at `PAID` with two exemptions that are the two-axis model earning its keep: `shipped -> delivered` records a parcel that has already gone (DEV-03's own refunded-in-transit case), and cancelling an unpaid order is ordinary. §18.1c's tracking condition refuses a dispatch with no carrier, no tracking number, or a tracking number of spaces, and the timestamps are written **by** the transition rather than typed beside it. Enforced in a **`beforeChange` hook**, not field access and not an admin component, because a hook runs on every path — with the subtlety that the panel posts the whole document on every save, so an unchanged status must not read as a transition or a delivered order becomes unsaveable. **§18.1d was half true**: the four columns were already snapshots, proved by renaming, repricing and re-SKU-ing the product and re-reading the line — but `OrderItems.access.update` is `isStaff`, so they could be **retyped**, the identical door Phase 17's sweep found on `paymentStatus`. Closed by `freezeOrderLines` on every path including `overrideAccess`; `quantity` and `lineTotalMinor` deliberately excluded, because the schema reserves them for a partial refund. **§18.1b's `PAID -> REFUNDED` now arrives from Stripe** — and `charge.refunded` carries the *charge's* metadata, not the session's, so adding the event type alone would have produced a handler that verified, recorded and ignored every refund; the order is resolved by **payment intent** instead, and the refund records how much and when (two new columns, one generated migration). Wiring it exposed a defect two phases of tests had missed: a `payment_intent.payment_failed` for a superseded attempt, racing the event that paid the order, **could write `payment_failed` over a completed payment** — the machine forbids it and the read-then-write never asked. Every payment transition is a conditional `UPDATE` now, its reachable-from list derived from the machine by `statusesThatCanReach`; both orderings end at `paid`, asserted concurrently. Deviation **DEV-64** (§18.1c's shipment email is a seam here and an email in Phase 19). New script `pnpm verify:orders` — **62 checks**, including staff, customer and anonymous attempts against the real access layer. Every other harness re-run green; typecheck, lint --max-warnings 0 and build pass. **Owed and named**: no browser or axe pass, because no browser tooling is available in this session — Phase 18 adds no storefront UI, but the order edit screen has not been looked at. |
| Phase 18 — two post-implementation sweeps | 2026-09-08 | Notes **§1.23.11**. **Sweep 1** asked whether the brand-new fulfilment guard had the shape Phase 17's sweeps kept finding, and it did. Two staff, two requests, two transactions, both reading `processing` before either wrote: the ship succeeded, and the cancel **also** succeeded — a transition the machine calls impossible — leaving `final: cancelled, shippedAt = null`, with the carrier, the tracking number and the dispatch stamp wiped by the loser's stale document, after §18.1c had already triggered a shipment email for a parcel the record now says was never sent. Fixed with **`SELECT ... FOR UPDATE`** rather than a conditional `UPDATE`: this write goes through Payload because it must pass validation, run the remaining hooks and produce a document the panel can render, and a lock is the version of the same guarantee that works when something else does the writing. The interleaving is worth recording — **the first attempt to reproduce it passed**, because two `payload.update` calls fired together serialise on their own; the failure needs the second write in flight while the first still holds the row, which section J now sets up deliberately. Sweep 1 also found, by reading, that the tracking condition used `data.carrier ?? original.carrier` and `??` reads straight past an explicit `null`, so **one write could dispatch an order and clear the carrier it was dispatched with**. What held: the full-document re-save, checked because `unitPriceMinor` coming back as a string would have made every order line unsaveable and no existing test would have caught it. **Sweep 2** went after the class rather than the instance — *a rule stated in a docblock with nothing enforcing it* — by grepping for `readOnly: true` with no field access beside it. Fourteen hits, **four real**: `orders.stripePaymentIntentId` and `stripeCheckoutSessionId`, where the payment-intent field's own docblock names the danger (*"a hand-typed payment intent is an order attached to somebody else's money"*) and nothing stopped anyone typing it; `orders.paidAt`, which would be a lie about when money moved; and `promotions.timesUsed`, which is what `usageLimit` is measured against. All four closed with `nobodyField`, which `overrideAccess` skips. **And one investigated and correctly left alone** — `products.derived` has the same shape, and guarding it would have broken the cache it protects, because `syncProductDerived` writes with `req` and no `overrideAccess`: the shape is not the whole story, what matters is whether the maintaining code goes through the same door. Sweep 2 also reversed a precedence that had been reasoned about and still landed wrong — an order **cancelled and then refunded** read as *"Cancelled. Nothing was dispatched."*, true and silent about the money; the check beside it had quietly excluded `refunded`, which was the tell that the corner was noticed and never decided. And it found `preflight.ts` doing a find-then-create on `orders.cart`, so two simultaneous checkouts make **two pending orders for one bag** — **recorded, not fixed**, with the reasoning stated: each order is individually correct, a second charge needs a second card entry, and the fix is a partial unique index plus a retry in the checkout path, which changes how checkout fails and deserves more than the last hour of a sweep. The claims field access had only been *making* are now measured. `verify:orders` **74 checks**, up from 62; every other harness re-run unchanged; typecheck, lint --max-warnings 0 and build pass. |
| Phase 19 — email / Resend | 2026-09-09 | Notes **§1.24**. Three dependencies at their pins — `resend@6.22.0`, `@react-email/components@1.0.12`, `react-email@6.9.2` (dev) — and one migration: `email_messages` with a **unique** `dedupe_key`. §19.1a's *"do not call Resend directly from random components"* is structural: `resend` appears in exactly one import, and everything above it deals in a `Transport` function, which is why the one integration nobody has credentials for has 85 passing checks and needs no API key. **§19.1c is a constraint, not a check** — the insert *is* the duplicate test, the Phase 17 mechanism reused. The key names **the thing that happened, never the message that reported it**: an event id would double-send, because Stripe sends two events for one payment, and would miss the shipped notice entirely, which has no event at all. Two duplicate shapes had to be handled — Payload validates uniqueness *before* inserting, so a sequential retry arrives as a `ValidationError`, while a genuine race passes that read-then-write twice and the database refuses the second with 23505; matching only the first would have logged a fault every time the barrier worked. **The queue exists because Payload 3 has no post-commit collection hook** — `afterChange` and `afterOperation` both run before `commitTransaction`, measured in `node_modules`, so a dispatch email sent there would announce a dispatch that could still roll back; intent is written inside the transaction and delivery happens outside. §19.1d is absolute: nothing in the service throws, because the webhook turns a throw into a 500 and Stripe's retry is then refused by the unique event id **without reprocessing** — one thrown mail error would lose a customer's confirmation permanently. The dev safeguard gates the **destination, not the credential**, because Resend has no test-mode key: outside production only `EMAIL_DEV_ALLOWLIST` is deliverable and an empty list delivers to nobody. **The `server-only` lesson arrived a fourth time, inverted** — the guard was correctly on the module holding the key and still had to come off, because `payload.config.ts` now imports the service and the CLI loads it outside Next; `catalog/algolia.ts` had already recorded the answer, and the rule gains a second half: never on a module the CLI has to load. Deviations **DEV-65** (the plan's eight templates, not the features doc's ten, with the *order cancelled* case argued rather than dropped), **DEV-66** (verification and contact confirmation written, tested and unwired — neither has a caller), **DEV-67** (no scheduled drain). **DEV-64 discharged.** New scripts `pnpm verify:email`, `pnpm email:drain`, `pnpm email:preview`; `logEmailAdapter` removed and replaced. Every other harness re-run unchanged; typecheck, lint `--max-warnings 0` and build all pass. |
| Phase 20 — wishlist, account, recently viewed | 2026-09-09 | Notes **§1.25**. **No dependency and no migration**: `WishlistItems` was built to §6.1m in Phase 6 and already carried the compound unique index on `(customer, product)` with both columns required — so §20.1b's *"existing customer wishlist wins duplicates"* was already enforced by Postgres rather than by whichever code path ran first, the same mechanism as Phase 19's `dedupeKey` and Phase 17's event id. **The guest merge could not copy the cart's** (**DEV-68**): a guest cart is a database row named by a cookie, a guest wishlist is `localStorage`, and no server action can read a browser's storage — so the merge is client-initiated, has no parameter for whose list it is, validates every id against the published catalogue, is capped on the way in, and clears the device copy only on success. **`ProductCard` had to be restructured**: it was one `<Link>` around everything, and a heart in the obvious place would have put a `<button>` inside an `<a>` — invalid HTML that browsers recover from inconsistently, leaving the control unreachable by keyboard. It is now a wrapper, a link, and the control as its **sibling**, which is §11.1c's *"click wishlist → prevent card navigation"* solved structurally rather than with `stopPropagation`. The heart is **opt-in per call site**, because two of the five places the card renders are inside the bag drawer where each card sits in an `<li onClick={close}>`. One control, two mechanisms, and the customer is told which — a guest sees *"saved on this device"*, and the signed-out branch is deliberately not a form because there is no server for it to post to. Recently-viewed renders **nothing on the server**: its server snapshot is the empty list so hydration cannot flicker, and *"do not store sensitive personal information"* holds by construction because the parser can only represent a positive integer. `createLocalList` factors the `useSyncExternalStore` pattern out of `search-panel.tsx`, now that it is needed three times. The lint rule earned its keep: the rail's first version cleared its own state inside an effect and `react-hooks/set-state-in-effect` refused it, so the empty case is derived at render. Account: five navigable routes plus `[order]`, guard still per-page, and **the order route takes the order number rather than the database id** — an id is a running count of every order the shop has taken. A cross-account request is **not found, never forbidden**, because a 403 would confirm which order numbers are real. `/account/addresses` can add and remove because checkout snapshots onto the order and never writes to `addresses`, so a read-only screen would have been a page that looks like a feature and cannot do anything. **DEV-45 discharged.** New harness `pnpm verify:account` — 40 checks covering the two things the phase prompt names by title, cross-account access prevention and merge behaviour. **It has never been run**: the Neon password died during Phase 19's sweep, so `pnpm build` and all fifteen harnesses are blocked and only typecheck and lint could be gated. Recorded in `TODO.md` and in §1.25.8 rather than glossed. |
| Phase 21 — reviews | 2026-09-09 | Notes **§1.26**. **No dependency and no migration** — `Reviews` was built to §6.1j in Phase 6 with every field, every bound, and the compound unique index on `(product, customer)` whose `customer` column was made **required** precisely so the index would bite, since Postgres treats NULLs as distinct. **The corpus disagrees with itself twice** and `AGENTS.md`'s precedence settled both (**DEV-69**): a purchase is a **badge, not a gate**, because the plan hedges twice while the matrix implies a gate — and a shop that only accepts reviews from buyers has none on a new product, which is when a customer most wants one; and the bar is **paid**, not the matrix's *"not delivered yet"*, with a refunded order still verifying because the customer did buy it. **Three things the browser cannot decide, each closed differently**: `status` defaults to pending *and* the field is staff-only, so a review lands pending through any door; `verifiedPurchase` is staff-only and set from an order lookup, because a badge the submitter can assert is not a badge; `customer` is *forced* by `enforceCustomerOwnership`, since `create: isActiveCustomer` alone would accept `POST /api/reviews` with somebody else's id. **The duplicate is caught by the index, not before it** — the newsletter action had already recorded that read-then-create is both a concurrency bug and a measurable timing oracle. §13.1f's *"do not show an empty star histogram"* is honoured literally: five bars at zero reads as five one-star reviews, so an unreviewed product gets one sentence and no chart, and the average is **`null`, never `0`** — the same distinction `lib/money.ts` makes for a price. Aggregates are computed from the same rows that render, because two queries can disagree and the failure is a page claiming forty-one reviews above a list of forty. Three deviations: **DEV-69** (badge not gate), **DEV-70** (no profanity filter — a word list publishes what it misses and rejects what it misreads, and a person already reads every review), **DEV-71** (no review photos — `media.create` is staff-only and **D-28** says media bytes are public the moment they are uploaded, so an unmoderated review photo would be fetchable before anyone saw it; the column stays, the upload path is a design question). Rate limiting is Phase 26's Turnstile and is recorded as owed without overclaiming. New harness `pnpm verify:reviews` — 30 checks covering the two tests the prompt names by title plus §21.1a's paid-order match and the cases that must NOT verify. **Never run**: the Neon password has been invalid since Phase 19's sweep, so only typecheck and lint could be gated. See `TODO.md`. |
| Phase 22 — shop the look | 2026-09-09 | Notes **§1.27**. **No dependency, no migration, and no new component library** — `radix-ui@1.6.7` already ships `@radix-ui/react-popover`. §22 is unusually thin: no route, no test list, no acceptance gate. What it names is §22.1d's six numbered steps and a prohibition repeated twice — *"do not guess sizes silently"*, *"never silently guess unavailable or missing variants"* — and that prohibition is the phase. Phase 6 had already built §22.1a's fields (four coordinates as **percentages**, so *"do not hard-code hotspot coordinates in React"* was satisfied before this phase began) and Phase 10 had already shipped the marker, having named its own successor: *"a marker that opened an empty dialog would be §0.1.17's fake control."* **The naive upgrade would have broken the clause the plan did not have to state** (**DEV-72**): turning the marker into a button satisfies three of §22.1c's four clauses and breaks *"allow full PDP navigation"* — and breaks something §22.1c never mentions, because Phase 10's marker works with **no JavaScript**. So the trigger is still the anchor, wrapped in `Popover.Trigger asChild` with its default prevented: with JS the preview opens, without it the anchor navigates, and the preview **offers** the product page rather than replacing it. A **Popover, not a Dialog** — a preview is anchored to what opened it and does not deserve a focus trap, a scrim or a scroll lock; and the shell's `overlay-context` is deliberately not reused, because it exists for overlays with **no trigger in their own subtree** and would also enter a mutual-exclusion machine that closes the bag. Radix supplies the ARIA Phase 9 once got wrong by hand. **The preview is fetched when opened**, not when rendered: four blocks × eight markers would be thirty-two stock queries paid by everyone for a section most visitors never touch — and it means availability is resolved as it is *now*. §22.1d's step 3 is enforced by a **type**: products needing a size come back in a bucket carrying no variant to add, so a caller cannot guess by accident. One purchasable variant is not a guess (it is the single available thing); picking medium out of three in stock is. Step 6's report **separates the two reasons** — *"needs a size"* is a ten-second fix and *"not available"* is a dead end, and *"2 items skipped"* is neither. The count reported is what actually landed, since `addToCart` re-checks live stock. **`/lookbook` still 404s** and that is deliberate: §22 names no route, the page is Phase 23's, and building it here would be building a later phase early. New harness `pnpm verify:lookbook` — 20 checks asserting the prohibition, because §22 sets no tests of its own. **Never run**: the Neon password has been invalid since Phase 19's sweep. Owed: a browser pass on hotspot alignment, where `reserveBox`'s unguarded 16:9 fallback for a media record with no stored dimensions is the one path that could silently drift every marker. |
| Phase 23 — editorial, collections, journal | 2026-09-09 | Notes **§1.28**. **No dependency and no migration** — the fourth phase running — and six new routes: `/collections/[slug]`, `/edits/[slug]` (renamed `/edit/[slug]` in Phase 30, §1.35.1), `/lookbook`, `/lookbook/[slug]`, `/journal`, `/journal/[slug]`. **Two blocks had been authorable for seventeen phases and rendered nothing**: `gallery` and `pullQuote` have been on `collections.body` and `edits.body` since Phase 6 with no resolver case and no component anywhere, so an editor could compose one, publish, and find the section absent — §0.1.17's rule inverted, a CMS field that silently discards work. Invisible until now because no route rendered a body. **Two block resolvers now exist on purpose**: `home/resolve.ts`'s is module-private and typed to the Homepage union, and widening it would make the homepage's exhaustive `never` default reject two blocks the homepage can never receive. **A collection page is not a filterable grid** — DEV-09 ruled that out, and reusing `CatalogPage` would also have been a live defect: `requiresSearchIndex()` sends any collection query to Algolia, because membership is a Payload `join` with no column, so the page would have rendered **nothing at all** whenever the search service was down while every other listing survived. Reading the ordered id list through Postgres keeps it working with no search service and keeps the curator's order. **Featured products without a new field**: `Collections.products` is ordered and its own description says *"dragging a row is the curation"* — the front of a curated list is what featured means, resolved from the same cards as the grid so the two cannot disagree. **Products are never read through the relationship at depth**: `publishedOnly` checks `status` and explicitly not `publishedAt`, and knows nothing about `derived.priceFromMinor`, so a depth-populated grid would have shown scheduled drops and withdrawn garments. **The navigation has been broken since Phase 9 and is not any more** — `/lookbook` and `documentHref`'s `/lookbook/<slug>` both 404'd; building either alone would have left the other broken. §23.1c's *"avoid creating an editorial dead end"* is designed against rather than avoided: three exits per article, each resolved through the published rules so a withdrawn product is not offered rather than offered as a 404, and a fallback exit when an editor filled in none of them. New harness `pnpm verify:editorial` — 24 checks covering the four failure cases the prompt names by title. **Never run**: the Neon password has been invalid since Phase 19's sweep. Owed: a browser pass over six routes that have never rendered, `/collections` and `/edits` indexes, `generateMetadata` (Phase 24), and the contact form (**G-08**), which is still the missing caller for Phase 19's contact template. |
| Phase 24 — search engine optimization | 2026-09-09 | Notes **§1.29**. **No dependency and no migration** — the fifth phase running. **Three site-wide CMS fields and a nine-collection field group had been authorable since Phase 6 and read by nothing**: `defaultSeoTitle`, `defaultSeoDescription`, `defaultOgImage` and `seoField()`'s title/description/image. `SiteSettings.ts` and `seo.ts` both named Phase 24 as the phase that would read them; both promises are kept, and the precedence — document override, then page content, then site default, then built-in — is stated once in `pageMetadata`. An **emptied override is not an override**: a cleared field means *derive it*, never *publish an empty tag*. **§24.1b is enforced by shape, not by a check**: offers are built only from variants that are active, in stock and priced, so a sold-out size cannot set the price; nothing buyable emits `OutOfStock` **with no price at all**, because a price nobody can pay is the forbidden claim; a product with no variants emits no `offers` key; and `aggregateRating` appears only when a real approved review exists — no key, not a zero, not five stars from nobody. **`getProduct`'s memoisation did not apply to its second caller**: React's `cache` compares arguments with `Object.is`, so two callers passing `{ color: null, size: null }` both ran the queries — memoisation that silently does not apply is worse than none. Split into `getProductRecord(slug)`, keyed by a string, with the variant matrix built on top. **The canonical never comes from the request** (Phase 7's host-header argument) and never carries a query — `/shop`'s nine parameters and `/product/x?size=m` are one page each. **The homepage exported no metadata at all**, to dodge the *"NORTH / 01 · NORTH / 01"* title template — which cost the front page its canonical and its OG card; `absoluteTitle` is the answer, and the layout's metadata now reads the site name from the CMS. **`robots.txt` needs three rules per prefix**: `/account/` misses `/account`, `/account` blocks `/accounts-payable`, and an RFC 9309 matched path includes the query string, so neither touches `/search?q=` — the exclusion's whole point. One shared constant with the sitemap, because the two disagreeing is the classic SEO defect. **JSON-LD is escaped**: a raw-text element ends at the first literal `</script`, and every value in it comes from the database. New harness `pnpm verify:seo` — **90/90, and the first in this project that touches no database**, so no D-10 guard: everything §24 decides is a pure function. `pnpm build` passed — the first since Phase 18 — and `robots.txt` and `sitemap.xml` were read back out of the build output (35 URLs from real data) rather than assumed. Two stale docblock claims corrected: the homepage has **not** been statically prerendered since Phase 9 (the layout awaits `cookies()`), and four routes' *"SEO is Phase 24"* notes now say what was decided. Owed: `/collections` and `/edits` indexes, `generateStaticParams` (Phase 30), `priceValidUntil` and `shippingDetails` (neither claimable today), a browser pass, and the five harnesses D-10 still holds until a **development** connection string exists. |
| Phase 25 — analytics and observability | 2026-09-09 | Notes **§1.30**. **Three dependencies installed at their pins** (`posthog-js` 1.418.10, `@sentry/nextjs` 10.70.0, `@vercel/speed-insights` 2.0.0); GA4 is a script tag; no migration. **The taxonomy is a type**: `AnalyticsEvent` is a union of exactly §25.1a's seventeen names and `trackEvent` takes it, so a typo is a compile error rather than an empty dashboard column — and the internal names *are* the GA4 names for the ten that overlap, because a translation table is somewhere for the two to drift invisibly. **Money crosses the vendor boundary once**, in `toGa4Params`: a price field that is sometimes cents and sometimes dollars reports revenue a hundred times too high and is not recoverable, so the conversion is pure and asserted — including that a zero value is a real zero and an unknown value is absent. **Server Components stayed server components**: `ProductCard` gained two data attributes and `TrackList` delegates from the grid wrapper in the capture phase, rather than an `onClick` converting the most-rendered component in the shop and everything it renders. **Every event is emitted where it is true, not where it was clicked** — `addToBagAction` can refuse, and an `add_to_cart` on the click would report adds that never happened; `useActionResult` fires on the action's result, guarded by reference identity. **`purchase` is gated on the webhook**, not on arrival (§17.1g), and deduped in `sessionStorage` by order number, because the success URL is refreshable and a double-count doubles reported revenue. **§25.1d is enforced on the way out**, on two independent grounds — by key and by value — with cookies and headers dropped rather than scrubbed, the user reduced to an id, and the URL keeping its route while losing its token; the whole-URL pattern runs before the email pattern, or a Postgres URL is left with its host and password intact. **Two of the seventeen events are deliberately not emitted**: `add_payment_info` (**DEV-73** — Stripe Checkout is hosted, this application never sees payment details, and firing it at redirect would report leaving for Stripe as entering a card) and `quick_view_opened` (**DEV-74** — no quick view exists). Sentry is wired into four entry points because Next has four kinds of failure; `global-error.tsx` renders `error.digest` and never `error.message`, per §4.1b. **`@sentry/cli`'s postinstall is denied** in `pnpm-workspace.yaml` — source-map upload is off, so **production stack traces will be minified**, stated rather than discovered. §25.1e honoured as the schedule it is: Speed Insights renders in production only, and a second gate lives in the Vercel dashboard. New harness `pnpm verify:analytics` — **89/89**, the second in this project that touches no database. What it cannot cover is the prompt's own *"verify events in local/preview"*: no account exists, and `TODO.md` §6 says so. New gap **G-17**: no consent gate in front of any vendor. |
| Phase 26 — security and bot protection | 2026-09-09 | Notes **§1.31**. **No dependency added**; one upgraded, and that is the phase's most consequential change: `next@16.3.2` carried **two CRITICAL unauthenticated RCE advisories** — Windows-hosted servers, and the Image Optimization API with AVIF — both fixed in `16.3.3`, which is still inside `@payloadcms/next@3.88.0`'s range. Overrides added for `fast-uri` (2 SSRF, 2 host confusion), `js-yaml` and `sharp`. **`pnpm audit` went from 9 findings (2 critical, 6 high, 1 moderate) to 1 moderate** — and that one, Payload's default `unlock` access letting any authenticated user clear anyone's lockout, **was already closed in config two phases ago**: `Customers.ts` is staff-only and `Users.ts` admin-only. Verified by reading them, not assumed; the first instinct was to add the rules, which would have been a duplicate key. The named upgrade `payload@3.88.1` is unavailable because every `@payloadcms/*` package pins an exact peer on 3.88.0. **§26.1a's own sentence is the design**: delete the widget and every guarded form starts **refusing**, because `verifyTurnstile` reads the configured state from the **server** environment rather than taking a flag from its caller — no argument a call site can pass and no field a client can omit turns a required verification into a skipped one. Wired into newsletter, review submission, registration and **login** (§26.1a's *"where abuse warrants it"*, answered by what the form is rather than by whether abuse has been seen yet), each **before** validation so a refusal costs no query and no field-by-field critique. **DEV-75**: unconfigured skips, an outage **refuses** — the one control in this project that fails closed, because the cost of degrading here is no bot protection on exactly the forms being hammered, by an attacker who can cause the outage they benefit from. One sentence for every failure; the reason logged, never shown. **§26.1b's one real finding was API depth**: Payload defaults `maxDepth` to 10 on a public REST surface, which is an amplification primitive — capped at 3, one above the project's deepest read. Everything else in §26.1b was verified rather than changed. **§26.1c**: no `dangerouslySetInnerHTML` renders CMS content anywhere (the only one is `JsonLd`, which escapes first); uploads are a six-entry allowlist with no SVG and no PDF; `isSameSitePath` refuses control characters so a `Location:` cannot ride a newline. **§26.1d** is a committed scan rather than a grep somebody ran: `pnpm scan:secrets`, whose first Resend pattern matched **English** (`Structure_Current_…`, `figure_mobile_image_idx`) and whose four real hits were the redaction harness's own fixtures — resolved by marking them `EXAMPLE` rather than allowlisting `scripts/`, which would be a hole exactly where a real key gets pasted while debugging. Clean across 388 files. New harness `pnpm verify:security` — **51/51**, the third that opens no connection. Owed: Turnstile keys (`TODO.md` §7), the contact form (**G-08**, now owed by two phases), a browser pass over four forms that have never rendered a widget, and `payload@3.88.1` when its peers catch up. |
| Phase 27 — testing strategy | 2026-09-09 | Notes **§1.32**. **Eight dependencies at exact pins**, no migration. **813 Vitest tests across 18 files, all green; 57 Playwright tests across 5 files, none ever executed.** Two Vitest projects rather than one — `unit` in Node, `components` in jsdom — so a module claiming to be pure **fails** if it reaches for `window` instead of passing by accident, which is the one place that boundary was otherwise invisible. `server-only` is aliased to an empty module for the same reason the Payload CLI cannot resolve it. **The tests found five defects, and that is the phase's actual output**: `invalidSelection` never fired for the case feature matrix §7 names by title (`?color=Cream&size=M` where Black/M exists — the live region explaining it said nothing); a merged cart line of quantity zero was reported **sold out while fully in stock**, because `clampQuantity` returns `clampedBy: null` for a request of none and the merge defaulted it; `combined` counted occurrences rather than bags, contradicting its own field doc; `canFulfillmentTransition` **threw a TypeError** on a status read from the database that the table does not contain; and the search panel could **take the whole overlay down** — `CSS.escape('')` is `''`, so the selector became `'#'`, which `querySelector` throws on, reachable by arrowing to a late option and clearing recent searches in another tab. `FULFILLMENT_COPY.notPaid` also told an operator something untrue about a refunded order. **One reported defect was deliberately not fixed** and the reasoning put in the source: `cartTotals` counting unpriced units is unreachable (`cart.ts` filters first) and the behaviour is a written §14.1e decision — making an unreachable path disagree with a documented decision is not a fix. **The quantity control's own tests were wrong instructively**: three failed and **two passed for entirely the wrong reason**, because a controlled `type="number"` snaps back between keystrokes and `clear()` + `type('8')` produces 18. **The E2E suite cannot run** — it creates customers, bags and Stripe sessions, and the only reachable database is production (D-10), which §27.1f's own *"where environment permits"* anticipates. Flow 4 (quick view) is skipped because the feature does not exist (**DEV-74**); flow 7 signs its events offline rather than speaking to Stripe; flow 6 is the retained real test-mode path. All fifteen §27.1d cases are enumerated even where four can only be skipped, because a list with a hole in it is how a case gets forgotten. **The CI pipeline would have skipped its own build**: `if: env.DATABASE_URL != ''` cannot see that step's own `env:` block, so the condition read an empty string and the build never ran — a skipped step reporting success, invisible until somebody reads a log. New gap: five latent `Math.max(1, …)` traps, all currently unreachable, recorded rather than changed. |
| Phase 28 — admin experience | 2026-09-09 | Notes **§1.33**. **No dependency and no migration** — `migrate:create` reports no schema changes, because everything here is admin metadata, field access, a hook or a validation; the one new field, `promotions.liveNow`, is `virtual`. **Two findings were bugs, not missing config.** `admin.readOnly` on `products.derived` was decorative — Payload's readOnly is a widget attribute and the value stays in the submit body — so the ordinary flow (open product → add sizes in the drawer → save) **wrote back the pre-variant copy of `derived`**, nulled `priceFromMinor` and withdrew the product from the shop on a save the editor thought was a no-op. And every money column on an order was freely editable by staff, in the panel and over REST, on a record with no version history: the closest thing to a fake refund this admin permitted was typing a smaller total. **§28.1d's one missing guardrail** was publishing a product with no active priced variant — the save succeeded, the sidebar said Published, and `publishedProductWhere` then hid it from the shop, search and the sitemap with no message anywhere, because the rule that hid it lives in a query an editor never sees. Now refused on the transition, reading the same column that query reads. Duplicate deliberately slips past it (verified against Payload's source: a duplicate saves immediately, so refusing leaves an error with no form to act on it), and a missing image is deliberately not malformed, because §8.1d answers one with a placeholder. The other four guardrails already existed and were **verified rather than assumed**, including that Postgres refuses negative stock (23514) and duplicate SKUs (23505) past validation entirely. **No `admin.components` were added at all** — the prompt forbids unnecessary dashboard complexity, and everything is description, access, validate, filterOptions or a hook. **Sweep 1: the footer pointed at eight routes and none of them existed** — every Help and legal link, on every page. Three are now real and their content had been in the CMS for phases (`/help/faq` renders a collection that rendered NOWHERE — Phase 23's defect again); the rest are removed rather than faked, and Privacy/Terms are refused on principle because inventing privacy copy is a false statement about personal data on the page a regulator reads first (gap **G-19**). Also: `seoField()`'s `publishedAt` description was true of products and false for the four editorial collections, and a moderator could rewrite a customer's review body and rating — §21.1b defines moderation as three states, not as authoring. **Sweep 2** verified the Duplicate escape against Payload's own source rather than a report, and found the hole in the **harness**: it proved the payment axis could not be typed and never touched the amounts Phase 28 had just locked. New harness `pnpm verify:admin` — **87/87**. |
| Phase 29 — content seeding and demo data | 2026-09-10 | Notes **§1.34**. **No dependency and no migration.** Ten products became **twenty-eight** across all ten categories §29.1b names, and **every harness in the project ran and passed for the first time — 1,819 checks across twenty-two**, plus 813 Vitest tests. The seed writes customers, orders and reviews, reversing an argument it had made since Phase 6 (*"a commerce demo whose order list is fiction is worse than one whose order list is empty"*) — because four features cannot be demonstrated empty, and the docblock now makes that argument rather than contradicting it. Kept honest by `@example.test` addresses that cannot receive mail (Phase 19's queue would try), a `verifiedPurchase` badge set only where a paid order really exists, varied ratings including a pending and a rejected, and passwords in a git-ignored file. **`generate:media` duplicated all 78 assets on a second run** — and the obvious repair, `--clean`, would have taken **production's images down**, because development and production address the same Cloudinary objects; every field was repointed at the ORIGINAL instead and only the new copies deleted. Every loop is incremental now. **Sweep 1 ran twenty-two harnesses and four were wrong**: `verify:lookbook` and `verify:editorial` could not start at all (the third instance of the `server-only`-under-the-CLI trap, fixed with a tsconfig path whose safety was **verified** by making the build refuse a real leak); `verify:account` failed nine checks against correct behaviour, its Phase 20 fixture having never run; `verify:shell` asserted a footer row Phase 28 deliberately emptied. And **`verify:catalog` found a real defect twenty-seven phases could not**: Postgres broke a price tie on `slug` and the Algolia replicas broke it on nothing, which passed for ten products with ten distinct prices and failed the moment twenty-eight produced four ties — both engines now end on `asc(sortOrder)`, a total order on both sides. The harness itself was also wrong, filtering its fixtures out of one engine's page after fetching rather than in the query. **Sweep 2: eighteen of twenty-eight products belonged to no collection**, so they were reachable only from the shop grid — absent from `/collections/*`, the homepage feature and the collection filter facet. Idempotency is asserted by running both scripts twice and comparing counts, not by reading the upserts and believing them. |
| Phase 30 — performance and responsive polish | 2026-09-11 | Notes **§1.35**. **No dependency and no migration.** The phase opened by asking a browser for every navigation href and found four 404s: Phase 23 had built `/edits/[slug]` while every link in the shop said `/edit/`, and `/collections` and `/edit` had no index at all. **The product page spent 2.1s before its first byte**, none of it images: a depth-2 read populating a discarded variants join, two independent reads awaited in series, and no storefront read anywhere turning off joins — 2.09s → 1.07s, with collection and edit pages close behind. **First-load JavaScript fell about a third** (home 369,897 → 256,295 B gzip): all of Zod shipped to every route to re-check ten public strings the server had validated at boot, and the Sentry SDK shipped with no DSN configured; ESLint now forbids both in the files every client graph contains. **Sweep 1's worst finding was the phase's own regression** — a populate-select without `status` dropped every lookbook hotspot, missed by a DOM diff whose fixtures had no hotspot to lose; `verify:editorial` now resolves every lookbook two ways and was proven by putting the bug back. Sweep 1 also fixed a 0.36-CLS gallery shift on choosing a size, a mobile filter drawer that closed after every tick (it lived inside a keyed Suspense boundary), a cart page that scrolled sideways at 320, a cart drawer that showed no lines in landscape, 14px inputs that made iOS zoom, and a CLI path that orphaned a search-index record on every `verify:search` run. **Sweep 2 found that no shop-the-look hotspot had ever opened** — since Phase 22, a `preventDefault` meant to stop the anchor also stopped Radix's toggle — and that Add to bag opened nothing, though structure §13 draws the drawer. Mid-sweep the development database stopped accepting its password after production moved to a new Neon account; it was rebuilt on `ep-wandering-surf-ax7ia116` with the project's own idempotent scripts, and every harness passed on it: **1,829 checks**, plus 815 Vitest tests. **DEV-07 amended** from six primary items to five: ABOUT had no page behind it. |
| Phase 31 — error, empty and loading states | 2026-09-11 | Notes **§1.36**. **One migration** (`cart_items.price_seen_minor`, nullable, display only), no dependency. **Began with a live leak from Phase 30's deploy**: the GA4 ID was already in Vercel, so that build was the first to load `gtag`, whose `page_location` carried every opened password-reset link's token to Google — hotfixed (`95c040b`) and verified with every vendor request intercepted, with one source of page views and idle loading. **The storefront now survives a database outage**: measured with a second server on a wrong password, every route including `/help/faq` was a bare 500 because the root layout's customer and bag reads threw; they degrade to a signed-out shell, and a new `(frontend)/error.tsx` renders inside it with retry. A malformed URL is a branded 404, not a 21-byte 500. Turnstile explains itself when blocked (it was locking sign-in with "try again") and the footer newsletter loads it on first focus. The success page says what happened for each payment status; an unreadable order is not reported as a missing one; an expired session is a sign-in, not "your bag is empty" — which required keeping the bag cookie through sign-in. "Price changed" now exists. The degraded search no longer announces "No products" or offers controls that can change nothing. **The build caught one of the phase's own fixes**: a `try/catch` swallowed Next's dynamic-usage interrupt and would have made per-visitor routes static with a signed-out shell baked in — `unstable_rethrow` first. 829 tests; all 22 harnesses. |
| Phase 32 — deployment to Vercel | 2026-09-11 | Notes **§1.37**. No dependency, no migration. **The dashboard settings were documented, not changed from the CLI** — production's environment is the owner's decision — in a new `docs/DEPLOYMENT.md` (plan §38's missing deployment document) and TODO.md §8: Production `SITE_URL` is the team alias, Preview has no variables so no preview can build, the production search index has never been built, no function region, no queued builds, no CI secrets. **What the repository could carry, it now does**: the six-step migration procedure (§32.1d) and rollback; `pnpm smoke <url>`, a read-only post-deployment smoke test whose first production run passed 9, warned 3 (the canonical and sitemap host, and search) and failed none; Node pinned to 22.x (Vercel was running 24.x, which no gate had exercised); a preview's `SITE_URL` resolves to its own branch alias instead of production, so preview reset links and Stripe returns stop pointing at the live shop; and DEV-67's scheduled drain, a daily Vercel Cron answering only a constant-time-compared `CRON_SECRET`. |
| Phase 33 — Cloudflare, domain and DNS | 2026-09-11 | Notes **§1.38**. No dependency, no migration, no custom domain yet. **One part was not future work**: Payload's CSRF allowlist defaulted to `SITE_URL` alone, and production's `SITE_URL` is the team alias while customers use the public host — so every signed-in Server Action there ran as a guest (*"Sign in to save an address"* to a signed-in customer), and the UI sign-out cleared the cookie without revoking the session (audit R1-14). `csrf` is now every origin the deployment answers on, from platform-set values only (`lib/trusted-origins.ts`, unit-tested); reproduced and fixed on a non-canonical origin — the address saved, the old token dead after sign-out — and pushed at once. **The domain procedure is `docs/DEPLOYMENT.md` §11**: existing records inspected first (the team's unrelated domain untouched; HTTPS and HSTS on the Vercel host), apex and `www` with Vercel's edge redirect as the canonical-host rule, unproxied Cloudflare records with the Domains page as the source of truth, every service that names the host, and Resend's DKIM, MX, SPF and DMARC by shape — values not reproduced because they are region-specific, and email not called production-ready until Resend says Verified. |
> **Append this table, and the sections above it, at the end of every phase.**
