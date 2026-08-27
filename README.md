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
Resend · Tailwind CSS 4 · shadcn/ui + Radix · Motion · Vercel

Payload is embedded **inside** the Next.js application — one deployable, not a separate backend.
Resolved versions and the reasoning behind each pin: [`docs/STACK_VERSIONS.md`](docs/STACK_VERSIONS.md).

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

When a material decision changes, update the affected documents and re-run the consistency audit.

## Status

**Phase 3 — Design system and UI foundation: complete.** The application shell runs against Neon
PostgreSQL 17 — Next.js 16.3.2 with Payload 3.88.0 embedded in the same deployable — and now carries
the design system on top of it: a token layer that makes off-system values fail to compile, two
self-hosted typefaces (Bodoni Moda and Instrument Sans, both SIL OFL 1.1), all eighteen core
primitives on Radix, and the global shell components. `pnpm build`, `pnpm typecheck` and
`pnpm lint --max-warnings 0` pass; axe-core reports **0 violations** at WCAG 2.2 AA on desktop and
mobile.

**[`/design-system`](src/app/(frontend)/design-system) is the specimen sheet** — every primitive in
every state, in the real application rather than a separate workbench.

**Phase 4 — Environment configuration and secret management: complete.** A typed, Zod-validated
environment split across a file boundary: [`src/lib/env.public.ts`](src/lib/env.public.ts) for the
browser-safe values, [`src/lib/env.server.ts`](src/lib/env.server.ts) for everything else — the second
guarded by `server-only`, so importing it from a client component fails the build rather than shipping
a secret in prerendered HTML. A missing
required secret fails the build and fails server startup, with the variable named in the log and never
in a response. Optional integrations warn and degrade rather than taking the store down, and a
half-configured provider is reported instead of failing later at the point of use.

It also closes **D-10**: Drizzle's development schema push is now aimed at one named database rather
than at whatever `DATABASE_URL` happens to point at, so repointing the connection string disarms push
instead of redirecting it. Details: [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

**Phase 5 — Neon Postgres + Payload CMS foundation: complete.** The database foundation the data
model will be built on: a committed initial migration, a deployment build command that applies
pending migrations before the code that needs them (`pnpm build:deploy`), and the schema conventions
Phase 6 inherits — indexes, unique and compound-unique constraints, foreign keys that null rather
than orphan, deliberate nullability, timestamps, and soft delete kept separate from an editorial
archive state. All of it proved against a real database rather than asserted: CRUD through the admin
panel, over REST and through the Local API; migrations applied, rolled back and re-applied; and the
push-built development schema compared against the migration-built one and found identical. Full
workflow: [`docs/DATABASE.md`](docs/DATABASE.md).

**Phase 6 — Payload data model: complete.** The domain model the rest of the build stands on:
twenty-two collections and two globals across seventy-four tables — products and variants, the
taxonomy and size guides, collections, Edits, campaigns, lookbooks with shoppable hotspots and the
Journal, carts and orders with frozen purchase snapshots, promotions, customers, addresses, wishlist,
reviews, FAQs and site settings.

The parts worth knowing without reading the schema:

- **Money is an integer count of minor units**, everywhere, in columns whose names end `Minor`.
  Floats never touch a price.
- **A variant is the purchasable unit.** Products carry no price and no stock; a hook keeps a
  product-level price range and stock count in step for listings that need to sort by them.
- **Orders are snapshots.** Item name, SKU, variant label and unit price are frozen at purchase, and
  editing a product afterwards leaves them alone — measured, not assumed.
- **The bag holds no money at all.** Subtotals, discounts, shipping and tax are recalculated on the
  server from live prices on every read, because a stored total is a stale one.
- **Shoppers and staff are separate auth collections**, so "customers cannot reach the admin panel" is
  a property of the topology rather than a rule that has to keep being enforced.

`pnpm seed` fills it with a representative catalogue — ten products, sixty-five variants, four
collections, four Edits, a campaign, a lookbook and the Journal — and deliberately creates no orders,
customers or media, because those are records of things that happened rather than content. Schema
conventions, migration workflow and the traps found along the way:
[`docs/DATABASE.md`](docs/DATABASE.md).

No storefront *feature* is built yet, and nothing is publicly readable: every collection is
authenticated-only until Phase 7 opens the ones that should be. The shell components exist and are
proved, but they are mounted in Phase 9, alongside the search overlay and cart drawer that make their
controls do something.

Local setup: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the phase gate and what comes next.
