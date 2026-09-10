import * as Sentry from '@sentry/nextjs'

import { publicEnv } from '@/lib/env.public'
import { sentryOptions } from '@/lib/observability/sentry-options'

/**
 * **Plan §25.1d, in the browser** — *"unexpected client exceptions"*.
 *
 * Next runs this file before hydration, on every page, which is why the DSN check comes first: with
 * no `NEXT_PUBLIC_SENTRY_DSN` the SDK is initialised with nothing and captures nothing, and a local
 * checkout is not talking to a service nobody configured.
 *
 * `onRouterTransitionStart` is exported because Next asks for it: it is how the SDK knows a
 * client-side navigation began, which is what turns *"an error on some page"* into *"an error on the
 * bag page, arrived at from the product page"*.
 */
if (publicEnv.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init(
    sentryOptions({
      dsn: publicEnv.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
    }),
  )
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
