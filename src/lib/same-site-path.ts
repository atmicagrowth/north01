/**
 * **Does this string stay on this site?** Stated once, because four places asked it and all four got
 * the same answer wrong.
 *
 * A path that leaves the site is an **open redirect**: a link on our own domain that lands on someone
 * else's. It is a phishing primitive, and it is worst in exactly the place this project had it — the
 * `?next=` parameter the login flow returns you to, which hands a visitor to an attacker in the
 * moment right after they type their password.
 *
 * ### The check every one of those four sites was making, and why it is not enough
 *
 * ```ts
 * value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
 * ```
 *
 * That refuses the two shapes everyone knows: an absolute URL, and the protocol-relative `//host`
 * (with its backslash variant, because browsers treat `\` as `/` in an authority). It was written
 * against exactly those, and it holds against exactly those.
 *
 * **It does not survive a control character.** The WHATWG URL parser *removes* every tab, line feed
 * and carriage return from a URL before parsing it — so `"/\t/evil.example"` starts with a single
 * slash when you inspect it in JavaScript, and is `//evil.example` by the time a browser resolves it:
 *
 * ```
 * new URL('/\t/evil.example', 'https://north01.example/page')  →  https://evil.example/
 * ```
 *
 * Measured in Chromium, not reasoned about. The same stripping applies to a `Location` header, which
 * is how `redirect()` carries the value, so it was reachable through both an anchor and a server
 * redirect. It was demonstrated end to end against the running application: signing in at
 * `/login?next=/%09/evil.example` landed the browser on `evil.example`.
 *
 * A raw control character never appears in a legitimate path — a real tab in a URL is written `%09` —
 * so this **refuses** rather than sanitises. Stripping the characters and re-checking would work
 * equally well against today's parser and would be one specification revision away from being wrong
 * again; refusing an input nobody legitimately sends does not have that property.
 *
 * ### Why it is a module of its own
 *
 * The same rule is needed by the session layer (`lib/auth/session.ts`), the storefront shell
 * (`lib/navigation/routes.ts`), and two Payload validators (`payload/fields/link.ts`,
 * `payload/globals/SiteSettings.ts`) — and the last two are loaded by tsx **outside Next**, where the
 * `@/` alias does not resolve and `server-only` cannot. So this is deliberately plain: no imports, no
 * environment, no Payload, reachable by a relative path from a collection and by the alias from
 * everywhere else. It is the same shape, and the same reasoning, as `lib/password-policy.ts`.
 *
 * The duplication is what allowed the drift: four copies of one rule, three of them fixed and one
 * forgotten, is the failure this module exists to make impossible.
 */

/** C0 controls and DEL. Browsers strip 09/0A/0D outright; the rest have no business in a URL either. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/

/**
 * A rooted path this application will route, and that a browser cannot resolve off-site.
 *
 * Returns `false` for an absolute URL — that is deliberate and is not the same question as "is this
 * href allowed". A navigation item may legitimately point at `https://instagram.com/…`; a *redirect
 * target* may not. Callers that accept both test for external separately.
 */
export function isSameSitePath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') {
    return false
  }

  if (CONTROL_CHARACTERS.test(value)) {
    return false
  }

  if (!value.startsWith('/')) {
    return false
  }

  // `//host` and `/\host` are both protocol-relative once a browser has finished with them.
  return !value.startsWith('//') && !value.startsWith('/\\')
}
