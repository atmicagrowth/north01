/**
 * The Phase 9 shell rules, checked against the running code rather than against the comments that
 * describe them.
 *
 * ```
 * pnpm verify:shell
 * ```
 *
 * **It runs in two halves.**
 *
 * The first needs no database. `lib/navigation/routes.ts` and `lib/navigation/resolve.ts` import
 * nothing from Next and nothing from the server — that separation exists so that the whole of
 * feature matrix §1's edge-case list can be exercised here as pure functions, one fixture per case,
 * instead of being asserted by reading a browser.
 *
 * The second half reads the real `navigation` and `site-settings` globals, and then does the thing
 * fixtures cannot: it creates **real** documents in three publication states, points real navigation
 * links at them, and checks that the resolver drops exactly the two that a customer must not see. A
 * hand-written fixture proves the function; a real Payload document proves the function is being fed
 * what it thinks it is — the difference that mattered in Phase 7's access harness.
 *
 * It writes to the database and cleans up after itself, and refuses to run anywhere but the
 * development database `DATABASE_PUSH_TARGET` names — the **D-10** guard, the same one `seed.ts`,
 * `verify-access.ts` and `verify-media.ts` use.
 *
 * `lib/navigation/shell.ts` is deliberately *not* imported: it is `server-only` and depends on
 * Next's data cache, neither of which exists under the Payload CLI. That module holds caching and a
 * try/catch and no rules, which is why every rule is somewhere this script can reach.
 */

import type { Payload } from 'payload'

import config from '../src/payload.config'

import { developmentDatabase } from '../src/lib/env.core'
import { FALLBACK_NAVIGATION } from '../src/lib/navigation/fallback'
import {
  resolveAnnouncement,
  resolveLink,
  resolveNavigation,
  resolveSettings,
} from '../src/lib/navigation/resolve'
import { documentHref, isExternalHref, isInternalHref } from '../src/lib/navigation/routes'
import { legalNav, utilityNav } from '../src/lib/navigation/utility'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-shell refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes collection documents, so it may only touch the development database ' +
      'that DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const { getPayload } = await import('payload')

/* -------------------------------------------------------------------------------------------------
 * Harness
 * ---------------------------------------------------------------------------------------------- */

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

/** The fixture shape `resolveLink` accepts, without exporting an internal type to reach it. */
type LinkFixture = Parameters<typeof resolveLink>[0]

const link = (fixture: unknown) => resolveLink(fixture as LinkFixture)

/* -------------------------------------------------------------------------------------------------
 * A — the route map (D-30, closing G-15)
 * ---------------------------------------------------------------------------------------------- */

const ROUTE_CASES: [string, string, null | string][] = [
  ['products', 'field-jacket', '/product/field-jacket'],
  ['categories', 'clothing', '/shop/clothing'],
  ['collections', 'essentials', '/collections/essentials'],
  ['edits', 'weekend', '/edit/weekend'],
  ['lookbooks', 'aw26', '/lookbook/aw26'],
  ['journal', 'on-wool', '/journal/on-wool'],
  // No document gives a campaign a page of its own. It resolves to nothing and is dropped.
  ['campaigns', 'aw26', null],
  // A collection that is not linkable at all — the "broken internal route" case at its root.
  ['orders', 'anything', null],
]

for (const [collection, slug, expected] of ROUTE_CASES) {
  const actual = documentHref(collection, slug)
  check(`route: ${collection} → ${expected ?? 'nothing'}`, actual === expected, actual ?? 'null')
}

check(
  'route: the Edit namespace is the structure document’s word, not the collection slug',
  documentHref('edits', 'weekend')?.startsWith('/edit/') === true,
)

check(
  'route: the Lookbook namespace is singular for the same reason',
  documentHref('lookbooks', 'aw26')?.startsWith('/lookbook/') === true,
)

/* -------------------------------------------------------------------------------------------------
 * B — href validation, which is also an open-redirect boundary
 * ---------------------------------------------------------------------------------------------- */

