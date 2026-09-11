/**
 * **The email service — plan §19.**
 *
 * ```
 * pnpm verify:email
 * ```
 *
 * The phase prompt names what has to be true: *"Email sending must be idempotent for webhook-driven
 * events and must never cause a successful payment/order to fail. Record sufficient delivery
 * intent/status to prevent duplicate sends and support retries. Add local/dev safeguards so emails
 * are not accidentally sent to arbitrary recipients using production credentials."*
 *
 * Every clause of that is measured here, and **none of it needs an API key**. `send.ts` takes its
 * transport and its environment as arguments, so the whole service — the dedupe barrier, the retry
 * ceiling, the dev safeguard, the failure recording — is driven with a fake that opens no socket and
 * an environment this file chooses. That is the same structural choice `verify:webhook` relies on,
 * and it is why the one integration nobody has credentials for is still the one with the fewest
 * unverified claims.
 *
 * Sections A–D are pure and run with no database. E onwards is the real one, and the **D-10** guard
 * applies: they create and delete orders, customers and message rows.
 */

import type { Payload } from 'payload'

import config from '../src/payload.config'

import { renderEmail } from '../src/emails/messages'
import { queueOrderConfirmation } from '../src/lib/email/orders'
import {
  dedupeKeyFor,
  EMAIL_KINDS,
  isRetryable,
  MAX_DELIVERY_ATTEMPTS,
  parseAllowlist,
  resolveRecipient,
  subjectFor,
  type Transport,
  type TransportMessage,
} from '../src/lib/email/rules'
import { deliverEmail, drainEmails, enqueueEmail, type Courier } from '../src/lib/email/send'
import { developmentDatabase } from '../src/lib/env.core'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-email refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes collection documents, so it may only touch the development database ' +
      'that DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const { getPayload } = await import('payload')

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

/* -------------------------------------------------------------------------------------------------
 * A — §19.1b's eight templates
 * ---------------------------------------------------------------------------------------------- */

const SAMPLE = {
  contactConfirmation: { name: 'Ada' },
  orderConfirmation: {
    discount: '-$10.00',
    lines: [
      { lineTotal: '$120.00', productName: 'Field Jacket', quantity: 1, variantLabel: 'Ink / M' },
    ],
    orderNumber: 'N1-2609-ABC123',
    shipping: '$0.00',
    shippingMethodLabel: 'Standard',
    subtotal: '$130.00',
    tax: '$8.40',
    total: '$128.40',
  },
  orderDelivered: { orderNumber: 'N1-2609-ABC123' },
  orderShipped: {
    carrier: 'Royal Mail',
    orderNumber: 'N1-2609-ABC123',
    trackingNumber: 'TRK999',
    trackingUrl: 'https://example.test/track/TRK999',
  },
  passwordReset: { resetHref: 'https://example.test/reset-password?token=abc' },
  refund: { amount: '$128.40', orderNumber: 'N1-2609-ABC123' },
  verification: { verifyHref: 'https://example.test/verify?token=abc' },
  welcome: { accountHref: 'https://example.test/account', firstName: 'Ada' },
} as const

