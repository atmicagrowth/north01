# NORTH / 01 — Resolved Stack Versions

> Required by the master implementation plan, §1.2 "Version strategy" and §2.1a "Choose compatible versions".
>
> **Rule:** versions here are chosen from *verified compatibility evidence*, never from the npm `latest` tag.
> Every pin below is justified. Re-verify before any core upgrade and re-run the Gate 1 checks.

**Verified:** 2026-08-22 (pins) · **Installed and proven:** 2026-08-22, Phase 2; re-proven 2026-08-27, Phase 6 · **Verification method:** npm registry metadata (`npm view <pkg> peerDependencies engines`) plus a
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
| `next` | 16.3.3 | **Security patch, Phase 26.** `16.3.2` carries two CRITICAL advisories — unauthenticated RCE on Windows-hosted servers, and unauthenticated RCE in the Image Optimization API with AVIF. Both fixed in `16.3.3`, which is still inside `@payloadcms/next@3.88.0`'s range `>=16.2.6 <17.0.0`. A patch bump is exactly the *evidence* this table asks for. |
| `react` / `react-dom` | 19.2.8 | Satisfies Next 16 (`^19.0.0`) and Payload's stricter `^19.0.1 \|\| ^19.1.2 \|\| ^19.2.1`. |
| `payload` | 3.88.0 | Current stable `latest`. **Payload 4.x is canary only — excluded.** |
| `@payloadcms/next` | 3.88.0 | Declares `payload: "3.88.0"` as an *exact* peer. |
| `@payloadcms/db-postgres` | 3.88.0 | Exact peer `payload: "3.88.0"`. Drizzle + node-postgres under the hood. |
| `@payloadcms/richtext-lexical` | 3.88.0 | **Phase 6 — installed.** Exact peer on `payload`, plus `@faceless-ui/modal@3.0.0` and `@faceless-ui/scroll-info@2.0.0`, both of which `@payloadcms/ui` already pulled in — so the install resolved clean with no peer warnings. Brings `lexical@0.41.0` and its `@lexical/*` siblings. |
| `graphql` | 16.14.2 | **Unavoidable peer dependency of `payload` itself** (`^16.8.1`). See note in §5. |
| ~~`sharp`~~ | ~~0.35.3~~ → `>=0.35.4` | **Not installed. Phase 8 decided against it — see §8 and D-27.** It remains resolved in the lockfile as an optional dependency of `next`, which is where Next's own image optimizer would find it, and is never invoked. Phase 26 pins it forward past two libheif advisories anyway: an override costs nothing and removes a finding, which is worth more than a paragraph explaining why the finding is harmless. |

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
| `radix-ui` (unified) | 1.6.7 | **Phase 3 — installed** |
| `lucide-react` | 1.33.0 | **Phase 3 — installed** |
| `class-variance-authority` / `tailwind-merge` / `clsx` | 0.7.1 / 3.6.0 / 2.1.1 | **Phase 3 — installed** |
| `shadcn` (CLI) | 4.19.0 | **not installed — see §7** |
| `motion` | 13.1.1 | ~~Phase 3~~ ~~Phase 10~~ **not installed — see DEV-40** |
| `storybook` | 10.5.10 | **not installed — see DEV-20**; revisit at Phase 27 |
| `zod` | 4.4.3 | **Phase 4 — installed** |
| `react-hook-form` + `@hookform/resolvers` | 7.86.0 / 5.9.1 | Phase 7 |
| `nuqs` | 2.10.0 | Phase 11 |
| `algoliasearch` | 5.57.0 | Phase 12 |
| `stripe` | 22.5.0 | Phase 17 |
| `resend` + `react-email` + `@react-email/components` | 6.22.0 / 6.9.2 / 1.0.12 | Phase 19 |
| `cloudinary` | 2.10.1 | **Phase 8 — installed.** Server-only, imported by exactly one file (`payload/storage/cloudinary.ts`). Delivery URLs are built without it — see D-26 |
| `@payloadcms/plugin-cloud-storage` | 3.88.0 | **Phase 8 — installed.** Exact peer on `payload@3.88.0`; its only new transitive deps are `range-parser` and `find-node-modules` |
| `posthog-js` | 1.418.10 | **Phase 25 — installed.** Dynamically imported, and only when `NEXT_PUBLIC_POSTHOG_KEY` is set — see `components/analytics/analytics.tsx` |
| `@sentry/nextjs` | 10.70.0 | **Phase 25 — installed.** `withSentryConfig` wraps `withPayload`, outermost. Its `@sentry/cli` postinstall is **denied** in `pnpm-workspace.yaml`: source-map upload is off, so the binary would be fetched and never run |
| `@vercel/speed-insights` | 2.0.0 | **Phase 25 — installed.** Rendered in production only, per §25.1e's *"enable after the application is stable enough"*. A second gate lives in the Vercel dashboard — see `TODO.md` |
| `vitest` | 4.1.11 | **Phase 27 — installed.** Two projects: `unit` in Node, `components` in jsdom. A "pure" module that reaches for `window` therefore fails rather than passing by accident |
| `@vitejs/plugin-react` | 6.1.1 | **Phase 27 — installed.** Vitest is Vite; JSX in a component test needs a transform, and this is the one Vite ships |
| `@testing-library/react` | 16.3.3 | **Phase 27 — installed.** Named by the corpus (`01_…_Tech_Stack`, §27.1b) but never version-pinned by it; 16.3.3 is the current release supporting React 19 |
| `@testing-library/user-event` | 14.6.7 | **Phase 27 — installed.** `fireEvent` dispatches one event; a real click is several. Behaviour tests use this one |
| `@testing-library/jest-dom` | 7.0.1 | **Phase 27 — installed.** The `/vitest` entry point, not the Jest one |
| `jsdom` | 30.0.1 | **Phase 27 — installed.** Chosen over `happy-dom` because Radix's primitives exercise the corners — pointer capture, focus management — and jsdom is the implementation those are tested against upstream |
| `@playwright/test` | 1.62.1 | **Phase 27 — installed.** Chromium plus one mobile project. **The specs have never been executed** — there is no development database and D-10 forbids pointing a writing harness at production. See `TODO.md` §1 |
| `@axe-core/playwright` | 4.13.0 | **Phase 27 — installed.** §27.1e's automated pass, on six routes. The plan is explicit that it does not replace a manual keyboard review |
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

