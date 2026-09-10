/**
 * **Plan §25.1a — the event taxonomy, and it is written before anything is instrumented.**
 *
 * > *"Use a single internal event naming convention."* / *"Define a clean ecommerce/event taxonomy
 * > first, then instrument the core flows."*
 *
 * Seventeen events, exactly the seventeen §25.1a names, in one union. Nothing in this project may
 * emit a string that is not in it — `trackEvent` takes `AnalyticsEvent`, so a typo is a compile
 * error rather than a column in a dashboard that nobody notices is empty.
 *
 * ### The internal names *are* the GA4 names, for the ten that overlap
 *
 * §25.1c asks for *"GA4-compatible form"*, and §25.1a's ecommerce list is already GA4's recommended
 * ecommerce vocabulary word for word. Keeping one name for both is the whole point of §25.1a's
 * *"single internal convention"*: a translation table between an internal name and a vendor name is
 * a place for the two to drift, and the drift is invisible — the events still arrive, under the
 * wrong label.
 *
 * The seven discovery events have no GA4 equivalent and are sent as custom events under the same
 * names. None of them collides with a GA4 reserved name.
 *
 * ### Shapes are declared, not implied
 *
 * `AnalyticsPayloads` maps each event to what it carries, so a call site cannot send
 * `add_to_cart` without a quantity or `purchase` without a value. It is the same argument as the
 * name union, one level down.
 *
 * Pure. No vendor import, no environment read, no `server-only` guard — `pnpm verify:analytics`
 * drives every function here, and the GA4 mapping is the part most worth testing.
 */

/* -------------------------------------------------------------------------------------------------
 * The vocabulary
 * ---------------------------------------------------------------------------------------------- */

/** §25.1a, "core ecommerce events". GA4 recommended names, unchanged. */
export const COMMERCE_EVENTS = [
  'view_item_list',
  'select_item',
  'view_item',
  'add_to_cart',
  'remove_from_cart',
  'add_to_wishlist',
  'remove_from_wishlist',
  'begin_checkout',
  'add_payment_info',
  'purchase',
] as const

/** §25.1a, "discovery/editorial". Custom events; GA4 accepts them under these names. */
export const DISCOVERY_EVENTS = [
  'search_submitted',
  'filter_applied',
  'sort_changed',
  'quick_view_opened',
  'shop_the_look_opened',
  'shop_the_look_add_item',
  'newsletter_signup',
] as const

export const ANALYTICS_EVENTS = [...COMMERCE_EVENTS, ...DISCOVERY_EVENTS] as const

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number]

/* -------------------------------------------------------------------------------------------------
 * What an event carries
 * ---------------------------------------------------------------------------------------------- */

/**
 * One product in an event, in the project's own terms.
 *
 * **Money is minor units here, as it is everywhere else.** The conversion to GA4's decimal happens
 * once, in `toGa4Params`, at the boundary where the format demands it — the same rule `money.ts`
 * follows and the same rule `toMajorUnits` follows for structured data. A `price` field that is
 * sometimes cents and sometimes dollars is how an analytics property ends up reporting revenue a
 * hundred times too high, and it is not recoverable after the fact.
 *
 * `priceMinor` is optional and **`null` means unknown**, which is not the same as free. A product
 * card carries a formatted label rather than a number, so a `select_item` from a grid genuinely does
 * not know the price; sending a zero would be inventing one.
 */
export type AnalyticsItem = {
  /** The product id, as a string — GA4's `item_id` is a string and a numeric id is still an id. */
  itemId: string
  itemName: string
  /** Position in the list, zero-based here and one-based in GA4. */
  index?: number
  priceMinor?: null | number
  quantity?: number
  /** The variant a customer actually chose — a colour and a size, joined. */
  variant?: null | string
}

type ListContext = {
  /** A stable identifier for the surface: `shop`, `search`, `collection:ss26`, `pdp_recommended`. */
  listId: string
  listName: string
}

export type AnalyticsPayloads = {
  add_payment_info: { currency: string; items: AnalyticsItem[]; valueMinor: number }
  add_to_cart: { currency: string; items: AnalyticsItem[]; valueMinor?: null | number }
  add_to_wishlist: { items: AnalyticsItem[] }
  begin_checkout: { currency: string; items: AnalyticsItem[]; valueMinor: number }
  filter_applied: { filter: string; value: string }
  newsletter_signup: { source: string }
  purchase: {
    currency: string
    items: AnalyticsItem[]
    shippingMinor?: null | number
    taxMinor?: null | number
    /** The order reference a customer would quote, not the row id. GA4 dedupes on it. */
    transactionId: string
    valueMinor: number
  }
  quick_view_opened: { items: AnalyticsItem[] }
  remove_from_cart: { currency: string; items: AnalyticsItem[]; valueMinor?: null | number }
  remove_from_wishlist: { items: AnalyticsItem[] }
  search_submitted: { resultCount?: null | number; term: string }
  select_item: ListContext & { items: AnalyticsItem[] }
  shop_the_look_add_item: { items: AnalyticsItem[]; lookId: string }
  shop_the_look_opened: { lookId: string }
  sort_changed: { sort: string }
  view_item: { currency: string; items: AnalyticsItem[] }
  view_item_list: ListContext & { items: AnalyticsItem[] }
}

