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

**Merge at sign-in** (`mergeGuestCart`, called from `login` and `register`):

1. No guest bag → nothing.
2. Guest bag, no customer bag → the guest bag is **claimed** (one `customer` write).
3. Both → `mergeCartLines`: the customer's lines come first; the same variant is **summed first, then
   clamped** against stock and policy; lines that are withdrawn, deleted or sold out are **dropped**,
   from the customer's own bag too. The guest bag is deleted. If the customer's bag has no discount
   code, the guest's code moves over (Phase 36, R2-03) and is re-decided on the next read.
4. The cookie then points at the customer's bag (so an expired session can offer "sign in"). An
   explicit sign-out clears it (`forgetCartCookie`).

A failed merge is logged and **never fails the sign-in**.

**Expiry and the sweep.** `carts.expiresAt` = creation + 30 days. `GET /api/carts/sweep` (Vercel
Cron, daily, `CRON_SECRET`, see DEPLOYMENT.md §7) runs `lib/cart/sweep.ts`: it deletes up to 200
`active` bags past expiry per run (`Carts.beforeDelete` removes their lines first). `converted` bags
are order history and are never touched. An order that pointed at a swept bag keeps its snapshot;
the relationship clears.

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
  `pending_payment` on a cart that is no longer active (Phase 36, R1-07). A guest counts as zero
  (**DEV-59**). The global `usageLimit` still applies to guests.
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
| 10 | Pending order written (§7.2) — the prior session was paid or is clearing | `alreadyPaid` | This bag has already been paid for, or its payment is still being processed. Check your email before trying again. |
| 10 | — Stripe error while retiring the prior session | `stripeUnconfigured` | (as row 1) |
| — | Anything thrown | `checkoutFailed` | Something went wrong before you were sent to payment, and nothing was charged. Please try again in a moment. |

A failed session creation (§7.3) also shows the `stripeUnconfigured` sentence (`actions.ts`).

### 7.2 The pending order — `upsertPendingOrder`

- **One order per cart**, reused across attempts. The most recent order on the cart in
  `REUSABLE_ORDER_STATUSES` — `draft`, `checkout_started`, `pending_payment`, `payment_failed` — is
  reused. `cancelled` is not: an expiry makes the fulfilment side terminal, so the next attempt gets a
  new order (Phase 36, R1-03, R1-06).
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
- Order numbers for new orders come from `formatOrderNumber`: `N1-YYMM-XXXXXX`.

### 7.3 The Stripe Checkout Session — `lib/checkout/session.ts`

| Parameter | Value | Why |
|---|---|---|
| `line_items` | **One** line, `unit_amount = totalMinor`, quantity 1, named for the item count | Stripe cannot become a second place the total is computed (**DEV-63**) |
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
| `charge.refunded` | cumulative `amount_refunded` | `refunded_minor = GREATEST(existing, new)`, `refunded_at` set; `payment_status → refunded` only when `amount_refunded >= totalMinor` (`isFullRefund`). A partial refund leaves the order `paid`. Matches only on a **new** higher amount from `paid`/`refunded`, so a redelivery changes nothing (R1-09) |
| `payment_intent.succeeded`, anything else | — | ignored |

When a claim matches no row, `classifyUnclaimedSessionEvent` decides what that means:

| Outcome | Meaning | Row |
|---|---|---|
| `alreadyFinal` | This order's own session, already moved on — a redelivery, or the second event for one payment | `processed` |
| `superseded` | An expiry or failure for a session the order has since replaced | `ignored` |
| `mismatch` | A session reporting money that is not the order's current session at its current total and currency | `ignored`, `error: MISMATCH: …`, logged, reported `stripe.webhook.mismatch`, **200** (a retry cannot fix it), **nothing applied** |

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
7. Cart → `converted` (a cart already deleted is ignored).
8. Commit. Anything thrown rolls back **the whole thing, claim included**, and the route returns 500.

Steps 6 and 7 run on both the normal and the oversold path.

### 8.4 Email after the response