3. **A restricted Lexical feature set is a deliberate pin of its own.** `lexicalEditor()` defaults to
   twenty features — counted in `dist/lexical/config/server/default.js` — including alignment,
   indentation, underline, strikethrough, subscript, superscript, inline code, checklists, a
   horizontal rule, a relationship node and an upload node. (Tables are *not* among them: the only
   table export is `EXPERIMENTAL_TableFeature`, which is opt-in.) `src/payload.config.ts` replaces
   the list with nine features. That is a
   design decision (visual guide §11 and **D-11**: the design system is enforced by the compiler, not
   by an editor's toolbar), and it is recorded here because the *upgrade* consequence lands on this
   page: a Payload minor release that adds a default feature will not silently add it to this project,
   and one that renames an exported feature will fail the build rather than change the editor.

4. **pnpm 11 `minimumReleaseAge` gating.** pnpm 11 writes recently-published packages into a
   `minimumReleaseAgeExclude` list in `pnpm-workspace.yaml` during resolution. This file is generated and
   must be committed so CI resolves identically.

5. **Tailwind v4 preflight vs. the Payload admin route — resolved in Phase 2, and it cannot occur.**
   The storefront and the admin are separate route groups with separate root layouts, so Next.js builds
   them as separate CSS graphs. Verified against the production build: the Tailwind chunk is referenced by
   the storefront document and by no admin bundle. No scoping directive was needed. The invariant that
   keeps this true is that `src/app/(payload)/layout.tsx` never imports the storefront stylesheet — see
   `docs/ARCHITECTURE.md` → **D-08**.

6. **Postgres is needed from Phase 2, not Phase 5.** Payload connects during `payload.init()`, so `/admin`
   and `/api/*` return HTTP 500 without a reachable database. Build, typecheck, lint and the storefront
   are unaffected. See **DEV-15**.

## 6. Resolution proof

**Phase 2 — real install, not a dry run.**

```
pnpm install --strict-peer-dependencies
→ 706 packages resolved from 16 direct dependencies. Exit 0. No unmet peer dependencies.
```

Plan §2.1a's acceptance criterion *"No unresolved peer-dependency warnings"* is met.

> The 825 figure previously recorded here came from a `--lockfile-only` dry run that included packages
> later phases will add. 706 is what the Phase 2 foundation actually resolves to.

### What is installed at Phase 2

Plan §2.1b: *"Do not install the entire final dependency list on day one."* Sixteen direct dependencies:

| Runtime | | Dev | |
|---|---|---|---|
| `next` | 16.3.3 | `typescript` | 5.9.3 |
| `react` / `react-dom` | 19.2.8 | `eslint` | 9.39.5 |
| `payload` | 3.88.0 | `eslint-config-next` | 16.3.2 |
| `@payloadcms/next` | 3.88.0 | `prettier` | 3.9.6 |
| `@payloadcms/db-postgres` | 3.88.0 | `tailwindcss` / `@tailwindcss/postcss` | 4.3.3 |
| `graphql` | 16.14.2 | `@types/node` | 22.20.1 |
| | | `@types/react` / `@types/react-dom` | 19.2.18 / 19.2.4 |

`@types/node` tracks the **installed runtime major (22.x)**, not the `latest` tag (26.2.0), so the types
describe the Node that actually runs the code.

**Deliberately not installed yet:** ~~`@payloadcms/richtext-lexical` (Phase 6 — no rich-text field
exists)~~ **installed in Phase 6, §8 below**; ~~`sharp` (Phase 8 — image processing, and the reason the
Phase 6 `media` collection declares no `imageSizes`)~~ **withdrawn — Phase 8 decided against `sharp`
entirely, see D-27**; and everything in §4. See **DEV-18**.

### Transitive-dependency overrides

Two entries in `pnpm-workspace.yaml`, both closing published advisories in packages this project does
not depend on directly and cannot reach by upgrading anything it does control. Added after a
`pnpm audit` during the Phase 8 review, which reported **5 vulnerabilities (2 low, 3 moderate)** and
now reports none.

| Override | Closes | Reached through | Real exposure |
|---|---|---|---|
| `dompurify: '>=3.4.13'` | 4 advisories, worst an XSS | `@payloadcms/ui > @monaco-editor/react > monaco-editor` | Admin panel only. Nothing here uses a `code` or `json` field, so Monaco is bundled but never mounted |
| `esbuild: '>=0.25.0'` | GHSA-67mh-4wv8-2f99 | `@payloadcms/db-postgres > drizzle-kit > @esbuild-kit/*` (both deprecated) | Build-time only; the advisory is about esbuild's dev server, which drizzle-kit never starts |

Neither is a version *pin* in the sense §2 uses — they are floors. They are also the sort of thing
that rots quietly: an override kept after the upstream tree has moved past it silently holds a package
back. **Re-check both whenever `payload` or any `@payloadcms/*` version changes**, and delete either
one the moment `pnpm audit` stays clean without it.

The esbuild override was verified beyond `audit`, because drizzle-kit is what generates every
migration: `pnpm migrate:status` and `pnpm migrate:create` both still work, and the full gate suite
(typecheck, lint, build, `verify:access` 45/45, `verify:media` 61/61) passes unchanged.

### pnpm 11 build-script gating

pnpm 11 denies package build scripts by default and records allowances under **`allowBuilds`** in
`pnpm-workspace.yaml` — note the key changed from pnpm 9/10's `onlyBuiltDependencies`. Two are required:

- **`esbuild`** — Payload's config loader compiles `payload.config.ts` through it; the postinstall fetches
  the native binary. Without it neither the Payload CLI nor `/admin` can load the config.
- **`unrs-resolver`** — the resolver behind `eslint-plugin-import-x`, a transitive dependency of
  `eslint-config-next`. Same native-binary postinstall.

`pnpm-workspace.yaml` must stay committed so CI resolves identically. The anticipated
`minimumReleaseAgeExclude` list (§5.3) was **not** generated with these pins.

### ESLint flat config needs no shim

`eslint-config-next@16.3.2` exports native `Linter.Config[]` arrays from `./core-web-vitals` and
`./typescript`. `eslint.config.mjs` spreads them directly — **no `FlatCompat`, no `@eslint/eslintrc`**,
contrary to most Next 15-era guidance.

---

## 7. Phase 3 — what the design system actually installs

**Five runtime packages**, taking the tree from 706 to **782**, resolved with
`pnpm add --strict-peer-dependencies`, exit 0, no unmet peers.

| Package | Pin | Why |
|---|---|---|
| `radix-ui` | 1.6.7 | The **unified** package. One dependency supplies Dialog, DropdownMenu, Select, Tabs, Accordion, Checkbox, RadioGroup, Label, Separator, Toast, VisuallyHidden and Slot — every primitive plan §3.1c asks for. Peers accept React 19.2.8. |
| `class-variance-authority` | 0.7.1 | Variant composition, the shadcn abstraction plan §3.1c points at. |
| `clsx` | 2.1.1 | Conditional class flattening. |
| `tailwind-merge` | 3.6.0 | Conflict resolution, configured against this project's overridden scales in `src/lib/cn.ts`. |
| `lucide-react` | 1.33.0 | Icons. Note this is the **1.x** line; icon names differ from the 0.x releases most guidance assumes (`LoaderCircle`, `CircleAlert`). |

### Three things that are *not* installed, deliberately

- **`shadcn` (the CLI).** shadcn is copy-in source, not a runtime dependency, and `shadcn init` is
  actively destructive here: it merges `@apply bg-background text-foreground` into `body`, and since
  its `:root` is the light palette with dark values under a `.dark` class this app does not have, it
  **flips the storefront from `#0A0A0A` to white**. It also writes the self-referencing
  `--font-sans: var(--font-sans)`. `--no-css-variables` does not prevent either. Reproduced four times
  in throwaway sandboxes. The abstraction is followed by hand instead — see **DEV-23**.
- **`vaul` and `sonner` + `next-themes`.** The current shadcn registry reaches outside Radix for
  Drawer and Toast. Both are built on Radix here instead, dropping three dependencies. **DEV-23**.
- **`motion`.** Installed early in Phase 3, then removed — nothing in the design system needed it.
  Overlay animation is CSS driven by Radix's `data-state` (**DEV-24**). Phase 10 built the editorial
  reveals it had been deferred for and **declined it again** (**DEV-40**), on measurements rather than
  on taste: 8.64 MiB across four packages, ~40 KB gzip on the LCP route, `reducedMotion` defaulting to
  `"never"`, and a Web Animations API path that cannot read the duration tokens
  `prefers-reduced-motion` overrides. The reveal is two CSS declarations and one
  `IntersectionObserver`. Still an approved technology; nothing in the built product needs it.

### Fonts are vendored, not depended on

`Bodoni Moda` and `Instrument Sans`, SIL OFL 1.1 with no Reserved Font Name, committed as
`latin`-subset variable `.woff2` under `src/app/(frontend)/fonts/` with their licence texts. 76 KB
total. Loaded with `next/font/local`, **not** `next/font/google` — the Google loader performs a
build-time fetch and would make `pnpm build` fail without network egress.

**The Bodoni Moda file matters.** Google serves two variable builds; the default 25,884-byte one is
`BodoniModa11pt-Regular` with the optical-size axis physically absent. The committed 46,260-byte file
carries `wght 400–900` **and** `opsz 6–96`. If these files are ever re-fetched, check the byte count.

### Verification tooling is borrowed, not installed

Playwright 1.62.1 and axe-core 4.13.0 were **Phase 27** dependencies. Phase 3's browser and
accessibility pass ran them from the scratchpad directory against the dev server, so `package.json`
was unchanged by it. **Phase 27 installed them properly**, at the same pins, and the suite in
`tests/e2e/` is where that pass now lives permanently.

---

## 8. Phase 4 — what the environment system installs

**One direct dependency, and zero new packages.** `pnpm add zod@4.4.3 --save-exact --strict-peer-dependencies`,
exit 0, no unmet peers. Twenty-two direct dependencies now, up from twenty-one.

| Package | Pin | Why |
|---|---|---|
| `zod` | 4.4.3 | The stack's mandated validation library. A runtime dependency, not a dev one: the running server validates its own environment, so zod has to be present at run time as well as at build time. |

**The resolved graph did not change.** `zod@4.4.3` was already in the lockfile and in the store as a
transitive dependency of `eslint-plugin-react-hooks` via `eslint-config-next`, so nothing was
downloaded and no package was added — the `packages:` block holds 778 entries before and after, and
the entire lockfile diff is three lines under `importers`:

```yaml
      zod:
        specifier: 4.4.3
        version: 4.4.3
```

The explicit direct dependency was still required. Under pnpm's isolated layout a transitive copy is
not importable from `src/`: `import { z } from 'zod'` failed to resolve until it was added.

### Three Zod 4 traps, each verified against the installed 4.4.3 rather than assumed

- **`z.httpUrl()` rejects `http://localhost:3000`.** Its built-in hostname pattern demands a dotted
  TLD, so it fails in development. The correct form for an http(s) URL here is
  `z.url({ protocol: /^https?$/ })`, which accepts localhost and still rejects a scheme-less string.
- **`z.string().url()`, `.format()` and `.flatten()` are deprecated** in favour of top-level `z.url()`
  and the free functions `z.treeifyError` / `z.prettifyError`. Nothing in the lint or typecheck chain
  flags a deprecated Zod call — `eslint-config-next` is not type-aware and `@typescript-eslint/no-deprecated`
  is not enabled — so this is a convention the code has to hold on its own.
- **The message parameter is `error`, not `message`.** The old one still works, but passing both
  throws *"Cannot specify both `message` and `error` params"*.

`z.prettifyError()` is what renders the failure block a developer actually reads; it reports every
invalid variable at once rather than one per restart.

### `server-only` is used, but it forced a module split

`import 'server-only'` is what makes a client component importing the environment a **build error**,
and it needs no dependency: Next aliases the bare specifier to a vendored copy at
`node_modules/next/dist/compiled/server-only`, whose `exports` map resolves to an empty module under
the `react-server` condition and to a module that throws everywhere else.

That alias exists only inside Next's bundler. The `payload` CLI loads `payload.config.ts` — and
therefore the environment module — through **tsx**, outside Next, where the specifier does not
resolve at all: `pnpm generate:types` fails with `ERR_MODULE_NOT_FOUND`. Measured, not assumed.

Hence the split. `env.core.ts` carries the schemas and stays tsx-resolvable for the Payload config;
`env.server.ts` is that module plus the `server-only` import, and is what application code imports.
An ESLint `no-restricted-imports` rule stops anything else reaching past the guard. See **D-14**.

---

## 8. Phase 6 — the data model's one dependency

```
pnpm add @payloadcms/richtext-lexical@3.88.0
→ +102 packages. Exit 0. No unmet peer dependencies.
pnpm install --lockfile-only --strict-peer-dependencies
→ "Already up to date". Exit 0.
```

**732 packages resolved from 23 direct dependencies** — 14 runtime, 9 dev. One package added by the
phase that defines twenty-two collections and two globals, which is the point: a data model is
configuration, not libraries.

| Added | Version | Why |
|---|---|---|
| `@payloadcms/richtext-lexical` | 3.88.0 | The rich-text editor. Plan §6.1b needs a full description, §6.1g a campaign story, §6.1i an article body; `type: 'richText'` has no implementation without it. `src/payload.config.ts` predicted this in Phase 2 and named the phase. |

Its own dependency tree is where the 102 packages come from — `lexical@0.41.0` and eleven `@lexical/*`
siblings, `@payloadcms/ui`, and the Markdown/JSX plumbing behind the converters. Two of its peers,
`@faceless-ui/modal@3.0.0` and `@faceless-ui/scroll-info@2.0.0`, were already in the store as
dependencies of `@payloadcms/ui`, so nothing new had to be satisfied by hand.

**Still not installed, and now permanently so:** `sharp`. Phase 8 examined the question and decided against it — **D-27**. Uploads work without it; `imageSizes`,
`focalPoint` and `crop` are silently inert, which is why the `media` collection declares none of them
until Phase 8 brings the media layer and its dependency together.
