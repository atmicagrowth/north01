# NORTH / 01

An online-only direct-to-consumer premium apparel storefront.

NORTH / 01 is a fictional brand built as a production-oriented ecommerce demonstration: an editorial
fashion storefront on top of a real commerce backend — server-authoritative pricing and inventory,
webhook-confirmed payments, durable order history, and a CMS a non-technical client could actually run.

---

## Business model — read this first

NORTH / 01 sells **online only**. There is no physical retail.

The system deliberately contains **no** store locator, store hours, POS, in-store checkout,
buy-online-pickup-in-store, curbside pickup, store-level inventory, retail-staff workflows, or in-store
returns. Inventory means *centralized online fulfillment stock*. Every order is paid online, fulfilled
remotely, shipped, tracked online, and returned through an online-first process.

This constraint is enforced at every phase and is an explicit acceptance gate.

## Stack

Next.js 16 · React 19 · TypeScript · Payload CMS 3 · PostgreSQL (Neon) · Stripe · Cloudinary · Algolia ·
Resend · Tailwind CSS 4 · Radix · Vercel

Payload is embedded **inside** the Next.js application — one deployable, not a separate backend.
Motion, React Hook Form, Storybook and Husky are in the approved stack but not installed (DEV-40,
DEV-80, DEV-20, DEV-81). Resolved versions and the reasoning behind each pin:
[`docs/STACK_VERSIONS.md`](docs/STACK_VERSIONS.md).

## Data ownership

| Concern | Source of truth |
|---|---|
| Products, variants, inventory, pricing, orders, customers, content | **PostgreSQL via Payload** |
| Payment state | **Stripe** (verified webhook events only) |
| Search index | Algolia — *derived, rebuildable, never authoritative* |
| Media delivery | Cloudinary — *metadata stays in Payload* |
| Email delivery | Resend — *never blocks or rolls back an order* |
| Analytics | PostHog / GA4 — *never required for a purchase to succeed* |

The browser is never trusted for price, inventory, discount validity, tax, shipping, order total, or
payment success. All of it is recalculated server-side.

## Documentation

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Architecture, boundaries, decisions, cross-document consistency audit |
| [`docs/STACK_VERSIONS.md`](docs/STACK_VERSIONS.md) | Every version pin and the evidence for it |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Local setup and day-to-day workflow |
| [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) | Every environment variable, its tier, its source, and the guards around them |
| [`docs/SECURITY.md`](docs/SECURITY.md) | What personal data the shop collects, who can see it, where it goes, how long it is kept, what is kept out of logs, and the security headers |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Vercel environments, the migration procedure, the production search index, the scheduled drain, rollback, and the post-deployment smoke test |
| [`docs/SEARCH.md`](docs/SEARCH.md) | The Algolia index, what it holds, and how it is rebuilt |
| [`docs/CMS.md`](docs/CMS.md) | The admin for the owner and editors: collections, roles, publishing, media, common tasks |
| [`docs/COMMERCE.md`](docs/COMMERCE.md) | Money, bag, promotions, shipping, tax, checkout, the webhook and order state |
| [`docs/EMAIL.md`](docs/EMAIL.md) | Transactional email: templates, the outbox, the drain, Resend |
| [`docs/ANALYTICS.md`](docs/ANALYTICS.md) | GA4, PostHog and Sentry: what is sent, what never is, and how they load |
| [`docs/TESTING.md`](docs/TESTING.md) | Unit and component tests, the `verify:*` harnesses, E2E, and the gate before a commit |
| [`docs/REVIEW_1_ARCHITECTURE.md`](docs/REVIEW_1_ARCHITECTURE.md) · [`REVIEW_2`](docs/REVIEW_2_UX_ACCESSIBILITY.md) · [`REVIEW_3`](docs/REVIEW_3_PRODUCTION_READINESS.md) | Phase 36's three review passes |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Connection rules, the migration workflow and its commit policy, the production and rollback procedures, and the schema conventions |

## Canonical specification

The project is defined by six synchronized documents in the repository root. They are the
specification; this codebase is their implementation.

```
NORTH01_Claude_Implementation_Plan_Current_OnlineOnly.md   ← build order, architecture, gates
NORTH01_Visual_Guide_OnlineOnly.md                         ← visual source of truth
NORTH01_Visual_Reference_OnlineOnly.png                    ← directional visual reference
01_NORTH01_Tech_Stack_Current_OnlineOnly.md                ← approved technologies
02_NORTH01_Features_and_Tech_Implementation_Current_OnlineOnly.md  ← feature → technology map
03_NORTH01_Website_Structure_and_User_Flow_Current_OnlineOnly.md   ← navigation and user flow
```

What was actually decided, and where the build departs from those documents, is
`NORTH01_Implementation_Notes_and_Deviations.md`, which overrides all of them. When a material
decision changes, update the affected documents and re-run the consistency audit.

## Status

**Phases 1–35 are complete. Phase 36 (final review and documentation audit) is in progress.** Next.js
16.3.3 with Payload 3.88.0 embedded, on Neon PostgreSQL 17. Each phase's record is in the notes
(§1.7–§1.40 and the append log). Every departure from the specification is a DEV entry in the notes'
Section 2, and every specification gap is a G entry in `docs/ARCHITECTURE.md` §3.2.

**What works:**

- **Catalogue and discovery.** `pnpm seed` builds 28 products across ten categories, with
  collections, Edits, a lookbook, the Journal, demo customers, orders and reviews. Filtering, sorting
  and search go through Algolia, and browsing falls back to Postgres when search is down.
- **Product, bag and checkout.** Variant selection re-checked on the server, a bag drawer, discount
  codes and shipping rates. Checkout is hosted Stripe Checkout, and only a signature-verified webhook
  marks an order paid.
- **After the sale.** An order state machine with carrier and tracking, customer accounts (orders,
  addresses, wishlist), moderated reviews, and eight transactional email templates.
- **Editorial and help.** The CMS-driven homepage, shop the look, collection, Edit and Journal pages,
  and `/help/faq`, `/help/shipping` and `/help/returns`.
- **Operations.** SEO metadata, sitemap and structured data. Analytics, Sentry and Turnstile each run
  only when configured, and never block a purchase.
- **Tests.** Vitest unit and component suites and twenty-two `verify:*` harnesses. The Playwright E2E
  suite first ran in Phase 35: 43 passed, 0 failed, 14 skipped
  ([`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)).

**Recorded as not built:** a contact form (G-08), privacy and terms pages (G-19), online returns
(G-20), a public order-tracking lookup (DEV-77), Quick View and Quick Add (DEV-76), and Buy Now
(DEV-78). Every storefront page renders per request rather than from a cache (DEV-83).

**Needs the owner:** as of the Phase 35 audit, no environment has Stripe keys, Resend is not
configured, and production search has no index. The canonical host, Preview, the function region and
the legal text are also owner decisions. The checklist is [`TODO.md`](TODO.md).

Local setup: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
