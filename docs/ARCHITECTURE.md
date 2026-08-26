# NORTH / 01 — Architecture

> Records the target architecture, the boundaries that must hold, the cross-document consistency audit
> required before Phase 1, and every implementation decision taken that the six canonical documents did
> not already settle.

---

## 1. Shape of the system

One deployable. Payload CMS is embedded **inside** the Next.js application — not a separate backend service.

```text
                    ┌──────────────────────────────────────────┐
   Browser  ───────►│  Next.js 16 (App Router) on Vercel        │
                    │  ├── storefront routes  (RSC-first)       │
                    │  ├── /admin            (Payload Admin)    │
                    │  └── route handlers    (webhooks, API)    │
                    └───────────────┬──────────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────────┐
                    │  Payload 3 → PostgreSQL (Neon)            │
                    │  THE SOURCE OF TRUTH for business data    │
                    └───────────────┬──────────────────────────┘
                                    │
     ┌──────────────┬───────────────┼───────────────┬──────────────┐
     ▼              ▼               ▼               ▼              ▼
  Stripe        Cloudinary       Algolia         Resend      PostHog/GA4
  payment       media            derived         email       Sentry
  events        delivery         index           delivery    analytics
```

Stripe is authoritative for payment state only. Cloudinary delivers media while metadata stays in
Payload. Algolia is rebuildable and never authoritative. Resend never blocks an order. Analytics never
blocks a purchase.

### Directory boundaries

Fixed by plan §1.3. No root-level `utils.ts` dumping ground. Everything application-side lives
under `src/`, which is where Payload expects its config and where `.gitattributes` already
pointed for generated types.

| Path | Holds | Exists |
|---|---|---|
| `src/app/(frontend)/` | storefront routes, layouts, pages | Phase 2 |
| `src/app/(payload)/` | Payload admin + REST API routes | Phase 2 |
| `src/payload.config.ts` | the Payload config, aliased as `@payload-config` | Phase 2 |
| `src/payload/` | collections, globals, access rules, hooks, migrations | Phase 2 |
| `src/components/` | reusable presentation and interaction components | Phase 3 |
| `src/lib/` | integrations, infrastructure, helpers, **server-only** modules | Phase 3 (`cn.ts`); `env.public.ts` / `env.server.ts` / `env.core.ts` from Phase 4 |
| `src/instrumentation.ts` | Next's startup hook — environment validation | Phase 4 |
| `src/features/` | domain-oriented modules, where complexity warrants isolation | as needed |
| `emails/` | React Email templates | Phase 19 |
| `tests/` | unit / component / e2e suites and helpers | Phase 27 |
| `scripts/` | seeding, reindexing, one-off admin tasks | Phase 6 |
| `docs/` | architecture, environment, decisions, runbooks | Phase 1 |

### Route-group topology

Two sibling route groups, **each with its own root layout** and no shared parent layout:

```text
src/app/
├─ (frontend)/          storefront
│   ├─ layout.tsx       <html> shell - imports globals.css (Tailwind)
│   ├─ globals.css
│   └─ page.tsx
└─ (payload)/           CMS
    ├─ layout.tsx       <html> shell - imports @payloadcms/next/css + custom.css
    ├─ custom.css
    ├─ admin/[[...segments]]/   the admin panel
    └─ api/[...slug]/           Payload REST API
```

This is Payload's officially supported structure, and it is also what keeps Tailwind's global
Preflight out of the admin panel: separate root layouts compile to separate CSS graphs, so the
Tailwind chunk is never referenced by an admin document. **Two invariants preserve that** —
`(payload)/layout.tsx` must never import the storefront stylesheet, and no shared
`src/app/layout.tsx` may be introduced above the two groups. See decision **D-08**.

No GraphQL routes are generated; see **D-02**.

### The `/api` namespace is shared

Payload's REST catch-all is `(payload)/api/[...slug]`, but the application also needs its own handlers
there — the Stripe webhook in Phase 17, for one. Both coexist: a **static segment beats the catch-all**,
and Payload keeps serving everything else. Verified in Phase 2 with a real probe route, in the build
manifest and at runtime. No `routes.api` override or second API prefix is needed.

**The rule that follows.** A storefront handler under `/api/` shadows any Payload collection endpoint of
the same name — `(frontend)/api/users/route.ts` would silently take over `/api/users`. Keep app-owned
handlers on names no collection would claim (`/api/stripe/*`, `/api/webhooks/*`), and **check new
collection slugs against storefront `/api/` routes in Phase 6**.

