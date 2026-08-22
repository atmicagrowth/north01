# NORTH / 01 — Master Implementation Plan for Claude

> **Purpose:** This document is the master implementation specification for Claude to build NORTH / 01 from an empty repository to a polished, testable, deployable application. It coordinates the six canonical project artifacts so that architecture, features, UX flow, and visual direction remain synchronized.
>
> **Execution rule:** Treat this document as the source of truth for implementation order, architecture, behavior, quality gates, and edge cases. Do not skip verification gates to move ahead faster.
>
> **Primary objective:** Build a premium editorial ecommerce storefront that is visually distinctive, easy to navigate, technically sound, mobile-first in behavior, and architected so the same codebase can later become a reusable foundation for real client ecommerce projects.

> **Business model constraint — ONLINE-ONLY DTC APPAREL**
>
> NORTH / 01 is an online-only direct-to-consumer apparel brand. There is no physical retail location and no in-store purchasing workflow. All product discovery, customer service, checkout, payment, fulfillment, delivery, returns, and account activity are designed for remote online customers.
>
> **Explicitly out of scope:** physical store pages, store locator, store hours, POS, in-store checkout, buy-online-pickup-in-store, curbside pickup, store inventory, retail staff checkout workflows, in-store returns, and physical-location appointment flows.
>
> **Fulfillment model:** inventory represents centralized online fulfillment stock. Orders are paid online, fulfilled remotely, shipped to the customer, tracked, and returned through an online-first process.


---

> **Canonical document set — all six files must agree**
>
> This plan is the master execution source of truth. Before coding, Claude must read all six project artifacts:
>
> 1. `NORTH01_Visual_Guide_OnlineOnly.md` — authoritative written visual system.
> 2. `NORTH01_Visual_Reference_OnlineOnly.png` — visual direction reference.
> 3. `01_NORTH01_Tech_Stack_Current_OnlineOnly.md` — canonical technology/service stack and ownership.
> 4. `02_NORTH01_Features_and_Tech_Implementation_Current_OnlineOnly.md` — feature inventory and exact technology mapping.
> 5. `03_NORTH01_Website_Structure_and_User_Flow_Current_OnlineOnly.md` — user-facing information architecture and flows.
> 6. `NORTH01_Claude_Implementation_Plan_Current_OnlineOnly.md` — this execution plan, including order, edge cases, verification, and review gates.
>
> **Precedence when documents overlap**
>
> 1. This implementation plan controls implementation order, architecture, safety, data ownership, and acceptance criteria.
> 2. The visual guide controls visual appearance.
> 3. The tech-stack file controls approved technologies/services.
> 4. The feature matrix controls feature scope and feature-to-technology mapping.
> 5. The website-structure file controls the user-facing navigation and flow.
>
> If two documents appear to conflict, do not silently choose one. Use the precedence above, then resolve the inconsistency in the implementation plan and the affected reference document before continuing.
>
> **No feature should exist only in one artifact.** A user-facing feature must be represented in the feature matrix, have a route or interaction in the website structure when applicable, have technology ownership in the tech stack, and have implementation/verification coverage in this plan.


# REQUIRED CONTEXT — READ BEFORE DOING ANYTHING

## REQUIRED BUSINESS-MODEL CHECK — ONLINE-ONLY DTC

Before implementing any phase, verify that the work is compatible with the online-only constraint. If a requirement can be interpreted as physical retail, resolve it toward remote ecommerce fulfillment or mark it out of scope. Never add physical-store concepts merely because they are common in ecommerce templates.

For every commerce flow, verify: customer pays online, order is stored server-side, fulfillment is remote, shipping/delivery is explicit, tracking is online, and returns/support are online-first.

For every inventory flow, verify: stock is centralized online fulfillment inventory; there is no store-level inventory or pickup reservation.


These rules apply during every phase.

## A.1 — Before coding

1. Read the relevant phase.
2. Inspect the repository.
3. Inspect existing architecture.
4. Check package versions before introducing dependencies.
5. Determine whether the requested behavior already exists.
6. Avoid duplicate abstractions.

## A.2 — During coding

1. Make small coherent changes.
2. Prefer typed interfaces.
3. Keep server-only code server-only.
4. Use the existing design system rather than bypassing it.
5. Do not introduce a new library when an existing dependency already solves the problem.
6. Do not change unrelated features.
7. Preserve working behavior.

## A.3 — After coding

Run the narrowest relevant checks first:

```text
Typecheck
↓
Lint
↓
Unit/component tests
↓
Targeted E2E
↓
Full build
```

Do not wait until the end of the entire project to discover type errors.

## A.4 — When an instruction is ambiguous

Prefer:

1. The architecture in this document.
2. Existing project conventions.
3. Official documentation for the installed package version.
4. The simplest implementation that preserves future extensibility.

Do not invent a new external service to resolve a small implementation ambiguity.

## A.5 — When a third-party service is unavailable

Core commerce must continue whenever the unavailable service is non-critical.

Examples:

- Sentry unavailable → application still works.
- PostHog unavailable → purchase still works.
- GA4 unavailable → purchase still works.
- Resend unavailable → order persists, email is retried.
- Algolia unavailable → display a controlled search-unavailable state; catalog remains usable through curated category navigation.
- Cloudinary image unavailable → use placeholder/fallback.

Stripe and Postgres are business-critical integrations and must fail safely rather than silently.

---

# MASTER EXECUTION DIRECTIVE — READ BEFORE CODING

Use this only after placing this document in the repository as `NORTH01_Claude_Implementation_Plan.md`.

```text
You are the primary implementation engineer for NORTH / 01.

Read `NORTH01_Claude_Implementation_Plan.md` completely before modifying the project. Also read the repository's README.md and any existing docs before coding. Before writing or modifying any UI, read `NORTH01_Visual_Guide_OnlineOnly.md` and inspect `NORTH01_Visual_Reference_OnlineOnly.png`. Treat those visual references as mandatory design context for the entire implementation.

Your job is to implement the project in the exact architectural order described in the implementation plan. Do not treat the feature list as a checklist that can be implemented in arbitrary order. Each phase has dependencies and verification gates.

Core principles:
- Use the documented technology stack unless a documented compatibility issue requires a change.
- Check official documentation for exact package/API compatibility before installing or changing core dependencies.
- Never expose secrets.
- Never trust client-provided prices, inventory, order totals, permissions, or payment state.
- PostgreSQL/Payload is the application data source of truth.
- Stripe is the payment-state source of truth.
- Algolia is a derived search index.
- Cloudinary is the media layer.
- Analytics and monitoring must never block commerce.
- Preserve a simple user experience even when the backend is sophisticated.
- Avoid unnecessary dependencies.
- Never create fake UI for unsupported functionality.

Execution process:
1. Inspect the repository and environment.
2. Determine the highest completed phase.
3. Read that phase's acceptance criteria.
4. Implement only the next logical phase unless the plan explicitly requires a dependency first.
5. Run all relevant verification commands after the change.
6. If the change affects UI, perform a visual review against `NORTH01_Visual_Guide_OnlineOnly.md` and `NORTH01_Visual_Reference_OnlineOnly.png`.
7. Fix failures before moving on.
8. Update documentation.
9. Commit only when the phase reaches its acceptance gate.
10. Continue through the plan without asking for unnecessary confirmation.

When implementing a commerce feature, explicitly test:
- happy path
- missing data
- invalid input
- stale data
- deleted entities
- unavailable inventory
- authentication/authorization failure
- external service failure
- duplicate requests
- repeated browser refresh
- mobile behavior

When implementing third-party integrations:
- build a small integration boundary
- keep provider-specific code isolated
- validate inputs/outputs
- make retry/idempotency behavior explicit
- provide graceful failure behavior
- never couple UI components directly to provider SDK details when a service layer is appropriate

When finishing the entire build, perform Review Pass 1, then Review Pass 2, then Review Pass 3. Do not merely write review reports. Correct the issues found and rerun relevant tests.

The final output should be a clean, production-quality, deployable NORTH / 01 ecommerce demo with:
- premium editorial design
- simple navigation
- real product/catalog data
- real CMS editing
- working cart
- working Stripe test checkout
- durable order records
- customer accounts
- wishlist
- search/filtering
- Shop the Look
- collections/edits/lookbook
- branded transactional email
- analytics/monitoring
- robust error/empty/loading states
- responsive mobile experience
- tests
- deployment documentation

Do not stop at a visually complete frontend. The project is only complete when the end-to-end data, commerce, CMS, security, testing, and deployment flows are verified.
```

# REQUIRED VISUAL REFERENCE — USE AS THE VISUAL SOURCE OF TRUTH

Before doing any implementation work, Claude must read and internalize the following visual reference guide in full:

- `NORTH01_Visual_Guide_OnlineOnly.md` — the authoritative written visual specification for NORTH / 01, covering visual character, color, typography, layout, spacing, component styling, imagery direction, page composition, responsive visual rules, and visual guardrails.
- `NORTH01_Visual_Reference_OnlineOnly.png` — the primary visual reference image for the approved Luxury Editorial direction.

These files are mandatory project context, not optional inspiration. The written visual guide is the authoritative source for visual decisions. The image is supplementary and communicates the intended polish, composition, hierarchy, contrast, and overall aesthetic.

## Visual reference rules

1. Treat `NORTH01_Visual_Guide_OnlineOnly.md` as the authoritative written visual specification.
2. Inspect `NORTH01_Visual_Reference_OnlineOnly.png` when establishing or reviewing the overall visual direction.
3. When this implementation plan specifies functionality but not presentation, use the visual guide to determine the presentation.
4. When an implementation choice conflicts with the visual guide, preserve the required behavior but change the presentation to conform to the guide.
5. Do not introduce visual patterns that contradict the guide, including generic SaaS card systems, excessive rounded containers, pill-heavy controls, glassmorphism, gratuitous gradients, noisy decoration, or overly animated UI.
6. Every new page, component, interaction state, form, drawer, modal, loading state, empty state, error state, and responsive layout must be reviewed against the visual guide before its phase is considered complete.
7. Apply the visual language consistently across desktop, tablet, and mobile.
8. If the guide leaves a decision unspecified, prefer the existing NORTH / 01 visual language and the simplest consistent solution rather than inventing a new style.
9. Do not accept component-library defaults merely because they are available; restyle them to match the visual system.
10. When the written guide and reference image differ, prioritize the written guide and use the image as directional context.

## Visual review prompt

> Before implementing or reviewing any visual work, read `NORTH01_Visual_Guide_OnlineOnly.md` and inspect `NORTH01_Visual_Reference_OnlineOnly.png`. Treat the written guide as the source of truth and the image as the primary visual reference. Evaluate every UI change against the specified palette, typography, spacing, grid, imagery treatment, component styling, responsive behavior, and visual guardrails. Do not settle for technically correct but generic UI. Restyle library defaults where necessary, and reproduce the visual principles rather than copying the reference literally.


## Canonical naming

Use these labels consistently across UI, CMS slugs, route names, docs, and code unless a technical naming convention requires casing changes:

- Product.
- Category.
- Collection.
- Edit.
- Lookbook.
- Journal.
- Campaign.
- Cart.
- Order.
- Wishlist.
- Customer.
- Review.
- Promotion.
- Media.
- Homepage section.

Primary navigation labels:
**NEW · SHOP · COLLECTIONS · EDIT · LOOKBOOK · ABOUT**

Do not add another top-level navigation category merely because a backend collection exists.

# REQUIRED REFERENCE DOCUMENTATION — CONSULT BEFORE IMPLEMENTATION

Claude should consult official documentation at implementation time because package APIs and hosted-service plans evolve.

Primary references:

