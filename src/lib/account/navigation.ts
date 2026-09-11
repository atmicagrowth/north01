/**
 * **Plan §20.1d's six routes, in one place.**
 *
 * > `/account`, `/account/orders`, `/account/orders/[order]`, `/account/wishlist`,
 * > `/account/addresses`, `/account/settings`.
 *
 * Five of them are navigable; `[order]` is reached from the orders list rather than from a nav item.
 *
 * ### The plan's route name wins over the structure document's screen name
 *
 * Structure §16 and the features matrix both call the last screen **Profile**. The plan calls the
 * route `/account/settings`. `AGENTS.md` ranks the plan above both, so the route is `settings` — and
 * the *label* is "Settings" too, because a nav item reading "Profile" that lands on `/settings` is
 * the kind of small mismatch that makes a customer wonder whether they clicked the wrong thing.
 *
 * ### "Mobile account navigation must remain simple" — §20.1d's only styling instruction
 *
 * Five items, one word each, no icons, no nesting, no drawer. On a phone it is a horizontal scroller
 * of five text links; on a desktop it is the same five links in a row. There is no second
 * arrangement to keep in step, which is the simplest reading of "simple".
 */

export type AccountRoute = {
  /** Short enough to sit in a row of five on a 320px screen. */
  label: string
  href: string
}

export const ACCOUNT_ROUTES: readonly AccountRoute[] = [
  { href: '/account', label: 'Overview' },
  { href: '/account/orders', label: 'Orders' },
  { href: '/account/wishlist', label: 'Wishlist' },
  { href: '/account/addresses', label: 'Addresses' },
  { href: '/account/settings', label: 'Settings' },
]

/**
 * Which nav item to mark current.
 *
 * `/account` is a prefix of every other route, so a naive `startsWith` would mark Overview current on
 * every screen. Overview matches exactly; everything else matches its own subtree, so
 * `/account/orders/N1-2609-ABC` still marks Orders.
 */
export function isCurrentAccountRoute(href: string, pathname: string): boolean {
  if (href === '/account') {
    return pathname === '/account'
  }

  return pathname === href || pathname.startsWith(`${href}/`)
}
