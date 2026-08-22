# NORTH / 01 — Features and Exact Technology Implementation

> **Purpose:** This is the feature-to-technology cross-reference. It must remain consistent with `01_NORTH01_Tech_Stack_Current_OnlineOnly.md` and `03_NORTH01_Website_Structure_and_User_Flow_Current_OnlineOnly.md`.
>
> **Rule:** The user experience should stay simple even when the implementation is sophisticated.

> **Business model constraint — ONLINE-ONLY DTC APPAREL**
>
> NORTH / 01 is an online-only direct-to-consumer apparel brand. There is no physical retail location and no in-store purchasing workflow. All product discovery, customer service, checkout, payment, fulfillment, delivery, returns, and account activity are designed for remote online customers.
>
> **Explicitly out of scope:** physical store pages, store locator, store hours, POS, in-store checkout, buy-online-pickup-in-store, curbside pickup, store inventory, retail staff checkout workflows, in-store returns, and physical-location appointment flows.
>
> **Fulfillment model:** inventory represents centralized online fulfillment stock. Orders are paid online, fulfilled remotely, shipped to the customer, tracked, and returned through an online-first process.

## 0. Feature Implementation Rules

1. PostgreSQL/Payload is the application source of truth.
2. Stripe is authoritative for payment events.
3. The browser never becomes authoritative for price, inventory, discount validity, tax, shipping cost, order total, or payment success.
4. Algolia is a derived index and may be rebuilt.
5. Cloudinary is media delivery; Payload stores media metadata/relationships.
6. Resend is external delivery; order records do not depend on email success.
7. Analytics, Sentry, and Speed Insights never block customer actions.
8. Every major feature needs loading, empty, error, and unavailable states where applicable.
9. Optional third-party services must fail gracefully.
10. UI implementation must conform to `NORTH01_Visual_Guide_OnlineOnly.md` and `NORTH01_Visual_Reference_OnlineOnly.png`.

### Online-only exclusions

Never implement or imply physical retail functionality, including store locator, store hours, POS, in-store checkout, BOPIS/curbside pickup, store-level inventory, retail employee checkout, or in-store returns. Product availability is centralized online fulfillment inventory.


# 1. Global Site Shell

### Header / Navigation
**Uses:** Next.js App Router, Tailwind CSS, Radix UI, Motion, Lucide, Payload navigation/site settings.

- Desktop navigation.
- Mobile navigation drawer.
- Sticky/scroll-aware presentation.
- Search entry.
- Account entry.
- Wishlist entry.
- Bag/cart entry.
- Mega menu content driven from Payload.
- Active-state styling.
- Responsive collapse.

**Edge cases**
- Missing navigation item.
- Unpublished collection.
- Broken internal route.
- Keyboard navigation.
- Reduced-motion preference.

### Footer
**Uses:** Next.js, Tailwind, Payload site settings, Resend/newsletter flow, Lucide.

- Shop links.
- Help links.
- About/social links.
- Legal links.
- Newsletter area.
- Responsive columns.

# 2. Search

**Uses:** Algolia + Next.js server/client boundary + nuqs + Payload data synchronization.

### Search overlay
- Open/close.
- Keyboard focus.
- Recent/popular searches.
- Suggested categories/products.

### Live results
- Product suggestions.
- Category suggestions.
- Typo tolerance via Algolia.
- Loading state.
- Empty state.

### Full results
- Query preserved in URL.
- Filters and sorting preserved in URL.
- Result count.
- Pagination/infinite loading as chosen by design.

**Failure behavior**
- Algolia unavailable: show controlled search-unavailable/error state while preserving browse/category navigation.
- Empty results: related categories and curated products if available.
- Deleted/unpublished product indexed stale: product fetch validates current publish state before display.

# 3. Homepage

**Uses:** Next.js, Payload content blocks, Cloudinary, Motion, Tailwind, analytics event layer.

Sections:
- Campaign hero.
- Featured categories.
- New arrivals.
- Editorial campaign.
- Limited edition.
- Best sellers.
- Brand story.
- Social/community gallery.
- Newsletter.

**Edge cases**
- Missing hero image.
- Empty section.
- Unpublished section.
- Invalid product relationship.
- Slow media.
- Mobile-specific crop.

The homepage is a visual/editorial composition, not a feature dashboard.

# 4. Shop / Catalog

**Uses:** Next.js server rendering/data fetch, Payload/Postgres, Tailwind, nuqs, Algolia where search facets are required.

- Shop landing.
- Product grid.
- Product count.
- Sort.
- Filter.
- Product-card states.

