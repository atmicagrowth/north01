import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Removes the Phase 5 fixture — plan §5.1c's "one small test collection", whose stated purpose was
 * to be deleted here (notes §1.10.9). This project's first destructive migration, deliberately
 * rehearsed on something worthless.
 *
 * **`DROP CONSTRAINT IF EXISTS` is a hand-edit, and without it this migration does not run.**
 * Drizzle emits `DROP TABLE … CASCADE` alongside explicit cleanup of the objects that referenced the
 * table — but `CASCADE` has already removed the foreign key by the time the explicit `DROP
 * CONSTRAINT` reaches it, so the statement fails and the whole migration rolls back:
 *
 * ```
 * error: constraint "payload_locked_documents_rels_schema_probes_fk"
 *        of relation "payload_locked_documents_rels" does not exist
 * ```
 *
 * Measured against a real database, not inferred. It is systematic rather than a one-off: the same
 * failure appeared in the `down` of the migration beside this one, over twenty-two constraints. Any
 * generated migration that drops a collection has it, so `docs/DATABASE.md` §4 now lists the edit as
 * a required step after `migrate:create`.
 *
 * `IF EXISTS` rather than reordering: the statement is *redundant*, not wrong — the constraint is
 * meant to be gone — and idempotence does not depend on getting a two-hundred-statement ordering
 * right by hand. The end state is identical either way, which is why the Drizzle snapshot beside
 * this file stays accurate and needed no regeneration.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "schema_probes" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "schema_probes" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_schema_probes_fk";
  
  DROP INDEX "payload_locked_documents_rels_schema_probes_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "schema_probes_id";
  DROP TYPE "public"."enum_schema_probes_status";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_schema_probes_status" AS ENUM('active', 'archived');
  CREATE TABLE "schema_probes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"reference" varchar NOT NULL,
  	"label" varchar NOT NULL,
  	"status" "enum_schema_probes_status" DEFAULT 'active' NOT NULL,
  	"note" varchar,
  	"owner_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"deleted_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "schema_probes_id" integer;
  ALTER TABLE "schema_probes" ADD CONSTRAINT "schema_probes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "schema_probes_reference_idx" ON "schema_probes" USING btree ("reference");
  CREATE INDEX "schema_probes_status_idx" ON "schema_probes" USING btree ("status");
  CREATE INDEX "schema_probes_owner_idx" ON "schema_probes" USING btree ("owner_id");
  CREATE INDEX "schema_probes_updated_at_idx" ON "schema_probes" USING btree ("updated_at");
  CREATE INDEX "schema_probes_created_at_idx" ON "schema_probes" USING btree ("created_at");
  CREATE INDEX "schema_probes_deleted_at_idx" ON "schema_probes" USING btree ("deleted_at");
  CREATE UNIQUE INDEX "owner_label_idx" ON "schema_probes" USING btree ("owner_id","label");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_schema_probes_fk" FOREIGN KEY ("schema_probes_id") REFERENCES "public"."schema_probes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_schema_probes_id_idx" ON "payload_locked_documents_rels" USING btree ("schema_probes_id");`)
}
