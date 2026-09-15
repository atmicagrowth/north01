import { describe, expect, it } from 'vitest'

import {
  bypassesAccessControl,
  CUSTOMER_REVISION_KEY_PREFIX,
  signInOvertaken,
} from '@/lib/auth/customer-revision'

/**
 * Sweep 1, finding S02, and its recheck — the two decisions `Customers.ts` makes around its row
 * locks. `pnpm verify:access` proves the locks and the markers against Postgres; this pins the rules.
 */
describe('bypassesAccessControl — who may lock what they name', () => {
  it('trusts only the Local API with overrideAccess: true', () => {
    expect(bypassesAccessControl({ overrideAccess: true, payloadAPI: 'local' })).toBe(true)
  })

  it('does not trust a REST request, which never carries overrideAccess', () => {
    expect(bypassesAccessControl({ payloadAPI: 'REST' })).toBe(false)
    expect(bypassesAccessControl({ overrideAccess: undefined, payloadAPI: 'REST' })).toBe(false)
  })

  it('does not trust a REST or GraphQL request even if the flag is somehow set', () => {
    expect(bypassesAccessControl({ overrideAccess: true, payloadAPI: 'REST' })).toBe(false)
    expect(bypassesAccessControl({ overrideAccess: true, payloadAPI: 'GraphQL' })).toBe(false)
  })

  it('does not trust a Local API call that asks for access control', () => {
    expect(bypassesAccessControl({ overrideAccess: false, payloadAPI: 'local' })).toBe(false)
    expect(bypassesAccessControl({ payloadAPI: 'local' })).toBe(false)
  })
})

describe('signInOvertaken — did a locking write commit after the sign-in looked?', () => {
  it('lets a sign-in through when the marker has not moved', () => {
    expect(signInOvertaken({ id: 7, revision: '"901"' }, 7, '"901"')).toBe(false)
    expect(signInOvertaken({ id: 7, revision: null }, '7', null)).toBe(false)
  })

  it('refuses when a marker appeared or changed', () => {
    expect(signInOvertaken({ id: 7, revision: null }, 7, '"902"')).toBe(true)
    expect(signInOvertaken({ id: 7, revision: '"901"' }, 7, '"902"')).toBe(true)
  })

  it('refuses when the marker disappeared', () => {
    expect(signInOvertaken({ id: 7, revision: '"901"' }, 7, null)).toBe(true)
  })

  it('fails closed without a snapshot, or with a snapshot of another account', () => {
    expect(signInOvertaken(null, 7, null)).toBe(true)
    expect(signInOvertaken(undefined, 7, null)).toBe(true)
    expect(signInOvertaken({ id: 8, revision: null }, 7, null)).toBe(true)
  })

  it('keys a marker by the customer id', () => {
    expect(`${CUSTOMER_REVISION_KEY_PREFIX}42`).toBe('customer-revision:42')
  })
})
