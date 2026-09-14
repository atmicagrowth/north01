import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings" ADD COLUMN "privacy_policy" jsonb;
  ALTER TABLE "site_settings" ADD COLUMN "terms_of_sale" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings" DROP COLUMN "privacy_policy";
  ALTER TABLE "site_settings" DROP COLUMN "terms_of_sale";`)
}
