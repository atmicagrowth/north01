# NORTH / 01 — Database

> Plan §5.1a–d. What the database is, how a schema change reaches it, and what to do when one goes
> wrong. Written in Phase 5 and kept in step by every phase that changes the schema — which, from
> Phase 6 onward, is most of them.
>
> Companion documents: [`ENVIRONMENT.md`](ENVIRONMENT.md) for the variables,
> [`ARCHITECTURE.md`](ARCHITECTURE.md) for **D-10** and the decisions below,
> [`DEVELOPMENT.md`](DEVELOPMENT.md) for the day-to-day commands.

---

## 1. What is actually there

**Neon PostgreSQL 17.11**, one project, one database per environment. Payload owns the schema:
every table is generated from the collection configs in `src/payload/collections/`, through the
official `@payloadcms/db-postgres` adapter, which is Drizzle over `node-postgres`. There is no
second ORM and no hand-written DDL — plan §5.1b, and the reason the migration in
`src/payload/migrations/` is generated rather than authored.

| Environment | Database | Schema arrives by | Push guard |
|---|---|---|---|
| Local | Neon **development** branch | Drizzle push (`pnpm dev`) | armed, and aimed — see **D-10** |
| Preview | a non-production branch | committed migrations | cannot arm — `appEnv` is `preview` |
| Production | the production database | committed migrations, at build time | constant-folded to `false` in the build |

**Why PostgreSQL 17 and not Neon's default 18**, and why the major version cannot be changed later:
notes §1.7.2. Do not create a new Neon project on 18 without reading it.

Production is **not provisioned yet** — no phase before deployment needs it, and provisioning it is
the project owner's job, not this repository's. Nothing in the workflow below assumes it exists;
§6 is what to do on the day it does.

### The tables today

Eight belong to Payload — `users`, `users_sessions`, `payload_preferences`,
`payload_preferences_rels`, `payload_locked_documents`, `payload_locked_documents_rels`,
`payload_migrations`, `payload_kv` — and one is Phase 5's own fixture, `schema_probes`. Phase 6
replaces the fixture with the real data model.

---

## 2. Connection strings

```
postgresql://USER:PASSWORD@HOST.neon.tech/DATABASE?sslmode=verify-full
```

- **TLS is not optional.** Use `sslmode=verify-full`, never `require`: `pg` 9 adopts libpq
  semantics, in which `require` means *encrypt but do not verify the certificate*. Today the two
  behave identically, so writing the strict one costs nothing and does not silently weaken later.
  Notes §1.7.4.
- **Local uses the direct endpoint. Production uses the pooled (`-pooler`) one.** A serverless
  deployment is many short-lived processes, each with its own pool; pointing those at the compute
  directly is how a Neon connection limit is reached. The pooler fronts it with PgBouncer, so
  instances multiply connections to the pooler rather than backends on the compute. Locally there
  is one process and the indirection buys nothing.
- **Percent-encode the password.** `@`, `/`, `:`, `?` and `#` are URL syntax; an un-encoded one
  silently re-parses the string into a different host, user or database. Payload's own docs call
  this out as the most common "Payload cannot connect" that is not a Payload problem. The
  environment schema validates `DATABASE_URL` as a URL, so a truncated or quoted value fails at
  startup with the variable named — but a *valid* URL that means the wrong thing still parses.
- **`?options=` is refused** by the push guard, deliberately: Neon documents it for clients that
  cannot use SNI, and it reroutes the connection to a different compute while the hostname stays
  put. See **D-10**.

### Pool settings, and why they are not defaults

In `src/payload.config.ts`. `max: 10` and `idleTimeoutMillis: 30_000` are conservative statements of
`pg`'s own defaults; **`connectionTimeoutMillis: 15_000` is a real change.** `pg` defaults it to `0`,
meaning wait forever, which against a suspended or unreachable compute turns a dead database into a
hung request — no error, no log line, nothing to alert on. Fifteen seconds clears a Neon cold start
and stays inside a serverless function's own limit, so what surfaces is a named connection error.

### What a connection failure looks like

```
ERROR: Error: cannot connect to Postgres. Details: database "north01_typo" does not exist
```

