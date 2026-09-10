/**
 * **Search engine optimization — plan §24.**
 *
 * ```
 * pnpm verify:seo
 * ```
 *
 * §24 names no tests, and it does something more useful: it names four **prohibitions**, all in
 * §24.1b, and the phase prompt restates them in stronger words — *"never generate structured data
 * that claims false price, availability, or ratings."* Every one of them is asserted here.
 *
 * ### This harness touches no database, and that is the point
 *
 * It is the first one in the project that does not, so there is **no D-10 guard**: it creates
 * nothing, deletes nothing, and cannot reach the wrong environment because it never opens a
 * connection. Everything §24 decides — what may be indexed, what a canonical URL is, whether a
 * rating may be emitted — was deliberately written as a pure function for exactly this reason. The
 * part that does read the CMS, `lib/seo/site.ts`, holds no decision; it holds a `findGlobal`.
 *
 * It also means this is a phase whose gate can be run with the database unreachable.
 */

import { documentSeo, EMPTY_DOCUMENT_SEO } from '../src/lib/seo/document'
import { socialImageUrl } from '../src/lib/seo/image'
import {
  buildMetadata,
  canonicalUrl,
  privateMetadata,
  richTextToPlainText,
  trimDescription,
} from '../src/lib/seo/metadata'
import {
  NON_INDEXABLE_PREFIXES,
  STATIC_SITEMAP_ROUTES,
  buildSitemap,
  isIndexablePath,
} from '../src/lib/seo/routes'
import {
  breadcrumbStructuredData,
  organisationStructuredData,
  productStructuredData,
} from '../src/lib/seo/structured-data'

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

const SITE = 'https://north01.example'

/* ============================================ A — §24.1a canonical URLs */
{
  check(
    'A: a canonical is absolute, from configuration',
    canonicalUrl(SITE, '/shop') === `${SITE}/shop`,
  )

  check(
    'A: **the query string is dropped** — a filtered view is one page seen through a filter',
    canonicalUrl(SITE, '/shop?colour=bone&page=3&sort=price') === `${SITE}/shop`,
  )

  check(
    'A: …and so is a fragment, which no server ever sees anyway',
    canonicalUrl(SITE, '/journal/note#pull-quote') === `${SITE}/journal/note`,
  )

  check(
    'A: a trailing slash is removed, so two URLs are not two pages',
    canonicalUrl(SITE, '/product/field-jacket/') === `${SITE}/product/field-jacket`,
  )

  check('A: the root keeps its single slash', canonicalUrl(SITE, '/') === `${SITE}/`)

  check(
    'A: a site URL with a trailing slash does not produce a double one',
    canonicalUrl(`${SITE}/`, '/shop') === `${SITE}/shop`,
  )

  check(
    'A: a path missing its leading slash is still absolute',
    canonicalUrl(SITE, 'shop') === `${SITE}/shop`,
  )
}

/* ============================================ B — §24.1a descriptions */
{
  check('B: whitespace collapses', trimDescription('  a   b  ') === 'a b')
  check('B: an empty description is null, not an empty tag', trimDescription('   ') === null)
  check(
    'B: …and so is a missing one',
    trimDescription(undefined) === null && trimDescription(null) === null,
  )

  const long = `${'sentence '.repeat(40)}end`
  const trimmed = trimDescription(long) ?? ''

  check('B: a long description is cut', trimmed.length <= 155, String(trimmed.length))

  check(
    'B: **cut at a word boundary**, never mid-word',
    long.startsWith(trimmed) && long.charAt(trimmed.length) === ' ',
  )

  check('B: and no ellipsis — a character spent saying "there was more"', !trimmed.endsWith('…'))

  check(
    'B: a description already inside the limit is returned whole',
    trimDescription('Short enough.') === 'Short enough.',
  )
}

/* ============================================ C — rich text flattened for a meta description */
{
  const lexical = {
    root: {
      children: [
        { children: [{ text: 'Cut from a dense cotton twill.', type: 'text' }], type: 'paragraph' },
        { children: [{ text: 'Made in Portugal.', type: 'text' }], type: 'paragraph' },
      ],
      type: 'root',
    },
  }

  check(
    'C: **paragraphs are flattened with a space**, not run together',
    richTextToPlainText(lexical) === 'Cut from a dense cotton twill. Made in Portugal.',
  )

  check('C: null rich text is an empty string, not a crash', richTextToPlainText(null) === '')
  check('C: …and so is a shape nobody recognises', richTextToPlainText({ blocks: 3 }) === '')

  check(
    'C: an unknown node costs its own text, not the description',
    richTextToPlainText({ root: { children: [{ type: 'somethingNew' }, { text: 'Kept.' }] } }) ===
      'Kept.',
  )
}

