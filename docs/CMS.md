# The admin — Payload CMS

Plan §6, §28 and §38. What the owner and editors can change at `/admin`, what the admin will refuse,
and what happens on the storefront after a save. Written from the code (2026-09-11):
`src/payload.config.ts`, `src/payload/collections/`, `src/payload/globals/`, `src/payload/access/`.
The schema itself is in [`DATABASE.md`](DATABASE.md); the search index in [`SEARCH.md`](SEARCH.md);
who can see personal data in [`SECURITY.md`](SECURITY.md) §2; the outbox in [`EMAIL.md`](EMAIL.md).

## 1. Who can do what

Staff sign in at `/admin` as **`users`**. Customers are a separate `customers` collection and cannot
sign in to the admin (**D-21**).

| Role (`users.role`) | Can |
|---|---|
| `editor` (default) | create and edit catalogue, editorial and content documents; edit the three globals except admin-only fields; moderate reviews; update order fulfilment and tracking; read customers, orders, bags, newsletter, email outbox, Stripe events. Sees and edits only their own user row |
| `admin` | everything an editor can, plus: **delete** any document, create staff users and change roles, admin-only settings (§3), order address snapshots |

- The first user created on an empty database becomes `admin` (`Users.ts`). After that only an admin
  creates users; an admin cannot delete themselves.
- Access helpers (`src/payload/access/index.ts`): `anyone`, `nobody` (server writes only — admins
  included), `isStaff`, `isAdmin`, `publishedOnly` / `publishedOn(path)` (public sees `published`,
  staff see all), `ownedByCustomer`, `isActiveCustomer`, `verifiedPublicWrite` (staff, or a request
  that passed Turnstile), and field-level `isStaffField`, `isAdminField`, `nobodyField`.
- Payload's internal `payload-locked-documents` and `payload-preferences` are staff-only
  (`access/internal-collections.ts`, audit R1-18).
- GraphQL is not exposed (**DEV-04**); only the REST routes under `/api/`.

## 2. Collections

**Delete is admin-only on every content collection.** Products, customers and orders go to the trash
first (`trash: true`), recoverable by an admin.

| Admin group | Collection | What it is |
|---|---|---|
| Catalogue | **Products** | The merchandising record: name, description, media, categories, collections, size guide, SEO. Price, SKU and stock are on variants. The `derived` group (price range, compare-at, total stock) is written by the server |
| | **Product variants** | The unit a customer buys: SKU, colour, size, `priceMinor`, `compareAtPriceMinor`, `inventoryQuantity`, `active`, image, parcel dimensions. Stock cannot go below zero (database check) |
| | **Categories** | Shop taxonomy. Has `status`; a draft parent does not hide its children |
| | **Size guides** | Measurement tables |
| Editorial | **Collections** | A merchandising page with editorial blocks, at `/collections/<slug>` |
| | **Edits** | Themed product groups and lookbooks, at `/edit/<slug>` |
| | **Campaigns** | The homepage hero's content (season, desktop and mobile hero, story, calls to action). No page of its own (**DEV-39**) |
| | **Lookbooks** | Chaptered editorial with shoppable hotspots, at `/lookbook/<slug>` (§6) |
| | **Journal** | Articles, at `/journal/<slug>` |
| Content | **FAQs** | Question, answer, topic, order; shown at `/help/faq` |
| | **Media** | Every image and video (§4) |
| Commerce | **Orders**, **Order items** | §8 |
| | **Promotions** | Discount codes (§7) |
| | **Carts**, **Cart items** | Bags — read-only in practice |
| Customers | **Customers**, **Addresses**, **Wishlist items**, **Reviews**, **Newsletter subscribers** | Reviews are moderated (§5). An account is disabled by setting `accountStatus`, which also signs it out |
| System | **Users**, **Stripe events**, **Email messages** | Stripe events and email messages cannot be created or edited by anyone; they are the server's record |

Rich text is Lexical, limited to paragraphs, h2/h3, bold, italic, links, lists and quotes. There are no
styling controls: typography and colour belong to the design system (**D-11**). No live preview and no
custom admin components.

## 3. Globals

| Global | Group | Contains |
|---|---|---|
| **Site settings** | Settings | Site name, logo, tagline, contact email and phone, popular searches, shipping and returns policy text, default SEO title, description and share image, the announcement bar. **Admin only:** currency, locale, free-shipping threshold, low-stock threshold, maximum quantity per line |
| **Navigation** | Settings | Primary menu, footer columns, social links (§6) |
| **Homepage** | Editorial | The homepage's sections (§6) |

`contactEmail` is the reply-to on every order email; an address on a reserved domain such as
`.example` is ignored ([`EMAIL.md`](EMAIL.md) §7).

## 4. Publishing

**There are no Payload drafts, versions or scheduled publish jobs** in any collection or global. Each
publishable document has:

