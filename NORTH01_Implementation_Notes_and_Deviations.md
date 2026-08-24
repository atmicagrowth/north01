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

# 3. Append log

| Phase | Date | Added |
|---|---|---|
| Phase 1 — Workspace, repository and baseline | 2026-08-22 | Document created. Notes §1.1–§1.6; deviations DEV-01 through DEV-14. |
| Phase 2 — scaffold | 2026-08-22 | Notes §1.7.1: resolved install (706 packages, 16 direct), pnpm 11 `allowBuilds`, native flat ESLint config, Next-generated agent files, tsconfig rewrite, Prettier scope. Closed both §1.4 hazards. Corrected §1.5 — Neon moves from Phase 5 to Phase 2. Deviations **DEV-15**, **DEV-16**. |
| Phase 2 — Gate 1 closed | 2026-08-22 | Notes §1.7.2: all six Gate 1 criteria verified against Neon PostgreSQL 17.11, full Payload auth round-trip, runtime confirmation of D-08, the PG 17-vs-18 reasoning. **DEV-17 withdrawn** — it contradicted plan §5.1d; push is development-only. Neon unblocked in §1.5. |
| Phase 2 — debt clearance | 2026-08-23 | Notes §1.7.4: empty-string env fallbacks replaced with fail-fast (§4.1b), `sslmode` hardened to `verify-full` (closes the pg-v9 item), `/api` namespace sharing verified empirically and the collision rule recorded for Phase 6. |
| Phase 2 — visual review | 2026-08-23 | Note §1.7.6: the baseline page reviewed in a real browser at 1440×900 and 390×844 against the visual guide — palette, visual tension, guardrails and responsive behaviour all measured rather than eyeballed. Closes step 8 of the phase completion gate, which the earlier Phase 2 commits had skipped. Records the port-identity hazard found while doing it. |
| Phase 2 — append audit | 2026-08-23 | Structural corrections to this document. Phase 2 notes renumbered from `1.5a–1.5c`, which sat *before* §1.5 and implied they subdivided it, to **§1.7** with subsections. Append log put back in date order. Step 4 of the append rule carried out and recorded as **§1.7.3** — **DEV-04** and **DEV-14** confirmed; DEV-05 (Phase 8) and DEV-03 (Phase 18) still pending, not due. **DEV-18** and **DEV-19** moved to §1.7.5: both recorded compliance, not departure, and did not belong in Section 2. |

> **Append this table, and the sections above it, at the end of every phase.**
