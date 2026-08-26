import 'server-only'

/**
 * The server-only environment. **This is the module application code imports.**
 *
 * It is `env.core.ts` plus one line, and that line is the whole point: `server-only` resolves to a
 * module that throws unless the importer is compiled in the React Server Components graph, so a
 * client component that imports this **fails the build**, naming the offending import chain:
 *
 * ```text
 * Error: You're importing a module that depends on "server-only".
 *   Client Component Browser:
 *     ./src/lib/env.server.ts [Client Component Browser]
 *     ./src/app/(frontend)/some-component.tsx [Client Component Browser]
 * ```
 *
 * That is a real guard, and it is why the split exists. The `typeof window` check in `env.core.ts` is
 * only a runtime backstop: it cannot fire during a build, because prerendering runs on the server
 * where `window` is undefined — so without this file a client component could import the environment,
 * build cleanly, and ship a secret inside prerendered HTML. Measured, before it was fixed.
 *
 * **Why `env.core.ts` exists at all.** `server-only` is not an installed package; Next aliases the
 * bare specifier to a vendored copy, and that alias exists only inside Next's bundler. The `payload`
 * CLI loads `payload.config.ts` through tsx, outside Next, where this import fails to resolve at all
 * (`ERR_MODULE_NOT_FOUND`, verified). So `payload.config.ts` — and only `payload.config.ts` — imports
 * the unguarded core directly.
 *
 * Client code imports `env.public.ts`, which is a different tier, not a workaround for this one.
 */
export * from './env.core'
