/**
 * **Turning a paid order's tax calculation into a Stripe Tax transaction** — Phase 36 sweep 1.
 *
 * A Stripe Tax *calculation* is a quote: it expires, and Stripe's tax reporting and filing ignore it.
 * What Stripe counts is a *transaction*, created from the calculation once the sale has happened. So
 * after an order is paid, the calculation stored on it at preflight (`orders.taxCalculationId`) is
 * committed with `stripe.tax.transactions.createFromCalculation`, referenced by the order number.
 *
 * - **After the response, never blocking.** The payment has happened whatever this does; a failure is
 *   logged and reported for someone to record by hand, and Stripe's webhook is not held open for it.
 * - **Skipped** when there is no calculation — no Stripe keys (the deferral), nothing taxable.
 * - **Idempotent by reference.** Stripe refuses a second transaction with the same reference, so a
 *   redelivered payment cannot record the sale twice; that refusal is logged like any other failure.
 * - **A refund does not yet reverse it.** `transactions.createReversal` is the counterpart, and is
 *   not built: refunds are rare, begin in the Stripe dashboard, and can be reversed there. Named so
 *   it is not mistaken for done.
 *
 * No `server-only` guard: the client is an argument, so a unit test can hand it a stub.
 */

/** The one method this module needs, so a test can stub it without the SDK. */
export type TaxTransactionClient = {
  tax: {
    transactions: {
      createFromCalculation: (
        params: { calculation: string; reference: string },
        options?: { idempotencyKey?: string },
      ) => Promise<{ id: string }>
    }
  }
}

export type TaxTransactionOutcome =
  | { id: string; outcome: 'recorded' }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'skipped' }

export async function recordTaxTransaction(
  client: TaxTransactionClient,
  order: { orderNumber: string; taxCalculationId: null | string | undefined },
): Promise<TaxTransactionOutcome> {
  const calculation = order.taxCalculationId

  if (typeof calculation !== 'string' || !calculation.startsWith('taxcalc_')) {
    return { outcome: 'skipped' }
  }

  try {
    const transaction = await client.tax.transactions.createFromCalculation(
      { calculation, reference: order.orderNumber },
      { idempotencyKey: `tax-transaction-${order.orderNumber}` },
    )

    return { id: transaction.id, outcome: 'recorded' }
  } catch (error) {
    return {
      outcome: 'failed',
      reason: error instanceof Error ? error.message.slice(0, 400) : String(error),
    }
  }
}
