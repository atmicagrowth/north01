import * as Sentry from '@sentry/nextjs'

import { sentryOptions } from '@/lib/observability/sentry-options'

/**
 * **Plan §25.1d, on the server** — *"server exceptions"*, *"integration failures"*, *"checkout
 * failures"*.
 *
 * Imported by `instrumentation.ts`'s `register()` rather than picked up by filename, so the import
 * chain is visible: this file is Node-only and must not be pulled into the edge compilation, and the
 * dynamic import in `register()` is what guarantees it is not.
 *
 * The DSN is read through `env.server`, which validates it. The same variable serves the browser —
 * a Sentry DSN is a public write-only endpoint by design, which is why it carries the
 * `NEXT_PUBLIC_` prefix and why using one value for both is correct rather than lazy.
 */
export async function initSentryServer(): Promise<void> {
  const { appEnv, serverEnv } = await import('@/lib/env.server')

  if (!serverEnv.NEXT_PUBLIC_SENTRY_DSN) {
    return
  }

  Sentry.init(sentryOptions({ dsn: serverEnv.NEXT_PUBLIC_SENTRY_DSN, environment: appEnv }))
}