---

## 2. Rules that do not bend

**The browser is never authoritative.** Not for price, inventory, discount validity, tax, shipping cost,
order total, permissions, or payment success. Every one is recalculated server-side before it matters.

**A browser reaching the success page is not payment.** Only a signature-verified Stripe webhook event
moves an order to paid. The success page reads authoritative order state; it never writes it.

**Two idempotency barriers, not one.** Duplicate checkout requests and duplicate Stripe events are
different failure modes: the unique Stripe event ID guards the second, the order state machine and
transactional inventory logic guard the first.

**Orders are snapshots.** Editing a product must never rewrite the past. Order items store product name,
variant label, SKU, and unit price as they were at purchase.

**Optional services fail without taking the store down.** Analytics, monitoring, search, and email may all
be unavailable and a customer must still be able to buy. Stripe and Postgres are the only business-critical
integrations, and they must fail *loudly and safely* rather than silently.

**Online-only.** No store locator, store hours, POS, in-store checkout, BOPIS, curbside pickup,
store-level inventory, retail-staff workflow, or in-store return may enter the system. Inventory is
centralized online fulfillment stock.

---

## 3. Cross-document consistency audit

Required by the plan's *"CROSS-DOCUMENT CONSISTENCY GATE — BEFORE PHASE 1"*.

**Method.** All six artifacts were read in full. Six independent auditors swept the corpus along separate
dimensions — technology, business model, navigation/IA, data ownership, visual-vs-structural, and feature
coverage. Each claimed contradiction was then handed to an adversarial verifier instructed to *refute* it
and to confirm both quotes existed verbatim. 22 of 24 verified claims were refuted as context-dissolving,
misquoted, or jointly satisfiable. The findings below are those that survived verification or that were
confirmed directly against the document text.

**Result: the corpus is architecturally consistent.** No contradiction changes the stack, the business
model, the data-ownership rules, or the build order. Nothing found blocks Phase 1 or Phase 2. What
remains is documentation drift plus a set of specification *gaps* — places where a requirement exists in
one artifact and the entity, route, or field it needs was never defined anywhere. Those are recorded in
§3.2 and assigned to the phase that first needs them.

### 3.1 Confirmed contradictions

| # | Contradiction | Authority | Resolution |
|---|---|---|---|
| C-01 | Feature matrix §35 declares *"Stack source: this document."* while the tech stack header declares *"This document is the implementation stack source of truth."* | Tech stack (rank 3) owns approved technologies; feature matrix (rank 4) owns feature→technology mapping | Tech stack wins. The feature matrix contains no stack table, so nothing diverges in practice — §35 is a stale block. Verified: every technology named across all 35 `**Uses:**` lines already exists in the tech stack. |
| C-02 | The master plan is referenced under **three** filenames: `..._Current_OnlineOnly.md` (canonical), `NORTH01_Claude_Implementation_Plan.md` (master execution directive), `NORTH01_Claude_Implementation_Plan_Current.md` (feature matrix §35). Only the first exists. | Plan's "CANONICAL PROJECT FILES" section | `NORTH01_Claude_Implementation_Plan_Current_OnlineOnly.md` is the only correct name. |
| C-03 | **Essentials** is a `COLLECTIONS` child in the structure doc, but an **Edit** in feature matrix §13 and plan §23.1b — two URL namespaces for one merchandising page. | Structure doc (rank 5) owns user-facing IA | Essentials is a **Collection** (`/collections/essentials`). The reference image agrees — it draws a page titled "ESSENTIALS COLLECTION". Removed from the Edit set. |
| C-04 | The **Edit** child set is four items in the structure doc (Weekend, Travel, Everyday, Gifts) and six in the feature matrix and plan (adds Essentials, Seasonal). | Structure doc for the navigation set; plan for what the CMS may hold | Navigation exposes the structure doc's four. Essentials moves to Collections per C-03. "Seasonal" is a CMS capability, not a fixed nav entry. |
| C-05 | Plan §17.1c lists **Pending payment** among allowed order states; the §18.1b state machine omits it entirely. | Plan, internally | `PENDING_PAYMENT` is included. It is the state between session creation and webhook arrival, and §31.1f requires a "payment succeeded but webhook not yet reflected" UI state — which needs somewhere to live. |
| C-06 | Plan §15.1c defaults to **one discount code at a time**; feature matrix §18 validates *"Not combinable with conflicting discount"*, presuming several may coexist. | Plan (rank 1) | One code per order. The combinability field is modelled but unused in the demo. |
| C-07 | Structure doc §2 lists `JOURNAL` as a top-level site-map node; its own Simplicity rule keeps it out of the top navigation. | Structure doc, internally — the Simplicity rule is the more specific statement | Journal is a real route reachable from the footer and editorial surfaces, not a primary nav item. A site map is not a navigation bar. |
| C-08 | The reference image draws a **five-item** primary nav (SHOP · COLLECTIONS · EDIT · LOOKBOOK · ABOUT) — no `NEW`. Three written documents specify six. | Visual guide §10 and the plan's visual-reference rules: the written guide beats the image | Six items: **NEW · SHOP · COLLECTIONS · EDIT · LOOKBOOK · ABOUT**. |
| C-09 | Structure doc §16 puts Wishlist under Account; §2 also lists it as a global destination. | Structure doc, internally | Both — they do not conflict. A global header affordance routing to `/account/wishlist`. Guests get a local wishlist that merges on login. |
| C-10 | Storybook is *"Recommended"* in the tech stack, a mandated feature area in feature matrix §33, and plan §3.1d permits *"a Storybook **or equivalent** visual test page"*. | Plan (rank 1) — most permissive and most specific | **Settled in Phase 3: the equivalent.** An in-app route at `/design-system` renders every primitive in every required state. Storybook was built against this stack first and does work — it was declined on fit, not compatibility. See **DEV-20**. |
| C-11 | Turnstile, Sentry, PostHog, GA4 and Speed Insights are *"Optional but planned"* in the tech stack yet appear in plan acceptance gates §37. | Not a true conflict once scoped | Optional *to the running store* — they must never block commerce — but required *to the definition of done*. Both hold at once. |