Named, actionable, and **the connection string is not in it** — verified in Phase 5 by pointing
`DATABASE_URL` at a database that does not exist and grepping the entire output for the password:
zero matches, exit code 1. The same run confirms `disableCreateDatabase: true` works: the adapter
would otherwise have issued `CREATE DATABASE` and carried on, turning a typo into a silently created
empty database.

Diagnose connectivity independently before assuming a Payload bug — one `select 1` through `psql`
against the same string answers the question.

---

## 3. The two ways a schema change reaches a database

**Push — development only.** Drizzle diffs the config against the live database and applies the
difference in place. Fast, unversioned, and destructive by nature. It runs only when the **D-10**
guard is satisfied: `NODE_ENV=development`, `appEnv` is `local`, `DATABASE_PUSH_TARGET` is set, and
the database `DATABASE_URL` actually addresses matches it. Repointing `DATABASE_URL` disarms push
rather than aiming it somewhere new. Full reasoning: [`ENVIRONMENT.md`](ENVIRONMENT.md) → the
schema-push guard.

**Migrations — everywhere else.** Generated files in `src/payload/migrations/`, committed, applied
in order, recorded in `payload_migrations`. This is the only way a schema change reaches preview or
production. Plan §5.1c and §5.1d.

The two are *supposed* to agree, and Phase 5 measured that they do: the development database built
entirely by push and a fresh database built entirely by the committed migration compared
**identical** across every column, type, nullability, default, index and foreign key. §10 repeats
that check; run it when a migration looks suspicious.

---

## 4. Changing the schema

1. **Edit the collection config.** A field, an index, a relationship, a collection.
2. **`pnpm dev`.** Push applies it to your development branch. The terminal prints
   `[✓] Pulling schema from database…`; if instead it prints `[env] Schema push is disabled`, the
   guard declined and the reason is on the same line.
3. **`pnpm generate:types`.** `src/payload-types.ts` is committed and the build assumes it is current.
4. **`pnpm migrate:create <name>`.** Writes three files: the migration `.ts`, a Drizzle snapshot
   `.json`, and a rewritten `index.ts` barrel. It **does not connect to the database** — it diffs the
   config against the previous snapshot — so it works offline and cannot touch anything by accident.
5. **Trim the unused parameters.** The generated file destructures `{ db, payload, req }` and uses
   only `db`; this project compiles with `noUnusedParameters`, so reduce both signatures to `{ db }`.
   One edit per migration, and it is the only hand-edit a migration ever gets.
6. **Read the SQL.** This is the step that matters. The generated `up` is the exact statement list
   that will run against production one day. A `DROP COLUMN` in it is a data-loss event scheduled by
   you, and a migration nobody read is not a reviewed change.
7. **Verify it on a throwaway database** — §10.
8. **Commit all three files together, with the config change that caused them.** A migration
   separated from its config change is a broken commit in both directions.

### Commit policy

- **Migrations are committed. Always, and in the same commit as the schema change.**
- **A migration that has run anywhere is immutable.** Fix a mistake with a new migration, never by
  editing an applied one: the old SQL has already executed on some database, and rewriting the file
  changes nothing there while guaranteeing a mismatch with the snapshot chain.
- `*.json` snapshots and `index.ts` are **generated** — regenerate, never hand-edit. Both are
  Prettier-ignored for that reason.
- The snapshot is not optional and not noise: `migrate:create` diffs against the most recent
  snapshot, so a missing one makes the *next* migration re-emit the whole schema.

---

## 5. Applying migrations

| Command | What it does |
|---|---|
| `pnpm migrate:status` | Which migrations exist, which have run, in which batch |
| `pnpm migrate` | Runs everything pending, as one new batch |
| `pnpm migrate:down` | Rolls back the **most recent batch** |
| `pnpm migrate:fresh` | Drops every table, then runs every migration. Development only |
| `pnpm migrate:create <name>` | Generates the next migration. Touches no database |

`PAYLOAD_MIGRATING=true` is set by all of these, which disables push for the duration — the two
mechanisms can never run in the same process.

**Running `pnpm migrate` against a database that has been pushed to** — every local development
branch, including yours — stops and asks first:

> *It looks like you've run Payload in dev mode… If you'd like to run migrations, data loss will
> occur. Would you like to proceed?*

That is Payload noticing the `batch = -1` row that push leaves in `payload_migrations`. It is
correct, and it is why the local workflow is push, not migrate. It is also why a production database
must never be pushed to: the prompt has no answer in a non-interactive build.

