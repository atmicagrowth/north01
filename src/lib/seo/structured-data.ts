/**
 * **Plan §24.1b — product structured data, and the four things it must never say.**
 *
 * > *"Generate valid product structured data from authoritative product data. Do not include: fake
 * > ratings, fake availability, incorrect prices, prices not actually purchasable."*
 *
 * The prompt repeats it in stronger words: *"never generate structured data that claims false price,
 * availability, or ratings."*
 *
 * That is an unusual instruction for a metadata phase, and it is the right one. Structured data is
 * the one output on a storefront that is **read by machines and shown to customers without the page
 * being visited** — a rating in a search result is seen by people who never see the product page, and
 * a price in a shopping listing is a promise made before anybody reaches the shop. Getting it wrong is
 * not an SEO defect; it is a false claim at scale.
 *
 * So every function here **omits** rather than guesses. There is no default rating, no assumed
 * availability and no fallback price anywhere in this file, and each omission is enforced by the
 * shape of the input rather than by a check somebody has to remember.
 *
 * Pure, so `pnpm verify:seo` can assert the omissions without a database.
 */

export type ProductOffer = {
  /** Minor units. The price of a variant a customer can actually put in a bag today. */
  priceMinor: number
  /** Live stock for that variant. */
  available: number
}

export type ProductStructuredDataInput = {
  currency: string
  description: null | string
  image: null | string
  name: string
  /**
   * **Only variants that can actually be bought** — active, published, in stock.
   *
   * §24.1b's *"prices not actually purchasable"* is answered by this list rather than by a check
   * downstream: a caller that passes every variant will produce a price for a size nobody can buy,
   * so the caller's job is to filter and this module's job is to trust nothing else.
   */
  offers: ProductOffer[]
  /** Real, approved reviews only. `count: 0` means no rating is emitted at all. */
  rating: { average: number; count: number } | null
  sku: null | string
  url: string
}

/**
 * Schema.org `Product`, built only from what is true.
 *
 * ### Availability is derived, never assumed
 *
 * `InStock` when something can be bought, `OutOfStock` when nothing can. There is no third value and
 * no default: a product whose variants are all sold out says so, and a product with no purchasable
 * variant emits **no offer at all** rather than an offer at a price nobody can pay.
 *
 * ### The price is the lowest purchasable one
 *
 * Which is what a customer clicking a search result expects to be able to pay. An `AggregateOffer`
 * carries the range as well, so a product spanning two prices is not misrepresented by either end.
 *
 * ### The rating is omitted unless it exists
 *
 * Phase 21 made ratings real — approved reviews, moderated, counted from the same rows the page
 * renders. `aggregateRating` is emitted **only** when at least one such review exists. A product with
 * none has no `aggregateRating` key, rather than a zero, an empty object, or the industry's favourite
 * lie: five stars from nobody.
 */
export function productStructuredData(input: ProductStructuredDataInput): Record<string, unknown> {
  const purchasable = input.offers.filter(
    (offer) => Number.isFinite(offer.priceMinor) && offer.priceMinor >= 0 && offer.available > 0,
  )

  const prices = purchasable.map((offer) => offer.priceMinor)

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    url: input.url,
  }

  if (input.description) {
    data.description = input.description
  }

  if (input.image) {
    data.image = [input.image]
  }

  if (input.sku) {
    data.sku = input.sku
  }

  if (prices.length > 0) {
    const low = Math.min(...prices)
    const high = Math.max(...prices)

    data.offers =
      low === high
        ? {
            '@type': 'Offer',
            availability: 'https://schema.org/InStock',
            price: toMajorUnits(low),
            priceCurrency: input.currency,
            url: input.url,
          }
        : {
            '@type': 'AggregateOffer',
            availability: 'https://schema.org/InStock',
            highPrice: toMajorUnits(high),
            lowPrice: toMajorUnits(low),
            offerCount: purchasable.length,
            priceCurrency: input.currency,
            url: input.url,
          }
  } else if (input.offers.length > 0) {
    /*
     * The product exists and has variants, and none of them can be bought. That is a fact worth
     * stating — `OutOfStock` is the honest answer and stops a listing implying otherwise — but it is
     * stated **without a price**, because a price nobody can pay is exactly what §24.1b forbids.
     */
    data.offers = {
      '@type': 'Offer',
      availability: 'https://schema.org/OutOfStock',
      priceCurrency: input.currency,
      url: input.url,
    }
  }

  /*
   * §24.1b's "fake ratings", refused at the only place it could have happened. No reviews means no
   * key — not a zero, not an empty object, and above all not a default.
   */
  if (input.rating && input.rating.count > 0 && input.rating.average > 0) {
    data.aggregateRating = {
      '@type': 'AggregateRating',
      bestRating: 5,
      ratingCount: input.rating.count,
      ratingValue: input.rating.average,
      worstRating: 1,
    }
  }

  return data
}

/**
 * Schema.org wants a decimal string in major units; this project stores integer minor units
 * everywhere precisely so no floating point is involved in money.
 *
 * The division happens once, here, at the boundary where the format demands it — which is the same
 * rule `formatMinorUnits` follows for the human-readable side.
 */
function toMajorUnits(minor: number): string {
  return (Math.round(minor) / 100).toFixed(2)
}

/**
 * A breadcrumb trail, for the one place a search result benefits from knowing where a page sits.
 *
 * Positions are one-based, which is what the specification says and what every validator checks.
 */
export function breadcrumbStructuredData(
  siteUrl: string,
  trail: { name: string; path: string }[],
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((entry, index) => ({
      '@type': 'ListItem',
      item: `${siteUrl.replace(/\/+$/, '')}${entry.path}`,
      name: entry.name,
      position: index + 1,
    })),
  }
}

/**
 * The shop itself.
 *
 * Deliberately minimal: a name, a URL and a logo where one exists. Every additional field an
 * organisation *can* declare — a telephone number, a postal address, a founding date — is a claim,
 * and this shop is online-only with none of them established. `AGENTS.md`: no store locator, no
 * hours. An empty `address` would be the structured-data version of the same lie.
 */
export function organisationStructuredData(input: {
  logo: null | string
  name: string
  siteUrl: string
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: input.name,
    url: input.siteUrl,
    ...(input.logo ? { logo: input.logo } : {}),
  }
}
