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
| `src/lib/` | integrations, infrastructure, **server-only** modules | Phase 4 |
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
| C-10 | Storybook is *"Recommended"* in the tech stack, a mandated feature area in feature matrix §33, and plan §3.1d permits *"a Storybook **or equivalent** visual test page"*. | Plan (rank 1) — most permissive and most specific | Storybook is the intent; the obligation is that every primitive is demonstrable in all its states. Settled in Phase 3. |
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
| G-12 | Design tokens for **radius, shadow, motion duration and accent** are required numerically by plan §3.1a; the visual guide describes them only in adjectives. The type scale gives sizes but no weights, line-heights or tracking. | Phase 3 |
| G-13 | The visual guide gives page-level art direction for seven page types — **Cart and Checkout are absent**, as are Payload Admin and transactional email. | Phases 3, 14, 17, 19 |
| G-14 | **Sale / compare-at price** and **selected/active** states need a visible accent, but the palette forbids saturated colour and prescribes low-contrast borders. | Phase 3 |

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

### D-10 — Drizzle schema push is off from the first commit

`@payloadcms/db-postgres` enables Drizzle's `push` in development by default, which syncs schema changes
into the database without a migration. It is set to `push: false` from Phase 2, with `migrationDir` at
`src/payload/migrations`.

Plan §5.1c makes explicit, reviewable migrations the only path schema takes to a database. Leaving the
default on until Phase 5 would mean Phase 5's migration baseline is generated from a schema no one
reviewed. From Phase 6 onward, a schema change is not live until a migration is generated and run.

*Confirmed in Phase 2. Full detail: DEV-17.*

## 5. Current position

**Phase 1 — Workspace, repository and baseline: complete.** Repository initialized on `main`, baseline
config and documentation in place, consistency gate executed and recorded above.

**Phase 2 — Scaffold the Next.js + Payload application: built; Gate 1 partially verified.**

Next 16.3.2 with Payload 3.88.0 embedded in one deployable. 706 packages from 16 direct dependencies,
no peer-dependency warnings. TypeScript strict, ESLint flat config at `--max-warnings 0`, Prettier,
Tailwind v4, and the two-route-group structure above.

| Gate 1 criterion | Status |
|---|---|
| 1. Frontend loads | **pass** — `/` returns 200, renders as an RSC with Tailwind applied |
| 2. Payload admin loads | **blocked** — needs a Postgres connection string. See **D-09** |
| 3. Build passes | **pass** — `pnpm build`, 4 routes, `/admin` and `/api/*` correctly dynamic |
| 4. Typecheck passes | **pass** — `tsc --noEmit`, strict |
| 5. Lint passes | **pass** — `eslint --max-warnings 0` |
| 6. Commit captures a known-good baseline | **pass** — branch `phase-2-scaffold-next-payload` |

**Next: supply `DATABASE_URL` from a Neon development branch, confirm `/admin` and `/api/users` return
200, then Phase 3 — design system and UI foundation.** Phase 3 owes the token layer (**G-12**, **G-14**),
the type scale, the core primitives, and the global shell.

Phase 3 needs no third-party account.
