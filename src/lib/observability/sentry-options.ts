import { redact, redactEvent, redactString, type ScrubbableEvent } from './redact'

/**
 * **The Sentry options every runtime shares** — plan §25.1d.
 *
 * Three inits (browser, Node, edge) that must agree about privacy, sampling and what counts as
 * noise. Written once so they cannot drift, because a rule enforced in two of three runtimes is a
 * rule that leaks from the third.
 *
 * No `server-only` guard: this is imported by the **browser** config too. Nothing here reads the
 * environment — the DSN and the release are passed in — so there is nothing to leak.
 */

export type SentryOptionsInput = {
  dsn: string
  environment: string
  /** Traces are off by default. §25.1e defers performance measurement, and §25.1d asks for errors. */
  tracesSampleRate?: number
}

/**
 * Errors that are **not** defects, and would otherwise dominate the issue list.
 *
 * Each of these is a browser or a network telling us about itself:
 *
 * - `ResizeObserver loop…` — fired by the spec's own loop-limit guard. Benign, and Chrome emits it
 *   in quantity.
 * - `AbortError` / `The operation was aborted` — a navigation that cancelled a fetch. That is a
 *   customer clicking a link, and every route transition in this shop can produce one.
 * - `NetworkError` / `Failed to fetch` / `Load failed` — a connection that dropped. Real, and not
 *   actionable: it says a phone went through a tunnel.
 * - `Non-Error promise rejection captured` — Sentry's own wrapper around a rejection whose reason is
 *   not an `Error`, usually from a third-party script.
 *
 * Filtering by message is crude and it is the mechanism Sentry provides. The list is short and every
 * entry is justified above, which is the discipline that keeps it from becoming a place where real
 * failures are quietly buried.
 */
export const IGNORED_ERRORS: readonly (RegExp | string)[] = [
  'AbortError',
  'Failed to fetch',
  'Load failed',
  'NetworkError',
  'Non-Error promise rejection captured',
  'The operation was aborted',
  /^ResizeObserver loop/,
]

/**
 * The shared init options.
 *
 * `sendDefaultPii` is **`false`**, which is also the SDK default and is restated here because it is a
 * §25.1d requirement rather than a preference: with it on, the SDK attaches IP addresses, request
 * cookies and headers by itself, before `beforeSend` ever runs on anything the application chose to
 * add. Turning it off is the first line of the redaction, and `redactEvent` is the second.
 *
 * `beforeSend` runs on **every** event, so it is the one place §25.1d can actually be enforced.
 */
export function sentryOptions(input: SentryOptionsInput) {
  return {
    /*
     * Generic rather than typed to Sentry's `ErrorEvent`, so the SDK's own event type flows through
     * unchanged. `redact.ts` deliberately does not import Sentry's types — see its docblock — and
     * this is where the two meet without either giving up what it knows.
     */
    beforeSend: <T extends ScrubbableEvent>(event: T): T => redactEvent(event),

    /*
     * Breadcrumbs are the richest accidental source of secrets in an error report: a `fetch`
     * breadcrumb carries the URL, and a URL is where a reset token lives. They are scrubbed by
     * `beforeSend` along with everything else, and this hook scrubs them individually as well so
     * that a breadcrumb attached to an event that is never sent is still clean in the buffer.
     */
    beforeBreadcrumb: <T extends { data?: Record<string, unknown>; message?: string }>(
      breadcrumb: T,
    ): T => ({
      ...breadcrumb,
      ...(breadcrumb.data === undefined
        ? {}
        : { data: redact(breadcrumb.data) as Record<string, unknown> }),
      /*
       * The message as well as the data. A `console` breadcrumb's message is whatever was logged,
       * and the first version scrubbed only `data` while claiming the buffer was clean.
       */
      ...(typeof breadcrumb.message === 'string'
        ? { message: redactString(breadcrumb.message) }
        : {}),
    }),

    dsn: input.dsn,
    environment: input.environment,
    ignoreErrors: [...IGNORED_ERRORS],
    sendDefaultPii: false,
    tracesSampleRate: input.tracesSampleRate ?? 0,
  }
}
