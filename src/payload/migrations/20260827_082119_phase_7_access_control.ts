import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_customers_account_status" AS ENUM('active', 'disabled');
  CREATE TYPE "public"."enum_users_role" AS ENUM('editor', 'admin');
  ALTER TABLE "customers" ADD COLUMN "account_status" "enum_customers_account_status" DEFAULT 'active' NOT NULL;
  ALTER TABLE "users" ADD COLUMN "role" "enum_users_role" DEFAULT 'editor' NOT NULL;
  CREATE INDEX "customers_account_status_idx" ON "customers" USING btree ("account_status");
  CREATE INDEX "users_role_idx" ON "users" USING btree ("role");`)

  /**
   * **The one hand-written statement in this file, and it prevents a lockout.**
   *
   * `role` defaults to `editor`, which is right for every account created from here on: least
   * privilege, granted deliberately. It is wrong for the accounts that already exist. Before this
   * migration there were no roles at all — every staff account had unrestricted access to the CMS —
   * so `editor` would not preserve their permissions, it would silently remove them, from *all* of
   * them at once. Nobody could grant them back: creating staff and editing `role` both require an
   * admin, and after this migration there would be none.
   *
   * So this is not a promotion. It is the truthful translation of the prior state into the new
   * vocabulary: what those accounts could already do is what `admin` now means. A fresh database
   * runs this against an empty table and it changes nothing — `create-first-user` is what makes the
   * founding account an admin there (see `payload/collections/Users.ts`).
   *
   * It is a *data* statement, so it alters no schema and the Drizzle snapshot beside this file stays
   * accurate — the same reasoning that lets `IF EXISTS` be added to a `DROP CONSTRAINT`. See
   * `docs/DATABASE.md` §4.
   */
  await db.execute(sql`UPDATE "users" SET "role" = 'admin';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "customers_account_status_idx";
  DROP INDEX "users_role_idx";
  ALTER TABLE "customers" DROP COLUMN "account_status";
  ALTER TABLE "users" DROP COLUMN "role";
  DROP TYPE "public"."enum_customers_account_status";
  DROP TYPE "public"."enum_users_role";`)
}
