# NORTH / 01 — Canonical Technology Stack

> **Status:** Current centralized stack reference.
>
> This document is the implementation stack source of truth. The master Claude implementation plan defines the build order. The feature matrix maps features to this stack. The website structure defines the user-facing experience. The visual guide defines appearance only.

> **Business model constraint — ONLINE-ONLY DTC APPAREL**
>
> NORTH / 01 is an online-only direct-to-consumer apparel brand. There is no physical retail location and no in-store purchasing workflow. All product discovery, customer service, checkout, payment, fulfillment, delivery, returns, and account activity are designed for remote online customers.
>
> **Explicitly out of scope:** physical store pages, store locator, store hours, POS, in-store checkout, buy-online-pickup-in-store, curbside pickup, store inventory, retail staff checkout workflows, in-store returns, and physical-location appointment flows.
>
> **Fulfillment model:** inventory represents centralized online fulfillment stock. Orders are paid online, fulfilled remotely, shipped to the customer, tracked, and returned through an online-first process.

> **As built (Phase 36 documentation audit).** The requirements below are unchanged. Where the build departs from them, the deviation register in `NORTH01_Implementation_Notes_and_Deviations.md` §2 governs, and each affected row is annotated:
>
> - **Motion** — not installed (DEV-24, DEV-40). Motion is CSS on the duration tokens (ARCHITECTURE D-13, D-34).
> - **React Hook Form** — not installed. Forms are Server Actions with `useActionState` and Zod (DEV-80).
> - **Stripe Tax** — not wired. Tax is a provider boundary that answers `unavailable` rather than inventing a number (DEV-61).
> - **Storybook** — not installed. The in-app `/design-system` route is the equivalent (DEV-20).
> - **Husky + lint-staged** — not adopted. CI enforces the gate (DEV-81).
> - **`sharp`** — not installed (DEV-33, ARCHITECTURE D-27).
>
> Resolved versions and the evidence for each pin: `docs/STACK_VERSIONS.md`.

## 1. Stack at a Glance

| Layer | Technology / Service | Role | Required for Demo |
|---|---|---|---|
| Framework | Next.js 16.x, pinned to Payload-compatible release | Full-stack React framework, routing, rendering, server code | Yes |
| Runtime | Node.js 20.9+ | Local/build/runtime environment | Yes |
| Language | TypeScript | Application/domain typing | Yes |
| Package manager | pnpm | Dependency/workspace management | Yes |
| Styling | Tailwind CSS | Styling + design tokens | Yes |
| UI primitives | shadcn/ui + Radix UI | Accessible primitives, dialogs, drawers, menus, controls | Yes |
| Animation | Motion | Restrained page/component motion | Yes — *as built: not installed, CSS instead (DEV-40)* |
| Icons | Lucide | Consistent iconography | Yes |
| Fonts | `next/font` with selected project fonts | Typography/loading | Yes |
| Forms | React Hook Form | Complex forms | Yes — *as built: Server Actions + `useActionState` + Zod (DEV-80)* |
| Validation | Zod | Shared/server-authoritative validation | Yes |
| URL state | nuqs | Search/filter/sort query state | Yes |
| CMS/backend | Payload CMS | Admin, content, auth, access control, REST/API, media metadata | Yes |
| Database | PostgreSQL | Primary application data store | Yes |
| Managed DB | Neon Postgres | Hosted PostgreSQL for dev/preview/prod as appropriate | Yes |
| DB adapter | `@payloadcms/db-postgres` / Payload's Postgres layer | Payload/Postgres integration | Yes |
| Payment | Stripe | Test-mode checkout, payment state, refunds, webhooks | Yes |
| Tax | Stripe Tax | Tax calculation when enabled/configured | Yes — *as built: deferred behind a provider boundary (DEV-61)* |
| Shipping | Internal shipping service/adapter | Online-only delivery rates/rules; future carrier integrations | Yes |
| Media | Cloudinary | Product/editorial image delivery and transformations | Yes |
| Search | Algolia | Search/autocomplete/faceting; derived index | Yes |
| Email | Resend | Transactional email delivery | Yes |
| Email templates | React Email | Branded email templates | Yes |
| Analytics | PostHog | Product/behavior analytics | Optional but planned |
| Marketing analytics | GA4 (Google Analytics 4) | Traffic/ecommerce analytics | Optional but planned |
| Monitoring | Sentry | Errors/performance diagnostics | Optional but planned |
| Web performance | Vercel Speed Insights | Real-user performance | Optional but planned |
| Bot protection | Cloudflare Turnstile | Abuse protection on public forms | Optional but planned |
| DNS | Cloudflare DNS | Domain DNS management | Yes for custom domain |
| Hosting | Vercel | Next.js deployments, previews, CDN, functions | Yes |
| Source control | GitHub | Repository + collaboration | Yes |
| CI | GitHub Actions | Automated checks | Yes |
| Unit tests | Vitest | Business/domain logic tests | Yes |
| Component tests | React Testing Library | UI behavior tests | Yes |
| E2E | Playwright | Browser/critical-path tests | Yes |
| Accessibility automation | axe-core + Playwright integration | Automated accessibility checks | Yes |
| Component workbench | Storybook | Reusable component/design-system development | Recommended — *as built: `/design-system` route instead (DEV-20)* |
| Linting | ESLint | Static analysis | Yes |
| Formatting | Prettier | Formatting | Yes |
| Git hooks | Husky + lint-staged | Local quality gates | Recommended — *as built: not adopted, CI enforces the gate (DEV-81)* |

