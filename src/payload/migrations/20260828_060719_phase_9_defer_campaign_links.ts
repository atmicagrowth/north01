import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "collections_rels" DROP CONSTRAINT IF EXISTS "collections_rels_campaigns_fk";
  
  ALTER TABLE "edits_rels" DROP CONSTRAINT IF EXISTS "edits_rels_campaigns_fk";
  
  ALTER TABLE "campaigns_rels" DROP CONSTRAINT IF EXISTS "campaigns_rels_campaigns_fk";
  
  ALTER TABLE "navigation_rels" DROP CONSTRAINT IF EXISTS "navigation_rels_campaigns_fk";
  
  DROP INDEX "collections_rels_campaigns_id_idx";
  DROP INDEX "edits_rels_campaigns_id_idx";
  DROP INDEX "campaigns_rels_campaigns_id_idx";
  DROP INDEX "navigation_rels_campaigns_id_idx";
  ALTER TABLE "collections_rels" DROP COLUMN "campaigns_id";
  ALTER TABLE "edits_rels" DROP COLUMN "campaigns_id";
  ALTER TABLE "campaigns_rels" DROP COLUMN "campaigns_id";
  ALTER TABLE "navigation_rels" DROP COLUMN "campaigns_id";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "collections_rels" ADD COLUMN "campaigns_id" integer;
  ALTER TABLE "edits_rels" ADD COLUMN "campaigns_id" integer;
  ALTER TABLE "campaigns_rels" ADD COLUMN "campaigns_id" integer;
  ALTER TABLE "navigation_rels" ADD COLUMN "campaigns_id" integer;
  ALTER TABLE "collections_rels" ADD CONSTRAINT "collections_rels_campaigns_fk" FOREIGN KEY ("campaigns_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_rels" ADD CONSTRAINT "edits_rels_campaigns_fk" FOREIGN KEY ("campaigns_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "campaigns_rels" ADD CONSTRAINT "campaigns_rels_campaigns_fk" FOREIGN KEY ("campaigns_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_rels" ADD CONSTRAINT "navigation_rels_campaigns_fk" FOREIGN KEY ("campaigns_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "collections_rels_campaigns_id_idx" ON "collections_rels" USING btree ("campaigns_id");
  CREATE INDEX "edits_rels_campaigns_id_idx" ON "edits_rels" USING btree ("campaigns_id");
  CREATE INDEX "campaigns_rels_campaigns_id_idx" ON "campaigns_rels" USING btree ("campaigns_id");
  CREATE INDEX "navigation_rels_campaigns_id_idx" ON "navigation_rels" USING btree ("campaigns_id");`)
}
