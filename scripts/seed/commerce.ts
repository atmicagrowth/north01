/**
 * **The demo's commerce records** — three customer accounts, six orders and eleven reviews.
 *
 * Plan §29.1c asks for *"at least some products with reviews"* and §29.1d for *"clearly documented
 * test accounts"*. Neither is satisfiable from the catalogue alone: a review needs somebody who wrote
 * it, and a verified-purchase badge needs an order that paid for it.
 *
 * ---
 *
 * ### This reverses a decision `seed.ts` made deliberately, so it owes that decision an answer
 *
 * `seed.ts` has said since Phase 6 that it creates **no customers, orders or reviews**, and the
 * argument was a good one:
 *
 * > *"those are not content — they are records of things people did, and inventing them produces an
 * > admin panel full of purchases nobody made and reviews nobody wrote. A commerce demo whose order
 * > list is fiction is worse than one whose order list is empty."*
 *
 * That was right for Phase 6 and it is wrong for Phase 29, and the reason is the sentence that
 * follows it — *"those tables fill up when Phases 7, 14, 17 and 21 make them fillable"* — which has
 * now happened. This phase's brief is *"demo content sufficient to demonstrate every feature"*, and
 * three of the features this project spent phases building cannot be demonstrated empty. An account
 * area with no orders is a page of empty states. A product page with no reviews never renders
 * §13.1f's summary, its rating distribution, or the verified badge. A moderation queue with nothing
 * in it is a screen nobody can evaluate.
 *
 * So the objection is answered rather than overruled, and the answer has three parts:
 *
 * 1. **Every record is unmistakably demo data.** The three accounts are on `@example.test`, a
 *    reserved TLD that cannot receive mail (RFC 2606) — which matters, because Phase 19 will happily
 *    try. The six order numbers end in `DEMO01`…`DEMO06`, and that suffix is not merely a label:
 *    `ORDER_NUMBER_ALPHABET` in `lib/checkout/rules.ts` omits `I`, `O`, `0` and `1`, so a suffix
 *    containing `O`, `0` and `1` is one the live generator **could not have produced**. The demo set
 *    is therefore findable and removable with one query, and no real order can collide with it.
 * 2. **Nothing fictional points outside this database.** `stripeCheckoutSessionId`,
 *    `stripePaymentIntentId` and `trackingUrl` are left **empty** on every seeded order, and the
 *    tracking numbers read `NORTH01-DEMO-0000NN` rather than something shaped like a carrier
 *    reference. A `pi_…` with no counterpart in any Stripe account, or a plausible DHL number that
 *    resolves to nothing, is an hour of somebody's afternoon — the panel's own copy tells them to
 *    paste it into Stripe. Dates, addresses and amounts are invented freely, because those are claims
 *    *about* this row; an external identifier is a claim about somebody else's system.
 * 3. **`verifiedPurchase` is computed, never asserted.** Every review's badge comes from
 *    `hasPaidOrderFor` — the same function §21.1a's submission path uses — so the flag is true by
 *    construction rather than because this file says so, and it stays correct if the demo orders
 *    change. That is why orders are written before reviews.
 *
 * ### `AGENTS.md`'s *"only a signature-verified Stripe webhook marks an order paid"*
 *
 * Five of these orders are seeded straight into `paid` or `refunded`, which is worth stating plainly
 * rather than leaving a reader to notice. That rule governs the **application's write paths** — it
 * exists so that reaching the success page, or a staff member typing into a select box, cannot assert
 * that money moved. `paymentStatus` is closed to the browser by `nobodyField` and nothing here opens
 * it. What runs here is a local script, behind the **D-10** guard `seed.ts` installs, against the one
 * database `DATABASE_PUSH_TARGET` names, writing orders that never had a payment and that carry no
 * Stripe identifier claiming otherwise. If that guard is ever satisfied by a real database, this
 * module is the least of the problems.
 *
 * ### What it deliberately does not do
 *
 * - **It does not move inventory.** Phase 17 decrements stock at confirmed payment; these orders
 *   never went through it. That is the right outcome and not an oversight: the stock numbers in
 *   `seed.ts` are *authored* to reach §11.1b's three card states — the scarf sold out, the card
 *   holder on two units — and demo orders quietly eating into them would break the coverage those
 *   comments exist to protect.
 * - **It records no tax.** Tax is deferred to Stripe Tax at checkout (`lib/tax/provider.ts`), so an
 *   order that never reached Stripe has no tax figure to record. Zero is the truthful entry.
 * - **It seeds no address book, carts or wishlist rows.** Those are `/account` surfaces of their own
 *   and belong to whoever seeds them; nothing here depends on them.
 *
 * ### Idempotent, with one asymmetry that is the point
 *
 * Customers key on `email`, orders on `orderNumber`, order lines on `(order, sku)`, reviews on
 * `(product, customer)` — the same pair the UNIQUE index on `reviews` enforces. Running twice changes
 * nothing, and no order transitions, so `queueOrderEmails` sends nobody a second dispatch notice.
 *
 * The asymmetry: an order **line** is a frozen snapshot, and `hooks/freezeOrderLines.ts` refuses any
 * write that changes `sku`, `productName`, `variantLabel` or `unitPriceMinor` (§18.1d). So the prices
 * below are **written out as constants rather than read from the catalogue**. That is both more
 * correct — a receipt records what was charged on the day, not what the product costs now — and the
 * only version that re-seeds cleanly. If you edit a price here after seeding, the next run aborts on
 * that line with §18.1d's refusal; delete the demo orders first. A purchase record does not get
 * retro-edited, and a seed script is not an exception to that.
 *
 * The `product` and `variant` columns beside the snapshot are navigation rather than data
 * (`OrderItems.ts`), so `product` comes from the caller's real id map and `variant` is looked up by
 * SKU and left null when it does not resolve — which is exactly what happens after a colourway is
 * renamed, and is a state the order page is built to survive.
 *
 * ### The passwords are not in this file
 *
 * §29.1d: *"never commit real credentials."* They live in `docs/DEMO_ACCOUNTS.md`, git-ignored by
 * name for the same reason `docs/LOCAL_ADMIN.md` is. This module holds only the strings it must hand
 * to Payload; if you change one, change the doc, or the next person is holding a password that does
 * not exist.
 */

