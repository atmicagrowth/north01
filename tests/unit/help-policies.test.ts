import { beforeEach, describe, expect, it, vi } from 'vitest'

import sitemap from '@/app/sitemap'
import { getFaqGroups, getLegalPublication, getSupportPolicies } from '@/lib/help/read'
import { hasPublishedText, NO_LEGAL_DOCUMENTS, publishedLegalNav } from '@/lib/navigation/utility'
import { getPayloadClient } from '@/lib/payload'
import { legalSitemapRoutes } from '@/lib/seo/routes'

/**
 * **The four policy documents out of one settings global, and what counts as published.**
 *
 * Phase 37 added `privacyPolicy` and `termsOfSale` beside the two support policies, so the reader
 * that `/help/shipping` and `/help/returns` have used since Phase 28 now also feeds `/legal/privacy`
 * and `/legal/terms`. What is pinned here is invisible from reading the routes:
 *
 * 1. **Each document comes from its own field.** The four fixtures below carry different text, and
 *    every key is asserted by identity. The first version of this file gave all four the same empty
 *    root and compared with `toEqual`, so a reader that served the terms of sale at `/legal/privacy`
 *    passed it — the exact mutation its first test was named after.
 * 2. **Published means *has text*.** An editor who deletes every word of a Lexical field saves a root
 *    holding one empty paragraph, not `null`. That document is truthy and blank, and it must read as
 *    unpublished — `null` from `getSupportPolicies`, `false` from `getLegalPublication` — or a cleared
 *    privacy notice renders as a title over nothing with the footer still linking to it.
 * 3. **Unreadable is not unpublished.** The link reader fails closed — neither document — because a
 *    legal link that 500s the footer when the CMS blinked is worse than a footer without it. The page
 *    readers do the opposite and **throw** (sweep 1, S18): turned into nulls or an empty list, a
 *    database blip made `/help/returns` say with HTTP 200 that the shop had no returns policy, and
 *    `/help/faq` that it had no answers.
 * 4. **The sitemap submits a legal page only when its document is published** — and the rest of the
 *    sitemap does not depend on it.
 *
 * The Payload client is mocked at the module boundary the reader imports, and `unstable_cache` is
 * replaced by a pass-through because Next's data cache does not exist outside a Next server. Nothing
 * deeper is faked: the shapes below are the shapes `findGlobal` returns.
 */

vi.mock('@/lib/payload', () => ({ getPayloadClient: vi.fn() }))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}))

vi.mock('@/lib/env.server', () => ({ siteUrl: 'https://north01.example' }))

const find = vi.fn()
const findGlobal = vi.fn()