- Next.js: https://nextjs.org/docs
- Payload installation: https://payloadcms.com/docs/getting-started/installation
- Payload Postgres: https://payloadcms.com/docs/database/postgres
- Payload deployment: https://payloadcms.com/docs/production/deployment
- Stripe Checkout: https://docs.stripe.com/payments/checkout
- Stripe webhooks: https://docs.stripe.com/webhooks
- Stripe Tax: https://docs.stripe.com/payments/checkout/taxes
- Vercel: https://vercel.com/docs
- Neon: https://neon.tech/docs
- Cloudinary: https://cloudinary.com/documentation
- Algolia: https://www.algolia.com/doc/
- Resend: https://resend.com/docs
- React Email: https://react.email/docs
- PostHog: https://posthog.com/docs
- Sentry: https://docs.sentry.io/
- Playwright: https://playwright.dev/docs/intro
- Vitest: https://vitest.dev/guide/
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- Cloudflare Turnstile: https://developers.cloudflare.com/turnstile/

---

---

---

> **PRE-IMPLEMENTATION RULE:** The material above is mandatory project context. Claude must read and internalize it before inspecting the implementation phases or making any code change. This includes the written visual guide and the primary visual reference image. The numbered phases begin only after this context section.

---

## CROSS-DOCUMENT CONSISTENCY GATE — BEFORE PHASE 1

Before starting Phase 1, Claude must perform a consistency audit across the six artifacts.

Check:
- Every primary feature in the feature matrix exists in the website structure where user-facing.
- Every technology named in the feature matrix exists in the canonical stack.
- Every technology named in this plan exists in the canonical stack unless explicitly listed as an implementation-detail dependency of an approved stack technology.
- Every visual rule referenced by implementation phases exists in the visual guide.
- Navigation names match exactly across the structure, feature, and implementation documents.
- Commerce source-of-truth rules are consistent across stack, features, and plan.
- No phase introduces a service that the stack document does not approve.
- No feature requires an external paid provider that the canonical stack does not define.
- No public route or major user journey exists in the structure without implementation and testing coverage.
- No implementation phase invents a new top-level user-facing feature without updating all centralized documents.

The result should be recorded in the repository's architecture documentation. Do not begin Phase 1 until this audit is clean.

# 0. NON-NEGOTIABLE PROJECT PRINCIPLES

### 0.1 Product principles

1. The site must feel like a premium fashion brand first and an ecommerce application second.
2. The website must remain easy to understand even though it contains advanced functionality.
3. Commerce, editorial content, and discovery must reinforce one another rather than become disconnected sections.
4. Every feature must have an intentional empty state, loading state, success state, error state, and mobile behavior where applicable.
5. Business-critical state must never be trusted from the browser.
6. The database is the source of truth for products, variants, inventory, customer/order records, promotions, and CMS content.
7. Stripe is the source of truth for payment state; do not infer payment success from the browser redirect alone.
8. Cloudinary is the media delivery layer; product/content metadata remains in Payload/Postgres.
9. Algolia is a search index, never the authoritative product database.
10. Analytics systems must never be required for the storefront to function.
11. Optional third-party services must degrade gracefully when unavailable.
12. No paid service should be required for local development.
13. The implementation must avoid unnecessary dependencies and duplicate responsibilities.
14. The agent must prefer small, composable modules and typed domain functions over giant components or generic "utils" files.
15. Never expose private API keys, secrets, database credentials, Stripe secret keys, webhook signing secrets, or admin credentials to client-side code.
16. Never store raw payment card details.
17. Do not implement fake functionality that looks real but silently does nothing. For demo-only behaviors, clearly isolate them behind explicit mock/test adapters.
18. The public website should remain accessible if search analytics, PostHog, Sentry, or another non-core service fails.
19. Accessibility is part of implementation, not a final cosmetic pass.
20. Performance is part of the design; do not solve performance problems by removing important UX.

### 0.2 Visual principles

The complete visual specification is defined in `NORTH01_Visual_Guide_OnlineOnly.md`. Claude must use that document and `NORTH01_Visual_Reference_OnlineOnly.png` whenever making visual decisions. The condensed rules below are a quick reminder, not a replacement for reading the full guide.

- Near-black / charcoal foundation.
- Warm white / bone typography.
- Editorial serif display type paired with a modern sans-serif UI typeface.
- Large fashion photography.
- Thin borders and restrained dividers.
- Minimal rounded containers.
- Almost no gratuitous shadows or gradients.
- Subtle cinematic motion.
- Product cards are visually simple.
- Strong whitespace and visual hierarchy.
- Avoid generic SaaS aesthetics, excessive glassmorphism, pill-heavy interfaces, random blobs, and over-animated UI.

### 0.3 Navigation principles

The user must always have an obvious path to:

- New products.
- All products.
- Collections.
- Curated edits.
- Search.
- Cart.
- Account.
- Brand/editorial content.

Do not create deep navigation merely because the data model can support it. The visible navigation should remain compact.

---

# 1. TARGET ARCHITECTURE

## 1.1 Technology stack

The complete approved stack is defined in `01_NORTH01_Tech_Stack_Current_OnlineOnly.md`.

The implementation plan must not maintain a second competing stack list. The canonical architecture is:

```text
Next.js 16.x + React + TypeScript
        ↓
Payload CMS + PostgreSQL/Neon
        ↓
Stripe + Stripe Tax
        ↓
Internal shipping abstraction
        ↓
Cloudinary + Algolia + Resend
        ↓
PostHog + GA4 + Sentry + Vercel Speed Insights
        ↓
Vercel + GitHub + GitHub Actions
        ↓
Vitest + React Testing Library + Playwright + Axe
```

Use the exact packages and version-selection rules in the stack document and consult official documentation before installing.


## 1.2 Version strategy

Do not blindly copy old version numbers from this document into package.json. Before installation:

1. Read the current official Next.js compatibility requirements.
2. Read the current Payload installation/compatibility requirements.
3. Choose a combination that is explicitly supported together.
4. Pin versions through the lockfile after a successful install.
5. Do not independently upgrade Next.js, React, Payload, or their critical peer dependencies without re-running the compatibility and verification gates.
6. Prefer the newest stable patch release within the supported major/minor combination unless a known regression makes an earlier patch preferable.
7. Record the resolved versions in `docs/STACK_VERSIONS.md`.

**Current verification note:** Payload's official installation documentation currently lists Node.js 20.9+ and supports modern Next.js 16 releases, including 16.2.6+, and Payload's release notes show full Next.js 16 support. Verify again at implementation time because these are moving dependencies.

## 1.3 Architectural boundaries

Use these boundaries consistently:

- `app/` = routes, layouts, pages, route handlers.
- `components/` = reusable presentation and interaction components.
- `features/` = domain-oriented UI/application modules where complexity warrants isolation.
- `lib/` = integrations, infrastructure, helpers, server-only modules.
- `payload/` or `src/payload/` = CMS config, collections, globals, access rules, hooks.
- `emails/` = React Email templates.
- `tests/` = unit/component/e2e helpers and suites.
- `scripts/` = one-off local administration/seeding/reindexing tasks.
- `docs/` = architecture, environment setup, decisions, runbooks.

Do not create a root-level `utils.ts` that becomes a dumping ground.

---

# 2. DOMAIN MODEL BEFORE UI

Before building polished screens, establish the business model.

## 2.1 Product hierarchy

```text
Product
└── Product Variant(s)
    ├── SKU
    ├── Color
    ├── Size
    ├── Price
    ├── Compare-at price
    ├── Inventory quantity
    ├── Availability state
    └── Media relationships
```

A product is the merchandising entity. A variant is the purchasable unit.

Do not store a single global inventory number when variants have independent size/color stock.

## 2.2 Required conceptual entities

- User / customer.
- Product.
- Product variant.
- Category.
- Collection.
- Edit.
- Campaign.
- Lookbook.
- Lookbook item/hotspot.
- Journal article.
- Review.
- Cart.
- Cart item.
- Wishlist item.
- Order.
- Order item.
- Promotion.
- Discount code.
- Shipping method.
- Media.
- Homepage section.
- Site settings.
- FAQ entry.
- Newsletter subscriber.
- Integration event / sync status.
- Stripe webhook event / idempotency record.
- Search synchronization record where needed.
- Email delivery event / idempotency record where needed.

## 2.3 Data ownership rules

- Payload/Postgres owns product metadata.
- Payload/Postgres owns inventory quantities.
- Payload/Postgres owns customer account data.
- Payload/Postgres owns order records created by the application.
- Stripe owns payment processing state, payment methods, charges, refunds, and payment events.
- Algolia owns only its search index.
- Cloudinary owns media assets and transformations.
- Resend owns delivery of email; application records relevant message purpose/status when needed.
- PostHog/GA4 own analytics streams and are not required for business state.

---

# 1. PHASE 1 — WORKSPACE, REPOSITORY, AND BASELINE

## 1.1a — Verify local prerequisites

Claude must inspect the environment before changing anything.

Check:

- Node.js installed and version.
- pnpm installed and version.
- Git installed.
- Available disk space.
- Current working directory.
- Whether a repository already exists.
- Whether a package.json already exists.
- Whether there are existing source files that must be preserved.

### Edge cases

- Node version too old: stop and instruct the user to upgrade; do not force a legacy dependency combination.
- pnpm missing: install or enable via Corepack if appropriate.
- Existing project: do not overwrite it; inspect and adapt.
- Git repo already initialized: use it.
- Existing remote repository: preserve remote configuration.
- Dirty Git working tree: report before destructive operations.

### Acceptance criteria

- Environment requirements recorded.
- No project files overwritten accidentally.
- Initial Git state known.

### Claude prompt

> Inspect the current development environment and repository without making destructive changes. Verify Node.js, pnpm, Git, repository state, existing package.json files, and any existing project files. Determine whether this is an empty project or an existing application. Do not install or modify anything until the environment is understood. Report the findings and propose the safest initialization path. If the project is empty, proceed only with non-destructive initialization steps and preserve a clean Git history.

## 1.1b — Initialize Git workflow

Create:

- `.gitignore`.
- `.editorconfig`.
- `.gitattributes` if useful.
- `README.md`.
- `docs/STACK_VERSIONS.md`.
- `docs/ARCHITECTURE.md`.
- `docs/DEVELOPMENT.md`.

Recommended initial branches:

- `main` = deployable.
- feature branches for substantial changes.

### Edge cases

- Never commit `.env` or `.env.local`.
- Never commit API keys.
- Never commit `node_modules`.
- Never commit local database dumps containing personal/customer data.
- Never commit generated build output.

### Acceptance criteria

`git status` is clean after the initial commit.

---

# 2. PHASE 2 — SCAFFOLD THE NEXT.JS + PAYLOAD APPLICATION

## 2.1a — Choose compatible versions

Claude must consult the official Next.js and Payload docs before installation. The current official Payload installation docs require Node.js 20.9+ and support current Next.js 16 ranges; verify exact package compatibility at execution time.

### Acceptance criteria

- Compatible versions chosen.
- Version matrix recorded.
- No unresolved peer-dependency warnings.

## 2.1b — Create the app

Install the minimum packages required for the foundation, then add feature packages only when their phase begins. At minimum, the foundation should include the framework/runtime dependencies plus the styling, linting, formatting, and Payload integration packages required by the chosen compatible versions. Do not install the entire final dependency list on day one merely because the technology stack document names those tools.

The Payload integration must include the supported Next.js package and the supported Postgres adapter. Add the Lexical rich-text package only if rich-text fields are used. Add `sharp` only if the chosen Payload media configuration needs local image manipulation. Do not add GraphQL unless the project actually requires it.

Use the Payload-supported pattern for embedding Payload into Next.js rather than creating an unnecessary separate backend application.

Required outcomes:

