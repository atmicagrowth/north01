import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_orders_fulfilment_hold" AS ENUM('none', 'stockShortfall');
  ALTER TABLE "orders" ADD COLUMN "fulfilment_hold" "enum_orders_fulfilment_hold" DEFAULT 'none';
  ALTER TABLE "orders" ADD COLUMN "shortfall" jsonb;
  CREATE INDEX "orders_fulfilment_hold_idx" ON "orders" USING btree ("fulfilment_hold");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "orders_fulfilment_hold_idx";
  ALTER TABLE "orders" DROP COLUMN "fulfilment_hold";
  ALTER TABLE "orders" DROP COLUMN "shortfall";
  DROP TYPE "public"."enum_orders_fulfilment_hold";`)
}
