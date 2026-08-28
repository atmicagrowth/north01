import 'server-only'

import { unstable_cache } from 'next/cache'
import { cache } from 'react'

import { FALLBACK_NAVIGATION } from '@/lib/navigation/fallback'
import {
  FALLBACK_SITE_NAME,
  resolveNavigation,
  resolveSettings,
  type ShellNavigation,
  type ShellSettings,
} from '@/lib/navigation/resolve'
import { getPayloadClient } from '@/lib/payload'

/**
 * **The one read that the global shell performs.**
 *
 * Plan §9.1a: *"Use Payload site settings where content should be editable."* The header's wordmark
 * and announcement come from `site-settings`; its navigation, mega menus and footer columns come
 * from `navigation`. Both are globals, both are public-read, and both are fetched here — once per
 * request, for the whole page.
 *
 * This module is a *loader*, and nothing else. Every rule about what a resolved navigation looks
 * like lives in `resolve.ts`, which imports nothing from Next and nothing from the server, so
 * `scripts/verify-shell.ts` can exercise all of it outside a request. What is left here is caching,
 * and caching is the one thing that cannot be unit-tested from a CLI.
 *
 * ### Two caches, doing two different jobs
 *
 * - **`cache()`** — React's per-render memo. The layout, the header and the footer all need this in
 *   one pass; without it they would each issue their own pair of queries.
 * - **`unstable_cache`** — Next's cross-request data cache, which is what stops every visitor paying
 *   for two global reads. It carries **tags**, and `payload/hooks/revalidateShell.ts` calls
 *   `revalidateTag` when either global is saved, so an editor's change reaches the storefront on the
 *   next request rather than on the next deployment. The 300-second `revalidate` is the floor under
 *   that: if a tag call is ever missed — a write from a script, a direct SQL edit — the shell is
 *   still no more than five minutes stale.
 *
 * `cacheComponents` is not enabled in `next.config.mjs`, so this is Next 16's previous caching model
 * (`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`). If a later
 * phase turns Cache Components on, this becomes `"use cache"` plus `cacheLife`/`cacheTag` and the
 * shape of the module does not otherwise change.
 *
 * ### Failure is a fallback, and it is not cached
 *
 * The `try` is around the *call*, not inside the cached function, and that placement is the point: a
 * function that throws stores nothing, so a database blip degrades one request rather than pinning
 * the degraded header in the data cache for five minutes. See `fallback.ts` for what the degraded
 * header contains and why it contains no merchandising.
 */

export const SHELL_CACHE_TAG = 'shell'
export const NAVIGATION_CACHE_TAG = 'navigation'
export const SITE_SETTINGS_CACHE_TAG = 'site-settings'

export type Shell = {
  navigation: ShellNavigation
  settings: ShellSettings
  /**
   * The globals could not be read and `fallback.ts` is what is being rendered.
   *
   * Never rendered into the page. It exists so that a caller — or a verification pass — can tell the
   * degraded shell from a shell an editor simply emptied, which look identical on screen.
   */
  degraded: boolean
}

const FALLBACK_SETTINGS: ShellSettings = {
  siteName: FALLBACK_SITE_NAME,
  tagline: null,
  logo: null,
  announcement: null,
}

/**
 * `depth: 1` — one hop, which is exactly what this needs and no more.
 *
 * Navigation references have to be populated or there is no slug to build a URL from and no status
 * to test, and the featured panel's image and the logo have to be populated or `MediaImage` has an
 * id rather than an asset. Nothing here reads a *second* hop — a category's parent, a product's
 * variants — so a deeper query would only be a bigger one.
 */
const loadShell = unstable_cache(
  async (): Promise<Omit<Shell, 'degraded'>> => {
    const payload = await getPayloadClient()

    const [navigation, settings] = await Promise.all([
      payload.findGlobal({ slug: 'navigation', depth: 1 }),
      payload.findGlobal({ slug: 'site-settings', depth: 1 }),
    ])

    return { navigation: resolveNavigation(navigation), settings: resolveSettings(settings) }
  },
  ['north01-shell'],
  { tags: [SHELL_CACHE_TAG, NAVIGATION_CACHE_TAG, SITE_SETTINGS_CACHE_TAG], revalidate: 300 },
)

/** The navigation, identity and announcement the header and footer render. Never throws. */
export const getShell = cache(async (): Promise<Shell> => {
  try {
    return { ...(await loadShell()), degraded: false }
  } catch (error) {
    /*
     * Logged, not swallowed. A header that quietly degrades is the right behaviour for a visitor and
     * the wrong behaviour for an operator: the difference between "the CMS is down" and "the editor
     * emptied the navigation" is invisible on the page and obvious in a log line.
     */
    console.error(
      '[shell] Falling back to static navigation — the globals could not be read.',
      error,
    )

    return { navigation: FALLBACK_NAVIGATION, settings: FALLBACK_SETTINGS, degraded: true }
  }
})
