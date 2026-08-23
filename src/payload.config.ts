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
    // Drizzle's dev-mode schema push is disabled: the plan requires explicit, reviewable
    // migrations as the only way schema reaches a database. See Phase 5 (§5.1c).
    push: false,
    migrationDir: path.resolve(dirname, 'payload/migrations'),
  }),

  // Payload signs and encrypts with this. It is server-only and must never be exposed.
  // Formal environment validation arrives in Phase 4.
  secret: process.env.PAYLOAD_SECRET || '',

  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
