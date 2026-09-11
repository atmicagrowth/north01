import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_orders_fulfilment_hold" ADD VALUE 'paymentMismatch';
  ALTER TABLE "orders" ADD COLUMN "tax_calculation_id" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "orders" ALTER COLUMN "fulfilment_hold" SET DATA TYPE text;
  ALTER TABLE "orders" ALTER COLUMN "fulfilment_hold" SET DEFAULT 'none'::text;
  DROP TYPE "public"."enum_orders_fulfilment_hold";
  CREATE TYPE "public"."enum_orders_fulfilment_hold" AS ENUM('none', 'stockShortfall');
  ALTER TABLE "orders" ALTER COLUMN "fulfilment_hold" SET DEFAULT 'none'::"public"."enum_orders_fulfilment_hold";
  ALTER TABLE "orders" ALTER COLUMN "fulfilment_hold" SET DATA TYPE "public"."enum_orders_fulfilment_hold" USING "fulfilment_hold"::"public"."enum_orders_fulfilment_hold";
  ALTER TABLE "orders" DROP COLUMN "tax_calculation_id";`)
}