---

## 6. Production procedure

**The Vercel Build Command is `pnpm build:deploy`**, which is `payload migrate && next build`.

Three properties, in the order they matter:

1. **Migrations run before the application that needs them.** Plan §5.1d asks for exactly this.
2. **A failed migration fails the build, so nothing deploys.** The alternative — migrating at server
   startup through the adapter's `prodMigrations` option — puts the same DDL in every cold-starting
   instance at once, which is a race by construction. It is deliberately not used.
3. **It is idempotent.** `payload migrate` skips what `payload_migrations` already records, so a
   rebuild with no schema change runs no SQL.

Verified end to end in Phase 5 against a real database: a rolled-back database, then
`pnpm build:deploy`, and afterwards the migration recorded as batch 1 with all nine tables present.

**Do not let two deployments migrate at once.** Vercel builds concurrently by default; a second
build starting while the first is mid-migration is two processes issuing DDL against one database.
Serialize deployments in the project's deployment settings, or promote from a single queued
pipeline. This is a platform setting, not something the repository can enforce.

**Migrations must be backward compatible with the code already running.** The migration lands while
the *previous* deployment is still serving. Dropping or renaming a column that the live code still
reads breaks production between migration and cutover. Expand first — add the new column, write to
both — cut over, and contract in a later deployment.

**Never hand-alter a production table.** Not to fix a type, not to add an index in a hurry. The next
`migrate:create` diffs against the snapshot, not against the database, so a manual change is
invisible to the tooling and will be silently reverted or collided with.

---

## 7. Rollback and restore

Two different tools for two different failures.

**A bad migration, caught immediately → `pnpm migrate:down`.** It rolls back the most recent *batch*
by running each migration's `down`. It is a schema operation and it does not restore data: a `down`
that drops a column drops the data in it. Note also that rolling back the *initial* migration drops
`payload_migrations` along with everything else — the ledger is inside the thing being torn down —
so for the first migration, `down` is a teardown rather than a rollback.

**Anything worse → restore the database, not the schema.** Neon's branch and point-in-time restore
is the real recovery path: it returns data *and* schema to a moment before the mistake, which
`migrate:down` cannot do. Take a branch before running anything unfamiliar against production, and
know the retention window on the current plan before relying on it.

**In development,** `pnpm migrate:fresh` rebuilds from nothing in seconds and is usually the shortest
route out of a confused local database. It destroys everything in that database, including your
admin user.

---

## 8. Schema conventions

Plan §5.1d asks for each of these to be deliberate. They are worked examples in
`src/payload/collections/SchemaProbes.ts` and visible as SQL in the initial migration.

| Concern | Convention |
|---|---|
| **Index** | Any column that filters or sorts a list. `unique: true` implies one. Payload indexes `created_at`, `updated_at` and `deleted_at` for you |
| **Unique, one column** | `unique: true`. For anything a human types twice — SKU, slug, external reference |
| **Unique, several columns** | `indexes: [{ fields: [...], unique: true }]` on the collection |
| **Foreign key** | A single non-polymorphic `relationship` writes a real `REFERENCES` column with **`ON DELETE SET NULL`** |
| **Required vs nullable** | `required` means the row cannot be read meaningfully without it. A statement about the domain, never about the form |
| **Timestamps** | `timestamps: true` on every collection |
| **Soft delete** | `trash: true` where a delete must be recoverable — orders, customers. Sets `deleted_at`; reads exclude trashed rows unless they ask for them |
| **Archive** | A `status` field. An *editorial* state, and deliberately not the same column as `deleted_at` |

### Four traps, all of them load-bearing

**A compound unique index over a nullable column is weaker than it reads.** `(owner, label)` unique
does not stop two rows with the same label and no owner: in Postgres, NULLs are distinct from one
another. Proved in Phase 5 — both rows were created. PostgreSQL 15+ can say `NULLS NOT DISTINCT`,
but Drizzle does not emit it, so a constraint that must hold across a nullable column needs the
column made required instead.

**Compound index names are not namespaced by table.** `indexes: [{ fields: ['owner', 'label'] }]`
produced an index called literally `owner_label_idx`. Index names are unique per *schema* in
Postgres, so two collections declaring a compound index over the same field names collide, and the
collision surfaces as a failed migration rather than a config error. Phase 6 defines many
collections: keep compound-index field combinations distinct, or the second one will not migrate.

