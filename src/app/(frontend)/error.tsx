'use client'

import { useEffect, useSyncExternalStore } from 'react'

import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section } from '@/components/layout/section'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'

/**
 * **Plan §31.1a's server error, network error and error fallback — inside the shop.**
 *
 * Until Phase 31 the only boundary was `global-error.tsx`, which replaces the root layout: a
 * database outage, or any server read that threw, turned the page into a bare "Something went
 * wrong" with no header, no navigation and no footer — the customer's bag, search and every way
 * back gone with it. This boundary sits inside `(frontend)/layout.tsx`, so the shell survives and
 * only the page that failed is replaced. `global-error.tsx` stays for the one case this cannot
 * catch: the layout itself failing.
 *
 * ### Offline is a different sentence
 *
 * A server action or a client navigation that fails because the device lost its connection lands
 * here too, and "something went wrong on our side" would be untrue. `navigator.onLine` is not proof
 * of connectivity, but `false` is reliable, and it is the case worth naming.
 *
 * ### Retry, not reset
 *
 * Next 16's `retry()` re-fetches and re-renders the segment; `reset()` only re-renders what already
 * failed, which for a server error changes nothing. A transient outage is exactly the case retry is
 * for.
 *
 * `noindex`: a crawler that arrives during an outage must not index the apology in place of the
 * page. The `<meta>` is hoisted into `<head>` by React.
 */
const subscribe = (notify: () => void) => {
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)

  return () => {
    window.removeEventListener('online', notify)
    window.removeEventListener('offline', notify)
  }
}

export default function FrontendError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )

  useEffect(() => {
    /* The same DSN-guarded dynamic import `global-error.tsx` uses: no DSN, no SDK. */
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return

    void import('@sentry/nextjs').then((sdk) => sdk.captureException(error))
  }, [error])

  return (
    <PageContainer width="narrow">
      <meta content="noindex" name="robots" />

      <Section spacing="loose" className="flex flex-col items-start gap-l">
        <PageTitle eyebrow={online ? 'Error' : 'Offline'} size="display-l">
          {online ? 'This page could not be shown.' : 'You appear to be offline.'}
        </PageTitle>

        <p className="max-w-measure font-sans text-body text-foreground-muted">
          {online
            ? 'Something went wrong on our side while loading it. Nothing you were doing has been lost, and your bag is kept. Try again in a moment, or carry on from the navigation above.'
            : 'Check your connection, then try again. Nothing you were doing has been lost, and your bag is kept.'}
        </p>

        {error.digest ? (
          <p className="font-sans text-meta text-foreground-muted">Reference {error.digest}</p>
        ) : null}

        <div className="flex flex-wrap gap-m">
          <Button onClick={() => retry()} variant="primary">
            Try again
          </Button>

          <Button asChild variant="secondary">
            <Link href="/" variant="unstyled">
              Home
            </Link>
          </Button>
        </div>
      </Section>
    </PageContainer>
  )
}