### 3.2 Specification gaps — requirement exists, definition does not

Not disagreements between documents. These are things the documents assume and none defines. Each is
assigned to the phase that first needs it.

| # | Gap | First needed |
|---|---|---|
| G-01 | **Customer address** has routes (`/account/addresses`), access rules, and order snapshots — but appears in neither the plan's entity list §2.2 nor the Phase 6 schema. | Phase 6 |
| G-02 | **Size guide** is a feature with its own dialog, and Phase 6.1b defines a *"Size guide reference"* field pointing at a collection that is never defined. | Phase 6 |
| G-03 | **Gender** is an Algolia filterable attribute (plan §12.1a) and a facet drawn in the reference image, but no product or variant field stores it. | Phase 6 |
| G-04 | **Product display price.** Price is owned by the variant, yet listings and the PDP must show a product-level price. No document says how it is derived. | Phase 6 |
| G-05 | **Variant availability state** is in the domain model §2.1 but absent from the Phase 6.1c variant schema, and its values are never enumerated. | Phase 6 |
| G-06 | **Shipping method** is a required entity §2.2, "Postgres configuration" in the feature matrix, and a code-level static provider in plan §16.1a — three different homes. | Phase 16 |
| G-07 | **Infrastructure records** — Stripe webhook/idempotency, email delivery, search sync — are required by §2.2 and by Phases 12/17/19, but Phase 6 never defines them. | Their own phases |
| G-08 | **About**, **Order Tracking**, and the support surface (**FAQ / Contact / Shipping / Returns**) are navigation destinations in the structure doc with no dedicated implementation phase. | Phase 23 |
| G-09 | **Recommendations** are fully specified in feature matrix §10 but have no phase of their own — only incidental mentions inside the Phase 11 and 13 prompts. | Phase 13 |
| G-10 | **Checkout preflight** (plan §17.1a) never validates a shipping address, though the tech stack makes one mandatory for physical goods. | Phase 17 |
| G-11 | **Payment status vs fulfillment status.** Feature matrix §21 models them as two fields; the plan's §18.1b machine is a single linear axis mixing both. | Phase 18 |
| G-12 | Design tokens for **radius, shadow, motion duration and accent** are required numerically by plan §3.1a; the visual guide describes them only in adjectives. The type scale gives sizes but no weights, line-heights or tracking. | ~~Phase 3~~ **Closed in Phase 3** — every number fixed and recorded in notes §1.8.1. |
| G-13 | The visual guide gives page-level art direction for seven page types — **Cart and Checkout are absent**, as are Payload Admin and transactional email. | Phases ~~3~~, 14, 17, 19 — Phase 3's part is answered: guide §09's "Account / Utility" direction plus the token layer is what Cart and Checkout compose from, so no new visual language is needed for them. |
| G-14 | **Sale / compare-at price** and **selected/active** states need a visible accent, but the palette forbids saturated colour and prescribes low-contrast borders. | ~~Phase 3~~ **Closed in Phase 3** — selection is carried by contrast, compare-at is typographic, and the border rule is split. See notes §1.8.2, **DEV-21**, **DEV-22**. |

