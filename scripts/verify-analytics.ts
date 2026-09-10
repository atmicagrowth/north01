/**
 * **Analytics and observability — plan §25.**
 *
 * ```
 * pnpm verify:analytics
 * ```
 *
 * §25 names no tests. Its prompt names an obligation instead — *"verify events in local/preview
 * environments before enabling production measurement"* — and that is a browser task with a network
 * tab, not something a script can do. What a script **can** do is assert the two things that fail
 * silently, in production, forever, with nothing in the application misbehaving:
 *
 * 1. **The GA4 reshaping.** Minor units to decimals, zero-based indices to one-based. A bug here
 *    reports revenue a hundred times too high and is not recoverable after the fact — the wrong
 *    numbers are already in the property.
 * 2. **The Sentry redaction.** §25.1d: *"do not send sensitive payment data or raw secrets."* When
 *    redaction stops working, nothing breaks. The reports just quietly start carrying more.
 *
 * No database, like `verify:seo`, so **no D-10 guard**: it opens no connection and writes nothing.
 * Both modules under test are pure by design, for exactly this reason.
 */

import {
  ANALYTICS_EVENTS,
  COMMERCE_EVENTS,
  DISCOVERY_EVENTS,
  LIST_ITEM_CAP,
  capItems,
  toGa4Params,
  type AnalyticsItem,
} from '../src/lib/analytics/events'
import { cardToAnalyticsItem, variantLabel } from '../src/lib/analytics/items'
import { IGNORED_ERRORS } from '../src/lib/observability/sentry-options'
import {
  REDACTED,
  isSensitiveKey,
  redact,
  redactEvent,
  redactString,
  redactUrl,
} from '../src/lib/observability/redact'

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

const has = (haystack: unknown, needle: string) => JSON.stringify(haystack).includes(needle)

/* ============================================ A — §25.1a the taxonomy */
{
  check(
    'A: seventeen events, which is what §25.1a lists',
    ANALYTICS_EVENTS.length === 17,
    String(ANALYTICS_EVENTS.length),
  )
  check('A: ten of them are the ecommerce core', COMMERCE_EVENTS.length === 10)
  check('A: seven are discovery/editorial', DISCOVERY_EVENTS.length === 7)

  check(
    'A: **every name is unique** — one internal convention, not two spellings of one event',
    new Set(ANALYTICS_EVENTS).size === ANALYTICS_EVENTS.length,
  )

  check(
    'A: every name is GA4-legal — lower snake case, no leading digit, at most 40 characters',
    ANALYTICS_EVENTS.every((name) => /^[a-z][a-z0-9_]{0,39}$/.test(name)),
  )

  for (const name of [
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
    'search_submitted',
    'filter_applied',
    'sort_changed',
    'quick_view_opened',
    'shop_the_look_opened',
    'shop_the_look_add_item',
    'newsletter_signup',
  ] as const) {
    check(
      `A: \`${name}\` is in the taxonomy`,
      (ANALYTICS_EVENTS as readonly string[]).includes(name),
    )
  }

  check(
    'A: **no GA4 reserved name is reused** — a collision silently changes what the event means',
    !ANALYTICS_EVENTS.some((name) =>
      ['app_remove', 'first_open', 'first_visit', 'session_start', 'user_engagement'].includes(
        name,
      ),
    ),
  )
}