/* ============================================ D — §24.1a assembled */
{
  const meta = buildMetadata({
    description: 'A jacket.',
    image: 'https://cdn.example/card.jpg',
    path: '/product/field-jacket?size=m',
    siteUrl: SITE,
    title: 'Field Jacket',
  })

  check(
    'D: the canonical is set and carries no query',
    meta.alternates?.canonical === `${SITE}/product/field-jacket`,
  )

  check(
    'D: Open Graph carries the same URL',
    meta.openGraph?.url === `${SITE}/product/field-jacket`,
  )

  check(
    'D: **the OG title is the page title, not the templated one** — a card renders the site name',
    (meta.openGraph as { title?: string } | undefined)?.title === 'Field Jacket',
  )

  check(
    'D: an image promotes the Twitter card to a large one',
    (meta.twitter as { card?: string } | undefined)?.card === 'summary_large_image',
  )

  const noImage = buildMetadata({ path: '/journal/note', siteUrl: SITE, title: 'Note' })

  check(
    'D: **no image means `summary`** — a large card pointing at nothing renders worse than none',
    (noImage.twitter as { card?: string } | undefined)?.card === 'summary',
  )

  check(
    'D: a page with no description falls back rather than emitting an empty one',
    typeof noImage.description === 'string' && noImage.description.length > 0,
  )

  const overridden = buildMetadata({
    description: 'Derived.',
    overrides: { description: 'The editor typed this.', title: 'Editor title' },
    path: '/x',
    siteUrl: SITE,
    title: 'Derived title',
  })

  check("D: **the editor's override wins** — they meant it", overridden.title === 'Editor title')
  check('D: …for the description too', overridden.description === 'The editor typed this.')

  const blank = buildMetadata({
    description: 'Derived.',
    overrides: { description: '   ', title: '  ' },
    path: '/x',
    siteUrl: SITE,
    title: 'Derived title',
  })

  check(
    'D: **an emptied override means "derive it"**, not "publish an empty tag"',
    blank.title === 'Derived title' && blank.description === 'Derived.',
  )

  const absolute = buildMetadata({
    absoluteTitle: true,
    path: '/',
    siteUrl: SITE,
    title: 'NORTH / 01',
  })

  check(
    'D: the homepage bypasses the title template rather than reading "NORTH / 01 · NORTH / 01"',
    typeof absolute.title === 'object' && absolute.title !== null && 'absolute' in absolute.title,
  )
}

/* ============================================ E — §24.1d indexability */
{
  const priv = privateMetadata('Your bag')

  check('E: a private page is noindex', (priv.robots as { index?: boolean })?.index === false)
  check('E: …and nofollow', (priv.robots as { follow?: boolean })?.follow === false)

  check(
    'E: **and carries no canonical** — §24.1d asks for one signal, not two that disagree',
    priv.alternates === undefined,
  )

  const hidden = buildMetadata({
    index: false,
    path: '/checkout',
    siteUrl: SITE,
    title: 'Checkout',
  })

  check(
    'E: `index: false` produces the same shape',
    (hidden.robots as { index?: boolean })?.index === false,
  )

  check('E: …with no canonical either', hidden.alternates === undefined)

  for (const path of [
    '/account',
    '/account/orders/12',
    '/admin',
    '/admin/collections/products',
    '/api/webhooks/stripe',
    '/cart',
    '/checkout',
    '/checkout/success',
    '/design-system',
    '/forgot-password',
    '/login',
    '/register',
    '/reset-password',
    '/search',
    '/search?q=jacket',
  ]) {
    check(`E: \`${path}\` is not indexable`, !isIndexablePath(path))
  }

  for (const path of [
    '/',
    '/shop',
    '/shop/outerwear',
    '/product/field-jacket',
    '/journal',
    '/journal/note',
    '/lookbook',
    '/collections/ss26',
    '/edits/layering',
  ]) {
    check(`E: \`${path}\` is indexable`, isIndexablePath(path))
  }

  check(
    'E: **a prefix match is a path match, not a string match** — `/accounts-payable` is not `/account`',
    isIndexablePath('/accounts-payable'),
  )
}

