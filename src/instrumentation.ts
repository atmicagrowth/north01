/**
 * Startup-time environment validation (plan §4.1b, "fail clearly at startup/build time").
 *
 * `payload.config.ts` already covers the *build*: it is statically imported by the `(payload)`
 * route group, so `next build` evaluates it and a bad environment fails the build. What it does
 * not cover is a server that starts with a bad environment — the config is evaluated lazily, on
 * the first request that loads a route importing it, so `next start` boots cleanly and the
 * storefront keeps serving while `/admin` and `/api/*` return 500 per request. That is a broken
 * deployment reporting itself as healthy.
 *
 * `register()` runs once per server process, at startup, in `next dev` and `next start` alike.
 * Importing the environment module here turns that silent half-failure into a loud total one.
 *
 * **What it actually does, measured.** A throw here does not exit the process — Next logs
 * `Failed to prepare server` and an `unhandledRejection`, and the server stays up. What changes
 * is that *every* route then returns HTTP 500, the prerendered storefront included, instead of
 * only `/admin` and `/api/*`. So a misconfigured deployment can no longer pass a health check
 * on `/` while its CMS and API are dead. The response body is a bare `Internal Server Error`
 * with no variable name in it, which is what §4.1b requires of a public response; the name
 * appears only in the server log, where it is the whole point.
 *
 * **It is not a build-time hook**, despite the common assumption: Next skips `register()` when
 * `NEXT_PHASE` is `phase-production-build`, including in the prerender workers. Build coverage
 * comes from `payload.config.ts` and nowhere else — do not move the validation here.
 */
export async function register(): Promise<void> {
  // `register()` is invoked for the edge runtime too. The environment module is server-side
  // Node code, and the secrets it validates are not present in — and must not be shipped to —
  // an edge bundle, so this deliberately runs in one runtime only.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Dynamic rather than static so the module is not pulled into the edge compilation at all.
  // The import itself is the assertion: the module validates on evaluation and throws.
  const { reportEnvironment } = await import('./lib/env.core')

  // Validation is silent when it succeeds. This is what prints the schema-push decision and any
  // half-configured integration, once per server rather than once per module evaluation — see
  // the note on `reportEnvironment` for why that distinction is not academic here.
  reportEnvironment()
}