- **`status`** — `draft` (default) or `published`. Only `published` is public; staff see both.
- **`publishedAt`** — filled in automatically the first time a document is published; a date you type
  wins. A **future** date means:
  - **products**: not visible anywhere until that time — a scheduled drop;
  - **collections, edits, lookbooks, journal**: the page is already live at its URL, but kept out of
    menus and the homepage until then. On `/lookbook`, a future-dated lookbook is pinned to the top.

Categories and FAQs have `status` but no `publishedAt`. The helpers are in
`src/payload/fields/seo.ts` (`publishingFields`).

A product **cannot be published** without at least one active, priced variant
(`refuseUnsellablePublish`), and a variant cannot show a compare-at price that is not higher than its
price (`refuseFakeSale`).

## 5. Media — `Media.ts`, `src/lib/media/limits.ts`

| Rule | Value | Why |
|---|---|---|
| Maximum file size | **4 MB** (`MAX_UPLOAD_BYTES`) | Uploads pass through a Vercel Function on their way to Cloudinary, and Vercel rejects a request body over 4.5 MB. Larger files used to fail only in production (audit R3-16). Message: *"That file is larger than the 4 MB upload limit. Export it at a lower quality, or resize it, and try again."* |
| Maximum dimensions | 12,000 px per side | Decompression bombs |
| Formats | JPEG, PNG, WebP, AVIF, MP4, WebM | SVG and GIF are refused (**DEV-35**) |
| Alt text | required | Accessibility |
| `role` | Product, Campaign, Editorial or Logo mark | Sets the default crop shape |
| Crop | set the **focal point**; there is no crop tool | Cloudinary crops around the focal point per context (**DEV-33**, **DEV-34**) |

Files are stored in Cloudinary when it is configured (**DEV-05**, `src/payload/storage/cloudinary.ts`),
otherwise in `/media` locally. **Development and production share one Cloudinary cloud**: deleting a
media document deletes the file production also shows ([`DEPLOYMENT.md`](DEPLOYMENT.md) §5).

## 6. Navigation, homepage and lookbooks

### Navigation

- **Links to pages that do not exist are dropped** from the rendered menu. An internal URL must match
  `PAGE_ROUTE_PATTERNS` in `src/lib/navigation/routes.ts` (`/shop`, `/shop/*`, `/collections/*`,
  `/edit/*`, `/journal/*`, `/lookbook/*`, `/product/*`, `/help/faq`, `/help/returns`,
  `/help/shipping`, `/search`, account and auth routes, and so on); `resolveLink` in
  `src/lib/navigation/resolve.ts` drops anything else (Phase 35, P35-01). There is no `/about` and no
  `/contact`. The admin accepts the link; the storefront does not show it.
- A link to a document is built from its current slug and disappears if the document is unpublished or
  deleted. A column or mega menu left with no links disappears too.
- Limits: 6 primary items, each with up to 4 columns of 8 links and an optional featured panel; 4
  footer columns; 6 social links, `https://` only. As built the header has five items — **DEV-07** was amended in
  Phase 30 because `/about` has no page, and the field help says so.
- The Privacy/Terms row (`src/lib/navigation/utility.ts`) and the footer newsletter column (**DEV-42**)
  are code, not content.

### Homepage

One ordered `sections` list (`src/payload/globals/Homepage.ts`, `src/payload/blocks/home.ts`,
`src/payload/blocks/editorial.ts`). **A section with nothing to show is left off the page, silently**
— for example a hero whose campaign is a draft or future-dated. The admin's section guide lists the
rules.

| Block | Needs |
|---|---|
| Campaign hero | a published, current campaign |
| Promo strip | 2–4 items |
| Category tiles | 2–6 categories |
| Product rail | source (new, best sellers, limited, featured), 2–12 products |
| Image and text, Image, Editorial text | an image (the first two) |
| Shop the look | an image and 1–8 hotspots |
| Product group | hand-picked products, in drag order |
| Collection feature | a collection |
| Community gallery | 3–8 images (**DEV-82**) |

### Lookbooks and hotspots

A lookbook has chapters: title, **hero image**, text, a gallery of up to 12 images and **up to 8
hotspots**. A hotspot is a product plus its position on the hero image, as percentages, separately for
desktop and mobile, and a light or dark marker (`src/payload/fields/hotspot.ts`).

**Hotspots need a hero image.** Saving a chapter with hotspots and no hero image fails with *"Add a
hero image first — hotspots are positions on it."* (`Lookbooks.ts`, Phase 35, P35-02).

## 7. Reviews and promotions

**Reviews** (`Reviews.ts`) arrive as `pending` from the Turnstile-checked product form, one per
customer per product. Staff set **Approved** or **Rejected**; only approved reviews are public, and
the reviewer's account is never shown. Staff **cannot edit** a review's name, rating, title or body.
Reject rather than delete, which is admin-only. The verified-purchase badge is set by the server from
a paid order (**DEV-69**). No word filter (**DEV-70**); no review photos (**DEV-71**).

**Promotions** (`Promotions.ts`):

