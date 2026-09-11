import { describe, expect, it } from 'vitest'

import { trustedOrigins } from '@/lib/trusted-origins'

/**
 * **Phase 33, audit R1-14 — which origins a signed-in request may come from.** With only `SITE_URL`
 * on the list, every Server Action on production's public host ran as a guest, because production's
 * `SITE_URL` names the team alias. These pin the list to "every host this deployment is, and nothing
 * else".
 */
const PRODUCTION = {
  onVercel: true,
  port: undefined,
  siteUrl: 'https://north01apparel-mi-ca-growth.vercel.app',
  vercelBranchUrl: undefined,
  vercelProductionUrl: 'north01apparel.vercel.app',
  vercelUrl: 'north01apparel-abc123-mi-ca-growth.vercel.app',
}

describe('trustedOrigins', () => {
  it('trusts the public production host even when SITE_URL names another', () => {
    expect(trustedOrigins(PRODUCTION)).toContain('https://north01apparel.vercel.app')
    expect(trustedOrigins(PRODUCTION)).toContain('https://north01apparel-mi-ca-growth.vercel.app')
  })

  it("trusts this deployment's own host, so an action on a deployment URL keeps its session", () => {
    expect(trustedOrigins(PRODUCTION)).toContain(
      'https://north01apparel-abc123-mi-ca-growth.vercel.app',
    )
  })

  it("trusts a preview's branch alias", () => {
    const preview = {
      ...PRODUCTION,
      vercelBranchUrl: 'north01apparel-git-feature-mi-ca-growth.vercel.app',
    }

    expect(trustedOrigins(preview)).toContain(
      'https://north01apparel-git-feature-mi-ca-growth.vercel.app',
    )
  })

  it('never trusts localhost on Vercel', () => {
    expect(trustedOrigins(PRODUCTION).some((origin) => origin.includes('localhost'))).toBe(false)
  })

  it('trusts the machine on the port it serves when it is not on Vercel', () => {
    const local = { ...PRODUCTION, onVercel: false, port: '3211', siteUrl: 'http://localhost:3000' }

    expect(trustedOrigins(local)).toEqual(
      expect.arrayContaining([
        'http://localhost:3000',
        'http://localhost:3211',
        'http://127.0.0.1:3211',
      ]),
    )
  })

  it('normalises: no scheme doubling, no trailing slash, no duplicates', () => {
    const messy = {
      ...PRODUCTION,
      siteUrl: 'https://north01apparel.vercel.app/',
      vercelUrl: 'https://north01apparel.vercel.app/',
    }
    const list = trustedOrigins(messy)

    expect(list.filter((origin) => origin === 'https://north01apparel.vercel.app')).toHaveLength(1)
    expect(
      list.every((origin) => !origin.endsWith('/') && !origin.includes('https://https://')),
    ).toBe(true)
  })

  it('ignores a port that is not a number', () => {
    const local = {
      ...PRODUCTION,
      onVercel: false,
      port: '3000; evil.example',
      siteUrl: 'http://localhost:3000',
    }

    expect(trustedOrigins(local).some((origin) => origin.includes('evil'))).toBe(false)
  })
})