- Next.js app starts.
- Payload admin route works.
- Payload API works.
- Next.js frontend route works.
- The Payload Next.js plugin is correctly configured.
- ESM configuration is correct where required.

Payload currently installs directly into a Next.js app and uses a Postgres adapter backed by Drizzle; follow the official structure rather than inventing a custom integration.

## 2.1c — Baseline lint/type/build

Before design work:

- `pnpm lint` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm build` succeeds.
- App launches locally.

### Edge cases

- Build-only imports of server-only modules accidentally pulled into client bundles.
- Browser globals used in server components.
- Environment variables accessed without availability.
- Payload admin route colliding with storefront route groups.
- Incorrect Next.js config wrapping.

### Gate 1

Do not continue until:

1. Frontend loads.
2. Payload admin loads.
3. Build passes.
4. Typecheck passes.
5. Lint passes.
6. Git commit captures the known-good baseline.

### Claude prompt

> Scaffold the project using the officially supported Next.js + Payload integration. Choose compatible current stable versions by checking the official documentation first. Configure TypeScript, pnpm scripts, ESLint, Prettier, Tailwind, the Payload Next.js plugin, and a clean route structure. Do not build storefront features yet. Verify frontend rendering, Payload Admin, Payload API, `lint`, `typecheck`, and production `build`. Fix all dependency, peer-dependency, route, server/client boundary, and configuration errors before proceeding. Commit only a known-good baseline.

---

# 3. PHASE 3 — DESIGN SYSTEM AND UI FOUNDATION

## 3.1a — Define design tokens

Create central tokens for:

- Backgrounds.
- Surfaces.
- Foreground colors.
- Muted text.
- Borders.
- Accent states.
- Typography scales.
- Spacing.
- Radius.
- Shadows, used sparingly.
- Motion durations.
- Breakpoints.

Do not scatter raw colors throughout components.

## 3.1b — Typography

Select:

- Display serif.
- UI sans-serif.

Requirements:

- Verify licensing.
- Self-host where practical.
- Configure `next/font` if compatible with chosen fonts.
- Avoid FOIT/FOUT where possible.
- Provide correct font-weight ranges.

## 3.1c — Core primitives

Build or configure:

- Button.
- Link.
- Icon button.
- Input.
- Label.
- Checkbox.
- Radio.
- Select.
- Dialog.
- Drawer.
- Dropdown.
- Tabs.
- Accordion.
- Toast.
- Skeleton.
- Badge.
- Separator.
- Breadcrumb.

Do not customize every Radix primitive from scratch if a good shadcn abstraction exists, but do customize all visible styling to match NORTH / 01.

## 3.1d — Global shell components

Build:

- Header.
- Desktop nav.
- Mobile nav.
- Footer.
- Page container.
- Section wrapper.
- Page title.
- Editorial block wrapper.

### Accessibility requirements

- Keyboard navigation.
- Visible focus indicators.
- Escape to close dialogs/drawers.
- Focus trap where required.
- Focus restoration after overlays close.
- `aria-expanded` on expandable controls.
- `aria-label` for icon-only buttons.
- Correct heading structure.

### Acceptance criteria

Create a Storybook or equivalent visual test page showing every primitive in:

- Default.
- Hover.
- Focus.
- Active.
- Disabled.
- Error.
- Loading.
- Dark/light context where relevant.
- Mobile width.

### Claude prompt

> Build the NORTH / 01 design system foundation without implementing ecommerce business logic. Establish centralized color, typography, spacing, border, radius, and motion tokens. Configure the chosen fonts correctly. Create accessible reusable UI primitives using shadcn/Radix where appropriate. Build the global header, responsive navigation, footer, page containers, and editorial wrappers. Add Storybook stories for all interactive primitives and verify keyboard, focus, Escape, and mobile behaviors. Do not create ad-hoc styling systems inside individual pages.

---

# 4. PHASE 4 — ENVIRONMENT CONFIGURATION AND SECRET MANAGEMENT

## 4.1a — Define environment schema

Create a typed environment configuration module validated with Zod.

Separate:

### Public/browser-safe

Examples:

- Analytics public IDs.
- Algolia search-only key.
- Cloudinary delivery identifiers where safe.
- Turnstile site key.

### Server-only

Examples:

- `DATABASE_URL`.
- `PAYLOAD_SECRET`.
- Stripe secret key.
- Stripe webhook secret.
- Resend API key.
- Cloudinary API secret.
- Algolia admin key.
- Sentry auth token.
- PostHog server key where applicable.
- Turnstile secret key.

## 4.1b — Environment validation behavior

If a required server secret is missing:

- Fail clearly at startup/build time when practical.
- Do not silently substitute fake values.
- Do not expose the missing variable name in a public API response.

For optional integrations:

- Log a clear server-side warning.
- Degrade the feature gracefully.

## 4.1c — Environments

Maintain:

- Local.
- Preview.
- Production.

Never use production Stripe credentials in local or preview.

Never use production customer data in development.

### Claude prompt

> Implement a typed environment-variable system. Separate browser-safe variables from server-only secrets. Validate required values with Zod and provide clear startup/build errors for missing required secrets. Treat analytics, Sentry, search, and similar integrations as optional unless the feature explicitly requires them. Add `.env.example` containing names only, never secrets. Document where each environment variable comes from and which environments require it.

---

# 5. PHASE 5 — NEON POSTGRES + PAYLOAD CMS FOUNDATION

## 5.1a — Provision development database

Create a Neon Postgres database for development.

Requirements:

- Strong password/connection string.
- TLS enabled.
- Separate development and production databases.
- No production data in development.

## 5.1b — Connect Payload to Postgres

Configure Payload's Postgres adapter using the supported package and environment variable connection string.

Payload's current Postgres adapter uses Drizzle and node-postgres; use the supported adapter rather than directly writing a second ORM layer for Payload-owned tables.

## 5.1c — Database migration discipline

Establish:

- Local schema changes.
- Migration generation.
- Migration commit policy.
- Production migration procedure.
- Rollback/restore procedure.

Never manually alter production tables as the normal workflow.

## 5.1d — Database safety

Use Payload/Drizzle's recommended development push workflow for the sandbox database, then generate committed migrations for non-development environments. Do not manually edit the production schema as a normal deployment step.

For Vercel production, ensure the deployment/build process can execute pending Payload migrations against the production database in a controlled way before the application depends on the new schema. Do not allow two concurrent deployments to race migrations; use the deployment platform's deployment controls and migration strategy deliberately.

Configure:

- Appropriate indexes.
- Unique constraints.
- Foreign key relationships where appropriate.
- Nullable vs required fields deliberately.
- Timestamps.
- Soft-delete/archive strategy where necessary.

### Edge cases

- Connection string special characters require correct encoding.
- Database sleeps / cold starts.
- Local connection differs from hosted connection.
- Migration drift.
- Duplicate unique records.
- Null relationships.
- Orphaned records.

Payload's docs explicitly call out password/URL encoding as a possible connection issue; diagnose database connectivity independently before assuming a Payload bug.

### Acceptance criteria

- Payload admin works against Postgres.
- Create/read/update/delete a simple test collection.
- Database migrations are generated/applied successfully.
- App survives database restart/reconnect.

### Claude prompt

> Connect Payload to a dedicated Neon Postgres development database using the official Payload Postgres adapter. Establish migration discipline, indexes, relationships, uniqueness, timestamps, and environment separation. Do not yet build all ecommerce collections. First create one small test collection and prove create/read/update/delete through Payload Admin and the application. Verify that migrations are reproducible and that database connection failures surface clearly without exposing secrets.

---

# 6. PHASE 6 — PAYLOAD DATA MODEL

## 6.1a — Site configuration

Create globals or equivalent configuration for:

- Site name.
- Logo.
- Header navigation.
- Footer navigation.
- Social links.
- Contact information.
- Shipping threshold.
- Default currency.
- Default locale.
- SEO defaults.
- Analytics configuration where appropriate.
- Maintenance/banner messaging.

## 6.1b — Product collection

Fields:

- Name.
- Slug.
- Short description.
- Full description.
- Status.
- Featured flag.
- New flag.
- Best seller flag.
- Limited edition flag.
- Category relationships.
- Collection relationships.
- Tags.
- Gallery.
- Product video optional.
- Materials.
- Care.
- Fit.
- Size guide reference.
- SEO.
- Editorial copy.
- Sort order if curated.

## 6.1c — Product variants

Each variant:

- SKU.
- Color name.
- Color code/swatches.
- Size.
- Price.
- Compare-at price.
- Inventory quantity.
- Active/inactive.
- Variant-specific image.
- Optional weight/dimensions.

### Critical rule

Do not allow two active variants of the same product to share the same SKU.

## 6.1d — Categories

Examples:

- Clothing.
- Tops.
- Shirts.
- Hoodies.
- Sweatshirts.
- Jackets.
- Pants.
- Shorts.
- Accessories.

Avoid creating categories that are not actually used in navigation or filters.

## 6.1e — Collections

Fields:

- Title.
- Slug.
- Description.
- Hero media.
- Intro media.
- Product relationships.
- Editorial blocks.
- SEO.
- Publish state.

## 6.1f — Edits

Curated shopping pages.

Fields:

- Title.
- Slug.
- Intro.
- Hero.
- Editorial blocks.
- Product groups.
- Optional lookbook references.
- SEO.

## 6.1g — Campaigns

Fields:

- Campaign title.
- Season.
- Hero media.
- Story.
- Products.
- Collection.
- CTA.
- Publish status.

## 6.1h — Lookbooks

Lookbook:

- Title.
- Season.
- Cover image.
- Chapters.

Chapter:

- Title.
- Hero image.
- Editorial text.
- Gallery.
- Product hotspots.

## 6.1i — Journal

- Title.
- Slug.
- Excerpt.
- Hero image.
- Body rich text.
- Related products.
- Category.
- Author.
- Publish date.
- SEO.

## 6.1j — Reviews

- Product.
- Customer reference if applicable.
- Display name.
- Rating.
- Title.
- Body.
- Photos.
- Verified purchase.
- Approved/hidden state.
- Created date.

Reviews must not become publicly visible before moderation if moderation is enabled.

## 6.1k — Commerce entities

Define:

### Cart
- Session token.
- Customer reference optional.
- Currency.
- Status.
- Expiration.

### Cart item
- Cart.
- Product.
- Variant.
- Quantity.
- Snapshot of presentation data only if needed.

### Order
- Order number.
- Customer.
- Email.
- Currency.
- Items.
- Subtotal.
- Discount.
- Shipping.
- Tax.
- Total.
- Status.
- Stripe checkout session ID.
- Stripe payment intent ID where available.
- Shipping address snapshot.
- Billing address snapshot.
- Fulfillment/tracking fields.
- Created/updated timestamps.

### Order item
Store stable snapshot data for historical accuracy:

- Product ID.
- Variant ID.
- SKU snapshot.
- Product name snapshot.
- Variant label snapshot.
- Unit price snapshot.
- Quantity.
- Total.

Do not reconstruct historical orders entirely from current product records.

## 6.1l — Promotions

Support:

- Code.
- Type.
- Value.
- Start date.
- End date.
- Minimum subtotal.
- Eligible products/collections.
- Usage limit.
- Per-customer limit.
- Active state.

Server-side validation is mandatory.

## 6.1m — Wishlist

- Customer.
- Product.
- Optional variant preference.
- Created date.

Enforce uniqueness so the same product is not saved twice by the same user.

## 6.1n — Newsletter subscribers

- Email.
- Consent timestamp.
- Source.
- Status.

Do not store more data than necessary.

## 6.1o — FAQ / content blocks

Use structured content rather than hard-coded text when client editing is a requirement.

### Claude prompt

> Implement the full Payload domain model described in Phase 6. Design relationships, validation, access control, indexes, unique constraints, publishing status, and historical order snapshots carefully. Generate and test migrations. Seed only representative demo content. Ensure the model can support variants, collections, edits, lookbooks, shop-the-look hotspots, editorial content, carts, orders, reviews, wishlists, and promotions without duplicating business data. Before proceeding, inspect the database schema and explain any model compromises or denormalization choices.

---

# 7. PHASE 7 — ACCESS CONTROL AND AUTHENTICATION

## 7.1a — Roles

At minimum:

- Customer.
- Editor.
- Admin.

## 7.1b — Customer access rules

Customers may:

- Read their own profile.
- Read their own orders.
- Read/write their own wishlist.
- Read/write their own addresses.
- Manage their credentials.

Customers may NOT:

- Read another customer's order.
- Modify another customer's order.
- Read admin-only fields.
- Access Payload Admin.

## 7.1c — Editor access

Editors may manage content/product merchandising as appropriate but should not automatically receive:

- Financial administration.
- User credential access.
- Full system configuration.

## 7.1d — Admin access

Admin may manage everything required by the CMS.

## 7.1e — Authentication flows

Implement:

- Registration.
- Login.
- Logout.
- Email verification if enabled.
- Forgot password.
- Reset password.
- Session handling.
- Protected account routes.

### Edge cases

- Wrong password.
- Nonexistent email.
- Existing email during registration.
- Expired reset link.
- Reused reset link.
- Expired session.
- User logs out from another tab.
- Account is disabled.
- OAuth is not implemented; do not create fake buttons for providers that do not exist.

### Claude prompt

> Implement authentication and authorization with Payload Auth and strict access-control rules. Create Customer, Editor, and Admin role boundaries. Protect account and admin routes at both route and data-access levels. Implement registration/login/logout/password-reset flows with robust error handling. Ensure authenticated users can only read and modify their own customer-owned records. Add automated tests for cross-user access attempts and role escalation attempts.

---

# 8. PHASE 8 — MEDIA / CLOUDINARY

## 8.1a — Media architecture

Use Payload media records for metadata and Cloudinary for delivery/storage as the selected integration.

Store:

- Asset ID.
- Public identifier.
- Alt text.
- Caption.
- Focal point if used.
- Media role.
- Dimensions.
- Transformation metadata where useful.

## 8.1b — Upload rules

Validate:

- Allowed mime types.
- Maximum dimensions.
- Maximum file size.
- Reasonable image formats.

Do not accept arbitrary executable files.

## 8.1c — Responsive delivery

Use responsive variants/crops appropriate for:

- Desktop hero.
- Mobile hero.
- Product card.
- Product PDP gallery.
- Editorial image.
- Thumbnail.

## 8.1d — Missing media

If a media asset is missing or unavailable:

- Show a deliberate neutral placeholder.
- Preserve layout dimensions.
- Do not create broken-image layout shifts.

### Claude prompt

> Implement media handling using Payload metadata and Cloudinary delivery. Establish safe upload validation, alt text requirements, responsive image variants, focal points where appropriate, and fallback behavior for missing assets. Ensure images do not cause layout shift and are appropriately sized for their context. Never expose Cloudinary server secrets to the browser.

---

# 9. PHASE 9 — STOREFRONT SHELL

## 9.1a — Header

Desktop navigation:

- New.
- Shop.
- Collections.
- Edit.
- Lookbook.
- About.

Utility actions:

- Search.
- Wishlist.
- Account.
- Bag.

## 9.1b — Mega menu

Do not make it visually overwhelming.

Columns:

- Clothing.
- Accessories.
- Shop by.
- Featured collection / image.

## 9.1c — Mobile nav

Use a drawer with hierarchical expansion.

Requirements:

- No accidental navigation while expanding.
- Back button for nested groups.
- Close control.
- Escape.
- Focus management.
- Scroll containment.

## 9.1d — Cart drawer

Global cart drawer must work from every page.

### Acceptance criteria

A user can open/close search, mobile menu, and cart from any major route without navigation state conflicts.

### Claude prompt

> Implement the global NORTH / 01 storefront shell: header, desktop navigation, mega menu, responsive mobile navigation, utility actions, footer, search trigger, account/wishlist links, and cart drawer trigger. Use Payload site settings where content should be editable. Prioritize accessibility and predictable state management. Verify that opening one overlay closes conflicting overlays and restores focus correctly. Keep the visible navigation compact and understandable.

---

# 10. PHASE 10 — HOMEPAGE / EDITORIAL SYSTEM

## 10.1a — Homepage block system

Create reorderable, typed blocks such as:

- Hero.
- Promotional strip.
- Category tiles.
- Product rail/grid.
- Editorial split.
- Shop-the-look.
- Collection feature.
- Brand story.
- Social gallery.
- Newsletter.

## 10.1b — Hero behavior

Support:

- Desktop media.
- Mobile media.
- Optional video.
- Season label.
- Headline.
- Body.
- Primary CTA.
- Secondary CTA.

Edge cases:

- CTA omitted.
- Mobile image omitted: use safe fallback.
- Video unavailable: image fallback.
- Media still loading.
- Text too long for selected crop.

## 10.1c — Editorial block behavior

Keep editorial content connected to actual commerce.

Every commerce-driven editorial block should have an explicit CTA or linked product/collection path.

## 10.1d — Homepage performance

Do not load every below-the-fold image at maximum resolution immediately.

Use:

- Responsive sizes.
- Lazy loading.
- Proper priority only for the main hero/LCP image.
- Skeletons for asynchronous product data where needed.

### Claude prompt

> Build the NORTH / 01 homepage as a CMS-driven editorial commerce page. Implement typed reusable content blocks for hero, categories, product rails, editorial features, shop-the-look, limited editions, best sellers, brand story, social content, and newsletter. Ensure each block is responsive, accessible, performant, and connected to real Payload data. Do not hard-code production-like product content into React components. Validate empty/missing media and incomplete CMS blocks gracefully.

---

# 11. PHASE 11 — PRODUCT CATALOG AND DISCOVERY

## 11.1a — Shop page

Implement:

- Product count.
- Grid.
- Filters.
- Sort.
- Pagination or load-more.
- Empty state.

## 11.1b — Product card

States:

1. Normal.
2. Hover.
3. Loading.
4. New.
5. Sale.
6. Low stock.
7. Sold out.
8. Out-of-season/inactive.
9. Image unavailable.

## 11.1c — Product card interactions

- Click card/image → PDP.
- Click wishlist → prevent card navigation.
- Quick view → dialog.
- Quick add → variant selection if required.

### Critical edge case

If a product has multiple sizes/colors and no default purchasable variant, Quick Add must NOT guess an invalid variant. Open Quick View or require a valid variant selection.

## 11.1d — Filtering

Use Algolia as the query/facet engine after the catalog is seeded.

Use URL parameters through nuqs.

Example:

`/shop?category=hoodies&color=black&size=m&sort=newest`

### Edge cases

- Filter references deleted value.
- URL contains unknown category.
- Price range reversed.
- Duplicate filter values.
- Filter produces zero results.
- Search service unavailable.

Fallback policy:

- If Algolia is unavailable, render a graceful error state and provide a "Browse categories" fallback. Do not attempt an expensive full-catalog scan on every request.

## 11.1e — Sorting

Keep sort options intentionally limited.

### Claude prompt

> Implement the product catalog with real Payload-backed product data. Build reusable product cards with all defined states, desktop/mobile grids, URL-backed filters using nuqs, sorting, pagination/load-more, quick view, wishlist, and safe Quick Add behavior. Integrate Algolia for search/faceting only after the product schema is stable. Ensure malformed query parameters, unavailable variants, missing images, zero results, and search-service failures do not crash the page.

---

# 12. PHASE 12 — SEARCH / ALGOLIA

## 12.1a — Index design

Index searchable fields:

- Product name.
- Description/summary where useful.
- Category.
- Collection.
- Tags.
- Color.
- Size.
- Material.
- Fit.

Index filterable attributes:

- Category.
- Collection.
- Availability.
- Size.
- Color.
- Gender.
- Price.
- Tags.

Return only safe display data required by search result components.

## 12.1b — Synchronization

When product data changes:

- Update search index.
- Remove unpublished/deleted products from searchable results.
- Reindex on structural changes.

Do not make Algolia indexing the only place where a product change exists.

Recommended resilience:

- Record synchronization intent/status in application-side data where useful.
- Provide a server-only manual reindex script.
- Provide a way to rebuild the full index from Postgres/Payload.

## 12.1c — Search UI

Search overlay sections:

- Query input.
- Suggested categories.
- Suggested collections.
- Product suggestions.
- Recent searches.
- Popular searches.
- View all results.

## 12.1d — Search edge cases

- Empty query.
- 1-character query.
- Very long query.
- Special characters.
- Repeated query submission.
- Network timeout.
- No results.
- Deleted product still in index.
- Product unpublished after index update.
- Search API quota/error.

### Claude prompt

> Implement Algolia search as a derived index over Payload/Postgres data. Define searchable/filterable attributes carefully. Build an accessible search overlay with autocomplete, product suggestions, category/collection suggestions, recent searches, popular searches, and a full results page. Add a server-side full reindex utility and synchronization handling. Treat Algolia as non-authoritative. Gracefully handle no results, malformed queries, timeouts, and unavailable search service.

---

# 13. PHASE 13 — PRODUCT DETAIL PAGE

## 13.1a — Gallery

Implement:

- Desktop gallery.
- Mobile swipe gallery.
- Thumbnail navigation.
- Full-screen viewer.
- Zoom where appropriate.
- Optional video.
- Loading placeholder.

## 13.1b — Purchase information

Render:

- Product name.
- Price.
- Compare-at price.
- Rating.
- Color.
- Size.
- Size guide.
- Quantity.
- Add to Bag.
- Buy Now.
- Wishlist.
- Inventory messaging.

## 13.1c — Variant logic

Variant selection must be authoritative.

For every selected combination:

- Determine whether exact variant exists.
- Determine whether it is active.
- Determine quantity.
- Update displayed media if available.
- Update price if variant pricing differs.
- Disable impossible options where appropriate.

Example:

If Black / M exists but Cream / M does not:

- Black selectable.
- Cream M disabled.
- Do not permit submission of Cream / M.

## 13.1d — Add-to-cart rules

Server must revalidate:

- Product exists.
- Product is published.
- Variant exists.
- Variant active.
- Quantity is positive integer.
- Quantity does not exceed allowed bounds/inventory policy.
- Current price is authoritative.

Never trust a client-submitted price.

## 13.1e — Product details

Accordions:

- Description.
- Details.
- Size & Fit.
- Care.
- Shipping & Returns.

## 13.1f — Reviews

Display:

- Average rating.
- Review count.
- Distribution.
- Review entries.
- Verified indicator.
- Photo reviews where available.

If no reviews:

- Do not show an empty star histogram.
- Show a graceful "Be the first to review" state if review creation is enabled.

### Claude prompt

> Build the full product detail experience using the Payload product/variant model. Implement responsive galleries, variant-safe color/size selection, size guide, pricing, inventory messaging, wishlist, add-to-cart, buy-now, product information accordions, reviews, and recommendations. Revalidate all purchase-critical information on the server. Test impossible variant combinations, missing media, sold-out states, low inventory, price changes, deleted products, direct URLs to unavailable products, and mobile interaction behavior.

---

# 14. PHASE 14 — CART SYSTEM

## 14.1a — Cart identity

Support:

### Guest user
Use a cryptographically strong server-issued cart token stored in a secure, HTTP-only cookie where practical.

### Authenticated user
Associate cart with customer ID.

## 14.1b — Cart merge

When a guest logs in:

1. Load guest cart.
2. Load customer cart.
3. Merge line items by variant.
4. Revalidate availability and quantity.
5. Resolve duplicate items by summing quantities subject to stock/max limits.
6. Remove invalid products.
7. Preserve the correct resulting cart.

### Edge cases

- Customer has no cart.
- Guest cart empty.
- Customer cart empty.
- Same variant exists in both carts.
- One variant becomes unavailable during merge.
- Quantity exceeds stock after merge.
- Product deleted while guest was browsing.

## 14.1c — Cart mutation

Actions:

- Add.
- Update quantity.
- Remove.
- Save for later if implemented.
- Apply promotion.
- Remove promotion.

All mutations must be server-authoritative.

## 14.1d — Cart totals

Calculate on the server:

- Subtotal.
- Discount.
- Shipping estimate.
- Tax estimate where appropriate.
- Total.

Do not trust totals generated by the browser.

## 14.1e — Cart drawer

Show:

- Items.
- Variant labels.
- Quantity controls.
- Remove.
- Shipping-progress message.
- Recommendations.
- Checkout CTA.

### Edge cases

- Cart request fails.
- Product image unavailable.
- Product price changed.
- Product becomes unavailable.
- Quantity becomes unavailable.
- Promotion expires.
- User opens multiple tabs and carts diverge.

Resolve stale state by re-fetching authoritative cart data after mutation errors or important lifecycle transitions.

### Claude prompt

> Implement a server-authoritative cart system supporting both guest and authenticated carts. Use a secure guest cart token and merge carts when a guest logs in. Revalidate products, variants, prices, active state, and quantities on every mutation. Implement cart drawer, full cart page, quantity changes, removal, promotions, shipping-progress messaging, and recommendations. Handle stale carts, deleted products, changed prices, unavailable inventory, duplicate guest/customer items, and failed mutations gracefully. Add unit tests for every cart calculation and merge edge case.

---

# 15. PHASE 15 — PROMOTIONS AND DISCOUNTS

## 15.1a — Discount validation

Server-side only.

Validate:

- Code exists.
- Active.
- Within date range.
- Usage limit not exceeded.
- Per-customer limit not exceeded.
- Minimum subtotal met.
- Product/collection eligibility.
- Currency compatibility if applicable.

## 15.1b — Discount calculation

Keep a pure calculation function separate from UI.

Input:

- Cart lines.
- Promotion.
- Customer context.
- Current date.

Output:

- Eligible subtotal.
- Discount amount.
- Final subtotal.
- Reason if invalid.

This function must be unit tested extensively.

## 15.1c — Edge cases

- Expired code during checkout.
- Code reaches usage limit between cart and checkout.
- Code applies to one item but not another.
- Percentage discount exceeds subtotal.
- Fixed discount larger than eligible subtotal.
- Multiple codes attempted.
- Case sensitivity.
- Whitespace.

Decide and document whether multiple promotions can stack. For this demo, default to **one code at a time** unless there is a strong reason otherwise.

### Claude prompt

> Implement a server-authoritative promotion engine with a pure, unit-testable calculation layer. Support percentage/fixed discounts, date windows, usage limits, per-customer limits, minimum subtotal, and eligible products/collections. Default to one discount code per order. Revalidate the discount during checkout creation rather than trusting cart state. Handle expiry, limits, ineligible products, and invalid input gracefully.

---

# 16. PHASE 16 — SHIPPING AND TAX BOUNDARIES

## 16.1a — Shipping abstraction

Create a server-only `ShippingProvider` interface even though the initial NORTH / 01 demo can use static shipping methods. The storefront should consume a normalized shipping-rate shape rather than provider-specific objects.

Minimum normalized fields:

- ID.
- Display name.
- Price.
- Currency.
- Estimated minimum/maximum delivery date or human-readable estimate.
- Eligibility.

For the demo, implement a static provider:

- Standard — free or configured threshold-based price.
- Express — fixed price.
- Overnight — fixed price.

Do not add Shippo/EasyPost/ShipStation until a real fulfillment requirement exists.

## 16.1b — Shipping validation

Server-side validation must verify that the selected shipping method is currently valid for the cart and destination. The browser must not be allowed to invent a shipping price.

## 16.1c — Tax abstraction

Create a server-only tax boundary. Stripe Tax may be the initial provider, but the checkout calculation layer should not depend directly on Stripe-specific data structures.

The internal interface should accept:

- Cart subtotal.
- Discount amount.
- Shipping amount.
- Currency.
- Customer/shipping address.

and return:

- Tax amount.
- Tax calculation status.
- Provider reference where available.

## 16.1d — Edge cases

- Destination not supported by selected shipping method.
- Shipping method becomes unavailable before checkout creation.
- Tax service unavailable.
- Invalid address.
- Address changes after shipping method selection.
- Free-shipping threshold crossed because of a coupon.

The final order must store the authoritative shipping and tax amounts used for the transaction.

### Claude prompt

> Implement explicit ShippingProvider and TaxProvider boundaries before checkout. Use a simple static shipping provider for the demo and Stripe Tax as the initial tax provider, but normalize both behind internal server-side interfaces. Revalidate shipping and tax immediately before creating the Stripe Checkout Session. Never trust client-supplied shipping prices or tax amounts. Handle invalid destinations, unavailable methods, changed cart totals, tax failures, and address changes safely.

# 17. PHASE 17 — CHECKOUT / STRIPE

## 17.1a — Checkout preflight

Before creating a Stripe Checkout Session:

1. Load cart from server.
2. Verify cart not empty.
3. Verify products still exist.
4. Verify variants active.
5. Revalidate inventory.
6. Recalculate prices.
7. Recalculate promotion.
8. Calculate/obtain shipping method.
9. Calculate/obtain tax as configured.
10. Create or update pending order context.
11. Create Stripe Checkout Session.

## 17.1b — Stripe Checkout Session

Use Stripe's official server SDK.

Never accept a client-provided total.

Use trusted server-derived values.

Attach internal references through Stripe metadata so webhook processing can identify the application order/cart safely.

## 17.1c — Checkout abandonment

Do not mark an order as paid when a Checkout Session is merely created.

Allowed states:

- Draft.
- Checkout started.
- Pending payment.
- Paid.
- Processing.
- Shipped.
- Delivered.
- Cancelled.
- Refunded.
- Payment failed.

## 17.1d — Webhook

Implement a Stripe webhook route that:

- Verifies Stripe signature.
- Parses event.
- Uses event ID/idempotency tracking.
- Handles relevant event types.
- Updates order state transactionally.
- Triggers email only after the correct state transition.

### Required webhook behavior

If Stripe retries the same event:

- Do not duplicate order creation.
- Do not decrement inventory twice.
- Do not send duplicate confirmation email.

Persist a Stripe webhook/event record with at minimum:

- Stripe event ID (unique).
- Event type.
- Received timestamp.
- Processing status.
- Related order ID where known.
- Error/retry information where needed.

The unique Stripe event ID is the first idempotency barrier. Business-state guards are the second barrier: even if the same logical transition is encountered through another event or retry, the order state machine and inventory logic must reject duplicate finalization safely.

## 17.1e — Payment state

Primary event pattern:

```text
Checkout Session created
        ↓
