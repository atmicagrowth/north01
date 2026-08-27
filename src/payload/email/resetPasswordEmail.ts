import type { PayloadRequest } from 'payload'

/**
 * The storefront route that trades a reset token for a new password. Kept beside the message that
 * links to it, because the two are one contract: change the route and the mail points at a 404.
 */
export const RESET_PASSWORD_PATH = '/reset-password'

/**
 * Where an absolute link in an email should point.
 *
 * `config.serverURL` is set from the validated environment in `payload.config.ts`, which is the only
 * source here that a request cannot influence. That matters more than it looks: building a reset
 * link from the incoming `Host` header is the classic host-header injection, and it turns "I know
 * your email address" into "I receive your password reset link" — the attacker triggers the reset
 * with a forged `Host`, and the victim's own mail carries a token pointed at the attacker's server.
 *
 * Payload's internal `getRequestOrigin` reaches the same conclusion by a different route: it prefers
 * `serverURL`, and falls back to the request host **only** when that host is in the CORS/CSRF
 * allowlist. It is not exported, so this states the safe half directly and refuses rather than
 * guessing when the environment has not been configured.
 */
function siteOrigin(req: PayloadRequest | undefined): string {
  const configured = req?.payload.config.serverURL

  if (!configured) {
    throw new Error(
      'Cannot build a password-reset link: config.serverURL is empty. Set SITE_URL — see docs/ENVIRONMENT.md.',
    )
  }

  return configured.replace(/\/+$/, '')
}

/**
 * **The customer's reset mail.** Without this override Payload builds the link from
 * `config.routes.admin`, because for most installations the only auth collection is the staff one —
 * so a shopper would be sent to `/admin/reset/<token>`, a route their session cannot even load
 * (`canAccessAdmin` is false for a customer, by **D-21**). Staff keep Payload's default, which is
 * correct for them.
 *
 * Deliberately plain. It is one link and two sentences, it renders in a text-only client, and it
 * carries no image, no tracking pixel and no marketing. **Phase 19** owns the React Email template
 * set (§19.1a) and will re-style this alongside the others; what must not change then is the
 * destination and the query parameter, which the reset page reads.
 *
 * The token is in the URL because that is what Payload issues and what `resetPassword` verifies.
 * It is single-use — the operation clears `resetPasswordToken` on success — and it expires in an
 * hour (`Customers.auth.forgotPassword.expiration`), which is what makes §7.1e's *expired reset
 * link* and *reused reset link* two defined behaviours rather than one accident.
 */
export const resetPasswordEmail = {
  subject: () => 'Reset your NORTH / 01 password',

  html: ({ req, token }: { req?: PayloadRequest; token?: string } = {}) => {
    const url = `${siteOrigin(req)}${RESET_PASSWORD_PATH}?token=${encodeURIComponent(token ?? '')}`

    return [
      '<p>Someone asked to reset the password for your NORTH / 01 account.</p>',
      `<p><a href="${url}">Choose a new password</a></p>`,
      `<p>${url}</p>`,
      '<p>This link can be used once and expires in one hour. If you did not ask for it, nothing has changed and you can ignore this message.</p>',
    ].join('\n')
  },
}
