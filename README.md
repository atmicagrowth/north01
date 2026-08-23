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

**Phase 2 — Scaffold the Next.js + Payload application.** The application shell runs: Next.js 16.3.2 with
Payload 3.88.0 embedded in the same deployable, TypeScript strict, ESLint at zero warnings, Prettier, and
Tailwind v4. `pnpm build`, `pnpm typecheck` and `pnpm lint` all pass. No storefront feature is built yet.

Running the Payload admin needs a `DATABASE_URL` — see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the phase gate and what comes next.
