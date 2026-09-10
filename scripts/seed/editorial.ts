import type { Payload } from 'payload'

import { rich, upsert } from './shared'

/**
 * **The second half of the editorial demo** — Phase 29, §29.1c and the phase prompt's
 * *"multiple collections, edits, a lookbook, journal entries, FAQs"*.
 *
 * `seed.ts` already writes four collections, four Edits, one lookbook, three articles and six FAQs.
 * That is a catalogue with an editorial layer, not an editorial layer worth demonstrating: `/lookbook`
 * is an index with a single card on it, every FAQ topic holds exactly one question, and no Edit uses
 * the two fields — group `intro` and `lookbooks` — that are the difference between an Edit and a list.
 * This module adds a second lookbook, three articles, eight FAQs and one Edit, and nothing else.
 *
 * ### What "authored rather than generated from a template" meant here (§29.1c)
 *
 * §29.1c is written about products and it is really a rule about the whole demo, so it is applied to
 * the prose as well: the three articles are 4, 3 and 2 paragraphs long, they carry 2, 3 and 3 related
 * products and 2, 1 and 2 related collections, one chapter of the lookbook has a gallery and the other
 * two do not, and one hotspot in three carries a styling label. None of that is decoration. A demo in
 * which every article has three of everything reads as a fixture, and the client reads the shape
 * before they read the words.
 *
 * The copy follows the voice already in `seed.ts` — short declarative sentences, concrete materials,
 * a stated trade-off — and it stays consistent with the catalogue rather than beside it: the merino
 * article uses the 18.5 micron and single-piece knit from `merino-crew`, and the FAQ answers quote the
 * real numbers out of `lib/shipping/rules.ts` (3–5 business days, 2, next day) and
 * `site-settings.returnsPolicy` (30 days, unworn, tags on) rather than inventing a policy the rest of
 * the site would contradict.
 *
 * ### Photography: this module places chapter heroes, and nothing else
 *
 * `generate-media.ts` walks every lookbook, article and Edit and attaches a cover or hero to each, so
 * the documents written here get their index-card art for free. What it does not touch is a lookbook
 * **chapter**'s `heroImage`, and a chapter with no image renders no hotspots at all
 * (`components/editorial/lookbook-page.tsx`) — which would make a shoppable lookbook that is not
 * shoppable.
 *
 * So the chapters look the library up themselves: preferred by filename stem, the names
 * `import-brand-media.ts` gives the supplied photography, and falling back to any editorial-role asset
 * by position when those names are absent. **With an empty library the chapters are written as text and
 * the hotspots are omitted entirely**, because eight hotspot rows hanging off a `null` image are eight
 * rows of nothing — the same adaptive shape, and the same reasoning, as the homepage composition in
 * `seed.ts`. On a fresh database the seed runs before any media exists, so the honest instruction is
 * the one the homepage already implies: run `pnpm seed` once more after `pnpm generate:media` or
 * `pnpm import:media`, and the second run fills the chapters in.
 *
 * The placement map in `import-brand-media.ts` is still the authority on *which* photograph belongs to
 * *which* page; it addresses documents by slug and does not name this lookbook. If it ever does, the
 * stem list below should be deleted rather than kept in step with it.
 *
 * ### What this does not do
 *
 * - **No new collections.** Structure §2 fixes them at four and DEV-01 settled which four; a fifth
 *   would be a navigation change dressed as demo content.
 * - **The fifth Edit is not in the navigation.** `seed.ts` builds the Edit menu column from its own
 *   `editSpecs` array, and DEV-01 fixes that menu at the structure document's four. `Edits.ts` predicts
 *   exactly this — *"a fifth Edit is reachable only from within the section"* — and it is the right
 *   outcome, not an oversight. It is reachable at `/edit/cold` and from the collections it neighbours.
 * - **No reviews, orders or customers.** Not content; `seed.ts` says why at length.
 *
 * The one place it reaches outside its own documents is `relatedArticles` on the three articles
 * `seed.ts` writes, and only while that field is empty — see the back-link pass, which explains why
 * a one-directional relationship leaves them as dead ends otherwise.
 *
 * Every write goes through `upsert` keyed on `slug`, or on `question` for a FAQ, so a second run
 * updates in place. The two journal passes are deliberate: the cross-links between new articles need
 * ids that only exist after the first pass, and the second pass is another `upsert` on the same key
 * rather than a bare `update`, so it cannot create a half-formed document if the order ever changes.
 */

