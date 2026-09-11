/**
 * **A handled failure, sent to Sentry as well as the log** — Phase 36, audit R3-13.
 *
 * Every failure the application *handles* — a Stripe call that failed, a webhook that could not be
 * applied, an oversold order, a catalogue read that fell back — was written to `payload.logger` or
 * `console.error` and nowhere else. Only the two error boundaries reached Sentry, so the failures that
 * matter most to a shop were the ones nobody would be told about. Call this beside the existing log
 * line; it never replaces it.
 *
 * - **No DSN, no SDK.** The same guard `error.tsx` and `global-error.tsx` use: without
 *   `NEXT_PUBLIC_SENTRY_DSN` the SDK is never imported, so a local run or a `payload run` script pays
 *   nothing.
 * - **Redaction is Sentry's `beforeSend`** (`sentry-options.ts`), which every event passes through —
 *   so `context` may name ids, never personal data or tokens, and it is scrubbed regardless.
 * - **Never throws and is never awaited by a caller that must not wait.** Reporting a failure must not
 *   become a second failure, or delay the response to a customer or to Stripe.
 */
export function reportFailure(
  error: unknown,
  area: string,
  context: Record<string, boolean | null | number | string | undefined> = {},
): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return

  void import('@sentry/nextjs')
    .then((sdk) =>
      sdk.captureException(error instanceof Error ? error : new Error(String(error)), {
        extra: context,
        tags: { area },
      }),
    )
    .catch(() => {})
}
