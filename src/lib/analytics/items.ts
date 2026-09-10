import type { AnalyticsItem } from './events'
import type { ProductCard } from '@/lib/catalog/resolve'

/**
 * **Turning the shop's own models into §25.1a items**, in one place.
 *
 * Every list in the storefront renders `ProductCard`, so every `view_item_list` and `select_item`
 * builds its items from the same model — and doing that at eight call sites is eight chances for
 * one of them to send a name where an id belongs.
 *
 * ### A card has no price, and that is not an oversight to paper over
 *
 * `ProductCard` carries `priceLabel` — `"$240.00"`, or `"From $95.00"` — because a card renders a
 * label, and a range is a real state. There is no number to send, and parsing the label back into
 * one would invent precision the model deliberately does not have: *"From $95.00"* is not a price,
 * it is a floor.
 *
 * So `priceMinor` is omitted, and `events.ts` says what that means: **unknown, not free.** The
 * events that genuinely know a price — `add_to_cart`, `view_item`, `purchase` — are built from the
 * variant or the order line, which hold minor units.
 */
export function cardToAnalyticsItem(card: ProductCard, index?: number): AnalyticsItem {
  return {
    itemId: String(card.id),
    itemName: card.name,
    ...(index === undefined ? {} : { index }),
  }
}

export function cardsToAnalyticsItems(cards: readonly ProductCard[]): AnalyticsItem[] {
  return cards.map((card, index) => cardToAnalyticsItem(card, index))
}

/** A colour and a size, joined the way a customer would read them. `null` when neither is known. */
export function variantLabel(color: null | string, size: null | string): null | string {
  return [color, size].filter((part): part is string => Boolean(part)).join(' / ') || null
}