import type { Payload } from 'payload'

import type { PaymentStatus } from '../../src/lib/checkout/rules'
import type { FulfillmentStatus } from '../../src/lib/orders/rules'

import { hasPaidOrderFor } from '../../src/lib/reviews/read'
import { upsert } from './shared'

/* -------------------------------------------------------------------------------------------------
 * Customers — plan §29.1d
 * ---------------------------------------------------------------------------------------------- */

type CustomerKey = 'ines' | 'theo' | 'wren'

type DemoAddress = {
  city: string
  /** ISO 3166-1 alpha-2, and one of `SUPPORTED_COUNTRIES` — an unshippable demo address is a bug. */
  country: string
  firstName: string
  lastName: string
  line1: string
  line2: null | string
  phone: null | string
  postalCode: string
  region: null | string
}

type DemoCustomer = {
  address: DemoAddress
  email: string
  firstName: string
  key: CustomerKey
  lastName: string
  /**
   * Twelve characters minimum and never the email address — `lib/password-policy.ts`, enforced on
   * this path by the `beforeValidate` hook on `Customers` rather than only by the registration form.
   * Three words and four digits is the shape `docs/LOCAL_ADMIN.md` already uses: long, typeable, and
   * no composition rules, per NIST SP 800-63B.
   */
  password: string
  phone: null | string
}

/**
 * Three accounts, deliberately unalike — one long-standing shopper, one with a single delivered
 * order, one who has never completed a checkout. Between them they reach every state the account area
 * and the review system can be in, which one archetypal customer repeated three times would not.
 */
const DEMO_CUSTOMERS: DemoCustomer[] = [
  {
    address: {
      city: 'Brooklyn',
      country: 'US',
      firstName: 'Ines',
      lastName: 'Marchetti',
      line1: '87 Wythe Avenue',
      line2: 'Apt 4R',
      phone: '+1 718 555 0163',
      postalCode: '11249',
      region: 'NY',
    },
    email: 'ines.marchetti@example.test',
    firstName: 'Ines',
    key: 'ines',
    lastName: 'Marchetti',
    password: 'harbour-lantern-driftwood-4188',
    phone: '+1 718 555 0163',
  },
  {
    address: {
      city: 'Manchester',
      country: 'GB',
      firstName: 'Theo',
      lastName: 'Aldridge',
      line1: '12 Ardwick Green North',
      line2: null,
      phone: null,
      postalCode: 'M12 6FZ',
      region: null,
    },
    email: 'theo.aldridge@example.test',
    firstName: 'Theo',
    key: 'theo',
    lastName: 'Aldridge',
    password: 'saltgrass-copperline-quarry-6035',
    phone: null,
  },
  {
    address: {
      city: 'Portland',
      country: 'US',
      firstName: 'Wren',
      lastName: 'Calloway',
      line1: '1140 SE Morrison Street',
      line2: 'Unit 210',
      phone: null,
      postalCode: '97214',
      region: 'OR',
    },
    email: 'wren.calloway@example.test',
    firstName: 'Wren',
    key: 'wren',
    lastName: 'Calloway',
    password: 'northgale-tanner-pebble-2907',
    phone: null,
  },
]

