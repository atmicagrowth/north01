import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HelpNav } from '@/components/help/policy-page'
import { SiteFooter } from '@/components/layout/site-footer'
import { getLegalPublication } from '@/lib/help/read'
import { legalNav, NO_LEGAL_DOCUMENTS, type LegalPublication } from '@/lib/navigation/utility'
import { getShell } from '@/lib/navigation/shell'
import { isRoutablePath } from '@/lib/navigation/routes'

/**
 * **The footer's legal row — Phase 37, closing gap G-19 — and the Support nav's copy of it.**
 *
 * The row was empty from Phase 28, when the audit found its two links 404ing and the copy did not
 * exist to build them. It is populated again, and two things are worth asserting:
 *
 * 1. **The links are code, not content.** They render from an empty navigation global, and they
 *    go to routes that exist.
 * 2. **Each link is shown only while its document has text.** Production's `site-settings` has
 *    neither document until the owner enters it, and `/legal/privacy` and `/legal/terms` answer 404
 *    until then — so a row that ignored publication would put two dead legal links on every page.
 *    Every state is rendered: both, one, the other, and neither.
 *
 * `getShell` and `getLegalPublication` are mocked because both are `server-only`, reach Payload and
 * are wrapped in Next's data cache — none of which exists in jsdom, and none of which this component
 * decides. `SiteFooter` is an async server component, so it is awaited and its element tree
 * rendered; every assertion below is by role and accessible name.
 */

vi.mock('@/lib/navigation/shell', () => ({ getShell: vi.fn() }))
vi.mock('@/lib/help/read', () => ({ getLegalPublication: vi.fn() }))

const EMPTY_SHELL = {
  degraded: false,
  navigation: { footer: [], primary: [], social: [] },
  settings: { announcement: null, logo: null, siteName: 'NORTH / 01', tagline: null },
}

const BOTH: LegalPublication = { privacy: true, terms: true }

const publish = (legal: LegalPublication) =>
  vi.mocked(getLegalPublication).mockImplementation(async () => legal)

beforeEach(() => {
  /* The shared setup file restores mocks after each test, so the implementations are reinstalled. */
  vi.mocked(getShell).mockImplementation(async () => EMPTY_SHELL as never)
  publish(BOTH)
})

describe('SiteFooter — the legal row, when both documents are published', () => {
  it('renders Privacy and Terms pointing at the pages built in Phase 37', async () => {
    render(await SiteFooter({}))

    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/legal/privacy')
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/legal/terms')
  })

  it('renders them from an entirely empty navigation global, because the row is code and not content', async () => {
    /*
     * The shell above has no footer columns and no social links at all. That an editor cannot empty
     * the privacy notice out of the footer is the point of `legalNav` living in the repository — see
     * its docblock, and `Navigation.ts` on why the bag is not content either.
     */
    render(await SiteFooter({}))

    expect(screen.queryAllByRole('navigation')).toHaveLength(0)
    expect(screen.getByRole('link', { name: 'Privacy' })).toBeInTheDocument()
  })

  it('renders every entry in legalNav and nothing else, in one list', async () => {
    render(await SiteFooter({}))

    const rows = screen
      .getAllByRole('list')
      .map((list) => within(list).getAllByRole('link'))
      .find((links) => links.some((link) => link.textContent === 'Privacy'))

    expect(rows?.map((link) => link.textContent)).toEqual(legalNav.map((entry) => entry.label))
  })

  it('keeps them internal — a legal notice does not open in a new tab', async () => {
    render(await SiteFooter({}))

    for (const label of ['Privacy', 'Terms']) {
      expect(screen.getByRole('link', { name: label })).not.toHaveAttribute('target')
    }
  })

  it('points every legal link at a route this application actually renders', () => {
    /*
     * The regression Phase 28 found, as an assertion rather than as a browser check: these two hrefs
     * were in the footer of every page for nineteen phases and neither had a page behind it.
     * `verify:shell` resolves the same list against the route tree on disk; this resolves it against
     * the route map the CMS links are checked with, so the two cannot drift apart silently.
     */
    expect(legalNav.map((entry) => entry.href)).toEqual(['/legal/privacy', '/legal/terms'])
    expect(legalNav.every((entry) => isRoutablePath(entry.href))).toBe(true)
  })
})

describe('SiteFooter — the legal row follows publication', () => {
  it('renders no legal row at all when neither document has text — not an empty list', async () => {
    publish(NO_LEGAL_DOCUMENTS)

    render(await SiteFooter({}))

    expect(screen.queryByRole('link', { name: 'Privacy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Terms' })).not.toBeInTheDocument()
    /* A screen reader announces an empty `<ul>` as "list, 0 items". */
    expect(screen.queryAllByRole('list')).toHaveLength(0)
    /* The rest of the footer is unaffected. */
    expect(screen.getByText('© NORTH / 01')).toBeInTheDocument()
  })

  it('renders only Privacy when only the privacy notice is published', async () => {
    publish({ privacy: true, terms: false })

    render(await SiteFooter({}))

    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/legal/privacy')
    expect(screen.queryByRole('link', { name: 'Terms' })).not.toBeInTheDocument()
  })

  it('renders only Terms when only the terms of sale are published', async () => {
    publish({ privacy: false, terms: true })

    render(await SiteFooter({}))

    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/legal/terms')
    expect(screen.queryByRole('link', { name: 'Privacy' })).not.toBeInTheDocument()
  })
})

describe('HelpNav — the Support nav carries the same conditional legal entries', () => {
  const nav = () => screen.getByRole('navigation', { name: 'Support' })

  it('links the three help pages always, and both legal pages when both are published', () => {
    render(<HelpNav legal={BOTH} />)

    expect(
      within(nav())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['FAQ', 'Shipping', 'Returns', 'Privacy', 'Terms', 'Continue shopping'])
  })

  it('omits a legal page whose document is not published', () => {
    render(<HelpNav legal={{ privacy: false, terms: true }} />)

    expect(within(nav()).queryByRole('link', { name: 'Privacy' })).not.toBeInTheDocument()
    expect(within(nav()).getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      '/legal/terms',
    )
  })

  it('keeps the help pages when neither legal document is published', () => {
    render(<HelpNav current="Returns" legal={NO_LEGAL_DOCUMENTS} />)

    expect(
      within(nav())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['FAQ', 'Shipping', 'Returns', 'Continue shopping'])
    expect(within(nav()).getByRole('link', { name: 'Returns' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
