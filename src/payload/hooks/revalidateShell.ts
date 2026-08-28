import type { GlobalAfterChangeHook } from 'payload'

/**
 * **The line between "an editor saved the navigation" and "a visitor sees it."**
 *
 * `lib/navigation/shell.ts` caches the two globals in Next's data cache under tags, so that a
 * storefront page is not two database round trips. Without this hook that cache would only expire on
 * its 300-second timer, and *"real CMS editing"* — one of the outcomes the plan's master directive
 * names — would mean "editing, then waiting."
 *
 * ### Three things this has to survive, and how
 *
 * **1. It runs outside Next.** `payload run scripts/seed.ts` writes both globals from a CLI process
 * where there is no Next server and no cache to invalidate. `next/cache` is therefore imported
 * *dynamically, inside the try*, so the module is never even resolved on that path — a static import
 * would be evaluated when `payload.config.ts` loads, which is every CLI command and every migration.
 *
 * **2. A failed revalidation must not fail the save.** The write has already committed by the time
 * an `afterChange` hook runs; throwing here would report failure for a change that happened, which
 * is the same defect Phase 6 found in the derived-sync hooks, in the opposite direction. So this
 * warns and returns.
 *
 * **3. The two-argument signature is the current one.** `revalidateTag(tag)` alone is deprecated in
 * Next 16 — see `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md`.
 * `'max'` gives stale-while-revalidate: the next visitor is served the cached shell and the fresh
 * one is fetched behind them, so an editor's save never puts a database read in a customer's
 * critical path. `updateTag`, which would expire it immediately, is Server-Actions-only and the
 * admin panel saves through a Route Handler.
 */
export const revalidateShell =
  (...tags: string[]): GlobalAfterChangeHook =>
  async ({ doc, req }) => {
    try {
      const { revalidateTag } = await import('next/cache')

      for (const tag of tags) {
        revalidateTag(tag, 'max')
      }
    } catch (error) {
      req.payload.logger.warn(
        { err: error, tags },
        'Global saved, but the storefront shell cache was not revalidated. It will refresh on its own within five minutes.',
      )
    }

    return doc
  }
