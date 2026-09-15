# Commerce

Plan §38. How money moves through NORTH / 01: the bag, promotions, shipping, tax, checkout, the Stripe
webhook and order state. Written from a trace of the code as it stands after Phase 36 (2026-09-11);
every row names the file that makes it true. When one of those files changes, this document should
change with it.

Related: the data model and the migration rules are in [`DATABASE.md`](DATABASE.md); who may read or
write each collection is in [`SECURITY.md`](SECURITY.md) §2; the order emails are in
[`EMAIL.md`](EMAIL.md); Stripe keys, the webhook endpoint and the cron secret are in
[`DEPLOYMENT.md`](DEPLOYMENT.md) and [`ENVIRONMENT.md`](ENVIRONMENT.md); the layering (pure `rules.ts`
beside a server module that does the I/O) is in [`ARCHITECTURE.md`](ARCHITECTURE.md). Search is not a
commerce path — [`SEARCH.md`](SEARCH.md).

**State today** (`TODO.md` §4, DEV-62): checkout is fully built and has **never taken a payment**. No
environment has Stripe keys. Without them the checkout page renders the bag and declines to start
payment (`isStripeConfigured()`, `app/(frontend)/checkout/page.tsx`), preflight refuses with
`stripeUnconfigured`, and the webhook answers 503.

## 1. The money model

| Rule | Where |
|---|---|
| Every amount is an integer count of **minor units** (`1999` is 19.99), in a column whose name ends `Minor` | **D-20**; `payload/fields/money.ts` (`minorUnits`) |
| Currencies: `USD` (default), `GBP`, `EUR`. One store currency, `site-settings.defaultCurrency`; a bag's currency is fixed when the bag is created, an order's at checkout | `payload/fields/money.ts`, `payload/globals/SiteSettings.ts`, `lib/cart/cart.ts` `resolveCart` |
| Formatting happens once, at render, with `Intl.NumberFormat`; `null` in is `null` out (no price line, never `$0.00`) | `lib/money.ts` `formatMinorUnits` |
| Any amount from a cart, provider or stored row is coerced by `toMinorAmount` (not finite → 0, negative → 0, fractional → floored); quantities by `toWholeCount` | `lib/money.ts` |
| **`null` means unknown, `0` means none** — for discount, shipping, tax and refunded amount | `lib/cart/rules.ts` `cartTotals`, `lib/tax/rules.ts`, `Orders.refundedMinor` |

**Who computes what.** The browser sends variant ids, quantities, a discount code string, an email,
an address and a shipping method **id**. It never sends a price, a total, a discount amount, a tax
figure or a status. Every number is recomputed on the server from the database and the providers:

| Figure | Computed by |
|---|---|
| Line price | live `product-variants.priceMinor`, read on every bag read (`lib/cart/cart.ts` `getCart`). `cart-items` stores no price |
| Bag subtotal, item count, provisional total | `lib/cart/rules.ts` `cartTotals` |
| Discount | `lib/promotions/rules.ts` `calculateDiscount`, re-decided on every bag read |
| Shipping | `lib/shipping/rules.ts` `quoteShipping`, re-quoted with the address at preflight |
| Tax | `lib/tax/provider.ts` `taxProvider`, at preflight only |
| Order total | `lib/checkout/rules.ts` `orderTotalMinor` — `max(0, subtotal − discount) + shipping + tax`. The discount never reaches delivery or tax. The only function that produces a total sent to Stripe |

## 2. Catalogue, variants, price and stock

A **variant** (one colour and size) is what is bought; cart and order lines point at it
(`payload/collections/ProductVariants.ts`).

