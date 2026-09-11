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
| [`docs/SECURITY.md`](docs/SECURITY.md) | What personal data the shop collects, who can see it, where it goes, how long it is kept, what is kept out of logs, and the security headers |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Vercel environments, the migration procedure, the production search index, the scheduled drain, rollback, and the post-deployment smoke test |
| [`docs/SEARCH.md`](docs/SEARCH.md) | The Algolia index, what it holds, and how it is rebuilt |
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
twenty-two collections and two globals across seventy-three tables — products and variants, the
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

**Phase 7 — Access control and authentication: complete.** Every collection and both globals now
state a rule instead of inheriting Payload's "is there a session?", three roles exist, and a shopper
can create an account, sign in, sign out and recover a forgotten password.

- **Three roles, two homes.** Editor and Admin are `users.role`; Customer is its own auth collection,
  which is what makes "a customer cannot reach the admin panel" structural rather than enforced.
  Editors get the catalogue and the editorial collections; deletions, staff accounts, promotions and
  the commerce settings are the admin's.
- **A customer can only ever see their own.** Ownership rules narrow the query rather than refusing
  it, so another customer's order is not *forbidden* — it does not exist. The same rule governs
  reading, updating and deleting, and a row created while naming somebody else's account is forced
  back to its creator.
- **Published means public.** Draft products, collections and articles are invisible to everyone
  without a CMS session — including the variants beneath a draft product, which is where the SKUs,
  prices and stock counts live.
- **Routes are protected three times**: a cheap redirect before rendering, a real check in the page,
  and the access rules underneath every query. Only the last two are checks.
- **Password reset works today**, eleven phases before email exists — real tokens, one-hour expiry,
  single use — with the message written to the server log until Resend arrives in Phase 19. It says
  so loudly rather than pretending.

`pnpm verify:access` runs the whole matrix — cross-customer reads, role escalation, ownership,
disabled accounts, the password policy — against the live rules.

The account area is a protected shell showing a profile and a sign-out; order history, wishlist and
the address book arrive with the account screens in Phase 20.

**Phase 8 — Media and Cloudinary: complete.** Payload holds the metadata; Cloudinary holds the bytes
and performs every crop and resize — at delivery, from a URL, rather than as derivatives frozen in at
upload time.

- **One stored original, eight delivery contexts.** A hero, a mobile hero, a product card, a gallery
  frame, an uncropped zoom, an editorial image, a thumbnail and a social card, composed as Cloudinary
  URL transformations. Changing a breakpoint is a code change, not a re-upload of the library.
- **Nothing shifts, ever.** The box an image occupies comes from the page, not from the picture, so it
  is reserved before it is known whether an asset exists, whether its bytes arrive, or whether the CDN
  returns a 404. Measured in a browser across all of those: **CLS 0.0000**.
- **Uploads are inspected, not trusted.** The bytes are sniffed rather than the filename believed. A
  shell script named `.jpg`, an executable named `.png`, an SVG carrying a `<script>` and a
  GIF/executable polyglot are each refused — and each refusal is proved against a real hostile file.
- **No secret reaches the browser.** A Cloudinary delivery URL is pure string concatenation, so the
  code that builds them has no imports at all and the SDK is confined to one server file.

**It runs with no Cloudinary account.** Uploads fall back to local disk and every image renders as its
deliberate placeholder — which, with a catalogue that has no assets yet, is what the whole storefront
does today. `pnpm verify:media` proves 48 assertions without credentials and arms a live
upload/derive/delete round trip the moment they are set — 61 in total, all passing against a real
account.

**Phase 9 — Storefront shell: complete.** The header, mega menu, mobile drawer, footer, search
overlay and bag drawer are mounted on every storefront route and driven by the CMS.

- **The navigation is content.** Six primary destinations, their mega-menu columns, a featured panel
  and the footer columns all come from the `navigation` global; saving it drops the cached shell, so
  an edit reaches the storefront within a request or two — no deployment, no waiting on a timer. The
  round trip is measured, not assumed: read one serves the old value, read two the new, which is
  stale-while-revalidate doing its job.