/** A hotspot as this module declares it — slugs and percentages, resolved against `productIds`. */
type HotspotSpec = {
  /** Optional styling note. Overrides the product name in the marker — `fields/hotspot.ts`. */
  label?: string
  slug: string
  /**
   * Tone follows what sits *under the dot*, not the mood of the photograph: a marker on the pale sky
   * behind a shoulder needs to be dark even when everything else in the frame is black.
   */
  tone: 'dark' | 'light'
  x: number
  xMobile: number
  y: number
  yMobile: number
}

type ChapterSpec = {
  editorial: string[]
  /** Position in the editorial-role library to fall back to when `stem` is not there. */
  fallback: number
  gallery?: { caption: string; stem: string }[]
  hotspots: HotspotSpec[]
  /** Preferred photograph, by the filename stem `import-brand-media.ts` uploads it under. */
  stem: string
  title: string
}

/**
 * **In Black** — the second lookbook.
 *
 * AW26 is a book about a place: two chapters, one coast, *Headland* and *Inland*. Restating that with
 * different landscape would produce two of the same thing, so this one is about a **colour and the
 * three cloths that make it** — wool, cotton, indigo — which is a structure the catalogue can actually
 * fill, and which gives `/lookbook` an index of two genuinely different covers.
 */
const LOOKBOOK_CHAPTERS: ChapterSpec[] = [
  {
    editorial: [
      'Melton, brushed and pressed until the surface reads closer to felt than to cloth. It holds a shoulder with nothing inside it doing the holding.',
      'Worn over a fine merino, which is the whole argument: the warm layer is the thin one.',
    ],
    fallback: 0,
    hotspots: [
      {
        label: 'Wool Overshirt, worn open',
        slug: 'wool-overshirt',
        tone: 'light',
        x: 38,
        xMobile: 48,
        y: 44,
        yMobile: 40,
      },
      { slug: 'merino-crew', tone: 'light', x: 52, xMobile: 56, y: 58, yMobile: 62 },
    ],
    stem: '16_editorial_woman_black',
    title: 'Wool',
  },
  {
    editorial: [
      'Dyed in the piece, so the colour settles into the yarn rather than sitting on top of it.',
      'It will fade. Everything here does, at a rate you set.',
    ],
    fallback: 1,
    hotspots: [
      { slug: 'heavyweight-hoodie', tone: 'light', x: 44, xMobile: 50, y: 50, yMobile: 46 },
      {
        label: 'Field Jacket in Graphite',
        slug: 'field-jacket',
        // Against the sky rather than the garment — hence the dark marker. See `HotspotSpec.tone`.
        tone: 'dark',
        x: 62,
        xMobile: 66,
        y: 26,
        yMobile: 22,
      },
    ],
    stem: '09_male_black_outerwear',
    title: 'Cotton',
  },
  {
    editorial: ['Raw denim reads black until the light gets under it. Six months in, it does not.'],
    fallback: 2,
    /** The only chapter with a gallery. Two of three would be a pattern; one is an edit. */
    gallery: [
      { caption: 'Wet rock, for the black.', stem: '12_stone_texture' },
      { caption: 'Black sand. Where the season started.', stem: '10_coastal_black_sand_beach' },
    ],
    hotspots: [
      { slug: 'selvedge-denim', tone: 'light', x: 46, xMobile: 50, y: 66, yMobile: 70 },
      { slug: 'cotton-tee', tone: 'light', x: 50, xMobile: 52, y: 34, yMobile: 30 },
    ],
    stem: '11_editorial_woman_sunglasses',
    title: 'Indigo',
  },
]