/* -------------------------------------------------------------------------------------------------
 * Orders — plan §18's two axes, spanned
 * ---------------------------------------------------------------------------------------------- */

type DemoLine = {
  productName: string
  quantity: number
  /** The variant SKU as `seed.ts` composes it: `<product sku>-<COL>-<SIZE>`. */
  sku: string
  /** Resolved against the caller's `productIds` map. Never an invented id. */
  slug: string
  unitPriceMinor: number
  variantLabel: string
}

type DemoOrder = {
  carrier?: string
  /**
   * Supplied rather than left to the column default. `createdAt` is an ordinary `date` field once
   * Payload's collection sanitiser has added it, so the value written here is the value stored — and
   * six orders stamped within the same second, one of them already delivered, is the exact tell of a
   * generated fixture that §29.1c asks this demo not to be.
   */
  createdAt: string
  customer: CustomerKey
  deliveredAt?: string
  discountCode?: string
  discountMinor?: number
  fulfillmentStatus: FulfillmentStatus
  lines: DemoLine[]
  orderNumber: string
  paidAt?: string
  paymentStatus: PaymentStatus
  refundedAt?: string
  refundedMinor?: number
  shippedAt?: string
  shippingMethodCode: string
  shippingMethodLabel: string
  shippingMinor: number
  trackingNumber?: string
}

/**
 * **Six orders, chosen so the admin's order list demonstrates the machine rather than a column of
 * identical rows.**
 *
 * | Number | Payment | Fulfilment | What it is for |
 * |---|---|---|---|
 * | `…DEMO01` | paid | unfulfilled | Just landed. The state a picker filters the list to. |
 * | `…DEMO02` | paid | processing | Picked, not dispatched — and the only order carrying a discount code. |
 * | `…DEMO03` | paid | shipped | Carrier and tracking present, which is what §18.1c requires before this state is reachable at all. |
 * | `…DEMO04` | paid | delivered | Terminal. Three lines, so the frozen-snapshot view has something to show. |
 * | `…DEMO05` | refunded | delivered | A **partial** refund after delivery — `displayStatus` resolves this to "Refunded", which is DEV-03's own example. |
 * | `…DEMO06` | checkout_started | unfulfilled | An abandoned bag. Nothing was charged, and it is why one reviewer has no badge. |
 *
 * **The transition machine is not bypassed; it is not consulted.** `enforceOrderTransitions` returns
 * early on `operation !== 'update'` — a create is not a transition — so these land in their states
 * directly. Every one of them is nonetheless a state the machine can legally *reach*, which is the
 * property that matters: `DEMO03` and `DEMO04` carry the carrier and tracking number
 * `planFulfillmentChange` demands before `shipped`, and none of them is a combination somebody
 * clicking through the panel could not have produced. Seeding an unreachable state would put a row in
 * front of an operator that the rules then refuse to move.
 *
 * Shipping is the real rate card (`lib/shipping/rules.ts`): standard 995, waived above
 * `freeShippingThresholdMinor` (15000); express 1995 and never waived. Totals are computed from the
 * lines below rather than typed in, so they cannot disagree with them.
 */
