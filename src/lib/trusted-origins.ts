/**
 * **The origins a signed-in request may come from** — Payload's `csrf` allowlist. Phase 33, audit R1-14.
 *
 * Payload accepts the session cookie only when a request's `Origin` is on this list, and a Server Action
 * always sends `Origin`. The list was implicitly just `serverURL` — `SITE_URL` — so on any other host the
 * application answers, the cookie was ignored: the page rendered signed in (a plain GET sends no
 * `Origin`), and every action ran as a guest. *"Sign in to save an address"* to a customer looking at
 * their own account.
 *
 * **It was live in production.** Production's `SITE_URL` names the team alias
 * (`north01apparel-mi-ca-growth.vercel.app`); customers use `north01apparel.vercel.app`. Every signed-in
 * action on the public host ran anonymous, and the UI sign-out could not revoke the session it was
 * signing out of.
 *
 * The allowlist is every host this deployment is, and nothing else: the canonical URL, Vercel's
 * production host, this deployment's own host and a preview's branch alias — all set by the platform at
 * deploy time, never taken from a request — and, off Vercel, the machine itself on the port it serves.
 * A foreign origin is still refused, which is what a CSRF allowlist is for.
 *
 * Pure, so `tests/unit/trusted-origins.test.ts` can pin it without loading the environment.
 */
export function trustedOrigins(input: {
  onVercel: boolean
  port: string | undefined
  siteUrl: string
  vercelBranchUrl: string | undefined
  vercelProductionUrl: string | undefined
  vercelUrl: string | undefined
}): string[] {
  const platform = [input.vercelProductionUrl, input.vercelUrl, input.vercelBranchUrl]
    .filter((host): host is string => typeof host === 'string' && host.length > 0)
    .map((host) => `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`)

  const port = input.port && /^\d+$/.test(input.port) ? input.port : '3000'
  const machine = input.onVercel ? [] : [`http://localhost:${port}`, `http://127.0.0.1:${port}`]

  return [...new Set([input.siteUrl.replace(/\/+$/, ''), ...platform, ...machine])]
}
