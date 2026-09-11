import { describe, expect, it } from 'vitest'

import { priceMovedFrom } from '@/lib/cart/rules'

/**
 * **Plan §31.1e — "price changed".** The bag stores the price the customer saw when they added a
 * line, never to charge it, only to say so when today's price is different. The rule is small and the
 * failure it guards is a false statement either way: telling a customer a price moved when it did not,
 * or letting it move without a word.
 */
describe('priceMovedFrom', () => {
  it('returns the old price when the live price differs, in either direction', () => {
    expect(priceMovedFrom(18000, 22000)).toBe(18000)
    expect(priceMovedFrom(22000, 18000)).toBe(22000)
  })

  it('says nothing when the price has not moved', () => {
    expect(priceMovedFrom(18000, 18000)).toBeNull()
  })

  it('treats an unknown on either side as no change, because null means unknown and not zero', () => {
    expect(priceMovedFrom(null, 18000)).toBeNull()
    expect(priceMovedFrom(undefined, 18000)).toBeNull()
    expect(priceMovedFrom(18000, null)).toBeNull()
  })

  it('ignores a stored value that is not a price', () => {
    expect(priceMovedFrom(-1, 18000)).toBeNull()
    expect(priceMovedFrom(12.5, 18000)).toBeNull()
    expect(priceMovedFrom('18000', 18000)).toBeNull()
  })

  it('treats a free line becoming paid as a change, because zero is a real price', () => {
    expect(priceMovedFrom(0, 1500)).toBe(0)
  })
})