| Field / rule | Behaviour | Where |
|---|---|---|
| `priceMinor` | Required. The price charged | `ProductVariants.ts` |
| `compareAtPriceMinor` | Optional former price, shown struck through. A value `<=` the price is **refused on save**, because it would claim a saving that does not exist | `ProductVariants.ts` compare-at hook; renderer `lib/catalog/resolve.ts` |
| `inventoryQuantity` | Whole number `>= 0` (field validator). A Postgres `CHECK product_variants_inventory_non_negative` backs it, because the finalisation decrement is raw SQL past every validator | `ProductVariants.ts` `validateStock`; `payload.config.ts` |
| When stock moves | **Only at confirmed payment**, inside the webhook's transaction (D-06). Never at add-to-cart, never returned on cancel | `lib/checkout/fulfil.ts`; `payload/hooks/orderTransitions.ts` ("Restocking is deliberately absent") |
| `products.derived.inventoryTotal` | A cache: the sum of the product's active variants' stock, read by shop cards (sold out / "Only N left"), the in-stock filter, homepage tiles and the search record — never by a stock decision, which reads `inventoryQuantity` live. Recomputed on every variant save (`syncProductDerived`) and, since sweep 1 (S01), **after every `finalised` payment** for each product the order took stock from (`refreshDerivedStock`, run in the webhook's `after()`, §8.4). A refresh that fails is logged and reported `checkout.derivedStock` and leaves that product's figure at its pre-sale value until its next save; the payment is unaffected | `payload/hooks/syncProductDerived.ts`; `lib/checkout/fulfil.ts` |
| `active: false` | Withdrawn: not purchasable, gone from the size selector, row and stock kept | `ProductVariants.ts` |
| Availability | Derived, not stored: discontinued / sold out (`0`) / low stock (`0 < qty <= lowStockThreshold`, default 5) / in stock | `ProductVariants.ts`; `site-settings.lowStockThreshold` |
| Per-line maximum | `site-settings.maxQuantityPerLine` (default 10, max 99), plus a hard schema cap of 99 on `cart-items.quantity` | `SiteSettings.ts`; `CartItems.ts`; `QUANTITY_HARD_CAP` in `lib/cart/rules.ts` |

**Quantities are clamped, never rejected** (`clampQuantity`). Asking for six with four in stock gets
four and a sentence saying which bound applied — `stock` ("Only 4 left…"), `policy` ("up to N per
order") or `soldOut` (`clampNotice`, `CART_COPY`). Zero means the line cannot exist.

## 3. The bag

Every rule is in `lib/cart/rules.ts`; `lib/cart/cart.ts` does the reads, writes and cookie. It uses
`overrideAccess: true` because `Carts` and `CartItems` grant customers no write access — this module
is the only way in.

| Topic | Behaviour |
|---|---|
| Guest identity | Cookie `north01_cart`: 32 random bytes (base64url), `httpOnly`, `sameSite: lax`, `secure` outside local, 30 days. Set only by a mutation, never by a read. Never accepted from a request body |
| Signed-in identity | Found by `customer` id first. **A bag with an owner is never handed to an anonymous request by cookie** (`resolveCart`) |
| Creation | Only when a line is added (`create: true`). A page view writes nothing |
| Reads revalidate | `getCart` re-reads every variant, clamps every line (`effectiveQuantity`), sets `drifted` when the stored quantity no longer holds, re-decides the promotion, quotes shipping without an address, and leaves the stored rows alone. The fix happens on the next mutation or at preflight |
| Totals | Only buyable lines (priced, `maxQuantity > 0`) count. `isFinal` is false while shipping or tax is `null`, which is every bag, since there is no address before checkout |
| Line ownership | A line id is checked against the requester's bag. "Not yours" and "not there" give the same answer (`ownedLine`) |
| **Price-changed notice** | `cart-items.priceSeenMinor` is the unit price when the line was last added or changed. When the live price differs, the line shows the old price and `CART_COPY.priceChanged` ("You pay the price shown"). Display only, never charged. `null` (lines carried over by a merge, or older lines) shows no notice (`priceMovedFrom`) |
| Session expired | `hasSignedOutBag` tells "signed out, bag intact" apart from "empty". Preflight answers `sessionExpired` and sends the customer to `/login?next=%2Fcheckout&expired=1` |

**Merge at sign-in** (`mergeGuestCart`, called from `login` and `register`; the database half is
`mergeGuestBag`):

1. No guest bag → nothing.
2. Guest bag, no customer bag → the guest bag is **claimed** (one `customer` write). Any order on it
   keeps pointing at it.
3. **Guest bag with a checkout in flight → left exactly as it is** (sweep 1, S03). In flight
   (`guestBagHasLiveCheckout`) means an order on the bag that is `pending_payment` (an open Checkout
   Session, or a delayed payment clearing — any age), or `checkout_started` last written less than
   `PREPARED_CHECKOUT_WINDOW_MS` = 1 hour ago. Nothing is merged or deleted and the cookie keeps
   naming the guest bag, so the order stays reachable through `orders.cart`: preflight can still
   expire its session, the payment still converts its bag, and a guest's confirmation page still
   opens. The signed-in shopper sees their own bag meanwhile. **Nothing retries the merge:** while
   they stay signed in, `resolveCart` finds their bag by customer id and never reads the cookie, and
   the first add to the bag while signed in replaces the cookie with the account bag's token — after which
   the guest bag is forgotten as if they had signed out, and a guest order still paying in another tab
   cannot show its confirmation page on this device (the payment, the email and the order are
   unaffected). A
   later sign-in merges the guest bag only if the cookie still names it (and its checkout has ended
   by then) — the case after a session that simply expired. **Signing out forgets it**
   (`forgetCartCookie`): no later sign-in can find the guest bag, so if its checkout was not paid its
   lines stay in an ownerless bag until the sweep deletes it at expiry. The one path that still picks
   it up is the account bag being converted by its own checkout while the cookie names the guest bag:
   the next bag write finds no account bag, falls back to the cookie and claims the guest bag. Before
   this, the merge deleted the bag and cleared `orders.cart`, which let an account-bag checkout open a
   second payable session for the same goods.
4. Both → `mergeCartLines`: the customer's lines come first; the same variant is **summed first, then
   clamped** against stock and policy; lines that are withdrawn, deleted or sold out are **dropped**,
   from the customer's own bag too. The guest bag is deleted. If the customer's bag has no discount
   code, the guest's code moves over (Phase 36, R2-03) and is re-decided on the next read. Orders on
   the guest bag that cannot take a payment (`draft`, `payment_failed`, `cancelled`, an abandoned
   `checkout_started`) lose their `cart` link, as before.
5. After a merge the cookie points at the customer's bag (so an expired session can offer "sign in").
   After a claim, a deferral or a bag found `gone` it is left as it was — after a deferral that means
   it still names the guest bag (step 3). An explicit sign-out clears it (`forgetCartCookie`).

Steps 3 and 4 run in **one transaction** that takes three locks in this order: the guest bag's
**checkout lock** (`cartCheckoutLock` in `pending-order.ts` — the advisory lock `upsertPendingOrder`
holds from its order lookup to its commit, §7.2), then the **orders on the guest bag**, then the
**guest bag** (`FOR UPDATE`) — the order a payment takes those two in. It then **reads the orders on
the bag again and decides on that read** (the recheck of S03): an order inserted without the checkout
lock and committed while the merge waited for the bag was invisible to the order lock, and an insert
referencing the bag has to wait for the bag's lock, so the second read sees every order. So an order
being prepared on the bag is either committed and seen, or not started until the merge commits (and
fails on the deleted bag, before any session exists); no order on the bag can be paid, and nothing can
convert it, while the merge decides and writes. Preflight takes the checkout lock first and a payment
and the sweep never take it, so the order cannot deadlock. A guest bag found paid for (or already
merged) once the lock is granted is left alone and nothing is written. A failure part-way rolls back
every write; the cookie is left as it was, so a later sign-in retries from the same two bags only if
the cookie still names the guest bag.

A failed merge is logged and **never fails the sign-in**.

**Expiry and the sweep.** `carts.expiresAt` = creation + 30 days, never extended. `GET
/api/carts/sweep` (Vercel Cron, daily at 03:30 UTC, `CRON_SECRET` — without it every request is
refused with 401, see DEPLOYMENT.md §7) runs `sweepRetention` in `lib/cart/sweep.ts`, two steps that
fail independently:

- **Bags** (`sweepExpiredCarts`): up to 200 bags matching `expiredCartWhere` — `active` and past
  `expiresAt` — per run (`Carts.beforeDelete` removes their lines first). `converted` bags are order
  history and are never touched. An order that pointed at a swept bag keeps its snapshot; the
  relationship clears. The delete runs in its own transaction (sweep 1, S04): `SELECT … FOR UPDATE` on
  the **orders pointing at the selected bags**, then on the **bags**, each in id order, then a delete
  whose `where` repeats `expiredCartWhere` alongside the ids — so a bag a payment converted between the
  read and the delete survives, and locking orders before bags (the order `fulfil.ts` takes them in)
  means a sweep and a payment queue rather than deadlock. A bag whose delayed payment is still clearing
  when it expires is deleted if nothing has converted it by then; the payment still lands on its order.
- **Unpaid orders** (`sweepUnpaidOrders`): up to 200 per run matching `unpaidOrderRetentionWhere` —
  a never-paid status (`NEVER_PAID_STATUSES`: `draft`, `checkout_started`, `pending_payment`,
  `payment_failed`, `cancelled`), `updatedAt` more than `UNPAID_ORDER_RETENTION_DAYS` = 30 days ago,
  and **no fulfilment hold** (`none` or null). `paid` and `refunded` cannot match, and an unpaid order
  held `paymentMismatch` is kept however old. The delete runs in its own transaction: `SELECT … FOR
  UPDATE` on the selected ids, then a permanent delete (`trash: true`, trashed rows included) whose
  `where` repeats the whole rule, so an order paid, held or touched in between survives. Lines go
  with the order (`Orders.beforeDelete`).

`updatedAt` is the order's last write. Every raw `UPDATE "orders"` in `pending-order.ts` and
`fulfil.ts` sets `updated_at = now()` (§7.2, §8), so a checkout attempt, a recorded session and every
webhook claim that moves the order restart the clock; a claim matching no row does not. The route
answers `{"carts": …, "orders": …}`, each `{ deleted, more, failed }`; a failing step is reported to
Sentry as `retention.carts` / `retention.orders`. Why the window and clock are what they are:
[`SECURITY.md`](SECURITY.md) §4.

## 4. Promotions

`lib/promotions/rules.ts` (pure), `read.ts` (reads, no `server-only` guard so the harness can use it),
`promotions.ts` and `actions.ts` (apply and remove).

- **One code per order** (DEV-08). `carts.promotion` is a single relationship, so a second code
  replaces the first. A code that does not currently apply is **not stored**.
- **Normalisation**: trimmed and upper-cased. 2–32 characters; a longer input is refused before any
  lookup (`findPromotionByCode`, `applyCodeAction`).
- **Validation order** (`validatePromotion`, first failure wins): `inactive` → `notStarted` →
  `expired` → `usageLimit` → `perCustomerLimit` → `currency` (only for `fixed` codes) →
  `minimumSubtotal` (whole bag, before shipping and tax) → `noEligibleItems`. `unknownCode` and
  `inactive` give the **same** sentence, so the form cannot be used to discover unreleased codes
  (`PROMOTION_COPY`).
- **Eligibility**: both lists empty means the whole bag; otherwise a line qualifies if it matches an
  eligible product **or** collection. Collection membership is read from the collection side
  (`attachCollectionMembership`).
- **Calculation** (`calculateDiscount`): a percentage uses `Math.round` over the eligible subtotal; a
  fixed amount is clamped to the eligible subtotal. `free_shipping` carries `freeShipping: true` and no
  amount. It waives **Standard only** and draws no Discount row (DEV-60, closed in Phase 16).
- **Re-decided on every read.** The cart stores which code, never an amount. A code that stopped being
  valid shows its reason, and **preflight refuses** (`promotionInvalid`) rather than quietly charging
  full price.
- **Per-customer limit** counts that customer's orders with this promotion that are `paid`, or
  `pending_payment` on a cart that is not one of the customer's current bags (Phase 36, R1-07). A
  current bag is `active` **and not past `expiresAt`** — the definition `resolveCart` uses (sweep 1,
  S20); a pending order on an expired bag that still says `active` (the daily sweep has not reached it)
  counts, because no request can reach that bag again. A guest counts as zero (**DEV-59**). The global
  `usageLimit` still applies to guests.
- **Usage limit at payment.** `timesUsed` goes up inside the payment transaction, by a conditional
  `UPDATE … WHERE usage_limit IS NULL OR times_used < usage_limit`. If that matches no row, the payment
  still stands (the money has moved), the redemption is not counted, and the event is logged and
  reported as `checkout.promotionOverRedeemed` (`fulfil.ts`, Phase 36 R1-07).

## 5. Shipping

`lib/shipping/rules.ts` (the rate card, pure) and `provider.ts` (`staticShippingProvider`, the one
export to swap for a carrier).

| Method | Amount | Estimate | Restriction |
|---|---|---|---|
| `standard` | 995 | 3–5 business days | Waivable |
| `express` | 1995 | 2 business days | — |
| `overnight` | 3495 | Next business day | `US` only |

Supported countries: `US, CA, GB, IE, FR, DE, NL, AU` (`SUPPORTED_COUNTRIES`). The amounts are in the
store currency's minor units, and are constants in code rather than CMS content.

- **Free-shipping threshold**: `site-settings.freeShippingThresholdMinor` (admin-only, no default; if
  unset, spend never waives). It is compared against the **discounted** subtotal, so applying a coupon
  can take free delivery away. The bag's progress message (`shippingProgress`) reads the same number.
- **Without an address** the quote prices every rate and marks it eligible with
  `destinationKnown: false`. That is an estimate, and the bag labels it one.
- **At preflight** the quote is redone with the real destination. The browser's method id is looked up
  in *that* quote (`validateSelectedRate`); a submitted price is never read.
- **Delivery-estimate snapshot**: preflight writes `shippingMethodCode`, `shippingMethodLabel`,
  `shippingEstimate` and `shippingMinor` onto the order. The success page and emails show them again
  (Phase 35, P35-20).

## 6. Tax

`lib/tax/rules.ts` (contract and Stripe mapping, pure) and `lib/tax/provider.ts`.

| Status | `amountMinor` | Meaning |
|---|---|---|
| `calculated` | > 0 | A provider answered |
| `not_required` | `0` | A provider answered and no tax applies |
| `pending_address` | `null` | No address yet — every bag |
| `unavailable` | `null` | Provider failed or answered nonsense. **Preflight refuses** (`taxUnavailable`); never a guessed zero |

- **Provider selection** (`taxProvider`): `stripeTaxProvider` when Stripe is configured, otherwise
  `deferredTaxProvider` (`pending_address` with no address, `unavailable` with one). Phase 36 (R1-02)
  added the Stripe provider, closing DEV-61 (the entry records the closure).
- **The request** (`stripeTaxCalculationParams`): one line item for the discounted goods,
  `max(0, subtotal − discount)`; delivery as `shipping_cost`; everything `tax_behavior: exclusive`;
  the shipping address with `address_source: 'shipping'`. Sent with `stripe.tax.calculations.create`,
  **5 s timeout, no retries**.
- **Why not Checkout's `automatic_tax`**: Stripe would add tax on its own page after our total is
  fixed, so the order would record one total and the card would be charged another. Tax is calculated
  here, added into `orderTotalMinor`, and charged inside the single line item (DEV-63).
- **Owner step** (`TODO.md` §4): enable Stripe Tax in the Dashboard — origin address plus a
  registration for every jurisdiction. **Without registrations every calculation returns 0**, which
  shows as `not_required` and looks like success. Check one calculation against a registered address
  before taking real orders.

## 7. Checkout, step by step

Entry point: `startCheckoutAction` (`lib/checkout/actions.ts`). It wraps preflight and session
creation. Anything thrown becomes `checkoutFailed`, never an error page (Phase 36, R1-03).

### 7.1 Preflight — `lib/checkout/preflight.ts` `runPreflight`

Steps 3–7 of plan §17.1a are the `getCart` read. Preflight adds the refusals, in this order:

| # | Check | Refusal | Customer copy (`PREFLIGHT_COPY`, `lib/checkout/rules.ts`) |
|---|---|---|---|
| 1 | Stripe configured | `stripeUnconfigured` | Payment is not available right now. Please try again shortly. |
| 2 | Bag exists and has lines. If there is no bag but a signed-out owner's bag exists: `sessionExpired` → redirect to login | `emptyCart` / `sessionExpired` | Your bag is empty. / Your session has ended. Sign in to continue — your bag is saved. |
| 3 | Every line priced and buyable → otherwise redirect to `/cart?changed=1` | `lineUnavailable` | Something in your bag is no longer available. Your bag has been updated — please review it. |
| 4 | `cart.drifted` false → otherwise redirect to `/cart?changed=1` | `totalMismatch` | Your bag changed while you were checking out. Please review it. |
| 5 | Applied code still valid | `promotionInvalid` | Your discount code is no longer valid. Remove it to continue. |
| 6 | Email shape; address complete, within `lib/address-limits.ts`, two-letter country (**DEV-11**) | `invalidAddress` | Check the delivery address — something is missing. |
| 7 | Destination supported | `addressUnsupported` | We cannot deliver to that address. |
| 8 | Shipping re-quoted; chosen method exists and is eligible | `noShippingMethod` | No delivery option is available for that address. |
| 9 | Tax calculated | `taxUnavailable` | We could not calculate tax just now. Please try again in a moment. |
| 10 | Pending order written (§7.2) — the prior session was paid or is clearing | `alreadyPaid` | This bag has already been paid for, or its payment is still being processed — a bank payment can take a few days. We email your order confirmation once a payment is confirmed. If it does not go through, no email is sent, and you can check out this bag again. |
| 10 | — Stripe error while retiring the prior session | `stripeUnconfigured` | (as row 1) |
| — | Anything thrown | `checkoutFailed` | Something went wrong before you were sent to payment, and nothing was charged. Please try again in a moment. |

A failed session creation (§7.3) also shows the `stripeUnconfigured` sentence (`actions.ts`).

### 7.2 The pending order — `upsertPendingOrder`

- **One attempt per cart at a time.** A per-cart advisory lock (`cartCheckoutLock`) is held from the
  order lookup to the commit, so two attempts on one bag cannot both create an order. The sign-in merge
  takes the same lock on a guest bag before it decides (§3).
- **One order per cart**, reused across attempts. The most recent order on the cart in
  `REUSABLE_ORDER_STATUSES` — `draft`, `checkout_started`, `pending_payment`, `payment_failed` — is
  reused. `cancelled` is not: an expiry makes the fulfilment side terminal, so the next attempt gets a
  new order (Phase 36, R1-03, R1-06). The reuse claim sets `updated_at`, so reusing an order restarts
  its retention clock; an order in any of these statuses left alone for 30 days is deleted by the
  daily sweep (§3).
- **The prior session is retired first** (`retirePriorSession` → `decidePriorSession`, R1-01). This
  stops an older, cheaper session from paying for a newer, larger bag:

  | Prior session | Decision |
  |---|---|
  | `payment_status: paid` | refuse (`alreadyPaid`) |
  | `expired` | proceed |
  | `open` | expire it through Stripe, then proceed; if the expiry fails, refuse |
  | `complete`, not paid | refuse (bank payment clearing), **unless** the order is already `payment_failed` → proceed |
  | anything else | refuse |

- The order is written at `paymentStatus: checkout_started`, `fulfillmentStatus: unfulfilled`, **never
  `paid`**. A reused order also has `stripeCheckoutSessionId` cleared. `promotion` is always written
  (`null` when no code) so a removed code cannot be counted at payment (R1-08). Email is lower-cased;
  the shipping address is copied to the billing address.
- **Line snapshot**: old `order-items` are deleted and new ones written with product name, SKU (or
  `UNKNOWN`), variant label, unit price, quantity (`effectiveQuantity`) and a **stored**
  `lineTotalMinor`. Name, SKU, unit price and variant label cannot be changed afterwards
  (`FROZEN_ORDER_LINE_FIELDS`, `payload/hooks/freezeOrderLines.ts`).
- Order numbers for new orders come from `formatOrderNumber`: `N1-YYMM-XXXXXX`. A reused order keeps
  its number. The attempt returns it (`orderNumber`, beside `orderId` and `preparedAt`), and preflight
  passes it to session creation (§7.3).

### 7.3 The Stripe Checkout Session — `lib/checkout/session.ts`

| Parameter | Value | Why |
|---|---|---|
| `line_items` | **One** line, `unit_amount = totalMinor`, quantity 1, named for the item count | Stripe cannot become a second place the total is computed (**DEV-63**) |
| `line_items[0].price_data.product_data.description` | `Order <orderNumber>.` followed by `stripeLineItemDescription(totals)` — `Includes delivery and tax.` / `Includes delivery.` / `Includes tax.`, each part only when it is above zero, then `Discount applied.` when there is one | Stripe prints it on its payment page and receipt, so the receipt carries the same order number as the confirmation email, the success page and the account (sweep 1, S15). Never the database id |
| `expires_at` | now + 31 min | Stripe's minimum is 30 min; the extra minute covers latency. Previously 24 h (R1-01) |
| `metadata.orderId`, `payment_intent_data.metadata.orderId` | the internal order id | The webhook's way back; parsed, never trusted (`parseOrderReference`) |
| `customer_email` | the validated email | — |
| `success_url` / `cancel_url` | `${SITE_URL}/checkout/success?order=<id>` / `/checkout/cancelled?order=<id>` | The order id, not the session id |
| Client | API version `2026-07-29.dahlia`, `maxNetworkRetries: 2` | `lib/checkout/stripe.ts` — the only file that reads `STRIPE_SECRET_KEY` |

**The conditional claim.** After Stripe returns, one statement records the session:
`UPDATE orders SET payment_status='pending_payment', stripe_checkout_session_id=$id WHERE id=$order
AND payment_status='checkout_started' AND stripe_checkout_session_id IS NULL`. If no row matches (a
concurrent attempt or an event got there first), the new session is **expired unused** and the customer
is asked to try again. A session with no URL gets the same treatment. `stripeCheckoutSessionId` is
unique.

### 7.4 Return pages

- **`/checkout/success`** (`force-dynamic`) reads the order and **writes nothing**. The copy follows the
  order's status (`lib/checkout/confirmation-copy.ts`): paid → "Thank you"; paid with a stock hold →
  says nothing has been sent yet; `pending_payment` → "Confirming your payment" (refresh; email
  follows); `payment_failed`, not-completed and refunded have their own copy. A missing order or
  another customer's order gets one shared message. An unreadable database gets
  `CONFIRMATION_UNREADABLE`. There is no polling. The GA4 `purchase` event fires only when `paid`.
- **`/checkout/cancelled`** is static and writes nothing — not even `cancelled`. The bag is left as it
  was. Only `checkout.session.expired` cancels an order.


**Two checkouts on one bag** (a double click, a second tab) are serialised: preflight takes a
per-cart `pg_advisory_xact_lock` around the pending-order lookup and write
(`lib/checkout/pending-order.ts`), reusing an order is a conditional claim on the status and session
it saw, and the session claim also requires the order's `updated_at` from that attempt's own write —
so a superseded attempt loses its claim and expires the session it created. One live order and one
payable session per bag (`verify:checkout` G2, sweep 1).

## 8. The webhook

`POST /api/stripe/webhook` — `src/app/(frontend)/api/stripe/webhook/route.ts`, `force-dynamic`. It is
the **only** path that can mark an order paid; `lib/checkout/fulfil.ts` is the only file that writes
`paid`.

### 8.1 Verification and the `stripe-events` row

1. Stripe not configured → **503** (a silent 200 would make Stripe drop real events).
2. No `stripe-signature` header, or `constructEvent(request.text(), …)` fails → **400**. The raw body
   is verified; it is never re-serialised.
3. Insert a `stripe-events` row `{eventId, type, status: received, attempts: 1, receivedAt}`. `eventId`
   is unique — the **first idempotency barrier**. The row stores no payload (SECURITY.md §1).
   - The insert fails, and it is **not** a unique violation (`isUniqueViolation`: SQLSTATE 23505, or
     Payload's `ValidationError` on `eventId`) → **500**; Stripe retries.
   - It is a duplicate → `decideDuplicateDelivery` on the stored row:

     | Stored row | Decision | Response |
     |---|---|---|
     | `processed` / `ignored` | acknowledge, `attempts + 1` | **200** Already processed |
     | `received`, ≤ 60 s old | retry later, `attempts + 1` | **409** |
     | `failed`, or `received` > 60 s (or no timestamp) | reprocess — `reclaimWebhookDelivery` flips it back to `received` atomically; if another delivery won the reclaim → **409** | continue |

4. Event type not handled → row `ignored`, **200**.
5. Handler throws → row `failed` with the error (≤ 900 chars), **500**. The retry is reprocessed; that
   is safe because every business write downstream is a conditional claim (Phase 36, R1-04).

### 8.2 Per-event handling — `planStripeEvent` + `applyStripeEvent`

The order is found by `metadata.orderId`, or by `stripe_payment_intent_id` if there is no reference.
Only a Payload 404 counts as "no such order"; any other read error is rethrown and returns 500
(`notFoundAsNull`). Session events carry `SessionFacts` (id, `amount_total`, currency,
`payment_status`); a session event without them is a mismatch.

| Event | Condition | Effect |
|---|---|---|
| `checkout.session.completed` | `payment_status: paid` | **Finalise** (§8.3) |
| | `unpaid` (delayed bank method) | claim → `pending_payment` from `checkout_started` / `pending_payment`, for this session only. No stock, no email |
| | `no_payment_required` or anything else | **mismatch** |
| `checkout.session.async_payment_succeeded` | — | **Finalise** |
| `checkout.session.async_payment_failed` | — | claim → `payment_failed` (from every status that may reach it, this session only) |
| `checkout.session.expired` | — | claim → `cancelled`, then `fulfillmentStatus: cancelled`. No stock to return |
| `payment_intent.payment_failed` | — | **Record only**: a declined card inside Checkout does not end the session (R1-05) |
| `charge.refunded` | cumulative `amount_refunded` | `refunded_minor = GREATEST(existing, new)`, `refunded_at` set; `payment_status → refunded` only when `amount_refunded >= totalMinor` (`isFullRefund`). A partial refund leaves the order `paid`. Matches only on a **new** higher amount from `paid`/`refunded`, so a redelivery changes nothing (R1-09). The refund email is queued in the same transaction. **If the order exists but is not yet paid** — the refund overtook its payment — or its payment intent is not stored yet, the event throws and the route answers **500**, so Stripe retries until the payment has landed (sweep 1) |
| `payment_intent.succeeded`, anything else | — | ignored |

When a claim matches no row, `classifyUnclaimedSessionEvent` decides what that means:

| Outcome | Meaning | Row |
|---|---|---|
| `alreadyFinal` | This order's own session, already moved on — a redelivery, or the second event for one payment | `processed` |
| `superseded` | An expiry or failure for a session the order has since replaced | `ignored` |
| `mismatch` | A session reporting money that is not the order's current session at its current total and currency | `ignored`, `error: MISMATCH: …`, logged, reported `stripe.webhook.mismatch`, **200** (a retry cannot fix it), **nothing applied** — except that the order named in the metadata gets `fulfilmentHold: paymentMismatch`, so staff see the captured money in the Orders list (sweep 1). No automatic refund: a person decides |

Two outcomes come before any claim, from the lookup itself (row wording in `eventRowRecordFor`,
`lib/checkout/events.ts`):

| Outcome | Meaning | Row |
|---|---|---|
| `orderMissing` | The metadata's order id parses but names no order — for any handled event type — or the order was deleted between the lookup and a claim (a 404 there). In normal operation that means the retention sweep deleted an unpaid order (§3) | `ignored`, `error: ORDER MISSING: the event names order <id>, which does not exist here. …`, logged, reported `stripe.webhook.orderMissing`, **200** (a retry cannot recreate the order), **nothing applied**. Check Stripe for money the event moved |
| `noOrder` | No order reference, and no order holds the event's payment intent | `ignored`, `error: No order reference and no known payment intent in the event.`, **200**, not alerted |

### 8.3 Finalisation — `finalisePaidOrder`, one transaction

1. **The paid claim** (the second idempotency barrier): `UPDATE orders SET payment_status='paid',
   paid_at=now, fulfillment_status='unfulfilled', stripe_payment_intent_id=COALESCE(…) WHERE id=$order
   AND payment_status IN (FINALISABLE_STATUSES) AND stripe_checkout_session_id=$session AND
   total_minor=$amount_total AND lower(currency)=lower($currency)`. No row → commit, then classify
   (§8.2). `FINALISABLE_STATUSES` comes from the state machine (`lib/checkout/rules.ts`).
2. `SAVEPOINT finalise_stock`.
3. Read the order lines and variant stock inside the transaction; `planStockDecrements` sums each
   variant across lines and is **all-or-nothing**.
4. Each decrement: `UPDATE product_variants SET inventory_quantity = inventory_quantity - $n WHERE
   id=$v AND inventory_quantity >= $n`. If one affects no row → `ROLLBACK TO SAVEPOINT` and no line's
   stock moves.
5. **Oversold** (from the plan or from step 4): the order **stays paid**, gets
   `fulfilmentHold: stockShortfall` and a `shortfall` JSON (variant, quantity, available), is logged and
   reported `checkout.oversold`, and the outcome is `outOfStock`. A person decides: refund in Stripe,
   back-order or substitute (R1-10, R3-19). The hold is never cleared.
6. Promotion `timesUsed + 1` under its limit (§4).
7. Cart → `converted` by a raw UPDATE on the same transaction handle (a cart already deleted is
   ignored). Not the Local API: a failed Local API write makes Payload kill the transaction, which
   would roll the payment back while this function reported success (sweep 1).
7a. The order-confirmation email row is queued **inside** the transaction (dedupe-key pre-check), so
   it cannot be lost between acknowledging Stripe and queueing it (sweep 1).
8. Commit. Anything thrown rolls back **the whole thing, claim included**, and the route returns 500.

Steps 6 and 7 run on both the normal and the oversold path.

### 8.4 After the response

The `stripe-events` row is marked `processed` (or `ignored`) first, then **200** is returned. Work that
must not delay Stripe runs in Next's `after()`, as `afterStripeEvent` (`lib/checkout/after-stripe-event.ts`,
with the courier and the Stripe client passed in by the route). Its three steps are **started together
and awaited with `Promise.allSettled`**, so none waits on another and each reports its own failure (the
recheck of S01: run in sequence, a slow Algolia behind the refresh held the tax record back, and a
platform that ends `after()` at the function's duration limit could lose it unlogged):

- **Deliver** the email rows the transaction already queued — the confirmation, or a refund message
  (one per new cumulative amount; the dedupe key includes it) — and log a failed delivery. Then an
  opportunistic drain of up to 5 queued emails (R1-21: Resend calls time out after 8 s). Failures are
  reported `stripe.webhook.email`.
- **Record the Stripe Tax transaction** — `tax.transactions.createFromCalculation` with the calculation
  id stored on the order at preflight and the order number as reference (`lib/tax/transactions.ts`),
  with an idempotency key. Skipped when there is no `taxcalc_` id; failures are reported
  `stripe.webhook.taxTransaction` for someone to record by hand. **Reversal on refund is not built** — a
  refunded sale stays in Stripe Tax's reports until it is reversed by hand in the Dashboard.
- **Refresh the products' cached stock figure** after a `finalised` payment (sweep 1, S01):
  `refreshDerivedStock` reads the order's lines and their variants, and runs `recalculateProductDerived`
  (no transaction) for each product, whose product update also re-syncs the search index and
  revalidates the `catalog` and `home` caches. Any other outcome refreshes nothing — no other outcome
  moved stock. It never throws; a failure is logged and reported `checkout.derivedStock`.

Nothing in `after()` can change the order or the response. A failed delivery stays on its
`email-messages` row, which the drain retries — see EMAIL.md. Nothing else here is retried: if the
`after()` work never runs or is cut short, a tax transaction not yet recorded is found only by
reconciling Stripe Tax, and a refresh not yet done leaves the product's cached figure at its pre-sale
value until its next save — a Stripe redelivery is answered `alreadyFinal`, which refreshes nothing.

## 9. Order state

Two stored axes, one displayed status (**DEV-03**; `lib/orders/rules.ts`).

**Payment** (`lib/checkout/rules.ts` `ALLOWED_TRANSITIONS`). Only server code writes it: the field is
`nobodyField` (`Orders.ts`), and every webhook transition is a conditional SQL claim.

| From | May move to |
|---|---|
| `draft` | `checkout_started`, `cancelled` |
| `checkout_started` | `pending_payment`, `paid`, `payment_failed`, `cancelled` |
| `pending_payment` | `checkout_started` (reuse, Phase 36), `paid`, `payment_failed`, `cancelled` |
| `payment_failed` | `checkout_started`, `pending_payment`, `paid`, `cancelled` |
| `cancelled` | `checkout_started`, `pending_payment`, `paid` |
| `paid` | `refunded` |
| `refunded` | — |

**Fulfilment** (`ALLOWED_FULFILLMENT_TRANSITIONS`, enforced on every write path by
`payload/hooks/orderTransitions.ts` under `SELECT … FOR UPDATE`):
`unfulfilled → processing | cancelled`, `processing → shipped | cancelled`, `shipped → delivered`.
`delivered` and `cancelled` are terminal. Moving into `processing` or `shipped` requires `paid`;
`shipped` requires a carrier **and** a tracking number. `shippedAt` / `deliveredAt` are stamped by the
transition. Refusals use `FULFILLMENT_COPY` on the field. Going to `shipped` / `delivered` queues an
email (`payload/hooks/queueOrderEmails.ts`, EMAIL.md).

**Displayed status** (`displayStatus`): refunded > cancelled > delivered / shipped / processing >
payment status. Extra copy appears for a partial refund (`isPartiallyRefunded`) and a stock hold
(`STOCK_SHORTFALL_COPY`).

**What staff may edit** (`Orders.ts`): `fulfillmentStatus`, `carrier`, `trackingNumber`, `trackingUrl`
(editors and admins, one order at a time — bulk edit is disabled); the shipping and billing address
snapshots (**admins only**). Everything else — payment status, every money field, promotion and code,
the shipping-method snapshot, customer, cart, email, Stripe ids, `paidAt`, refund fields,
`fulfilmentHold` — is server-written only. `create` is `nobody`, including for admins.

**Refunds are made in the Stripe dashboard.** There is deliberately no refund button; the signed
`charge.refunded` event fills in `refundedMinor`, `refundedAt` and the status (`Orders.ts`, Stripe
tab). Cancelling does not restock.

## 10. Failure behaviour

| Failure | What happens | Where |
|---|---|---|
| Database down — storefront | Cart drawer says `CART_COPY.failed` rather than "empty". Success page → `CONFIRMATION_UNREADABLE`, not "order not found" (R3-14). Checkout → `checkoutFailed` | `components/shell/cart-drawer.tsx`, `checkout/success/page.tsx`, `lib/checkout/actions.ts` |
| Database down — webhook | Recording the event fails → 500. A mid-processing read error → row `failed`, 500. Stripe retries and the retry is reprocessed | `route.ts`, `fulfil.ts` `notFoundAsNull` |
| Database down — sign-in merge | Logged; sign-in succeeds; the merge's transaction rolls back, so both bags stay as they were and the guest lines are missing from the signed-in bag. The cookie still names the guest bag, so a later sign-in merges them only if it still does — signing out forgets it (§3, merge step 3) | `lib/cart/cart.ts` `mergeGuestCart` |
| Cached stock refresh fails after a payment | Payment and stock unaffected; logged and reported `checkout.derivedStock`; that product's cards keep the pre-sale count until it or a variant is next saved — `pnpm reindex` copies the same column and does not fix it | `fulfil.ts` `refreshDerivedStock` |
| Stripe unconfigured | Checkout page declines; preflight `stripeUnconfigured`; tax deferred; webhook 503 | `stripe.ts`, `preflight.ts`, `tax/provider.ts`, `route.ts` |
| Stripe down at checkout | Session create (2 SDK retries) fails → the order stays `checkout_started`, the customer sees the `stripeUnconfigured` sentence, reported `checkout.createSession`. Retiring the prior session fails → refused the same way | `session.ts`, `preflight.ts` |
| Tax slow or failing | 5 s timeout, no retry → `unavailable` → `taxUnavailable`; reported `tax.stripe`. Never charged as zero | `tax/provider.ts` |
| Email slow or failing | Runs after the 200, beside the tax record and the stock refresh and holding neither up; the order is unaffected; `email-messages` row retried by the drain and the daily cron | `lib/checkout/after-stripe-event.ts`, DEPLOYMENT.md §7 |
| Webhook delayed | Success page shows "Confirming your payment"; the order is `pending_payment` until the event arrives. The 31-minute session expiry does not affect a completed payment | `confirmation-copy.ts` |
| Webhook duplicated | Unique `eventId` → acknowledge / 409 / reprocess (§8.1); conditional claims make a reprocess change nothing | `route.ts`, `events.ts`, `fulfil.ts` |
| Two payments race for the last unit | The second finalisation finds no stock → paid + `stockShortfall`, no partial decrement | `fulfil.ts` |
| Code over-redeemed by concurrent payments | Payment stands, counter capped, reported | `fulfil.ts` |

## 11. Where each rule is tested

Unit tests (`pnpm test:unit`, Vitest, no database):

| Rule | Test |
|---|---|
| Formatting, `toMinorAmount` / `toWholeCount` | `tests/unit/money.test.ts` |
| Clamp, clamp copy, card availability and low stock | `tests/unit/inventory.test.ts`, `tests/unit/variants.test.ts` |
| Bag totals, `null` vs `0`, `isFinal` | `tests/unit/cart-totals.test.ts` |
| Merge (§14.1b) | `tests/unit/cart-merge.test.ts` |
| Retention sweep queries — both predicates, the re-checked and locked deletes, the bound | `tests/unit/retention-sweep.test.ts` |
| Price-changed notice | `tests/unit/cart-price-changed.test.ts` |
| Promotion checks and calculation | `tests/unit/promotions.test.ts` |
| Rate card, threshold, rate validation | `tests/unit/shipping.test.ts` |
| Tax contract and deferral; Stripe Tax request and mapping | `tests/unit/tax.test.ts`, `tests/unit/tax-stripe.test.ts` |
| Event plan, session mismatch, unclaimed classification, refund by amount, redelivery, prior-session and reuse | `tests/unit/checkout-webhook.test.ts` |
| Success-page copy by status; the line item's description sentence | `tests/unit/checkout-confirmation.test.ts` |
| The Checkout Session parameters: the order number in the description, one line item at the total, the id in metadata and URLs, the claim | `tests/unit/checkout-session.test.ts` (Stripe client mocked) |
| Fulfilment machine, frozen line fields, displayed status | `tests/unit/order-state.test.ts` |

Harnesses (`pnpm verify:<name>`, `payload run`). Sections that write data are guarded by **D-10**: they
refuse to run anywhere but the development database `DATABASE_PUSH_TARGET` names.

| Script | Covers |
|---|---|
| `scripts/verify-cart.ts` | §14's rules and every §14.1b merge edge case; section F against the database; section **G** (S03): `mergeGuestBag` defers for a pending or just-started checkout, merges past dead orders, and — with a rival transaction holding the order the way a payment does — waits, sees the bag was paid for, writes nothing and does not deadlock; **G5** a merge queued behind a preflight holding the bag's checkout lock defers once the order it then writes commits; **G6** a merge queued on the bag behind an uncommitted order insert (no checkout lock) sees the order and defers |
| `scripts/verify-promotions.ts` | §15.1a checks and §15.1c edge cases; section G: the normalised unique index; section H: per-customer counting, including a pending order on an expired, still-active bag (S20) |
| `scripts/verify-shipping.ts` | §16 rate shape, validation, edge cases and the tax boundary (mostly pure) |
| `scripts/verify-checkout.ts` | State machine, preflight vocabulary, stock plan; section F: **real offline signature verification** with `generateTestHeaderString`; G2: concurrent attempts on one bag, and (S15) the customer-facing order number each attempt returns, kept on reuse; H: the refusal copy, including `alreadyPaid` promising only the confirmation (S07) |
| `scripts/verify-webhook.ts` | `applyStripeEvent` against real orders, variants and stock: both barriers, the transaction, the inventory race, `stripe-events` bookkeeping; sections M–S vary one session fact at a time; G separates `orderMissing` from `noOrder`; T proves every claim that changes an order sets `updated_at`, and a superseded claim does not; U (S01) proves `refreshDerivedStock` sets each product's `derived.inventoryTotal` to the sum of its active variants' stock after a sale, only for `finalised`, idempotently, and that one product's failed refresh neither throws nor stops the others; then runs the route's `afterStripeEvent` with stub dependencies — it refreshes the figure and records the tax, the refresh finishes while the tax record is stuck, and the tax record while the refresh is stuck; C (S06) proves the confirmation queued for a held order carries `data.onHold: true`, on the plain and the savepoint paths. It first removes what an aborted run left behind, by the fixture prefixes only this script uses |
| `scripts/verify-orders.ts` | Fulfilment transitions and line immutability, measured as rejected writes against the database. Section **M**, the retention sweep: its own fixtures only, aged with raw SQL to 1997–2000 and swept at a fixed clock (`SWEEP_NOW` = 2000-03-01) — the 30-day window, the batch bound, trashed rows, paid and refunded never taken, a `paymentMismatch` hold kept, a null hold taken, a webhook claim restarting the clock — and **permanently deletes** those fixtures, clearing leftovers of an aborted run first. Section **M2** (S04), the bag sweep: a rival transaction locks an order and then converts its expired bag while the sweep waits on that order; the converted bag survives, no deadlock, and only the genuinely expired bag is counted |

**Not verified anywhere:** a live `stripe.checkout.sessions.create`, a live Stripe Tax calculation, and
a real payment (DEV-62, `TODO.md` §4). The first test in a keyed environment is one test-mode purchase
end to end, one refund (partial, then the rest), and one tax calculation against a registered address.

**Known inconsistency:** `Orders.orderNumber`'s own default generator produces `N01-XXXXXXXX`
(`Orders.ts`), while checkout always supplies `N1-YYMM-XXXXXX` (`lib/checkout/rules.ts`
`formatOrderNumber`). Only orders created by some other writer would get the first format.
