import { describe, expect, it } from 'vitest'

import { ADDRESS_MAX_LENGTH, addressFits } from '@/lib/address-limits'
import {
  RESET_COOLDOWN_MS,
  RESET_TOKEN_LIFETIME_MS,
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
