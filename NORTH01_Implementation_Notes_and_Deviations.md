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
| **DEV-07** — six primary nav items, including NEW | Phase 9 | **Encoded**, and **discharged in Phase 9** — rendered as NEW · SHOP · COLLECTIONS · EDIT · LOOKBOOK · ABOUT and asserted against both the resolved data and the DOM. See §1.14.10. |
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
- **SEO metadata and product structured data** — Phase 24. `seoField()` is already on the collection.
- **`generateStaticParams`** — a Phase 30 question, and not obviously right for a page that reads live
  stock.

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

### DEV-44 — The hero is a stacked composition; no type is set over the campaign photograph

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

*Affects Phase 11. Discharged by Phases 13, 14 and 20.*

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

> **Append this table, and the sections above it, at the end of every phase.**
