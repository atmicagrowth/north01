import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * **The outermost, weakest layer of route protection** — plan §7.1e's *"protected account routes"*,
 * done first and cheaply.
 *
 * This file is `proxy.ts`, not `middleware.ts`. Next 16 renamed the convention; `middleware.js` still
 * resolves but is deprecated, and the export must be named `proxy` or be the default. See
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.
 *
 * ### What it does, and what it must never be trusted to do
 *
 * It looks for the presence of the session cookie. It does not verify the signature, it does not
 * check expiry, and it does not ask the database whether the session was revoked — all three would
 * need Payload and a Postgres round trip in front of every request, which is precisely the cost the
 * proxy exists to avoid.
 *
 * So a forged or stale cookie gets past this. That is *fine*, because it then reaches
 * `requireCustomer()` in the account layout, which does the real check, and any data it tries to
 * touch goes through `payload/access/`, which does the real check again. What this buys is the
 * common case: a signed-out visitor clicking "Account" is redirected before a render begins,
 * instead of rendering a layout that immediately redirects.
 *
 * Next's own authentication guide calls this an "optimistic check" and says the same thing:
 * *"While Proxy can be useful for initial checks, it should not be your only line of defense."*
 * The proxy documentation adds the sharper warning — a Server Function is a POST to the route it is
 * used on, so **a matcher change can silently remove proxy coverage from a mutation**. Nothing in
 * `lib/auth/actions.ts` relies on this file; every action re-derives the caller from the cookie
 * itself.
 *
 * ### Why the cookie name is derived rather than imported
 *
 * `payload.config.cookiePrefix` is the authority, and importing the Payload config here would pull
 * the entire CMS — collections, the database adapter, the environment module — into a file that runs
 * on every matched request. The prefix is Payload's documented default (`payload`) and is not
 * overridden in `payload.config.ts`; if it ever is, `scripts/verify-access.ts` fails on the
 * redirect assertion, which is the check that would catch the drift.
 */
const SESSION_COOKIE = 'payload-token'

/**
 * **Plan §31.1a — a URL that cannot be decoded is a page that does not exist, not a server error.**
 *
 * `/product/%E0%A4%A` is an incomplete UTF-8 sequence. Next throws decoding it into the dynamic
 * segment's params, before any route code runs, and answered with a bare 21-byte *Internal Server
 * Error* — no shell, no way back, and a 500 in the logs for what is a mistyped link. Rewritten to a
 * path no route claims, it lands on the branded not-found page with a 404.
 */
export function isUndecodablePath(pathname: string): boolean {
  try {
    decodeURIComponent(pathname)

    return false
  } catch {
    return true
  }
}

const isAccountPath = (pathname: string) =>
  pathname === '/account' || pathname.startsWith('/account/')

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isUndecodablePath(pathname)) {
    return NextResponse.rewrite(new URL('/__not-found', request.url))
  }

  if (!isAccountPath(pathname)) {
    return NextResponse.next()
  }

  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next()
  }

  const signIn = new URL('/login', request.url)

  /*
   * Path plus query, never the absolute URL — `lib/auth/session.ts` refuses anything that is not a
   * single-slash-rooted path, so handing it an origin would only get it discarded. `nextUrl.search`
   * is carried because a protected route reached with filters or a page number should come back the
   * same way.
   */
  signIn.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`)

  return NextResponse.redirect(signIn)
}

/**
 * `/account` and everything under it, and nothing else.
 *
 * Deliberately not a negative match over the whole site. A broad matcher makes every request — every
 * static asset, every catalogue page — pay for this file, and it makes the "which paths are actually
 * protected" question something you answer by reading a regular expression backwards.
 */
export const config = {
  /*
   * `/account` for the sign-in gate; the rest are the routes with a dynamic segment, which are the
   * ones a malformed percent-encoding can break. Nothing else pays for the proxy.
   */
  matcher: [
    '/account',
    '/account/:path*',
    '/product/:path*',
    '/shop/:path*',
    '/collections/:path*',
    '/edit/:path*',
    '/journal/:path*',
    '/lookbook/:path*',
  ],
}
