import { describe, expect, it } from 'vitest'

import { taxWithoutProvider, type TaxRequest } from '@/lib/tax/rules'
import { recordTaxTransaction, type TaxTransactionClient } from '@/lib/tax/transactions'

/**
 * **Phase 36 sweep 1 — the Stripe Tax transaction, and the bag with nothing to tax.**
 *
 * The client is a stub: what is asserted is the call Stripe receives, not Stripe.
 */

function stubClient(behaviour: 'fail' | 'ok' = 'ok') {
  const calls: { options: unknown; params: unknown }[] = []

  const client: TaxTransactionClient = {
    tax: {
      transactions: {
        createFromCalculation: (params, options) => {
          calls.push({ options, params })

          return behaviour === 'ok'
            ? Promise.resolve({ id: 'tax_1Abc' })
            : Promise.reject(new Error('Transaction already exists for reference'))
        },
      },
    },
  }

  return { calls, client }
}

describe('recording a paid order’s tax transaction', () => {
  it('creates it from the stored calculation, referenced by the order number', async () => {
    const { calls, client } = stubClient()

    const outcome = await recordTaxTransaction(client, {
      orderNumber: 'N1-2609-ABCDEF',
      taxCalculationId: 'taxcalc_1Xyz',
    })

    expect(outcome).toEqual({ id: 'tax_1Abc', outcome: 'recorded' })
    expect(calls).toEqual([
      {
        options: { idempotencyKey: 'tax-transaction-N1-2609-ABCDEF' },
        params: { calculation: 'taxcalc_1Xyz', reference: 'N1-2609-ABCDEF' },
      },
    ])
  })

  it('skips an order no provider calculated, without calling Stripe', async () => {
    for (const taxCalculationId of [null, undefined, '', 'not-a-calculation']) {
      const { calls, client } = stubClient()

      expect(await recordTaxTransaction(client, { orderNumber: 'N1', taxCalculationId })).toEqual({
        outcome: 'skipped',
      })
      expect(calls).toHaveLength(0)
    }
  })

  it('reports a refusal instead of throwing it', async () => {
    const { client } = stubClient('fail')

    const outcome = await recordTaxTransaction(client, {
      orderNumber: 'N1',
      taxCalculationId: 'taxcalc_1',
    })

    expect(outcome.outcome).toBe('failed')
  })
})

describe('a bag with nothing to tax', () => {
  const request = (overrides: Partial<TaxRequest>): TaxRequest => ({
    address: { city: 'Portland', country: 'US', postalCode: '97201', region: 'OR' },
    currency: 'USD',
    discountMinor: 0,
    shippingMinor: 0,
    subtotalMinor: 0,
    ...overrides,
  })

  it('answers not_required when the goods are fully discounted and delivery is free', () => {
    expect(taxWithoutProvider(request({ discountMinor: 5_000, subtotalMinor: 5_000 }))).toEqual({
      amountMinor: 0,
      providerRef: null,
      status: 'not_required',
    })
  })

  it('still asks when delivery is charged, because delivery can be taxable', () => {
    expect(
      taxWithoutProvider(
        request({ discountMinor: 5_000, shippingMinor: 995, subtotalMinor: 5_000 }),
      ),
    ).toBeNull()
  })

  it('still asks for any ordinary bag', () => {
    expect(taxWithoutProvider(request({ subtotalMinor: 5_000 }))).toBeNull()
  })
})
