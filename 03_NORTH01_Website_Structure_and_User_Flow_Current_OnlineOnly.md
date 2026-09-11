# NORTH / 01 — Website Structure and User Flow

> **Purpose:** This document defines how a user understands, navigates, and moves through the website. It deliberately keeps the UX simpler than the underlying implementation.
>
> Visual presentation is governed by `NORTH01_Visual_Guide_OnlineOnly.md` and `NORTH01_Visual_Reference_OnlineOnly.png`.

> **As built (Phase 36 documentation audit).** The structure below is the original specification. Where the build departs from it, the deviation register (`NORTH01_Implementation_Notes_and_Deviations.md` §2) and the gap register (`docs/ARCHITECTURE.md` §3.2) govern:
>
> - **ABOUT** — withdrawn from the navigation; there is no page (DEV-07, amended in Phase 30).
> - **ORDER TRACKING** — no public lookup. Signed-in customers see tracking in `/account/orders`, and guests get the shipped email (DEV-77).
> - **FAQ / CONTACT / SUPPORT** — `/help/faq`, `/help/shipping` and `/help/returns` exist. Contact does not (G-08, open).
> - **Online return request** — no return-request flow exists (G-20, open).
> - **§6 Quick add / quick view** — withdrawn (DEV-76).
> - **§7 Product page** — no Buy Now (DEV-78). Recommendations are one row with no Complete the Look (DEV-79).
> - **Legal pages** — not published; they wait on legal text (G-19, owner action).

# 1. Overall Experience

NORTH / 01 should feel like a premium apparel brand that happens to have an excellent online store.

The user should never need to understand:
- the CMS,
- collections as a data model,
- search indexes,
- payment providers,
- analytics,
- account architecture.

The visible experience should be simple:

```text
DISCOVER
  ↓
BROWSE
  ↓
EVALUATE
  ↓
ADD TO BAG
  ↓
CHECKOUT
  ↓
ORDER
```

Secondary discovery routes should feed into the same core journey rather than creating separate ecosystems.

# 2. Primary Site Map

```text
HOME
├── SHOP
│   ├── All
│   ├── Clothing
│   ├── Accessories
│   ├── New Arrivals
│   └── Best Sellers
│
├── COLLECTIONS
│   ├── Current Season
│   ├── Essentials
│   ├── Limited
│   └── Archive
│
├── EDIT
│   ├── Weekend
│   ├── Travel
│   ├── Everyday
│   └── Gifts
│
├── LOOKBOOK
│
├── JOURNAL
│
└── ABOUT        (as built: withdrawn, no page — DEV-07, amended in Phase 30)

Global:
SEARCH
ACCOUNT
WISHLIST
BAG
CHECKOUT
ORDER TRACKING
FAQ / CONTACT / SUPPORT
```

## Online-only UX boundary

The user experience assumes a purely online apparel business.

### Always present as online commerce
- Shipping/delivery destination rather than store pickup.
- Online payment rather than in-person payment.
- Online order tracking.
- Online return request/support flow.
- Customer account and order history.
- Remote customer support.

### Never expose
- Store locator.
- Physical retail locations or store hours.
- Buy online, pick up in store.
- Curbside pickup.
- In-store inventory.
- POS or retail checkout.
- Store employee ordering flows.
- In-store returns/exchanges.

### Primary customer journey

Browse → Discover → Product → Variant selection → Bag → Online checkout → Payment → Order confirmation → Remote fulfillment → Shipment tracking → Delivery → Optional online return/support.

## Simplicity rule

Do not expose every content type in the primary navigation.

The top navigation should stay short:

**NEW · SHOP · COLLECTIONS · EDIT · LOOKBOOK · ABOUT**

> *As built:* **NEW · SHOP · COLLECTIONS · EDIT · LOOKBOOK**, five items. ABOUT was withdrawn in Phase 30 because `/about` has no page (DEV-07, as amended).

Journal may live under the editorial/content area or footer unless it becomes a major content channel.

# 3. Header

## Desktop

Left/center:
- Logo.
- Main navigation.

Right:
- Search.
- Wishlist.
- Account.
- Bag.

## Mobile

- Menu.
- Logo.
- Search.
- Bag.

Account and wishlist remain accessible from the mobile navigation.

## Header behavior

- Sticky when appropriate.
- Compact on scroll.
- Never visually overpower content.
- Dark/monochrome.
- Use the visual guide's spacing and typography.

# 4. Homepage Flow

Order:

1. Hero campaign.
2. Featured categories.
3. New arrivals.
4. Editorial / Shop the Look moment.
5. Best sellers or limited edition.
6. Brand story. *(As built: an editorial-split block, DEV-43. There is no About page to link to, DEV-07 as amended.)*
7. Community/social. *(As built: shown only with at least three editorial images, DEV-82.)*
8. Newsletter/footer.

The homepage is not a catalog. Its role is to introduce the brand and provide several clear routes into shopping.

## User intention paths

### A. I know what I want

```text
HOME
→ SEARCH / SHOP
→ PRODUCT
→ BAG
→ CHECKOUT
```

### B. I want to discover

```text
HOME
→ NEW / COLLECTION / EDIT
→ PRODUCT
→ RELATED PRODUCTS
→ BAG
```

### C. I want to experience the brand

```text
HOME
→ CAMPAIGN
→ LOOKBOOK / EDITORIAL
→ SHOP THE LOOK
→ PRODUCT
→ BAG
```

# 5. Shop Flow

```text
SHOP
→ Browse / Filter / Sort
→ Product Grid
→ Product
```

The shop page should stay visually calm.