### 3.3 Image-only elements — present in the reference, defined nowhere

The reference image is directional and explicitly non-authoritative (visual guide §10; plan visual-reference
rule 10). These are drawn in the PNG but backed by no written requirement, so they are **out of scope**
unless a written document later adopts them:

- a **PILLAR** facet (Essentials / Core / Studio) with no taxonomy behind it
- a **Pre-Order** availability state — a commerce capability no document defines
- three parallel filter mechanisms shown at once (filter button, inline dropdown row, persistent rail) with mismatched facet sets
- site-styled **raw card-number and CVC inputs** — never to be built as drawn; see decision **D-07**
- a per-product **"WORN BY THE COMMUNITY"** user-generated gallery with no entity or moderation path
- a collection page rendered as a plain filterable grid, contradicting the guide's "campaign-led composition, broken into visual chapters"
- a checkout with no order summary and no discount-code field, both required by the structure doc

### 3.4 Documentation drift (cosmetic, no implementation impact)

- Top-level section numbers `1` and `2` are each used twice in the plan — the context sections collide with Phase 1 and Phase 2.
- The appendix numbers its subsections `41.1a`–`41.1s`, but the plan has no sections 39, 40 or 41.
- `36.0 — Final six-document consistency audit` sits physically inside Phase 35, before section 36 begins.
- The tech stack has two sections numbered `## 6` ("Versioning Rule" and "Vercel").
- The feature matrix §35 uses `##` where all 34 sibling sections use `#`.

---

## 4. Decisions

Decisions taken because the canonical documents did not settle them. Nothing here invents architecture —
each stays inside an already-approved technology.

### D-01 — Version pins are evidence-based, not `latest`

Next 16.3.2 · React 19.2.8 · Payload 3.88.0 · **TypeScript 5.9.3** · **ESLint 9.39.5**.

TypeScript `latest` is 7.0.2 and ESLint `latest` is 10.9.0. Both are excluded: `typescript-eslint@8.46.0`,
pulled in transitively by `eslint-config-next@16.3.2`, declares `typescript: ">=4.8.4 <6.0.0"` and
`eslint: "^8.57.0 || ^9.0.0"`. A dry-run with ESLint 10 fails to resolve. Full reasoning and the
resolution proof: [`STACK_VERSIONS.md`](STACK_VERSIONS.md).

### D-02 — GraphQL is installed but not exposed

Plan §2.1b says not to add GraphQL unless required. `graphql@^16.8.1` is nonetheless a hard
`peerDependency` of the `payload` package itself and cannot be omitted. It is installed as an
implementation detail of an approved technology. `@payloadcms/graphql` is **not** installed and no
GraphQL API surface is exposed.

### D-03 — Cloudinary integration path

**No official Payload Cloudinary adapter exists.** `@payloadcms/storage-cloudinary` returns 404 on the npm
registry; official adapters cover S3, Vercel Blob, Azure, GCS and Uploadthing only. The tech stack mandates
Cloudinary and forbids a second media CDN, so switching providers is not available.

Chosen path: a thin first-party adapter built on `@payloadcms/plugin-cloud-storage@3.88.0` — Payload's own
generic storage-adapter interface, the same one every official adapter is built on — driven by the
`cloudinary` Node SDK. This keeps provider-specific code isolated behind an integration boundary exactly as
the plan's third-party-integration rules require, and avoids depending on an unmaintained community plugin
for the media layer of a commerce system.

Rejected: `payload-cloudinary`, `payload-storage-cloudinary`, `@jhb.software/payload-cloudinary-plugin` —
community packages with no compatibility guarantee against Payload 3.88. Revisit if Payload ships an
official adapter.

*Confirmed in Phase 8.*

### D-04 — Algolia's scope, and what happens when it is down

Algolia is the query and facet engine for `/shop` and search (plan §11.1d). It is **derived state**: it may
be rebuilt from Postgres at any time and is never read as the product source of truth.

When Algolia is unavailable the storefront must not fall back to a full-catalog scan per request (plan
§11.1d). Instead, filtered browsing degrades to a controlled "search unavailable" state while category and
collection pages — which read Postgres directly and never route through Algolia — stay fully usable. This
is what makes the plan's *"catalog remains usable through curated category navigation"* fallback true
rather than aspirational, and it is why those routes must not be built on Algolia.