**`ON DELETE SET NULL` means every relationship can resolve to nothing.** Deleting a user does not
delete or orphan the rows pointing at it — their reference becomes null. Every consumer of a
relationship must treat "resolves to nothing" as an ordinary state. Proved in Phase 5.

**`payload.delete({ trash: true })` is not a soft delete.** It means *permanently delete, trashed
documents included* — the opposite of what it reads like. A soft delete is an **update** that sets
`deletedAt`, which is what the admin panel's "move to trash" does. This one cost a debugging cycle
in Phase 5 and will cost another in Phase 18 if it is not written down.

### Primary keys stay `serial`

The adapter can issue `uuid` or `uuidv7` primary keys instead, and the decision cannot be revisited
cheaply once Phase 6 has created every table. Integer keys are kept: they are smaller in every index
and every foreign key, they insert in order, and the reason usually given for UUIDs — not exposing a
sequential identifier to customers — is better solved where it actually arises. Where an identifier
becomes customer-visible, the order number in particular, that phase adds an opaque public column
beside the primary key. That is what commerce systems do anyway, and it keeps the internal key
internal. Recorded as **D-17**.

---

## 9. The plan's edge cases, and what is done about each

| Edge case (§5.1d) | Answer |
|---|---|
| Connection string special characters | Percent-encode the password. `DATABASE_URL` is validated as a URL at startup and at build; a malformed one fails with the variable named |
| Database sleeps / cold starts | `connectionTimeoutMillis` bounds the wait; `idleTimeoutMillis` releases a connection before Neon suspends underneath it; a pool `error` handler keeps a dropped idle client from crashing the process |
| Local connection differs from hosted | Direct endpoint locally, pooled in production, and a different database per environment. Never the same string in two places |
| Migration drift | Push and migrations are cross-checked — §10. Both are generated from the same config, so a difference means one of them did not run, not that they disagree |
| Duplicate unique records | The database refuses them. Payload surfaces it as a field validation error — `Value must be unique` — in the admin panel, over REST, and through the Local API alike |
| Null relationships | Expected, not exceptional: see `ON DELETE SET NULL` above |
| Orphaned records | Cannot occur through a foreign key — the reference nulls rather than dangling. Payload's own `_rels` tables cascade |
| Database restart / reconnect | Survived, measured: every backend of a running server was terminated and the next three requests returned 200 |

---

## 10. Verifying a migration before it ships

The check Phase 5 ran, and the one to repeat whenever a migration looks unusual. It needs no second
Neon project — the development role can create a database inside the same one.

```bash
# 1. A throwaway database beside the development one.
psql "$DATABASE_URL" -c 'CREATE DATABASE north01_migration_check'

# 2. Point the CLI at it for this shell only. DATABASE_PUSH_TARGET now names a different database,
#    so the D-10 guard disarms push automatically — which is exactly what is wanted here.
export DATABASE_URL='postgresql://…/north01_migration_check?sslmode=verify-full'

# 3. Apply, inspect, and prove the rollback works too.
pnpm migrate:status     # every migration "No"
pnpm migrate            # applies
pnpm migrate:status     # every migration "Yes", batch 1
pnpm migrate:down       # rolls the batch back
pnpm migrate            # forward again

# 4. Optional but worth it: diff this schema against the pushed development one. Compare columns,
#    indexes and constraints from information_schema, pg_indexes and pg_constraint. They must match.

# 5. Drop it. It is a fixture, not an environment.
psql "$DEV_DATABASE_URL" -c 'DROP DATABASE north01_migration_check WITH (FORCE)'
```

A variable set in the shell wins over `.env`: Next's loader does not overwrite what is already in
`process.env`, so step 2 retargets the CLI without editing any file.

Everything above is safe against a development Neon project, and none of it touches the development
branch's own data.

---

## 11. Rules

- **Development pushes. Everything else migrates.** No exceptions, and the guard enforces it.
- **No production data in development.** Not a dump, not "just the products table", not for
  debugging. Customer records leave production only as an anonymised extract.
- **Never commit a connection string.** `.env*` is git-ignored except `.env.example`.
- **The database is the source of truth for business data.** Not the browser, not the search index,
  not a cache. `ARCHITECTURE.md` §2.
