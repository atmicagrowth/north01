/**
 * **`server-only`, for the Payload CLI — and for nothing else.**
 *
 * `server-only` is not an installed package. Next aliases the bare specifier inside its own bundler
 * to a module that throws when it is compiled into a client bundle, and that alias exists nowhere
 * outside Next. So every other loader fails to resolve it at all: `payload.config.ts` may not import
 * a guarded module (Phase 19 measured the `ERR_MODULE_NOT_FOUND`), Vitest needed an alias of its own,
 * and — found in Phase 29, when the development branch finally let them run — `verify:lookbook` and
 * `verify:editorial` could not start, because both import the storefront read layer.
 *
 * This is a `tsconfig.json` `paths` entry, which is what `tsx` resolves through, and it is empty on
 * purpose.
 *
 * ### Why this does not weaken the guard
 *
 * The guard's job is to fail a **Next build** that would ship a server module to a browser. Next's
 * own alias is applied by its bundler and takes precedence over `tsconfig` paths for the application
 * graph, so a client component importing `@/lib/env.server` still fails the build with the import
 * chain named. **Verified rather than assumed**: a client component importing the server environment
 * was added temporarily and `pnpm build` refused it with this entry in place.
 *
 * What changes is only what a CLI process sees, and a CLI process is server code by definition —
 * there is no browser bundle for it to leak into.
 *
 * The real `server-only` package is deliberately NOT installed. Its `exports` map resolves to a
 * throwing `index.js` under everything except the `react-server` condition, so installing it would
 * make the CLI throw rather than resolve — the opposite of what is needed here.
 */
export {}