### D-05 — Order state is two axes, presented as one

Resolves **G-11**. The order carries `paymentStatus` and `fulfillmentStatus` as separate fields per feature
matrix §21. The plan's single linear machine (§18.1b) is preserved as the **derived, customer-facing**
status. Both documents are satisfied, and the two-axis model prevents a real defect: a single axis cannot
express "paid but not yet processing" alongside "refunded after shipping".

Transitions stay restricted — no arbitrary admin edits — and `PENDING_PAYMENT` is included per **C-05**.

*Confirmed in Phase 18.*

### D-06 — Inventory commits after payment, never at add-to-cart

Plan §17.1f is explicit: decrement only after a confirmed payment event, transactionally. Checkout
preflight *verifies* availability; it does not reserve. The feature matrix's "Verify inventory" step before
session creation and the plan's post-payment decrement are the same design, not two competing ones.

The race is handled where it actually occurs: at finalization, inside the transaction, with a defined
refund path for the rare payment-succeeded-but-stock-gone case.

### D-07 — Card data never touches this application

The reference image draws site-styled card-number and CVC inputs. They will not be built as drawn. Plan
§0.1.16 forbids storing raw card details, and rendering our own PAN field would pull the application into
PCI scope for no benefit. The steps we own — contact details, shipping address, shipping method — are ours
and styled to the visual guide. Payment is handed to Stripe's own elements.

Hosted-redirect Checkout versus embedded Checkout is a Phase 17 UX decision. Both create a server-side
Checkout Session, both are finalized by webhook, and the security model is identical either way.

*Deferred to Phase 17.*

---

### D-08 — The admin panel is insulated by topology, not by CSS patching

The anticipated Tailwind-v4-preflight-leaks-into-`/admin` problem does not occur, because the two route
groups are separate root layouts and therefore separate CSS graphs. Verified against the production build:
the Tailwind chunk is referenced by the storefront document and by none of the admin bundles.

No `@source` scoping, `important` selector, or preflight opt-out is needed — and none should be added. The
fix is the file layout, so the invariants in "Route-group topology" above are what must be defended.

*Confirmed in Phase 2.*

### D-09 — Postgres is a Phase 2 prerequisite, not a Phase 5 one

Payload connects to the database inside `payload.init()`, which runs when `/admin` renders. Without a
reachable Postgres, `/admin` and `/api/*` return HTTP 500 (`ECONNREFUSED`), so Gate 1's *"Payload admin
loads"* cannot pass. Build, typecheck, lint and the storefront route are all unaffected — `/admin` is a
dynamic route and is never prerendered.

A local Postgres install and a dev-only PGlite shim were both rejected: each adds an unapproved local
dependency to substitute for a free Neon branch that Phase 5 requires regardless.

*Recorded in Phase 2. Full detail: DEV-15.*

### D-10 — Schema push is development-only, and it is aimed at one named database

Plan §5.1d prescribes Drizzle's push workflow for the development sandbox and committed migrations for
every other environment. An earlier version of this decision disabled push outright; it was withdrawn
inside Phase 2, because it contradicted §5.1d to buy a review the config diff already provides.

**The hazard, and how narrow it actually is.** Push rewrites the schema of whatever `DATABASE_URL`
points at. Phase 4 measured the exposure rather than assuming it. The guard reads
`process.env.NODE_ENV` as a literal member expression, so Turbopack substitutes it at build time and
the whole decision constant-folds: the production server chunk contains
`{allowed:!1, reason:'NODE_ENV is "production", not "development"', mismatch:!1}` and no surviving
`==="development"` comparison. A deployed server's answer is therefore settled before it runs.
`PAYLOAD_MIGRATING` covers the migrate CLI. What remained was exactly two paths: `next dev`, and the
unbundled `payload` CLI, which reads `NODE_ENV` at true runtime. Both take `DATABASE_URL` from the
same `.env`.

**The guard, closed in Phase 4.** `DATABASE_PUSH_TARGET` names the one database push may modify, as
`host/database`. Push runs only when `NODE_ENV` is `development`, `appEnv` is `local`, that variable is
set, and the host and database in `DATABASE_URL` match it:

```ts
push: schemaPush.allowed
```

Two independent facts must now agree, and the second names the database explicitly — so repointing
`DATABASE_URL` **disarms** push rather than aiming it somewhere new. Re-arming is a deliberate second
edit, which is what makes this structural rather than a reminder. It is fail-closed: unset means no
push, because the safe default for an operation that rewrites schemas is not to perform it.

