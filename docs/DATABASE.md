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

**Seventy-three.** Nine belong to Payload's own machinery — `users`, `users_sessions`,
`customers_sessions`, `payload_preferences`, `payload_preferences_rels`, `payload_locked_documents`,
`payload_locked_documents_rels`, `payload_migrations`, `payload_kv` — and the rest are Phase 6's data
model: twenty-two collections, two globals, and the array, block and relationship tables beneath them.

Phase 5's fixture, `schema_probes`, is gone. Removing it was this project's first destructive
migration, deliberately rehearsed on something worthless before the same shape of migration is ever
pointed at an order table.

The count is worth knowing because a Payload collection is rarely one table. `products` is four —
itself, `products_gallery` (the array), `products_texts` (the `hasMany` text fields) and
`products_rels` (the `hasMany` relationships). An `array` field is a table; a `blocks` field is one
table per block type; a `hasMany` relationship is a per-collection `_rels` table. The two shared
`payload_*_rels` tables gain a `products_id` *column* rather than a table of their own, and are
already counted among the nine. This is why field names have to be watched for identifier length — §8.

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

In `src/payload.config.ts`, and only one of the three is a restatement.

| Option | `pg` default | Here | Why |
|---|---|---|---|
| `max` | 10 | **10** | Restated, because the number only means something alongside the endpoint choice above: it is per *process*, and production fans out across many |
| `idleTimeoutMillis` | 10 000 | **30 000** | Three times the default. A connection survives the gaps in a browsing session instead of being reopened between requests, and is still released long before an idle Neon compute goes away underneath it |
| `connectionTimeoutMillis` | **0 — wait forever** | **15 000** | The one that matters. Against an unreachable or suspended compute the default turns a dead database into a hung request: no error, no log line, nothing to alert on, until something far away times out |

Fifteen seconds clears a Neon cold start and stays inside a serverless function's own limit.
Measured against a black-holed address: the request fails with
`Error: cannot connect to Postgres. Details: Connection terminated due to connection timeout`,
which is a named failure with a subject.

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
6. **Make every `DROP CONSTRAINT` an `IF EXISTS`** — required whenever the migration drops a
   collection, which means in the `down` of every migration that adds one. Drizzle emits
   `DROP TABLE … CASCADE` alongside explicit cleanup of the objects that referenced those tables, and
   `CASCADE` has already removed them by the time the explicit statement runs:

   ```
   error: constraint "payload_locked_documents_rels_schema_probes_fk"
          of relation "payload_locked_documents_rels" does not exist
   ```

   Measured in Phase 6, twice: once in the `up` that removed `schema_probes`, and once across
   twenty-two constraints in the `down` of the data-model migration. Both rolled the whole batch back.
   `IF EXISTS` rather than reordering: the statement is *redundant* rather than wrong, and idempotence
   does not depend on getting a two-hundred-statement ordering right by hand. It changes no end state,
   so the snapshot beside the file stays accurate and needs no regeneration.

   Those two are the only hand-edits a migration ever gets.
7. **Read the SQL.** This is the step that matters. The generated `up` is the exact statement list
   that will run against production one day. A `DROP COLUMN` in it is a data-loss event scheduled by
   you, and a migration nobody read is not a reviewed change.
8. **Verify it on a throwaway database**, or roll it forward and back on the development one — §10.
9. **Commit all three files together, with the config change that caused them.** A migration
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

Plan §5.1d asks for each of these to be deliberate. The worked examples were
`src/payload/collections/SchemaProbes.ts` until Phase 6 removed it; the SQL is still readable in
`src/payload/migrations/20260827_022341_initial.ts`, and every convention is now live configuration
throughout `src/payload/collections/`.

| Concern | Convention |
|---|---|
| **Index** | Any column that filters or sorts a list. `unique: true` implies one. Payload indexes `created_at`, `updated_at` and `deleted_at` for you |
| **CHECK** | Only where application validation can be bypassed. One exists: `inventory_quantity >= 0`, because Phase 17's atomic decrement will be raw SQL. Added through `afterSchemaInit` — see below |
| **Unique, one column** | `unique: true`. For anything a human types twice — SKU, slug, external reference |
| **Unique, several columns** | `indexes: [{ fields: [...], unique: true }]` on the collection |
| **Foreign key** | A single non-polymorphic `relationship` writes a real `REFERENCES` column with **`ON DELETE SET NULL`** |
| **Required vs nullable** | `required` means the row cannot be read meaningfully without it. A statement about the domain, never about the form |
| **Timestamps** | `timestamps: true` on every collection |
| **Soft delete** | `trash: true` where a delete must be recoverable: `orders`, `order_items`, `customers`, `products`, `product_variants`. Sets `deleted_at`; reads exclude trashed rows unless they ask for them. Reviews are **not** among them — moderation already has a `rejected` state, so deleting one is deliberate |
| **Archive** | A `status` field. An *editorial* state, and deliberately not the same column as `deleted_at` |
| **Publish state** | `status` (`draft` \| `published`) plus `publishedAt`, **not** Payload's `versions: { drafts: true }` — see "Drafts are not used" below |
| **Money** | An integer count of minor units, in a column whose name ends `Minor`. `src/payload/fields/money.ts` |
| **Cascade** | A `beforeDelete` hook, wherever a dependant carries a *required* reference. Postgres cannot do it — see the sixth trap |