export type AnalyticsPayload<E extends AnalyticsEvent> = AnalyticsPayloads[E]

/* -------------------------------------------------------------------------------------------------
 * §25.1c — GA4 form
 * ---------------------------------------------------------------------------------------------- */

/**
 * Minor units to GA4's decimal.
 *
 * The one division in this module, and `null` in gives `undefined` out — an absent parameter rather
 * than a zero. GA4 treats a missing `value` as unknown and a `value: 0` as a real zero-revenue
 * event, and the two are not interchangeable in a revenue report.
 */
function toMajorUnits(minor: null | number | undefined): number | undefined {
  return typeof minor === 'number' && Number.isFinite(minor) ? Math.round(minor) / 100 : undefined
}

/**
 * One item, in GA4's shape.
 *
 * `index` is **one-based** in GA4 and zero-based in the rest of this codebase, so the `+ 1` happens
 * here and nowhere else. Every optional field is omitted rather than nulled: GA4 stores what it is
 * sent, and a null parameter is a stored null.
 */
function toGa4Item(item: AnalyticsItem): Record<string, number | string> {
  const price = toMajorUnits(item.priceMinor)

  return {
    item_id: item.itemId,
    item_name: item.itemName,
    ...(item.index === undefined ? {} : { index: item.index + 1 }),
    ...(price === undefined ? {} : { price }),
    ...(item.quantity === undefined ? {} : { quantity: item.quantity }),
    ...(item.variant ? { item_variant: item.variant } : {}),
  }
}

/**
 * **An event, in GA4-compatible parameters** — §25.1c.
 *
 * The name is unchanged, because §25.1a's names are GA4's. What this does is reshape the *payload*:
 * camelCase to snake_case, minor units to decimals, zero-based indices to one-based, and `items`
 * into GA4's item array.
 *
 * It is a pure function of the payload rather than a method on a client, so `pnpm verify:analytics`
 * asserts the reshaping without loading a vendor script — which matters, because a conversion bug
 * here is silent by construction. Nothing in the application breaks; the numbers are just wrong.
 */
export function toGa4Params(
  event: AnalyticsEvent,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}

  const items = Array.isArray(payload.items) ? (payload.items as AnalyticsItem[]) : null

  if (items) {
    params.items = items.map(toGa4Item)
  }

  if (typeof payload.currency === 'string') {
    params.currency = payload.currency
  }

  const value = toMajorUnits(payload.valueMinor as null | number | undefined)

  if (value !== undefined) {
    params.value = value
  }

  const shipping = toMajorUnits(payload.shippingMinor as null | number | undefined)

  if (shipping !== undefined) {
    params.shipping = shipping
  }

  const tax = toMajorUnits(payload.taxMinor as null | number | undefined)

  if (tax !== undefined) {
    params.tax = tax
  }

  if (typeof payload.transactionId === 'string') {
    params.transaction_id = payload.transactionId
  }

  if (typeof payload.listId === 'string') {
    params.item_list_id = payload.listId
  }

  if (typeof payload.listName === 'string') {
    params.item_list_name = payload.listName
  }

  /*
   * The discovery events, which GA4 has no schema for. Their parameters are passed through under
   * snake_case names of their own rather than being forced into an ecommerce shape they do not fit —
   * a `search_submitted` is not a `view_item_list` with a term attached.
   */
  for (const [from, to] of [
    ['filter', 'filter_name'],
    ['lookId', 'look_id'],
    ['resultCount', 'result_count'],
    ['sort', 'sort_order'],
    ['source', 'source'],
    ['term', 'search_term'],
    ['value', 'filter_value'],
  ] as const) {
    const raw = payload[from]

    /*
     * `filter_applied` carries `value`, and so does every ecommerce event — as money. The ecommerce
     * meaning was already written above, so this loop must not overwrite it: only `filter_applied`
     * may map `value`, and only when the ecommerce `value` was not set.
     */
    if (from === 'value' && (event !== 'filter_applied' || params.value !== undefined)) {
      continue
    }

    if (typeof raw === 'string' ? raw.length > 0 : typeof raw === 'number') {
      params[to] = raw
    }
  }

  return params
}

/**
 * A GA4 `items` array is capped at 200 entries per event, and a grid can exceed it.
 *
 * Truncating is the only option — the alternative is an event GA4 rejects whole — but a silent
 * truncation is the same defect as a silent read cap, so the caller is told how many were dropped
 * through `item_list_truncated`. `LIST_ITEM_CAP` is deliberately well under 200: a listing event
 * with a hundred products is already telling you what you need.
 */
export const LIST_ITEM_CAP = 50

export function capItems(items: AnalyticsItem[]): {
  dropped: number
  items: AnalyticsItem[]
} {
  return items.length <= LIST_ITEM_CAP
    ? { dropped: 0, items }
    : { dropped: items.length - LIST_ITEM_CAP, items: items.slice(0, LIST_ITEM_CAP) }
}