{
  check(
    'A: §19.1b names eight templates and exactly eight kinds exist',
    EMAIL_KINDS.length === 8,
    EMAIL_KINDS.join(','),
  )

  for (const kind of EMAIL_KINDS) {
    const { html, text } = await renderEmail(kind, SAMPLE[kind] as never)

    check(`A: ${kind} renders HTML`, html.length > 200, `${html.length} chars`)
    check(
      `A: ${kind} renders a plain-text alternative`,
      text.trim().length > 20,
      `${text.length} chars`,
    )

    /*
     * The failure this catches is a template interpolating a field the caller did not pass. It ships
     * as the literal word "undefined" in a customer's inbox and nothing else notices.
     */
    check(
      `A: ${kind} leaks no undefined`,
      !html.includes('undefined') && !text.includes('undefined'),
    )

    check(`A: ${kind} carries the wordmark`, html.includes('NORTH / 01'))
  }

  const receipt = await renderEmail('orderConfirmation', SAMPLE.orderConfirmation as never)

  check(
    'A: **the receipt contains what a receipt contains** — line, quantity, total, order number',
    receipt.html.includes('Field Jacket') &&
      receipt.html.includes('Ink / M') &&
      receipt.html.includes('$128.40') &&
      receipt.html.includes('N1-2609-ABC123'),
  )

  const shipped = await renderEmail('orderShipped', SAMPLE.orderShipped as never)

  check(
    'A: §18.1c the dispatch message carries the carrier and the tracking number',
    shipped.html.includes('Royal Mail') && shipped.html.includes('TRK999'),
  )

  const reset = await renderEmail('passwordReset', SAMPLE.passwordReset as never)

  check(
    'A: **the reset link survives a client that strips anchors** — it is printed as text too',
    reset.text.includes('https://example.test/reset-password?token=abc'),
  )

  /* No image and no tracking pixel: a blocked remote image must not be able to break a receipt. */
  check(
    'A: no template embeds an image or a tracking pixel',
    (await Promise.all(EMAIL_KINDS.map((kind) => renderEmail(kind, SAMPLE[kind] as never)))).every(
      ({ html }) => !html.includes('<img'),
    ),
  )
}

/* -------------------------------------------------------------------------------------------------
 * B — §19.1c's keys
 * ---------------------------------------------------------------------------------------------- */

{
  check(
    'B: a confirmation is keyed on the ORDER, not the Stripe event',
    dedupeKeyFor('orderConfirmation', { id: 42 }) === 'order-confirmation:42',
    dedupeKeyFor('orderConfirmation', { id: 42 }),
  )

  check(
    'B: **two events for one payment produce one key** — the case that would double-send',
    dedupeKeyFor('orderConfirmation', { id: 42 }) === dedupeKeyFor('orderConfirmation', { id: 42 }),
  )

  check(
    'B: a refund is keyed on the order AND the amount, so a partial refund is not swallowed',
    dedupeKeyFor('refund', { amountMinor: 1500, id: 42 }) !==
      dedupeKeyFor('refund', { amountMinor: 4000, id: 42 }),
    `${dedupeKeyFor('refund', { amountMinor: 1500, id: 42 })} vs ${dedupeKeyFor('refund', { amountMinor: 4000, id: 42 })}`,
  )

  check(
    'B: a reset is NOT one per customer — asking again is the point of asking again',
    dedupeKeyFor('passwordReset', { id: 7, issuedAt: 'a' }) !==
      dedupeKeyFor('passwordReset', { id: 7, issuedAt: 'b' }),
  )

  check(
    'B: shipped and delivered are distinct keys for one order',
    dedupeKeyFor('orderShipped', { id: 42 }) !== dedupeKeyFor('orderDelivered', { id: 42 }),
  )

  check(
    'B: every kind produces a subject, and none is empty',
    EMAIL_KINDS.every((kind) => subjectFor(kind, { orderNumber: 'N1-X' }).length > 0),
  )
}

/* -------------------------------------------------------------------------------------------------
 * C — the dev safeguard
 * ---------------------------------------------------------------------------------------------- */