**Product card uses**
- Cloudinary/Next image pipeline.
- Payload product data.
- Wishlist/account state.
- Motion hover states.
- Add-to-cart service.

**Edge cases**
- Unpublished product.
- Missing image.
- Sold-out product.
- Invalid price.
- Product deleted during browsing.

# 5. Filtering and Sorting

**Uses:** nuqs for URL state; Payload/Postgres or Algolia facets as appropriate.

Filters:
- Category.
- Collection.
- Size.
- Color.
- Price.
- Availability.
- Other product attributes where the data model supports them.

Sorting:
- Featured.
- Newest.
- Best selling.
- Price low-high.
- Price high-low.
- Rating where enough real review data exists.

**Rules**
- URL is shareable.
- Browser back/forward restores state.
- Invalid filter values are ignored safely.
- Empty filter results are a designed state.

# 6. Quick View / Quick Add

**Uses:** Radix Dialog, Tailwind, Motion, Payload product data, cart service, Cloudinary, wishlist state.

Quick View:
- Primary media.
- Product name.
- Price.
- Variants.
- Availability.
- Add to cart.
- Wishlist.
- Link to full product.

Quick Add:
- If one unambiguous variant exists, add directly.
- If variant choice is required, open compact selector instead of silently guessing.

# 7. Product Detail Page

**Uses:** Next.js dynamic route, Payload/Postgres, Cloudinary, Motion, React Hook Form where appropriate, Zod, cart service, analytics.

Includes:
- Gallery.
- Product title.
- Price.
- Reviews.
- Color.
- Size.
- Quantity.
- Add to bag.
- Buy now.
- Product details.
- Size guide.
- Shipping/returns information.
- Recommendations.
- Shop the Look/community links.

**Edge cases**
- Product unpublished while page is open.
- Selected variant becomes unavailable.
- Invalid variant query.
- Missing media.
- Price changes before add-to-cart.
- Product is sold out.
- Review content pending moderation.

# 8. Size Guide

**Uses:** Payload structured content + Radix Dialog/Drawer + Tailwind.

- Measurement tables.
- Fit notes.
- Model info.
- Mobile drawer.
- Accessible dialog.

# 9. Reviews

**Uses:** Payload/Postgres, auth, Zod, React Hook Form, Turnstile when enabled, admin moderation.

- Rating summary.
- Star distribution.
- Review list.
- Review images where supported.
- Verified-purchase indicator based on order history.
- Moderation state.

**Edge cases**
- Duplicate review attempt.
- Review for non-owned product.
- Order not delivered yet.
- Profanity/abuse moderation.
- Product archived.
- Review removed after publication.

# 10. Recommendations

**Uses:** Application-level recommendation rules backed by Payload/Postgres; Algolia can assist discovery; analytics provide behavioral signals.

Recommendation types:
- You May Also Like.
- Complete the Look.
- Recently Viewed.
- Trending.
- Related collection.

Start deterministic and understandable. Do not build an opaque ML recommendation system for the demo.

**Fallback**
- Same collection.
- Same category.
- Best sellers.
- New arrivals.

# 11. Shop the Look

**Uses:** Payload relational content, Cloudinary, Next.js, Motion, cart service.

- Editorial image.
- Product hotspots.
- Product preview.
- Add individual item.
- Add entire look.

**Edge cases**
- Product unpublished.
- Product sold out.
- Variant unavailable.
- Hotspot missing coordinates.
- Image missing.
- Entire look contains unavailable item.

Never create an invalid "add entire look" operation. Explain unavailable items and allow the available subset to be added explicitly.

# 12. Collections

**Uses:** Payload/Postgres, Cloudinary, Next.js dynamic routes, Tailwind.

- Hero.
- Editorial introduction.
- Curated product ordering.
- Product sections.
- Related collections.

**Edge cases**
- Empty collection.
- Unpublished products.
- Scheduled/past campaign.
- Broken media reference.

# 13. Edit / Intent-Based Shopping

**Uses:** Payload editorial blocks + product relations, Next.js, Cloudinary.

Examples:
- Weekend.
- Travel.
- Everyday.
- Essentials.
- Gifts.
- Seasonal.

The "Edit" category should remain curated and finite. It should not become a second complicated navigation system.

# 14. Lookbook

**Uses:** Payload, Cloudinary, Next.js, Motion.

- Index/chapter structure.
- Full-bleed imagery.
- Editorial typography.
- Product references.
- Shop-the-look relationships.

# 15. Journal