/* ============================================ B — §25.1c money crosses the boundary once */
{
  const params = toGa4Params('purchase', {
    currency: 'USD',
    items: [{ itemId: '7', itemName: 'Field Jacket', priceMinor: 24_000, quantity: 2 }],
    shippingMinor: 1_200,
    taxMinor: 2_040,
    transactionId: 'NORTH-1001',
    valueMinor: 51_240,
  })

  check(
    'B: **minor units become decimals exactly once**',
    params.value === 512.4,
    String(params.value),
  )
  check('B: shipping too', params.shipping === 12)
  check('B: and tax', params.tax === 20.4)
  check('B: the transaction id is snake-cased for GA4', params.transaction_id === 'NORTH-1001')
  check('B: the currency travels with the value', params.currency === 'USD')

  const item = (params.items as Record<string, unknown>[])[0]

  check('B: an item price is a decimal', item?.price === 240)
  check(
    'B: item ids and names are passed through',
    item?.item_id === '7' && item?.item_name === 'Field Jacket',
  )
  check('B: quantity survives', item?.quantity === 2)

  check(
    'B: **a zero value is a real zero, not an absence**',
    toGa4Params('purchase', { valueMinor: 0 }).value === 0,
  )

  check(
    'B: **an unknown value is absent, not a zero** — the two are different in a revenue report',
    toGa4Params('add_to_cart', { valueMinor: null }).value === undefined,
  )

  check(
    'B: …and so is an unknown item price',
    (
      toGa4Params('add_to_cart', {
        items: [{ itemId: '1', itemName: 'x', priceMinor: null }],
      }).items as Record<string, unknown>[]
    )[0]?.price === undefined,
  )

  check(
    'B: rounding is on the minor unit, so no float error reaches the decimal',
    toGa4Params('purchase', { valueMinor: 1 }).value === 0.01,
  )
}

/* ============================================ C — §25.1c the shape, not just the money */
{
  const params = toGa4Params('view_item_list', {
    items: [
      { index: 0, itemId: '1', itemName: 'A' },
      { index: 1, itemId: '2', itemName: 'B', variant: 'Bone / M' },
    ],
    listId: 'shop',
    listName: 'Shop',
  })

  const items = params.items as Record<string, unknown>[]

  check(
    'C: **an index is one-based in GA4 and zero-based here** — converted once, at the boundary',
    items[0]?.index === 1 && items[1]?.index === 2,
  )

  check(
    'C: the list identity is snake-cased',
    params.item_list_id === 'shop' && params.item_list_name === 'Shop',
  )
  check('C: a variant becomes `item_variant`', items[1]?.item_variant === 'Bone / M')
  check(
    'C: an item with no variant omits the key rather than nulling it',
    !('item_variant' in (items[0] ?? {})),
  )

  check(
    'C: `search_submitted` maps to GA4’s own `search_term`',
    toGa4Params('search_submitted', { term: 'field jacket' }).search_term === 'field jacket',
  )

  check(
    'C: `sort_changed` and `filter_applied` carry their own parameters',
    toGa4Params('sort_changed', { sort: 'price-asc' }).sort_order === 'price-asc' &&
      toGa4Params('filter_applied', { filter: 'size', value: 'M' }).filter_name === 'size',
  )

  check(
    'C: **`filter_applied.value` is a filter value, not money**',
    toGa4Params('filter_applied', { filter: 'size', value: 'M' }).filter_value === 'M',
  )

  check(
    'C: …and an ecommerce `value` is never overwritten by that mapping',
    toGa4Params('purchase', { value: 'nonsense', valueMinor: 1_000 }).value === 10,
  )

  check(
    'C: an event with nothing to map produces an empty parameter set, not junk',
    Object.keys(toGa4Params('quick_view_opened', {})).length === 0,
  )
}

/* ============================================ D — the list cap is reported, not silent */
{
  const many: AnalyticsItem[] = Array.from({ length: LIST_ITEM_CAP + 12 }, (_, index) => ({
    itemId: String(index),
    itemName: `Product ${index}`,
  }))

  const capped = capItems(many)

  check('D: a long list is cut to the cap', capped.items.length === LIST_ITEM_CAP)
  check(
    'D: **and says how many it dropped** — a silent truncation reads as complete',
    capped.dropped === 12,
  )
  check(
    'D: a short list is untouched, and is the same array',
    capItems(many.slice(0, 3)).dropped === 0,
  )
  check('D: the cap is under GA4’s 200-item hard limit', LIST_ITEM_CAP < 200)
}