Note the adapter's own gate is `this.push !== false`, so it fails *open* — an `undefined` there would
push. The explicit boolean in the config is load-bearing.

*Revised in Phase 2, closed in Phase 4. Full detail: notes §1.9, `docs/ENVIRONMENT.md`,
DEV-17 (withdrawn entry retained).*

### D-11 — The design system is enforced by the compiler, not by review

Tailwind's default colour, type, radius and shadow scales are cleared (`--color-*: initial` and its
siblings) and replaced with semantic tokens. The raw palette lives in plain `:root` custom properties
that generate no utilities, so `bg-obsidian` does not exist — only `bg-canvas`.

The consequence is the point: `bg-red-500`, `text-lg`, `rounded-2xl` and `shadow-xl` **fail to
compile**. A guardrail that is a build error does not depend on anyone remembering the guide. Verified
against the built stylesheet — no default palette entry survives.

`src/lib/cn.ts` mirrors the same overrides into `tailwind-merge`, which otherwise cannot tell that
`text-meta` is a font size and `text-foreground` a colour, and would drop one of them silently.

*Recorded in Phase 3. Full detail: notes §1.8.1.*

### D-12 — Accessibility requirements are expressed as types where they can be

Three of plan §3.1d's accessibility requirements are enforced by the component API rather than left to
review:

- `IconButton` requires `label` — an icon-only control cannot be rendered without an accessible name.
- `DialogContent` and `DrawerContent` require `title`, with `titleHidden` for designs with no visible
  heading. This exists because **`@radix-ui/react-dialog@1.1.23` removed the missing-title warning**:
  a dialog without one is now announced with no name at all, silently, in every environment.
- `TabsList` requires `label`, because Radix supplies no `aria-label` for a tab list.

The corresponding runtime obligations Radix *does* discharge — focus trap, focus restoration, Escape,
scroll locking, `aria-hidden` on the rest of the page, roving focus, typeahead — are not
reimplemented, and were verified in a browser rather than assumed.

*Recorded in Phase 3. Full detail: notes §1.8.5 and §1.8.7.*

### D-13 — Overlay motion is CSS driven by Radix's `data-state`, and there is no animation library

Radix's `Presence` keeps an element mounted until `animationend`, so exits play in full from CSS
keyframes alone. No JavaScript runs to move a drawer, the animations cannot drift out of step with the
duration tokens, and `prefers-reduced-motion` is honoured from the single media query that overrides
those tokens.

`motion` was installed early in Phase 3 and removed: nothing in the design system needed it. It
remains approved and moves to **Phase 10**, with the editorial reveals that first have something to
reveal. See **DEV-24**.

*Recorded in Phase 3.*

### D-14 — The environment's trust boundary is a file boundary

Plan §4.1a requires browser-safe and server-only variables be separated. They are separated into
separate *modules* — `src/lib/env.public.ts` and `src/lib/env.server.ts` — rather than two exports of
one, so the mistake is visible in the import line of the file making it, not in a value several hops
away.

**A runtime check was not enough, and the first version of this decision was wrong.** `env.server.ts`
originally relied on a `typeof window` tripwire. That cannot fire during a build, because prerendering
runs on the server where `window` is undefined — so a client component importing the environment built
cleanly, `env.server.ts` was bundled into a client chunk, and the rendered secret went into the
prerendered HTML of `/`. Measured with a throwaway component, then fixed.

The guard is `import 'server-only'`, which makes that a **build error** naming the import chain. It
needs no dependency: Next aliases the specifier to a vendored copy. But that alias exists only inside
Next's bundler, and the `payload` CLI loads `payload.config.ts` through tsx, outside Next, where it
does not resolve at all. Hence three modules rather than two: `env.core.ts` holds the schemas and stays
tsx-resolvable, `env.server.ts` is that plus the guard. The `typeof window` check stays as a backstop.
The same tsx constraint is why the module imports nothing from `next/*`.

**The core is fenced by lint, and the two gates are not equivalent.** Two ESLint rules keep anything
but `env.server.ts`, `payload.config.ts` and `instrumentation.ts` from reaching `env.core.ts`:
`no-restricted-imports` for the static form, and `no-restricted-syntax` for `import()`. The second is
needed because the first is blind to dynamic imports — its implementation registers no
`ImportExpression` visitor — and the second Phase 4 audit proved that gap live: a client component
doing `use(import('@/lib/env.core'))` passed typecheck, lint and build and put `PAYLOAD_SECRET` into
the prerendered HTML of a static route.

