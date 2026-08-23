import path from 'path'
import { fileURLToPath } from 'url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig } from 'payload'

import { Users } from './payload/collections/Users'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

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
      connectionString: process.env.DATABASE_URL || '',
    },
    // Plan §5.1d: Drizzle's push workflow for the development sandbox, committed
    // migrations for every other environment. Stated explicitly rather than left to the
    // adapter default so the condition is visible.
    //
    // HAZARD: push rewrites whatever schema DATABASE_URL points at. `pnpm dev` against a
    // non-development database would alter it. Phase 4 owns the environment guard.
    push: process.env.NODE_ENV === 'development',
    migrationDir: path.resolve(dirname, 'payload/migrations'),
  }),

  // Payload signs and encrypts with this. It is server-only and must never be exposed.
  // Formal environment validation arrives in Phase 4.
  secret: process.env.PAYLOAD_SECRET || '',

  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