const HREF_CASES: [string, boolean, boolean][] = [
  // href, internal, external
  ['/shop', true, false],
  ['/shop/clothing?sort=newest', true, false],
  ['https://instagram.com/north01', false, true],
  ['http://example.test', false, true],
  // Protocol-relative: a browser resolves this off-site.
  ['//evil.example', false, false],
  // Backslash variant, which some parsers normalise to the above.
  ['/\\evil.example', false, false],
  ['javascript:alert(1)', false, false],
  ['shop', false, false],
  ['', false, false],
]

for (const [href, internal, external] of HREF_CASES) {
  check(
    `href: ${href || '(empty)'} — internal ${internal}, external ${external}`,
    isInternalHref(href) === internal && isExternalHref(href) === external,
  )
}

/* -------------------------------------------------------------------------------------------------
 * C — one link at a time
 * ---------------------------------------------------------------------------------------------- */

check(
  'link: a typed path resolves',
  link({ label: 'Shop', kind: 'url', href: '/shop' })?.href === '/shop',
)

check(
  'link: an external URL is marked external',
  link({ label: 'Instagram', kind: 'url', href: 'https://instagram.com/x' })?.external === true,
)

check(
  'link: an internal path is not marked external',
  link({ label: 'Shop', kind: 'url', href: '/shop' })?.external === false,
)

check(
  'link: whitespace around a typed path is trimmed, not rejected',
  link({ label: 'Shop', kind: 'url', href: '  /shop  ' })?.href === '/shop',
)

check(
  'link: a protocol-relative href is dropped',
  link({ label: 'X', kind: 'url', href: '//evil.example' }) === null,
)

check(
  'link: a javascript: href is dropped',
  link({ label: 'X', kind: 'url', href: 'javascript:alert(1)' }) === null,
)

check('link: an empty href is dropped', link({ label: 'X', kind: 'url', href: '' }) === null)

check('link: a missing href is dropped', link({ label: 'X', kind: 'url' }) === null)

check(
  'link: a label of only whitespace is dropped — an unnamed navigation item is not a destination',
  link({ label: '   ', kind: 'url', href: '/shop' }) === null,
)

check(
  'link: the label is trimmed',
  link({ label: ' Shop ', kind: 'url', href: '/shop' })?.label === 'Shop',
)

check(
  'link: a reference with kind=url ignores the reference and uses the href',
  link({
    label: 'Shop',
    kind: 'url',
    href: '/shop',
    reference: { relationTo: 'collections', value: { slug: 'x', status: 'published' } },
  })?.href === '/shop',
)

check(
  'link: kind=reference ignores a stale href left in the row',
  link({
    label: 'Essentials',
    kind: 'reference',
    href: '/somewhere-else',
    reference: { relationTo: 'collections', value: { slug: 'essentials', status: 'published' } },
  })?.href === '/collections/essentials',
)

check(
  'edge case — broken internal route: a deleted target (ON DELETE SET NULL) is dropped',
  link({ label: 'Gone', kind: 'reference', reference: null }) === null,
)

check(
  'edge case — missing navigation item: an unpopulated reference (depth 0) is dropped',
  link({
    label: 'Id only',
    kind: 'reference',
    reference: { relationTo: 'collections', value: 42 },
  }) === null,
)

check(
  'edge case — unpublished collection: a draft target is dropped',
  link({
    label: 'Draft',
    kind: 'reference',
    reference: { relationTo: 'collections', value: { slug: 'draft', status: 'draft' } },
  }) === null,
)

check(
  'link: a published target with a past publishedAt resolves',
  link({
    label: 'Live',
    kind: 'reference',
    reference: {
      relationTo: 'collections',
      value: { slug: 'live', status: 'published', publishedAt: '2020-01-01T00:00:00.000Z' },
    },
  })?.href === '/collections/live',
)

check(
  'link: a published target scheduled for the future is dropped — a listing hides it, the URL does not',
  link({
    label: 'Scheduled',
    kind: 'reference',
    reference: {
      relationTo: 'collections',
      value: { slug: 'later', status: 'published', publishedAt: '2999-01-01T00:00:00.000Z' },
    },
  }) === null,
)

