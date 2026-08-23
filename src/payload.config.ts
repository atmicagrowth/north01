import path from 'path'
import { fileURLToPath } from 'url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig } from 'payload'

import { Users } from './payload/collections/Users'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/**
 * Plan §4.1b: a missing server secret must fail clearly rather than be silently replaced
 * with a fake value. `process.env.X || ''` is exactly the substitution it forbids - an empty
 * PAYLOAD_SECRET would sign session tokens with nothing at all.
 *
 * This is the Phase 2 minimum, not the environment system. The typed, Zod-validated module
 * that separates browser-safe from server-only variables is Phase 4 (§4.1a), and it replaces
 * this. The variable name is safe to include here because this throws at config load, server
 * side - it never reaches an API response.
 */
function requireServerEnv(name: 'DATABASE_URL' | 'PAYLOAD_SECRET'): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill it in; see docs/DEVELOPMENT.md.`,
    )
  }
  return value
}

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
      connectionString: requireServerEnv('DATABASE_URL'),
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

  // Payload signs and encrypts with this. Server-only; must never be exposed.
  secret: requireServerEnv('PAYLOAD_SECRET'),

  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