So be precise about which gate catches what. A **static** import of `env.server.ts` from a client
component fails `pnpm build`. Reaching the **core**, statically or dynamically, fails `pnpm lint` —
not the build. Both are in the phase gate, so both are enforced, but a lint rule is a weaker
instrument than a compiler error: a computed specifier would evade it. That residual is recorded in
notes §1.9.9 and belongs to Phase 27.

The public module reads each variable as a literal `process.env.NEXT_PUBLIC_…` member expression. That
is not stylistic: Next substitutes those expressions textually at build time, and `process.env` is an
empty shim in the browser, so a dynamic read or a whole-object parse yields nothing client-side.

*Recorded in Phase 4.*

### D-15 — Validation fires at build and at startup, because neither alone is enough

`payload.config.ts` is statically imported by the `(payload)` route group, so `next build` evaluates it
while collecting page data — importing the environment module there makes a bad environment fail the
build with exit 1. That is the *only* build-time hook available: Next skips `instrumentation.ts` when
`NEXT_PHASE` is `phase-production-build`, prerender workers included, contrary to the common assumption.

But the config is evaluated lazily at runtime, on the first request that loads a route importing it. So
a server started with a broken environment boots clean, serves the prerendered storefront with a 200,
and returns 500 only on `/admin` and `/api/*` — a broken deployment passing a health check.
`src/instrumentation.ts` closes that: it runs once per server process at startup. A throw there
behaves differently in the two commands, and both were measured: `next dev` **exits with code 1**,
while `next start` stays up and returns 500 on *every* route, storefront included. The `next start`
case is the one that matters, and it is the one that turns a silent half-failure into an obvious one.

The response body stays a bare `Internal Server Error`; the variable name appears only in the server
log, which is what §4.1b requires.

*Recorded in Phase 4.*

## 5. Current position

**Phase 1 — Workspace, repository and baseline: complete.** Repository initialized on `main`, baseline
config and documentation in place, consistency gate executed and recorded above.

**Phase 2 — Scaffold the Next.js + Payload application: complete. Gate 1 passed.**

Next 16.3.2 with Payload 3.88.0 embedded in one deployable. 706 packages from 16 direct dependencies, no
peer-dependency warnings. TypeScript strict, ESLint flat config at `--max-warnings 0`, Prettier, Tailwind
v4, and the two-route-group structure above, against **Neon PostgreSQL 17.11**.

| Gate 1 criterion | Status |
|---|---|
| 1. Frontend loads | **pass** — `/` → 200, RSC-rendered with Tailwind applied |
| 2. Payload admin loads | **pass** — `/admin` → 200; `/admin/create-first-user` renders |
| 3. Build passes | **pass** — 4 routes, `/admin` and `/api/*` correctly dynamic |
| 4. Typecheck passes | **pass** — `tsc --noEmit`, strict |
| 5. Lint passes | **pass** — `eslint --max-warnings 0` |
| 6. Commit captures a known-good baseline | **pass** — branch `phase-2-scaffold-next-payload` |

The Payload API was verified through a full auth round-trip — register, login, authenticated read,
identity — not merely a liveness check. Unauthenticated `GET /api/users` returns 403, which is the
default access control working as intended. Details and evidence: notes §1.7.2.

**Phase 3 — Design system and UI foundation: complete.**

The token layer (**G-12**, **G-14**), the type scale, two self-hosted typefaces, all eighteen §3.1c
primitives, and the global shell. 782 packages from 21 direct dependencies, still no peer-dependency
warnings. Typecheck, lint at `--max-warnings 0`, and the production build all pass; `/design-system`
prerenders static, `/admin` and `/api/*` stay dynamic.

| Phase 3 acceptance | Status |
|---|---|
| Central tokens for colour, type, spacing, radius, shadow, motion, breakpoints (§3.1a) | **pass** — and the defaults are cleared, so off-system values do not compile (**D-11**) |
| Display serif + UI sans, licensed, self-hosted, via `next/font` (§3.1b) | **pass** — Bodoni Moda + Instrument Sans, SIL OFL 1.1, no RFN, 76 KB |
| All eighteen core primitives (§3.1c) | **pass** — on `radix-ui@1.6.7`, styled to the guide |
| Global shell components (§3.1d) | **pass** — built and proved; **mounted in Phase 9**, see notes §1.8.6 |
| Every primitive in every state, on a visual test page | **pass** — `/design-system`; **C-10 settled**, see **DEV-20** |
| Keyboard, visible focus, Escape, focus trap, focus restoration | **pass** — driven in a real browser, not asserted |
| Accessibility | **0 axe-core violations**, WCAG 2.0/2.1/2.2 A + AA, desktop and mobile |
| Visual review against the guide | **pass** — notes §1.8.8 |