| Field | Rule |
|---|---|
| `code` | required, unique, upper-cased, `A–Z 0–9 -`, 2–32 characters |
| `type` | `percentage` (1–100), `fixed` (`valueMinor` + currency) or `free_shipping` |
| `startsAt`, `endsAt` | the end must come after the start |
| `minimumSubtotalMinor`, `eligibleProducts`, `eligibleCollections` | optional conditions |
| `usageLimit`, `perCustomerLimit` | at least 1 when set |
| `active` | off by default — a code does nothing until switched on |
| `timesUsed` | server-written |
| `liveNow` | computed: Live now, Off, Scheduled, Ended, Used up |

One code per order (**DEV-08**); `combinable` exists and is unused. Every code is re-checked on the
server at checkout.

## 8. Orders

Orders are created by checkout and marked paid **only by the signature-verified Stripe webhook**.

| Staff can change | Server-written, read-only |
|---|---|
| `fulfillmentStatus`: unfulfilled → processing → shipped → delivered, or cancelled before dispatch | `paymentStatus`, `orderNumber`, customer, email, cart, every amount, promotion and code, shipping method, Stripe ids, `paidAt`, `refundedAt`, `refundedMinor` |
| `carrier`, `trackingNumber`, `trackingUrl` | `shippedAt`, `deliveredAt` (set by the transition) |
| Shipping and billing address snapshots — **admin only** | order items: every snapshot field and the order link (`freezeOrderLines`) |

`enforceOrderTransitions` (`src/payload/hooks/orderTransitions.ts`, rules in
`src/lib/orders/rules.ts`) refuses illegal moves: `shipped` cannot go back or be cancelled, and
`shipped` needs a carrier **and** a tracking number. **Refunds are made in the Stripe dashboard**;
the webhook records them and emails the customer. There is no refund button in the admin.

Changing an order to `shipped` or `delivered` **queues** the customer email; it is delivered by the
next drain — the next Stripe webhook, the daily cron, or `POST /api/email/drain` from a staff session
([`EMAIL.md`](EMAIL.md) §5).

## 9. What a save triggers

| Saved | Storefront cache (`revalidateTag`) | Search index (Algolia) |
|---|---|---|
| Product (save or delete) | `catalog`, `home` | re-synced (`syncSearchIndex`) |
| Product variant | `syncProductDerived` rewrites the product's derived price and stock, which runs the product's hooks: `catalog`, `home` | re-synced, through the product |
| Category | `catalog`, `shell`, `navigation` | products renamed in the index (`syncTaxonomyRename`) |
| Collection | `catalog` | products re-synced |
| Campaign | `home` | — |
| Site settings | `shell`, `site-settings`, `home` | — |
| Navigation | `shell`, `navigation` | — |
| Homepage | `home` | — |

The helpers are in `src/payload/hooks/revalidateTags.ts`; a failed revalidation logs a warning and the
page refreshes on its own cache lifetime. Edits, lookbooks, journal articles and FAQs have no
revalidation hook. Writes from the command line (seed, scripts) do not reach Algolia: run
`pnpm reindex` ([`SEARCH.md`](SEARCH.md)).

## 10. Common tasks

**Add a product.** Media → upload the images (alt text, role *Product*, focal point). Products →
create: name, slug, description, images, categories. Save as draft. Product variants → one per colour
and size: SKU, price in minor units (`4500` = 45.00), stock, `active`. Back on the product, set
`status: published` — it refuses if no variant is active and priced. Set a future `publishedAt` to
schedule a drop.

**Put a product on sale.** On each variant, set `compareAtPriceMinor` above `priceMinor`. The product
page shows a former price only when every size of a colour is reduced to the same figure.

**Change the homepage.** Homepage → sections: add, reorder or remove blocks, then save. For a new
hero, create and publish a Campaign first, then point the hero block at it.

**Add a menu item.** Navigation → primary → add an item. Link to a document, or a URL that matches a
real page (§6). Save, then check the storefront — a dropped link does not warn in the admin.

**Build a lookbook.** Lookbooks → create, add chapters, give each a hero image **before** adding
hotspots, place hotspots by percentage for desktop and mobile, publish.

**Moderate reviews.** Reviews → filter by *Pending moderation* → open → set Approved or Rejected.

**Create a discount code.** Promotions → code, type, value, dates, limits → switch `active` on.
`liveNow` confirms it is live.

**Ship an order.** Orders → open → enter carrier and tracking number → set fulfilment to
*processing*, then *shipped* → save. The customer's dispatch email is queued (§8).

**Resend failed email.** Email messages → check `error` → fix the cause → wait for the daily cron, or
send `POST /api/email/drain` from a browser tab signed in to the admin (for example
`fetch('/api/email/drain', { method: 'POST' })` in the developer console — the admin has no button for
it). See [`EMAIL.md`](EMAIL.md) §5.

**Add an editor.** Users → create (admin only) → role `editor`.