/** A stored Lexical document with one paragraph of text — the shape `rich()` seeds. */
const document = (text: string) => ({
  root: {
    children: [
      {
        children: [
          { detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1 },
        ],
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
      },
    ],
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
})

/**
 * **What the admin saves when an editor selects all of a field's text and deletes it.** Not `null`:
 * the editor state, which is a root with one empty paragraph.
 */
const EMPTIED = {
  root: {
    children: [
      {
        children: [],
        direction: null,
        format: '',
        indent: 0,
        textFormat: 0,
        type: 'paragraph',
        version: 1,
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
}

/** Four documents that cannot be mistaken for one another. */
const SETTINGS = {
  privacyPolicy: document('The privacy notice.'),
  returnsPolicy: document('The returns policy.'),
  shippingPolicy: document('The shipping policy.'),
  termsOfSale: document('The terms of sale.'),
}

const FIELD_FOR = {
  privacy: 'privacyPolicy',
  returns: 'returnsPolicy',
  shipping: 'shippingPolicy',
  terms: 'termsOfSale',
} as const

const KEYS = Object.keys(FIELD_FOR) as (keyof typeof FIELD_FOR)[]

beforeEach(() => {
  find.mockReset()
  findGlobal.mockReset()
  /*
   * Reinstalled per test rather than in the `vi.mock` factory: a mock left without an implementation
   * returns `undefined`, and `await undefined.findGlobal` is a different failure from the one under
   * test.
   */
  vi.mocked(getPayloadClient).mockImplementation(
    async () => ({ find, findGlobal, logger: { error: vi.fn() } }) as never,
  )
})

describe('hasPublishedText — the one definition of a published policy document', () => {
  it('is true for a document with text', () => {
    expect(hasPublishedText(SETTINGS.privacyPolicy)).toBe(true)
  })

  it('is false for nothing at all', () => {
    expect(hasPublishedText(null)).toBe(false)
    expect(hasPublishedText(undefined)).toBe(false)
  })

  it('is false for a field emptied in the admin, although the stored value is truthy', () => {
    expect(EMPTIED).toBeTruthy()
    expect(hasPublishedText(EMPTIED)).toBe(false)
  })

  it('is false for a document whose only text is whitespace', () => {
    expect(hasPublishedText(document('   '))).toBe(false)
  })

  it('finds text however far into the document it starts', () => {
    const long = {
      root: {
        children: [
          ...Array.from({ length: 50 }, () => EMPTIED.root.children[0]),
          ...document(`${' '.repeat(1000)}Finally.`).root.children,
        ],
        type: 'root',
      },
    }

    expect(hasPublishedText(long)).toBe(true)
  })
})

describe('getSupportPolicies', () => {
  it('returns all four documents, each from its own field', async () => {
    findGlobal.mockResolvedValue(SETTINGS)

    const policies = await getSupportPolicies()

    /* Identity, key by key: `toEqual` could not tell four documents apart if they looked alike. */
    expect(policies.privacy).toBe(SETTINGS.privacyPolicy)
    expect(policies.returns).toBe(SETTINGS.returnsPolicy)
    expect(policies.shipping).toBe(SETTINGS.shippingPolicy)
    expect(policies.terms).toBe(SETTINGS.termsOfSale)
  })

  it.each(KEYS)(
    'reads `%s` from its own field and from no other — the other three are null',
    async (key) => {
      const field = FIELD_FOR[key]

      findGlobal.mockResolvedValue({ [field]: SETTINGS[field] })

      const policies = await getSupportPolicies()

      expect(policies[key]).toBe(SETTINGS[field])

      for (const other of KEYS.filter((candidate) => candidate !== key)) {
        expect(policies[other]).toBeNull()
      }
    },
  )

  it('reads the settings global once, at depth 0, because none of the four has a relationship to populate', async () => {
    findGlobal.mockResolvedValue(SETTINGS)

    await getSupportPolicies()

    expect(findGlobal).toHaveBeenCalledTimes(1)
    expect(findGlobal).toHaveBeenCalledWith({ depth: 0, slug: 'site-settings' })
  })

  it.each(KEYS)(
    'treats an emptied `%s` exactly like a missing one — null, not a blank document',
    async (key) => {
      findGlobal.mockResolvedValue({ ...SETTINGS, [FIELD_FOR[key]]: EMPTIED })

      const policies = await getSupportPolicies()

      expect(policies[key]).toBeNull()

      /* The others are untouched — degradation is per document, not per read. */
      for (const other of KEYS.filter((candidate) => candidate !== key)) {
        expect(policies[other]).toBe(SETTINGS[FIELD_FOR[other]])
      }
    },
  )

  it('throws when the global cannot be read at all, rather than reporting every document unpublished', async () => {
    const outage = new Error('the database is unreachable')

    findGlobal.mockRejectedValue(outage)

    /* Sweep 1, S18: four nulls here rendered "This policy has not been published yet." with a 200. */
    await expect(getSupportPolicies()).rejects.toBe(outage)
  })

  it('treats a global that came back empty the same way', async () => {
    findGlobal.mockResolvedValue(null)

    const policies = await getSupportPolicies()

    expect(Object.values(policies).every((value) => value === null)).toBe(true)
  })
})

describe('getFaqGroups', () => {
  const faq = (id: number, topic: string, question: string) => ({
    answer: document(`Answer ${id}.`),
    id,
    question,
    topic,
  })

  it('groups published answers by topic, in the order a customer meets the topics', async () => {
    find.mockResolvedValue({
      docs: [faq(1, 'care', 'How should I wash wool?'), faq(2, 'orders', 'When will it ship?')],
    })

    const groups = await getFaqGroups()

    expect(groups.map((group) => group.topic)).toEqual(['orders', 'care'])
  })

  it('throws when the FAQs cannot be read, rather than claiming none are published', async () => {
    const outage = new Error('the database is unreachable')

    find.mockRejectedValue(outage)

    /* Sweep 1, S18: `docs: []` here rendered "There are no published answers here yet." with a 200. */
    await expect(getFaqGroups()).rejects.toBe(outage)
  })
})

describe('getLegalPublication — which legal links may be shown', () => {
  it('says both are published when both fields have text', async () => {
    findGlobal.mockResolvedValue(SETTINGS)

    await expect(getLegalPublication()).resolves.toEqual({ privacy: true, terms: true })
    expect(findGlobal).toHaveBeenCalledWith({ depth: 0, slug: 'site-settings' })
  })

  it('reads privacy from privacyPolicy and terms from termsOfSale, and never from each other', async () => {
    findGlobal.mockResolvedValue({ privacyPolicy: SETTINGS.privacyPolicy })
    await expect(getLegalPublication()).resolves.toEqual({ privacy: true, terms: false })

    findGlobal.mockResolvedValue({ termsOfSale: SETTINGS.termsOfSale })
    await expect(getLegalPublication()).resolves.toEqual({ privacy: false, terms: true })

    /* The support policies are not legal documents, however much text they hold. */
    findGlobal.mockResolvedValue({
      returnsPolicy: SETTINGS.returnsPolicy,
      shippingPolicy: SETTINGS.shippingPolicy,
    })
    await expect(getLegalPublication()).resolves.toEqual(NO_LEGAL_DOCUMENTS)
  })

  it('says an emptied field is not published', async () => {
    findGlobal.mockResolvedValue({ ...SETTINGS, privacyPolicy: EMPTIED, termsOfSale: EMPTIED })

    await expect(getLegalPublication()).resolves.toEqual(NO_LEGAL_DOCUMENTS)
  })

  it('fails closed, and logs, when the global cannot be read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    findGlobal.mockRejectedValue(new Error('the database is unreachable'))

    await expect(getLegalPublication()).resolves.toEqual(NO_LEGAL_DOCUMENTS)
    expect(log).toHaveBeenCalledTimes(1)

    log.mockRestore()
  })
})

describe('the legal row, derived — publishedLegalNav', () => {
  it('shows exactly the published documents, in order', () => {
    const hrefs = (privacy: boolean, terms: boolean) =>
      publishedLegalNav({ privacy, terms }).map((entry) => entry.href)

    expect(hrefs(true, true)).toEqual(['/legal/privacy', '/legal/terms'])
    expect(hrefs(true, false)).toEqual(['/legal/privacy'])
    expect(hrefs(false, true)).toEqual(['/legal/terms'])
    expect(hrefs(false, false)).toEqual([])
  })
})

describe('/sitemap.xml — the legal pages are submitted only when published', () => {
  const EMPTY_PAGE = { docs: [], totalDocs: 0 }

  const urls = async () => (await sitemap()).map((entry) => entry.url)

  beforeEach(() => {
    find.mockResolvedValue(EMPTY_PAGE)
  })

  it('submits both when both documents have text', async () => {
    findGlobal.mockResolvedValue(SETTINGS)

    const submitted = await urls()

    expect(submitted).toContain('https://north01.example/legal/privacy')
    expect(submitted).toContain('https://north01.example/legal/terms')
  })

  it('submits neither while the fields are empty — production before the owner enters the text', async () => {
    findGlobal.mockResolvedValue({ privacyPolicy: null, termsOfSale: EMPTIED })

    const submitted = await urls()

    expect(submitted.some((url) => url.includes('/legal/'))).toBe(false)
    /* The rest of the sitemap does not depend on it. */
    expect(submitted).toContain('https://north01.example/help/returns')
  })

  it('submits only the one that is published', async () => {
    findGlobal.mockResolvedValue({ termsOfSale: SETTINGS.termsOfSale })

    const submitted = (await urls()).filter((url) => url.includes('/legal/'))

    expect(submitted).toEqual(['https://north01.example/legal/terms'])
  })

  it('uses the same entries legalSitemapRoutes derives from the legal row', () => {
    expect(legalSitemapRoutes({ privacy: true, terms: false })).toEqual([
      { changeFrequency: 'monthly', path: '/legal/privacy', priority: 0.4 },
    ])
    expect(legalSitemapRoutes(NO_LEGAL_DOCUMENTS)).toEqual([])
  })
})