type ArticleSpec = {
  /** Paragraphs. Deliberately 4, 3 and 2 — §29.1c. */
  body: string[]
  category: 'craft' | 'design' | 'people' | 'places' | 'style'
  collections: string[]
  excerpt: string
  products: string[]
  /**
   * Fixed, and backdated. `publishingFields` stamps `publishedAt` at the moment of first publish, so
   * three articles written in one pass would land within the same second and sort arbitrarily against
   * each other on `/journal`. An explicit date always wins, and a literal keeps the index order
   * identical on every machine that runs the seed.
   *
   * They are also held a week or more clear of *now*, because the three articles in `seed.ts` take
   * their date from whenever the seed first ran on that machine. Backdating is the only way these
   * six sort predictably against each other rather than tying with whatever the clock said.
   */
  publishedAt: string
  /** Slugs of other articles, resolved after every article exists. */
  related: string[]
  slug: string
  title: string
}

const ARTICLES: ArticleSpec[] = [
  {
    body: [
      'Extra-fine merino arrives at the mill as a rope of combed fibre about the thickness of a wrist, washed and sorted, every fibre lying the same way. What happens next — how hard it is twisted, how many strands are run together — decides whether it becomes a suit or a sweater. It is the only decision in the process that cannot be undone further down the line.',
      'The family running the frames is the fourth to do it. The machines are not: two of them were installed in the seventies and are kept because their slower speed puts less stress on the fibre. A modern frame produces the same yarn on paper and a yarn that pills in a season in the hand.',
      '18.5 micron is the number printed on the label. It is the average diameter of a single fibre, and it is the whole difference between wool that itches and wool that does not — under about nineteen, the fibre bends against the skin instead of pressing into it.',
      'The crew is then knitted in one piece from that yarn, which is the other half of what it costs. No side seams to press flat, and nothing to come apart along a line.',
    ],
    category: 'people',
    collections: ['current-season', 'essentials'],
    excerpt:
      'The merino in the crew is spun by a family who were at it before the mill had electricity. We asked what has changed.',
    products: ['merino-crew', 'cashmere-scarf'],
    publishedAt: '2026-08-18T09:00:00.000Z',
    related: ['on-selvedge', 'the-second-winter'],
    slug: 'a-mill-four-generations',
    title: 'A Mill, Four Generations',
  },
  {
    body: [
      'A patch pocket is sewn onto the outside of a garment rather than cut into it. It is the older method and the dearer one: the panel has to be cut with the grain running the same way as the body or it pulls out of square within a month, and the top corners are where a pocket fails, so both are bar-tacked by a second machine.',
      'The storm placket is the flap that covers the zip. A zip is a row of metal teeth with a gap down the middle of it, and wind finds the gap. The two-way zip underneath opens from the hem as well, so the jacket can be sat down in without riding up over the knees — borrowed from work coats, where sitting down is most of the day.',
      'None of it reads from three metres away, which is the test. If a detail only shows in a photograph it is styling. If it changes how the thing behaves in weather, it stays.',
    ],
    category: 'design',
    collections: ['current-season'],
    excerpt:
      'Four patch pockets, a storm placket, a two-way zip. None of it is decoration, and all of it costs money to make.',
    products: ['field-jacket', 'oxford-shirt', 'card-holder'],
    publishedAt: '2026-08-04T09:00:00.000Z',
    related: ['a-mill-four-generations', 'a-weekend-north'],
    slug: 'why-the-pocket-is-there',
    title: 'Why the Pocket Is There',
  },
  {
    body: [
      'Most clothes are bought for the first winter and judged on it, which is the wrong test, because nothing has had time to fail yet. The second winter is where it shows. The melton has pilled or it has not. The denim has faded along the lines your own body put there, or it has gone evenly grey. The jacket has softened, or it has gone limp.',
      'We make in small runs partly for this reason. A piece we would not stand behind in two years is not one we want to be able to reorder.',
    ],
    category: 'style',
    collections: ['limited', 'archive'],
    excerpt:
      'Anything survives one season. The question is whether you reach for it again in the November after.',
    products: ['wool-overshirt', 'selvedge-denim', 'field-jacket'],
    publishedAt: '2026-07-21T09:00:00.000Z',
    related: ['the-case-for-fewer-things', 'a-mill-four-generations'],
    slug: 'the-second-winter',
    title: 'The Second Winter',
  },
]

