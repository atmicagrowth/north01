import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  GlobalAfterChangeHook,
} from 'payload'
import type { PayloadRequest } from 'payload'

/**
 * **The line between "an editor saved something" and "a visitor sees it."**
 *
 * `lib/navigation/shell.ts` and `lib/home/home.ts` both cache their reads in Next's data cache under
 * tags, so that a storefront page is not a handful of database round trips per visitor. Without
 * these hooks those caches would only expire on their 300-second timers, and *"real CMS editing"* —
 * one of the outcomes the plan's master directive names — would mean "editing, then waiting."
 *
 * ### Three things this has to survive, and how
 *
 * **1. It runs outside Next.** `payload run scripts/seed.ts` writes globals from a CLI process where
 * there is no Next server and no cache to invalidate. `next/cache` is therefore imported
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
 * `'max'` gives stale-while-revalidate: the **next** request is served the cached page while the
 * fresh one is fetched behind it, so an editor's save never puts a database read in a customer's
 * critical path — and so a change appears on the request *after* the save, not the one immediately
 * following it. `updateTag`, which would expire it immediately, is Server-Actions-only and throws
 * outside one; the admin panel saves through a Route Handler.
 *
 * ---
 *
 * ### Why this file is `revalidateTags.ts` and not `revalidateShell.ts`
 *
 * It was named after its first caller and has always been a generic variadic tag factory. Phase 10
 * needed the identical body for a *collection* hook, and the honest fix was to correct the name
 * rather than add `revalidateHomepage` beside a `revalidateShell` that revalidates whatever it is
 * given. Three factories, one private body.
 */

const revalidate = async (tags: string[], req: PayloadRequest): Promise<void> => {
  try {
    const { revalidateTag } = await import('next/cache')

    for (const tag of tags) {
      revalidateTag(tag, 'max')
    }
  } catch (error) {
    req.payload.logger.warn(
      { err: error, tags },
      'Saved, but the storefront cache was not revalidated. It will refresh on its own within five minutes.',
    )
  }
}

/** For a global's `hooks.afterChange` — `site-settings`, `navigation`, `homepage`. */
export const revalidateGlobal =
  (...tags: string[]): GlobalAfterChangeHook =>
  async ({ doc, req }) => {
    await revalidate(tags, req)

    return doc
  }

/**
 * For a collection's `hooks.afterChange`.
 *
 * Used by `campaigns`, because the campaign *is* the homepage hero and a five-minute delay on the
 * largest statement on the site is not acceptable. Deliberately **not** used by `products`: a
 * product save fires on every variant change through `syncProductDerived`, and the homepage's
 * product rails are a 300-second-stale merchandising surface by design — the same contract the shell
 * already ships. Phase 11 owns the listing pages that make a tighter guarantee worth paying for.
 */
export const revalidateCollection =
  (...tags: string[]): CollectionAfterChangeHook =>
  async ({ doc, req }) => {
    await revalidate(tags, req)

    return doc
  }

/**
 * For a collection's `hooks.afterDelete`.
 *
 * Deleting the campaign a homepage hero points at changes the page — the hero is dropped — and no
 * `afterChange` fires for it.
 */
export const revalidateCollectionDelete =
  (...tags: string[]): CollectionAfterDeleteHook =>
  async ({ doc, req }) => {
    await revalidate(tags, req)

    return doc
  }
