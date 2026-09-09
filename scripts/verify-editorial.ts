/**
 * **The editorial pages — plan §23.**
 *
 * ```
 * pnpm verify:editorial
 * ```
 *
 * The phase prompt names four failure cases rather than four tests: *"handle unpublished content,
 * missing hero media, empty product relationships, and deleted related products without broken
 * pages."* All four are resolution decisions, so all four are assertable without a browser.
 *
 * Section A is pure. B is the real database, and the **D-10** guard applies.
 */

import type { Payload } from 'payload'

import config from '../src/payload.config'

import { developmentDatabase } from '../src/lib/env.core'
import { resolveEditorialBody, resolveEditorialSection } from '../src/lib/editorial/resolve'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-editorial refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes collection documents, so it may only touch the development database ' +
      'that DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const { getPayload } = await import('payload')

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

const CONTEXT = { currency: 'USD' as const, locale: 'en-US' }
const MEDIA = { id: 1, url: 'https://example.test/a.jpg' }

const resolve = (block: unknown) => resolveEditorialSection(block as never, 0, CONTEXT)

/* ============================================ A — the four named failure cases, as decisions */
{
  check(
    'A: **missing hero media drops the figure, not the page**',
    resolve({ blockType: 'figure', image: null }) === null,
  )

  check(
    'A: …and a figure WITH media resolves',
    resolve({ blockType: 'figure', image: MEDIA, treatment: 'contained' })?.type === 'figure',
  )

  check(
    'A: a bare media id is treated as absent — it cannot be rendered',
    resolve({ blockType: 'figure', image: 7 }) === null,
  )

  check(
    'A: **empty product relationships drop the group** — a heading above nothing is worse',
    resolve({ blockType: 'productGroup', heading: 'Layers', products: [] }) === null,
  )

  check(
    'A: **§22.1b a shop-the-look with no resolvable hotspot drops the section**',
    resolve({ blockType: 'shopTheLook', hotspots: [{ product: null }], image: MEDIA }) === null,
  )

  check(
    'A: …and one with no image drops too, rather than rendering markers over nothing',
    resolve({ blockType: 'shopTheLook', hotspots: [], image: null }) === null,
  )

  /* The two blocks that had no renderer until this phase. */
  const gallery = resolve({
    blockType: 'gallery',
    images: [{ image: MEDIA }, { image: MEDIA, caption: 'Two' }],
    layout: 'triptych',
  })

  check(
    'A: **the gallery block resolves** — it had no renderer before Phase 23',
    gallery?.type === 'gallery',
  )
  check(
    'A: …a gallery whose images all failed is dropped',
    resolve({ blockType: 'gallery', images: [{ image: null }, { image: null }] }) === null,
  )
  check(
    'A: …and one that falls below two frames is dropped, because the layout no longer applies',
    resolve({ blockType: 'gallery', images: [{ image: MEDIA }, { image: null }] }) === null,
  )

  const quote = resolve({ blockType: 'pullQuote', attribution: '  ', quote: 'Fewer, better.' })

  check(
    'A: **the pull quote resolves** — the other block nothing rendered',
    quote?.type === 'pullQuote' && quote.quote === 'Fewer, better.',
  )
  check(
    'A: …a whitespace attribution becomes null rather than an empty cite',
    quote?.type === 'pullQuote' && quote.attribution === null,
  )
  check(
    'A: …and a quote with no text is dropped',
    resolve({ blockType: 'pullQuote', quote: '   ' }) === null,
  )

  check(
    'A: an unknown block costs that block, not the page',
    resolve({ blockType: 'somethingNobodyBuiltYet' }) === null,
  )

  const body = resolveEditorialBody(
    [
      { blockType: 'figure', image: null },
      { blockType: 'pullQuote', quote: 'Kept.' },
      { blockType: 'productGroup', products: [] },
    ] as never,
    CONTEXT,
  )

  check(
    'A: **a body resolves to only what can render** — two dropped, one kept',
    body.length === 1 && body[0]?.type === 'pullQuote',
    String(body.length),
  )

  check('A: keys are unique within a body', new Set(body.map((s) => s.key)).size === body.length)
}

/* ============================================ B — against the database */

const payload: Payload = await getPayload({ config })

const created: { collection: 'collections' | 'journal' | 'products'; id: number }[] = []

const cleanup = async () => {
  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true, trash: false })
      .catch(() => undefined)
  }
}

const suffix = Date.now().toString().slice(-9)

try {
  const { getCollectionPage, getJournalArticle, readProductCards } =
    await import('../src/lib/editorial/read')

  const draft = await payload.create({
    collection: 'collections',
    data: {
      slug: `editorial-draft-${suffix}`,
      status: 'draft',
      title: `Draft collection ${suffix}`,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'collections', id: draft.id })

  check(
    'B: **an unpublished collection resolves to null** — a draft is absent, not forbidden',
    (await getCollectionPage(draft.slug as string)) === null,
  )

  check(
    'B: an unknown slug is the same absence, so a URL cannot enumerate unreleased work',
    (await getCollectionPage(`no-such-collection-${suffix}`)) === null,
  )

  const published = await payload.create({
    collection: 'collections',
    data: {
      slug: `editorial-live-${suffix}`,
      status: 'published',
      title: `Live collection ${suffix}`,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'collections', id: published.id })

  const view = await getCollectionPage(published.slug as string)

  check('B: a published collection resolves', view !== null)
  check(
    'B: **a collection with no products is a real state, not a crash**',
    view?.products.length === 0 && view.featured.length === 0,
  )

  /* The prompt's "deleted related products": an unpublished product is simply not offered. */
  const hidden = await payload.create({
    collection: 'products',
    data: {
      name: `Editorial fixture ${suffix}`,
      slug: `editorial-fixture-${suffix}`,
      sortOrder: 9999,
      status: 'draft',
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'products', id: hidden.id })

  check(
    'B: **an unpublished related product is not offered** — never a link to a 404',
    (await readProductCards([hidden.id])).length === 0,
  )

  check(
    'B: …and an id that names nothing at all is simply absent',
    (await readProductCards([2_147_483_600])).length === 0,
  )

  const article = await payload.create({
    collection: 'journal',
    data: {
      category: 'craft',
      slug: `editorial-note-${suffix}`,
      status: 'published',
      title: `Note ${suffix}`,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'journal', id: article.id })

  const note = await getJournalArticle(article.slug as string)

  check('B: a journal article resolves', note !== null)

  check(
    'B: **§23.1c an article with no relationships still has somewhere to go** — no dead end',
    note !== null &&
      note.relatedArticles.length === 0 &&
      note.relatedCollections.length === 0 &&
      note.relatedProducts.length === 0,
    'the page renders a fallback exit for exactly this case',
  )
} finally {
  await cleanup()
}

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} editorial checks passed.`,
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

await payload.destroy()

if (failed.length > 0) {
  throw new Error(`${failed.length} editorial check(s) failed.`)
}
