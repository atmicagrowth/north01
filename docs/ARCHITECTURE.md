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
| `src/payload/` | collections, globals, blocks, reusable fields, hooks, migrations, access rules, email, **storage adapters** | Phase 2; filled out in Phase 6; `access/` and `email/` in Phase 7; `storage/` in Phase 8 |
| `src/components/` | reusable presentation and interaction components; `shell/` holds the global overlay state machine and its triggers; `home/` and `editorial/` render the CMS block set | Phase 3; `shell/` in Phase 9; `home/`, `editorial/`, `newsletter/` in Phase 10 |
| `src/lib/` | integrations, infrastructure, helpers, **server-only** modules | Phase 3 (`cn.ts`); `env.*` from Phase 4; `media/` in Phase 8; `navigation/` in Phase 9; `home/`, `newsletter/`, `money.ts` in Phase 10 |
| `src/instrumentation.ts` | Next's startup hook — environment validation | Phase 4 |
| `src/proxy.ts` | Next 16's renamed `middleware` — the optimistic `/account` redirect | **Phase 7** |
| `src/features/` | domain-oriented modules, where complexity warrants isolation | as needed |
| `emails/` | React Email templates | Phase 19 |
| `tests/` | unit / component / e2e suites and helpers | Phase 27 |
| `scripts/` | seeding, reindexing, one-off admin tasks | Phase 6 — `seed.ts`, `baseline-migrations.ts`; Phase 7 — `verify-access.ts`; Phase 8 — `verify-media.ts`; Phase 9 — `verify-shell.ts`; **Phase 10 — `verify-home.ts`** |
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

Phase 9 added one file *beside* the two groups rather than above them: `src/app/global-not-found.tsx`,
which is not a layout and therefore breaches neither invariant. It exists precisely because there are
two root layouts and so no single one from which a root `not-found.tsx` could be composed — see
**D-31**.

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
| G-01 | **Customer address** has routes (`/account/addresses`), access rules, and order snapshots — but appears in neither the plan's entity list §2.2 nor the Phase 6 schema. | ~~Phase 6~~ **Closed in Phase 6** — the `addresses` collection, plus a reusable field group used a second time as the frozen snapshot on an order. |
| G-02 | **Size guide** is a feature with its own dialog, and Phase 6.1b defines a *"Size guide reference"* field pointing at a collection that is never defined. | ~~Phase 6~~ **Closed in Phase 6** — the `size-guides` collection. Rows carry their own measurement labels rather than aligning to a header row by position, so a missing cell renders blank instead of shifting its neighbours. |
| G-03 | **Gender** is an Algolia filterable attribute (plan §12.1a) and a facet drawn in the reference image, but no product or variant field stores it. | ~~Phase 6~~ **Closed in Phase 6** — `products.gender`, indexed. Women / Men / Unisex. |
| G-04 | **Product display price.** Price is owned by the variant, yet listings and the PDP must show a product-level price. No document says how it is derived. | ~~Phase 6~~ **Closed in Phase 6** — `products.derived`, a hook-maintained aggregate over active variants. See **D-18**. |
| G-05 | **Variant availability state** is in the domain model §2.1 but absent from the Phase 6.1c variant schema, and its values are never enumerated. | ~~Phase 6~~ **Closed in Phase 6** — enumerated as a *derivation*, not a column: discontinued / sold out / low stock / in stock, from `active`, `inventoryQuantity` and `siteSettings.lowStockThreshold`. A fourth stored state would be a fourth thing to keep in step. See `ProductVariants.ts`. |
| G-06 | **Shipping method** is a required entity §2.2, "Postgres configuration" in the feature matrix, and a code-level static provider in plan §16.1a — three different homes. | Phase 16 |
| G-07 | **Infrastructure records** — Stripe webhook/idempotency, email delivery, search sync — are required by §2.2 and by Phases 12/17/19, but Phase 6 never defines them. | Their own phases — **confirmed in Phase 6**, which deliberately created none of them. See **D-19**. |
| G-08 | **About**, **Order Tracking**, and the support surface (**FAQ / Contact / Shipping / Returns**) are navigation destinations in the structure doc with no dedicated implementation phase. | Phase 23 |
| G-09 | **Recommendations** are fully specified in feature matrix §10 but have no phase of their own — only incidental mentions inside the Phase 11 and 13 prompts. | Phase 13 |
| G-10 | **Checkout preflight** (plan §17.1a) never validates a shipping address, though the tech stack makes one mandatory for physical goods. | Phase 17 |
| G-11 | **Payment status vs fulfillment status.** Feature matrix §21 models them as two fields; the plan's §18.1b machine is a single linear axis mixing both. | Phase 18 |
| G-12 | Design tokens for **radius, shadow, motion duration and accent** are required numerically by plan §3.1a; the visual guide describes them only in adjectives. The type scale gives sizes but no weights, line-heights or tracking. | ~~Phase 3~~ **Closed in Phase 3** — every number fixed and recorded in notes §1.8.1. |
| G-13 | The visual guide gives page-level art direction for seven page types — **Cart and Checkout are absent**, as are Payload Admin and transactional email. | Phases ~~3~~, 14, 17, 19 — Phase 3's part is answered: guide §09's "Account / Utility" direction plus the token layer is what Cart and Checkout compose from, so no new visual language is needed for them. |
| G-15 | **The public URL of a single document.** The structure document draws the browsing namespaces (`SHOP`, `COLLECTIONS`, `EDIT`, `LOOKBOOK`, `JOURNAL`) but gives no path for an individual product, and no node at all for a campaign — while plan §9.1a requires a navigation item to be a *reference* whose href is derived at render time. | ~~Phase 9~~ **Closed in Phase 9** — one route map in `lib/navigation/routes.ts`, following the namespaces the document does give. See **D-30**. |
| G-14 | **Sale / compare-at price** and **selected/active** states need a visible accent, but the palette forbids saturated colour and prescribes low-contrast borders. | ~~Phase 3~~ **Closed in Phase 3** — selection is carried by contrast, compare-at is typographic, and the border rule is split. See notes §1.8.2, **DEV-21**, **DEV-22**. |
| G-16 | **Art direction for a promotional strip and a community gallery.** Visual guide §09 gives page-level direction for seven page types and neither section is among them, while plan §10.1a and feature matrix §3 both require them on the homepage. | ~~Phase 10~~ **Closed in Phase 10** — both are treated as editorial furniture governed by §09's Home composition rules and §06's component rules: hairline rules and Meta-sized statements for the strip, a 4:5 tile grid with a Micro credit for the gallery. Neither invents a visual language. |

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

***Confirmed in Phase 8, by measurement rather than by recollection.*** `@payloadcms/storage-cloudinary`
still returns a hard 404 on the registry, while `storage-s3`, `storage-vercel-blob`, `storage-azure`,
`storage-gcs` and `storage-uploadthing` all publish at exactly `3.88.0` — official adapters do ship at
our version, and Cloudinary is simply not one of them. The premise holds and the "revisit" clause has
not triggered. The adapter is `src/payload/storage/cloudinary.ts`.

*(This line previously read "Confirmed in Phase 8" while Phase 8 had not yet run — a forward-tense
marker that claimed a check nobody had made. It is now true.)*

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