Payment attempted
        ↓
Payment succeeds
        ↓
Webhook verified
        ↓
Order marked paid
        ↓
Inventory adjusted
        ↓
Confirmation email
```

## 17.1f — Inventory race condition

Two customers may attempt to buy the last unit.

The checkout layer must not blindly trust the earlier page state.

At order finalization:

- Re-check inventory transactionally.
- Atomically decrement or otherwise reserve/commit stock.
- If stock is unavailable, do not mark an impossible order as fulfilled.
- Define a refund/exception path for rare payment-vs-stock races.

For this demo, prefer decrementing inventory only after a confirmed payment event, with transactional checks, rather than permanently decrementing inventory merely when an item is added to cart.

## 17.1g — Stripe redirect edge cases

If the user:

- Closes the Stripe page.
- Returns without paying.
- Refreshes success URL.
- Opens success URL directly.
- Opens cancel URL directly.
- Pays successfully but the browser never reaches success page.

The order state must still come from webhook/payment state, not the browser.

The success page should fetch the order by a safe identifier and show only authoritative order information.

## 17.1h — Stripe failure states

Handle:

- Card declined.
- Session expired.
- Customer cancels.
- Webhook delayed.
- Webhook duplicated.
- Unknown event type.
- Invalid metadata.
- Order already finalized.

Unknown events should be safely acknowledged/logged without crashing the webhook handler.

### Claude prompt

> Implement production-style Stripe Checkout integration in test mode. Create a server-side checkout preflight that revalidates cart contents, variants, price, discounts, shipping, and inventory before creating a Checkout Session. Never trust client totals. Implement a signature-verified, idempotent webhook processor that updates orders only from authoritative Stripe events. Handle duplicate webhooks, delayed webhooks, abandoned sessions, direct success/cancel URLs, payment failure, and inventory races. Add tests for webhook idempotency and impossible payment states. Do not expose Stripe secret keys to the browser.

---

# 18. PHASE 18 — ORDER SYSTEM

## 18.1a — Order creation

Create a durable application order record around checkout/payment lifecycle.

Recommended approach:

- Create pending order before or at checkout creation.
- Store stable item snapshots.
- Store Stripe identifiers.
- Finalize as paid only from validated Stripe state.

## 18.1b — Order statuses

Use a deliberately small state machine.

```text
DRAFT
  ↓