const DEMO_ORDERS: DemoOrder[] = [
  {
    createdAt: '2026-09-04T09:10:00.000Z',
    customer: 'ines',
    fulfillmentStatus: 'unfulfilled',
    lines: [
      {
        productName: 'Cotton Tee',
        quantity: 2,
        sku: 'N01-CT-BLA-M',
        slug: 'cotton-tee',
        unitPriceMinor: 7500,
        variantLabel: 'Black / M',
      },
      {
        productName: 'Card Holder',
        quantity: 1,
        sku: 'N01-CH-ESP-ONESIZE',
        slug: 'card-holder',
        unitPriceMinor: 9500,
        variantLabel: 'Espresso / ONE SIZE',
      },
    ],
    orderNumber: 'N1-2609-DEMO01',
    paidAt: '2026-09-04T09:12:41.000Z',
    paymentStatus: 'paid',
    shippingMethodCode: 'standard',
    shippingMethodLabel: 'Standard',
    shippingMinor: 0,
  },
  {
    createdAt: '2026-09-02T14:40:00.000Z',
    customer: 'theo',
    /*
     * The one discounted order, and the reason it is only one: a demo where every order carries a
     * code says nothing about which orders had one. `seed.ts` seeds WELCOME10 **inactive** — "a live
     * discount code in seed data is a live discount code" — which is exactly the shape this needs: a
     * code that was live when it was used and has since been switched off. `discountCode` is the
     * snapshot that outlives it, the distinction `Orders.ts` draws between the text column and the
     * relationship beside it, and nothing else in the demo exercises it.
     */
    discountCode: 'WELCOME10',
    discountMinor: 1950,
    fulfillmentStatus: 'processing',
    lines: [
      {
        productName: 'Heavyweight Hoodie',
        quantity: 1,
        sku: 'N01-HH-CHA-L',
        slug: 'heavyweight-hoodie',
        unitPriceMinor: 19500,
        variantLabel: 'Charcoal / L',
      },
    ],
    orderNumber: 'N1-2609-DEMO02',
    paidAt: '2026-09-02T14:41:08.000Z',
    paymentStatus: 'paid',
    shippingMethodCode: 'standard',
    shippingMethodLabel: 'Standard',
    shippingMinor: 0,
  },
  {
    /*
     * Express, so that one order in the list is not free delivery. `express` is `waivable: false`, so
     * the 1995 stands even well above the threshold — the rate card behaving as written rather than
     * an arithmetic slip, and worth having a row that proves it.
     */
    carrier: 'UPS',
    createdAt: '2026-08-29T11:05:00.000Z',
    customer: 'ines',
    fulfillmentStatus: 'shipped',
    lines: [
      {
        productName: 'Field Jacket',
        quantity: 1,
        sku: 'N01-FJ-GRA-M',
        slug: 'field-jacket',
        unitPriceMinor: 48000,
        variantLabel: 'Graphite / M',
      },
      {
        productName: 'Cashmere Scarf',
        quantity: 1,
        sku: 'N01-CS-OAT-ONESIZE',
        slug: 'cashmere-scarf',
        unitPriceMinor: 21000,
        variantLabel: 'Oat / ONE SIZE',
      },
    ],
    orderNumber: 'N1-2608-DEMO03',
    paidAt: '2026-08-29T11:06:23.000Z',
    paymentStatus: 'paid',
    shippedAt: '2026-08-31T08:20:00.000Z',
    shippingMethodCode: 'express',
    shippingMethodLabel: 'Express',
    shippingMinor: 1995,
    trackingNumber: 'NORTH01-DEMO-000003',
  },
  {
    carrier: 'Royal Mail',
    createdAt: '2026-08-18T16:22:00.000Z',
    customer: 'theo',
    deliveredAt: '2026-08-21T13:55:00.000Z',
    fulfillmentStatus: 'delivered',
    lines: [
      {
        productName: 'Selvedge Denim',
        quantity: 1,
        sku: 'N01-SD-IND-32',
        slug: 'selvedge-denim',
        unitPriceMinor: 23500,
        variantLabel: 'Indigo / 32',
      },
      {
        productName: 'Pleated Trouser',
        quantity: 1,
        sku: 'N01-PT-GRA-32',
        slug: 'pleated-trouser',
        unitPriceMinor: 26000,
        variantLabel: 'Graphite / 32',
      },
      {
        productName: 'Cotton Tee',
        quantity: 1,
        sku: 'N01-CT-CHA-L',
        slug: 'cotton-tee',
        unitPriceMinor: 7500,
        variantLabel: 'Chalk / L',
      },
    ],
    orderNumber: 'N1-2608-DEMO04',
    paidAt: '2026-08-18T16:23:02.000Z',
    paymentStatus: 'paid',
    shippedAt: '2026-08-19T09:40:00.000Z',
    shippingMethodCode: 'standard',
    shippingMethodLabel: 'Standard',
    shippingMinor: 0,
    trackingNumber: 'NORTH01-DEMO-000004',
  },
  {
    carrier: 'UPS',
    createdAt: '2026-07-30T10:02:00.000Z',
    customer: 'ines',
    deliveredAt: '2026-08-02T11:30:00.000Z',
    fulfillmentStatus: 'delivered',
    lines: [
      {
        productName: 'Merino Crew',
        quantity: 1,
        sku: 'N01-MC-INK-L',
        slug: 'merino-crew',
        unitPriceMinor: 22000,
        variantLabel: 'Ink / L',
      },
      {
        productName: 'Oxford Shirt',
        quantity: 1,
        sku: 'N01-OS-CHA-M',
        slug: 'oxford-shirt',
        unitPriceMinor: 16500,
        variantLabel: 'Chalk / M',
      },
    ],
    orderNumber: 'N1-2607-DEMO05',
    paidAt: '2026-07-30T10:03:12.000Z',
    /* `paid`, not `refunded`: a partial refund leaves the order paid (Phase 36, R1-09). */
    paymentStatus: 'paid',
    refundedAt: '2026-08-12T15:10:00.000Z',
    /*
     * The shirt went back and the crew did not, so this is 16500 of a 38500 order. Partial refunds
     * are the ordinary case — `Orders.refundedMinor` says so in as many words — and a demo where the
     * refunded amount always equals the total never shows anyone that they are two different numbers.
     */
    refundedMinor: 16500,
    shippedAt: '2026-07-31T07:45:00.000Z',
    shippingMethodCode: 'standard',
    shippingMethodLabel: 'Standard',
    shippingMinor: 0,
    trackingNumber: 'NORTH01-DEMO-000005',
  },
  {
    /*
     * **The abandoned bag, and it earns its place twice.** It puts one non-paid row in the order list,
     * and one "Checkout started — nothing has been charged yet" entry in an account's history
     * (`lib/account/orders.ts` hides only drafts). It is also why Wren's two reviews carry no verified
     * badge: `hasPaidOrderFor` excludes every `FINALISABLE_STATUS` and `checkout_started` is one — so
     * the badge is missing because the purchase genuinely never happened, not because this file
     * switched it off.
     *
     * No `cart` and no `stripeCheckoutSessionId`, which a real order in this state would carry. The
     * alternative is inventing a `cs_…` that names nothing in any Stripe account.
     */
    createdAt: '2026-09-08T19:47:00.000Z',
    customer: 'wren',
    fulfillmentStatus: 'unfulfilled',
    lines: [
      {
        productName: 'Wool Overshirt',
        quantity: 1,
        sku: 'N01-WO-MOS-M',
        slug: 'wool-overshirt',
        unitPriceMinor: 34000,
        variantLabel: 'Moss / M',
      },
      {
        productName: 'Card Holder',
        quantity: 1,
        sku: 'N01-CH-ESP-ONESIZE',
        slug: 'card-holder',
        unitPriceMinor: 9500,
        variantLabel: 'Espresso / ONE SIZE',
      },
    ],
    orderNumber: 'N1-2609-DEMO06',
    paymentStatus: 'checkout_started',
    shippingMethodCode: 'standard',
    shippingMethodLabel: 'Standard',
    shippingMinor: 0,
  },
]

