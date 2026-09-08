import { toMinorAmount } from '@/lib/money'
import type { CurrencyCode } from '@/payload/fields/money'

/**
 * **Plan §16.1a's normalised rate shape, and §16.1b's validation, as pure functions.**
 *
 * §16.1a asks for a `ShippingProvider` *interface* — *"even though the initial NORTH / 01 demo can
 * use static shipping methods"* — and for the storefront to consume *"a normalized shipping-rate
 * shape rather than provider-specific objects"*. That normalisation is the whole point of the phase,
 * and it lives here: nothing in this module knows what a provider is, only what a rate looks like
 * once one has answered.
 *
 * `lib/shipping/provider.ts` holds the interface and the static implementation. This holds the shape
 * they agree on and the rules that operate on it, so `pnpm verify:shipping` can walk every edge case
 * §16.1d enumerates without a provider, a request or a database.
 *
 * ---
 *
 * ### Price is knowable without an address; eligibility is not
 *
 * This is the distinction the whole phase turns on. The static provider's prices depend on the
 * **cart** — a threshold on the subtotal, a fixed amount — and not on where the parcel is going. What
 * the destination decides is whether we will send it there at all.
 *
 * So a bag with no address can honestly quote a **price** and must not claim **eligibility**. The bag
 * shows the former and says the latter is confirmed at checkout; `quoteShipping` marks every rate
 * `eligible: true` with `destinationKnown: false` when it has no country to check, and a caller that
 * treats that as a promise is reading it wrong. §17.1a's preflight re-quotes with the real address,
 * which is exactly what **DEV-11** already said it must do.
 */

/** What the shipping provider is asked about. Structural, so fixtures cost nothing. */
export type ShippingDestination = {
  /** ISO 3166-1 alpha-2, upper-case — the same constraint `fields/address.ts` enforces. */
  country: string
  postalCode: null | string
  region: null | string
}

/**
 * **§16.1a's six normalised fields**, and one more the plan implies rather than lists.
 *
 * *"ID. Display name. Price. Currency. Estimated minimum/maximum delivery date or human-readable
 * estimate. Eligibility."* — all six, with `minDays`/`maxDays` **and** a human-readable `estimate`
 * rather than one or the other, because the plan offers a choice and a caller that has both can
 * render a date range or a sentence without the provider being asked twice.
 *
 * `ineligibleReason` is the seventh. "Eligibility" as a bare boolean tells a customer that they
 * cannot have something and not why, and §16.1d's first edge case — *"destination not supported by
 * selected shipping method"* — is precisely the case where the reason is the useful part.
 */
export type ShippingRate = {
  amountMinor: number
  currency: CurrencyCode
  /** Whether this rate can be chosen for this cart and destination. */
  eligible: boolean
  /** A human-readable delivery estimate — "2–5 business days". */
  estimate: string
  id: ShippingMethodId
  /** Why not, when `eligible` is false. `null` otherwise. */
  ineligibleReason: null | string
  maxDays: number
  minDays: number
  name: string
  /** True when this rate is free *because* of a threshold or a promotion, rather than being free. */
  waived: boolean
}

export type ShippingMethodId = 'express' | 'overnight' | 'standard'

export type ShippingQuote = {
  /** The rate a caller should preselect: the cheapest eligible one. `null` when none is eligible. */
  defaultRateId: null | ShippingMethodId
  /**
   * **False when the quote was produced without a destination.**
   *
   * Every rate is then `eligible: true` because nothing has been ruled out — not because anything has
   * been confirmed. A caller that shows the quote to a customer must say so; a caller that is about
   * to take money must re-quote with the real address first.
   */
  destinationKnown: boolean
  rates: ShippingRate[]
}

/* -------------------------------------------------------------------------------------------------
 * The static rate card — plan §16.1a
 * ---------------------------------------------------------------------------------------------- */

/**
 * *"For the demo, implement a static provider: Standard — free or configured threshold-based price.
 * Express — fixed price. Overnight — fixed price."*
 *
 * The amounts are in minor units of the store's currency, like every other amount in this project.
 * They are **constants rather than content** deliberately: a rate card is a property of a shipping
 * provider, and this provider is code. When a real carrier replaces it the card comes from the
 * carrier's API, not from a CMS field an editor would then have to keep in step with it.
 *
 * `overnight` is deliberately domestic-only. It is the one method where the promise in the name is a
 * promise about physics, and a next-day guarantee across a border is one this demo cannot keep.
 */
