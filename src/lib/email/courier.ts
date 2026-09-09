import 'server-only'

import type { Payload } from 'payload'

import type { Courier } from './send'

import { appEnv, integrationStatus, requireIntegration, serverEnv } from '@/lib/env.server'
import { buildCourier } from './resend'

/**
 * **The guarded half of assembling a send** — the environment tier that application code uses.
 *
 * `resend.ts` next door is deliberately unguarded and environment-free, because `payload.config.ts`
 * and the `verify:*` harnesses load outside Next where `server-only` cannot resolve. This module is
 * the one those constraints do not apply to: it is imported only from route handlers and server
 * actions, so it carries the guard and does the reading, and hands the values to the same
 * `buildCourier` everything else uses.
 *
 * Returns `null` when Resend is unconfigured, which is **not an error**. Plan §A.5 puts email on the
 * non-critical side of the line — *"Resend unavailable → order persists, email is retried"* — so
 * every caller treats `null` as "record the intent and move on". The row is still written, the
 * order is still correct, and `pnpm email:drain` delivers the backlog the moment a key exists.
 */
export function courierFromEnv(replyTo: null | string = null): Courier | null {
  if (integrationStatus('resend') !== 'configured') {
    return null
  }

  const { EMAIL_FROM, RESEND_API_KEY } = requireIntegration('resend')

  return buildCourier({
    allowlist: serverEnv.EMAIL_DEV_ALLOWLIST,
    apiKey: RESEND_API_KEY,
    appEnv,
    from: EMAIL_FROM,
    replyTo,
  })
}

/**
 * The same, with the shop's own contact address as the reply-to.
 *
 * `SiteSettings.contactEmail` is where a customer's reply should land. A transactional message sent
 * from a no-reply address that silently discards replies is a small cruelty, and customers reply to
 * order confirmations constantly — asking to change an address, or to add something.
 *
 * A read failure costs the reply-to header and never the message.
 */
export async function courierFor(payload: Payload): Promise<Courier | null> {
  const settings = await payload
    .findGlobal({ depth: 0, overrideAccess: true, slug: 'site-settings' })
    .catch(() => null)

  const contact =
    settings && typeof settings.contactEmail === 'string' ? settings.contactEmail : null

  return courierFromEnv(contact)
}