CHECKOUT_STARTED
  ↓
PAID
  ↓
PROCESSING
  ↓
SHIPPED
  ↓
DELIVERED
```

Exceptional paths:

```text
CHECKOUT_STARTED → PAYMENT_FAILED
PAID → REFUNDED
PAID → CANCELLED (only where business rules allow)
```

Do not let arbitrary transitions happen from the admin UI.

## 18.1c — Admin status changes

Server-side authorization is required.

When marking shipped:

- Require tracking where appropriate.
- Store carrier.
- Store tracking number.
- Trigger shipment email.

## 18.1d — Historical accuracy

Order item name/price/variant/SKU snapshots remain unchanged after a product is edited later.

### Claude prompt

> Implement the order state machine and order persistence. Keep historical snapshots of purchased item names, SKUs, variant labels, prices, quantities, addresses, discounts, taxes, and totals. Restrict status transitions to valid paths and protect all admin mutations with role checks. Add tests for valid/invalid status transitions and order-history immutability after product edits.

---

# 19. PHASE 19 — EMAIL / RESEND

## 19.1a — Email infrastructure

Build a centralized email service wrapper.

Example conceptual API:

- `sendWelcomeEmail()`.
- `sendOrderConfirmation()`.
- `sendOrderShipped()`.
- `sendPasswordReset()`.
- `sendContactConfirmation()`.

Do not call Resend directly from random components.

## 19.1b — Templates

Build branded React Email templates:

- Welcome.
- Verification.
- Password reset.
- Order confirmation.
- Order shipped.
- Order delivered.
- Refund.
- Contact confirmation.

## 19.1c — Duplicate email protection

A webhook retry must not send two confirmation emails.

Use an application-side event/message record or another idempotency strategy.

## 19.1d — Email failures

A failed email should not roll back a successful payment/order.

Instead:

- Log error.
- Record failure.
- Provide admin visibility.
- Allow retry where appropriate.

### Claude prompt

> Implement centralized transactional email infrastructure using Resend and React Email. Create branded templates for the defined order/account flows. Email sending must be idempotent for webhook-driven events and must never cause a successful payment/order to fail. Record sufficient delivery intent/status to prevent duplicate sends and support retries. Add local/dev safeguards so emails are not accidentally sent to arbitrary recipients using production credentials.

---

# 20. PHASE 20 — WISHLIST / ACCOUNT / RECENTLY VIEWED

## 20.1a — Wishlist

Authenticated users:

- Add/remove product.
- View wishlist.
- Move to cart.

Guests:

- Optional local wishlist.
- On login, merge into customer wishlist.

## 20.1b — Wishlist merge

Rules:

- Existing customer wishlist wins duplicates.
- Invalid/deleted products removed.
- Preserve order where useful.

## 20.1c — Recently viewed

For the demo:

- Store product IDs client-side.
- Limit to a small number, e.g. 10–20.
- Validate products before rendering.
- Do not store sensitive personal information.

## 20.1d — Account pages

Routes:

- `/account`.
- `/account/orders`.
- `/account/orders/[order]`.
- `/account/wishlist`.
- `/account/addresses`.
- `/account/settings`.

Mobile account navigation must remain simple.

### Claude prompt

> Implement wishlist, guest wishlist persistence where appropriate, guest-to-account wishlist merge, recently viewed products, and account pages. Enforce ownership on the server. Remove invalid/deleted products gracefully. Ensure account screens work with zero orders, zero wishlist items, missing addresses, and expired sessions. Add tests for cross-account access prevention and merge behavior.

---

# 21. PHASE 21 — REVIEWS

## 21.1a — Review submission rules

Only authenticated customers should submit reviews unless a deliberately designed verified-review workflow is implemented.

If verified purchase is required:

- Match customer to a paid order containing the product.

## 21.1b — Moderation

Review states:

- Pending.
- Approved.
- Rejected.

Only approved reviews appear publicly.

## 21.1c — Review abuse edge cases

- Duplicate review by same customer for same product.
- Profanity/spam.
- Oversized text.
- Huge image upload.
- Deleted product.
- Customer account disabled.

### Claude prompt

> Implement reviews with server-side validation, optional verified-purchase checks, moderation state, duplicate prevention, safe media handling, rating validation, and public rendering only for approved reviews. Build empty/reviewed states and tests for unauthorized submissions and duplicate reviews.

---

# 22. PHASE 22 — SHOP THE LOOK / LOOKBOOK

## 22.1a — Data model

Lookbook hotspot fields:

- X/Y position or responsive anchor.
- Product reference.
- Optional label.
- Optional styling variant.

Do not hard-code hotspot coordinates in React.

## 22.1b — Responsive hotspots

Desktop and mobile may require different positioning.

Support:

- Desktop coordinate.
- Mobile coordinate.

If the product reference is invalid:

- Hide the hotspot.
- Do not break the entire image.

## 22.1c — Shop-the-look interaction

Click hotspot:

- Open product preview.
- Show image/name/price/variant state.
- Allow add to bag.
- Allow full PDP navigation.

## 22.1d — Entire look

When adding full look:

1. Determine products.
2. Resolve purchasable variants.
3. Do not guess sizes silently.
4. If variant choice is required, ask for it.
5. Add only valid available items.
6. Report skipped unavailable items.

### Claude prompt

> Implement the lookbook and Shop the Look system as data-driven editorial commerce. Build responsive hotspot positioning, product previews, full-PDP links, add-to-bag behavior, and optional Add Entire Look functionality. Never silently guess unavailable or missing variants. Handle deleted products, unavailable items, mobile positioning, missing media, and partial look availability gracefully.

---

# 23. PHASE 23 — EDITORIAL / COLLECTIONS / JOURNAL

## 23.1a — Collection pages

Flow:

```text
Collection Hero
↓
Intro
↓
Editorial blocks
↓
Featured products
↓
Full collection product grid
↓
Related collections
```

## 23.1b — Edit pages

Intent-based shopping pages:

- Weekend.
- Travel.
- Everyday.
- Essentials.
- Gifts.
- Seasonal.

Each should answer:

- What is this edit?
- Why should I care?
- What products belong here?
- Where do I shop?

## 23.1c — Journal

Journal content should support links to products and collections.

Avoid creating an editorial dead end.

### Claude prompt

> Implement collections, curated Edits, Lookbook, and Journal pages as CMS-driven editorial commerce experiences. Keep page architecture visually dramatic but structurally simple. Every editorial page should provide a clear way back to shopping. Handle unpublished content, missing hero media, empty product relationships, and deleted related products without broken pages.

---

# 24. PHASE 24 — SEARCH ENGINE OPTIMIZATION

## 24.1a — Metadata

Every indexable page needs:

- Title.
- Description.
- Canonical URL.
- Open Graph metadata.
- Twitter/social image metadata where applicable.

## 24.1b — Product structured data

Generate valid product structured data from authoritative product data.

Do not include:

- Fake ratings.
- Fake availability.
- Incorrect prices.
- Prices not actually purchasable.

## 24.1c — Sitemap

Include relevant published routes.

Exclude:

- Cart.
- Checkout.
- Account pages.
- Admin.
- Private routes.

## 24.1d — Robots

Keep private/application routes out of indexing.

### Claude prompt

> Implement production-quality SEO for public storefront pages, including metadata, canonical URLs, sitemap, robots policy, Open Graph, product structured data, and indexability rules. Never generate structured data that claims false price, availability, or ratings. Exclude private account, admin, cart, and checkout routes from indexing.

---

# 25. PHASE 25 — ANALYTICS AND OBSERVABILITY

## 25.1a — Event taxonomy

Use a single internal event naming convention.

Core ecommerce events:

- `view_item_list`.
- `select_item`.
- `view_item`.
- `add_to_cart`.
- `remove_from_cart`.
- `add_to_wishlist`.
- `remove_from_wishlist`.
- `begin_checkout`.
- `add_payment_info` where applicable.
- `purchase`.

Discovery/editorial:

- `search_submitted`.
- `filter_applied`.
- `sort_changed`.
- `quick_view_opened`.
- `shop_the_look_opened`.
- `shop_the_look_add_item`.
- `newsletter_signup`.

## 25.1b — PostHog

Use for behavioral/product analytics.

Do not block business actions if PostHog fails.

## 25.1c — GA4

Send ecommerce events in GA4-compatible form.

## 25.1d — Sentry

Capture:

- Unexpected client exceptions.
- Server exceptions.
- Route errors.
- Integration failures.
- Checkout failures.

Do not send sensitive payment data or raw secrets.

## 25.1e — Vercel Speed Insights

Enable after the application is stable enough to generate meaningful real-user data.

### Claude prompt

> Add PostHog, GA4, Sentry, and Vercel Speed Insights behind integration boundaries. Define a clean ecommerce/event taxonomy first, then instrument the core flows. Analytics must be fire-and-forget and must never block commerce operations. Sentry must redact sensitive information and avoid payment credentials, authentication secrets, or raw personal data where not necessary. Verify events in local/preview environments before enabling production measurement.

---

# 26. PHASE 26 — SECURITY / BOT PROTECTION

## 26.1a — Cloudflare Turnstile

Use on:

- Newsletter.
- Contact.
- Review submission.
- Registration/login where abuse warrants it.

Server must verify Turnstile response.

Client-side widget alone is not security.

## 26.1b — Payload security

Review:

- Access controls.
- Authentication settings.
- API depth.
- Rate limiting/anti-abuse features.
- Admin access.
- Secure cookies.
- Production secret.

Payload's production guidance specifically calls for strong secrets, thoroughly tested access control, secure cookies, and abuse protections.

## 26.1c — Application security

Check:

- CSRF considerations for mutation endpoints.
- Origin checks where appropriate.
- Input validation.
- Authorization.
- Server-only module boundaries.
- SQL/query parameterization through supported data layer.
- XSS safety in rich text.
- Safe redirect handling.
- File upload restrictions.
- Open redirect prevention.

## 26.1d — Secrets

Search the repository for accidental secret strings before production deployment.

### Claude prompt

> Perform a security hardening pass across the full application. Verify access control at route and data layers, protect server-only secrets, validate all external input with Zod or equivalent server-side validation, configure Turnstile verification on public forms, review rich-text rendering for XSS safety, validate redirects, restrict uploads, and audit cookies/session behavior. Run a repository-wide secret scan and dependency audit. Do not weaken security to make a test pass.

---

# 27. PHASE 27 — TESTING STRATEGY

## 27.1a — Unit tests

Use Vitest for pure business logic:

- Price calculations.
- Discount rules.
- Cart totals.
- Cart merges.
- Inventory rules.
- Variant resolution.
- Order state transitions.
- Search mapping.
- Shipping calculations.
- Tax abstraction behavior.

## 27.1b — Component tests

Use React Testing Library for behavior-rich components:

- Variant selector.
- Filter controls.
- Cart item.
- Quantity control.
- Search overlay.
- Login form.
- Checkout form pieces.
- Wishlist button.

## 27.1c — E2E tests

Use Playwright.

Minimum flows:

1. Homepage → product → cart.
2. Search → product → cart.
3. Filter → product.
4. Quick view → add to cart.
5. Guest cart → login → cart merge.
6. Checkout with Stripe test mode.
7. Stripe webhook finalizes order.
8. Account → orders.
9. Wishlist.
10. Review flow.
11. Shop-the-look.
12. Mobile navigation.

## 27.1d — Edge-case E2E tests

Explicitly test:

- Sold-out variant.
- Product unpublished after page load.
- Cart item deleted before checkout.
- Price changed before checkout.
- Expired discount.
- Duplicate webhook.
- Refresh success URL.
- Checkout cancellation.
- Guest cart merge collision.
- Search no results.
- Search service unavailable.
- Image failure.
- Empty wishlist.
- Empty order history.
- Unauthorized account route.

## 27.1e — Automated accessibility checks

Add `@axe-core/playwright` or the current officially supported Playwright-compatible Axe integration. Run automated accessibility assertions on representative routes, while still requiring manual keyboard/focus review because automated tools cannot cover all interaction and content problems.

Minimum routes:

- Home.
- Shop.
- Product.
- Cart.
- Account/login.
- Checkout entry.

## 27.1f — CI

On pull requests:

```text
Install
↓
Typecheck
↓
Lint
↓
Unit tests
↓
Build
↓
E2E tests where environment permits
```

### Claude prompt

> Build a comprehensive testing suite using Vitest, React Testing Library, and Playwright. Prioritize business-critical logic and user flows over superficial snapshot coverage. Include happy paths and the explicit edge cases listed throughout this document. Ensure tests do not depend on flaky third-party production systems; use test adapters/mocks where appropriate, while retaining at least one real Stripe test-mode integration path for the checkout contract. Configure CI to run typecheck, lint, unit tests, build, and appropriate E2E tests.

---

# 28. PHASE 28 — ADMIN EXPERIENCE

## 28.1a — Product management

Admin should be able to:

- Create product.
- Edit product.
- Archive product.
- Manage variants.
- Upload media.
- Set price.
- Set compare-at price.
- Set inventory.
- Manage collections.
- Manage tags.
- Manage editorial relationships.

## 28.1b — Order management

- Search order.
- View order.
- View payment status.
- Update fulfillment status.
- Add tracking.
- Refund according to controlled workflow.

## 28.1c — Content management

- Homepage blocks.
- Collections.
- Edits.
- Lookbooks.
- Journal.
- FAQs.
- Navigation.
- Footer.

## 28.1d — Admin guardrails

Admin UI must not permit:

- Arbitrary order status transitions.
- Invalid refunds.
- Negative inventory unless explicitly supported.
- Duplicate SKUs.
- Publishing malformed products.

### Claude prompt

> Build and configure the Payload Admin experience around the data model. Prioritize product, variant, collection, edit, campaign, lookbook, journal, homepage, FAQ, order, customer, review, promotion, and media management. Add admin validation and guardrails so invalid commerce states cannot be created accidentally. Keep the admin useful to a non-technical client without introducing unnecessary custom dashboard complexity.

---

# 29. PHASE 29 — CONTENT SEEDING / DEMO DATA

## 29.1a — Brand data

Create a cohesive fictional brand:

**NORTH / 01**

Tone:

- Premium.
- Contemporary.
- Minimal.
- Confident.
- Editorial.

## 29.1b — Products

Seed approximately 20–30 products.

Categories should include:

- Tees.
- Shirts.
- Hoodies.
- Sweatshirts.
- Jackets.
- Pants.
- Shorts.
- Hats.
- Bags.
- Accessories.

## 29.1c — Product realism

Every product should have:

- Useful description.
- Price.
- At least 2–4 variants where logical.
- Multiple images.
- Material.
- Fit.
- Care.
- Inventory.
- Collection assignment.
- At least some products with reviews.
- Some new products.
- Some best sellers.
- Some limited products.

Do not populate every product with identical metadata. The demo should feel authored rather than generated from a template.

## 29.1d — Demo accounts

Create clearly documented test accounts only where safe.

Never commit real credentials.

### Claude prompt

> Create coherent NORTH / 01 demo content sufficient to demonstrate every feature. Seed 20–30 realistic products with varied categories, variants, imagery placeholders or approved media, pricing, stock states, collections, reviews, and editorial relationships. Seed multiple collections, edits, a lookbook, journal entries, FAQs, and homepage content. Keep the content aesthetically consistent and varied. Ensure seed scripts are idempotent and do not duplicate data when run twice.

---

# 30. PHASE 30 — PERFORMANCE / RESPONSIVE POLISH

## 30.1a — Responsive breakpoints

Design/test at minimum:

- 320px.
- 375px.
- 430px.
- 768px.
- 1024px.
- 1280px.
- 1440px.
- 1920px.

## 30.1b — Layout shift prevention

- Fixed/known image aspect ratios.
- Proper image sizing.
- Font loading strategy.
- Skeletons where asynchronous content affects layout.

## 30.1c — Performance priorities

Hero/LCP image should be prioritized.

Below-fold media should lazy-load.

Avoid:

- Huge uncompressed PNGs.
- Autoplaying massive videos.
- Unnecessary client components.
- Large third-party scripts before interaction.

## 30.1d — Mobile UX

Test:

- Touch targets.
- Sticky purchase controls.
- Drawer scrolling.
- Image swiping.
- Filter drawer.
- Keyboard behavior.
- Address entry.
- Checkout.

### Claude prompt

> Perform a dedicated responsive and performance pass. Test all major pages at the defined viewport sizes. Fix layout shift, oversized assets, unnecessary client rendering, awkward touch targets, broken sticky UI, and mobile overflow. Preserve the premium editorial experience on mobile rather than simply shrinking desktop layouts. Validate the main homepage LCP path and PDP gallery performance.

---

# 31. PHASE 31 — ERROR / EMPTY / LOADING STATES

Every feature must have intentional states.

## 31.1a — Global states

- Loading.
- Not found.
- Unauthorized.
- Forbidden.
- Server error.
- Network error.
- Maintenance/error fallback.

## 31.1b — Product states

- Unpublished.
- Deleted.
- Sold out.
- Variant unavailable.
- Media missing.

## 31.1c — Catalog states

- Empty filter.
- No products.
- Search service unavailable.

## 31.1d — Account states

- Not logged in.
- No orders.
- Empty wishlist.
- No addresses.

## 31.1e — Cart states

- Empty.
- Stale item.
- Out-of-stock item.
- Price changed.
- Promotion expired.

## 31.1f — Checkout states

- Empty cart.
- Invalid address.
- Shipping unavailable.
- Payment declined.
- Payment pending.
- Payment succeeded but webhook not yet reflected.
- Session expired.

The site should never display a generic blank page when a known business state can be communicated clearly.

### Claude prompt

> Audit every route and major component for loading, empty, error, unauthorized, forbidden, not-found, unavailable, and success states. Replace generic blank/fatal states with intentional branded UI. Ensure async failures in optional services degrade without taking down the storefront. Add tests where state transitions are business-critical.

---

# 32. PHASE 32 — DEPLOYMENT TO VERCEL

## 32.1a — Create Vercel project

Connect GitHub repository.

Configure:

- Root directory if necessary.
- Build command.
- Install command.
- Node version.
- Environment variables.

## 32.1b — Preview environment

Use preview deployments for:

- Feature branches.
- Pull requests.
- Stakeholder review.

Preview should use:

- Non-production database.
- Stripe test mode.
- Non-production API credentials.
- Separate integration settings.

## 32.1c — Production

Production uses:

- Production Postgres.
- Production Payload secret.
- Production Cloudinary config.
- Production Resend domain.
- Production Stripe keys only when actually launched.
- Production search index.

## 32.1d — Migration procedure

Before production deployment:

1. Backup.
2. Apply migrations in controlled order.
3. Deploy app.
4. Verify schema.
5. Smoke-test core flows.
6. Monitor errors.

### Claude prompt

> Prepare the application for Vercel deployment. Configure separate Preview and Production environments, environment variables, build configuration, database connectivity, Payload deployment, and safe migrations. Ensure Preview never uses production payment credentials or production customer data. Create a deployment checklist and post-deployment smoke test covering homepage, search, product, cart, checkout test mode where applicable, Payload admin, and critical API/webhook routes.

---

# 33. PHASE 33 — CLOUDFLARE / DOMAIN / DNS

## 33.1a — DNS

Use Cloudflare DNS for the eventual custom domain.

During development, a Vercel-provided domain is sufficient.

## 33.1b — Production domain

When a domain is purchased:

- Add it to Vercel.
- Configure DNS through Cloudflare.
- Verify HTTPS.
- Verify canonical host.
- Redirect alternate hostname appropriately.

## 33.1c — Email DNS

For Resend custom sending domain:

- SPF.
- DKIM.
- Any required verification records.

Do not claim email delivery is production-ready until DNS verification succeeds.

### Claude prompt

> Configure domain and DNS architecture without making production-domain assumptions during development. Document the exact DNS records that will be required once a domain is purchased. Validate HTTPS, canonical host redirects, and Resend domain verification when configured. Do not change DNS records blindly; inspect current records first and preserve unrelated services.

---

# 34. PHASE 34 — SECURITY / PRIVACY / DATA MINIMIZATION FINAL AUDIT

## 34.1a — Personal data inventory

Identify every field that contains:

- Name.
- Email.
- Phone.
- Address.
- Order history.
- Authentication information.

## 34.1b — Data minimization

Do not collect data solely because the schema can hold it.

## 34.1c — Logging

Never log:

- Passwords.
- Card data.
- API keys.
- Full session tokens.
- Sensitive personal data unnecessarily.

## 34.1d — Admin privacy

Ensure customer/order data is visible only to authorized roles.

### Claude prompt

> Conduct a final privacy and security audit. Trace customer data from browser input through Next.js, Payload/Postgres, Stripe, Resend, analytics, and logs. Identify unnecessary data collection, sensitive logging, over-broad access controls, exposed IDs/secrets, and missing authorization. Fix all issues found and document the data flow and retention assumptions.

---

# 35. PHASE 35 — FINAL PRODUCT QUALITY PASS

## 35.1a — Visual consistency

Review every page against `NORTH01_Visual_Guide_OnlineOnly.md` and `NORTH01_Visual_Reference_OnlineOnly.png` before considering the phase complete. Review every page for:

- Typography.
- Spacing.
- Image ratios.
- Button styling.
- Border styling.
- Animation speed.
- Header behavior.
- Footer consistency.

## 35.1b — Navigation clarity

Ask for every page:

- Where am I?
- What can I do here?
- How do I get back?
- How do I shop?
- Where is the cart?

If any answer is unclear, simplify.

## 35.1c — Commerce clarity

At every product-related page:

- Is the price obvious?
- Are variants obvious?
- Is availability obvious?
- Is Add to Bag obvious?
- Is shipping/returns discoverable?

## 35.1d — Editorial quality

- Do images feel cohesive?
- Does editorial copy support the brand?
- Do editorial sections lead to commerce?
- Does the site still feel like one brand?

### Claude prompt

> Perform a final visual and UX quality audit of the complete NORTH / 01 site. Do not add features merely to make the site appear more complex. Focus on hierarchy, clarity, editorial quality, shopping efficiency, motion restraint, typography, imagery, responsive behavior, and brand consistency. Remove redundant UI and simplify any confusing flows. The final experience must feel premium but easy to understand.

---

## 36.0 — Final six-document consistency audit

Before the three review passes, re-read the six canonical project artifacts and compare the implemented repository against them.

Verify:
- Visual guide → implemented UI.
- Visual reference image → overall visual tone/composition.
- Tech stack → installed/runtime services.
- Feature matrix → implemented feature set.
- Website structure → routes/navigation/user journeys.
- Implementation plan → phase completion and acceptance gates.

Any mismatch must be classified as:
- Documentation error: update the document.
- Implementation error: update the code.
- Intentional deviation: document the reason and update all affected artifacts.

Do not leave silent contradictions.

# 36. PHASE 36 — THREE REQUIRED REVIEW PASSES

The implementation is not considered complete after the feature build. Claude must perform three separate review passes, in order, and make corrective changes between them.

### Claude prompt

> Enter final audit mode. Stop adding new product features. Execute Review Pass 1, then Review Pass 2, then Review Pass 3 exactly as specified below. After each pass, fix all High/Critical findings, rerun the relevant tests, and document what changed. Do not declare the project complete while any known High/Critical issue remains. The purpose of these reviews is to find problems that the implementation process itself may have missed, not merely to confirm that the happy path works.

---

## 36.1a — REVIEW PASS 1 — ARCHITECTURE AND DATA INTEGRITY

### Objective

Find anything that could make the application structurally unreliable.

### Audit questions

#### Architecture

- Are server-only secrets ever imported into client code?
- Are core domain rules centralized?
- Are there duplicated product/order calculations?
- Are there circular dependencies?
- Are components too large?
- Are server/client boundaries intentional?

#### Database

- Are unique constraints present where required?
- Are foreign keys/relationships sane?
- Are indexes sufficient for common reads?
- Are migration files reproducible?
- Are historical order snapshots preserved?

#### Commerce

- Can client-side price data alter the final charge?
- Can a sold-out variant be added through a crafted request?
- Can a user access another user's order through ID manipulation?
- Can duplicate Stripe webhooks create duplicate orders?
- Can inventory become negative?
- Can discounts be manipulated?

#### Authentication

- Can roles be escalated?
- Are protected routes actually protected?
- Are ownership checks server-side?

#### Integrations

- Does the site remain functional if analytics fails?
- Does search failure destroy the catalog?
- Does email failure break checkout?
- Does media failure break layout?

### Required output

Create:

`docs/REVIEW_1_ARCHITECTURE.md`

containing:

- Issues found.
- Severity.
- Root cause.
- Fix.
- Verification.

### Required action

Fix all High/Critical issues before Review Pass 2.

### Claude review prompt

> STOP FEATURE DEVELOPMENT. Perform Review Pass 1: an architecture, data-integrity, authorization, commerce, and integration-resilience audit of the entire repository. Assume an attacker will manipulate every browser request and every client-side field. Trace the full purchase lifecycle from product display to cart to Stripe to webhook to order/inventory/email. Inspect database constraints, access controls, server/client boundaries, idempotency, stale data, external-service failure behavior, and migration safety. Create `docs/REVIEW_1_ARCHITECTURE.md`. Fix every High/Critical issue immediately. Retest all affected functionality. Do not simply document known bugs; correct them.

---

## 36.1b — REVIEW PASS 2 — USER EXPERIENCE, RESPONSIVE DESIGN, AND ACCESSIBILITY

### Objective

Find anything that makes the site confusing, difficult, slow, inaccessible, visually inconsistent, or unnecessarily complicated.

### Audit flows

Run these journeys as a real user:

1. New visitor → homepage → shop → product → cart.
2. New visitor → search → product → quick add.
3. Visitor → collection → shop the look → product.
4. Visitor → wishlist → account/login.
5. Guest cart → login → cart merge.
6. Guest → checkout → payment.
7. Customer → account → order history.
8. Mobile visitor → navigation → product → checkout.

### Accessibility audit

Check:

- Keyboard-only navigation.
- Focus trap.
- Focus restoration.
- Screen-reader names.
- Form labels.
- Error messaging.
- Color contrast.
- Motion reduction.
- Touch targets.
- Heading hierarchy.
- Modal semantics.

### UX audit

Check:

- Too many choices at once.
- Ambiguous CTAs.
- Overloaded mega menus.
- Dead-end editorial pages.
- Cart drawer usability.
- Filter usability.
- Search clarity.
- Mobile navigation depth.
- Checkout friction.

### Required output

Create:

`docs/REVIEW_2_UX_ACCESSIBILITY.md`

### Required action

Fix High/Critical issues and simplify unclear flows.

### Claude review prompt

> STOP FEATURE DEVELOPMENT. Perform Review Pass 2 as a ruthless UX, responsive, accessibility, and visual-quality audit. Use real browser interactions and test desktop and mobile viewports. Navigate every core journey as an inexperienced customer would. Test keyboard-only usage and all overlays. Identify clutter, unclear CTAs, confusing hierarchy, inaccessible controls, broken responsive layouts, excessive animation, and unnecessary navigation depth. Create `docs/REVIEW_2_UX_ACCESSIBILITY.md`. Fix the issues rather than merely documenting them, then rerun the affected tests.

---

## 36.1c — REVIEW PASS 3 — PRODUCTION READINESS, PERFORMANCE, AND FAILURE SIMULATION

### Objective

Assume the site will be deployed tomorrow and a real customer will break it in unexpected ways.

### Failure simulations

Simulate or test:

- Database unavailable.
- Search unavailable.
- Cloudinary asset unavailable.
- Resend failure.
- Stripe webhook delayed.
- Duplicate webhook.
- Checkout canceled.
- Checkout session expired.
- Payment rejected.
- Product deleted after being added to cart.
- Price changed after cart creation.
- Inventory sold out during checkout.
- Expired discount.
- Invalid URL parameters.
- Expired account session.
- Unauthorized order access.
- Missing CMS media.
- Missing optional content.
- Large image uploads.
- Empty database.

### Performance audit

Check:

- Homepage LCP.
- PDP image performance.
- JS bundle size.
- Client component count.
- Third-party script loading.
- Image sizes.
- Cache behavior.
- Server response time.

### Deployment audit

Verify:

- Production build.
- Environment variables.
- Migration procedure.
- Vercel deployment.
- Stripe webhook endpoint.
- Resend domain.
- Cloudinary configuration.
- Search index.
- Sentry.
- Analytics.

### Required output

Create:

`docs/REVIEW_3_PRODUCTION_READINESS.md`

### Required action

Fix all High/Critical issues. Medium issues should be fixed when reasonably safe and local to the current architecture.

### Claude review prompt

> STOP FEATURE DEVELOPMENT. Perform Review Pass 3 as a production-readiness, performance, resilience, security, and deployment audit. Treat every external integration as capable of failing. Test the application with missing services, delayed webhooks, stale cart data, product deletions, price changes, inventory races, expired promotions, unauthorized IDs, missing media, and empty datasets. Audit performance and client/server boundaries. Verify the actual Vercel build and production configuration. Create `docs/REVIEW_3_PRODUCTION_READINESS.md`. Fix all High/Critical problems and rerun the relevant test suite until stable.

---

# 37. FINAL ACCEPTANCE GATES

The project is complete only when all of the following are true.

## 37.1a — PHASE GATE TEMPLATE

Every phase must end with the following sequence before Claude considers it complete:

1. Review `git diff` for unintended changes.
2. Run TypeScript typecheck.
3. Run ESLint.
4. Run relevant unit/component tests.
5. Run relevant browser/E2E tests.
6. Run the production build.
7. Perform a real-browser smoke test of the feature.
8. Update documentation.
9. Record any unresolved low-severity issues.
10. Commit the completed phase.

A phase is not complete merely because the code compiles.


## 37.1b — Development

- `pnpm install` succeeds on a clean environment.
- `.env.example` is complete.
- Local development works from documented steps.
- Payload Admin loads.
- Database connects.
- Seed script works.

## 37.1c — Quality

- TypeScript passes.
- ESLint passes.
- Prettier check passes.
- Unit tests pass.
- Component tests pass where used.
- Playwright critical-path tests pass.
- Production build passes.

## 37.1d — Commerce

- Product variants work.
- Cart works for guest.
- Cart works for authenticated user.
- Guest-to-user cart merge works.
- Server recalculates totals.
- Stripe test checkout works.
- Stripe webhook works.
- Webhook is idempotent.
- Order is created/updated correctly.
- Inventory updates correctly.
- Confirmation email does not duplicate.

## 37.1e — CMS

- Products editable.
- Collections editable.
- Edits editable.
- Homepage editable.
- Lookbook editable.
- Journal editable.
- FAQ editable.
- Navigation editable where intended.

## 37.1f — UX

- Desktop works.
- Mobile works.
- Tablet works.
- Search works.
- Filters work.
- Cart drawer works.
- Wishlist works.
- Account works.
- Shop the Look works.
- Empty/error/loading states exist.

## 37.1g — Security

- No secrets in Git.
- No secret environment variables exposed publicly.
- Online-only business-model audit passes: no store locator, POS, pickup, store inventory, physical location, or in-store workflow exists.
- Shipping, tracking, delivery, and online returns/support are complete and remote-only.
- Customer ownership checks pass.
- Admin authorization passes.
- Stripe signatures verified.
- Public forms protected as required.
- File uploads restricted.

## 37.1h — Deployment

- Vercel preview works.
- Production deployment works.
- Production environment variables documented.
- Database connection works.
- Webhook route reachable.
- Sentry receives intentional test error in non-production.
- Analytics events visible in appropriate environments.

---

# 38. REQUIRED DOCUMENTATION TO LEAVE BEHIND

Claude must create and maintain:

```text
README.md