check(
  'link: publishedAt absent (a taxonomy is never scheduled) does not block a published target',
  link({
    label: 'Clothing',
    kind: 'reference',
    reference: { relationTo: 'categories', value: { slug: 'clothing', status: 'published' } },
  })?.href === '/shop/clothing',
)

check(
  'link: an unparseable publishedAt does not override the status column',
  link({
    label: 'Odd',
    kind: 'reference',
    reference: {
      relationTo: 'collections',
      value: { slug: 'odd', status: 'published', publishedAt: 'not a date' },
    },
  })?.href === '/collections/odd',
)

check(
  'link: a published target with no slug is dropped',
  link({
    label: 'Slugless',
    kind: 'reference',
    reference: { relationTo: 'collections', value: { slug: '', status: 'published' } },
  }) === null,
)

check(
  'link: a reference to a campaign is dropped — no document gives a campaign a page',
  link({
    label: 'AW26',
    kind: 'reference',
    reference: { relationTo: 'campaigns', value: { slug: 'aw26', status: 'published' } },
  }) === null,
)

/* -------------------------------------------------------------------------------------------------
 * D — the whole navigation
 * ---------------------------------------------------------------------------------------------- */

const empty = resolveNavigation(null)
check(
  'navigation: a missing global resolves to empty arrays rather than throwing',
  empty.primary.length === 0 && empty.footer.length === 0 && empty.social.length === 0,
)

const fixture = resolveNavigation({
  id: 1,
  primary: [
    { label: 'Shop', kind: 'url', href: '/shop', columns: [], feature: { kind: 'url' } },
    // Dropped: no href at all.
    { label: 'Nowhere', kind: 'url', href: '', columns: [], feature: { kind: 'url' } },
    {
      label: 'Collections',
      kind: 'url',
      href: '/collections',
      columns: [
        {
          heading: 'Live',
          links: [
            { label: 'Essentials', kind: 'url', href: '/collections/essentials' },
            // Dropped: draft target.
            {
              label: 'Hidden',
              kind: 'reference',
              reference: { relationTo: 'collections', value: { slug: 'hidden', status: 'draft' } },
            },
          ],
        },
        // Dropped whole: every link in it is unresolvable.
        { heading: 'Empty', links: [{ label: 'Broken', kind: 'reference', reference: null }] },
      ],
      feature: { kind: 'url' },
    },
  ],
  footer: [
    { heading: 'Shop', links: [{ label: 'All', kind: 'url', href: '/shop' }] },
    // Dropped: a heading over nothing.
    { heading: 'Empty', links: [] },
    // Dropped: a column with no heading has no accessible name.
    { heading: '  ', links: [{ label: 'All', kind: 'url', href: '/shop' }] },
  ],
  social: [
    { platform: 'tiktok', url: 'https://tiktok.com/@north01' },
    // Dropped: not an absolute URL, so it is not a profile.
    { platform: 'x', url: '/north01' },
  ],
} as Parameters<typeof resolveNavigation>[0])

check('navigation: an item with no resolvable href is dropped', fixture.primary.length === 2)
check(
  'navigation: item order is the editor’s, unchanged',
  fixture.primary[0]?.label === 'Shop' && fixture.primary[1]?.label === 'Collections',
)
check(
  'navigation: a column keeps its resolvable links and loses the rest',
  fixture.primary[1]?.columns[0]?.links.length === 1,
)
check(
  'navigation: a column whose every link was dropped is removed, not rendered as an empty heading',
  fixture.primary[1]?.columns.length === 1,
)
check(
  'navigation: a featured panel with neither image nor caption is not a panel',
  fixture.primary[0]?.feature === null,
)
check('footer: a column with no links is dropped', fixture.footer.length === 1)
check('footer: a column with no heading is dropped', fixture.footer[0]?.heading === 'Shop')
check('social: a non-absolute URL is dropped', fixture.social.length === 1)
check('social: the platform gets its printed name', fixture.social[0]?.label === 'TikTok')

const featured = resolveNavigation({
  id: 1,
  primary: [
    {
      label: 'Shop',
      kind: 'url',
      href: '/shop',
      columns: [],
      feature: { caption: 'The winter edit', kind: 'url', href: '/collections/limited' },
    },
  ],
} as Parameters<typeof resolveNavigation>[0])

