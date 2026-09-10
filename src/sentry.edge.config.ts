import * as Sentry from '@sentry/nextjs'

import { publicAppEnv, publicEnv } from '@/lib/env.public'
import { sentryOptions } from '@/lib/observability/sentry-options'

/**
 * **Plan §25.1d in the edge runtime**, which is a third place errors happen and was initially left
 * out.
 *
 * `src/proxy.ts` is middleware, and middleware runs on the edge. It guards `/account` — so a failure
 * in it redirects a signed-in customer to a login page they do not need, or lets an unauthenticated
 * request through, and neither of those was being reported. `onRequestError` was calling
 * `captureRequestError` in a runtime with no initialised client, which is a silent no-op rather than
 * an error: exactly the shape this project keeps finding.
 *
 * ### The environment is read from the **public** module, not `env.server`
 *
 * `env.server` is Node code that validates secrets, and `instrumentation.ts` already refuses to load
 * it outside the Node runtime for that reason — *"the secrets it validates are not present in, and
 * must not be shipped to, an edge bundle."* A DSN is public by design, and `publicAppEnv()` resolves
 * the same three environments from a variable Vercel exposes to the browser. So the edge gets its
 * configuration from the tier that is safe to bundle for it.
 */
export function initSentryEdge(): void {
  if (!publicEnv.NEXT_PUBLIC_SENTRY_DSN) {
    return
  }

  Sentry.init(
    sentryOptions({
      dsn: publicEnv.NEXT_PUBLIC_SENTRY_DSN,
      environment: publicAppEnv(),
    }),
  )
}