/docs/
├── ARCHITECTURE.md
├── STACK_VERSIONS.md
├── DEVELOPMENT.md
├── ENVIRONMENT.md
├── DATABASE.md
├── CMS.md
├── COMMERCE.md
├── SEARCH.md
├── EMAIL.md
├── ANALYTICS.md
├── DEPLOYMENT.md
├── SECURITY.md
├── TESTING.md
├── REVIEW_1_ARCHITECTURE.md
├── REVIEW_2_UX_ACCESSIBILITY.md
└── REVIEW_3_PRODUCTION_READINESS.md
```

Each document should explain how to reproduce the behavior instead of merely describing it.

---

# APPENDIX — ARCHITECTURAL REVIEW CORRECTIONS ALREADY APPLIED TO THIS PLAN

This section records corrections deliberately made after reviewing the initial architecture.

## 41.1a — Vercel is explicitly retained

The deployment target is Vercel because it is the chosen platform for this project. The plan does not substitute another host.

## 41.1b — Payload and Next.js are one application

A separate Express/Nest/Fastify backend is intentionally excluded. Payload is embedded in the Next.js application using the supported integration pattern.

## 41.1c — No second ORM

The plan does not introduce Prisma or another ORM alongside Payload's Postgres/Drizzle adapter. That avoids duplicate data-access abstractions.

## 41.1d — Stripe is not the order database

Stripe identifiers are stored on application orders, but the application maintains its own durable order history and business state.

## 41.1e — Client-side totals are never trusted

All purchase-critical totals are revalidated server-side before checkout creation.

## 41.1f — Browser redirect is not payment confirmation

The browser success page is informational. Webhook/payment state is authoritative.

## 41.1g — Webhook idempotency is mandatory

Duplicate events and retries are expected, not exceptional.

## 41.1h — Inventory race conditions are explicitly addressed

Inventory is not treated as static page data. Final availability is revalidated transactionally.

## 41.1i — Historical order data is snapshotted

Orders retain historical product/variant/price information so future product edits cannot rewrite the past.

## 41.1j — Guest carts are first-class

The project supports anonymous browsing and cart creation, then merges the guest cart on login.

## 41.1k — Optional services can fail

Analytics, search, email, media, and monitoring failures have explicit degradation behavior.

## 41.1l — Algolia is derived state

A search index can be rebuilt from Payload/Postgres and is never the canonical product source.

## 41.1m — No requirement for paid infrastructure

The architecture is designed so local development and the initial demo can remain within free/low-volume service tiers where available. The plan does not assume a paid queue, Redis cluster, Kafka, or separate backend.

## 41.1n — No unnecessary background worker dependency

The core purchase flow does not depend on a separate queue system merely to work. Where asynchronous retry behavior is needed, it should first use an application-level record/retry strategy compatible with the chosen infrastructure rather than introducing another service without need.

## 41.1o — Review passes are corrective, not descriptive

The three review passes explicitly require fixing issues found and rerunning verification.

## 41.1p — Checkout and webhook idempotency are separate concerns

The plan now protects both checkout-session creation and Stripe webhook processing. A duplicate checkout request and a duplicate Stripe event are different failure modes and must not share a single simplistic fix.

## 41.1q — Shipping and tax are explicit provider boundaries

Shipping and tax now have server-only abstraction boundaries so the demo can use simple providers today without coupling the entire checkout domain to a specific vendor.

## 41.1r — Cart expiration does not require a new infrastructure service

Expired carts are rejected based on timestamps, and cleanup can be opportunistic. A Redis/queue dependency is not introduced merely to delete abandoned carts.

## 41.1s — Accessibility is tested automatically and manually

The plan now includes automated Axe checks plus manual keyboard/focus/reduced-motion review.

---

# FINAL ACCEPTANCE — DEFINITION OF "DONE"

NORTH / 01 is done when a new developer can clone the repository, follow `docs/DEVELOPMENT.md`, configure the environment, start the application, access Payload, view seeded products, browse the storefront, search/filter products, select variants, add items to a cart, authenticate, merge carts, apply valid promotions, complete a Stripe test-mode online checkout, receive a correct order state through the webhook, view the shipped/delivery-oriented order status in the account, manage online content and fulfillment data through Payload, and deploy the project to Vercel—without needing undocumented manual fixes.

The final storefront must look like a premium fashion ecommerce brand, while the underlying application must behave like a real ecommerce system.


# CANONICAL PROJECT FILES

Keep these files in the repository root and treat them as a synchronized set:

```text
NORTH01_Claude_Implementation_Plan_Current_OnlineOnly.md
NORTH01_Visual_Guide_OnlineOnly.md
NORTH01_Visual_Reference_OnlineOnly.png
01_NORTH01_Tech_Stack_Current_OnlineOnly.md
02_NORTH01_Features_and_Tech_Implementation_Current_OnlineOnly.md
03_NORTH01_Website_Structure_and_User_Flow_Current_OnlineOnly.md
```

When a material architecture, feature, navigation, or visual decision changes during implementation:
1. Update the implementation plan if execution/architecture changed.
2. Update the feature matrix if scope/technology mapping changed.
3. Update the website structure if a user-facing flow/navigation changed.
4. Update the tech stack if a technology/service changed.
5. Update the visual guide/reference only if the visual direction changed.
6. Re-run the consistency audit.

The implementation is not considered centralized until all affected artifacts agree.