**Uses:** Payload rich text/editorial content, Cloudinary, Next.js metadata.

- Article listing.
- Article pages.
- Related products.
- Related stories.
- Publish/unpublish.

# 16. Wishlist

**Uses:** Payload/Postgres for authenticated records; secure guest-storage mechanism for anonymous users; React state; analytics.

### Guest
- Persist locally/securely without requiring an account.
- On sign-in, merge into account wishlist.

### Authenticated
- Persist server-side.
- Remove.
- Move to cart.

**Edge cases**
- Product deleted.
- Variant unavailable.
- Duplicate merge.
- Login on multiple devices.

# 17. Cart

**Uses:** Payload/Postgres cart model, server-side cart service, React state for presentation, Zod for mutation validation.

### Guest cart
- Anonymous cart identifier.
- Persisted cart data in approved server-side storage/database architecture.
- No trust in client totals.

### Authenticated cart
- Linked to customer.
- Server persisted.

### Merge
Guest cart + account cart merge on login.

Collision rules:
- Same variant → combine quantities within available stock.
- Different variants → keep as separate lines.
- Invalid/deleted variant → remove with explanation.

### Cart mutations
- Add.
- Update quantity.
- Remove.
- Clear.

### Totals
Server calculates:
- Subtotal.
- Discount.
- Shipping.
- Tax.
- Total.

**Never accept totals calculated only by the browser.**

# 18. Promotions / Discounts

**Uses:** Payload/Postgres promotion records + server-side promotion service + Zod.

Potential types:
- Percentage.
- Fixed amount.
- Free shipping.
- Minimum subtotal.
- Collection/product scoped.
- Start/end date.
- Usage limit.

**Validation**
- Active.
- Not expired.
- Eligible customer if rules support it.
- Eligible products.
- Minimum subtotal.
- Remaining usage.
- Not combinable with conflicting discount.

**Edge cases**
- Code becomes invalid between cart and checkout.
- Discounted item removed.
- Order total changes.
- Promotion expires while checkout is open.

Recalculate server-side at checkout.

# 19. Shipping and Tax

## Shipping
**Uses:** Internal shipping service/adapter + Postgres configuration.

For the demo:
- Configure a small set of static/rule-based methods.
- Example: Standard, Express, Overnight.
- No external shipping SaaS required.

Future adapter boundary may support Shippo/EasyPost/ShipStation, but these are out of scope for the demo.

## Tax
**Uses:** Stripe Tax where enabled/configured, otherwise explicit demo tax configuration if the environment cannot use Stripe Tax.

**Edge cases**
- Unsupported destination.
- Shipping method unavailable.
- Address changes.
- Tax changes after address update.
- Checkout amount recalculated.

# 20. Checkout / Stripe

**Uses:** Stripe Checkout or Payment Element according to final UX choice, server-side Stripe SDK, Stripe webhooks, Postgres/Payload order records, Zod.

Flow:
1. Validate cart server-side.
2. Recalculate price/discount/shipping/tax.
3. Verify inventory.
4. Create checkout session.
5. Store checkout/session linkage.
6. Redirect to Stripe or embedded payment.
7. Receive webhook.
8. Idempotently finalize payment/order state.
9. Send confirmation.

### Required protections
- Idempotency keys.
- Duplicate webhook handling.
- Signature verification.
- Server-side amount validation.
- No fulfillment from success-page navigation alone.

### Edge cases
- Checkout session expires.
- Customer cancels.
- Payment fails.
- Payment succeeds and user closes browser.
- User refreshes success page.
- Duplicate webhook delivery.
- Webhook arrives out of order.
- Inventory changes between session creation and payment.
- Price changes.
- Promotion expires.
- Tax/shipping changes.
- Stripe temporarily unavailable.

# 21. Orders

**Uses:** Payload/Postgres, Stripe webhook events, Resend.

Order stores historical snapshots:
- Product name.
- Variant.
- Unit price.
- Quantity.
- Discount.
- Shipping.
- Tax.
- Total.
- Customer information.
- Shipping address.
- Payment status.
- Fulfillment status.
- Tracking information.

Do not rely on the current product record to reconstruct a historical order.

# 22. Customer Accounts

**Uses:** Payload Auth + Postgres + Next.js protected routes.

- Register.
- Login.
- Logout.
- Password reset.
- Dashboard.
- Orders.
- Addresses.
- Profile.
- Wishlist.

**Security**
Customers can only read/write their own allowed data.
Admin/editor roles are separate.

# 23. Order Tracking

