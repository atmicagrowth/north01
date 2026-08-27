import path from 'path'
import { fileURLToPath } from 'url'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig } from 'payload'

import { schemaPush, serverEnv } from './lib/env.core'
import { SchemaProbes } from './payload/collections/SchemaProbes'
import { Users } from './payload/collections/Users'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/**
 * Importing the environment module here is what makes plan §4.1b's "fail at build time" true.
 *
 * This config is reached through four static imports of `@payload-config` in `(payload)/`, so
 * `next build` evaluates it while collecting page data - a throw inside it fails the build with
 * a non-zero exit code, before anything is deployed. Nothing else in the app has that property:
 * `instrumentation.ts` is skipped during builds, and route modules are not evaluated then either.
 *
 * The relative import is deliberate, matching `./payload/collections/Users` below. This file is
 * loaded by three different loaders - Turbopack, the Next server, and tsx for the `payload` CLI -
 * and a relative specifier needs none of them to resolve a tsconfig path alias.
 */

/**
 * Payload runs embedded inside this Next.js application - one deployable, not a separate
 * backend. See docs/ARCHITECTURE.md.
 *
 * Deliberately absent at Phase 2, and added by the phase that needs them:
 *   - `editor`  (@payloadcms/richtext-lexical) - Phase 6, once rich-text fields exist
 *   - `sharp`                                  - Phase 8, with the media collection
 *   - storage / plugins                        - Phase 8 onward
 * No GraphQL API surface is exposed; see deviation DEV-04.
 */
export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: '· NORTH / 01',
    },
  },

  collections: [Users, SchemaProbes],

  db: postgresAdapter({
    pool: {
      connectionString: serverEnv.DATABASE_URL,

      /**
       * Pool limits are per *process*, not per deployment. One `next dev` is one pool; a Vercel
       * deployment is one pool per warm function instance, multiplied by however many of those
       * exist. Ten is `pg`'s own default, restated here because the number only makes sense
       * alongside the endpoint choice: production connects through Neon's pooled (`-pooler`)
       * endpoint, which fronts the compute with PgBouncer, so instances multiply client
       * connections to the pooler rather than backend connections to Postgres. Local development
       * uses the direct endpoint, where ten is one process's whole appetite.
       * See docs/DATABASE.md.
       */
      max: 10,

      /**
       * Return an idle connection after 30s. Neon scales an idle compute to zero after a few
       * minutes, and holding a connection open across that boundary is how you get a socket that
       * looks alive and is not. Releasing first means the next request opens a new one and pays a
       * cold start, which is the failure mode that recovers by itself.
       */
      idleTimeoutMillis: 30_000,

      /**
       * **The one that is not a default.** `pg`'s default is `0` — wait forever. Against a
       * suspended or unreachable Neon compute that turns a dead database into a hung request:
       * no error, no log line, nothing to alert on, until the platform's own timeout ends it far
       * from the cause. Fifteen seconds is well clear of a Neon cold start (sub-second, and
       * seconds in the worst case) and well inside Vercel's function limit, so what surfaces is
       * a named connection error rather than a timeout with no subject.
       */
      connectionTimeoutMillis: 15_000,
    },
    // Plan §5.1d: Drizzle's push workflow for the development sandbox, committed
    // migrations for every other environment.
    //
    // The condition is `schemaPush.allowed` rather than a NODE_ENV test because being in
    // development is not on its own a safe reason to rewrite a schema - the database the
    // connection string happens to point at also has to be the one push is authorised for.
    // That is decision D-10, and `resolveSchemaPush` in lib/env.core.ts is where it lives.
    //
    // Keep this an explicit boolean. The adapter's own gate is `this.push !== false`, so an
    // `undefined` here would fail open and push anyway.
    push: schemaPush.allowed,

    // The guard above governs push. This closes the other accidental DDL path the adapter has:
    // when a connection fails because the database does not exist, it issues a real CREATE
    // DATABASE and carries on. For an online-only storefront whose databases are provisioned in
    // the Neon console, that turns a typo in DATABASE_URL into a silently-created empty database
    // rather than an error. Defaults to false, so it has to be said.
    disableCreateDatabase: true,

    migrationDir: path.resolve(dirname, 'payload/migrations'),
  }),

  // Payload signs and encrypts with this. Server-only; must never be exposed.
  secret: serverEnv.PAYLOAD_SECRET,

  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },

  /**
   * **Keep the process alive when Postgres drops a connection** — plan §5.1's "app survives
   * database restart/reconnect", and the "database sleeps / cold starts" edge case.
   *
   * The adapter attaches an `error` listener to exactly one client: the one it takes from the
   * pool at startup to prove connectivity. Every other client is bare. When one of those dies
   * while idle — Neon suspending the compute, a `pg_terminate_backend`, a network drop —
   * `pg-pool` removes it and re-emits on the *pool*, and an `error` event with no listener is
   * the one event Node turns into a throw. Measured, not assumed: terminating the backends of
   * a running server produced `uncaughtException: terminating connection due to administrator
   * command`. `next dev` installs its own handler and survives that; a production server has no
   * such safety net, and an idle Neon compute is not an unusual event to crash on.
   *
   * A dropped idle connection is not an application failure. `pg` has already discarded the
   * client and the next request opens a fresh one, which is exactly what happened in the test
   * — both requests after the kill returned 200. So this logs and continues; the recovery is
   * the pool's, and the only thing missing was somewhere for the event to land.
   *
   * `onInit` is the earliest place with a pool to attach to: `payload.init()` calls
   * `db.connect()` before it, so `pool` exists here and does not exist before. The
   * listener-count guard is for `next dev`'s hot reload, which re-runs `onInit` against the
   * same retained pool and would otherwise stack a new listener on every edit.
   */
  onInit: (payload) => {
    // `db` above is `postgresAdapter`, so this *is* a PostgresAdapter at runtime.
    // `payload.db` is declared as the database-agnostic interface, which has no `pool`
    // and no overlap with the concrete type, so TypeScript requires the assertion to go through
    // `unknown`. The alternative — a hand-written structural type for the two methods used —
    // would compile without complaint and stop matching the adapter the moment it changed.
    const { pool } = payload.db as unknown as PostgresAdapter

    if (pool && pool.listenerCount('error') === 0) {
      pool.on('error', (err) => {
        payload.logger.error({
          err,
          msg: 'Postgres pool client error. The connection was discarded; the next query opens a new one.',
        })
      })
    }
  },
})