## 2. Non-Goals / Deliberate Omissions

Do **not** add these unless a concrete requirement appears:

- Separate Express/Nest/Fastify backend.
- Supabase as a second backend.
- Sanity or another second CMS.
- Redis before an actual requirement exists.
- Kafka or a message-bus system.
- Separate auth provider on top of Payload Auth.
- Separate ORM outside Payload's supported database layer.
- Shippo/EasyPost/ShipStation for the demo.
- A second media CDN.
- Multiple search providers.
- Multiple primary analytics platforms beyond the planned GA4 + PostHog split.

## 3. Ownership Rules

| Concern | Source of truth | Derived / External |
|---|---|---|
| Product data | PostgreSQL via Payload | Algolia index |
| Product variants | PostgreSQL via Payload | Search index |
| Prices | PostgreSQL via Payload | Stripe checkout snapshot |
| Inventory | PostgreSQL via transactional service | Online fulfillment availability |
| Collections/edits/lookbooks | PostgreSQL via Payload | Rendered pages |
| Customer identity | Payload Auth + PostgreSQL | Stripe customer ID mapping |
| Cart | PostgreSQL for authenticated carts; secure guest-cart mechanism mapped to DB | Stripe checkout session |
| Orders | PostgreSQL via Payload | Stripe payment events |
| Payment status | Stripe webhook events | Local order payment state |
| Tax result | Stripe Tax when enabled (*as built: DEV-61*) | Order snapshot |
| Shipping method/rate | Internal shipping service/adapter | Order snapshot |
| Search | Algolia | Rebuilt/synchronized from primary data |
| Media asset metadata | Payload | Cloudinary delivery |
| Email | Order/customer data in Postgres | Resend delivery state |
| Analytics | Event layer | PostHog/GA4 |
| Errors/perf | App runtime | Sentry/Vercel |

## 4. Environment Model

### Local development
- Local Next.js + Payload.
- Neon development database.
- Stripe test mode.
- Cloudinary development folder/preset.
- Resend test/dev destination strategy.
- Algolia development index.
- Separate analytics projects or clearly namespaced development events.

### Preview
- Vercel Preview deployment.
- Preview database or isolated Neon branch.
- Stripe test mode only.
- Non-production secrets.
- Non-production Algolia index.
- Non-production media namespace.

### Production/demo
- Vercel production.
- Production database.
- Stripe test mode until real payments are explicitly required.
- Production media namespace.
- Production search index.
- Transactional email from verified sender/domain.
- Analytics/monitoring enabled as appropriate.

## 5. Online-Only Operational Rules

- Inventory represents centralized online fulfillment stock only.
- Every customer order is shipped or otherwise remotely delivered; there is no pickup mode.
- Shipping addresses are required for physical-goods checkout unless a future digital-goods requirement is explicitly introduced.
- Returns are initiated online through the account/order experience or support flow.
- Do not introduce store/location entities unless the business model explicitly changes.

## 6. Versioning Rule

Do not blindly install "latest" versions.

At implementation time:
1. Inspect the currently published versions.
2. Confirm compatibility using official documentation.
3. Pin the package versions actually tested.
4. Upgrade only when compatibility is verified.
5. Keep Next.js and Payload on a documented compatible combination.

Payload's current installation documentation requires Node.js 20.9+ and lists supported Next.js 16 versions beginning at 16.2.6; verify the exact compatible versions at install time. citeturn304451search3turn304451search7

## 6. Vercel

Vercel is the chosen hosting platform by project decision. Use it for:
- Production deployments.
- Preview deployments.
- Next.js runtime.
- CDN/cache/revalidation.
- Functions/API routes.
- Speed Insights.

Keep environment variables and deployment environments clearly separated. Vercel provides first-class Next.js support and automatic deployment workflows from Git. citeturn304451search1turn304451search8

## 7. Payload

Payload is the application backend/CMS, not merely a content editor. It provides:
- Admin panel.
- Schema/configuration.
- Postgres integration.
- Auth.
- Access control.
- REST/API.
- Media management.
- Migrations.
- Extensibility.

It is intentionally embedded into the same Next.js application rather than being a separate backend service. citeturn304451search0turn304451search3

## 8. Cost Discipline

The demo should begin with free/test tiers wherever practical.

Never introduce a paid service merely because it is convenient if an approved free/local implementation already satisfies the requirement.

The following are intentionally test/free oriented during development:
- Stripe Test Mode.
- Free/low-usage hosted tiers where available.
- Local development tooling.
- Vercel deployment within the chosen account's limits.

Before a commercial client launch, re-check each provider's current terms/pricing and licensing rather than assuming demo-tier limits remain appropriate.
