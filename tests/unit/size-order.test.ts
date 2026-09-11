import { describe, expect, it } from 'vitest'

import { compareSizeEntries } from '@/lib/catalog/size-order'

/**
 * **Phase 35 (P35-11) — the filter panel's size order.**
 *
 * `sizeSortOrder` is numbered per product, so across the catalogue it interleaved scales. These pin
 * the (scale, position) order that replaced it: letters in garment order, numbers by value, unknown
 * sizes by their old rank, ONE SIZE last.
 */

const order = (entries: [string, number][]) =>
  [...entries].sort(compareSizeEntries).map(([size]) => size)

describe('compareSizeEntries', () => {
  it('puts the letter scale in garment order, split sizes between the two they span', () => {
    expect(
      order([
        ['XL', 0],
        ['L/XL', 0],
        ['S', 0],
        ['XXS', 0],
        ['M', 0],
        ['S/M', 0],
        ['XXL', 0],
        ['L', 0],
        ['M/L', 0],
        ['XS', 0],
      ]),
    ).toEqual(['XXS', 'XS', 'S', 'S/M', 'M', 'M/L', 'L', 'L/XL', 'XL', 'XXL'])
  })

  it('ignores the per-product rank for known sizes — the defect that interleaved the scales', () => {
    /* A trouser's 30 and a cap's ONE SIZE both carried low ranks and sorted ahead of XS. */
    expect(
      order([
        ['ONE SIZE', 0],
        ['30', 10],
        ['XS', 10],
        ['32', 20],
        ['S', 20],
      ]),
    ).toEqual(['XS', 'S', '30', '32', 'ONE SIZE'])
  })

  it('sorts numeric sizes by value, not as text', () => {
    expect(
      order([
        ['36', 0],
        ['8', 0],
        ['30', 0],
        ['8.5', 0],
      ]),
    ).toEqual(['8', '8.5', '30', '36'])
  })

  it('matches letter sizes case-insensitively and around stray whitespace', () => {
    expect(
      order([
        [' l ', 0],
        ['xs', 0],
      ]),
    ).toEqual(['xs', ' l '])
  })

  it('places unknown sizes after the numbers, by their rank and then alphabetically, before ONE SIZE', () => {
    expect(
      order([
        ['ONE SIZE', 0],
        ['Tall', 5],
        ['Petite', 5],
        ['Kids', 1],
        ['34', 99],
        ['M', 99],
      ]),
    ).toEqual(['M', '34', 'Kids', 'Petite', 'Tall', 'ONE SIZE'])
  })
})
