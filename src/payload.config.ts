import path from 'path'
import { fileURLToPath } from 'url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig } from 'payload'

import { schemaPush, serverEnv } from './lib/env.core'
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

  collections: [Users],

  db: postgresAdapter({
    pool: {
      connectionString: serverEnv.DATABASE_URL,
    },
    // Plan §5.1d: Drizzle's push workflow for the development sandbox, committed
    // migrations for every other environment.
    //
    // The condition is `schemaPush.allowed` rather than a NODE_ENV test because being in
    // development is not on its own a safe reason to rewrite a schema - the database the
    // connection string happens to point at also has to be the one push is authorised for.
    // That is decision D-10, and `resolveSchemaPush` in lib/env.server.ts is where it lives.
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
})