check(
  'feature: a caption with no label still produces a link, named by the caption',
  featured.primary[0]?.feature?.link?.label === 'The winter edit',
)
check(
  'feature: an unpopulated image id is treated as no image',
  featured.primary[0]?.feature?.image === null,
)

/* -------------------------------------------------------------------------------------------------
 * E — identity and the announcement bar
 * ---------------------------------------------------------------------------------------------- */

check(
  'settings: a missing global still names the shop',
  resolveSettings(null).siteName === 'NORTH / 01',
)

check(
  'announcement: disabled is no bar',
  resolveAnnouncement({ enabled: false, message: 'Hello' }) === null,
)
check(
  'announcement: enabled with an empty message is no bar',
  resolveAnnouncement({ enabled: true, message: '   ' }) === null,
)
check(
  'announcement: enabled with a message and no href is a bar that is not a link',
  resolveAnnouncement({ enabled: true, message: 'Free delivery over $150' })?.href === null,
)
check(
  'announcement: an unsafe href is dropped, the message is kept',
  resolveAnnouncement({ enabled: true, message: 'Hello', href: 'javascript:alert(1)' })?.href ===
    null,
)
check(
  'announcement: a site path is kept',
  resolveAnnouncement({ enabled: true, message: 'Hello', href: '/shop' })?.href === '/shop',
)

/* -------------------------------------------------------------------------------------------------
 * F — the degraded shell
 * ---------------------------------------------------------------------------------------------- */

check(
  'fallback: six primary destinations, including NEW (DEV-07)',
  FALLBACK_NAVIGATION.primary.length === 6 && FALLBACK_NAVIGATION.primary[0]?.label === 'New',
)
check(
  'fallback: no mega menu, no featured panel — structure, never merchandising',
  FALLBACK_NAVIGATION.primary.every((item) => item.columns.length === 0 && item.feature === null),
)
check('fallback: no social links, for the same reason', FALLBACK_NAVIGATION.social.length === 0)
check(
  'fallback: Journal is in the footer and not in the primary set (C-07)',
  !FALLBACK_NAVIGATION.primary.some((item) => item.label === 'Journal') &&
    FALLBACK_NAVIGATION.footer.some((column) =>
      column.links.some((entry) => entry.label === 'Journal'),
    ),
)
check(
  'utilities: wishlist routes to the account segment (C-09)',
  utilityNav.wishlist.href === '/account/wishlist',
)
check('utilities: the legal row is two links, and is not CMS content', legalNav.length === 2)

/* -------------------------------------------------------------------------------------------------
 * G — against the real database
 * ---------------------------------------------------------------------------------------------- */

const payload: Payload = await getPayload({ config })
const PREFIX = 'verify-shell'
const created: number[] = []

async function cleanup() {
  for (const id of created) {
    await payload
      .delete({ collection: 'collections', id, overrideAccess: true, trash: false })
      .catch(() => undefined)
  }
}