export const SHIPPING_METHODS: readonly {
  amountMinor: number
  domesticOnly: boolean
  estimate: string
  id: ShippingMethodId
  maxDays: number
  minDays: number
  name: string
  /** Only `standard` is waived by a threshold or a free-shipping code. */
  waivable: boolean
}[] = [
  {
    amountMinor: 995,
    domesticOnly: false,
    estimate: '3–5 business days',
    id: 'standard',
    maxDays: 5,
    minDays: 3,
    name: 'Standard',
    waivable: true,
  },
  {
    amountMinor: 1_995,
    domesticOnly: false,
    estimate: '2 business days',
    id: 'express',
    maxDays: 2,
    minDays: 2,
    name: 'Express',
    waivable: false,
  },
  {
    amountMinor: 3_495,
    domesticOnly: true,
    estimate: 'Next business day',
    id: 'overnight',
    maxDays: 1,
    minDays: 1,
    name: 'Overnight',
    waivable: false,
  },
]

/** The store's own country. `overnight` is offered here and nowhere else. */
export const DOMESTIC_COUNTRY = 'US'

/**
 * Where this demo will send a parcel.
 *
 * A **provider** property, not an address one — `fields/address.ts` says so in as many words, and it
 * is why `country` there validates the *format* and not the *set*. A real carrier answers this from
 * its own coverage; a static provider has to be told, and being told in code beats being told in a
 * CMS field that an editor could quietly widen past what the carrier will actually accept.
 */
export const SUPPORTED_COUNTRIES: readonly string[] = [
  'US',
  'CA',
  'GB',
  'IE',
  'FR',
  'DE',
  'NL',
  'AU',
]

export const SHIPPING_COPY = {
  /** §16.1d: *"Destination not supported by selected shipping method."* */
  countryUnsupported: 'We do not ship to that country yet.',
  /** The chosen method exists but not for this destination. */
  domesticOnly: 'Only available within the United States.',
  /** §16.1d: *"Shipping method becomes unavailable before checkout creation."* */
  methodGone: 'That delivery option is no longer available. Choose another.',
  /** No method at all can serve this destination. */
  noneAvailable: 'We cannot deliver to that address.',
  /** Shown beside a rate the bag quotes before an address exists. */
  estimateOnly: 'Delivery is confirmed at checkout, once we know where it is going.',
} as const

/* -------------------------------------------------------------------------------------------------
 * Quoting
 * ---------------------------------------------------------------------------------------------- */

export type ShippingQuoteInput = {
  currency: CurrencyCode
  /** The destination, or `null` when the customer has not given one yet. */
  destination: null | ShippingDestination
  /** The discount already applied — see the note on which subtotal the threshold reads. */
  discountMinor: number
  /** `null` when no threshold is configured, which means nothing is ever waived by spend. */
  freeShippingThresholdMinor: null | number
  /** True when a `free_shipping` promotion is applied and currently valid — closes **DEV-60**. */
  freeShippingPromotion: boolean
  subtotalMinor: number
}

/**
 * **The rate card, priced and filtered for one cart.**
 *
 * ### Which subtotal the free-shipping threshold reads, and why it matters
 *
 * §16.1d names the case: *"free-shipping threshold crossed because of a coupon."* A discount moves
 * the subtotal, so a bag that qualified at $150 and takes $20 off no longer has $150 in it, and the
 * shop must decide which number the threshold compares against.
 *
 * **The discounted subtotal.** A threshold is a statement about what the customer spends, and after
 * a coupon they spend less. Comparing against the pre-discount figure would give away delivery on an
 * order that never reached the threshold, on every discounted order, forever — and the customer
 * would have no way to tell which number they were being measured against.
 *
 * The consequence is visible and has to be: applying a coupon can take free delivery away. That is
 * the honest behaviour and the bag's progress message reads the **same** number, so the sentence and
 * the rate cannot disagree. Getting those two from different subtotals is exactly the class of bug
 * this project keeps finding.
 *
 * ### A free-shipping code waives Standard and nothing else
 *
 * *"Free shipping"* means the delivery the shop offers as standard. A code that silently upgraded a
 * customer to Overnight would be a promotion nobody wrote, and the cost is real money per order.
 * `waivable` marks which methods a waiver can touch, and only one is marked.
 */