/* ============================================ E — the shop's models, converted */
{
  const card = {
    compareAtLabel: null,
    href: '/product/field-jacket',
    id: 7,
    image: null,
    isLimitedEdition: false,
    isNew: false,
    lowStockLabel: null,
    name: 'Field Jacket',
    priceLabel: 'From $95.00',
    state: 'available' as const,
  }

  const item = cardToAnalyticsItem(card, 3)

  check(
    'E: a card becomes an item with a string id',
    item.itemId === '7' && item.itemName === 'Field Jacket',
  )
  check('E: the index is carried', item.index === 3)

  check(
    'E: **no price is invented from `"From $95.00"`** — a floor is not a price',
    item.priceMinor === undefined,
  )

  check('E: a variant label joins colour and size', variantLabel('Bone', 'M') === 'Bone / M')
  check('E: …one of the two alone still reads', variantLabel(null, 'M') === 'M')
  check('E: …and neither is `null`, not an empty string', variantLabel(null, null) === null)
}

/* ============================================ F — §25.1d, redaction by value */
{
  check(
    'F: **a Stripe secret key in a message is redacted**',
    redactString('Failed with sk_live_51QQabcdefghijklmnop') === `Failed with ${REDACTED}`,
  )

  check('F: …a restricted key too', !redactString('rk_live_abcd1234').includes('rk_live'))
  check('F: …a webhook secret', !redactString('whsec_abcdefgh1234').includes('whsec_'))
  check(
    'F: …and a publishable key, because deciding which prefixes are safe is not worth doing twice',
    !redactString('pk_live_abcd1234').includes('pk_live'),
  )

  check(
    'F: **a Postgres URL goes whole, password included**',
    !redactString('postgresql://neondb_owner:hunter2@ep-x.aws.neon.tech/neondb').includes(
      'hunter2',
    ),
  )

  check(
    'F: …and it is not half-eaten by the email rule, leaving the host behind',
    redactString('postgresql://u:p@host.example/db') === REDACTED,
  )

  check(
    'F: a bearer token',
    !redactString('Authorization: Bearer abc.def.ghi').includes('abc.def.ghi'),
  )
  check('F: a JWT', !redactString('eyJhbGciOiJIUzI1NiJ9.payload.sig').includes('payload'))
  check('F: a Resend key', !redactString('re_abcdefgh_ijklmnop').includes('re_abcdefgh'))
  check('F: a card-length digit run', !redactString('4242424242424242').includes('4242'))
  check('F: an email address', !redactString('contact hello@north01.test today').includes('hello@'))
  check(
    'F: ordinary prose is untouched',
    redactString('The jacket is out of stock.') === 'The jacket is out of stock.',
  )
}

/* ============================================ G — §25.1d, redaction by key */
{
  const scrubbed = redact({
    STRIPE_SECRET_KEY: 'something',
    apiKey: 'x',
    authorization: 'y',
    databaseUrl: 'z',
    orderNumber: 'NORTH-1001',
    password: 'hunter2',
    sessionToken: 'abc',
  }) as Record<string, unknown>

  check(
    'G: a secret-shaped key is redacted whatever its value looks like',
    scrubbed.password === REDACTED,
  )
  check(
    'G: …case and separators do not matter',
    scrubbed.STRIPE_SECRET_KEY === REDACTED && scrubbed.apiKey === REDACTED,
  )
  check(
    'G: …nor does the value being unremarkable',
    scrubbed.databaseUrl === REDACTED && scrubbed.sessionToken === REDACTED,
  )

  check(
    'G: **a harmless key survives** — over-redacting everything is the same as reporting nothing',
    scrubbed.orderNumber === 'NORTH-1001',
  )

  const nested = redact({ a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } })

  check('G: the walk is depth-bounded rather than unbounded', has(nested, '[truncated]'))

  const long = redact(Array.from({ length: 80 }, (_, index) => index))

  check('G: a long array is cut and says so', Array.isArray(long) && has(long, 'more]'))

  check(
    'G: primitives pass through',
    redact(42) === 42 && redact(null) === null && redact(true) === true,
  )
}