Controls are secondary. Product imagery is primary.

## Filters

Available through:
- Desktop filter area.
- Mobile filter drawer.

The URL preserves filter state.

# 6. Product Discovery Flow

From product grids:
- Open product.
- Quick view.
- Quick add.
- Wishlist.
- Search result.

All routes should lead to the same canonical product page when the user wants full detail.

# 7. Product Page Flow

Recommended order:

```text
Gallery
↓
Product identity
↓
Price / reviews
↓
Color
↓
Size
↓
Quantity
↓
Add to Bag
↓
Details / Fit / Care / Shipping
↓
Complete the Look
↓
You May Also Like
```

The user should be able to purchase without reading every detail section.

# 8. Shop the Look

```text
Editorial Image
↓
Tap hotspot
↓
Mini product preview
↓
Open product OR add
↓
Return to editorial context
```

For "add entire look":

- Validate every item.
- Identify unavailable items.
- Never silently add unavailable products.

# 9. Collection Flow

```text
COLLECTION
→ Editorial introduction
→ Curated product section
→ Additional visual chapter
→ Curated product section
→ Related collection
```

Collections should feel like campaigns, not category dumps.

# 10. Edit Flow

```text
EDIT
→ Choose intent
→ Editorial introduction
→ Curated products
→ Related intent / collection
```

Keep edits limited enough that the user understands the purpose of each one immediately.

# 11. Lookbook Flow

```text
LOOKBOOK
→ Chapter
→ Full-screen/editorial content
→ Shop a look
→ Product
```

The lookbook is discovery-first but always provides a clear path back to merchandise.

# 12. Search Flow

```text
Search icon
→ Search overlay
→ Type
→ Suggestions
→ Submit
→ Search results
→ Filter/sort
→ Product
```

No-results state:
- Explain clearly.
- Offer category alternatives.
- Offer popular/curated products when available.

# 13. Cart Flow

## Quick cart

```text
Add to Bag
→ Cart drawer
→ Continue Shopping OR View Bag / Checkout
```

Show:
- Items.
- Quantity.
- Price.
- Shipping progress.
- Recommendations.
- Checkout.

## Full cart

```text
Bag
→ Review items
→ Update quantities
→ Apply discount
→ Choose/estimate shipping where supported
→ Checkout
```

## Cart simplicity rule

Do not force the user through unnecessary steps before checkout.

# 14. Checkout Flow

```text
Cart
→ Checkout preflight
→ Customer information
→ Shipping
→ Shipping method
→ Payment
→ Stripe
→ Confirmation
```

The user should see:
- Items.
- Subtotal.
- Discount.
- Shipping.
- Tax.
- Total.

The server rechecks everything before payment.

# 15. Confirmation

```text
Payment complete
→ Confirmation page
→ Order number
→ Summary
→ Delivery estimate
→ Continue Shopping
```

The page should not be the only evidence that an order exists; the webhook-backed order record is authoritative.

# 16. Account Flow

Account is secondary navigation.

```text
Account
├── Overview
├── Orders
├── Wishlist
├── Addresses
└── Profile
```

## Login timing

Do not force account creation before browsing or adding to cart.

A customer can be a guest through most of the shopping journey.

# 17. Wishlist Flow

```text
Product
→ Heart
→ Wishlist

Guest:
local/anonymous wishlist
→ Login
→ Merge into account

Authenticated:
server-persisted wishlist
```

Avoid making wishlist mandatory for purchasing.

# 18. Order Tracking Flow

```text
Track Order
→ Order number / permitted lookup
→ Status
→ Shipment/tracking
```

The demo can use manually managed tracking/status fields.

# 19. Support Flow

Footer and relevant pages expose:

- FAQ.
- Contact.
- Shipping.
- Returns.
- Size guide.

Support content should not interrupt the primary shopping flow.

# 20. Footer

Columns:
- Shop.
- Help.
- About/editorial.
- Newsletter.
- Social/legal.

Keep the footer visually quiet.

# 21. Mobile User Flow

Mobile primary actions:

```text
MENU
SEARCH
BAG
```

Primary shopping flow:

```text
Home
→ Shop/Search
→ Product
→ Variant
→ Add to Bag
→ Cart
→ Checkout
```

Mobile editorial:

```text
Home
→ Lookbook / Edit
→ Shop the Look
→ Product
```

# 22. User Journey Examples

## Journey A — Direct shopper

Customer knows the product type.

```text
Home
→ Search
→ Product
→ Select Size
→ Add to Bag
→ Checkout
→ Confirmation
```

## Journey B — Discovery shopper

```text
Home
→ New Arrivals
→ Product
→ Related Product
→ Add to Bag
→ Checkout
```

## Journey C — Intent shopper

```text
Home
→ Edit
→ Weekend
→ Product
→ Complete the Look
→ Add to Bag
```

## Journey D — Returning customer

```text
Home
→ Account
→ Orders
→ Order Detail
```

Or:

```text
Home
→ Wishlist
→ Product
→ Bag
```

## Journey E — Brand-first visitor

```text
Home
→ Campaign
→ Lookbook
→ Shop the Look
→ Product
```

# 23. Information Hierarchy Rules

Every screen should answer:

1. Where am I?
2. What can I do here?
3. What should I look at first?
4. What is the next obvious action?

Avoid making users decode the interface.

# 24. Final Experience Model

The visible system should be simple:

```text
DISCOVER
   ↓
BROWSE
   ↓
PRODUCT
   ↓
BAG
   ↓
CHECKOUT
   ↓
ORDER
```

Editorial and personalization features should feed into this same path.

The backend may be complex. The customer experience should not be.