/**
 * **Eight more answers, across five of the six topics.**
 *
 * `/help/faq` groups by topic and hides a group with nothing in it (`lib/help/read.ts`), and a demo in
 * which every topic holds exactly one question shows the grouping without ever showing it working.
 * `sortOrder` is *within* a topic — `Faqs.ts` is explicit about that — so these are numbered around the
 * question `seed.ts` already put in each group rather than continuing its run: the delivery-time
 * question comes before the delivery-price one, at 10 against 20.
 *
 * Every answer is checked against something that exists. The estimates and prices are
 * `SHIPPING_METHODS` in `lib/shipping/rules.ts`, the returns window and the two ways of starting one
 * are `site-settings.returnsPolicy`, tracking is a real column on `orders` and a real dispatch email,
 * and the card answer is true because `Orders.ts` stores no card fields at all. An FAQ that promises a
 * screen the shop does not have is §0.1.17's fake functionality in prose.
 */
const FAQS: {
  answer: string[]
  question: string
  sortOrder: number
  topic: 'account' | 'care' | 'orders' | 'returns' | 'shipping' | 'sizing'
}[] = [
  {
    answer: [
      'It is in the dispatch email, and on the order in your account. Nothing moves on the tracking page until the carrier scans the parcel, which is usually the evening it leaves us.',
    ],
    question: 'Where is my tracking number?',
    sortOrder: 20,
    topic: 'orders',
  },
  {
    answer: [
      'Email help@north01.example straight away and we will try. Once an order is packed we cannot alter it, and after that the answer is a return.',
    ],
    question: 'Can I change or cancel an order after placing it?',
    sortOrder: 30,
    topic: 'orders',
  },
  {
    answer: [
      'Standard is three to five business days. Express is two, and Overnight is the next business day.',
      'The estimate shown at checkout is the one we hold ourselves to, and it starts from dispatch rather than from the order.',
    ],
    question: 'How long does delivery take?',
    sortOrder: 10,
    topic: 'shipping',
  },
  {
    answer: [
      'Standard and Express go worldwide. Overnight is United States only, because next-day is a promise we can keep in one country.',
    ],
    question: 'Do you ship outside the United States?',
    sortOrder: 30,
    topic: 'shipping',
  },
  {
    answer: [
      'We do not run exchanges. Return the piece for a refund and place a new order for the size you want.',
      'That holds the size for you now rather than after your parcel has crossed the country, which on a small run is the difference between getting it and not.',
    ],
    question: 'Can I exchange something for a different size?',
    sortOrder: 40,
    topic: 'returns',
  },
  {
    answer: [
      'We refund to the original payment method the day the return is checked in, and email you when we do. Banks then take a further three to five business days to show it.',
    ],
    question: 'When will I see the refund?',
    sortOrder: 50,
    topic: 'returns',
  },
  {
    answer: [
      'Not quite. The size guide measures the body, so a medium is the same chest on both — what differs is the fit printed beside it. The crew is cut slim and sits close; the oxford is regular and has room to be worn open over a tee.',
      'If you want the crew as an outer layer rather than a base one, take the larger size.',
    ],
    question: 'The Merino Crew and the Oxford Shirt are both a medium. Will they fit the same?',
    sortOrder: 50,
    topic: 'sizing',
  },
  {
    answer: [
      'As rarely as you can stand, then cold, inside out, and hung to dry. The denim is unwashed, so the creases set where your body puts them.',
      'A hot machine takes six months of that off in an hour, and it does not come back.',
    ],
    question: 'How do I wash raw denim?',
    sortOrder: 60,
    topic: 'care',
  },
]