/* ============================================ G2 — the key matcher matches segments, not substrings */
{
  for (const key of [
    'password',
    'passwordHash',
    'STRIPE_SECRET_KEY',
    'stripeSecretKey',
    'apiKey',
    'api_key',
    'authorization',
    'sessionToken',
    'payment_method',
    'databaseUrl',
    'connectionString',
    'cardNumber',
    'cvv',
    'set-cookie',
  ]) {
    check(`G2: \`${key}\` is sensitive`, isSensitiveKey(key))
  }

  /*
   * **The regression this section exists for.** The first version tested the whole key as a
   * substring, so `shipping` matched `pin`, `author` matched `auth` and `company` matched `pan` —
   * three field names an operator needs in order to read a report at all.
   */
  for (const key of [
    'shipping',
    'shippingMinor',
    'shippingMethodLabel',
    'author',
    'company',
    'expanded',
    'orderNumber',
    'productName',
    'discardedAt',
  ]) {
    check(
      `G2: **\`${key}\` is NOT sensitive** — it was, and that was the bug`,
      !isSensitiveKey(key),
    )
  }
}

/* ============================================ H — §25.1d, a whole event */
{
  const event = redactEvent({
    breadcrumbs: [{ data: { url: 'https://north01.test/reset-password?token=abc123' } }],
    extra: { stripeKey: 'sk_live_abcd1234', total: 24_000 },
    message: 'Checkout failed for hello@north01.test',
    request: {
      cookies: { 'payload-token': 'eyJhbGciOi.session.value' },
      data: { cardNumber: '4242424242424242' },
      headers: { authorization: 'Bearer abcdef' },
      url: 'https://north01.test/reset-password?token=abc123&size=m',
    },
    tags: { route: '/checkout' },
    user: { email: 'hello@north01.test', id: 42, ip_address: '203.0.113.4' },
  })

  check(
    'H: **cookies are dropped, not scrubbed** — a redacted session cookie still says one existed',
    event.request?.cookies === undefined,
  )
  check('H: …and so are headers', event.request?.headers === undefined)

  check(
    'H: **the user is reduced to an id** — "raw personal data where not necessary"',
    JSON.stringify(event.user) === JSON.stringify({ id: '42' }),
  )

  check('H: the message is scrubbed', !has(event.message, 'hello@north01.test'))
  check('H: `extra` is scrubbed by value', !has(event.extra, 'sk_live'))
  check('H: …and untouched where it is harmless', has(event.extra, '24000'))
  check('H: request data is scrubbed by key', !has(event.request?.data, '4242'))
  check('H: breadcrumbs are scrubbed', !has(event.breadcrumbs, 'abc123'))
  check('H: tags survive', has(event.tags, '/checkout'))

  check(
    'H: **the URL keeps its route and loses its token** — which route failed is the useful half',
    typeof event.request?.url === 'string' &&
      event.request.url.includes('/reset-password') &&
      !event.request.url.includes('abc123'),
  )

  check(
    'H: …and a harmless query parameter is left alone',
    typeof event.request?.url === 'string' && event.request.url.includes('size=m'),
  )

  check(
    'H: **the event is never dropped** — §25.1d asks for redaction, not silence',
    redactEvent({ message: 'anything' }) !== null,
  )

  check(
    'H: a URL that is not a URL is still scrubbed as a string',
    redactUrl('not a url sk_live_abcd1234').includes(REDACTED),
  )

  check(
    'H: **a secret near the truncation boundary goes whole** — replaced before the string is cut',
    !redactString(`${'x'.repeat(1_995)}sk_live_abcdefghijkl`).includes('sk_live'),
  )

  check(
    'H: an event with a user carrying no id drops the user entirely',
    redactEvent({ user: { email: 'a@b.test' } }).user === undefined,
  )
}

/* ============================================ I — the noise filter is short and justified */
{
  check('I: the ignore list is short enough to read', IGNORED_ERRORS.length <= 10)

  check(
    'I: **nothing commerce-shaped is ignored** — a filter is where real failures get buried',
    !IGNORED_ERRORS.some((entry) => /stripe|checkout|payment|order|cart/i.test(String(entry))),
  )
}

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} analytics checks passed.`,
  ...failed.map((result) => `FAIL  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`),
  '',
  ...results.map(
    (result) =>
      `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  ),
].join('\n')

await new Promise<void>((resolve, reject) => {
  process.stdout.write(`${report}\n`, (error) => (error ? reject(error) : resolve()))
})

if (failed.length > 0) {
  throw new Error(`${failed.length} analytics check(s) failed.`)
}