try {
  const navigation = resolveNavigation(await payload.findGlobal({ slug: 'navigation', depth: 1 }))
  const settings = resolveSettings(await payload.findGlobal({ slug: 'site-settings', depth: 1 }))

  check(
    'live: the navigation global resolves to at least one primary item',
    navigation.primary.length > 0,
    `${navigation.primary.length} item(s)`,
  )
  check(
    'live: the schema cap of six primary items holds (DEV-07, C-08)',
    navigation.primary.length <= 6,
    `${navigation.primary.length}`,
  )
  check(
    'live: every rendered primary item has a real href',
    navigation.primary.every((item) => item.href.startsWith('/') || isExternalHref(item.href)),
  )
  check(
    'live: every mega-menu column that survived has at least one link',
    navigation.primary.every((item) => item.columns.every((column) => column.links.length > 0)),
  )
  check(
    'live: at least one primary item is a mega menu',
    navigation.primary.some((item) => item.columns.length > 0),
    `${navigation.primary.filter((item) => item.columns.length > 0).length} with columns`,
  )
  check(
    'live: the footer resolves to at least one column',
    navigation.footer.length > 0,
    `${navigation.footer.length} column(s)`,
  )
  check('live: the site name is set', settings.siteName.length > 0, settings.siteName)

  /*
   * The three publication states, as real rows.
   *
   * This is the half a fixture cannot do. `resolveNavigation` is fed what *Payload* returns at
   * depth 1 — including the fact that `publishedAt` comes back as an ISO string rather than a Date,
   * and that `status` is on the document rather than on the relationship — so a change to either of
   * those shapes fails here rather than in a browser.
   */
  const states = [
    {
      slug: `${PREFIX}-published`,
      status: 'published' as const,
      publishedAt: '2020-01-01T00:00:00.000Z',
    },
    { slug: `${PREFIX}-draft`, status: 'draft' as const, publishedAt: null },
    {
      slug: `${PREFIX}-scheduled`,
      status: 'published' as const,
      publishedAt: '2999-01-01T00:00:00.000Z',
    },
  ]

  for (const state of states) {
    const document = await payload.create({
      collection: 'collections',
      data: {
        title: state.slug,
        slug: state.slug,
        status: state.status,
        publishedAt: state.publishedAt,
      },
      overrideAccess: true,
    })

    created.push(document.id)
  }

  const referenced = await Promise.all(
    created.map((id) =>
      payload.findByID({ collection: 'collections', id, depth: 0, overrideAccess: true }),
    ),
  )

  const [live, draft, scheduled] = referenced

  check(
    'live: a reference to a real published document resolves to its route',
    link({
      label: 'Published',
      kind: 'reference',
      reference: { relationTo: 'collections', value: live },
    })?.href === `/collections/${PREFIX}-published`,
  )

  check(
    'live: a reference to a real draft document is dropped',
    link({
      label: 'Draft',
      kind: 'reference',
      reference: { relationTo: 'collections', value: draft },
    }) === null,
  )

  check(
    'live: a reference to a real scheduled document is dropped',
    link({
      label: 'Scheduled',
      kind: 'reference',
      reference: { relationTo: 'collections', value: scheduled },
    }) === null,
  )

  /*
   * And the one that cannot be faked: unpublish a document that a link already points at, re-read it,
   * and watch the item leave the navigation. This is feature matrix §1's "unpublished collection"
   * as a sequence of events rather than as a state.
   */
  await payload.update({
    collection: 'collections',
    id: created[0],
    data: { status: 'draft' },
    overrideAccess: true,
  })

  const unpublished = await payload.findByID({
    collection: 'collections',
    id: created[0],
    depth: 0,
    overrideAccess: true,
  })

  check(
    'live: unpublishing a document a navigation item points at removes the item',
    resolveNavigation({
      id: 1,
      primary: [
        {
          label: 'Shop',
          kind: 'url',
          href: '/shop',
          columns: [
            {
              heading: 'Live',
              links: [
                {
                  label: 'Was published',
                  kind: 'reference',
                  reference: { relationTo: 'collections', value: unpublished },
                },
              ],
            },
          ],
          feature: { kind: 'url' },
        },
      ],
    } as Parameters<typeof resolveNavigation>[0]).primary[0]?.columns.length === 0,
  )

  /*
   * Deleting it is the "broken internal route" case at its most literal: Payload's `ON DELETE SET
   * NULL` leaves the row with a reference of `null`, which is what the resolver actually receives.
   */
  await payload.delete({
    collection: 'collections',
    id: created[0],
    overrideAccess: true,
    trash: false,
  })
  created.shift()

  check(
    'live: a deleted target leaves a null reference, and the item is dropped',
    link({ label: 'Deleted', kind: 'reference', reference: null }) === null,
  )
} finally {
  await cleanup()
}

/* -------------------------------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------------------------------- */

const failed = results.filter((result) => !result.ok)

for (const result of results) {
  payload.logger.info(
    `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  )
}

payload.logger.info(`${results.length - failed.length}/${results.length} shell checks passed.`)

if (failed.length > 0) {
  throw new Error(`${failed.length} shell check(s) failed.`)
}

process.exit(0)
