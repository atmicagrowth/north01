import 'server-only'

import { headers as nextHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import { getPayloadClient } from '@/lib/payload'
import { isSameSitePath } from '@/lib/same-site-path'
import type { Customer, User } from '@/payload-types'

/**
 * **The data access layer for identity.** Next's own guidance for a new App Router project (its
 * authentication guide, "Creating a Data Access Layer") is that authorisation lives as close to the
 * data as possible and is reached through one memoised function rather than re-derived per
 * component. This is that function, and `payload/access/` is the layer beneath it.
 *
 * Two layers, not one, and they are not redundant:
 *
 * - **Here** decides what a *route* does — render, redirect to `/login`, or 404.
 * - **`payload/access/`** decides what a *query* returns, for every caller including the REST API,
 *   and is the one that cannot be forgotten.
 *
 * Next's Proxy is a third, weakest layer: it sees only the cookie, cannot verify it, and — as the
 * Next 16 proxy documentation says outright — is skipped for Server Functions on paths its matcher
 * excludes. It redirects the signed-out visitor before a render begins. It is never the check.
 *
 * `cache()` scopes to one server render pass, so a layout and three components asking who the viewer
 * is cost one `payload.auth()` — one JWT verification and one row read — rather than four.
 */

/** What Payload attaches to an authenticated request, with the collection it came from. */
export type Viewer =
  { collection: 'customers'; customer: Customer } | { collection: 'users'; staff: User } | null

/**
 * Who is making this request, according to the session cookie.
 *
 * `payload.auth` does the whole verification: signature, expiry, and — because `useSessions` is on —
 * that the token's session id is still in the user's `sessions` array. That last check is what makes
 * signing out and disabling an account take effect immediately rather than at token expiry, and it
 * is why this is a database read rather than a JWT decode.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const payload = await getPayloadClient()
  const { user } = await payload.auth({ headers: await nextHeaders() })

  if (!user) {
    return null
  }

  /*
   * `collection` is set by Payload's auth strategy on the object it returns, but the generated
   * `TypedUser` union does not carry it — the same reason `payload/access/index.ts` reads it through
   * a cast. Doing it once, here, keeps that cast out of route code.
   */
  const collection = (user as { collection?: string }).collection

  if (collection === 'customers') {
    return { collection: 'customers', customer: user as Customer }
  }

  if (collection === 'users') {
    return { collection: 'users', staff: user as User }
  }

  return null
})

/**
 * The signed-in shopper, or `null`.
 *
 * A **disabled** account resolves to `null` here as well as in every access rule, so a customer who
 * is suspended mid-session is treated as signed out by the account routes rather than shown a shell
 * that answers nothing. Disabling also empties `sessions`, so in practice the cookie has already
 * stopped authenticating — this covers the interval.
 */
export const getCustomer = cache(async (): Promise<Customer | null> => {
  const viewer = await getViewer()

  if (viewer?.collection !== 'customers') {
    return null
  }

  return viewer.customer.accountStatus === 'active' ? viewer.customer : null
})

/**
 * The `next` query parameter: where to return the customer after they sign in.
 *
 * **Only same-site paths.** An open redirect is a phishing primitive — `/login?next=https://evil.example`
 * puts a link on our own domain that lands on someone else's login form — so anything that is not a
 * single-slash-rooted path is discarded rather than sanitised.
 *
 * The rule itself is `lib/same-site-path.ts`, and it lives there because this function's own version
 * of it **had a hole**: it refused `//host` and `/\host` but accepted `/\t/host`, which a browser
 * strips to `//host` before resolving. Signing in at `/login?next=/%09/evil.example` left the site.
 * Found by the Phase 9 audit and fixed in all four places that had copied the check.
 */
export function safeReturnPath(value: null | string | undefined): string | null {
  return isSameSitePath(value) ? value : null
}

/**
 * Require a signed-in shopper, or send them to sign in and come back.
 *
 * For the `/account` segment (plan §7.1e, *"protected account routes"*). The redirect carries the
 * path they were trying to reach, so signing in resumes the journey rather than dumping them on an
 * account overview — structure §16's *"do not force account creation before browsing"* is about the
 * same instinct: authentication should interrupt as little as possible.
 */
export async function requireCustomer(returnTo?: string): Promise<Customer> {
  const customer = await getCustomer()

  if (customer) {
    return customer
  }

  const next = safeReturnPath(returnTo)

  redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
}