{
  const decide = (
    appEnv: 'local' | 'preview' | 'production',
    allowlist: string[],
    intended: string,
  ) => resolveRecipient({ allowlist, appEnv, intended })

  check(
    'C: production delivers to a real customer',
    decide('production', [], 'customer@example.test').status === 'send',
  )

  check(
    'C: **an empty allowlist outside production delivers to nobody** — the safe default',
    decide('local', [], 'customer@example.test').status === 'suppressed',
  )

  check(
    'C: **a real address on a laptop is suppressed even with a production key present**',
    decide('local', ['dev@example.test'], 'customer@example.test').status === 'suppressed',
  )

  check(
    'C: an allowlisted address on a laptop is delivered',
    decide('local', ['dev@example.test'], 'dev@example.test').status === 'send',
  )

  check(
    'C: preview is not production either',
    decide('preview', [], 'customer@example.test').status === 'suppressed',
  )

  check(
    'C: matching is case-insensitive — an allowlist that fails on capitals gets widened',
    decide('local', ['Dev@Example.test'], 'dev@example.TEST').status === 'send',
  )

  check(
    'C: the allowlist splits on commas and whitespace and drops empties',
    parseAllowlist('a@x.test, b@x.test  c@x.test,,').join('|') === 'a@x.test|b@x.test|c@x.test',
    parseAllowlist('a@x.test, b@x.test  c@x.test,,').join('|'),
  )

  check(
    'C: an unset allowlist parses to nothing rather than throwing',
    parseAllowlist(undefined).length === 0,
  )
}

/* -------------------------------------------------------------------------------------------------
 * D — the retry ceiling
 * ---------------------------------------------------------------------------------------------- */

{
  check('D: a fresh failure is retryable', isRetryable('failed', 0))
  check('D: a message at the ceiling is not', !isRetryable('failed', MAX_DELIVERY_ATTEMPTS))
  check('D: a sent message is never retried', !isRetryable('sent', 0))
  check(
    'D: **a suppressed message is never retried into a real send**',
    !isRetryable('suppressed', 0),
  )
  check(
    'D: a nonsense attempt count is treated as none, not as a crash',
    isRetryable('pending', NaN),
  )
}

/* -------------------------------------------------------------------------------------------------
 * The database half
 * ---------------------------------------------------------------------------------------------- */

const payload: Payload = await getPayload({ config })

const created: {
  collection:
    'customers' | 'email-messages' | 'order-items' | 'orders' | 'product-variants' | 'products'
  id: number
}[] = []

const cleanup = async () => {
  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true, trash: false })
      .catch(() => undefined)
  }
}

const suffix = Date.now().toString().slice(-9)

/** A transport that records rather than sends. The whole point of the `Transport` contract. */
function fakeTransport(behaviour: 'fail' | 'ok' | 'throw' = 'ok') {
  const seen: TransportMessage[] = []

  const transport: Transport = async (message) => {
    seen.push(message)

    if (behaviour === 'throw') {
      throw new Error('the socket died')
    }

    return behaviour === 'ok'
      ? { id: `fake_${seen.length}`, ok: true }
      : { error: 'Provider refused: domain not verified.', ok: false }
  }

  return { seen, transport }
}

function courierWith(transport: Transport, appEnv: 'local' | 'production' = 'production'): Courier {
  return {
    allowlist: [],
    appEnv,
    from: 'NORTH / 01 <no-reply@example.test>',
    replyTo: null,
    transport,
  }
}

const messageById = async (id: number) =>
  payload.findByID({ collection: 'email-messages', depth: 0, id, overrideAccess: true })