export function quoteShipping(input: ShippingQuoteInput): ShippingQuote {
  const spend = Math.max(0, toMinorAmount(input.subtotalMinor) - toMinorAmount(input.discountMinor))

  const meetsThreshold =
    input.freeShippingThresholdMinor !== null &&
    Number.isFinite(input.freeShippingThresholdMinor) &&
    input.freeShippingThresholdMinor >= 0 &&
    spend >= Math.floor(input.freeShippingThresholdMinor)

  const waiverApplies = meetsThreshold || input.freeShippingPromotion
  const destination = input.destination

  const rates: ShippingRate[] = SHIPPING_METHODS.map((method) => {
    const waived = method.waivable && waiverApplies

    let eligible = true
    let ineligibleReason: null | string = null

    if (destination !== null) {
      const country = destination.country.trim().toUpperCase()

      if (!SUPPORTED_COUNTRIES.includes(country)) {
        eligible = false
        ineligibleReason = SHIPPING_COPY.countryUnsupported
      } else if (method.domesticOnly && country !== DOMESTIC_COUNTRY) {
        eligible = false
        ineligibleReason = SHIPPING_COPY.domesticOnly
      }
    }

    return {
      amountMinor: waived ? 0 : method.amountMinor,
      currency: input.currency,
      eligible,
      estimate: method.estimate,
      id: method.id,
      ineligibleReason,
      maxDays: method.maxDays,
      minDays: method.minDays,
      name: method.name,
      waived,
    }
  })

  /*
   * The cheapest eligible rate, and on a tie the one the card lists first — which is the order a
   * merchandiser would read as slowest-to-fastest. A stable default matters because it is what the
   * bag quotes and what checkout preselects, and a default that moved between two equally cheap
   * options would move the quoted price for no reason a customer could see.
   */
  const cheapest = rates
    .filter((rate) => rate.eligible)
    .reduce<null | ShippingRate>(
      (best, rate) => (best === null || rate.amountMinor < best.amountMinor ? rate : best),
      null,
    )

  return {
    defaultRateId: cheapest?.id ?? null,
    destinationKnown: destination !== null,
    rates,
  }
}

/* -------------------------------------------------------------------------------------------------
 * Validation — plan §16.1b
 * ---------------------------------------------------------------------------------------------- */

export type RateValidation = { ok: false; reason: string } | { ok: true; rate: ShippingRate }

/**
 * **§16.1b: *"the browser must not be allowed to invent a shipping price."***
 *
 * A caller hands in the id the customer chose and a quote produced **now**, from the live cart and
 * the live address. The answer is the rate object from that quote, never anything derived from what
 * was submitted — so a request carrying `overnight` and `£0.00` gets Overnight at the price the
 * provider just quoted, or a refusal.
 *
 * The two refusals are §16.1d's first two edge cases, and they are deliberately different sentences:
 * *"no longer available"* is a method that has gone (the card changed, the quote no longer offers
 * it), and the eligibility reason is a method that exists and cannot serve this address. A customer
 * who is told the wrong one will try the wrong fix.
 */
export function validateSelectedRate(
  selectedId: null | string,
  quote: ShippingQuote,
): RateValidation {
  const rate = quote.rates.find((candidate) => candidate.id === selectedId)

  if (!rate) {
    return { ok: false, reason: SHIPPING_COPY.methodGone }
  }

  if (!rate.eligible) {
    return { ok: false, reason: rate.ineligibleReason ?? SHIPPING_COPY.noneAvailable }
  }

  return { ok: true, rate }
}

/**
 * Whether a destination is one this provider will serve at all — §16.1d's *"invalid address"* and
 * *"destination not supported"*, separated from the per-method question.
 *
 * A country code that is not two letters is not a country: `fields/address.ts` enforces the format
 * and deliberately does not enforce the set, so an address can be structurally valid and still name
 * somewhere we do not ship.
 */
export function isSupportedDestination(destination: null | ShippingDestination): boolean {
  if (destination === null) {
    return false
  }

  const country = destination.country.trim().toUpperCase()

  return /^[A-Z]{2}$/.test(country) && SUPPORTED_COUNTRIES.includes(country)
}
