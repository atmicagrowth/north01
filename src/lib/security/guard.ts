import 'server-only'

import { headers } from 'next/headers'

import { serverEnv } from '@/lib/env.server'
import { publicEnv } from '@/lib/env.public'

import {
  TURNSTILE_FAILURE_MESSAGE,
  TURNSTILE_FIELD,
  verifyTurnstile,
  type TurnstileOutcome,
} from './turnstile'

/**
 * **The one call a Server Action makes to satisfy §26.1a.**
 *
 * Guarded, because it reads the secret. `turnstile.ts` holds the decision and is unguarded so a
 * harness can drive it; this holds the environment and the request, which is the split every
 * integration in this project uses.
 *
 * ### The caller cannot skip it
 *
 * The signature takes a `FormData` and returns an outcome. There is no "required" flag for a call
 * site to get wrong: whether verification applies is decided from the **server** environment inside
 * `verifyTurnstile`, and a form that omits the field simply fails when the integration is
 * configured.
 *
 * ### `remoteip` is best-effort and is never trusted for anything else
 *
 * `x-forwarded-for` is a header, and a header is client-controlled unless a proxy overwrites it.
 * Vercel does overwrite it, so on this deployment it is the real address — but it is passed to
 * Cloudflare as a *hint* and used nowhere else. Nothing in this application makes an authorisation
 * decision from it, which is the property that makes forwarding it harmless.
 */
export async function guardPublicForm(formData: FormData): Promise<TurnstileOutcome> {
  const requestHeaders = await headers()

  const forwarded = requestHeaders.get('x-forwarded-for')

  return verifyTurnstile({
    remoteIp: forwarded?.split(',')[0]?.trim() ?? null,
    secretKey: serverEnv.TURNSTILE_SECRET_KEY,
    siteKey: publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    token: formData.get(TURNSTILE_FIELD),
  })
}

/**
 * The same guard, reduced to the sentence a form shows.
 *
 * `null` means the submission may proceed. A string means refuse, and it is always the same string —
 * see `TURNSTILE_FAILURE_MESSAGE` for why the failures are not distinguished for the customer.
 *
 * The reason **is** logged, once, because an operator watching a spike of `timeout-or-duplicate`
 * is watching a replay attempt and an operator watching `http-500` is watching a Cloudflare
 * incident. Those are different responses to what looks like the same thing on the page.
 */
export async function publicFormRefusal(formData: FormData): Promise<null | string> {
  const outcome = await guardPublicForm(formData)

  if (outcome.ok) {
    return null
  }

  console.warn(`[security] Turnstile refused a submission: ${outcome.reason}`)

  return TURNSTILE_FAILURE_MESSAGE
}