The reviewing pass found two real defects — a loading button with no accessible name, and a tertiary
grey that failed AA wherever it was used — and both were fixed by changing the system rather than the
instances. Details: notes §1.8.7.

**A second, adversarial audit ran after the phase was committed green**, and found 23 more (of 37
claims; 14 were refuted on reproduction). All are fixed. The headline: `<Button asChild>` threw on
every use, because Slot was handed two children and `React.Children.count` counts the `null` from a
conditional. Also a "persistent" toast that dismissed itself in 0.1 ms via `setTimeout` overflow,
`max-w-prose` silently resolving to 65ch, three `peer-*`/`group-*` variants that could never match,
and eight accessibility defects that coexisted with a zero-violation axe run — including two `<h1>`s
on the page whose job is to prove the heading structure, and no skip link at all (WCAG 2.4.1,
Level A). Full account and the lesson for Phase 27's test suite: notes **§1.8.10**.

**Phase 4 — Environment configuration and secret management: complete.**

The typed Zod module (§4.1a), split across a file boundary (**D-14**), validating at both build and
startup (**D-15**), and the schema-push guard **D-10** has been waiting for since Phase 2. Twenty-two
direct dependencies, up from twenty-one — `zod` 4.4.3 is the only addition, and it added **no packages
at all**: it was already in the lockfile as a transitive dependency, so the whole lockfile diff is three
lines under `importers`.

| Phase 4 acceptance | Status |
|---|---|
| Typed environment module validated with Zod (§4.1a) | **pass** — `src/lib/env.server.ts`, `src/lib/env.public.ts` |
| Browser-safe separated from server-only (§4.1a) | **pass** — three modules; the server tier carries `import 'server-only'`, so a client import is a build error (**D-14**). The `typeof window` check is a backstop, not the guard |
| Missing required secret fails at startup/build (§4.1b) | **pass** — build exits 1; startup 500s every route. Both verified by running them |
| No silent substitution of a fake value (§4.1b) | **pass** — and empty string is treated as missing, which is what a blank `.env` line and a blank Vercel field both produce |
| Missing variable name absent from public responses (§4.1b) | **pass** — measured: the body is a bare `Internal Server Error` |
| Optional integrations warn and degrade (§4.1b) | **pass** — grouped per provider; a *partly* configured group is reported at every startup |
| Local / Preview / Production maintained (§4.1c) | **pass** — derived from `VERCEL_ENV`, which is the only thing that separates preview from production |
| Never production Stripe credentials outside production (§4.1c) | **pass** — `sk_live_`/`pk_live_` outside production is a hard startup error, not a warning |
| `.env.example` with names only | **pass** — every variable, its tier, its phase and its source |
| Each variable documented | **pass** — `docs/ENVIRONMENT.md` |
| **D-10** environment guard | **pass** — proved by running `pnpm dev` against a mismatched target and confirming push did not run |

Every guard in that table was exercised against the real toolchain rather than asserted: the build
failure, the startup failure, the empty-string case, the live-Stripe rejection, the partial-integration
warning, and both push-guard branches. Details and the measurements: notes §1.9.

**Next: Phase 5 — Neon Postgres + Payload CMS foundation.** Migration baseline and the discipline
around it (plan §5.1c–d).

**Cleared before Phase 3** (2026-08-23, all three from Phase 2's own edge-case list):

| Was | Now |
|---|---|
| `process.env.X \|\| ''` for `DATABASE_URL` and `PAYLOAD_SECRET` | throws at config load with an actionable message — the silent substitution §4.1b forbids is gone |
| `sslmode=require`, which `pg` v9 will redefine as *skip verification* | `sslmode=verify-full`, behaviour-neutral today and immune to the change |
| Unknown whether the app can own routes under Payload's `/api` | verified it can; the collision rule is recorded for Phase 6 |

**Genuinely owed by later phases** — sequencing, not debt. Each has a phase that will do it:

| Owed | Phase | Why |
|---|---|---|
| Migration baseline and the discipline around it | 5 | Plan §5.1c–d |
| CI running typecheck, lint, tests and build | 27 | Plan §27.1f |