`motion` was installed early in Phase 3 and removed: nothing in the design system needed it. See
**DEV-24**.

**Amended in Phase 10.** This decision originally deferred the library to Phase 10, *"with the
editorial reveals that first have something to reveal."* Phase 10 built those reveals and did not
install it — the argument above turned out to apply unchanged to a scroll reveal, and the library
would have introduced the second definition of motion this decision exists to prevent. See **D-34**
and **DEV-40**; `motion` stays an approved technology that nothing in the built product needs.

*Recorded in Phase 3, amended in Phase 10.*

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

### D-16 — Migrations are applied by the build, not by the server

Plan §5.1d requires that pending migrations reach production *"in a controlled way before the
application depends on the new schema"*, and that two deployments must not race them. The adapter
offers a second route — `prodMigrations`, which migrates from inside `connect()` when `NODE_ENV` is
`production`. That route is deliberately unused: it puts identical DDL in every cold-starting
serverless instance simultaneously, which is a race by construction rather than by accident.

The build applies them instead. The deployment build command is `pnpm build:deploy`
(`payload migrate && next build`), which gives three properties in one line: migrations land before
the code that needs them, a failed migration fails the build so nothing deploys, and re-running it
without a schema change runs no SQL, because `payload_migrations` already records what ran.

What it does not solve is concurrency across *deployments* — two builds started at once are two
processes issuing DDL. Nothing in the repository can prevent that; it is a platform setting, recorded
in `docs/DATABASE.md` §6 alongside the rule it implies: a migration must be backward compatible with
the deployment still serving traffic while it runs.

*Recorded in Phase 5, and proved against a real database before being written down.*

### D-17 — Primary keys stay `serial`; a public identifier is a separate column

`@payloadcms/db-postgres` can issue `uuid` or `uuidv7` primary keys, and the choice is effectively
permanent once Phase 6 has created every table — so it is taken here, before the data model exists,
rather than inherited by default.

Integer keys are kept. They are smaller in every index and every foreign key, and they insert in
order rather than scattering across the B-tree. The usual argument for UUIDs — not handing customers
a guessable, countable identifier — is real, but it applies to the handful of identifiers that
actually reach a customer, not to every join column in the schema. Where one does reach a customer,
the order number above all, the phase that introduces it adds an opaque public column beside the
primary key. That is what commerce systems do regardless of their key type, and it keeps the internal
key internal.

*Recorded in Phase 5. **Confirmed in Phase 6** — integer keys throughout, and the order number is the
opaque public column the entry predicted.*

### D-18 — A product's price and stock are a maintained cache, not a query

Closes **G-04** and **G-05**. Price and stock are owned by the variant, and every listing needs both at
the *product* level — a price on the card (feature matrix §4), a price sort (plan §11.1a), a Sale
state and a Sold-out state (plan §11.1b). The three places that could live are a query per card, a
Payload `virtual` field, or a denormalised column. The first two cannot be sorted or filtered by
Postgres, because neither produces a column.

So `products.derived` holds four values — lowest active price, highest, the compare-at belonging to
the *cheapest* variant, and the total units across active variants — recomputed by a variant hook
inside the caller's transaction. It duplicates nothing and derives everything: if it ever disagrees
with the variants, the variants are right, and re-saving any variant rebuilds it.

Two details are the decision rather than the implementation. The compare-at is the cheapest variant's,
not the largest discount anywhere in the product, because "$240, was $400" when the $240 variant was
never $400 is a false price claim — plan §24.1b forbids exactly that in structured data. And stock is
a **count**, not an `inStock` or `lowStock` flag: a flag computed against `lowStockThreshold` would be
stale on every product the moment an editor changed that threshold. Sold out is `= 0`, low stock is
`<= threshold`, both compared at render.

Review aggregates are deliberately *not* here. The same argument would apply, and it is not made,
because reviews are Phase 21 and a column no phase yet writes reads as zero on every product card in
the meantime.

### D-19 — Phase 6 defines the entities the corpus names, and no more

The rule the phase followed, stated because the omissions are otherwise indistinguishable from
oversights. Phase 6 implements plan §6.1a–6.1o plus the gaps §3.2 assigns to it (**G-01**–**G-05**).
A field whose only consumer is a later phase's *behaviour* is added by that phase.

So there is no `inventoryCommittedAt`, no `confirmationEmailSentAt`, no `checkoutIdempotencyKey`, no
Stripe event record, no email delivery record, no Algolia sync record — plan §17.1d, §19.1c and
§12.1b each require one, and each belongs to the phase that writes it (**G-07**, **DEV-10**). There is
no promotion-redemption table either: a per-customer usage limit is a count of paid orders carrying
that promotion, which the `orders.promotion` relationship already answers, and a second table
recording the same fact is the duplication the phase brief warns against.

The exceptions are the identifiers the tech stack §3 assigns to *this* side of an integration boundary
— `customers.stripeCustomerId`, and the order's Stripe session and payment-intent IDs. They are
columns of the mapping, not of the integration, and all three are read-only.

Adding a column later is an ordinary migration. Guessing at one now, and having it read empty through
five phases, is how a schema fills with fields nobody trusts.

### D-20 — Money is an integer count of minor units

`type: 'number'` compiles to Postgres `numeric` and is read back through Drizzle's
`numeric({ mode: 'number' })` — exact in the database, a binary float in JavaScript, which is the
worse half of both designs. Integers survive the round trip unchanged and are what Stripe's API
speaks, so the number that is stored is the number that is charged.

Every money column's name ends in `Minor`, and that is the enforcement: a field called `price` holding
`1999` is a bug waiting for `product.price * quantity`. A field validator refuses a fractional value,
because `min` and `step` govern only the admin widget and a REST client can send `19.99`.

The convention assumes a two-decimal currency. Adding a zero-decimal one (JPY) means revisiting the
formatting layer, not the schema.

### D-21 — Shoppers and staff are two auth collections

Plan §7.1b states a boundary: customers *"may NOT access Payload Admin"*. With one collection and a
role column, that boundary is a conditional inside an access function — one that has to be right on
every operation forever, and is one inverted comparison away from letting a shopper into the CMS.

With two, `admin.user` in the Payload config points at `users` and a customer has nowhere to log in
*to*. The guarantee is topological, like **D-08**'s route groups, rather than a rule that has to keep
being enforced. Phase 2's `users` collection anticipated this — *"customer-facing accounts are a
separate concern defined in Phases 6 and 7"* — and Phase 6 is the half that creates the entity. Roles,
access rules and the auth flows remain Phase 7's.

Email verification is deliberately off until **Phase 19**: `auth.verify` makes every registration
depend on an email being delivered, and there is no email infrastructure before then. §7.1e says
*"email verification **if enabled**"*, which is permission to decide.

### D-22 — Access control is a vocabulary, applied by name

Every collection's `access` block reads as a list of named rules from `src/payload/access/` —
`publishedOnly`, `ownedByCustomer('customer')`, `isStaff`, `isAdmin`, `nobody` — rather than as a
closure written out at each of twenty-three call sites.

The reason is auditability rather than brevity. "Who may read an order" is a question with one
answer, and the failure mode of inline closures is not that one of them is wrong on the day it is
written; it is that the twenty-third is subtly different from the first and nobody notices for a
year. A named rule is one implementation, one place to test, and one place to change.