/* ============================================ F — §24.1c the sitemap */
{
  const map = buildSitemap(SITE, [
    ...STATIC_SITEMAP_ROUTES,
    { path: '/product/one', priority: 0.8 },
    { path: '/cart' },
    { path: '/account/orders' },
    { path: '/admin' },
    { path: '/search' },
    { path: '/product/one', priority: 0.1 },
  ])

  const urls = map.map((entry) => entry.url)

  check(
    'F: the static routes are present',
    urls.includes(`${SITE}/`) && urls.includes(`${SITE}/shop`),
  )

  check('F: a product is present', urls.includes(`${SITE}/product/one`))

  check(
    'F: **the bag, the account, the admin and search are excluded** — §24.1c, by name',
    !urls.some((url) => /\/(cart|account|admin|search)/.test(url)),
  )

  check(
    'F: **the exclusion is the same list `robots.txt` disallows** — the two cannot disagree',
    NON_INDEXABLE_PREFIXES.every((prefix) => buildSitemap(SITE, [{ path: prefix }]).length === 0),
  )

  check(
    'F: a duplicate URL is emitted once',
    urls.filter((url) => url === `${SITE}/product/one`).length === 1,
  )

  check(
    'F: no URL carries a double slash after the origin',
    !urls.some((url) => url.slice(SITE.length).startsWith('//')),
  )

  check(
    'F: `lastModified` is omitted rather than defaulted to now',
    map.every((entry) => entry.lastModified === undefined),
  )

  const dated = buildSitemap(SITE, [
    { lastModified: new Date('2026-01-02T03:04:05Z'), path: '/journal/note' },
  ])

  check('F: …and present when it is real', dated[0]?.lastModified instanceof Date)
}

/* ============================================ G — §24.1b the price and availability prohibitions */

const BASE = {
  currency: 'USD',
  description: 'A jacket.',
  image: 'https://cdn.example/a.jpg',
  name: 'Field Jacket',
  sku: null,
  url: `${SITE}/product/field-jacket`,
}

{
  const inStock = productStructuredData({
    ...BASE,
    offers: [
      { available: 4, priceMinor: 24_000 },
      { available: 0, priceMinor: 9_900 },
    ],
    rating: null,
  })

  const offer = inStock.offers as Record<string, unknown>

  check(
    'G: a Product is emitted with the right context',
    inStock['@context'] === 'https://schema.org' && inStock['@type'] === 'Product',
  )

  check(
    'G: **a sold-out variant cannot set the price** — §24.1b names it "not actually purchasable"',
    offer.price === '240.00',
    String(offer.price),
  )

  check(
    'G: availability is InStock when something can be bought',
    offer.availability === 'https://schema.org/InStock',
  )

  const range = productStructuredData({
    ...BASE,
    offers: [
      { available: 2, priceMinor: 12_000 },
      { available: 1, priceMinor: 18_000 },
    ],
    rating: null,
  })

  const aggregate = range.offers as Record<string, unknown>

  check(
    'G: two prices become an AggregateOffer carrying both ends',
    aggregate['@type'] === 'AggregateOffer' &&
      aggregate.lowPrice === '120.00' &&
      aggregate.highPrice === '180.00',
  )

  check('G: …counting only the purchasable variants', aggregate.offerCount === 2)

  const soldOut = productStructuredData({
    ...BASE,
    offers: [{ available: 0, priceMinor: 24_000 }],
    rating: null,
  })

  const soldOutOffer = soldOut.offers as Record<string, unknown>

  check(
    'G: **nothing buyable is OutOfStock**, not a silent InStock',
    soldOutOffer.availability === 'https://schema.org/OutOfStock',
  )

  check(
    'G: **…and carries no price at all** — a price nobody can pay is the forbidden claim',
    soldOutOffer.price === undefined && soldOutOffer.lowPrice === undefined,
  )

  const noVariants = productStructuredData({ ...BASE, offers: [], rating: null })

  check(
    'G: a product with no variants emits **no offer**, rather than a free one',
    noVariants.offers === undefined,
  )

  const unpriced = productStructuredData({
    ...BASE,
    offers: [{ available: 3, priceMinor: Number.NaN }],
    rating: null,
  })

  check(
    'G: a variant with no price is not purchasable, so it cannot set one',
    (unpriced.offers as Record<string, unknown>).availability === 'https://schema.org/OutOfStock',
  )
}