/* -------------------------------------------------------------------------------------------------
 * Reviews — plan §29.1c, §21.1b
 * ---------------------------------------------------------------------------------------------- */

type DemoReview = {
  body: string
  createdAt: string
  customer: CustomerKey
  /** The public byline, deliberately not the account name — `Reviews.displayName`. Max 60. */
  displayName: string
  product: string
  rating: number
  status: 'approved' | 'pending' | 'rejected'
  /** Optional by §6.1j, and left off several of these on purpose. Max 120. */
  title?: string
}

/**
 * **Eleven reviews over nine products, and none of them written in the brand's voice.**
 *
 * That last part is the authoring decision worth stating. Everything else this seed writes is
 * NORTH / 01 talking — short, declarative, material first. A review is not: it is one person being
 * specific about a thing they own, at whatever length they felt like, and a page of reviews that all
 * sound like the product description reads as marketing rather than as evidence. So these run long
 * and short, some carry a headline and some do not, and two of them are arguments with the copy.
 *
 * **The ratings are 2, 2, 3, 3, 4, 4, 4, 4, 5, 5, 5.** No wall of fives — which demonstrates nothing
 * and is the first thing a sceptical reader checks for — and §13.1f's distribution bars have
 * something to draw. The two low scores are specific and fair: an indigo transfer the product page
 * genuinely does not warn about, and a fit note that undersells how relaxed a trouser is.
 *
 * **Two are unmoderated, and neither is unmoderated for being negative.** The `pending` one is a
 * four-star. The `rejected` one is rejected because it is a delivery complaint asking for a phone
 * call rather than a review of the product — which is what §21.1b's rejected state is for
 * (`Reviews.ts`: *"keeps the review on file and off the site"*). The published two-star sitting
 * beside it is the proof that a low rating is not what gets rejected here.
 *
 * `verifiedPurchase` appears nowhere in this data. It is asked of `hasPaidOrderFor` per review, so a
 * badge exists only where an order actually paid for that product — see the module docblock.
 */
