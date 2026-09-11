import { readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveLink } from '@/lib/navigation/resolve'
import { PAGE_ROUTE_PATTERNS, isRoutablePath } from '@/lib/navigation/routes'

/** The storefront's pages, from the filesystem — route groups dropped, `[x]` as `*`, the admin skipped. */
function pagesOnDisk(): string[] {
  const out: string[] = []

  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('[[...') || entry.name === '(payload)') continue

        const group = entry.name.startsWith('(') && entry.name.endsWith(')')
        const segment = entry.name.startsWith('[') ? '*' : entry.name

        walk(path.join(dir, entry.name), group ? segments : [...segments, segment])
      } else if (entry.name === 'page.tsx' || entry.name === 'page.ts') {
        out.push(`/${segments.join('/')}`)
      }
    }
  }

  walk(path.join(process.cwd(), 'src', 'app'), [])

  return out.sort()
}

describe('PAGE_ROUTE_PATTERNS — the pages the navigation may link to (P35-01)', () => {
  it('is exactly the pages on disk', () => {
    expect([...PAGE_ROUTE_PATTERNS].sort()).toEqual(pagesOnDisk())
  })

  it('tells a real page from a missing one', () => {
    expect(isRoutablePath('/')).toBe(true)
    expect(isRoutablePath('/shop?sort=newest')).toBe(true)
    expect(isRoutablePath('/product/any-slug')).toBe(true)
    expect(isRoutablePath('/help/faq#returns')).toBe(true)
    expect(isRoutablePath('/about')).toBe(false)
    expect(isRoutablePath('/help')).toBe(false)
    expect(isRoutablePath('/product')).toBe(false)
  })

  it('drops a CMS link to a page that does not exist, and keeps external ones', () => {
    expect(resolveLink({ href: '/about', kind: 'url', label: 'About' } as never)).toBeNull()
    expect(resolveLink({ href: '/journal', kind: 'url', label: 'Journal' } as never)?.href).toBe(
      '/journal',
    )
    expect(
      resolveLink({ href: 'https://example.com/x', kind: 'url', label: 'Out' } as never)?.external,
    ).toBe(true)
  })
})
