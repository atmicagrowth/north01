import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * **`/legal/privacy` and `/legal/terms` answer 404 when their document is not published.**
 *
 * `tests/unit/help-policies.test.ts` pins what *published* means — `getSupportPolicies` hands back
 * `null` for a field with no text. This file pins what the two routes do with that `null`, which is
 * the half nothing else measures: each page must call `notFound()` rather than render a title over
 * nothing, and must decide from **its own** field, so a privacy page that checked the terms (or
 * neither) fails here rather than in front of a customer. The E2E suite cannot reach this branch
 * against a seeded database, because the seed publishes both documents.
 *
 * ### What is mocked, and why
 *
 * - **`@/lib/help/read`** — the reader is the page's only input. Its own rules are tested elsewhere.
 * - **`next/navigation`** — the real `notFound()` throws Next's `NEXT_HTTP_ERROR_FALLBACK;404`
 *   error, which only a Next server turns into a 404. The mock throws a sentinel for the same reason
 *   the real one throws: execution must stop there, so a page that called it and carried on to render
 *   would still be caught by the assertions below.
 * - **`@/components/help/policy-page`** and **`@/lib/seo/site`** — a rendered page is asserted by the
 *   props it hands `PolicyPage`, not by markup, and `pageMetadata` reads the settings global. Neither
 *   is what is under test.
 */

const NOT_FOUND = new Error('notFound() was called')

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND
  }),
}))

vi.mock('@/lib/help/read', () => ({
  getLegalPublication: vi.fn(),
  getSupportPolicies: vi.fn(),
}))

vi.mock('@/components/help/policy-page', () => ({ PolicyPage: vi.fn(() => null) }))

vi.mock('@/lib/seo/site', () => ({
  pageMetadata: vi.fn(async (input: { title: string }) => ({ title: input.title })),
}))

import { notFound } from 'next/navigation'

import PrivacyPage, {
  generateMetadata as privacyMetadata,
} from '@/app/(frontend)/legal/privacy/page'
import TermsPage, { generateMetadata as termsMetadata } from '@/app/(frontend)/legal/terms/page'
import { PolicyPage } from '@/components/help/policy-page'
import { getLegalPublication, getSupportPolicies } from '@/lib/help/read'

const notFoundCalled = vi.mocked(notFound)
const policies = vi.mocked(getSupportPolicies)
const publication = vi.mocked(getLegalPublication)

/** Stand-ins for stored documents. The pages only pass them through, so identity is what matters. */
const PRIVACY_TEXT = { root: { marker: 'privacy' } }
const TERMS_TEXT = { root: { marker: 'terms' } }

function reads(published: { privacy: unknown; terms: unknown }) {
  policies.mockResolvedValue({ returns: null, shipping: null, ...published })
  publication.mockResolvedValue({
    privacy: published.privacy !== null,
    terms: published.terms !== null,
  })
}

type Element = { props: { body: unknown; title: string }; type: unknown }

const ROUTES = [
  {
    field: 'privacy',
    metadata: privacyMetadata,
    other: 'terms',
    page: PrivacyPage,
    path: '/legal/privacy',
    text: PRIVACY_TEXT,
    title: 'Privacy',
  },
  {
    field: 'terms',
    metadata: termsMetadata,
    other: 'privacy',
    page: TermsPage,
    path: '/legal/terms',
    text: TERMS_TEXT,
    title: 'Terms',
  },
] as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe.each(ROUTES)('$path', ({ field, metadata, other, page, text, title }) => {
  it('calls notFound() when its document is not published, and renders nothing', async () => {
    reads({ privacy: null, terms: null })

    await expect(page()).rejects.toBe(NOT_FOUND)

    expect(notFoundCalled).toHaveBeenCalledTimes(1)
  })

  it(`decides from its own field — the ${other} document being published does not keep it up`, async () => {
    reads({
      privacy: field === 'privacy' ? null : PRIVACY_TEXT,
      terms: field === 'terms' ? null : TERMS_TEXT,
    })

    await expect(page()).rejects.toBe(NOT_FOUND)

    expect(notFoundCalled).toHaveBeenCalledTimes(1)
  })

  it('renders its own document, and does not call notFound(), when it is published', async () => {
    reads({
      privacy: field === 'privacy' ? PRIVACY_TEXT : null,
      terms: field === 'terms' ? TERMS_TEXT : null,
    })

    const element = (await page()) as unknown as Element

    expect(notFoundCalled).not.toHaveBeenCalled()
    expect(element.type).toBe(PolicyPage)
    expect(element.props.body).toBe(text)
    expect(element.props.title).toBe(title)
  })

  it('answers a noindex "Not found" in its metadata while unpublished', async () => {
    reads({ privacy: null, terms: null })

    await expect(metadata()).resolves.toEqual({
      robots: { follow: false, index: false },
      title: 'Not found',
    })
  })

  it(`keeps its metadata "Not found" when only the ${other} document is published`, async () => {
    reads({
      privacy: field === 'privacy' ? null : PRIVACY_TEXT,
      terms: field === 'terms' ? null : TERMS_TEXT,
    })

    await expect(metadata()).resolves.toEqual({
      robots: { follow: false, index: false },
      title: 'Not found',
    })
  })

  it('gives indexable page metadata with its own title once its document is published', async () => {
    reads({
      privacy: field === 'privacy' ? PRIVACY_TEXT : null,
      terms: field === 'terms' ? TERMS_TEXT : null,
    })

    await expect(metadata()).resolves.toEqual({ title })
  })
})