const DEMO_REVIEWS: DemoReview[] = [
  {
    body:
      'Wore it every day through a wet March and it came out of that looking better than it went in. ' +
      'The cuffs have softened and the collar has not, which is the trick I was paying for. I sized ' +
      'up expecting to need room for a crew underneath and did not — the regular fit already allows ' +
      'for one.',
    createdAt: '2026-09-06T18:22:00.000Z',
    customer: 'ines',
    displayName: 'Ines M.',
    product: 'field-jacket',
    rating: 5,
    status: 'approved',
    title: 'Holds its shape',
  },
  {
    /* Unverified and approved — the ordinary case, and the one that shows what a missing badge looks like. */
    body:
      'A friend has had this one since spring and I have borrowed it enough to have an opinion. The ' +
      'cotton is drier than the photographs suggest, almost papery for the first week. It is not a ' +
      'soft jacket and it is not trying to be. Four rather than five because the sleeve runs long on me.',
    createdAt: '2026-09-07T09:41:00.000Z',
    customer: 'wren',
    displayName: 'W.C.',
    product: 'field-jacket',
    rating: 4,
    status: 'approved',
  },
  {
    body:
      'The wash is not a gimmick — none of the first-month stiffness you get from an unwashed oxford, ' +
      'and the collar rolls without help. I would have liked another centimetre in the sleeve.',
    createdAt: '2026-08-14T20:05:00.000Z',
    customer: 'ines',
    displayName: 'Ines M.',
    product: 'oxford-shirt',
    rating: 4,
    status: 'approved',
    title: 'Arrives broken in',
  },
  {
    body:
      'The merino is genuinely fine and it layers under a jacket with no bulk at all, which is what I ' +
      'bought it for. But the body is cut short and it rides up when I reach for anything above my ' +
      'head, and on a slim fit at this price I expected that to have been resolved. It has also begun ' +
      'to pill under the arms after six wears.',
    createdAt: '2026-08-16T12:30:00.000Z',
    customer: 'ines',
    displayName: 'Ines M.',
    product: 'merino-crew',
    rating: 3,
    status: 'approved',
    title: 'Lovely knit, short body',
  },
  {
    body:
      'The shoulder seam is still where it was on the day it arrived, which is more than I can say ' +
      'for any other tee I own. A dozen washes in.',
    createdAt: '2026-08-25T07:58:00.000Z',
    customer: 'theo',
    displayName: 'Theo A.',
    product: 'cotton-tee',
    rating: 5,
    status: 'approved',
  },
  {
    body:
      'Heavier than most, which I like. The neck is tight over the head for the first few wears and ' +
      'then settles exactly where it should.',
    createdAt: '2026-09-07T21:14:00.000Z',
    customer: 'ines',
    displayName: 'Ines M.',
    product: 'cotton-tee',
    rating: 4,
    status: 'approved',
  },
  {
    body:
      'No complaint about the make. The denim is heavy, the stitching is clean, and it will outlast ' +
      'me. What is not said anywhere on this page is how much raw indigo transfers — a pale sofa and ' +
      'a canvas tote both have marks that have not come out, and I had only had them a week before I ' +
      'thought to read up on it. The two stars are for the missing warning, not for the jeans.',
    createdAt: '2026-08-27T19:03:00.000Z',
    customer: 'theo',
    displayName: 'Theo A.',
    product: 'selvedge-denim',
    rating: 2,
    status: 'approved',
    title: 'Warn people about the indigo',
  },
  {
    /* Pending, so the moderation queue is not an empty screen the first time somebody opens it. */
    body:
      'Five hundred grams is not a joke. It takes two days to dry and it is worth it, and the hood ' +
      'holds its shape instead of collapsing flat against your back. A star off because the cuffs are ' +
      'looser than the body and they have stretched out by the end of a day.',
    createdAt: '2026-09-08T16:47:00.000Z',
    customer: 'theo',
    displayName: 'Theo A.',
    product: 'heavyweight-hoodie',
    rating: 4,
    status: 'pending',
    title: 'Five hundred grams is not a joke',
  },
  {
    body:
      'The cloth is very good and the pleat sits flat all day. The rise is higher than the ' +
      'photographs suggest and the leg is wider — this is a relaxed trouser and the fit note could ' +
      'say so more plainly. I am keeping them. They are not what I had ordered in my head.',
    createdAt: '2026-08-26T08:12:00.000Z',
    customer: 'theo',
    displayName: 'Theo A.',
    product: 'pleated-trouser',
    rating: 3,
    status: 'approved',
  },
  {
    body:
      'Two metres is longer than it sounds and it is the whole point — it wraps twice with no bulk at ' +
      'the throat. Warm without weight, exactly as described.',
    createdAt: '2026-09-05T13:26:00.000Z',
    customer: 'ines',
    displayName: 'Ines M.',
    product: 'cashmere-scarf',
    rating: 5,
    status: 'approved',
  },
  {
    /*
     * Rejected, and coherent with `…DEMO06`: this customer's only order never completed checkout, so
     * they are chasing a parcel nobody was ever asked to send. It is a support request wearing a
     * review, it asks to be telephoned, and it says nothing about the product — which is why it is
     * off the site and still on file.
     */
    body:
      'Ordered on the 2nd and it still has not arrived and nobody has answered either of my emails. ' +
      'Can someone please call me back on the number on my account. I will change this once it turns up.',
    createdAt: '2026-09-09T10:19:00.000Z',
    customer: 'wren',
    displayName: 'Wren',
    product: 'card-holder',
    rating: 2,
    status: 'rejected',
    title: 'Still waiting',
  },
]