The two halves that cannot be a rule are recorded where they are used: `enforceCustomerOwnership`,
because access control can say *who* may create a row but not *whose* it is, and field-level access on
`users.role`, `customers.accountStatus`, `reviews.status` and the Commerce tab of Site Settings,
because Payload denies a field by removing it from the write rather than by refusing the request.

### D-23 — Route protection is three layers, and only two of them are checks

`proxy.ts` (Next 16's renamed `middleware.ts`) redirects a visitor with no session cookie away from
`/account` before rendering begins. It does not verify the cookie: that would put Payload and a
Postgres round trip in front of every matched request, which is the cost the proxy exists to avoid.
It is an optimistic check, and Next's own authentication guide says not to make it the only one.

`requireCustomer()` in `src/lib/auth/session.ts` is the route-level check — memoised with React's
`cache()` so a layout and its children cost one verification — and it lives in the *pages*, not in
`account/layout.tsx`. A layout does not re-render on navigation within its own segment, so a check
placed there runs on the first load and then stops running, which is the difference between a guard
and a decoration.

`src/payload/access/` is the check that cannot be forgotten, because every read and write goes
through it including the REST API's.

### D-24 — There is a password policy, and it is not Payload's

Payload's built-in floor is **three characters** — `fields/validations.password` defaults `minLength`
to 3, inside `generatePasswordSaltHash` where no configuration reaches it. This project's floor is
twelve, with no composition rules, following NIST SP 800-63B: required digits and symbols measurably
push people toward `Password1!` and away from length, which is the property that resists guessing.

It lives in `src/lib/password-policy.ts` — a module with no imports, so the `customers` collection can
reach it through a relative path under tsx and the Zod schemas can reach it through the alias — and it
is enforced by a collection hook rather than only by the form, so the REST API, the admin panel and a
seed script are all held to it. The reset flow is the one path a hook cannot see (`resetPassword`
writes through `payload.db.updateOne`), so the action calls the same function directly.

### D-25 — The password-reset flow is real; only its delivery is stubbed

Plan §7.1e requires forgot-password and reset-password. Plan §19 owns Resend. Between them, Payload's
unconfigured default logs an email's *subject* and discards its body — which for a reset mail discards
the only copy of the token, leaving a form that submits, confirms, and cannot be completed by anyone.

So `src/payload/email/logEmailAdapter.ts` logs the whole message, and the flow is genuinely
end-to-end in development: submit the form, read the link out of the server log, choose a new
password. The token, the one-hour expiry, the single use, the session handling and the storefront
reset route are all real and all tested. Only the transport is missing, it says so at `error` level on
every send outside local development, and Phase 19 replaces the adapter without touching the flow.

### D-26 — Cloudinary transforms at delivery; Payload generates no image sizes

The tech stack assigns Cloudinary *"Product/editorial image delivery **and transformations**"*, and the
feature matrix says *"Cloudinary is media delivery; Payload stores media metadata/relationships."* Taken
literally, that settles an architecture: Payload stores **one** original per asset and every responsive
variant is a Cloudinary URL built at render time.

The alternative — Payload's `imageSizes`, which is how every official storage adapter works — was
rejected on measurement. Each declared size costs six columns and a b-tree index on the `media` table,
and each is a **separate upload**, so eight delivery contexts would mean 48 columns and nine uploads per
asset of work Cloudinary does natively for nothing. It also freezes the breakpoints into stored rows:
changing one would mean re-uploading the library.

What makes the chosen side cheap is a property of Cloudinary rather than a convenience: a delivery URL
is **pure string concatenation**, verified both in the SDK's own `generate_transformation_string` and
against the live CDN with no credentials. So `src/lib/media/cloudinary-url.ts` has no imports, needs no
secret, and can run anywhere — which is also how Phase 8's prompt, *"Never expose Cloudinary server
secrets to the browser"*, is satisfied by shape rather than by discipline.

The one thing this architecture must get right, and the thing a naive version gets wrong, is that
**every requested width has to be clamped against the stored dimensions**. `c_fill` will happily
upscale, and `c_lfill` — the documented "fill but do not enlarge" mode — silently abandons the aspect
ratio when the request exceeds the source, which is the layout shift §8.1d forbids arriving through the
option that looks safest. Both were measured; the clamp is in the builder.

### D-27 — `sharp` is not installed, and the crop tool is switched off

`DEV-28` and `docs/STACK_VERSIONS.md` both predicted Phase 8 would install `sharp`. It does not, and
both are corrected. A prediction is not a requirement; this project has withdrawn one before (DEV-17).

Under **D-26** nothing in the delivery path calls it. Dimensions do not need it — Payload falls back to
a header-only byte probe covering every format this project accepts. `adminThumbnail` as a *function*
needs neither `sharp` nor `imageSizes`. Focal point is stored regardless and is consumed by our own URL
builder as a Cloudinary gravity.

The deciding argument is the opposite of the expected one. Without `sharp`, Payload's crop UI **renders
and silently discards the crop** — the *"UI that looks functional but silently does nothing"* this
project forbids. Installing `sharp` would fix the silence and leave the tool wrong anyway, because every
delivered variant is re-derived from the original through Cloudinary, so a Payload-side crop would be
ignored by the thing that actually produces the image. `crop: false` is therefore not a concession to
the missing dependency; it is the only honest setting once D-26 is taken, and with the tool gone the
dependency has nothing left to do.

### D-28 — Media bytes are public, and the storage plugin is always registered

Two settings on `@payloadcms/plugin-cloud-storage`, both load-bearing and neither obvious.

**`disablePayloadAccessControl: true`.** The adapter's `generateURL` is called from exactly one place in
the plugin, and only when this flag is set. Without it, Payload keeps its own `/api/media/file/…` in the
`url` column and proxies every byte through the Next server — Cloudinary demoted to origin storage
behind a Node process. The consequence is that media bytes are public to anyone holding the URL, which
is true of every CDN-delivered asset and is why nothing private may be uploaded to this collection. It
also forces `skipSafeFetch: true`, disabling Payload's SSRF filter on the paste-from-URL ingest path —
so that path is closed independently with `pasteURL: false`.

**Registered unconditionally, switched by `enabled`.** Registering the plugin only when credentials
exist produces two different schemas from one committed migration: it injects a `prefix` column, and
with the plugin absent that column never appears. `alwaysInsertFields: true` pins the schema on both
sides, and the folder is a module constant rather than a setting because it becomes that column's SQL
`DEFAULT`. Verified: with Cloudinary unconfigured the generated migration still carries
`prefix varchar DEFAULT 'north01'`.

### D-29 — Images are `<picture>`/`<img>`, not `next/image`

Three reasons, and the first is decisive: **Next's optimizer requires `sharp` on the server**, which
D-27 removes. Beyond that it would re-encode an image Cloudinary has already encoded, at a cost per
image; and it renders a single `<img>`, so it cannot express art direction — visual guide §10's
*"intentional mobile crops instead of simply squeezing desktop images into a smaller box"* is a change of
**aspect ratio** across a breakpoint, which is `<picture>` and nothing else.

What `next/image` would have provided is now native HTML: `loading`, `decoding` and `fetchpriority` are
attributes. `src/components/media/media-image.tsx` therefore ships **no client JavaScript**, and needs no
`images.remotePatterns` entry, because Next never fetches the image.

The layout-shift guarantee §8.1d and §30.1b both ask for comes from one idea: **the box is a property of
the page, not of the picture.** The delivery context supplies the aspect ratio, so the rectangle is known
before it is known whether an asset exists, whether its bytes arrive, or whether the CDN 404s. Measured
in a browser across all those states: **CLS 0.0000**.


### D-30 — One route map owns every document URL, and a campaign has none

Gap **G-15**. Plan §9.1a drives the header from Payload, and `payload/fields/link.ts` models a
navigation item as a *reference* so that renaming a document cannot break the link — the href is
"derived from its current slug at render time, not stored." Nothing in the corpus says what that
derivation is. The structure document draws the browsing namespaces and never gives a path for a
single product; it has no `CAMPAIGN` node at all.

`src/lib/navigation/routes.ts` is the whole derivation, and no other file may build a document URL:

| Collection | Route |
|---|---|
| `products` | `/product/<slug>` |
| `categories` | `/shop/<slug>` |
| `collections` | `/collections/<slug>` |
| `edits` | `/edit/<slug>` |
| `lookbooks` | `/lookbook/<slug>` |
| `journal` | `/journal/<slug>` |

The map is **total**: every collection an editor may point a link at has a route. `verify-shell.ts`
asserts that, one check per entry in `LINKABLE_COLLECTIONS`, so the two lists cannot drift apart.

Two things worth being explicit about.

**The namespace is the structure document's word, not the Payload collection slug.** The collection is
`edits` and the route is `/edit/…`; `lookbooks` and `/lookbook/…`. Structure §2 owns user-facing IA —
the authority ruling that settled **C-03** — and a URL is user-facing. `/product/<slug>` is singular for
the same reason: it is the plan's own canonical name and it matches the singular namespaces already in
use. `/collections` stays plural because that is how the document spells it.

**`campaigns` is absent from both the map and the linkable set** — a deferral, **DEV-39**. A campaign
has no public URL in any document, and the first version of this decision left it *linkable* with a
route of `null`, which made the admin panel offer a target the header then silently dropped. Offering a
choice that does nothing is plan §0.1.17 wearing a relationship field, so the choice was removed. It
comes back when a campaign has a page: one entry here, one in `LINKABLE_COLLECTIONS`, and the migration
that restores the `campaigns_id` columns.

This is also why the shell **drops** rather than disables. An item whose target is missing, deleted,
unpublished, scheduled, or in a collection with no page is removed from the rendered navigation. A dead
link is the "broken internal route" the feature matrix asks us to handle; a *disabled* navigation item
is plan §0.1.17's fake control with an apology attached. A shorter menu is the honest outcome, and an
empty column, an empty menu and an empty header are all states the components render without complaint.

---

### D-31 — The global 404 is `global-not-found.tsx`, behind Next's experimental flag

The one experimental Next flag in this project, and **D-08** is what put it there.

Two root layouts means there is no single layout from which a root `app/not-found.tsx` can be composed,
which is exactly the case Next's own documentation names `global-not-found.js` for. Without it, every
URL the Phase 9 navigation points at before its own phase is built — `/shop` (Phase 11), the product
route (Phase 13), `/lookbook` (Phase 22), `/about` and the support surface (Phase 23, **G-08**) — lands
on Next's built-in 404: no header, no footer, no typography, no way back into the shop. Mounting a
global header is what created that exposure, so the phase that mounts it closes it.

The alternative considered and rejected was a catch-all `[...slug]` route inside `(frontend)`. A
top-level catch-all in one route group competes for every path with the *other* group's `/admin` and
`/api`, which is a routing hazard aimed squarely at the CMS.

**The cost, stated plainly.** `experimental.globalNotFound` is not a stable API and may change shape or
name. The exposure is one file and one config key: delete `src/app/global-not-found.tsx` and the flag
together and the behaviour reverts to Next's default 404, losing nothing else.
`(frontend)/not-found.tsx` is the stable half of the pair and handles `notFound()` thrown inside a
route that does exist; it needs no flag. **Phase 31** owns error, empty and loading states as a system
and should absorb both.

---

### D-32 — The shell is cached by tag, and its failure is a fallback rather than a page

The header and footer are in the storefront root layout, so their two `findGlobal` calls would
otherwise be on the critical path of every page — and a failed read would take out the whole site
rather than the piece of content it belongs to.

**Caching.** `lib/navigation/shell.ts` wraps the read in `unstable_cache` under three tags with a
300-second floor, and `payload/hooks/revalidateTags.ts` calls `revalidateTag` from an `afterChange`
hook on both globals. An editor's change therefore reaches the storefront on the next request rather
than on the next deployment, and the timer is the backstop for a write the hook cannot see — a script,
a migration, a direct SQL edit. `cacheComponents` is not enabled, so this is Next 16's previous caching
model; if a later phase turns it on, this becomes `"use cache"` with `cacheLife`/`cacheTag` and nothing
else about the module changes.

The hook has to survive running **outside** Next — `pnpm seed` writes both globals from a CLI process
with no server to revalidate — so `next/cache` is imported dynamically inside a `try`, and a failure
warns rather than throwing. The write has already committed by the time an `afterChange` hook runs;
throwing there would report failure for a change that happened.

**Failure.** The `try` is around the *call*, not inside the cached function. A function that throws
stores nothing, so a database blip degrades one request instead of pinning a degraded header in the data
cache for five minutes. What it degrades to is `lib/navigation/fallback.ts`: the six primary
destinations and the structural footer columns — facts about this site's information architecture — and
**no mega menu, no featured panel, no social links**, because those are merchandising and fabricating
them would put words in an editor's mouth.

Phase 9's audit measured all four failure modes against an unreachable database, and they layer. The
fallback is one of them, and it is **not** the outermost:

| Scenario | Result |
|---|---|
| A statically prerendered route (`/`) | **200**, real CMS content, database never contacted — the prerender is a stronger guarantee than the fallback |
| A dynamic route rendering the shell | **200**, fallback navigation, `[shell] Falling back…` in the log |
| A dynamic route with its own data access (`/login`, `/account`) | **500** — correctly: the page has nothing true to show |
| `pnpm build` | **exit 1** — a deploy against a broken database fails loudly rather than silently baking a fallback site |

So the fallback protects *the shell's own two reads*. It is not, and should not be read as, a promise
that the storefront survives a database outage; the first row is what does that, and it does it better.

---

### D-33 — The homepage is a global of typed blocks, and its rules live in a pure resolver

Plan §10.1a asks for *"reorderable, typed blocks"*. There is exactly one homepage, so it is a
**global** (`homepage`) rather than a collection: a collection would need a slug, a publish status, a
rule deciding which row is live and a route resolver — four mechanisms to express a singleton.
`SiteSettings` and `Navigation` set that precedent and Phase 9 proved the pipeline against it.

Eleven block types, of which **five are the existing `blocks/editorial.ts` objects, imported
unchanged**. Payload sanitises a block config once and keys storage off the parent table name, so one
object serves three parents, produces three separate tables, and yields **one** shared interface in
`payload-types.ts`. Two of plan §10.1a's ten named blocks — "Editorial split" and "Brand story" — are
the *same shape*, and shipping two identical schemas so a picker could name both would be the
duplicate abstraction §A.1.6 forbids (**DEV-43**).

The split that matters is the same one Phase 9 used: `lib/home/resolve.ts` is **pure** — no `next`,
no `server-only`, nothing runnable from `payload` — so every drop/keep rule for feature matrix §3's
edge cases is exercised by `pnpm verify:home` outside a request, and `lib/home/home.ts` holds only
caching and a `try`. Publication is re-tested at render because the Local API's default
`overrideAccess: true` propagates into population; the homepage's surface is wider than the shell's,
because products carry `status` **and** are soft-deletable.

Cached under one tag, `home`, with the same 300-second floor; the `homepage` global and the
`campaigns` collection both revalidate it. Products deliberately do not — they fire on every variant
save through `syncProductDerived`, and a rail is a five-minute-stale merchandising surface by design.

*Recorded in Phase 10.*

### D-34 — The editorial reveal is CSS on the existing duration tokens; there is still no animation library

**Amends D-13**, which deferred `motion` to this phase.

Measured before deciding: `motion@13.1.1` is **8.64 MiB across four packages** and ~**40 KB gzip** on
the LCP route — the one route plan §37's performance gate names. Two facts settled it beyond size.
`MotionConfigContext` defaults to `reducedMotion: "never"`, and even when opted in it neuters only
positional keys — **opacity is not among them** — so a reduced-motion visitor gets every fade at full
duration. And it animates through the Web Animations API, which does not read CSS custom properties,
so `prefers-reduced-motion` would have needed a *second* implementation beside the media query in
`globals.css` that already collapses every duration token to 1 ms. That second definition of motion
is exactly what D-13 exists to prevent.

What ships instead is two CSS declarations and one client component (`components/editorial/reveal.tsx`)
using `IntersectionObserver`. **The hidden state exists only when JavaScript sets it**, so content is
visible with JS disabled, before hydration, on a failed hydration, in a browser without the observer,
and in print — there is no path on which a section can be stranded invisible.

CSS scroll-driven animation (`animation-timeline: view()`) was rejected for that same property: a
subject inside an `overflow: hidden` ancestor binds its timeline to an unscrollable container and sits
at `opacity: 0` permanently. It also ignores `animation-duration`, which would have moved pacing out
of the token layer, and it scrubs — scrolling up un-reveals.

*Recorded in Phase 10. See **DEV-40**.*

### D-35 — Rich-text hrefs are re-validated at render

Every other link in this application is refused at save time by `payload/fields/link.ts` and
re-checked at render by `navigation/resolve.ts`. A **Lexical link node has been through neither**:
`payload.config.ts` registers `LinkFeature()` with no field override, so it stores whatever URL an
editor typed.

Phase 10 is the first phase to put editor-authored rich text on a public page (campaign stories,
editorial bodies). `components/editorial/prose.tsx` therefore runs every href through the same
`isInternalHref`/`isExternalHref` pair — which is `lib/same-site-path.ts`, the one rule, not a
`startsWith` written out again — and **renders a failing link as plain text**. The sentence still
reads; only the navigation is removed.

That closes `javascript:` and `data:` URLs, and the protocol-relative `//evil.example` and
tab-prefixed `/	/evil.example` forms Phase 9's audit found accepted in four separate files.

*Recorded in Phase 10.*

### D-36 — The engine is chosen per query, not per route

Plan §11.1d says *"use Algolia as the query/facet engine"*; plan §0 says Postgres is the source of truth;
plan §A.5 says the catalogue must stay usable when Algolia is down. All three hold once the question stops
being *"which engine runs the shop"* and becomes **"which engine can answer this query"**.

`lib/catalog/query.ts`'s `requiresSearchIndex` is that predicate, and it states a fact about the schema
rather than a preference. Three of feature matrix §5's six facets are not columns on `products`:

| Facet | Stored on | Engine |
|---|---|---|
| Category, Price, Availability, every sort, the page | indexed columns on `products` | **Postgres** |
| Size, Colour | `product-variants` — reached through a Payload `join`, which has no column | **Algolia** |
| Collection | `collections.products` — membership is owned by the list | **Algolia** |

Answering *"products with an active Black variant in M"* from Postgres means querying the variant table,
collecting distinct product ids and paginating over that — the *"expensive full-catalog scan on every
request"* §11.1d forbids by name.

The consequence is the one **D-04** predicted: an Algolia outage cannot take the shop down. `/shop`,
`/shop/<category>`, all five sorts, the price filter and the in-stock filter keep working. Only the three
variant-and-membership facets degrade, into §11.1d's stated fallback — a controlled state offering category
navigation, never an empty grid implying the shop has nothing. **Measured** in Phase 11 against a
deliberately unreachable Algolia application: unfiltered 10 products, `/shop/clothing` 8, `?priceMax=150`
2, `?availability=in-stock` 10, `?sort=price-desc` 10, and `?color=black` the unavailable state.

*Recorded in Phase 11.*

### D-37 — The search index stores no customer-visible data

An Algolia record here carries facets, ranking attributes, a name and a slug — and **no price, no image,
no description**. A query returns `objectID` and nothing else (`attributesToRetrieve: ['objectID']`), and
`lib/catalog/catalog.ts` reads those ids back from Postgres through the ordinary access-controlled
`payload.find`.

That is the opposite of the usual Algolia record, and it is what makes *"Algolia is a derived search
index"* true at render rather than only in principle. An index is a copy and a copy is stale between the
write and the sync; a grid rendered from one would show the name and price of a product unpublished thirty
seconds ago, and a price edit would be visible in a listing before it was true in the database.

The cost is one extra indexed round trip on a filtered query. What it buys: a stale id costs one missing
card and can never cost a wrong price, a draft product, or a garment deleted an hour ago — so plan §12.1d's
*"deleted product still in index"* and *"product unpublished after index update"* are handled by
construction. It also means **one** card resolver for both engines, rather than two rendering paths that
drift.

*Recorded in Phase 11.*

**Amended in Phase 12, and the amendment matters.** This entry originally implied that returning only
`objectID` was a confidentiality boundary. It is not. `attributesToRetrieve` is an index **default**
that a per-request parameter overrides — measured with the *public* search key alone, a query asking
for `['name','slug','priceFromMinor']` returned all three. Nothing confidential is exposed, because
`buildProductRecord` keeps drafts, scheduled drops and withdrawn products out of the index entirely;
but the guarantee this decision buys is **staleness**, not secrecy, and it must be described that way.

Two things follow. `attributesToHighlight: []` is mandatory rather than cosmetic: a text query returns
`_highlightResult` alongside `objectID`, carrying the product name with `<em>` markup plus fit,
materials and tags — so without it this decision's own sentence becomes false the moment text search
is enabled. And `unretrievableAttributes: ['inventoryTotal']` is the one setting here that **is** a
hard boundary, since no search key can override it.

---

### D-38 — Popular searches are curated by an editor, not read from analytics

Plan §12.1c lists *"popular searches"* as a search-panel section and no document says where they come
from. They are an array on the `site-settings` global, validated against the index once per cache
window, with any zero-hit term dropped; an empty surviving list means the section is **absent**.

The objection to Algolia Analytics is data quality, not access — the write key already carries the
`analytics` ACL and `getTopSearches` works. The measured top search for this application was
`{ search: '', count: 18 }`, the **empty string**, eighteen times the next, because every faceted
`/shop` request sent `query: ''` while Algolia's `analytics` parameter defaults on; several other
recorded terms were engineer probes matching nothing. Rendering that list would offer a customer a
"popular search" whose only destination is the no-results page — §0.1.17's fake control, arriving with
official provenance.

Recording queries to build a corpus *is* `search_submitted`, which is Phase 25's. Phase 12 sets
`analytics: false` on browse queries so the corpus stops being polluted, and Phase 25 can feed this
same field from real behaviour later without changing a line of the reader.

*Recorded in Phase 12.*

---

### D-39 — Suggestions rehydrate from Postgres; D-37 is not relaxed for the typeahead

The obvious optimisation for an as-you-type panel is to let the index return names and prices, saving
a database round trip per keystroke. It is refused.

Feature matrix §2 requires that a *"deleted/unpublished product indexed stale"* has its *"publish
state validated before display"*, and a row rendered from index-resident fields has had no such fetch.
There is also a case no index-freshness policy can ever cover: a product that becomes unlistable
because the clock passed its `publishedAt` generates no write, so no sync hook fires. Only the
read-time `publishedProductWhere` clause catches it.

The suggestion path therefore calls the **same** `rehydrateProductIds` the results grid calls — one
path from an index id to a card, so the two cannot drift. The cost is bounded by four mechanisms,
three of which are corpus compliance rather than optimisation: a two-code-point floor (§12.1d's
*"empty query"* and *"1-character query"*), a 200 ms trailing debounce, last-request-wins via an
`AbortController` and a monotonic request id, and a per-panel-session memo.

Explicitly rejected: caching the suggestion path under `unstable_cache` at any TTL. `catalog.ts`
already refuses that pattern for a strictly smaller key space, and a free-text term keyed by
unauthenticated input is worse on every axis.

*Recorded in Phase 12.*

---

### D-40 — A search term joins the one URL parser map

`q` is a member of `CATALOG_PARSERS` rather than a parser of its own, which makes `/search` a third
caller of `CatalogPage` instead of a second implementation of it. Feature matrix §2's four
requirements for a full results page — query in the URL, filters and sorting in the URL, a result
count, pagination — are inherited rather than rebuilt, along with canonicalisation, the filter chips,
the out-of-range redirect and Back/Forward.

`/shop?q=` redirects to `/search?q=`, composed into the **same** redirect as canonicalisation so no
URL can redirect twice — the fixed-point property `verify-catalog` check B2 asserts and the notes
record as the fix for Phase 11's highest-severity defect.

*Recorded in Phase 12.*

---

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

**Phase 5 — Neon Postgres + Payload CMS foundation: complete.**

The migration baseline and the discipline around it (**D-16**), the schema conventions the data model
will inherit (**D-17**, `docs/DATABASE.md` §8), and one fixture collection — `schema-probes` — whose
only job is to make those conventions concrete and prove them. No new dependencies: the adapter, the
migration CLI and Drizzle have all been installed since Phase 2.

| Phase 5 acceptance | Status |
|---|---|
| Payload admin works against Postgres (§5.1) | **pass** — driven in a real browser against a database built from the committed migration, not from push |
| Create/read/update/delete a test collection (§5.1) | **pass** — three ways: admin panel, REST through the running app, and the Local API |
| Migrations generated and applied successfully (§5.1) | **pass** — generated, applied, rolled back with `migrate:down`, re-applied, and rebuilt from nothing with `migrate:fresh` |
| App survives database restart/reconnect (§5.1) | **pass** — every backend of a running server terminated; the next three requests returned 200 |
| Development push, committed migrations elsewhere (§5.1d) | **pass** — and the two were proved to produce an *identical* schema |
| Indexes, unique constraints, foreign keys (§5.1d) | **pass** — single and compound unique, `ON DELETE SET NULL`, filter-column indexes |
| Nullable vs required deliberate, timestamps, soft delete (§5.1d) | **pass** — `trash: true` with `deleted_at`, kept distinct from the editorial `status` |
| Build-time migration for production, no racing deployments (§5.1d) | **pass** — `pnpm build:deploy`, **D-16**; deployment serialization is a platform setting and is documented |
| Connection failures surface clearly, without secrets (§5.1 prompt) | **pass** — measured: named error, exit 1, zero occurrences of the password in the output |

The reviewing pass found one real defect and it was fixed rather than noted: the adapter attaches an
`error` listener to a single client, so any *other* idle connection dying — a suspended Neon compute,
a dropped socket — emitted `error` on a pool with no listener, which Node turns into
`uncaughtException`. `next dev` has its own handler and survived; a production server does not. An
`onInit` hook now attaches one. Re-measured after the fix: zero uncaught exceptions, one log line,
requests unaffected. Details: notes §1.10.

**Phase 6 — Payload data model: complete.**

Twenty-two collections, two globals, seventy-three tables. Every entity plan §6.1a–6.1o names, plus the
five gaps §3.2 assigned to this phase (**G-01**–**G-05**) and the additions **DEV-10** predicted. One
dependency added — `@payloadcms/richtext-lexical` — for a phase that defines the whole domain model,
because a data model is configuration rather than libraries.

| Phase 6 requirement (§6 prompt) | Status |
|---|---|
| Relationships, validation, indexes, unique constraints | **pass** — four compound uniques, single uniques on every human-typed key, indexes on every filter and sort column |
| Access control | **deferred to Phase 7 by design** — Payload's default is `Boolean(req.user)`, which is closed, not open |
| Publishing status | **pass** — `status` + `publishedAt`, not Payload drafts. `docs/DATABASE.md` §8 gives the column-level reason |
| Historical order snapshots | **pass** — measured: renaming a product left the order line unchanged |
| Generate and test migrations | **pass** — `up`, `down` and `up` again against a real database; both directions found and fixed a Drizzle codegen defect |
| Seed representative demo content | **pass** — `pnpm seed`: 9 categories, 10 products, 65 variants, 4 collections, 4 Edits, a campaign, a lookbook, 3 articles, 6 FAQs, 2 promotions, both globals |
| Inspect the schema, explain compromises | **pass** — the denormalisation is **D-18**; the SKU constraint and the delete cascades are in `docs/DATABASE.md` §8 |

Twenty-four behavioural checks were run against the live database — constraints, cascades, snapshot
immutability, soft delete, normalisation, the derived cache — and all twenty-four passed. Three real
defects were found by running them rather than by reading: a `dbName` that collapsed one block into a
shared table with the wrong parent foreign key, required address sub-fields that made plan §18.1a's
draft order impossible to save, and delete cascades written on `afterDelete` when the foreign-key
violation happens *during* the delete. Details: notes §1.11.

**Phase 7 — Access control and authentication: complete.**

Three roles, an access rule on every collection and both globals, and the six §7.1e flows.
**No dependency was added**: authorisation is Payload's own access layer, the forms are React 19
Server Actions and `useActionState`, and validation is the Zod already installed in Phase 4.

| Phase 7 requirement | Status |
|---|---|
| Customer, Editor, Admin roles (§7.1a) | **pass** — Editor and Admin are `users.role`; Customer is its own auth collection (**D-21**) |
| Customers read their own profile, orders, wishlist, addresses (§7.1b) | **pass** — `ownedByCustomer`, which returns a `Where` so a cross-account read is *empty* rather than *forbidden* |
| Customers cannot read or modify another customer's records (§7.1b) | **pass** — proved for orders, addresses, wishlist, carts and profiles; `pnpm verify:access` |
| Customers cannot read admin-only fields or reach Payload Admin (§7.1b) | **pass** — `canAccessAdmin` is false for a customer *before* any rule runs, and staff-only fields are stripped from their writes |
| Editors get merchandising, not financial administration or credentials (§7.1c) | **pass** — Users hidden and refused; deletions admin-only; the Commerce tab of Site Settings read-only, confirmed in the panel |
| Admin manages everything (§7.1d) | **pass** — with one refusal: an admin may not delete their own account, which would lock everyone out |
| Registration, login, logout, forgot, reset, sessions, protected routes (§7.1e) | **pass** — `/register`, `/login`, `/forgot-password`, `/reset-password`, a POST sign-out, and `/account` behind `requireCustomer()` |
| Email verification if enabled (§7.1e) | **deliberately off until Phase 19** — see **D-21**; there is no transport to verify with |
| The §7.1e edge cases | **pass** — all ten, driven in a browser; see notes §1.12 |
| Automated tests for cross-user access and role escalation (§7.1e prompt) | **pass** — `pnpm verify:access`, 45 checks (43 in Phase 7; two added in Phase 9, see notes §1.14.12). The *framework* is Phase 27; the assertions exist now |

Two defects were found by running the code rather than reading it, and both were fixed here. React
**resets** an uncontrolled form once its action resolves, so a rejected sign-in emptied the email
field — the fix is `defaultValue` echoed from the returned state, with the password deliberately not
echoed. And the first version of `verify-access.ts` treated *any* thrown error as a passing access
check, which meant a fixture with one wrong field name would have reported a clean run while proving
nothing; it now names the errors it will accept.

Accessibility: **0 axe-core violations** across all five new routes, at WCAG 2.0/2.1/2.2 A and AA,
against the production build. Details and evidence: notes §1.12.

**Phase 8 — Media and Cloudinary: complete.**

Two dependencies added — `@payloadcms/plugin-cloud-storage@3.88.0` and `cloudinary@2.10.1` — and one
**removed from the plan**: `sharp`, which D-27 explains.

| Phase 8 requirement | Status |
|---|---|
| Payload metadata + Cloudinary delivery (§8.1a) | **pass** — a first-party adapter on Payload's own storage interface; **D-03 confirmed against the registry** |
| Asset ID, public identifier, alt, caption, focal point, media role, dimensions (§8.1a) | **pass** — six columns; `role` is a real consumer-facing default, not a label nothing reads |
| Transformation metadata where useful (§8.1a) | **as code, not columns** — the eight contexts in `lib/media/cloudinary-url.ts`; stored derivative rows were rejected with D-26 |
| Allowed mime types, max dimensions, max file size, reasonable formats (§8.1b) | **pass** — and setting `mimeTypes` is what switches Payload from trusting the *browser's* claim to sniffing the bytes |
| Do not accept arbitrary executable files (§8.1b) | **pass** — proven against a shell script, an `MZ` executable, an XML-prefixed SVG, an HTML document and a **GIF/executable polyglot**, all refused |
| Responsive variants for six contexts (§8.1c) | **pass** — eight, including the OG card `fields/seo.ts` already promised and the uncropped zoom the PDP needs |
| Neutral placeholder, preserved dimensions, no broken-image shift (§8.1d) | **pass** — measured in a browser at **CLS 0.0000** across all four states |
| Never expose Cloudinary secrets to the browser (§8 prompt) | **pass** — the SDK is imported by exactly one server file; the URL builder has no imports at all |

**Three defects were found by measuring rather than reading**, and all three would have shipped:
`c_lfill` silently abandons the aspect ratio when a request exceeds the source; clamping to the source
*width* is insufficient once a crop changes the ratio, because the binding constraint moves to the
height; and `fl_relative` makes Cloudinary's `x_`/`y_` **multiply** the source dimensions, so the first
focal-point implementation asked for a 345,600 × 432,000 image and got a 400. A fourth was found in a
browser: the art-directed *placeholder* did not change shape at the breakpoint, which mattered because
with no assets in the catalogue the placeholder is the only path that renders.

**The phase was committed on the degraded path**, at the project owner's direction — uploads falling
back to local disk, every image rendering as its placeholder, and `lib/env.core.ts` warning at startup
if that state is ever reached outside local development. That path remains supported and is what a
contributor without credentials gets.

**Credentials arrived shortly afterwards and the live half ran with no edit: 61/61**, up from the 48
provable without an account. It confirmed the one thing that could not be reasoned about from here —
*Strict transformations* is off, so dynamically built delivery URLs derive on the fly — along with the
whole storage round trip: public id, asset id, version and resource type stored from Cloudinary's own
response, `media.url` pointing at the CDN, Cloudinary's dimensions replacing the local probe's, every
`srcset` candidate for a real record resolving, and a deleted record leaving a 404 behind. Notes
§1.13.14.

**Phase 9 — Storefront shell: complete.**

The header, mega menu, mobile drawer, footer, search overlay and bag drawer, mounted in the storefront
root layout and driven by the `navigation` and `site-settings` globals. **No dependency added** — the
mega menu is `radix-ui`'s NavigationMenu, which was already installed.

| Phase 9 acceptance | Status |
|---|---|
| Desktop navigation and utility actions (§9.1a) | **pass** — six items from the CMS; search and bag open overlays, wishlist and account are links |
| Mega menu content driven from Payload (§9.1b, feature matrix §1) | **pass** — columns and featured panel from the `navigation` global; *"do not make it visually overwhelming"* held to |
| Mobile drawer with hierarchical expansion (§9.1c) | **pass** — one self-collapsing level, no accidental navigation, Escape, focus trap and restore, scroll containment. The back button is **DEV-36** |
| Global cart drawer, working from every page (§9.1d) | **pass** — mounted outside every route subtree; empty-bag state only, because nothing can add to a bag before Phase 14 |
| **Open/close search, menu and cart from any route without state conflicts** | **pass** — one state machine, at most one overlay representable |
| Missing item · unpublished collection · broken internal route (feature matrix §1) | **pass** — all three resolved to *dropped*, proven against real documents in three publication states |
| Keyboard navigation, reduced motion (feature matrix §1) | **pass** — driven in a browser at both widths |
| Accessibility | **0 axe-core violations** across five route and overlay states, WCAG 2.0/2.1/2.2 A + AA |

**One real defect was found by driving a browser rather than by reading the code**, and it was invisible
in the markup: Radix's modal dialog restores focus to `Dialog.Trigger`, and these overlays have none —
their triggers are in the header, their dialogs beside the footer, because §9.1d requires them to work
from every page. `DialogContentModal`'s own `onCloseAutoFocus` therefore focused a null ref and dropped
focus to `document.body` on every close: a WCAG 2.4.3 failure no static check would have reported. The
shell now owns the restore itself.

`pnpm verify:shell` — **100 checks**, including the publication states as real Payload documents rather
than fixtures, and the open-redirect and prototype-chain regressions the audit added. 49 browser checks at 1440×900 and 390×844. New decisions **D-30**, **D-31**, **D-32**;
gap **G-15** closed; deviations **DEV-36**, **DEV-37**, **DEV-38**, **DEV-39**.

**A post-implementation audit followed the phase and found four defects**, the first of which is a
security defect in **Phase 7** code: one same-site-path rule copied into four files, all four accepting
`/\t/evil.example`, which a browser resolves to `//evil.example`. `/login?next=/%09/evil.example` sent
a signed-in customer to another domain — demonstrated against the running application, and closed by
`lib/same-site-path.ts`. Also: `documentHref` answered for `Object.prototype` members (one of which
threw, degrading the whole shell); the search and bag triggers carried no `aria-haspopup` or
`aria-expanded`, which is the *same* root cause as the focus defect fixed during the phase with only
half of it addressed; and two navigation items at one URL shared a mega-menu panel. Notes §1.14.13.

One migration —
`20260828_060719_phase_9_defer_campaign_links` — which drops four `campaigns_id` columns and is the
only schema change in the phase.

**Phase 10 — Homepage / editorial system: complete.**

The homepage as a `homepage` **global** of eleven typed, reorderable block types — five of them the
Phase 6 editorial blocks imported unchanged. **No dependency added**; direct dependencies stay at 22.

| Phase 10 acceptance | Status |
|---|---|
| Reorderable, typed blocks (§10.1a) | **pass** — eleven types; the five reuses are argued in **DEV-43**, and `blocks/editorial.ts` predicted them |
| Hero: desktop + mobile media, season, headline, body, two CTAs (§10.1b) | **pass** — all from the campaign document; the secondary CTA is a new field on `campaigns` |
| Hero: optional video (§10.1b) | **deferred, DEV-41** — §30.1c forbids autoplaying video on this route, and no frame could be reserved from a container Payload does not probe |
| Hero edge cases — CTA omitted, mobile image omitted, video unavailable, media loading, text too long (§10.1b) | **pass** — the last is removed *by construction*: the copy never sits over the crop (**DEV-44**) |
| Every editorial block has an explicit path into commerce (§10.1c) | **pass** — structurally for `collectionFeature`, whose subject is a reference, so a path exists even with no CTA authored |
| Responsive sizes, lazy loading, priority only on the LCP image (§10.1d) | **pass** — measured: exactly one `fetchpriority="high"`, every other image lazy, and no image delivered smaller than its box |
| Skeletons for asynchronous product data *where needed* (§10.1d) | **none, deliberately** — `/` is prerendered static and all reads are in one cached loader; a `loading.tsx` would put the LCP behind a boundary. Notes §1.15.9 |
| Connected to real Payload data; no hard-coded product content | **pass** — the page renders only what the global holds |
| Empty / missing media and incomplete blocks handled gracefully | **pass** — every edge case in feature matrix §3 asserted in `verify-home.ts` |
| Accessibility | **0 axe-core violations** at 1440×900 and 390×844; the scrollable rail is keyboard-operable, which axe cannot see |

`pnpm verify:home` — **173 checks**, including the publication states as real Payload documents and
the invariant that **no generated identifier has been truncated at 63 bytes**. 55 browser checks
across §30.1a's eight widths. `verify:access` 45/45, `verify:media` 61/61, `verify:shell` 100/100 all
unchanged. New decisions **D-33**, **D-34** (amending **D-13**), **D-35**; gap **G-16** closed;
deviations **DEV-40**–**DEV-44**, discharging **DEV-24** and **DEV-25**.

**A post-implementation audit followed the phase and found 36 defects of 39 claims** (2 high, 8
medium, 26 low; 3 refuted), all fixed. The first is a security defect **decision D-35 claimed to have
closed**: `Prose` spread `defaultConverters` and overrode only `link`, while Lexical's `autolink`
node — created by the editor's own plugin whenever someone types something URL-shaped — rendered its
stored URL unvalidated, so `//evil.example/phish` and a `data:text/html` payload became live anchors
on the homepage. The save side could not catch it either: `AutoLinkNode` declares no `getSubFields`,
so the `url` field's hooks and validators never run on it. The second: `getHome`'s documented *"never
throws"* was itself the defect, because a failed **background regeneration** then returned a valid
empty homepage that ISR cached over the good HTML for five minutes — the `try` had been reasoned
about for the data cache, and the route cache is a second one.

Nine of the thirty-six were **docblocks asserting a property the code does not have**, which is the
audit's own conclusion: the docblock is the specification the next phase trusts, and it is the only
artefact in the repository that nothing executes. Notes §1.15.12.

**Two defects found by measuring rather than reading** *during* the phase. The editorial reveal stranded six sections
permanently invisible when the reader jumped to the foot of the page — an `IntersectionObserver`
reports threshold *crossings*, and a section that skips past the viewport in one scroll never fires
one; the component's own docblock had claimed this could not happen. And a **Phase 7** defect the
newsletter schema exposed: `z.email().trim()` validates the *untrimmed* input, so a pasted address
with a leading space was rejected on the sign-in, registration and reset forms — precisely the case
`auth/schemas.ts` said the trim existed to handle. Notes §1.15.6 and §1.15.7.

One migration — `20260828_085710_phase_10_homepage` — purely additive: 17 tables, 15 enums, 3 columns
on `campaigns`, no `DROP COLUMN` and no `DROP TABLE` in its `up`. Applied, rolled back and re-applied
on a throwaway database, and the resulting schema **diffed identical** to the pushed development one
across 867 columns, 519 indexes, 282 constraints and 68 enums.

**Next: Phase 11 — product catalog and discovery.**

**Cleared before Phase 3** (2026-08-23, all three from Phase 2's own edge-case list):

| Was | Now |
|---|---|
| `process.env.X \|\| ''` for `DATABASE_URL` and `PAYLOAD_SECRET` | throws at config load with an actionable message — the silent substitution §4.1b forbids is gone |
| `sslmode=require`, which `pg` v9 will redefine as *skip verification* | `sslmode=verify-full`, behaviour-neutral today and immune to the change |
| Unknown whether the app can own routes under Payload's `/api` | verified it can; the collision rule is recorded for Phase 6 |

**Genuinely owed by later phases** — sequencing, not debt. Each has a phase that will do it:

| Owed | Phase | Why |
|---|---|---|
| A production database, and the Vercel setting that stops two deployments migrating at once | 24 | Both are the project owner's to provision and configure; `docs/DATABASE.md` §6 says what is needed |
| ~~Removing the `schema-probes` fixture~~ | ~~6~~ | **Done in Phase 6** — its own migration, and the rehearsal that found the `DROP CONSTRAINT` ordering defect before a real table met it |
| CI running typecheck, lint, tests and build | 27 | Plan §27.1f |