- **A link that cannot work is not rendered.** An item whose target is unpublished, scheduled for a
  future date, deleted, or in a collection with no public page is dropped from the menu — never drawn
  as a dead or disabled control.
- **One overlay at a time, by construction.** Search, the mobile menu and the bag share a single piece
  of state, so a second open overlay is unrepresentable rather than merely avoided.
- **The bag drawer says the bag is empty, because it is.** Nothing in the application can add a line
  to one until Phase 14, so there are no quantity steppers, no subtotal and no checkout button
  standing in for behaviour that does not exist.
- **Search opens and closes; it does not pretend to search.** The overlay, its focus handling and its
  close behaviour are built and verified. Phase 12 fills the panel with Algolia; until then it says so
  and offers the browse routes instead of an input that swallows a query.

`pnpm verify:shell` proves 100 assertions, including the publication cases against real Payload
documents. 49 browser checks at desktop and phone widths, **0 axe-core violations**.

A post-implementation audit followed and found four defects, the first a live **open redirect** in the
sign-in flow: `/login?next=/%09/evil.example` sent a customer to another domain immediately after they
typed their password, because a browser strips the tab and resolves `//evil.example`. One rule had been
copied into four files and all four had the hole. See notes §1.14.13.

**Phase 10 — Homepage / editorial system: complete.** The homepage is a composition an editor
arranges, not a page a developer wrote.

- **Eleven typed, reorderable block types**, held in a `homepage` global. Five of them are the
  editorial blocks Phase 6 already shipped for collection and Edit pages, imported unchanged — a
  brand story and an editorial split are the same shape, and the difference between them is what an
  editor writes, not what the schema holds.
- **Product rails are a query, and product groups are a curation.** "New arrivals" stays true without
  anyone re-dragging it; a curated group keeps the order a merchandiser chose. Both render through
  one component.
- **Every section that cannot work is dropped, never disabled.** A hero whose campaign is a draft, a
  tile pointing at an unpublished category, a rail whose query came back empty, a product with no
  purchasable price — all removed. An empty homepage is a state the page renders without complaint.
- **One image is prioritised, and it is chosen by content rather than position.** The largest
  contentful paint follows the first section that actually has a picture, so a page opening with a
  promise strip does not waste the hint. Everything else lazy-loads, and every image reserves its box
  before a byte arrives.
- **The motion is two CSS declarations.** The animation library this phase was expected to install was
  measured and declined: it defaults to ignoring `prefers-reduced-motion` for opacity, and animates
  through an API that cannot read the duration tokens the rest of the system honours.
- **The newsletter works.** It records an address, a consent timestamp and a source. The welcome mail
  is Phase 19's, and nothing on the page pretends otherwise.

`pnpm verify:home` proves 173 assertions, including the publication cases against real Payload
documents and that no generated database identifier has been silently truncated. 55 browser checks
across eight viewport widths, **0 axe-core violations**.

A post-implementation audit followed and found 36 defects that had passed every gate — including a
security hole this phase's own decision claimed to have closed. Lexical has *two* link node types,
and the rich-text sanitiser overrode one of them: an `autolink`, which the editor creates the moment
someone types something URL-shaped, rendered its stored URL unvalidated. All 36 are fixed, and nine
of them were comments asserting something the code did not do. See notes §1.15.12.

Two more were found by measuring rather than reading *during* the phase. The editorial reveal stranded
six sections permanently invisible if you jumped to the foot of the page — an `IntersectionObserver`
reports threshold *crossings*, and a section that skips past the viewport in one scroll never fires
one. And a **Phase 7** defect: `z.email().trim()` validates the untrimmed input, so pasting an
address with a leading space was rejected on the sign-in, registration and reset forms — the exact
case the code's own comment said the trim existed to handle. See notes §1.15.6 and §1.15.7.

The catalogue is still Phase 11's, so most destinations on that page return a 404 — a styled one,
inside the shell, with a way back.

Local setup: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the phase gate and what comes next.