/* -------------------------------------------------------------------------------------------------
 * The seeding itself
 * ---------------------------------------------------------------------------------------------- */

export type SeedCommerceOptions = {
  /**
   * Product slug → id, from the caller. Every order line and every review resolves through this, so
   * this module never invents a product id, and a slug the catalogue does not have is skipped with a
   * warning rather than written as a dangling reference.
   */
  productIds: Map<string, number>
}

export type SeedCommerceResult = {
  customers: number
  orders: number
  reviews: number
}

/**
 * Writes the demo accounts, orders and reviews. Safe to run twice.
 *
 * **Order matters inside here as much as outside it.** Customers first, because an order needs one.
 * Orders before reviews, because `hasPaidOrderFor` is what decides each badge, and asking it before
 * the orders exist would answer `false` eleven times.
 */
export async function seedCommerce(
  payload: Payload,
  options: SeedCommerceOptions,
): Promise<SeedCommerceResult> {
  const { productIds } = options

  // ------------------------------------------------------------------ customers
  const customerIds = new Map<CustomerKey, number>()

  for (const spec of DEMO_CUSTOMERS) {
    customerIds.set(
      spec.key,
      await upsert({
        payload,
        collection: 'customers',
        where: { email: { equals: spec.email } },
        data: {
          accountStatus: 'active',
          email: spec.email,
          firstName: spec.firstName,
          lastName: spec.lastName,
          /*
           * Re-sent on every run, which is deliberate rather than careless: it means the password in
           * `docs/DEMO_ACCOUNTS.md` is true again after a re-seed, whatever anybody changed it to
           * while demonstrating the reset flow.
           */
          password: spec.password,
          phone: spec.phone,
        },
      }),
    )
  }

  payload.logger.info(`Demo customers: ${customerIds.size} (passwords in docs/DEMO_ACCOUNTS.md)`)

  // -------------------------------------------------------------------- orders
  //
  // One lookup for every variant the six orders mention. `variant` on an order line is navigation and
  // is allowed to resolve to nothing (`OrderItems.ts`), so a SKU that no longer exists costs that line
  // its back-link and nothing else — the snapshot beside it is the record.
  const skus = [...new Set(DEMO_ORDERS.flatMap((order) => order.lines.map((line) => line.sku)))]

  const { docs: variantDocs } = await payload.find({
    collection: 'product-variants',
    depth: 0,
    overrideAccess: true,
    pagination: false,
    where: { sku: { in: skus } },
  })

  const variantIds = new Map<string, number>()

  for (const doc of variantDocs) {
    variantIds.set(doc.sku, doc.id)
  }

  /**
   * The promotion behind `…DEMO02`'s discount code, if it is still there. Looked up rather than
   * passed in, because the relationship is optional and the `discountCode` snapshot beside it is what
   * the order actually depends on — which is the whole reason `Orders.ts` carries both columns.
   */
  const promotionIdByCode = new Map<string, number>()

  for (const code of new Set(DEMO_ORDERS.flatMap((order) => order.discountCode ?? []))) {
    const { docs } = await payload.find({
      collection: 'promotions',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { code: { equals: code } },
    })

    const found = docs[0]

    if (found) {
      promotionIdByCode.set(code, found.id)
    }
  }

  let orderCount = 0
  let lineCount = 0

  for (const spec of DEMO_ORDERS) {
    const customer = DEMO_CUSTOMERS.find((candidate) => candidate.key === spec.customer)
    const customerId = customerIds.get(spec.customer)
    const missing = spec.lines.filter((line) => !productIds.has(line.slug))

    if (!customer || customerId === undefined || missing.length > 0) {
      /*
       * The whole order is skipped rather than the offending line. Dropping one line would leave the
       * stored subtotal disagreeing with the lines beneath it, and an order whose totals do not add
       * up is worse demo data than an order that is not there.
       */
      payload.logger.warn(
        `Demo order ${spec.orderNumber} skipped — the catalogue has no ${
          missing.map((line) => line.slug).join(', ') || spec.customer
        }.`,
      )
      continue
    }

    const subtotalMinor = spec.lines.reduce(
      (sum, line) => sum + line.unitPriceMinor * line.quantity,
      0,
    )
    const discountMinor = spec.discountMinor ?? 0
    /* Deferred to Stripe Tax at checkout, and no checkout happened. See the module docblock. */
    const taxMinor = 0
    const totalMinor = subtotalMinor - discountMinor + spec.shippingMinor + taxMinor

    const address = {
      city: customer.address.city,
      company: null,
      country: customer.address.country,
      firstName: customer.address.firstName,
      lastName: customer.address.lastName,
      line1: customer.address.line1,
      line2: customer.address.line2,
      phone: customer.address.phone,
      postalCode: customer.address.postalCode,
      region: customer.address.region,
    }

    const promotionId =
      spec.discountCode === undefined ? undefined : promotionIdByCode.get(spec.discountCode)

    const orderId = await upsert({
      payload,
      collection: 'orders',
      where: { orderNumber: { equals: spec.orderNumber } },
      data: {
        /* Billing follows shipping, which is what checkout does when nobody enters a second address. */
        billingAddress: address,
        /* No cart: these were never raised from one, and a fabricated id would point at nothing. */
        cart: null,
        carrier: spec.carrier ?? null,
        createdAt: spec.createdAt,
        currency: 'USD',
        customer: customerId,
        deliveredAt: spec.deliveredAt ?? null,
        discountCode: spec.discountCode ?? null,
        discountMinor,
        email: customer.email,
        fulfillmentStatus: spec.fulfillmentStatus,
        orderNumber: spec.orderNumber,
        paidAt: spec.paidAt ?? null,
        paymentStatus: spec.paymentStatus,
        ...(promotionId === undefined ? {} : { promotion: promotionId }),
        refundedAt: spec.refundedAt ?? null,
        /*
         * `null`, not `0`, on everything that was never refunded — `Orders.refundedMinor` draws that
         * line explicitly: empty means no refund has been reported, while a literal zero would mean a
         * refund of nothing was reported, which is a different and much stranger claim.
         */
        refundedMinor: spec.refundedMinor ?? null,
        shippedAt: spec.shippedAt ?? null,
        shippingAddress: address,
        shippingMethodCode: spec.shippingMethodCode,
        shippingMethodLabel: spec.shippingMethodLabel,
        shippingMinor: spec.shippingMinor,
        /* Empty by decision, not omission — no invented handles into Stripe. See the module docblock. */
        stripeCheckoutSessionId: null,
        stripePaymentIntentId: null,
        subtotalMinor,
        taxMinor,
        totalMinor,
        trackingNumber: spec.trackingNumber ?? null,
        /* Likewise: a tracking URL is a live link into a carrier's system, and this parcel is fiction. */
        trackingUrl: null,
      },
    })

    orderCount += 1

    for (const line of spec.lines) {
      /*
       * Keyed on `(order, sku)`. There is no unique index behind that — it is a natural key by
       * construction, because no demo order lists the same variant twice. If one ever needs to, split
       * it into two orders rather than teaching this key to count.
       */
      await upsert({
        payload,
        collection: 'order-items',
        where: { and: [{ order: { equals: orderId } }, { sku: { equals: line.sku } }] },
        data: {
          lineTotalMinor: line.unitPriceMinor * line.quantity,
          order: orderId,
          product: productIds.get(line.slug),
          productName: line.productName,
          quantity: line.quantity,
          sku: line.sku,
          unitPriceMinor: line.unitPriceMinor,
          variant: variantIds.get(line.sku) ?? null,
          variantLabel: line.variantLabel,
        },
      })

      lineCount += 1
    }
  }

  payload.logger.info(`Demo orders: ${orderCount}, order lines: ${lineCount}`)

  // ------------------------------------------------------------------- reviews
  let reviewCount = 0

  for (const spec of DEMO_REVIEWS) {
    const productId = productIds.get(spec.product)
    const customerId = customerIds.get(spec.customer)

    if (productId === undefined || customerId === undefined) {
      payload.logger.warn(`Demo review for ${spec.product} skipped — no such product in the seed.`)
      continue
    }

    /*
     * §21.1a's *"match customer to a paid order containing the product"*, asked of the function the
     * storefront asks rather than answered by a boolean typed into the data above. It counts `paid`
     * and `refunded` and nothing else — DEV-69 — so Wren, whose only order never left
     * `checkout_started`, gets no badge, and Ines gets one on the shirt she sent back.
     */
    const verifiedPurchase = await hasPaidOrderFor(payload, customerId, productId)

    await upsert({
      payload,
      collection: 'reviews',
      where: {
        and: [{ product: { equals: productId } }, { customer: { equals: customerId } }],
      },
      data: {
        body: spec.body,
        createdAt: spec.createdAt,
        customer: customerId,
        displayName: spec.displayName,
        product: productId,
        rating: spec.rating,
        status: spec.status,
        title: spec.title ?? null,
        verifiedPurchase,
      },
    })

    reviewCount += 1
  }

  payload.logger.info(`Demo reviews: ${reviewCount}`)

  return { customers: customerIds.size, orders: orderCount, reviews: reviewCount }
}
