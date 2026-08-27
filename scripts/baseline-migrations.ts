/**
 * Baseline a pushed development database onto the committed migration chain.
 *
 * **When this is needed.** A development database built by Drizzle push has never run a migration:
 * its `payload_migrations` table holds a single `batch = -1` marker and nothing else, so
 * `pnpm migrate:status` reports every migration as *not run*. Running `pnpm migrate` against it
 * would then try to `CREATE TABLE` objects that push already created, and fail on the first one —
 * while `pnpm migrate:fresh` would work by destroying the database, including the admin user and
 * any local content.
 *
 * This script takes the third path: it records the migrations that the pushed schema already
 * *matches* as having run, and removes the push marker, so `pnpm migrate` applies only what is
 * genuinely pending. Phase 5 measured the premise — a database built entirely by push and one built
 * entirely by the committed migration compared identical across every column, type, nullability,
 * default, index and foreign key (notes §1.10.5) — which is what makes "already ran" a statement of
 * fact rather than a convenient fiction.
 *
 * **Name every migration the database already matches**, not just the first. A database pushed from
 * the *current* config matches the whole committed chain, so baselining only the initial migration
 * leaves the later ones pending — and `pnpm migrate` then replays them against a schema that already
 * has their changes, failing on the first `ALTER TABLE`. `pnpm migrate:status` after this script, and
 * before `pnpm migrate`, is what catches that.
 *
 * ```
 * pnpm migrate:status                       # see which are recorded as run
 * pnpm payload run scripts/baseline-migrations.ts  *   20260827_022341_initial  *   20260827_044610_remove_schema_probes  *   20260827_051943_phase_6_data_model
 * pnpm migrate:status                       # everything the database already has: "Yes"
 * pnpm migrate                              # applies only what is genuinely pending
 * ```
 *
 * **It changes no schema and touches no user data.** The only rows it writes are in
 * `payload_migrations`, which is bookkeeping. Given a migration name that has already been recorded
 * it does nothing, so running it twice is safe.
 *
 * **Development only, and it checks the database rather than the environment.** Baselining a
 * *production* database would mark real migrations as applied without applying them — the schema and
 * the ledger would disagree silently, which is the one failure mode `docs/DATABASE.md` §6 has no
 * recovery for. An `appEnv` test could not prevent that: `appEnv` is derived from `VERCEL_ENV`/
 * `NODE_ENV`, neither of which is set when the Payload CLI runs on a laptop, so it reads `local`
 * whatever `DATABASE_URL` addresses. The guard is decision **D-10**'s instead — `DATABASE_PUSH_TARGET`
 * has to name the database the connection string actually reaches.
 *
 * **Names are checked against the migration index**, so a typo is refused rather than recorded. A row
 * naming no real migration is invisible to `migrate` and breaks `migrate:down` for its whole batch.
 */

// Must be set before the Payload config is evaluated: the Postgres adapter reads it in `connect()`
// and skips Drizzle's push when it is `true`. Without it, initialising Payload here would push the
// Phase 6 schema first and leave nothing for the migration to do. Hence the dynamic imports below —
// static `import` statements are hoisted above this assignment.
process.env.PAYLOAD_MIGRATING = 'true'

// This file uses top-level `await` and has no static import to make it a module on its own.
export {}

const { developmentDatabase } = await import('../src/lib/env.core')

if (!developmentDatabase.ok) {
  throw new Error(
    `baseline-migrations refuses to run: ${developmentDatabase.reason}. ` +
      'It may only touch the development database that DATABASE_PUSH_TARGET names — see D-10. ' +
      'Baselining any other database records migrations as applied without applying them.',
  )
}

const { migrations } = await import('../src/payload/migrations')
const known = new Set(migrations.map((migration) => migration.name))

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')

const names = process.argv.slice(2)

if (names.length === 0) {
  throw new Error(
    `Name at least one migration to baseline. Available: ${[...known].join(', ')}. ` +
      'Only name migrations whose schema the database already has.',
  )
}

const unknown = names.filter((name) => !known.has(name))

if (unknown.length > 0) {
  throw new Error(
    `Not a migration in this project: ${unknown.join(', ')}. Available: ${[...known].join(', ')}.`,
  )
}

const payload = await getPayload({ config })

try {
  const { docs: existing } = await payload.find({
    collection: 'payload-migrations',
    limit: 0,
    pagination: false,
  })

  const alreadyRecorded = new Set(existing.map((doc) => doc.name))

  for (const name of names) {
    if (alreadyRecorded.has(name)) {
      payload.logger.info(`Already recorded, skipping: ${name}`)
      continue
    }

    await payload.create({
      collection: 'payload-migrations',
      data: { name, batch: 1 },
    })

    payload.logger.info(`Recorded as run (batch 1): ${name}`)
  }

  // The push marker. Left in place, `payload migrate` stops to ask an interactive question that a
  // non-interactive shell cannot answer, and the answer would be about data loss that baselining
  // has just made unnecessary.
  const pushMarkers = existing.filter((doc) => doc.batch === -1)

  for (const marker of pushMarkers) {
    await payload.delete({ collection: 'payload-migrations', id: marker.id })
    payload.logger.info(`Removed the Drizzle push marker (${marker.name}).`)
  }

  payload.logger.info('Baseline complete. Run `pnpm migrate:status`, then `pnpm migrate`.')
} finally {
  await payload.destroy()
}