export async function seedExtraEditorial(
  payload: Payload,
  options: { collectionIds: Map<string, number>; productIds: Map<string, number> },
): Promise<{ edits: number; faqs: number; journal: number; lookbooks: number }> {
  const { collectionIds, productIds } = options

  const product = (slug: string): number | undefined => productIds.get(slug)
  const collection = (slug: string): number | undefined => collectionIds.get(slug)

  const ids = (slugs: string[], lookup: (slug: string) => number | undefined): number[] =>
    slugs.map(lookup).filter((id): id is number => id !== undefined)

  // ------------------------------------------------------------------ media
  //
  // See the note at the top of this file: the chapter heroes are the one thing `generate-media.ts`
  // cannot supply, and the hotspots are unreachable without them.
  const { docs: mediaDocs } = await payload.find({
    collection: 'media',
    depth: 0,
    limit: 200,
    overrideAccess: true,
    sort: 'id',
  })

  const byStem = new Map<string, number>()

  for (const doc of mediaDocs) {
    if (typeof doc.filename === 'string' && doc.filename.length > 0) {
      byStem.set(doc.filename.replace(/\.[^.]+$/, ''), doc.id)
    }
  }

  const editorialPool = mediaDocs.filter((doc) => doc.role === 'editorial').map((doc) => doc.id)

  const frame = (stem: string, fallback: number): number | undefined =>
    byStem.get(stem) ?? editorialPool[fallback]

  // --------------------------------------------------------------- lookbook
  const lookbookId = await upsert({
    collection: 'lookbooks',
    data: {
      chapters: LOOKBOOK_CHAPTERS.map((chapter) => {
        const heroImage = frame(chapter.stem, chapter.fallback)

        return {
          editorialText: rich(...chapter.editorial),
          gallery: (chapter.gallery ?? []).flatMap((row) => {
            const image = byStem.get(row.stem)

            // A gallery row with no image fails `validateRequiredUpload` — it is not written at all.
            return image === undefined ? [] : [{ caption: row.caption, image }]
          }),
          heroImage: heroImage ?? null,
          /** No image, no markers. `lookbook-page.tsx` renders hotspots only inside the hero. */
          hotspots:
            heroImage === undefined
              ? []
              : chapter.hotspots.flatMap((hotspot) => {
                  const id = product(hotspot.slug)

                  return id === undefined
                    ? []
                    : [
                        {
                          label: hotspot.label,
                          markerTone: hotspot.tone,
                          product: id,
                          xDesktop: hotspot.x,
                          xMobile: hotspot.xMobile,
                          yDesktop: hotspot.y,
                          yMobile: hotspot.yMobile,
                        },
                      ]
                }),
          title: chapter.title,
        }
      }),
      intro: rich(
        'One colour, three cloths. Shot over two days on the same coast as the AW26 book, in weather that did most of the work.',
      ),
      /* Backdated so it files beneath AW26 on the index, which stamps itself at seed time. */
      publishedAt: '2026-08-20T09:00:00.000Z',
      season: 'AW26',
      slug: 'in-black',
      status: 'published',
      title: 'In Black',
    },
    payload,
    where: { slug: { equals: 'in-black' } },
  })

  // ---------------------------------------------------------------- journal
  for (const article of ARTICLES) {
    await upsert({
      collection: 'journal',
      data: {
        author: 'Editorial',
        body: rich(...article.body),
        category: article.category,
        excerpt: article.excerpt,
        publishedAt: article.publishedAt,
        relatedCollections: ids(article.collections, collection),
        relatedProducts: ids(article.products, product),
        slug: article.slug,
        status: 'published',
        title: article.title,
      },
      payload,
      where: { slug: { equals: article.slug } },
    })
  }

  /*
   * §23.1c's third exit, and the pass that needs every article to exist first — each of these links
   * one article written here to one written in `seed.ts`, so the two sets are not two islands. Slugs
   * that are absent are dropped rather than assumed: this module does not own the three in `seed.ts`
   * and should not fail if they are renamed.
   */
  const { docs: articleDocs } = await payload.find({
    collection: 'journal',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    where: {
      slug: {
        in: [...ARTICLES.map((a) => a.slug), ...ARTICLES.flatMap((a) => a.related)],
      },
    },
  })

  const articleIds = new Map<string, number>(
    articleDocs.flatMap((doc) =>
      typeof doc.slug === 'string' ? [[doc.slug, doc.id] as const] : [],
    ),
  )

  for (const article of ARTICLES) {
    await upsert({
      collection: 'journal',
      data: { relatedArticles: ids(article.related, (slug) => articleIds.get(slug)) },
      payload,
      where: { slug: { equals: article.slug } },
    })
  }

  /**
   * **One link back the other way.**
   *
   * A Payload relationship is one-directional, so the three articles above now point at the three in
   * `seed.ts` and the three in `seed.ts` point at nothing — they were written before there was
   * anything to point at, and each is still the editorial dead end §23.1c names. This gives each of
   * them one exit, which is what makes "related stories" visible on an article a visitor is actually
   * likely to land on first.
   *
   * **It only writes an article whose `relatedArticles` is empty.** That is the whole safety of
   * touching documents this module did not author: a link an editor or a later phase adds is never
   * overwritten, and a second run of the seed finds the field populated and does nothing.
   */
  const BACK_LINKS: [string, string][] = [
    ['on-selvedge', 'a-mill-four-generations'],
    ['the-case-for-fewer-things', 'the-second-winter'],
    ['a-weekend-north', 'why-the-pocket-is-there'],
  ]

  for (const [existing, addition] of BACK_LINKS) {
    const doc = articleDocs.find((candidate) => candidate.slug === existing)
    const target = articleIds.get(addition)

    if (!doc || target === undefined || (doc.relatedArticles ?? []).length > 0) {
      continue
    }

    await upsert({
      collection: 'journal',
      data: { relatedArticles: [target] },
      payload,
      where: { slug: { equals: existing } },
    })
  }

  // ------------------------------------------------------------------- FAQs
  for (const faq of FAQS) {
    await upsert({
      collection: 'faqs',
      data: {
        answer: rich(...faq.answer),
        question: faq.question,
        sortOrder: faq.sortOrder,
        status: 'published',
        topic: faq.topic,
      },
      payload,
      where: { question: { equals: faq.question } },
    })
  }

  // ------------------------------------------------------------------- Edit
  /**
   * **Cold** — the fifth Edit, and the only one with a reason to exist beside the four.
   *
   * Weekend is leisure, Travel is packing, Everyday is the rotation and Gifts is buying for someone
   * else. None of them is about **weather**, which is the one thing this catalogue is actually built
   * around, and the four-way navigation cannot say it. It is also the only Edit that uses the two
   * fields that distinguish an Edit from a list — a line of context per group (§6.1f's "product
   * groups", which the existing four leave blank) and the `lookbooks` exit at the foot of the page.
   */
  await upsert({
    collection: 'edits',
    data: {
      body: [
        {
          attribution: 'From the AW26 fabric notes',
          blockType: 'pullQuote',
          quote: 'Warmth is not weight. The heaviest thing in a wardrobe is rarely the warmest.',
        },
      ],
      intro: rich(
        'Clothes for weather that does not negotiate.',
        'Two layers, chosen so the warm one is thin and the heavy one is worth carrying.',
      ),
      lookbooks: [lookbookId],
      productGroups: [
        {
          intro: 'One heavy thing, worn over everything else.',
          products: ids(['field-jacket', 'wool-overshirt'], product),
          title: 'Over everything',
        },
        {
          intro: 'Thin, and warm out of all proportion to what it weighs.',
          products: ids(['merino-crew', 'heavyweight-hoodie', 'cotton-tee'], product),
          title: 'Under it',
        },
      ],
      publishedAt: '2026-08-06T09:00:00.000Z',
      slug: 'cold',
      status: 'published',
      title: 'Cold',
    },
    payload,
    where: { slug: { equals: 'cold' } },
  })

  return { edits: 1, faqs: FAQS.length, journal: ARTICLES.length, lookbooks: 1 }
}
