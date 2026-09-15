import { describe, expect, it } from 'vitest'

import { ADDRESS_MAX_LENGTH, addressFits } from '@/lib/address-limits'
import {
  RESET_COOLDOWN_MS,
  RESET_TOKEN_LIFETIME_MS,
  reissuableBefore,
  resetIssuedRecently,
} from '@/lib/auth/reset-cooldown'
import { maskEmail } from '@/lib/observability/redact'

/**
 * Plan §34 — two rules small enough to be pure and important enough to pin.
 */
describe('resetIssuedRecently — one reset email per address per cooldown', () => {
  const now = Date.parse('2026-09-11T12:00:00.000Z')
  const issuedAgo = (ms: number) => new Date(now - ms + RESET_TOKEN_LIFETIME_MS).toISOString()

  it('refuses a second link within the cooldown', () => {
    expect(resetIssuedRecently(issuedAgo(10_000), now)).toBe(true)
    expect(resetIssuedRecently(issuedAgo(RESET_COOLDOWN_MS - 1), now)).toBe(true)
  })

  it('allows one once the cooldown has passed', () => {
    expect(resetIssuedRecently(issuedAgo(RESET_COOLDOWN_MS), now)).toBe(false)
    expect(resetIssuedRecently(issuedAgo(30 * 60 * 1000), now)).toBe(false)
  })

  it('allows one when there is no live token at all', () => {
    expect(resetIssuedRecently(null, now)).toBe(false)
    expect(resetIssuedRecently(undefined, now)).toBe(false)
    expect(resetIssuedRecently('', now)).toBe(false)
    expect(resetIssuedRecently('not a date', now)).toBe(false)
  })

  it('allows one when the previous token has already expired', () => {
    expect(resetIssuedRecently(new Date(now - 1000).toISOString(), now)).toBe(false)
  })
})

/**
 * Sweep 1, finding S05 — the cooldown is claimed by one SQL `UPDATE` comparing the stored expiry with
 * `reissuableBefore(now)`. That comparison must be the rule above and not a neighbour of it, or the
 * database would enforce a different cooldown from the one this file pins.
 */
describe('reissuableBefore — the cooldown as the bound the claim statement compares against', () => {
  const now = Date.parse('2026-09-14T12:00:00.000Z')

  it('is the lifetime minus the cooldown, from now', () => {
    expect(reissuableBefore(now).getTime()).toBe(now + RESET_TOKEN_LIFETIME_MS - RESET_COOLDOWN_MS)
  })

  it('claims exactly when resetIssuedRecently says no — at every offset either side of the edge', () => {
    const issuedAgo = [
      -120_000,
      0,
      1,
      60_000,
      RESET_COOLDOWN_MS - 1,
      RESET_COOLDOWN_MS,
      RESET_COOLDOWN_MS + 1,
      RESET_TOKEN_LIFETIME_MS + 1,
    ]

    for (const offset of issuedAgo) {
      const expiration = new Date(now - offset + RESET_TOKEN_LIFETIME_MS)
      const claimable = expiration.getTime() <= reissuableBefore(now).getTime()

      expect(claimable).toBe(!resetIssuedRecently(expiration.toISOString(), now))
    }
  })

  it('puts a freshly issued link past the bound, so a simultaneous second claim cannot match', () => {
    const issuedByWinner = now + RESET_TOKEN_LIFETIME_MS
    const loserNow = now + 50

    expect(issuedByWinner > reissuableBefore(loserNow).getTime()).toBe(true)
  })
})

describe('addressFits — every line within its bound', () => {
  it('accepts a real address, with or without its optional lines', () => {
    expect(addressFits({ city: 'Portland', line1: '1 Main St', postalCode: '97201' })).toBe(true)
    expect(addressFits({ line2: null, phone: undefined, region: null })).toBe(true)
  })

  it('accepts a line exactly at its bound and refuses one past it', () => {
    expect(addressFits({ line1: 'x'.repeat(ADDRESS_MAX_LENGTH.line1) })).toBe(true)
    expect(addressFits({ line1: 'x'.repeat(ADDRESS_MAX_LENGTH.line1 + 1) })).toBe(false)
    expect(addressFits({ postalCode: '9'.repeat(21) })).toBe(false)
  })
})

describe('maskEmail — enough to say which customer, not who', () => {
  it('keeps the first character and the domain', () => {
    expect(maskEmail('jane.doe@example.com')).toBe('j***@example.com')
  })

  it('never returns the local part', () => {
    expect(maskEmail('ines.marchetti@example.test')).not.toContain('marchetti')
  })

  it('redacts what is not an address', () => {
    expect(maskEmail('no-at-sign')).toBe('[redacted]')
    expect(maskEmail('@example.com')).toBe('[redacted]')
  })
})