async function makeOrder(label: string) {
  const order = await payload.create({
    collection: 'orders',
    data: {
      currency: 'USD',
      discountMinor: 0,
      email: `verify-email-${suffix}@example.test`,
      fulfillmentStatus: 'unfulfilled',
      orderNumber: `N1-EM-${label}-${suffix}`,
      paymentStatus: 'paid',
      shippingMinor: 0,
      subtotalMinor: 12_000,
      taxMinor: 0,
      totalMinor: 12_000,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'orders', id: order.id })

  return order
}

try {
  /* ============================================ E — the barrier is a constraint */
  {
    const key = `verify-claim-${suffix}`

    const first = await enqueueEmail(payload, {
      data: SAMPLE.welcome,
      dedupeKey: key,
      kind: 'welcome',
      to: 'dev@example.test',
    })

    check('E: the first enqueue claims the key', first.outcome === 'claimed', first.outcome)

    if (first.outcome === 'claimed') {
      created.push({ collection: 'email-messages', id: first.id })
    }

    const second = await enqueueEmail(payload, {
      data: SAMPLE.welcome,
      dedupeKey: key,
      kind: 'welcome',
      to: 'dev@example.test',
    })

    check(
      'E: **a second enqueue of the same key is refused by the database**',
      second.outcome === 'duplicate',
      second.outcome,
    )
  }

  /* ============================================ F — the race the barrier exists for */
  {
    const key = `verify-race-${suffix}`

    /*
     * **The test Phase 17's sweeps taught this project to write.**
     *
     * A sequential duplicate check passes whether the guard is a constraint or a read-then-write. Only
     * running them at the same instant tells the two apart — and a webhook retry arriving while the
     * first delivery is still in flight is exactly the shape §19.1c describes.
     */
    const [a, b] = await Promise.all([
      enqueueEmail(payload, {
        data: SAMPLE.welcome,
        dedupeKey: key,
        kind: 'welcome',
        to: 'dev@example.test',
      }),
      enqueueEmail(payload, {
        data: SAMPLE.welcome,
        dedupeKey: key,
        kind: 'welcome',
        to: 'dev@example.test',
      }),
    ])

    const claimed = [a, b].filter((outcome) => outcome.outcome === 'claimed')

    for (const outcome of claimed) {
      if (outcome.outcome === 'claimed')
        created.push({ collection: 'email-messages', id: outcome.id })
    }

    check(
      'F: **two simultaneous enqueues of one key produce exactly one message**',
      claimed.length === 1,
      `${a.outcome},${b.outcome}`,
    )
  }

  /* ============================================ G — delivery, and the claim on the attempt */
  {
    const { seen, transport } = fakeTransport('ok')

    const queued = await enqueueEmail(payload, {
      data: SAMPLE.welcome,
      dedupeKey: `verify-deliver-${suffix}`,
      kind: 'welcome',
      to: 'dev@example.test',
    })

    if (queued.outcome !== 'claimed') throw new Error('fixture failed to claim')

    created.push({ collection: 'email-messages', id: queued.id })

    const outcome = await deliverEmail(payload, queued.id, courierWith(transport))

    check('G: a claimed message is delivered', outcome.outcome === 'sent', outcome.outcome)
    check('G: …the transport was handed both bodies', seen[0]?.html !== '' && seen[0]?.text !== '')
    check(
      'G: **…and the provider idempotency key**, which covers the send-then-record window',
      seen[0]?.idempotencyKey === `verify-deliver-${suffix}`,
      String(seen[0]?.idempotencyKey),
    )
    check('G: …and the from identity', seen[0]?.from.includes('no-reply@example.test') === true)

    const row = await messageById(queued.id)

    check('G: …the row records sent', row.status === 'sent', String(row.status))
    check('G: …with the provider id', row.providerId === 'fake_1', String(row.providerId))
    check('G: …and one attempt', Number(row.attempts) === 1, String(row.attempts))

    /*
     * Two drains running at once must not both deliver one row. The attempt is claimed by a
     * conditional UPDATE for exactly this reason.
     */
    const again = await deliverEmail(payload, queued.id, courierWith(transport))

    check(
      'G: **an already-sent message cannot be delivered twice**',
      again.outcome === 'notClaimable',
      again.outcome,
    )
  }

  /* ============================================ H — §19.1d, failure recorded and retried */
  {
    const failing = fakeTransport('fail')

    const queued = await enqueueEmail(payload, {
      data: SAMPLE.welcome,
      dedupeKey: `verify-fail-${suffix}`,
      kind: 'welcome',
      to: 'dev@example.test',
    })

    if (queued.outcome !== 'claimed') throw new Error('fixture failed to claim')

    created.push({ collection: 'email-messages', id: queued.id })

    const first = await deliverEmail(payload, queued.id, courierWith(failing.transport))

    check('H: a provider refusal is reported as failed', first.outcome === 'failed', first.outcome)

    const afterFailure = await messageById(queued.id)

    check(
      'H: §19.1d the reason is recorded, not just the status',
      String(afterFailure.error).includes('domain not verified'),
      String(afterFailure.error),
    )

    /* And it recovers: the same message, a working provider, delivered. */
    const working = fakeTransport('ok')
    const retried = await deliverEmail(payload, queued.id, courierWith(working.transport))

    check(
      'H: **a failed message is retryable and recovers**',
      retried.outcome === 'sent',
      retried.outcome,
    )

    const afterRetry = await messageById(queued.id)

    check(
      'H: …the error is cleared on success',
      afterRetry.error === null,
      String(afterRetry.error),
    )
    check(
      'H: …and the attempts show both tries',
      Number(afterRetry.attempts) === 2,
      String(afterRetry.attempts),
    )
  }

  /* ============================================ I — the ceiling */
  {
    const failing = fakeTransport('fail')

    const queued = await enqueueEmail(payload, {
      data: SAMPLE.welcome,
      dedupeKey: `verify-ceiling-${suffix}`,
      kind: 'welcome',
      to: 'dev@example.test',
    })

    if (queued.outcome !== 'claimed') throw new Error('fixture failed to claim')

    created.push({ collection: 'email-messages', id: queued.id })

    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      await deliverEmail(payload, queued.id, courierWith(failing.transport))
    }

    const exhausted = await deliverEmail(
      payload,
      queued.id,
      courierWith(fakeTransport('ok').transport),
    )

    check(
      'I: **retrying stops at the ceiling rather than forever**',
      exhausted.outcome === 'notClaimable',
      exhausted.outcome,
    )

    const row = await messageById(queued.id)

    check(
      'I: …and the row is left failed, for a human — §19.1d "admin visibility"',
      row.status === 'failed' && Number(row.attempts) === MAX_DELIVERY_ATTEMPTS,
      `${row.status}/${row.attempts}`,
    )
  }

  /* ============================================ J — the safeguard, against the database */
  {
    const { seen, transport } = fakeTransport('ok')

    const queued = await enqueueEmail(payload, {
      data: SAMPLE.welcome,
      dedupeKey: `verify-suppress-${suffix}`,
      kind: 'welcome',
      to: 'a-real-customer@example.test',
    })

    if (queued.outcome !== 'claimed') throw new Error('fixture failed to claim')

    created.push({ collection: 'email-messages', id: queued.id })

    const outcome = await deliverEmail(payload, queued.id, courierWith(transport, 'local'))

    check(
      'J: **outside production a non-allowlisted address is suppressed**',
      outcome.outcome === 'suppressed',
      outcome.outcome,
    )

    check('J: …and the transport was never called', seen.length === 0, `${seen.length} calls`)

    const row = await messageById(queued.id)

    check('J: …the row says so, with the reason', row.status === 'suppressed' && row.error !== null)

    const retry = await deliverEmail(payload, queued.id, courierWith(transport, 'production'))

    check(
      'J: **a suppressed message is never retried into a real send**',
      retry.outcome === 'notClaimable',
      retry.outcome,
    )
  }

  /* ============================================ K — §19.1d, nothing escapes */
  {
    const throwing = fakeTransport('throw')

    const queued = await enqueueEmail(payload, {
      data: SAMPLE.welcome,
      dedupeKey: `verify-throw-${suffix}`,
      kind: 'welcome',
      to: 'dev@example.test',
    })

    if (queued.outcome !== 'claimed') throw new Error('fixture failed to claim')

    created.push({ collection: 'email-messages', id: queued.id })

    let escaped = false

    const outcome = await deliverEmail(payload, queued.id, courierWith(throwing.transport)).catch(
      () => {
        escaped = true

        return { outcome: 'failed' as const, reason: 'threw' }
      },
    )

    check(
      'K: **a transport that throws does not throw out of the service** — §19.1d',
      !escaped && outcome.outcome === 'failed',
      escaped ? 'it escaped' : outcome.outcome,
    )
  }

  /* ============================================ L — the real confirmation, end to end */
  {
    const order = await makeOrder('L')

    const item = await payload.create({
      collection: 'order-items',
      data: {
        lineTotalMinor: 12_000,
        order: order.id,
        productName: 'Field Jacket',
        quantity: 1,
        sku: `EM-${suffix}`,
        unitPriceMinor: 12_000,
        variantLabel: 'Ink / M',
      } as never,
      overrideAccess: true,
    })

    created.push({ collection: 'order-items', id: item.id })

    const queued = await queueOrderConfirmation(payload, order.id)

    check(
      'L: an order confirmation is queued from the order itself',
      queued.outcome === 'claimed',
      queued.outcome,
    )

    if (queued.outcome !== 'claimed') throw new Error('confirmation failed to queue')

    created.push({ collection: 'email-messages', id: queued.id })

    const row = await messageById(queued.id)

    check(
      'L: …addressed to the order snapshot, never the customer record',
      row.to === `verify-email-${suffix}@example.test`,
      String(row.to),
    )

    check(
      'L: …and the subject carries the order number',
      String(row.subject).includes(String(order.orderNumber)),
    )

    const { seen, transport } = fakeTransport('ok')

    await deliverEmail(payload, queued.id, courierWith(transport))

    const body = seen[0]?.html ?? ''

    check(
      'L: **the receipt contains the frozen line snapshot** — §18.1d, in the customer’s copy',
      body.includes('Field Jacket') && body.includes('Ink / M'),
    )

    /* A second attempt for the same order — what a replayed Stripe event looks like. */
    const replay = await queueOrderConfirmation(payload, order.id)

    check(
      'L: **a replayed event does not queue a second confirmation**',
      replay.outcome === 'duplicate',
      replay.outcome,
    )
  }

  /* ============================================ L2 — R1-21, the transport's own timeout */
  {
    /*
     * A provider that accepts the connection and never answers. Resend's SDK sends through the
     * global `fetch`, so a `fetch` that never settles is exactly that provider, and no socket opens.
     */
    const { createEmailTransport } = await import('../src/lib/email/resend')
    const realFetch = globalThis.fetch

    globalThis.fetch = (() => new Promise<Response>(() => undefined)) as typeof fetch

    const started = Date.now()

    const outcome = await createEmailTransport({ apiKey: 're_verify_timeout' })({
      from: 'NORTH / 01 <shop@example.test>',
      html: '<p>timeout</p>',
      idempotencyKey: `verify-timeout-${suffix}`,
      replyTo: null,
      subject: 'timeout',
      text: 'timeout',
      to: 'nobody@example.test',
    }).finally(() => {
      globalThis.fetch = realFetch
    })

    const waited = Date.now() - started

    check(
      'L2: **R1-21 a provider that never answers fails at the timeout** instead of holding the caller',
      !outcome.ok && outcome.error === 'timeout' && waited >= 7_500 && waited < 12_000,
      `${JSON.stringify(outcome)} after ${waited}ms`,
    )
  }

  /* ============================================ M — the drain */
  {
    const order = await makeOrder('M')

    const queued = await queueOrderConfirmation(payload, order.id)

    if (queued.outcome !== 'claimed') throw new Error('drain fixture failed to queue')

    created.push({ collection: 'email-messages', id: queued.id })

    const { transport } = fakeTransport('ok')
    const tally = await drainEmails(payload, courierWith(transport), { limit: 50 })

    check('M: the drain delivers what is owed', tally.sent >= 1, JSON.stringify(tally))

    check(
      'M: …and leaves nothing pending behind it',
      (await messageById(queued.id)).status === 'sent',
    )
  }
} finally {
  await cleanup()
}

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} email checks passed.`,
  ...failed.map((result) => `FAIL  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`),
  '',
  ...results.map(
    (result) =>
      `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  ),
].join('\n')

await new Promise<void>((resolve, reject) => {
  process.stdout.write(`${report}\n`, (error) => (error ? reject(error) : resolve()))
})

await payload.destroy()

if (failed.length > 0) {
  throw new Error(`${failed.length} email check(s) failed.`)
}
