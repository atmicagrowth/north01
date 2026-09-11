import { publicAppEnv } from '@/lib/env.public'
import { sentryOptions } from '@/lib/observability/sentry-options'

/**
 * **Plan §25.1d, in the browser** — *"unexpected client exceptions"*.
 *
 * Next runs this file before hydration, on every page, which is why the DSN check comes first: with
 * no `NEXT_PUBLIC_SENTRY_DSN` nothing is initialised, nothing is captured, and a local checkout is not
 * talking to a service nobody configured.
 *
 * `onRouterTransitionStart` is exported because Next asks for it: it is how the SDK knows a
 * client-side navigation began, which is what turns *"an error on some page"* into *"an error on the
 * bag page, arrived at from the product page"*.
 *
 * ### The SDK is loaded only when there is somewhere to send what it catches
 *
 * This file used to `import * as Sentry from '@sentry/nextjs'` at the top and check the DSN
 * afterwards. The check decided whether `init` ran; it did not decide whether the SDK was
 * *downloaded*. Phase 30 measured it on every storefront route with no DSN configured: about
 * **58 KB gzip** of Sentry, requested and evaluated before hydration, to do nothing — against the
 * rule `analytics.tsx` already states for every other third party, *"not configured means not
 * loaded"*.
 *
 * The test is the literal `process.env.NEXT_PUBLIC_SENTRY_DSN`, which Next substitutes at build time.
 * With no DSN the branch is `if (undefined)`, and the only reference to `@sentry/nextjs` in the
 * browser graph is inside a branch that cannot run — so its chunk is never requested.
 *
 * **What a configured deployment gives up, stated rather than hidden:** the SDK now arrives as an
 * async chunk requested immediately, rather than parsed synchronously before hydration, so an
 * exception thrown in the first few milliseconds — before that chunk resolves — is not captured.
 * `global-error.tsx` and `onRequestError` still cover the failures that matter most (a root layout
 * that throws, a server render that fails). If that window turns out to matter in production, the
 * eager import is one line to restore — for a deployment that actually has a DSN.
 */

type Sentry = typeof import('@sentry/nextjs')

let captureTransition: Sentry['captureRouterTransitionStart'] | undefined

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  void import('@sentry/nextjs').then((sdk) => {
    sdk.init(
      sentryOptions({
        dsn,
        /*
         * `publicAppEnv()`, **not** `NODE_ENV`. Every built deployment has `NODE_ENV === 'production'`,
         * so a preview's browser errors were landing in the production Sentry environment beside real
         * ones — while the same deployment's *server* errors, which read `VERCEL_ENV`, landed in
         * `preview`. One deployment, split across two environments, with the halves that mattered in
         * the wrong one.
         */
        environment: publicAppEnv(),
      }),
    )

    captureTransition = sdk.captureRouterTransitionStart
  })
}

export function onRouterTransitionStart(
  ...args: Parameters<Sentry['captureRouterTransitionStart']>
): void {
  captureTransition?.(...args)
}
