'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

/**
 * **Plan §25.1d — the last error boundary, and the only one that can report a broken layout.**
 *
 * `global-error.tsx` replaces the **entire** document when a root layout or a root-level render
 * throws. Nothing above it survives, which is why it renders its own `<html>` and `<body>`: at this
 * point the storefront shell is exactly what failed.
 *
 * It is also the only boundary that sees those failures at all. `onRequestError` in
 * `instrumentation.ts` catches server render errors; `instrumentation-client.ts` catches unhandled
 * browser exceptions; a component-level `error.tsx` catches its own subtree. A root layout throwing
 * during hydration falls through all three, and lands here.
 *
 * ### The copy says nothing about the error
 *
 * `error.message` is not rendered, and `error.digest` is the only identifier shown. A message
 * produced on the server can carry a table name, a query fragment or an environment variable name —
 * §4.1b already forbids putting one in a public response, and a client error boundary is a public
 * response. The digest is the safe half of the pair: it is meaningless to a stranger and it is the
 * exact key an operator greps for in the log.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          alignItems: 'center',
          backgroundColor: '#faf9f7',
          color: '#1c1b19',
          display: 'flex',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          justifyContent: 'center',
          margin: 0,
          minHeight: '100vh',
          padding: '2rem',
        }}
      >
        {/*
          Inline styles, deliberately. The stylesheet is loaded by the layout that just failed, so a
          class name here would be a class name with no rule behind it — an unstyled error page is
          the one thing worse than a plain one.
        */}
        <main style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 400, letterSpacing: '-0.01em', margin: 0 }}>
            Something went wrong
          </h1>

          <p style={{ color: '#6b6862', lineHeight: 1.6, marginTop: '1rem' }}>
            The page could not be displayed. Nothing you were doing has been lost.
          </p>

          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'center',
              marginTop: '2rem',
            }}
          >
            <button
              onClick={reset}
              style={{
                backgroundColor: '#1c1b19',
                border: 'none',
                color: '#faf9f7',
                cursor: 'pointer',
                font: 'inherit',
                letterSpacing: '0.08em',
                padding: '0.85rem 1.75rem',
                textTransform: 'uppercase',
              }}
              type="button"
            >
              Try again
            </button>

            {/*
              **A real `<a>`, and the Next lint rule is suppressed with the reason written out.**

              `@next/next/no-html-link-for-pages` wants `next/link`, whose whole value is a *soft*
              navigation — and a soft navigation is exactly wrong here. This boundary renders
              because the root layout threw; re-entering the router would mount the same tree that
              just failed, most likely straight back into this page. A full document load is the
              only thing that reliably gets a customer out.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                border: '1px solid #d9d5cd',
                color: 'inherit',
                font: 'inherit',
                letterSpacing: '0.08em',
                padding: '0.85rem 1.75rem',
                textDecoration: 'none',
                textTransform: 'uppercase',
              }}
            >
              Home
            </a>
          </div>

          {error.digest ? (
            <p style={{ color: '#9a968e', fontSize: '0.75rem', marginTop: '2rem' }}>
              Reference {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  )
}