### Drafts are not used, and the reason is a column property

Payload's `versions: { drafts: true }` is not enabled on any collection. The obvious argument is
weight — every collection gains a parallel `_v` table, and so does every array and block table beneath
it, which for eleven editorial collections is a large multiple of the tables the model needs. The
decisive argument is narrower and was verified in the adapter source
(`@payloadcms/drizzle/schema/buildRawSchema.js`):

```js
buildTable({ …, disableNotNull: !!collection?.versions?.drafts, tableName /* the MAIN table */ })
```

Enabling drafts strips `NOT NULL` from **every column of the collection's own table**, not just the
versions table — because a draft is allowed to be incomplete. On an editorial collection that is
merely untidy. On `orders`, where `total_minor` and `payment_status` are the record, it would make
`required: true` unenforceable at the only layer that cannot be bypassed.

What the corpus actually asks for is a publish *state* (plan §6.1e, §6.1g), and nothing anywhere asks
to see, restore or edit a previous revision. A `status` column answers the question that was asked;
`publishedAt` answers the scheduling one (feature matrix §12's "scheduled/past campaign") by being
compared against the clock. A later phase that genuinely needs revision history can turn drafts on
beside these fields.

### Six traps, all of them load-bearing

**A compound unique index over a nullable column is weaker than it reads.** `(owner, label)` unique
does not stop two rows with the same label and no owner: in Postgres, NULLs are distinct from one
another. Proved in Phase 5 — both rows were created. PostgreSQL 15+ can say `NULLS NOT DISTINCT`,
but Drizzle does not emit it, so a constraint that must hold across a nullable column needs the
column made required instead.

**Compound index names are not namespaced by table, and they are built from *field* names.**
`indexes: [{ fields: ['owner', 'label'] }]` produced an index called literally `owner_label_idx`.
Index names are unique per *schema* in Postgres, so two collections declaring a compound index over
the same field names contend for one name. The adapter de-duplicates by appending a counter
(`buildIndexName` in `@payloadcms/drizzle`), which means the loser's name depends on collection order
in the config — a rename waiting for the next reshuffle. Keep the field combinations distinct instead.

Phase 6's four are `product_color_size_idx`, `cart_variant_idx`, `customer_product_idx` (wishlist) and
`product_customer_idx` (reviews). Note the last two: **the column order is load-bearing**, because it
is the name. `(customer, product)` and `(product, customer)` would have collided had reviews been
written the other way round — and the order chosen is also the better index for the query each one
serves.

Second half of the same trap: the name comes from the *field* name, not the column name. A field
called `colorName` produced `"product_colorName_size_idx"` — a mixed-case identifier, which Postgres
preserves and then requires quoting forever. The field is called `color` for that reason.

**`ON DELETE SET NULL` means every relationship can resolve to nothing.** Deleting a user does not
delete or orphan the rows pointing at it — their reference becomes null. Every consumer of a
relationship must treat "resolves to nothing" as an ordinary state. Proved in Phase 5.

**`indexes` cannot express a *partial* unique index.** ~~and Phase 6 needs one~~ — **settled in
Phase 6, and it did not.** Plan §6.1c's critical rule — *"do not allow two active variants of the same
product to share the same SKU"* — reads as a unique constraint over `(product, sku)` **`WHERE active`**,
which Payload's `{ fields, unique }` API cannot express.

The resolution was to notice that the rule is a *lower bound on correctness*, not a specification. The
constraint that exists is `UNIQUE (sku)` across the whole collection, and it refuses a superset:
the same SKU on two different products (incoherent — a stock-keeping unit that identifies two garments
cannot be picked or counted), and reusing a SKU after retiring a variant (the case `WHERE active`
exists to allow, and the case that breaks order history, because order lines snapshot the SKU). Both
are defects; a partial index would have permitted both. Reasoning in full at the top of
`src/payload/collections/ProductVariants.ts`.

`afterSchemaInit` is used once, and for the constraint that genuinely has no other spelling:
`CHECK (inventory_quantity >= 0)`. That one matters because Phase 17's decrement will be raw SQL past
every Payload validator, and negative stock is a lost write rather than an oversell. `drizzle-orm` is
reached through `@payloadcms/db-postgres/drizzle/pg-core`, which the adapter re-exports, so it costs no
new direct dependency — and drizzle-kit does carry the CHECK into the snapshot, so later migrations
maintain it. The rejected third option remains rejected: an index added in a hand-written migration is
invisible to the snapshot chain, so nothing would ever maintain it.

**A `required` relationship is `NOT NULL` *and* `ON DELETE SET NULL`, which makes the parent
undeletable.** The two are set independently and their combination is a contradiction that only
appears at delete time — Postgres tries to null a column that may not be null and raises
`null value in column "variant_id" violates not-null constraint`, failing the *parent's* delete.

Two remedies, and which one applies depends on whether the dependant is a document.

*Where it is a collection*, a `beforeDelete` cascade removes the children first: `carts`→lines,
`orders`→lines, `products`→variants/lines/wishlist/reviews, `product_variants`→lines,
`customers`→addresses/wishlist/reviews. `src/payload/hooks/cascadeDelete.ts`. `beforeDelete`, not
`afterDelete`: the violation happens *during* the parent's delete statement, so a cleanup scheduled
afterwards never runs — the transaction has already rolled back.

*Where it is an array or block row inside another document* — a shop-the-look hotspot, a gallery
image, a review photo — no cascade is possible, because those rows are not documents and cannot be
deleted independently of the page that contains them. There the **column is nullable and the
requirement moves to `validate`** (`src/payload/fields/required.ts`), which Payload enforces on every
write. That also makes two rules the plan had already written reachable: §22.1b's *"hide the hotspot
if the product reference is invalid"* and §8.1d's neutral media placeholder both describe a reference
that has gone empty, which a `NOT NULL` column could never produce.

Nullable references are otherwise left to `SET NULL`, which is why deleting a customer keeps their
orders.

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
| Deleting a row other rows require | Cascaded in `beforeDelete` — sixth trap above. Measured: deleting a product removed its variants and the bag line referencing it |
| Money losing precision | Cannot: every amount is an integer count of minor units, exact through `numeric` and through JavaScript's `Number`. A fractional value is refused by a field validator |
| Stock going negative | Refused by a `CHECK`, past every application validator. Measured with a raw `UPDATE` |
| A duplicate line in one bag | Refused by `UNIQUE (cart, variant)` — which is what makes plan §14.1b's "sum the quantities" merge rule enforceable rather than aspirational |
| A product edited after it was bought | Order lines snapshot name, SKU, variant label and unit price. Measured: renaming a product left the line unchanged |

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

# 5. Drop it. It is a fixture, not an environment. Note this one runs against the DEVELOPMENT
#    string, not the retargeted one - a database cannot drop itself.
psql "<the development connection string>" -c 'DROP DATABASE north01_migration_check WITH (FORCE)'
```

A variable set in the shell wins over `.env`: Next's loader does not overwrite what is already in
`process.env`, so step 2 retargets the CLI without editing any file.

Everything above is safe against a development Neon project, and none of it touches the development
branch's own data.

### What Phase 6 ran instead, and why

The development database was rebuilt from the migration chain rather than from a throwaway copy —
`migrate` → `migrate:down` → `migrate` — which exercises the same statements plus the rollback, and is
the cycle that found both `DROP CONSTRAINT` failures in §4. Afterwards `pnpm dev` was started and
`/admin` requested: Drizzle pulled the schema, found no difference, and applied nothing. That is the
§3 cross-check — push and migrations agree — repeated against a data model instead of a fixture.

### Baselining a pushed development database

A database built by push has never run a migration: `payload_migrations` holds a single `batch = -1`
marker, `migrate:status` reports everything as *not run*, and `pnpm migrate` would try to create
tables that push already created. `pnpm migrate:fresh` fixes it by destroying the database, including
the admin user and any local content.

`scripts/baseline-migrations.ts` is the third path. It records the migrations whose schema the database
already *matches* as having run, and removes the push marker, so `pnpm migrate` applies only what is
genuinely pending:

```bash
pnpm payload run scripts/baseline-migrations.ts 20260827_022341_initial
pnpm migrate
```

It writes nothing but `payload_migrations` rows, refuses to run outside the local environment, and is
safe to run twice. The premise is §3's measurement: push and the committed migration produce identical
schemas, which is what makes "already ran" a fact rather than a convenient fiction.

**It is also needed after `pnpm seed`**, or after any `payload run` script: those initialise Payload
without `PAYLOAD_MIGRATING`, so push runs and re-creates the `batch = -1` marker, and the next
`pnpm migrate` stops to ask an interactive question a non-interactive shell cannot answer.

---

## 11. Rules

- **Development pushes. Everything else migrates.** No exceptions, and the guard enforces it.
- **No production data in development.** Not a dump, not "just the products table", not for
  debugging. Customer records leave production only as an anonymised extract.
- **Never commit a connection string.** `.env*` is git-ignored except `.env.example`.
- **The database is the source of truth for business data.** Not the browser, not the search index,
  not a cache. `ARCHITECTURE.md` §2.
