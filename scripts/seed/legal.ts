import {
  DOMESTIC_COUNTRY,
  SHIPPING_METHODS,
  SUPPORTED_COUNTRIES,
} from '../../src/lib/shipping/rules'

/**
 * **The privacy notice and the terms of sale, as seeded content.**
 *
 * Gap **G-19** recorded that the footer's legal row was empty because a privacy policy and a set of
 * terms are *"legal text somebody has to write and be accountable for"*. On 2026-09-11 the owner
 * supplied the decisions behind them — a real contact address (`admin@micagrowth.com`) and a
 * thirty-day retention window for unpaid orders — and asked for the text to be written. It was drafted
 * from the code, not by the owner and not by a lawyer, and revised on 2026-09-13 after a review found
 * sentences the code did not back. It lives in `site-settings` (Site Settings → Policies) so the owner
 * can correct it without a developer, and renders at `/legal/privacy` and `/legal/terms`.
 *
 * ### It is a starting draft, not legal advice
 *
 * **The owner is accountable for it.** Somebody qualified should read both documents before the shop
 * takes live orders. Both still say that the registered company name and address — and, in the
 * terms, the governing law — are to be confirmed; `TODO.md` §9 keeps that in front of the owner.
 *
 * ### Every sentence is meant to be true of the code, or a promise staff can keep by hand
 *
 * Read off the implementation rather than borrowed from a template. When one of these changes, the
 * notice is wrong until the text changes too — here, **and in the production admin**, because the
 * seed never reaches production (`TODO.md` §12):
 *
 * | Sentence | What makes it true |
 * |---|---|
 * | Two cookies, seven days and thirty days | `Customers.ts` `tokenExpiration`; `lib/cart/cart.ts` `CART_COOKIE_MAX_AGE` |
 * | Saved products, recently viewed, recent searches on the device | `lib/wishlist/rules.ts`, `lib/recently-viewed/rules.ts`, `lib/catalog/search.ts` — `localStorage` |
 * | IP addresses: not in our database; received by the services the browser reaches | nothing in `src/` stores one. PostHog keeps it unless its *Discard client IP data* project setting is on, so the text says *may* either way |
 * | Measurement: identifiers, the order number on a purchase, what is redacted | `components/analytics/analytics.tsx`, `lib/analytics/private-paths.ts`, `lib/analytics/redact-for-vendors.ts`, `lib/analytics/events.ts` |
 * | Bags deleted after thirty days; unpaid orders thirty days after their last change, unless held | `lib/cart/sweep.ts` — **only once `CRON_SECRET` is set in production**, because the cron is refused without it |
 * | Email copies kept, with no end date | `EmailMessages.ts`; `docs/SECURITY.md` §4 decision 2 is still open |
 * | Account deletion is permanent, and what it leaves | `Customers.ts` `beforeDelete` — and the staff procedure in `docs/CMS.md` §10, which is what makes *"permanently"* true |
 * | Tax included in the total on Stripe's page | `lib/tax/provider.ts`, `lib/checkout/session.ts` (one line item at the server's total) |
 * | Delivery countries, which methods are free, overnight's scope | `lib/shipping/rules.ts` — checked below, at seed time |
 * | The $150 free-delivery figure | `scripts/seed.ts` `freeShippingThresholdMinor: 15000`. An admin-only setting: if production's differs, the live sentence must too |
 *
 * `docs/SECURITY.md` is the longer version of the same facts and is what to re-read when either
 * changes.
 *
 * Plain paragraphs, because `rich()` builds paragraphs — no headings, no bold. Each one opens with
 * its subject so the page still scans.
 */

/* -------------------------------------------------------------------------------------------------
 * The one rule this file can check for itself
 * ---------------------------------------------------------------------------------------------- */

/**
 * The country names the terms use, keyed by the codes checkout accepts.
 *
 * The delivery sentence used to say *"worldwide"* while `SUPPORTED_COUNTRIES` listed eight countries,
 * and nothing noticed. The sentence is now **built from that list**, and a code this map cannot name
 * stops the seed with a message — so a widened carrier list cannot silently leave the terms behind.
 */
const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  AU: 'Australia',
  CA: 'Canada',
  DE: 'Germany',
  FR: 'France',
  GB: 'the United Kingdom',
  IE: 'Ireland',
  NL: 'the Netherlands',
  US: 'the United States',
}