**Uses:** Order data in Postgres, tracking fields, optional future carrier adapter.

Demo:
- Manual/admin-updated order status.
- Tracking number/link fields.

Do not introduce a real carrier integration until required.

# 24. Email

**Uses:** Resend + React Email + Postgres order/customer records.

Templates:
- Welcome.
- Email verification.
- Password reset.
- Order confirmation.
- Order shipped.
- Order delivered.
- Order cancelled.
- Refund processed.
- Contact confirmation.
- Optional back-in-stock.

### Edge cases
- Delivery failure.
- Duplicate trigger.
- Webhook retries.
- Missing recipient.
- Unverified domain.

Email failure must not roll back a successful order.

# 25. Admin / CMS

**Uses:** Payload Admin + Payload access control + Postgres + Cloudinary.

Manage:
- Products.
- Product variants.
- Inventory.
- Collections.
- Edits.
- Campaigns.
- Lookbooks.
- Journal.
- Homepage content.
- FAQs.
- Reviews.
- Orders.
- Customers.
- Promotions.
- Media.

Admin must prevent malformed commerce records through validation and access rules.

# 26. Analytics

**Uses:** internal event layer + PostHog + GA4.

Events:
- view_item_list.
- select_item.
- view_item.
- add_to_cart.
- remove_from_cart.
- add_to_wishlist.
- remove_from_wishlist.
- begin_checkout.
- add_payment_info.
- purchase.
- search_submitted.
- filter_applied.
- sort_changed.
- quick_view_opened.
- shop_the_look_opened.
- newsletter_signup.

Analytics must be fire-and-forget and non-blocking.

# 27. Error Monitoring

**Uses:** Sentry + Vercel Speed Insights.

Capture:
- Unexpected client errors.
- Server errors.
- Checkout failures.
- Integration failures.
- Performance diagnostics.

Never log:
- Card data.
- CVC.
- Authentication secrets.
- Raw passwords.
- Unnecessary sensitive personal data.

# 28. Bot Protection

**Uses:** Cloudflare Turnstile.

Use on public abuse-prone forms:
- Contact.
- Newsletter.
- Review submission.
- Registration/login if necessary.

Server validates the Turnstile token.

# 29. SEO

**Uses:** Next.js metadata APIs, Payload content, JSON-LD.

- Titles.
- Descriptions.
- Canonicals.
- Open Graph.
- Product structured data.
- Sitemap.
- Robots.
- Clean URLs.

# 30. Accessibility

**Uses:** Semantic HTML, Radix primitives, Tailwind, Playwright + axe-core.

Require:
- Keyboard navigation.
- Visible focus.
- Accessible names.
- Proper headings.
- Form labels/errors.
- Reduced-motion support.
- Contrast.
- Screen-reader behavior.

# 31. Performance

**Uses:** Next.js rendering/cache, Cloudinary/Next image pipeline, Vercel, Speed Insights.

- Optimize hero/LCP media.
- Lazy-load below fold media.
- Avoid unnecessary client components.
- Prevent layout shift.
- Keep third-party scripts non-blocking.
- Test mobile performance.

# 32. Testing

**Uses:** Vitest, React Testing Library, Playwright, axe-core, GitHub Actions.

Test:
- Domain logic.
- Components.
- Core shopping journeys.
- Payment/webhook flow.
- Guest/auth cart merge.
- Error states.
- Mobile navigation.
- Accessibility.

# 33. Design System / Storybook

**Uses:** Storybook + Tailwind + Radix + Motion.

Document:
- Buttons.
- Inputs.
- Product card.
- Product gallery.
- Variant selector.
- Drawer.
- Dialog.
- Toast.
- Tabs/accordion.
- Typography styles.
- Spacing tokens.

Every reusable component should conform to the visual guide.

# 34. Deployment

**Uses:** Vercel + GitHub + GitHub Actions + Cloudflare DNS.

- PR preview.
- Production deployment.
- Environment variables.
- Custom domain.
- HTTPS.
- Logs/monitoring.
- Database migrations.

## 35. Source-of-Truth Summary

- Visual source of truth: `NORTH01_Visual_Guide_OnlineOnly.md`.
- Overall visual reference: `NORTH01_Visual_Reference_OnlineOnly.png`.
- Architecture/build-order source: `NORTH01_Claude_Implementation_Plan_Current.md`.
- Stack source: this document.
- Feature source: this document + canonical implementation plan.
- User-facing structure: `03_NORTH01_Website_Structure_and_User_Flow_Current_OnlineOnly.md`.