/* ============================================ H — §24.1b "fake ratings" */
{
  const none = productStructuredData({
    ...BASE,
    offers: [{ available: 1, priceMinor: 100 }],
    rating: null,
  })

  check(
    'H: **no reviews means no `aggregateRating` key** — not a zero, not five stars from nobody',
    none.aggregateRating === undefined,
  )

  const zeroCount = productStructuredData({
    ...BASE,
    offers: [{ available: 1, priceMinor: 100 }],
    rating: { average: 4.5, count: 0 },
  })

  check('H: a rating with a zero count is not emitted', zeroCount.aggregateRating === undefined)

  const zeroAverage = productStructuredData({
    ...BASE,
    offers: [{ available: 1, priceMinor: 100 }],
    rating: { average: 0, count: 3 },
  })

  check(
    'H: …and neither is a zero average, which is not a rating anybody gave',
    zeroAverage.aggregateRating === undefined,
  )

  const real = productStructuredData({
    ...BASE,
    offers: [{ available: 1, priceMinor: 100 }],
    rating: { average: 4.3, count: 12 },
  })

  const rating = real.aggregateRating as Record<string, unknown>

  check(
    'H: a real rating is emitted with its count',
    rating.ratingValue === 4.3 && rating.ratingCount === 12,
  )

  check(
    'H: …and states its scale, which every validator checks',
    rating.bestRating === 5 && rating.worstRating === 1,
  )
}

/* ============================================ I — the other two documents */
{
  const crumbs = breadcrumbStructuredData(SITE, [
    { name: 'Shop', path: '/shop' },
    { name: 'Field Jacket', path: '/product/field-jacket' },
  ])

  const items = crumbs.itemListElement as Record<string, unknown>[]

  check(
    'I: breadcrumb positions are one-based',
    items[0]?.position === 1 && items[1]?.position === 2,
  )

  check('I: …and absolute', items[1]?.item === `${SITE}/product/field-jacket`)

  const org = organisationStructuredData({ logo: null, name: 'NORTH / 01', siteUrl: SITE })

  check('I: an Organization with no logo omits the key', org.logo === undefined)

  check(
    'I: **and declares nothing else** — no address, no hours, on an online-only shop',
    Object.keys(org).sort().join(',') === '@context,@type,name,url',
  )
}

/* ============================================ J — seoField()'s overrides */
{
  check('J: a missing group is three nulls', documentSeo(undefined) === EMPTY_DOCUMENT_SEO)
  check('J: …and so is null', documentSeo(null) === EMPTY_DOCUMENT_SEO)

  const seo = documentSeo({ description: '  A description.  ', image: { id: 4 }, title: '  ' })

  check('J: text is trimmed', seo.description === 'A description.')
  check(
    'J: **whitespace is not an override** — an emptied field means "derive it"',
    seo.title === null,
  )
  check('J: a populated image survives', seo.image !== null)

  check(
    'J: **a bare relationship id is treated as absent** — it cannot produce a URL',
    documentSeo({ image: 4 }).image === null,
  )

  check(
    'J: the shared empty is frozen — nine collections hold the same object',
    Object.isFrozen(EMPTY_DOCUMENT_SEO),
  )
}

/* ============================================ K — the social card, in its absent cases */
{
  check(
    'K: no media is no card',
    socialImageUrl(null) === null && socialImageUrl(undefined) === null,
  )

  check(
    'K: an unmigrated asset — no Cloudinary id — is no card, not a broken URL',
    socialImageUrl({ id: 1 } as never) === null,
  )

  check(
    'K: **a video is not a social card** — an image transform on a video renders nowhere',
    socialImageUrl({
      cloudinaryPublicId: 'north01/clip',
      cloudinaryResourceType: 'video',
      id: 2,
    } as never) === null,
  )
}

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} SEO checks passed.`,
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
  throw new Error(`${failed.length} SEO check(s) failed.`)
}
