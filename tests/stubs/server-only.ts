/**
 * `server-only` under Vitest.
 *
 * Next aliases the bare specifier to a module that throws when compiled into a client bundle. That
 * alias exists only inside Next's bundler, so every other loader — the Payload CLI, and now Vitest —
 * fails to resolve it at all. `vitest.config.ts` points the specifier here.
 *
 * **This is not a way around the guard.** The guard's job is to fail a *build* that would ship a
 * secret to a browser, and it still does: this file is never part of a Next compilation. What it
 * buys is that a component test can import a component whose import graph happens to reach a guarded
 * module, which is otherwise an unresolvable specifier and not a test failure worth having.
 */
export {}
