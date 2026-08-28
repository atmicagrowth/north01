import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_media_role" AS ENUM('product', 'campaign', 'editorial', 'logo');
  ALTER TABLE "media" ADD COLUMN "role" "enum_media_role" DEFAULT 'editorial' NOT NULL;
  ALTER TABLE "media" ADD COLUMN "cloudinary_public_id" varchar;
  ALTER TABLE "media" ADD COLUMN "cloudinary_asset_id" varchar;
  ALTER TABLE "media" ADD COLUMN "cloudinary_resource_type" varchar;
  ALTER TABLE "media" ADD COLUMN "cloudinary_version" numeric;
  ALTER TABLE "media" ADD COLUMN "prefix" varchar DEFAULT 'north01';
  CREATE INDEX "media_role_idx" ON "media" USING btree ("role");
  CREATE INDEX "media_cloudinary_public_id_idx" ON "media" USING btree ("cloudinary_public_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "media_role_idx";
  DROP INDEX "media_cloudinary_public_id_idx";
  ALTER TABLE "media" DROP COLUMN "role";
  ALTER TABLE "media" DROP COLUMN "cloudinary_public_id";
  ALTER TABLE "media" DROP COLUMN "cloudinary_asset_id";
  ALTER TABLE "media" DROP COLUMN "cloudinary_resource_type";
  ALTER TABLE "media" DROP COLUMN "cloudinary_version";
  ALTER TABLE "media" DROP COLUMN "prefix";
  DROP TYPE "public"."enum_media_role";`)
}
