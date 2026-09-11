import { describe, expect, it } from 'vitest'

import { isUndecodablePath } from '@/proxy'

/**
 * **Plan §31.1a — a URL that cannot be decoded is a 404, not a server error.** `/product/%E0%A4%A`
 * answered with a bare 21-byte *Internal Server Error* before Phase 31, because Next throws decoding
 * it into the dynamic segment's params. The proxy now rewrites it to the not-found page; this is the
 * test that decides which paths it touches.
 */
describe('isUndecodablePath', () => {
  it('catches an incomplete UTF-8 sequence, which is what made the product route throw', () => {
    expect(isUndecodablePath('/product/%E0%A4%A')).toBe(true)
    expect(isUndecodablePath('/shop/%E0%A4%A')).toBe(true)
    expect(isUndecodablePath('/product/%')).toBe(true)
  })

  it('leaves every well-formed path alone, encoded or not', () => {
    expect(isUndecodablePath('/product/field-jacket')).toBe(false)
    expect(isUndecodablePath('/product/caf%C3%A9')).toBe(false)
    expect(isUndecodablePath('/search')).toBe(false)
    expect(isUndecodablePath('/account/orders/N1-2609-DEMO01')).toBe(false)
  })
})