The `stripe-events` row is marked `processed` (or `ignored`) first, then **200** is returned. Mail work
runs in Next's `after()` (`sendOrderEmails`, R1-21):

- Order confirmation for `finalised`, `outOfStock`, and for a payment event that finds the order
  already `paid`. That last case re-queues an email lost to a crash; the dedupe key per order makes it
  free otherwise (`lib/email/orders.ts`).
- Refund message once per new cumulative refunded amount (the dedupe key includes the amount).
- An opportunistic drain of up to 5 queued emails.

Nothing in `after()` can change the order or the response. Failures land on `email-messages` rows,
which the drain retries — see EMAIL.md.

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
| Database down — sign-in merge | Logged; sign-in succeeds; guest lines may be lost | `lib/cart/cart.ts` `mergeGuestCart` |
| Stripe unconfigured | Checkout page declines; preflight `stripeUnconfigured`; tax deferred; webhook 503 | `stripe.ts`, `preflight.ts`, `tax/provider.ts`, `route.ts` |
| Stripe down at checkout | Session create (2 SDK retries) fails → the order stays `checkout_started`, the customer sees the `stripeUnconfigured` sentence, reported `checkout.createSession`. Retiring the prior session fails → refused the same way | `session.ts`, `preflight.ts` |
| Tax slow or failing | 5 s timeout, no retry → `unavailable` → `taxUnavailable`; reported `tax.stripe`. Never charged as zero | `tax/provider.ts` |
| Email slow or failing | Runs after the 200; the order is unaffected; `email-messages` row retried by the drain and the daily cron | `route.ts` `sendOrderEmails`, DEPLOYMENT.md §7 |
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
| Price-changed notice | `tests/unit/cart-price-changed.test.ts` |
| Promotion checks and calculation | `tests/unit/promotions.test.ts` |
| Rate card, threshold, rate validation | `tests/unit/shipping.test.ts` |
| Tax contract and deferral; Stripe Tax request and mapping | `tests/unit/tax.test.ts`, `tests/unit/tax-stripe.test.ts` |
| Event plan, session mismatch, unclaimed classification, refund by amount, redelivery, prior-session and reuse | `tests/unit/checkout-webhook.test.ts` |
| Success-page copy by status | `tests/unit/checkout-confirmation.test.ts` |
| Fulfilment machine, frozen line fields, displayed status | `tests/unit/order-state.test.ts` |

Harnesses (`pnpm verify:<name>`, `payload run`). Sections that write data are guarded by **D-10**: they
refuse to run anywhere but the development database `DATABASE_PUSH_TARGET` names.

| Script | Covers |
|---|---|
| `scripts/verify-cart.ts` | §14's rules and every §14.1b merge edge case; section F against the database |
| `scripts/verify-promotions.ts` | §15.1a checks and §15.1c edge cases; section G: the normalised unique index and per-customer counting |
| `scripts/verify-shipping.ts` | §16 rate shape, validation, edge cases and the tax boundary (mostly pure) |
| `scripts/verify-checkout.ts` | State machine, preflight vocabulary, stock plan; section F: **real offline signature verification** with `generateTestHeaderString` |
| `scripts/verify-webhook.ts` | `applyStripeEvent` against real orders, variants and stock: both barriers, the transaction, the inventory race, `stripe-events` bookkeeping; sections M–S vary one session fact at a time |
| `scripts/verify-orders.ts` | Fulfilment transitions and line immutability, measured as rejected writes against the database |

**Not verified anywhere:** a live `stripe.checkout.sessions.create`, a live Stripe Tax calculation, and
a real payment (DEV-62, `TODO.md` §4). The first test in a keyed environment is one test-mode purchase
end to end, one refund (partial, then the rest), and one tax calculation against a registered address.

**Known inconsistency:** `Orders.orderNumber`'s own default generator produces `N01-XXXXXXXX`
(`Orders.ts`), while checkout always supplies `N1-YYMM-XXXXXX` (`lib/checkout/rules.ts`
`formatOrderNumber`). Only orders created by some other writer would get the first format.
