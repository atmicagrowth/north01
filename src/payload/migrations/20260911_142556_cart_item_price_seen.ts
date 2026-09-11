import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Phase 31 — `cart_items.price_seen_minor`, the price a customer saw when they last added or
 * changed a line (plan §31.1e, "price changed"). Display only, never charged; nullable, so every
 * existing line simply shows no notice.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "cart_items" ADD COLUMN "price_seen_minor" numeric;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "cart_items" DROP COLUMN "price_seen_minor";`)
}