function deliveryCountries(): string {
  const names = SUPPORTED_COUNTRIES.map((code) => {
    const name = COUNTRY_NAMES[code]

    if (name === undefined) {
      throw new Error(
        `seed/legal.ts: checkout now accepts ${code}, which the terms of sale do not name. Add it to COUNTRY_NAMES and update the live terms (TODO.md §12).`,
      )
    }

    return name
  })

  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * **The delivery paragraph names methods and says which one is free and which one is domestic.**
 * Those are properties of the rate card, so the seed refuses to write the paragraph if the card no
 * longer matches it — only Standard waivable, only Overnight domestic, and domestic meaning the US.
 */
function assertRateCardMatchesTerms(): void {
  const names = SHIPPING_METHODS.map((method) => method.name).join(', ')
  const waivable = SHIPPING_METHODS.filter((method) => method.waivable)
    .map((method) => method.name)
    .join(', ')
  const domesticOnly = SHIPPING_METHODS.filter((method) => method.domesticOnly)
    .map((method) => method.name)
    .join(', ')

  if (
    names !== 'Standard, Express, Overnight' ||
    waivable !== 'Standard' ||
    domesticOnly !== 'Overnight' ||
    DOMESTIC_COUNTRY !== 'US'
  ) {
    throw new Error(
      `seed/legal.ts: the rate card changed (methods: ${names}; free by threshold or code: ${waivable}; domestic only: ${domesticOnly} in ${DOMESTIC_COUNTRY}). Rewrite the Delivery paragraph of the terms, then the live copy (TODO.md §12).`,
    )
  }
}

assertRateCardMatchesTerms()

/* -------------------------------------------------------------------------------------------------
 * The privacy notice
 * ---------------------------------------------------------------------------------------------- */

export const PRIVACY_PARAGRAPHS: readonly string[] = [
  'NORTH / 01 is an online-only clothing shop. This notice explains what personal information we collect when you browse or buy, why we hold it, who else receives it, and how long we keep it. Last updated 13 September 2026.',
  'Contact. Write to admin@micagrowth.com with any question about your information, or with any of the requests described below. There are no shops, so every question is answered by email. Our registered company name and address will be added to this notice before the shop takes live orders.',
  'Browsing. You can browse without an account. When you first add something to your bag, your browser is given a cookie holding a random code, and the bag itself is kept on our server under that code. Some things are kept only in your own browser, as described under Cookies and device storage. We do not build advertising profiles.',
  'Your IP address. We do not store IP addresses in our own database. Your browser does send your IP address to every service it connects to while you use the site, among them our hosting provider (Vercel), our image service (Cloudinary), the bot check on our forms (Cloudflare Turnstile, which we also pass it to when we check a form), Stripe’s payment page and, where measurement is switched on, Google Analytics and PostHog. Those services may keep it, for example in their logs or to estimate roughly where you are, under their own privacy terms.',
  'An account. Your first and last name, your email address, and your password, which is stored only as a salted one-way hash we cannot read. Then what you add yourself: delivery addresses (each may include a phone number), saved products, and reviews. A review is published under the display name you choose, not your account name.',
  'Buying. The email address, name, delivery address and optional phone number you give at checkout; what you bought, what you paid, the delivery method, any discount code, and the tax calculated for your address. These details are copied onto the order, so changing your account later does not change it. We never see or hold your card details: payment happens on Stripe’s own page. Stripe tells us whether the payment succeeded, the amount, its payment reference, and any refund.',
  'Emails and the newsletter. We send account and order emails, such as a welcome, an order confirmation, dispatch and delivery notices, refund notices and password-reset links. If you join the newsletter we keep your email address, when you joined and where on the site you signed up.',
  'Why we hold it. To keep your bag, to take, send and refund your order, to email you about your account and your order, to answer your questions, to publish a review if you write one, to keep our forms free of automated abuse, to find and fix errors, to understand how the shop is used, and to keep the sales records tax law requires.',
  'Who else receives it. Stripe (payment, for which we send it your email address and the order total, and the tax calculation, for which we send it your delivery address); Resend (it sends our emails, so it receives your email address and what each email says); Cloudflare Turnstile (the bot check on our sign-in, registration, password-reset, review and newsletter forms); Cloudinary (our images); Algolia (product search: it holds our catalogue and receives the words you search for); Vercel (hosting, and Speed Insights, which measures how fast pages load); Neon (our database); Sentry (error reports, with the personal details we can recognise, such as names, email addresses, addresses and passwords, removed before they are sent); and Google Analytics and PostHog (visitor measurement). Each handles what it receives under its own privacy terms. We do not sell personal information, and we do not use it for advertising.',
  'Measurement. Where measurement is switched on, Google Analytics and PostHog record the pages you visit and what you do in the shop, such as the products you view, add to your bag or save, your searches and filters, and your purchases, including what you bought, the amounts and the order number. The order number lets us match a purchase in those reports to the order in our own records. Each service gives your browser a random identifier so that visits from the same browser can be counted together, and each receives technical details such as your browser type, screen size and language. We do not give them your name, email address or postal address. Google Analytics runs with Google signals and ad personalisation switched off, and PostHog runs without session recording or click tracking. Before a web address is reported, values in it that we recognise as sensitive, such as password-reset links, email addresses, order references and long numbers, are replaced; the page path itself is sent as it is, so the page for one of your orders reports that order’s number. Pages that carry a password-reset link are not reported to Google Analytics, PostHog or Speed Insights. Speed Insights receives the address of each page it measures with everything after the path removed.',
  'Cookies and device storage. We set two cookies of our own: one keeps you signed in, for up to seven days, and one identifies your bag, for thirty days. Your browser’s local storage for this site keeps the products you save without signing in, the products you have recently viewed, and your recent searches. Those lists stay on your device: your browser sends us product codes from them only so that we can show you those products, and we do not keep them, except that products you saved move to your account when you sign in. Session storage holds a note that stops a purchase being counted twice, and is cleared when you close the tab. Where measurement is switched on, Google Analytics sets its own cookies, which can last up to two years, and PostHog keeps its identifier in a cookie that lasts a year from your last visit, and in local and session storage. You can clear all of this by clearing this site’s data in your browser; the sign-in and bag cookies are what make the shop work.',
  'How long we keep it. A bag that is never checked out expires thirty days after it was created, and is then deleted by a daily clean-up. An order that was started but never paid for is deleted, with the name, email address and addresses on it, once thirty days have passed since it last changed. The exception is an unpaid order that a payment reached but could not be matched to: it is not deleted automatically, and is kept as a record of that payment. Orders that were paid are kept as financial records. Copies of the emails we send you, meaning your email address, the subject and what the email said (such as your first name or the details of an order), are kept as a record of what we sent, for now with no fixed deletion date; a password-reset email is recorded without its link. Reviews stay until we remove them, which you can ask us to do. If you join the newsletter we keep the record of that consent, and of any unsubscribe, so that you are not added back by mistake. An account stays until you ask us to delete it. Deleted information can remain for a short time in our database provider’s recovery history before it is gone.',
  'Your choices. Write to admin@micagrowth.com to ask for a copy of what we hold about you, to correct it, to leave the newsletter, to have a review removed, or to have your account deleted. You can add and remove saved addresses, and save or remove saved products, yourself in your account. We may ask you to confirm a request from the email address we hold for you. When we delete an account at your request we delete it permanently: your profile, saved addresses, saved products and reviews are removed. What remains is what the section above says we keep: orders, which keep the name, email address and addresses they were placed with; the copies of emails we sent you; and your newsletter record, if you had one. Stripe and the other services above keep their own records under their own terms.',
  'Children. This shop is not meant for children, and we do not knowingly collect their information.',
  'Where it is held. Your information is stored and processed in the United States, and in the other countries where the services above operate.',
  'Changes. If we change this notice, we will publish the new version on this page and change the date at the top.',
]

/* -------------------------------------------------------------------------------------------------
 * The terms of sale
 * ---------------------------------------------------------------------------------------------- */

export const TERMS_PARAGRAPHS: readonly string[] = [
  'These terms cover buying from NORTH / 01, an online-only clothing shop. Checkout links to them before you pay, and placing an order means you accept them. Last updated 13 September 2026.',
  'Ordering. Putting something in your bag does not reserve it. Your order is accepted when your payment succeeds, and we email you a confirmation. Reaching the confirmation page is not the same as paying: the payment itself is what counts.',
  'If something sells out. Occasionally a piece sells out between your payment and our packing it. If that happens we contact you and refund whatever we cannot send.',
  'Prices and tax. Prices are in US dollars and do not include tax. Tax is calculated from your delivery address and included in the total you confirm on Stripe’s payment page. If a price changes while something is in your bag, you pay the price shown at checkout. Payment is taken by Stripe, and we never see your card details.',
  `Delivery. We deliver to ${deliveryCountries()}, and checkout will not accept an address anywhere else. Standard and Express delivery are available to all of them; Overnight is available in the United States only. Standard delivery is free when your order reaches the free-delivery threshold shown in your bag ($150 when these terms were last updated), counted after any discount, or with a free-delivery code; otherwise it is charged. Express and Overnight are always charged. Delivery times are estimates, and they run from dispatch rather than from your order.`,
  'Returns. Anything unworn, with its tags on, can be returned within thirty days of delivery. Returns are arranged by email at admin@micagrowth.com; there is no online return form. We refund to the original payment method once the return has reached us and been checked.',
  'Faulty or wrong items. If something arrives faulty, damaged, or not what you ordered, tell us and we will put it right. Nothing in these terms affects the rights the law gives you.',
  'Discount codes. One code per order. A code may need a minimum spend, may apply only to particular products, may run between set dates, may be limited in how many times it can be used, and may be withdrawn at any time. A free-delivery code makes Standard delivery free.',
  'Your account. Keep your password to yourself: you are responsible for what is done through your account. Tell us if you think somebody else has used it.',
  'Reviews. What you write stays yours; submitting a review lets us publish it beside the product under the display name you choose. Reviews are read before they appear, and we will not publish anything abusive, off-topic, or that identifies somebody else. We do not edit what you wrote: we either publish it or we do not. To have a review taken down, write to admin@micagrowth.com.',
  'Our content. The photographs, words and designs on this site are ours. Please do not copy them for commercial use.',
  'Availability. We may change or withdraw products, prices, or parts of this site at any time, and we do not promise the site will always be available.',
  'Our responsibility. We are responsible for loss we cause by failing to take reasonable care, but not for indirect or unforeseeable loss, and nothing here limits liability the law does not allow us to limit.',
  'Changes. We may change these terms. A change applies to orders placed after the new version is published on this page, and not to an order you have already placed.',
  'Company details and governing law. Our registered company name and address, and the law that governs these terms, are to be confirmed before this shop takes live orders. Until then, write to us at admin@micagrowth.com.',
]
